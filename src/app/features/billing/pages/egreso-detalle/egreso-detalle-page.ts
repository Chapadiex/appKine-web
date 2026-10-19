import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';

import { Egreso } from '../../../../api/generated/model/egreso';
import { JornadaCaja } from '../../../../api/generated/model/jornada-caja';
import { OfertaResponse } from '../../../../api/generated/model/oferta-response';
import { PagoDeEgreso } from '../../../../api/generated/model/pago-de-egreso';
import { EditarEgresoCategoriaEnum } from '../../../../api/generated/model/editar-egreso';
import { RegistrarEgresoCategoriaEnum } from '../../../../api/generated/model/registrar-egreso';
import { RegistrarPagoDeEgresoMedioEnum } from '../../../../api/generated/model/registrar-pago-de-egreso';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { nuevaClaveDeIntento } from '../../../../shared/utils/clave-de-intento';
import { aCentavos, centavosDeTexto, deCentavos, textoDeCentavos } from '../../models/dinero';
import {
  ErrorEgreso,
  errorSinContextoDeEgreso,
  traducirErrorEgreso,
} from '../../models/egreso-errors';
import { instanteEnPalabras, medioEnPalabras } from '../../models/etiquetas-de-cobro';
import {
  CATEGORIAS_DE_EGRESO,
  MEDIOS_DE_PAGO_DE_EGRESO,
  admiteAnulacion,
  admitePago,
  categoriaEnPalabras,
  claseDeEstadoDeEgreso,
  esBorradorDeEgreso,
  estadoDeEgresoEnPalabras,
  pagoVigente,
  tienePagosVigentes,
} from '../../models/etiquetas-de-egreso';
import { importeEnPalabras } from '../../models/etiquetas-de-obligacion';
import { fechaIsoEnPalabras } from '../../models/etiquetas-de-presentacion';
import { CajaApi } from '../../services/caja-api';
import { EgresosApi } from '../../services/egresos-api';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';

type EstadoCarga =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo' }
  | { readonly tipo: 'error'; readonly error: ErrorEgreso };

/** Que se sabe de la caja de la sede: `null` mientras no se pregunto o no hizo falta. */
type SituacionDeCaja =
  { readonly abierta: false } | { readonly abierta: true; readonly jornada: JornadaCaja };

/**
 * Campos que un egreso nacido de una liquidacion de honorarios no deja corregir (DP-38): salen de
 * las clases liquidadas. Concepto y comprobante si se corrigen.
 */
const CAMPOS_DE_LIQUIDACION = [
  'categoria',
  'importe',
  'periodoDesde',
  'periodoHasta',
  'ofertaId',
] as const;

type Operacion = 'editar' | 'confirmar' | 'pagar' | 'anular' | 'anular-pago';

/**
 * Un egreso: correccion del borrador, confirmacion, pagos y anulaciones (M22, RF-M22-001/002/005,
 * AKINE-07.05).
 *
 * <h2>Lo que mueve la caja es el pago, no el egreso</h2>
 *
 * <p>Confirmar no toca el cajon. Cada pago si, pero <b>solo el efectivo afecta el arqueo y exige
 * caja abierta</b>: por eso, con efectivo elegido, la pantalla muestra si la caja esta abierta y
 * cuanto hay. Es un aviso: el backend decide (`caja-no-abierta`, `caja-saldo-insuficiente`).
 *
 * <h2>Los importes los da el servidor</h2>
 *
 * <p>El saldo pendiente y el estado se releen despues de cada operacion: recalcularlos con la
 * respuesta seria una segunda copia de la verdad que se despega al primer pago concurrente. La
 * unica cuenta local es "ya pagado" (total − saldo), en centavos enteros.
 *
 * <h2>Anular son dos hechos</h2>
 *
 * <p>Anular un pago devuelve la plata al cajon y el saldo al egreso. Anular el egreso exige que
 * no queden pagos vigentes: la pantalla no ofrece el boton mientras los haya y explica el orden.
 */
@Component({
  selector: 'app-egreso-detalle-page',
  imports: [ReactiveFormsModule, RouterLink, ConfirmacionConMotivo],
  templateUrl: './egreso-detalle-page.html',
  styleUrl: '../../billing.css',
})
export class EgresoDetallePage {
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly api = inject(EgresosApi);
  private readonly cajaApi = inject(CajaApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** De la ruta. `withComponentInputBinding` lo liga solo. */
  readonly egresoId = input.required<string>();

  protected readonly estadoEnPalabras = estadoDeEgresoEnPalabras;
  protected readonly claseDeEstado = claseDeEstadoDeEgreso;
  protected readonly categoriaEnPalabras = categoriaEnPalabras;
  protected readonly categorias = CATEGORIAS_DE_EGRESO;
  protected readonly medios = MEDIOS_DE_PAGO_DE_EGRESO;
  protected readonly medioEnPalabras = medioEnPalabras;
  protected readonly instante = (valor: string | undefined): string =>
    instanteEnPalabras(valor, this.diaDeLaSede.zona());
  protected readonly fecha = fechaIsoEnPalabras;
  protected readonly pagoVigente = pagoVigente;
  protected readonly EFECTIVO = RegistrarPagoDeEgresoMedioEnum.EFECTIVO;

  protected readonly carga = signal<EstadoCarga>({ tipo: 'cargando' });
  protected readonly egreso = signal<Egreso | null>(null);
  /** Ofertas de la sede, activas y de baja: el egreso puede estar imputado a una de baja (DP-39). */
  protected readonly ofertas = signal<readonly OfertaResponse[]>([]);
  protected readonly caja = signal<SituacionDeCaja | null>(null);
  protected readonly operando = signal<Operacion | null>(null);
  protected readonly errorOperacion = signal<ErrorEgreso | null>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly anulando = signal(false);
  protected readonly pagoAnulando = signal<number | null>(null);
  protected readonly medioElegido = signal<string>(RegistrarPagoDeEgresoMedioEnum.EFECTIVO);
  protected readonly edicionIntentada = signal(false);
  protected readonly pagoIntentado = signal(false);

  protected readonly edicion = this.fb.group({
    categoria: [RegistrarEgresoCategoriaEnum.OTRO as string],
    concepto: ['', Validators.required],
    importe: ['', Validators.required],
    periodoDesde: [''],
    periodoHasta: [''],
    comprobanteTipo: [''],
    comprobanteNumero: [''],
    comprobanteFecha: [''],
    ofertaId: [''],
  });

  protected readonly pago = this.fb.group({
    importe: ['', Validators.required],
    medio: [RegistrarPagoDeEgresoMedioEnum.EFECTIVO as string],
    referencia: [''],
  });

  /** Se conserva entre reintentos del mismo pago —un error de red no sabe si entro—. */
  private claveDePago = nuevaClaveDeIntento();

  protected readonly esBorrador = computed(() => esBorradorDeEgreso(this.egreso()));
  /** El egreso nacio de una liquidacion de honorarios por clase (DP-38). */
  protected readonly deLiquidacion = computed(() => tieneLiquidacion(this.egreso()));
  /** Las que se ofrecen al corregir: activas, mas la actual aunque este de baja. */
  protected readonly ofertasElegibles = computed(() => {
    const actual = this.egreso()?.ofertaId;
    return this.ofertas().filter((o) => o.estado === 'ACTIVO' || o.id === actual);
  });
  protected readonly nombreDeOferta = computed(() => {
    const id = this.egreso()?.ofertaId;
    if (id === undefined || id === null) {
      return null;
    }
    const oferta = this.ofertas().find((o) => o.id === id);
    const nombre = oferta?.nombreComercial ?? `Oferta #${id}`;
    return oferta !== undefined && oferta.estado !== 'ACTIVO' ? `${nombre} (dada de baja)` : nombre;
  });
  protected readonly admitePago = computed(() => admitePago(this.egreso()));
  protected readonly conPagosVigentes = computed(() => tienePagosVigentes(this.egreso()));
  protected readonly admiteAnulacion = computed(
    () => admiteAnulacion(this.egreso()) && !this.conPagosVigentes(),
  );
  protected readonly pagos = computed<readonly PagoDeEgreso[]>(() => this.egreso()?.pagos ?? []);

  /** Sin tipo y numero de comprobante el backend no confirma (`egreso-sin-comprobante`). */
  protected readonly faltaComprobante = computed(() => {
    const e = this.egreso();
    return !e?.comprobanteTipo || !e.comprobanteNumero;
  });

  /** total − saldo, en centavos: lo unico que la pantalla calcula. */
  protected readonly yaPagado = computed(() => {
    const e = this.egreso();
    const total = aCentavos(e?.importeTotal);
    const saldo = aCentavos(e?.saldoPendiente);
    return total === null || saldo === null ? null : deCentavos(total - saldo);
  });

  constructor() {
    this.pago.controls.medio.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((medio) => this.medioElegido.set(medio));
    this.pago.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.claveDePago = nuevaClaveDeIntento();
    });

    effect(() => {
      this.egresoId();
      this.tenantContext.contextEpoch();
      untracked(() => {
        // Un egreso de otra organizacion en pantalla es una fuga de tenant.
        this.egreso.set(null);
        this.ofertas.set([]);
        this.caja.set(null);
        this.errorOperacion.set(null);
        this.aviso.set(null);
        this.cerrarPaneles();
        this.cargar();
        this.cargarOfertas();
      });
    });
  }

  protected cargar(): void {
    const ids = this.ids();
    if (ids === null) {
      this.carga.set({ tipo: 'error', error: errorSinContextoDeEgreso() });
      return;
    }
    this.carga.set({ tipo: 'cargando' });
    this.api.ver(ids.consultorioId, ids.egresoId).subscribe({
      next: (egreso) => {
        this.aplicar(egreso);
        this.carga.set({ tipo: 'listo' });
      },
      error: (error: unknown) =>
        this.carga.set({ tipo: 'error', error: traducirErrorEgreso(error) }),
    });
  }

  /** Releer sin pasar por "cargando": la pantalla no parpadea despues de cada operacion. */
  protected recargar(): void {
    const ids = this.ids();
    if (ids === null) {
      return;
    }
    this.api.ver(ids.consultorioId, ids.egresoId).subscribe({
      next: (egreso) => this.aplicar(egreso),
      error: (error: unknown) => this.errorOperacion.set(traducirErrorEgreso(error)),
    });
  }

  // -------------------------------------------------------------------------------------
  // Borrador
  // -------------------------------------------------------------------------------------

  protected guardar(): void {
    this.edicionIntentada.set(true);
    const ids = this.ids();
    const egreso = this.egreso();
    const centavos = centavosDeTexto(this.edicion.controls.importe.value);
    if (
      ids === null ||
      egreso === null ||
      egreso.version === undefined ||
      this.edicion.invalid ||
      centavos === null ||
      centavos <= 0 ||
      this.periodoInvalido() ||
      this.operando() !== null
    ) {
      return;
    }
    const version = egreso.version;
    const v = this.edicion.getRawValue();
    this.operar(
      'editar',
      // Contrato 0.92.0: la correccion lleva la version leida y ya no manda beneficiario, moneda
      // ni clave. Si otro lo cambio antes, el backend responde 409 `concurrent-modification` y no
      // pisa nada. El PUT REEMPLAZA (0.132.0): la oferta viaja siempre, o el egreso queda sin
      // imputar. En uno de liquidacion los campos bloqueados viajan con su valor leido.
      this.api.editar(ids.consultorioId, ids.egresoId, {
        version,
        categoria: v.categoria as EditarEgresoCategoriaEnum,
        concepto: v.concepto.trim(),
        importeTotal: deCentavos(centavos),
        periodoDesde: v.periodoDesde || undefined,
        periodoHasta: v.periodoHasta || undefined,
        comprobanteTipo: v.comprobanteTipo.trim() || undefined,
        comprobanteNumero: v.comprobanteNumero.trim() || undefined,
        comprobanteFecha: v.comprobanteFecha || undefined,
        ofertaId: v.ofertaId === '' ? undefined : Number(v.ofertaId),
      }),
      'Cambios guardados. El egreso sigue en borrador.',
    );
  }

  protected confirmar(): void {
    const ids = this.ids();
    if (ids === null || this.operando() !== null) {
      return;
    }
    this.operar(
      'confirmar',
      this.api.confirmar(ids.consultorioId, ids.egresoId),
      'Egreso confirmado. Ya no se corrige y admite pagos.',
    );
  }

  // -------------------------------------------------------------------------------------
  // Pagos
  // -------------------------------------------------------------------------------------

  protected pagar(): void {
    this.pagoIntentado.set(true);
    const ids = this.ids();
    const centavos = centavosDeTexto(this.pago.controls.importe.value);
    if (ids === null || centavos === null || centavos <= 0 || this.operando() !== null) {
      return;
    }
    const v = this.pago.getRawValue();
    const efectivo = v.medio === this.EFECTIVO;
    this.operar(
      'pagar',
      this.api.pagar(ids.consultorioId, ids.egresoId, {
        importe: deCentavos(centavos),
        medio: v.medio as RegistrarPagoDeEgresoMedioEnum,
        referencia: v.referencia.trim() || undefined,
        idempotencyKey: this.claveDePago,
      }),
      efectivo
        ? 'Pago registrado. El efectivo salio del cajon: la caja lo muestra como egreso.'
        : 'Pago registrado.',
    );
  }

  protected pedirAnulacionDePago(pago: PagoDeEgreso): void {
    this.cerrarPaneles();
    this.pagoAnulando.set(pago.id ?? null);
  }

  protected anularPago(motivo: string): void {
    const ids = this.ids();
    const pagoId = this.pagoAnulando();
    if (ids === null || pagoId === null || this.operando() !== null) {
      return;
    }
    this.operar(
      'anular-pago',
      this.api.anularPago(ids.consultorioId, ids.egresoId, pagoId, motivo),
      'Pago anulado. La plata vuelve al cajon como reversion en la jornada de hoy y el saldo ' +
        'vuelve al egreso.',
    );
  }

  /** Cierra el panel y devuelve el foco al boton que lo abrio (WCAG 2.4.3). */
  protected cancelarAnulacionDePago(): void {
    const pagoId = this.pagoAnulando();
    this.pagoAnulando.set(null);
    if (pagoId !== null) {
      this.enfocarDespues(`#anular-pago-${pagoId}`);
    }
  }

  // -------------------------------------------------------------------------------------
  // Anulacion del egreso
  // -------------------------------------------------------------------------------------

  protected pedirAnulacion(): void {
    this.cerrarPaneles();
    this.anulando.set(true);
  }

  protected cancelarAnulacion(): void {
    this.anulando.set(false);
    this.enfocarDespues('#anular-egreso');
  }

  protected anular(motivo: string): void {
    const ids = this.ids();
    if (ids === null || this.operando() !== null) {
      return;
    }
    this.operar(
      'anular',
      this.api.anular(ids.consultorioId, ids.egresoId, motivo),
      'Egreso anulado. Queda en el historial con su motivo.',
    );
  }

  // -------------------------------------------------------------------------------------
  // Presentacion
  // -------------------------------------------------------------------------------------

  protected importe(valor: number | undefined | null): string {
    return importeEnPalabras(valor ?? undefined, this.egreso()?.moneda);
  }

  protected importeDeCaja(jornada: JornadaCaja): string {
    return importeEnPalabras(jornada.saldoTeorico, jornada.moneda);
  }

  protected campoDeEdicionInvalido(nombre: 'concepto' | 'importe' | 'periodo'): boolean {
    if (!this.edicionIntentada()) {
      return false;
    }
    if (nombre === 'importe') {
      const centavos = centavosDeTexto(this.edicion.controls.importe.value);
      return centavos === null || centavos <= 0;
    }
    if (nombre === 'periodo') {
      return this.periodoInvalido();
    }
    return this.edicion.controls[nombre].invalid;
  }

  protected importeDePagoInvalido(): boolean {
    const centavos = centavosDeTexto(this.pago.controls.importe.value);
    return this.pagoIntentado() && (centavos === null || centavos <= 0);
  }

  // -------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------

  private ids(): { consultorioId: number; egresoId: number } | null {
    const consultorioId = this.tenantContext.consultorioId();
    const egresoId = Number(this.egresoId());
    return consultorioId === null || !Number.isFinite(egresoId)
      ? null
      : { consultorioId, egresoId };
  }

  private aplicar(egreso: Egreso): void {
    this.egreso.set(egreso);
    if (esBorradorDeEgreso(egreso)) {
      this.edicion.reset({
        categoria: egreso.categoria ?? RegistrarEgresoCategoriaEnum.OTRO,
        concepto: egreso.concepto ?? '',
        importe: textoDeCentavos(aCentavos(egreso.importeTotal) ?? 0),
        periodoDesde: egreso.periodoDesde ?? '',
        periodoHasta: egreso.periodoHasta ?? '',
        comprobanteTipo: egreso.comprobanteTipo ?? '',
        comprobanteNumero: egreso.comprobanteNumero ?? '',
        comprobanteFecha: egreso.comprobanteFecha ?? '',
        ofertaId: egreso.ofertaId == null ? '' : String(egreso.ofertaId),
      });
      const bloqueados = tieneLiquidacion(egreso);
      for (const campo of CAMPOS_DE_LIQUIDACION) {
        const control = this.edicion.controls[campo];
        if (bloqueados) {
          control.disable({ emitEvent: false });
        } else {
          control.enable({ emitEvent: false });
        }
      }
      this.edicionIntentada.set(false);
    }
    if (admitePago(egreso)) {
      // Por defecto se propone saldar todo: el pago parcial es corregir el numero.
      this.pago.reset({
        importe: textoDeCentavos(aCentavos(egreso.saldoPendiente) ?? 0),
        medio: this.pago.controls.medio.value,
        referencia: '',
      });
      this.pagoIntentado.set(false);
      this.consultarCaja();
    }
  }

  private cargarOfertas(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      return;
    }
    // Sin el listado se muestra el id: el egreso se sigue pudiendo corregir.
    this.api.ofertasDeLaSede(consultorioId).subscribe({
      next: (lista) => this.ofertas.set(lista),
      error: () => this.ofertas.set([]),
    });
  }

  /** La caja solo importa para pagar en efectivo, y solo se consulta si el egreso admite pago. */
  private consultarCaja(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      return;
    }
    this.cajaApi.jornadaAbierta(consultorioId).subscribe({
      next: ([jornada]) =>
        this.caja.set(jornada === undefined ? { abierta: false } : { abierta: true, jornada }),
      // Sin el dato no se afirma nada: el backend decide al pagar.
      error: () => this.caja.set(null),
    });
  }

  private operar(operacion: Operacion, pedido: Observable<unknown>, exito: string): void {
    this.operando.set(operacion);
    this.errorOperacion.set(null);
    this.aviso.set(null);
    pedido.subscribe({
      next: (respuesta) => {
        this.operando.set(null);
        this.cerrarPaneles();
        this.aviso.set(exito);
        if (operacion === 'editar') {
          // La correccion devuelve el egreso con su version nueva: la proxima sale con esa.
          this.aplicar(respuesta as Egreso);
          return;
        }
        this.recargar();
      },
      error: (error: unknown) => {
        this.operando.set(null);
        const traducido = traducirErrorEgreso(error);
        if (operacion === 'pagar' && traducido.renovarClave === true) {
          this.claveDePago = nuevaClaveDeIntento();
        }
        this.errorOperacion.set(traducido);
      },
    });
  }

  private periodoInvalido(): boolean {
    const { periodoDesde, periodoHasta } = this.edicion.getRawValue();
    if (periodoDesde === '' && periodoHasta === '') {
      return false;
    }
    return periodoDesde === '' || periodoHasta === '' || periodoHasta < periodoDesde;
  }

  private cerrarPaneles(): void {
    this.anulando.set(false);
    this.pagoAnulando.set(null);
  }

  private enfocarDespues(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }
}

function tieneLiquidacion(egreso: Egreso | null): boolean {
  return egreso?.liquidacionHonorariosId != null;
}
