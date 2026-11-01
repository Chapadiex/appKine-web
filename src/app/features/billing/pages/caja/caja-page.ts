import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { forkJoin, of, switchMap } from 'rxjs';

import { CajaApi } from '../../services/caja-api';
import { JornadaCaja } from '../../../../api/generated/model/jornada-caja';
import {
  MovimientoDeCaja,
  MovimientoDeCajaTipoOrigenEnum,
} from '../../../../api/generated/model/movimiento-de-caja';
import {
  RegistrarMovimientoDeCajaMedioEnum,
  RegistrarMovimientoDeCajaTipoEnum,
} from '../../../../api/generated/model/registrar-movimiento-de-caja';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { ErrorCaja, traducirErrorCaja } from '../../models/caja-errors';
import { aCentavos, centavosDeTexto, deCentavos } from '../../models/dinero';
import { restaDelSaldo, tipoDeMovimientoEnPalabras } from '../../models/etiquetas-de-caja';
import {
  MEDIOS_DE_COBRO,
  instanteEnPalabras,
  medioEnPalabras,
} from '../../models/etiquetas-de-cobro';
import { fechaEnPalabras, importeEnPalabras } from '../../models/etiquetas-de-obligacion';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { Icono } from '../../../../shared/components/icono/icono';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

import { Alerta } from '../../../../shared/components/alerta/alerta';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import { PieDeTabla } from '../../../../shared/components/tabla/pie-de-tabla';
import { tablaLocal } from '../../../../shared/components/tabla/tabla-local';
import { AvisosStore } from '../../../../core/services/avisos.store';

/** Seccion de la pantalla donde se hizo una operacion: su rechazo se muestra ahi. */
type OperacionDeCaja = 'abrir' | 'movimiento' | 'reversion' | 'cierre';

type FalloDeCaja = ErrorCaja & { readonly en: OperacionDeCaja };

/** Lo que se abre a pedido desde la cabecera (UX-15). La reversion lleva su propio estado. */
type PanelDeCaja = 'movimiento' | 'arqueo' | 'medios';

type EstadoCaja =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'cerrada' }
  | {
      readonly tipo: 'abierta';
      readonly jornada: JornadaCaja;
      readonly movimientos: readonly MovimientoDeCaja[];
    }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly faltaContexto: boolean };

/** El listado de movimientos usa el tamano de pagina por defecto del contrato. */
const PAGINA_DE_MOVIMIENTOS = 50;

/**
 * Caja diaria de la sede del contexto (M20, AKINE-07.03).
 *
 * <p>Una sola pantalla para el turno de caja entero: ver si esta abierta, abrirla, cargar
 * movimientos manuales, revertirlos y arquear. Son pasos de una misma persona parada frente al
 * mismo cajon, y partirlos en rutas obligaria a navegar en medio de un conteo.
 * Mide lo que la ventana (UX-15): la banda y los movimientos a la vista; cargar, arquear y el
 * detalle en paneles a pedido.
 *
 * <h2>Lo que la pantalla NO calcula</h2>
 *
 * <p><b>El saldo teorico lo da el servidor</b> y es solo efectivo: tarjetas y transferencias nunca
 * estuvieron en el cajon. La pantalla no suma movimientos para obtenerlo —sumaria tambien lo que no
 * es efectivo, o lo que entro desde otra computadora sin releer—. La unica cuenta local es la
 * diferencia que se esta por declarar (contado − teorico), en centavos enteros, y es solo un
 * aviso: <b>la diferencia que vale es la que calcula el servidor al cerrar</b>.
 *
 * <h2>Revertir: solo movimientos manuales</h2>
 *
 * <p>El contrato permite revertir cualquier movimiento que no sea ya una reversion, pero el de un
 * cobro se deshace anulando el cobro (M19): revertirlo aca dejaria el comprobante vigente y la
 * plata afuera. Por eso el boton solo se ofrece en movimientos de origen `MANUAL`. El backend
 * decide igual; esto es UX.
 *
 * <h2>Cambio de contexto</h2>
 *
 * <p>Al cambiar de sede se descarta todo —jornada, formularios, cierre mostrado, claves— y se
 * relee: la caja de la sede A no puede quedar en pantalla bajo la sede B.
 */
@Component({
  selector: 'app-caja-page',
  imports: [
    CabeceraDePagina,
    Ayuda,
    Icono,
    RouterLink,
    PanelLateral,
    Alerta,
    NgTemplateOutlet,
    EstadoVacio,
    ColumnaOrdenable,
    PieDeTabla,
  ],
  templateUrl: './caja-page.html',
  styleUrls: ['../../billing.css', '../../economia.css', './caja-page.css'],
})
export class CajaPage {
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly api = inject(CajaApi);
  private readonly avisos = inject(AvisosStore);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly medioEnPalabras = medioEnPalabras;
  protected readonly tipoEnPalabras = tipoDeMovimientoEnPalabras;
  protected readonly instanteEnPalabras = (valor: string | undefined): string =>
    instanteEnPalabras(valor, this.diaDeLaSede.zona());
  protected readonly fechaEnPalabras = (valor: string | undefined): string =>
    fechaEnPalabras(valor, this.diaDeLaSede.zona());
  protected readonly mediosDisponibles = MEDIOS_DE_COBRO;
  protected readonly tipoIngreso = RegistrarMovimientoDeCajaTipoEnum.INGRESO;
  protected readonly tipoEgreso = RegistrarMovimientoDeCajaTipoEnum.EGRESO;

  protected readonly estado = signal<EstadoCaja>({ tipo: 'cargando' });
  /** El arqueo recien registrado, para que el operador vea la diferencia que quedo asentada. */
  protected readonly cierre = signal<JornadaCaja | null>(null);
  /** El rechazo de la ultima operacion y en que seccion se hizo: se muestra ahi (UX-12). */
  protected readonly error = signal<FalloDeCaja | null>(null);
  protected readonly enviando = signal(false);
  protected readonly panel = signal<PanelDeCaja | null>(null);
  /** Relectura con la caja a la vista: la pantalla no se desmonta, solo lo dice el boton. */
  protected readonly actualizando = signal(false);

  // Apertura
  protected readonly moneda = signal('ARS');
  protected readonly saldoInicial = signal('');

  // Movimiento manual
  protected readonly tipoMovimiento = signal<RegistrarMovimientoDeCajaTipoEnum>(
    RegistrarMovimientoDeCajaTipoEnum.INGRESO,
  );
  protected readonly medioMovimiento = signal<RegistrarMovimientoDeCajaMedioEnum>(
    RegistrarMovimientoDeCajaMedioEnum.EFECTIVO,
  );
  protected readonly importeMovimiento = signal('');
  protected readonly conceptoMovimiento = signal('');
  private claveDeMovimiento = '';

  // Reversion
  protected readonly revirtiendo = signal<number | null>(null);
  protected readonly motivoReversion = signal('');

  /**
   * El movimiento que se esta revirtiendo. El panel lateral vive fuera de la tabla (refactor UX/UI
   * del 28/10/2026), asi que lo busca en la lista en vez de recibirlo del `@for` de la fila.
   */
  protected readonly movimientoEnPanel = computed(() => {
    const id = this.revirtiendo();
    return id === null ? null : (this.movimientos().find((m) => m.id === id) ?? null);
  });

  // Arqueo
  protected readonly saldoDeclarado = signal('');
  protected readonly motivoDiferencia = signal('');

  /** Descarta respuestas de una carga anterior (otra sede, o un "Actualizar" encima de otro). */
  private generacion = 0;

  protected readonly cargando = computed(() => this.estado().tipo === 'cargando');
  protected readonly cerrada = computed(() => this.estado().tipo === 'cerrada');

  protected readonly jornada = computed<JornadaCaja | null>(() => {
    const actual = this.estado();
    return actual.tipo === 'abierta' ? actual.jornada : null;
  });

  protected readonly movimientos = computed<readonly MovimientoDeCaja[]>(() => {
    const actual = this.estado();
    return actual.tipo === 'abierta' ? actual.movimientos : [];
  });

  /** Movimientos de la jornada: tabla interna con orden y pie (UX-14). Llega completa (hasta 50). */
  protected readonly tabla = tablaLocal(this.movimientos, {
    columnas: {
      hora: (movimiento) => movimiento.registradoEn,
      tipo: (movimiento) => tipoDeMovimientoEnPalabras(movimiento.tipo),
      medio: (movimiento) => medioEnPalabras(movimiento.medio),
      concepto: (movimiento) => movimiento.concepto,
      importe: (movimiento) =>
        restaDelSaldo(movimiento.tipo) ? -(movimiento.importe ?? 0) : movimiento.importe,
    },
  });

  protected readonly listadoRecortado = computed(
    () => this.movimientos().length >= PAGINA_DE_MOVIMIENTOS,
  );

  protected readonly mensajeDeCarga = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  protected readonly faltaContexto = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' && actual.faltaContexto;
  });

  /** Ids de movimientos que ya tienen su reversion en el listado. */
  private readonly revertidos = computed(
    () =>
      new Set(
        this.movimientos()
          .map((m) => m.movimientoOrigenId)
          .filter((id): id is number => id !== undefined && id !== null),
      ),
  );

  protected readonly saldoInicialValido = computed(
    () => centavosDeTexto(this.saldoInicial()) !== null,
  );

  protected readonly movimientoValido = computed(() => {
    const centavos = centavosDeTexto(this.importeMovimiento());
    return centavos !== null && centavos > 0 && this.conceptoMovimiento().trim() !== '';
  });

  /** contado − teorico, en centavos. `null` mientras no haya un numero tipeado. */
  protected readonly diferenciaCentavos = computed<number | null>(() => {
    const declarado = centavosDeTexto(this.saldoDeclarado());
    const teorico = aCentavos(this.jornada()?.saldoTeorico);
    return declarado === null || teorico === null ? null : declarado - teorico;
  });

  protected readonly requiereMotivo = computed(() => {
    const diferencia = this.diferenciaCentavos();
    return diferencia !== null && diferencia !== 0;
  });

  protected readonly arqueoValido = computed(
    () =>
      this.diferenciaCentavos() !== null &&
      (!this.requiereMotivo() || this.motivoDiferencia().trim() !== ''),
  );

  constructor() {
    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.cierre.set(null);
        this.limpiarFormularios();
        this.cargar();
      });
    });
  }

  // -------------------------------------------------------------------------------------
  // Carga
  // -------------------------------------------------------------------------------------

  /**
   * Relee sin desmontar la pantalla: sin parpadeo, con los paneles abiertos y el foco en su lugar.
   * Cambiar de sede no pasa por aca: ahi {@link cargar} descarta lo que se estaba mostrando.
   */
  protected recargar(): void {
    this.cargar(true);
  }

  protected cargar(conservarPantalla = false): void {
    const consultorioId = this.tenantContext.consultorioId();
    const generacion = ++this.generacion;
    this.error.set(null);

    if (consultorioId === null) {
      this.estado.set({
        tipo: 'error',
        mensaje:
          'Para operar la caja hay que saber en que sede estas: cada consultorio tiene su cajon. ' +
          'Eligi una organización y un consultorio, y volvé a entrar. Tu sesión sigue abierta.',
        faltaContexto: true,
      });
      return;
    }

    if (conservarPantalla && this.estado().tipo === 'abierta') {
      this.actualizando.set(true);
    } else {
      this.estado.set({ tipo: 'cargando' });
    }
    this.api
      .jornadaAbierta(consultorioId)
      .pipe(
        switchMap((abiertas) => {
          const id = abiertas[0]?.id;
          if (id === undefined) {
            return of(null);
          }
          return forkJoin({
            jornada: this.api.verJornada(consultorioId, id),
            movimientos: this.api.movimientos(consultorioId, id),
          });
        }),
      )
      .subscribe({
        next: (resultado) => {
          if (generacion !== this.generacion) {
            return;
          }
          this.actualizando.set(false);
          this.estado.set(
            resultado === null
              ? { tipo: 'cerrada' }
              : { tipo: 'abierta', jornada: resultado.jornada, movimientos: resultado.movimientos },
          );
        },
        error: (error: unknown) => {
          if (generacion !== this.generacion) {
            return;
          }
          this.actualizando.set(false);
          const traducido = traducirErrorCaja(error);
          this.estado.set({
            tipo: 'error',
            mensaje: traducido.mensaje,
            faltaContexto: traducido.accion === 'elegir-contexto',
          });
        },
      });
  }

  // -------------------------------------------------------------------------------------
  // Apertura
  // -------------------------------------------------------------------------------------

  protected abrir(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const centavos = centavosDeTexto(this.saldoInicial());
    const moneda = this.moneda().trim().toUpperCase();
    if (consultorioId === null || centavos === null || moneda === '' || this.enviando()) {
      return;
    }

    this.iniciarEnvio();
    this.api.abrir(consultorioId, moneda, deCentavos(centavos)).subscribe({
      next: () => {
        this.enviando.set(false);
        this.cierre.set(null);
        this.saldoInicial.set('');
        this.avisos.exito('Caja abierta', {
          descripcion: `Saldo inicial: ${importeEnPalabras(deCentavos(centavos), moneda)}`,
        });
        this.cargar();
      },
      error: (error: unknown) => this.fallar(error, 'abrir'),
    });
  }

  // -------------------------------------------------------------------------------------
  // Movimiento manual
  // -------------------------------------------------------------------------------------

  protected cambiarTipo(valor: string): void {
    this.tipoMovimiento.set(valor as RegistrarMovimientoDeCajaTipoEnum);
    this.claveDeMovimiento = '';
  }

  protected cambiarMedio(valor: string): void {
    this.medioMovimiento.set(valor as RegistrarMovimientoDeCajaMedioEnum);
    this.claveDeMovimiento = '';
  }

  protected cambiarImporte(valor: string): void {
    this.importeMovimiento.set(valor);
    this.claveDeMovimiento = '';
  }

  protected cambiarConcepto(valor: string): void {
    this.conceptoMovimiento.set(valor);
    this.claveDeMovimiento = '';
  }

  protected registrarMovimiento(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const centavos = centavosDeTexto(this.importeMovimiento());
    if (
      consultorioId === null ||
      centavos === null ||
      !this.movimientoValido() ||
      this.enviando()
    ) {
      return;
    }

    const concepto = this.conceptoMovimiento().trim();
    this.iniciarEnvio();
    this.api
      .registrarMovimiento(consultorioId, {
        tipo: this.tipoMovimiento(),
        medio: this.medioMovimiento(),
        importe: deCentavos(centavos),
        concepto,
        idempotencyKey: this.clave(),
      })
      .subscribe({
        next: () => {
          this.enviando.set(false);
          this.importeMovimiento.set('');
          this.conceptoMovimiento.set('');
          this.claveDeMovimiento = '';
          this.panel.set(null);
          this.avisos.exito('Movimiento registrado', {
            descripcion: `${concepto} · ${importeEnPalabras(deCentavos(centavos), this.jornada()?.moneda)}`,
          });
          this.recargar();
        },
        error: (error: unknown) => {
          // Reintentar el MISMO contenido reusa la clave; un conflicto de clave pide una nueva.
          if (traducirErrorCaja(error).renovarClave === true) {
            this.claveDeMovimiento = '';
          }
          this.fallar(error, 'movimiento');
        },
      });
  }

  // -------------------------------------------------------------------------------------
  // Reversion
  // -------------------------------------------------------------------------------------

  protected sePuedeRevertir(movimiento: MovimientoDeCaja): boolean {
    return (
      movimiento.id !== undefined &&
      movimiento.tipoOrigen === MovimientoDeCajaTipoOrigenEnum.MANUAL &&
      !this.revertidos().has(movimiento.id)
    );
  }

  protected yaRevertido(movimiento: MovimientoDeCaja): boolean {
    return movimiento.id !== undefined && this.revertidos().has(movimiento.id);
  }

  /**
   * Abre el panel de reversion bajo la fila.
   *
   * <p>El boton "Revertir" desaparece al abrirse el panel, asi que el foco se lleva al motivo: si
   * no, cae al `body` y quien usa teclado vuelve al principio del documento (WCAG 2.4.3).
   */
  protected pedirReversion(movimiento: MovimientoDeCaja): void {
    this.revirtiendo.set(movimiento.id ?? null);
    this.motivoReversion.set('');
    this.error.set(null);
    this.enfocarDespues(`#motivo-reversion-${movimiento.id}`);
  }

  /** Cierra el panel y devuelve el foco al "Revertir" que lo abrio. */
  protected cancelarReversion(): void {
    const movimientoId = this.revirtiendo();
    this.revirtiendo.set(null);
    this.motivoReversion.set('');
    if (movimientoId !== null) {
      this.enfocarDespues(`#revertir-${movimientoId}`);
    }
  }

  private enfocarDespues(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }

  protected confirmarReversion(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const movimientoId = this.revirtiendo();
    const motivo = this.motivoReversion().trim();
    if (consultorioId === null || movimientoId === null || motivo === '' || this.enviando()) {
      return;
    }

    this.iniciarEnvio();
    this.api.revertir(consultorioId, movimientoId, motivo).subscribe({
      next: () => {
        this.enviando.set(false);
        this.cancelarReversion();
        this.avisos.exito('Movimiento revertido', {
          descripcion: 'El original queda en el listado, compensado.',
        });
        this.recargar();
      },
      error: (error: unknown) => this.fallar(error, 'reversion'),
    });
  }

  // -------------------------------------------------------------------------------------
  // Arqueo y cierre
  // -------------------------------------------------------------------------------------

  protected cerrar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const jornada = this.jornada();
    const declarado = centavosDeTexto(this.saldoDeclarado());
    const teorico = jornada?.saldoTeorico;
    if (
      consultorioId === null ||
      jornada?.id === undefined ||
      declarado === null ||
      teorico === undefined ||
      !this.arqueoValido() ||
      this.enviando()
    ) {
      return;
    }

    this.iniciarEnvio();
    this.api
      .cerrar(
        consultorioId,
        jornada.id,
        deCentavos(declarado),
        teorico,
        this.requiereMotivo() ? this.motivoDiferencia().trim() : undefined,
      )
      .subscribe({
        next: (cerrada) => {
          this.enviando.set(false);
          this.limpiarFormularios();
          this.cierre.set(cerrada);
          this.avisos.exito('Caja cerrada', { descripcion: 'El arqueo quedó registrado.' });
          this.estado.set({ tipo: 'cerrada' });
        },
        error: (error: unknown) => this.fallar(error, 'cierre'),
      });
  }

  // -------------------------------------------------------------------------------------
  // Presentacion
  // -------------------------------------------------------------------------------------

  protected importe(valor: number | undefined, moneda?: string): string {
    return importeEnPalabras(valor, moneda ?? this.jornada()?.moneda);
  }

  protected importeConSigno(movimiento: MovimientoDeCaja): string {
    const texto = importeEnPalabras(movimiento.importe, movimiento.moneda);
    return restaDelSaldo(movimiento.tipo) ? `− ${texto}` : `+ ${texto}`;
  }

  /**
   * La hora sola si fue el dia de la jornada; si no, con la fecha: una jornada puede seguir abierta
   * al dia siguiente, y una hora suelta ahi mentiria.
   */
  protected horaDeLaJornada(instante: string | undefined): string {
    const texto = this.instanteEnPalabras(instante);
    const prefijo = `${this.fechaEnPalabras(this.jornada()?.fechaNegocio)}, `;
    return texto.startsWith(prefijo) ? texto.slice(prefijo.length) : texto;
  }

  protected diferenciaEnPalabras(): string {
    const diferencia = this.diferenciaCentavos();
    return diferencia === null
      ? ''
      : this.faltanteOSobrante(deCentavos(diferencia), this.jornada()?.moneda);
  }

  protected diferenciaDelCierre(jornada: JornadaCaja): string {
    const diferencia = jornada.diferencia ?? 0;
    if (diferencia === 0) {
      return 'Sin diferencia: el arqueo cuadro.';
    }
    return this.faltanteOSobrante(diferencia, jornada.moneda);
  }

  private faltanteOSobrante(diferencia: number, moneda: string | undefined): string {
    const texto = importeEnPalabras(Math.abs(diferencia), moneda);
    return diferencia > 0 ? `Sobrante de ${texto}` : `Faltante de ${texto}`;
  }

  // -------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------

  protected abrirPanel(cual: PanelDeCaja): void {
    this.error.set(null);
    this.panel.set(cual);
  }

  /** Lo tipeado queda: quien cerro el panel para mirar la tabla no tiene que volver a contar. */
  protected cerrarPanel(): void {
    this.error.set(null);
    this.panel.set(null);
  }

  private iniciarEnvio(): void {
    this.enviando.set(true);
    this.error.set(null);
  }

  private fallar(error: unknown, en: OperacionDeCaja): void {
    this.enviando.set(false);
    this.error.set({ ...traducirErrorCaja(error), en });
  }

  /** El rechazo de la operacion `en`, si fue la ultima en fallar. */
  protected falloEn(en: OperacionDeCaja): ErrorCaja | null {
    const fallo = this.error();
    return fallo?.en === en ? fallo : null;
  }

  private limpiarFormularios(): void {
    this.error.set(null);
    this.panel.set(null);
    this.saldoInicial.set('');
    this.importeMovimiento.set('');
    this.conceptoMovimiento.set('');
    this.claveDeMovimiento = '';
    this.revirtiendo.set(null);
    this.motivoReversion.set('');
    this.saldoDeclarado.set('');
    this.motivoDiferencia.set('');
  }

  /** `crypto.randomUUID` no existe en contextos inseguros: mismo respaldo que el cobro. */
  private clave(): string {
    if (this.claveDeMovimiento === '') {
      this.claveDeMovimiento =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `akine-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    return this.claveDeMovimiento;
  }
}
