import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { Obligacion } from '../../../../api/generated/model/obligacion';
import { PagoDeFinanciador } from '../../../../api/generated/model/pago-de-financiador';
import { Presentacion, PresentacionEstadoEnum } from '../../../../api/generated/model/presentacion';
import { PresentacionItem } from '../../../../api/generated/model/presentacion-item';
import { PresentacionesApi } from '../../services/presentaciones-api';
import { ReparoDePresentacion } from '../../../../api/generated/model/reparo-de-presentacion';
import { RegistrarPagoDeFinanciadorMedioEnum } from '../../../../api/generated/model/registrar-pago-de-financiador';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { ValidacionDePresentacion } from '../../../../api/generated/model/validacion-de-presentacion';
import { nuevaClaveDeIntento } from '../../../../shared/utils/clave-de-intento';
import {
  ErrorPresentacion,
  errorSinContexto,
  traducirErrorPresentacion,
} from '../../models/presentacion-errors';
import {
  MEDIOS_DE_PAGO_DE_FINANCIADOR,
  admiteFactura,
  claseDeEstadoDePresentacion,
  esBorrador,
  esDebitable,
  estaEnCurso,
  estadoDeItemEnPalabras,
  estadoDePresentacionEnPalabras,
  fechaIsoEnPalabras,
  hallazgoEnPalabras,
  hoyIso,
} from '../../models/etiquetas-de-presentacion';
import { fechaEnPalabras, importeEnPalabras } from '../../models/etiquetas-de-obligacion';
import { medioEnPalabras } from '../../models/etiquetas-de-cobro';

type EstadoCarga =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo' }
  | { readonly tipo: 'error'; readonly error: ErrorPresentacion };

/** Lo que se relee junto despues de cada operacion: el lote y lo que depende de su estado. */
interface Lectura {
  readonly lote: Presentacion;
  readonly elegibles: readonly Obligacion[];
  readonly pagos: readonly PagoDeFinanciador[];
}

/**
 * Un lote de presentacion a un financiador, de punta a punta (M21, RF-M21-002 a RF-M21-008).
 *
 * <p>Arma el borrador (bandeja de elegibles, agregar y quitar), lo revisa, lo confirma o lo
 * descarta; y una vez presentado registra factura, debitos por prestacion y pagos del
 * financiador, y lo cierra (concilia).
 *
 * <h2>Despues de cada operacion se relee todo</h2>
 *
 * <p>Los cuatro importes del lote —presentado, debitado, cobrado, saldo— los calcula el backend
 * con UPDATE condicionales. Recalcularlos aca con la respuesta de la operacion seria una segunda
 * copia de la verdad que se despega al primer operador concurrente. Releer cuesta una ida mas y
 * deja la pantalla siempre igual a la base.
 *
 * <h2>La revision es informativa; la autoridad es confirmar</h2>
 *
 * <p>`GET /validacion` se muestra mientras se arma el lote para no descubrir los hallazgos todos
 * juntos al confirmar. Pero confirmar la vuelve a correr del lado del servidor: si responde
 * `presentacion-con-hallazgos`, la pantalla vuelve a pedir la revision y la muestra.
 */
@Component({
  selector: 'app-presentacion-detalle-page',
  imports: [ReactiveFormsModule, RouterLink, ConfirmacionConMotivo],
  templateUrl: './presentacion-detalle-page.html',
  styleUrl: '../../billing.css',
})
export class PresentacionDetallePage {
  private readonly api = inject(PresentacionesApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly fb = inject(NonNullableFormBuilder);

  /** De la ruta. `withComponentInputBinding` lo liga solo. */
  readonly presentacionId = input.required<string>();

  protected readonly estadoEnPalabras = estadoDePresentacionEnPalabras;
  protected readonly claseDeEstado = claseDeEstadoDePresentacion;
  protected readonly estadoDeItem = estadoDeItemEnPalabras;
  protected readonly hallazgoEnPalabras = hallazgoEnPalabras;
  protected readonly fecha = fechaIsoEnPalabras;
  protected readonly instante = fechaEnPalabras;
  protected readonly medioEnPalabras = medioEnPalabras;
  protected readonly medios = MEDIOS_DE_PAGO_DE_FINANCIADOR;
  protected readonly esDebitable = esDebitable;

  protected readonly carga = signal<EstadoCarga>({ tipo: 'cargando' });
  protected readonly lote = signal<Presentacion | null>(null);
  protected readonly elegibles = signal<readonly Obligacion[]>([]);
  protected readonly pagos = signal<readonly PagoDeFinanciador[]>([]);
  protected readonly validacion = signal<ValidacionDePresentacion | null>(null);

  /** Que operacion esta en vuelo, para deshabilitar sus botones. `null` si ninguna. */
  protected readonly operando = signal<string | null>(null);
  protected readonly errorOperacion = signal<ErrorPresentacion | null>(null);
  protected readonly aviso = signal<string | null>(null);

  protected readonly anulando = signal(false);
  protected readonly itemDebitando = signal<number | null>(null);

  protected readonly factura = this.fb.group({
    numero: ['', Validators.required],
    fecha: [hoyIso(), Validators.required],
  });

  protected readonly pago = this.fb.group({
    importe: [0, [Validators.required, Validators.min(0.01)]],
    medio: [RegistrarPagoDeFinanciadorMedioEnum.TRANSFERENCIA as string, Validators.required],
    fechaPago: [hoyIso(), Validators.required],
    referencia: [''],
  });

  protected readonly debito = this.fb.group({
    importe: [0, [Validators.required, Validators.min(0.01)]],
    motivo: ['', Validators.required],
  });

  /**
   * Clave del intento de pago. Se conserva entre reintentos —un error de red no sabe si el pago
   * entro, y reintentar con la misma clave no lo registra dos veces— y se renueva al registrarlo.
   */
  private claveDePago = nuevaClaveDeIntento();

  protected readonly esBorrador = computed(() => esBorrador(this.lote()));
  protected readonly enCurso = computed(() => estaEnCurso(this.lote()));
  protected readonly admiteFactura = computed(() => admiteFactura(this.lote()));
  protected readonly items = computed<readonly PresentacionItem[]>(() => this.lote()?.items ?? []);

  protected readonly hallazgos = computed<readonly ReparoDePresentacion[]>(
    () => this.validacion()?.hallazgos ?? [],
  );

  /** Hallazgos por item, para marcarlos en la tabla del lote. */
  protected readonly hallazgosPorItem = computed(() => {
    const mapa = new Map<number, string[]>();
    for (const reparo of this.hallazgos()) {
      if (reparo.itemId === undefined) continue;
      const lista = mapa.get(reparo.itemId) ?? [];
      lista.push(hallazgoEnPalabras(reparo.hallazgo));
      mapa.set(reparo.itemId, lista);
    }
    return mapa;
  });

  constructor() {
    effect(() => {
      this.presentacionId();
      this.tenantContext.contextEpoch();
      untracked(() => {
        // Un lote de otra organizacion en pantalla es una fuga de tenant.
        this.lote.set(null);
        this.validacion.set(null);
        this.errorOperacion.set(null);
        this.aviso.set(null);
        this.cerrarPaneles();
        this.cargar();
      });
    });
  }

  protected cargar(): void {
    const ids = this.ids();
    if (ids === null) {
      this.carga.set({ tipo: 'error', error: errorSinContexto() });
      return;
    }
    this.carga.set({ tipo: 'cargando' });
    this.leer(ids.consultorioId, ids.presentacionId).subscribe({
      next: (lectura) => {
        this.aplicar(lectura);
        this.carga.set({ tipo: 'listo' });
        if (esBorrador(lectura.lote)) {
          this.revisar();
        }
      },
      error: (error: unknown) =>
        this.carga.set({ tipo: 'error', error: traducirErrorPresentacion(error) }),
    });
  }

  // ----------------------------------------------------------------------------------
  // Armado del borrador — RF-M21-001, RF-M21-002, RF-M21-003
  // ----------------------------------------------------------------------------------

  protected agregar(obligacion: Obligacion): void {
    if (obligacion.id === undefined) return;
    const obligacionId = obligacion.id;
    this.operar(
      `agregar-${obligacionId}`,
      (c, p) => this.api.agregarItem(c, p, obligacionId),
      'Se agrego la prestacion al lote.',
    );
  }

  protected quitar(item: PresentacionItem): void {
    if (item.id === undefined) return;
    const itemId = item.id;
    this.operar(
      `quitar-${itemId}`,
      (c, p) => this.api.quitarItem(c, p, itemId),
      'Se quito la prestacion del lote. Vuelve a estar disponible.',
    );
  }

  protected revisar(): void {
    const ids = this.ids();
    if (ids === null) return;
    this.api.validar(ids.consultorioId, ids.presentacionId).subscribe({
      next: (resultado) => this.validacion.set(resultado),
      error: (error: unknown) => this.errorOperacion.set(traducirErrorPresentacion(error)),
    });
  }

  protected confirmar(): void {
    this.operar(
      'confirmar',
      (c, p) => this.api.confirmar(c, p),
      'Lote presentado: tiene numero y su total quedo congelado. Todavia no se cobro nada.',
    );
  }

  protected abrirAnulacion(): void {
    this.cerrarPaneles();
    this.anulando.set(true);
  }

  protected anular(motivo: string): void {
    this.operar(
      'anular',
      (c, p) => this.api.anular(c, p, motivo),
      'El borrador se descarto. Sus prestaciones vuelven a estar disponibles.',
    );
  }

  // ----------------------------------------------------------------------------------
  // Lote presentado — RF-M21-005 a RF-M21-008
  // ----------------------------------------------------------------------------------

  protected registrarFactura(): void {
    this.factura.markAllAsTouched();
    if (this.factura.invalid) return;
    const { numero, fecha } = this.factura.getRawValue();
    this.operar(
      'factura',
      (c, p) => this.api.registrarFactura(c, p, numero.trim(), fecha),
      'Factura registrada.',
    );
  }

  protected abrirDebito(item: PresentacionItem): void {
    this.cerrarPaneles();
    this.debito.reset({ importe: item.importePresentado ?? 0, motivo: '' });
    this.itemDebitando.set(item.id ?? null);
  }

  protected debitar(item: PresentacionItem): void {
    this.debito.markAllAsTouched();
    if (this.debito.invalid || item.id === undefined) return;
    const itemId = item.id;
    const { importe, motivo } = this.debito.getRawValue();
    this.operar(
      `debito-${itemId}`,
      (c, p) => this.api.debitar(c, p, itemId, importe, motivo.trim()),
      'Debito registrado. La deuda de esa prestacion sigue pendiente: rechazarla no la perdona.',
    );
  }

  protected registrarPago(): void {
    this.pago.markAllAsTouched();
    if (this.pago.invalid) return;
    const valor = this.pago.getRawValue();
    const clave = this.claveDePago;
    this.operar(
      'pago',
      (c, p) =>
        this.api.registrarPago(c, p, {
          importe: valor.importe,
          medio: valor.medio as RegistrarPagoDeFinanciadorMedioEnum,
          fechaPago: valor.fechaPago,
          referencia: valor.referencia.trim() || undefined,
          idempotencyKey: clave,
        }),
      'Pago registrado. Las deudas se saldan recien al cerrar el lote.',
      () => {
        this.claveDePago = nuevaClaveDeIntento();
        this.pago.reset({
          importe: 0,
          medio: RegistrarPagoDeFinanciadorMedioEnum.TRANSFERENCIA,
          fechaPago: hoyIso(),
          referencia: '',
        });
      },
    );
  }

  protected conciliar(): void {
    this.operar(
      'conciliar',
      (c, p) => this.api.conciliar(c, p),
      'Lote cerrado. Cada prestacion aceptada salda su deuda por el importe presentado.',
    );
  }

  protected cerrarPaneles(): void {
    this.anulando.set(false);
    this.itemDebitando.set(null);
  }

  protected importe(valor: number | undefined): string {
    return importeEnPalabras(valor, this.lote()?.moneda);
  }

  protected requisitos(obligacion: Obligacion): string {
    const c = obligacion.convenio;
    if (c === undefined) return '';
    const exige = [
      c.requeriaOrden ? 'orden' : null,
      c.requeriaAutorizacion ? 'autorizacion' : null,
      c.requeriaCredencial ? 'credencial' : null,
    ].filter((r): r is string => r !== null);
    const partes = exige.length > 0 ? [`El convenio exige ${exige.join(', ')}.`] : [];
    if (c.credencialVencida) partes.push('La credencial estaba vencida.');
    return partes.join(' ');
  }

  // ----------------------------------------------------------------------------------
  // Apoyo
  // ----------------------------------------------------------------------------------

  private operar(
    clave: string,
    llamada: (consultorioId: number, presentacionId: number) => Observable<unknown>,
    mensajeOk: string,
    alTerminar?: () => void,
  ): void {
    const ids = this.ids();
    if (ids === null || this.operando() !== null) return;
    this.operando.set(clave);
    this.errorOperacion.set(null);
    this.aviso.set(null);

    llamada(ids.consultorioId, ids.presentacionId).subscribe({
      next: () => {
        this.operando.set(null);
        this.cerrarPaneles();
        alTerminar?.();
        this.aviso.set(mensajeOk);
        this.cargar();
      },
      error: (error: unknown) => {
        this.operando.set(null);
        const traducido = traducirErrorPresentacion(error);
        this.errorOperacion.set(traducido);
        if (traducido.causa === 'con-hallazgos') {
          this.revisar();
        }
      },
    });
  }

  private leer(consultorioId: number, presentacionId: number): Observable<Lectura> {
    return this.api.detalle(consultorioId, presentacionId).pipe(
      switchMap((lote) => {
        const borrador = esBorrador(lote);
        const elegibles$: Observable<readonly Obligacion[]> =
          borrador && lote.financiadorId !== undefined
            ? this.api.elegibles(
                consultorioId,
                lote.financiadorId,
                lote.periodoDesde,
                lote.periodoHasta,
              )
            : of([]);
        const pagos$: Observable<readonly PagoDeFinanciador[]> =
          borrador || lote.estado === PresentacionEstadoEnum.ANULADA
            ? of([])
            : this.api.pagosDelLote(consultorioId, presentacionId);
        // Las dos listas son accesorias: si una falla, el lote se muestra igual.
        return forkJoin({
          lote: of(lote),
          elegibles: elegibles$.pipe(catchError(() => of([]))),
          pagos: pagos$.pipe(catchError(() => of([]))),
        });
      }),
    );
  }

  private aplicar(lectura: Lectura): void {
    this.lote.set(lectura.lote);
    this.elegibles.set(lectura.elegibles);
    this.pagos.set(lectura.pagos);
    if (!esBorrador(lectura.lote)) {
      this.validacion.set(null);
    }
  }

  private ids(): { consultorioId: number; presentacionId: number } | null {
    const consultorioId = this.tenantContext.consultorioId();
    const presentacionId = Number(this.presentacionId());
    if (consultorioId === null || !Number.isFinite(presentacionId) || presentacionId <= 0) {
      return null;
    }
    return { consultorioId, presentacionId };
  }
}
