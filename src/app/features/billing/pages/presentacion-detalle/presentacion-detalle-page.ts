import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Migas } from '../../../../shared/components/migas/migas';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { Obligacion, ObligacionEstadoEnum } from '../../../../api/generated/model/obligacion';
import { PagoDeFinanciador } from '../../../../api/generated/model/pago-de-financiador';
import { Presentacion, PresentacionEstadoEnum } from '../../../../api/generated/model/presentacion';
import { PresentacionItem } from '../../../../api/generated/model/presentacion-item';
import { PresentacionesApi } from '../../services/presentaciones-api';
import { ReparoDePresentacion } from '../../../../api/generated/model/reparo-de-presentacion';
import { RegistrarPagoDeFinanciadorMedioEnum } from '../../../../api/generated/model/registrar-pago-de-financiador';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { ValidacionDePresentacion } from '../../../../api/generated/model/validacion-de-presentacion';
import { nuevaClaveDeIntento } from '../../../../shared/utils/clave-de-intento';
import { guardarComoArchivo, nombreDelEncabezado } from '../../../../shared/utils/descarga';
import {
  ErrorPresentacion,
  errorSinContexto,
  traducirErrorPresentacion,
} from '../../models/presentacion-errors';
import {
  ESTADOS_DE_ITEM,
  MEDIOS_DE_PAGO_DE_FINANCIADOR,
  admiteFactura,
  claseDeEstadoDeItem,
  claseDeEstadoDePresentacion,
  detalleDeEstadoDeItem,
  esBorrador,
  esDebitable,
  estaEnCurso,
  estadoDeItemEnPalabras,
  estadoDePresentacionEnPalabras,
  fechaIsoEnPalabras,
  hallazgoEnPalabras,
} from '../../models/etiquetas-de-presentacion';
import { fechaEnPalabras, importeEnPalabras } from '../../models/etiquetas-de-obligacion';
import { medioEnPalabras } from '../../models/etiquetas-de-cobro';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import { Paginacion } from '../../../../shared/components/paginacion/paginacion';
import { tablaLocal } from '../../../../shared/components/tabla/tabla-local';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

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

/** El rechazo de una operacion y su clave (`factura`, `debito-12`...): se muestra ahi (UX-12). */
type FalloDePresentacion = ErrorPresentacion & { readonly clave: string };

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
  imports: [
    CabeceraDePagina,
    PanelLateral,
    Alerta,
    Migas,
    Ayuda,
    NgTemplateOutlet,
    ColumnaOrdenable,
    Filtros,
    Paginacion,
    ReactiveFormsModule,
    RouterLink,
    ConfirmacionConMotivo,
  ],
  templateUrl: './presentacion-detalle-page.html',
  styleUrls: ['../../billing.css', '../../economia.css'],
})
export class PresentacionDetallePage {
  private readonly api = inject(PresentacionesApi);
  /** Aviso global (UX-12). No confundir con `avisos`, que son los reparos que no frenan. */
  private readonly notificaciones = inject(AvisosStore);
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly fb = inject(NonNullableFormBuilder);

  /** De la ruta. `withComponentInputBinding` lo liga solo. */
  readonly presentacionId = input.required<string>();

  protected readonly estadoEnPalabras = estadoDePresentacionEnPalabras;
  protected readonly claseDeEstado = claseDeEstadoDePresentacion;
  protected readonly estadoDeItem = estadoDeItemEnPalabras;
  protected readonly claseDeEstadoDeItem = claseDeEstadoDeItem;
  protected readonly detalleDeEstadoDeItem = detalleDeEstadoDeItem;
  protected readonly estadosDeItem = ESTADOS_DE_ITEM;
  protected readonly hallazgoEnPalabras = hallazgoEnPalabras;
  protected readonly fecha = fechaIsoEnPalabras;
  protected readonly instante = (valor: string | undefined): string =>
    fechaEnPalabras(valor, this.diaDeLaSede.zona());
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
  /** El rechazo de la ultima operacion y su clave (`factura`, `debito-12`...): se muestra ahi. */
  protected readonly errorOperacion = signal<FalloDePresentacion | null>(null);

  protected readonly anulando = signal(false);
  protected readonly exportando = signal(false);
  protected readonly itemDebitando = signal<number | null>(null);

  /** La prestacion del panel de debito, buscada en los items del lote (el panel vive fuera de la tabla). */
  protected readonly itemEnDebito = computed(() => {
    const id = this.itemDebitando();
    return id === null ? null : (this.items().find((item) => item.id === id) ?? null);
  });

  protected readonly factura = this.fb.group({
    numero: ['', Validators.required],
    fecha: [this.diaDeLaSede.hoy(), Validators.required],
  });

  protected readonly pago = this.fb.group({
    importe: [0, [Validators.required, Validators.min(0.01)]],
    medio: [RegistrarPagoDeFinanciadorMedioEnum.TRANSFERENCIA as string, Validators.required],
    fechaPago: [this.diaDeLaSede.hoy(), Validators.required],
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

  /** Filtro de la tabla del lote por estado de la prestacion. Vacio = todas. */
  protected readonly filtroDeItem = signal<string>('');
  /** Filtros avanzados fuera de su valor por defecto: el contador del embudo. */
  protected readonly filtrosAvanzadosActivos = computed(() => Number(this.filtroDeItem() !== ''));

  protected readonly itemsVisibles = computed<readonly PresentacionItem[]>(() => {
    const filtro = this.filtroDeItem();
    return filtro === '' ? this.items() : this.items().filter((item) => item.estado === filtro);
  });

  /** Orden y paginado de las prestaciones del lote (plan §3.4): el lote las trae todas. */
  protected readonly tablaItems = tablaLocal(this.itemsVisibles, {
    columnas: {
      prestacion: (item) => item.concepto ?? null,
      fecha: (item) => item.fechaPrestacion ?? null,
      paciente: (item) => item.personaId ?? null,
      importe: (item) => item.importePresentado ?? null,
      estado: (item) => estadoDeItemEnPalabras(item.estado),
    },
  });

  /** Orden y paginado de la bandeja de elegibles: el backend devuelve un array. */
  protected readonly tablaElegibles = tablaLocal(this.elegibles, {
    columnas: {
      prestacion: (obligacion) => obligacion.snapshotNombre ?? null,
      devengada: (obligacion) => obligacion.devengadaEn ?? null,
      paciente: (obligacion) => obligacion.personaId ?? null,
      saldo: (obligacion) => obligacion.saldo ?? null,
    },
  });

  /** Lo que impide confirmar (RF-M21-003): incluye `SIN_ORDEN` y `SIN_AUTORIZACION` (DP-37). */
  protected readonly hallazgos = computed<readonly ReparoDePresentacion[]>(
    () => this.validacion()?.hallazgos ?? [],
  );

  /** Lo que conviene regularizar y NO impide confirmar: hoy, `CREDENCIAL_FALTANTE` (DP-37). */
  protected readonly avisos = computed<readonly ReparoDePresentacion[]>(
    () => this.validacion()?.avisos ?? [],
  );

  /**
   * Si el boton de confirmar se ofrece. Manda `confirmable` de la revision: un aviso no lo apaga.
   * Sin revision todavia, decide el servidor al confirmar.
   */
  protected readonly confirmable = computed(
    () => this.items().length > 0 && this.validacion()?.confirmable !== false,
  );

  /** Hallazgos por item, para marcarlos en la tabla del lote. */
  protected readonly hallazgosPorItem = computed(() => porItem(this.hallazgos()));

  /** Avisos por item, aparte: no son observaciones que bloqueen. */
  protected readonly avisosPorItem = computed(() => porItem(this.avisos()));

  constructor() {
    // Fechas por defecto tomadas antes de conocer la zona de la sede: se corrigen al llegar.
    const fechaFactura = this.factura.controls.fecha;
    const fechaPago = this.pago.controls.fechaPago;
    this.diaDeLaSede.alinear(
      () => fechaFactura.value ?? '',
      (hoy) => fechaFactura.setValue(hoy),
    );
    this.diaDeLaSede.alinear(
      () => fechaPago.value ?? '',
      (hoy) => fechaPago.setValue(hoy),
    );

    effect(() => {
      this.presentacionId();
      this.tenantContext.contextEpoch();
      untracked(() => {
        // Un lote de otra organizacion en pantalla es una fuga de tenant.
        this.lote.set(null);
        this.validacion.set(null);
        this.filtroDeItem.set('');
        this.errorOperacion.set(null);
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
      'Prestación agregada al lote',
    );
  }

  protected quitar(item: PresentacionItem): void {
    if (item.id === undefined) return;
    const itemId = item.id;
    this.operar(
      `quitar-${itemId}`,
      (c, p) => this.api.quitarItem(c, p, itemId),
      'Prestación quitada del lote',
      'Vuelve a estar disponible.',
    );
  }

  protected revisar(): void {
    const ids = this.ids();
    if (ids === null) return;
    this.api.validar(ids.consultorioId, ids.presentacionId).subscribe({
      next: (resultado) => this.validacion.set(resultado),
      // Boton sin formulario: aviso global con la salida.
      error: (error: unknown) =>
        this.notificaciones.error('No pudimos revisar el lote', {
          descripcion: traducirErrorPresentacion(error).mensaje,
          accion: { etiqueta: 'Reintentar', ejecutar: () => this.revisar() },
        }),
    });
  }

  protected confirmar(): void {
    this.operar(
      'confirmar',
      (c, p) => this.api.confirmar(c, p),
      'Lote presentado',
      'Tiene número y su total quedo congelado. Todavía no se cobro nada.',
    );
  }

  protected abrirAnulacion(): void {
    this.cerrarPaneles();
    this.errorOperacion.set(null);
    this.anulando.set(true);
  }

  protected anular(motivo: string): void {
    this.operar(
      'anular',
      (c, p) => this.api.anular(c, p, motivo),
      'Borrador descartado',
      'Sus prestaciones vuelven a estar disponibles.',
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
      'Factura registrada',
    );
  }

  protected abrirDebito(item: PresentacionItem): void {
    this.cerrarPaneles();
    this.errorOperacion.set(null);
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
      'Debito registrado',
      'Si fue por el total, la prestación sale del lote y su deuda sigue pendiente; si fue ' +
        'parcial, sigue en el lote y al cerrarlo se salda lo no debitado.',
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
      'Pago registrado',
      'Las deudas se saldan recien al cerrar el lote.',
      () => {
        this.claveDePago = nuevaClaveDeIntento();
        this.pago.reset({
          importe: 0,
          medio: RegistrarPagoDeFinanciadorMedioEnum.TRANSFERENCIA,
          fechaPago: this.diaDeLaSede.hoy(),
          referencia: '',
        });
      },
    );
  }

  protected conciliar(): void {
    this.operar(
      'conciliar',
      (c, p) => this.api.conciliar(c, p),
      'Lote cerrado',
      'Cada prestación aceptada salda su deuda por lo presentado; las debitadas en parte, por lo ' +
        'presentado menos lo debitado, que queda pendiente para otro lote.',
    );
  }

  // ----------------------------------------------------------------------------------
  // Exportar — listados exportables (AKINE-07.04)
  // ----------------------------------------------------------------------------------

  /**
   * Descarga el lote como CSV. Es la misma vista que la pantalla, serializada por el backend: no
   * se arma aca con lo que hay en memoria, que podria estar viejo.
   *
   * <p>El nombre sale de `Content-Disposition`; si no vino, se arma con el numero del lote o, en
   * borrador, con su id.
   */
  protected exportarCsv(): void {
    const ids = this.ids();
    if (ids === null || this.exportando()) return;
    const lote = this.lote();
    const respaldo = `presentacion-${lote?.numero ?? ids.presentacionId}.csv`;
    this.exportando.set(true);
    this.api.exportar(ids.consultorioId, ids.presentacionId).subscribe({
      next: (respuesta) => {
        this.exportando.set(false);
        guardarComoArchivo(
          new Blob([respuesta.body ?? ''], { type: 'text/csv;charset=utf-8' }),
          nombreDelEncabezado(respuesta.headers.get('Content-Disposition')) ?? respaldo,
        );
      },
      error: (error: unknown) => {
        this.exportando.set(false);
        this.notificaciones.error('No pudimos exportar el CSV', {
          descripcion: traducirErrorPresentacion(error).mensaje,
          accion: { etiqueta: 'Reintentar', ejecutar: () => this.exportarCsv() },
        });
      },
    });
  }

  protected cerrarPaneles(): void {
    this.anulando.set(false);
    this.itemDebitando.set(null);
  }

  protected importe(valor: number | undefined): string {
    return importeEnPalabras(valor, this.lote()?.moneda);
  }

  /**
   * Una deuda del financiador `PARCIAL` en la bandeja es lo que quedo de un debito parcial ya
   * conciliado (DP-37): vuelve por el saldo, no por el total de la prestacion.
   */
  protected esSaldoDeDebitoParcial(obligacion: Obligacion): boolean {
    return obligacion.estado === ObligacionEstadoEnum.PARCIAL;
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
    titulo: string,
    descripcion?: string,
    alTerminar?: () => void,
  ): void {
    const ids = this.ids();
    if (ids === null || this.operando() !== null) return;
    this.operando.set(clave);
    this.errorOperacion.set(null);

    llamada(ids.consultorioId, ids.presentacionId).subscribe({
      next: () => {
        this.operando.set(null);
        this.cerrarPaneles();
        alTerminar?.();
        this.notificaciones.exito(titulo, descripcion === undefined ? undefined : { descripcion });
        this.cargar();
      },
      error: (error: unknown) => {
        this.operando.set(null);
        const traducido = traducirErrorPresentacion(error);
        if (clave.startsWith('agregar-') || clave.startsWith('quitar-')) {
          // Boton de fila, sin formulario: aviso global, con Reintentar.
          this.notificaciones.error(
            clave.startsWith('agregar-')
              ? 'No pudimos agregar la prestación'
              : 'No pudimos quitar la prestación',
            {
              descripcion: traducido.mensaje,
              accion: {
                etiqueta: 'Reintentar',
                ejecutar: () => this.operar(clave, llamada, titulo, descripcion, alTerminar),
              },
            },
          );
          return;
        }
        this.errorOperacion.set({ ...traducido, clave });
        if (traducido.causa === 'con-hallazgos') {
          this.revisar();
        }
      },
    });
  }

  /** El rechazo de la operacion `en` (o de cualquier `en-<id>`), si fue la ultima en fallar. */
  protected falloEn(en: string): ErrorPresentacion | null {
    const fallo = this.errorOperacion();
    return fallo !== null && (fallo.clave === en || fallo.clave.startsWith(`${en}-`))
      ? fallo
      : null;
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

  protected filtrarItems(valor: string): void {
    this.filtroDeItem.set(valor);
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

function porItem(reparos: readonly ReparoDePresentacion[]): Map<number, string[]> {
  const mapa = new Map<number, string[]>();
  for (const reparo of reparos) {
    if (reparo.itemId === undefined) continue;
    const lista = mapa.get(reparo.itemId) ?? [];
    lista.push(hallazgoEnPalabras(reparo.hallazgo));
    mapa.set(reparo.itemId, lista);
  }
  return mapa;
}
