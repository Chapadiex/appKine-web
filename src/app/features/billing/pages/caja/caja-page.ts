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
  imports: [RouterLink],
  templateUrl: './caja-page.html',
  styleUrl: '../../billing.css',
})
export class CajaPage {
  private readonly api = inject(CajaApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly medioEnPalabras = medioEnPalabras;
  protected readonly tipoEnPalabras = tipoDeMovimientoEnPalabras;
  protected readonly instanteEnPalabras = instanteEnPalabras;
  protected readonly fechaEnPalabras = fechaEnPalabras;
  protected readonly mediosDisponibles = MEDIOS_DE_COBRO;
  protected readonly tiposManuales = [
    RegistrarMovimientoDeCajaTipoEnum.INGRESO,
    RegistrarMovimientoDeCajaTipoEnum.EGRESO,
  ] as const;

  protected readonly estado = signal<EstadoCaja>({ tipo: 'cargando' });
  /** El arqueo recien registrado, para que el operador vea la diferencia que quedo asentada. */
  protected readonly cierre = signal<JornadaCaja | null>(null);
  protected readonly error = signal<ErrorCaja | null>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly enviando = signal(false);

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

  protected cargar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const generacion = ++this.generacion;
    this.error.set(null);

    if (consultorioId === null) {
      this.estado.set({
        tipo: 'error',
        mensaje:
          'Para operar la caja hay que saber en que sede estas: cada consultorio tiene su cajon. ' +
          'Eligi una organizacion y un consultorio, y volve a entrar. Tu sesion sigue abierta.',
        faltaContexto: true,
      });
      return;
    }

    this.estado.set({ tipo: 'cargando' });
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
        this.aviso.set('Caja abierta.');
        this.cargar();
      },
      error: (error: unknown) => this.fallar(error),
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

    this.iniciarEnvio();
    this.api
      .registrarMovimiento(consultorioId, {
        tipo: this.tipoMovimiento(),
        medio: this.medioMovimiento(),
        importe: deCentavos(centavos),
        concepto: this.conceptoMovimiento().trim(),
        idempotencyKey: this.clave(),
      })
      .subscribe({
        next: () => {
          this.enviando.set(false);
          this.importeMovimiento.set('');
          this.conceptoMovimiento.set('');
          this.claveDeMovimiento = '';
          this.aviso.set('Movimiento registrado.');
          this.cargar();
        },
        error: (error: unknown) => {
          // Reintentar el MISMO contenido reusa la clave; un conflicto de clave pide una nueva.
          if (traducirErrorCaja(error).renovarClave === true) {
            this.claveDeMovimiento = '';
          }
          this.fallar(error);
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
        this.aviso.set('Movimiento revertido. El original queda en el listado, compensado.');
        this.cargar();
      },
      error: (error: unknown) => this.fallar(error),
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
          this.aviso.set('Caja cerrada. El arqueo quedo registrado.');
          this.estado.set({ tipo: 'cerrada' });
        },
        error: (error: unknown) => this.fallar(error),
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

  protected diferenciaEnPalabras(): string {
    const diferencia = this.diferenciaCentavos();
    return diferencia === null ? '' : this.importe(deCentavos(diferencia));
  }

  protected diferenciaDelCierre(jornada: JornadaCaja): string {
    const diferencia = jornada.diferencia ?? 0;
    if (diferencia === 0) {
      return 'Sin diferencia: el arqueo cuadro.';
    }
    const texto = importeEnPalabras(Math.abs(diferencia), jornada.moneda);
    return diferencia > 0 ? `Sobrante de ${texto}` : `Faltante de ${texto}`;
  }

  // -------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------

  private iniciarEnvio(): void {
    this.enviando.set(true);
    this.error.set(null);
    this.aviso.set(null);
  }

  private fallar(error: unknown): void {
    this.enviando.set(false);
    this.error.set(traducirErrorCaja(error));
  }

  private limpiarFormularios(): void {
    this.error.set(null);
    this.aviso.set(null);
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
