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
import { RouterLink } from '@angular/router';

import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { PERMISO_CAJA_OPERATE, PERMISO_COBRO_REGISTER } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { ReintegrarSaldoAFavorMedioEnum } from '../../../../api/generated/model/reintegrar-saldo-a-favor';
import { centavosDeTexto, deCentavos } from '../../models/dinero';
import {
  MEDIOS_DE_REINTEGRO,
  motivoParaNoAnular,
  motivoParaNoReintegrar,
  nuevaClaveDeIntento,
  saldoAFavorEnCentavos,
} from '../../models/operaciones-de-cobro';

import { BillingApi } from '../../services/billing-api';
import { Cobro } from '../../../../api/generated/model/cobro';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { ErrorCobro, OperacionDeCobro, traducirErrorCobro } from '../../models/cobro-errors';
import { instanteEnPalabras, medioEnPalabras } from '../../models/etiquetas-de-cobro';
import { importeEnPalabras } from '../../models/etiquetas-de-obligacion';

/** En cual de los tres estados esta el listado. No es paginado: el backend devuelve un array. */
type EstadoCobros =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly cobros: readonly Cobro[] }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly faltaContexto: boolean };

/** Que operacion posterior esta abierta y sobre que cobro (F-3). */
interface OperacionAbierta {
  readonly tipo: 'anular' | 'reintegrar';
  readonly cobro: Cobro;
}

/**
 * Cobros registrados de un paciente, y la reimpresion de su comprobante (M19, AKINE-07.02).
 *
 * <p>Es la otra mitad de la cuenta corriente: `/pacientes/:personaId/cuenta-corriente` muestra lo
 * que se debe y esta muestra lo que se cobro. <b>Son dos listas y no una sola fusionada</b>, y eso
 * es deliberado: una deuda y un cobro no son el mismo hecho, y mezclarlos en un renglon por fecha
 * es como se termina leyendo un cobro como si fuera una deuda negativa.
 *
 * <h2>Por que hay un detalle si el listado ya trae todo</h2>
 *
 * <p>`GET /cobros/{cobroId}` no agrega campos: agrega <b>frescura</b>. Es la reimpresion, y el
 * requisito de la etapa es literal —"comprobante recuperable sin crear un cobro nuevo"—. Sin ella,
 * un operador que necesita el comprobante otra vez tendria como unica salida volver a registrar el
 * cobro, que es exactamente lo que la clave de idempotencia trata de evitar. Se relee al abrirlo
 * para no reimprimir lo que se cargo en memoria hace veinte minutos.
 *
 * <h2>Aca tampoco se suma plata</h2>
 *
 * <p>No hay un total de lo cobrado. El backend no lo devuelve, y sumar veinte importes en punto
 * flotante produce centavos que no cuadran contra la base: un total inventado en una pantalla de
 * dinero es el numero que despues alguien le dice a un paciente. Lo unico que se hace con un
 * importe es formatearlo.
 *
 * <h2>Anular y reintegrar (F-3)</h2>
 *
 * <p>Las dos mueven la caja del lado del servidor, y por eso los botones van detras de
 * `cobro:register` <b>y</b> `caja:operate`. Cuando no corresponden a un cobro —ya anulado, con
 * reintegros, sin saldo a favor— se deshabilitan con la explicacion al lado. Lo reintegrado no viene
 * en el contrato: se despeja de su invariante en centavos (`operaciones-de-cobro.ts`). Despues de
 * cada operacion se relee el listado.
 */
@Component({
  selector: 'app-cobros-page',
  imports: [RouterLink, ConfirmacionConMotivo, PermisoDirective],
  templateUrl: './cobros-page.html',
  styleUrl: '../../billing.css',
})
export class CobrosPage {
  private readonly api = inject(BillingApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** De la ruta padre. `withComponentInputBinding` lo liga solo. */
  readonly personaId = input.required<string>();

  protected readonly medioEnPalabras = medioEnPalabras;
  protected readonly instanteEnPalabras = instanteEnPalabras;

  protected readonly estado = signal<EstadoCobros>({ tipo: 'cargando' });

  /** El comprobante abierto, releido del servidor. `null` cuando no hay ninguno. */
  protected readonly comprobante = signal<Cobro | null>(null);
  protected readonly abriendo = signal<number | null>(null);
  protected readonly errorDetalle = signal<ErrorCobro | null>(null);

  // -------------------------------------------------------------------------------------
  // F-3: anulacion y reintegro. Los dos mueven la caja y piden los dos permisos.
  // -------------------------------------------------------------------------------------

  /** Anular y reintegrar: `*akinePermiso` acepta CUALQUIERA, asi que se anidan las dos. */
  protected readonly PERMISO_COBRO_REGISTER = PERMISO_COBRO_REGISTER;
  protected readonly PERMISO_CAJA_OPERATE = PERMISO_CAJA_OPERATE;
  protected readonly motivoParaNoAnular = motivoParaNoAnular;
  protected readonly motivoParaNoReintegrar = motivoParaNoReintegrar;
  protected readonly mediosDeReintegro = MEDIOS_DE_REINTEGRO;

  /** La operacion abierta, o `null`. Una sola a la vez. */
  protected readonly operacion = signal<OperacionAbierta | null>(null);
  protected readonly enviando = signal(false);
  protected readonly errorOperacion = signal<ErrorCobro | null>(null);
  protected readonly exito = signal<string | null>(null);

  protected readonly importeReintegro = signal('');
  protected readonly medioReintegro = signal<ReintegrarSaldoAFavorMedioEnum>(
    ReintegrarSaldoAFavorMedioEnum.EFECTIVO,
  );
  protected readonly motivoReintegro = signal('');
  protected readonly referenciaReintegro = signal('');
  /** Se intento confirmar: recien ahi se marcan los campos invalidos. */
  protected readonly reintegroIntentado = signal(false);
  /**
   * Clave del intento de reintegro. Se descarta en cada edicion: el backend guarda la huella del
   * pedido, y reusar la clave con otro contenido es 409. Reintentar sin tocar nada la reusa, que
   * es lo que hace que un fallo de red no devuelva dos veces.
   */
  private claveReintegro = '';

  /** Por que el importe del reintegro no sirve, o `null`. Se compara en centavos enteros. */
  protected readonly problemaDelImporte = computed<string | null>(() => {
    const abierta = this.operacion();
    if (abierta === null || abierta.tipo !== 'reintegrar') {
      return null;
    }
    const centavos = centavosDeTexto(this.importeReintegro());
    if (centavos === null || centavos <= 0) {
      return 'Escribi un importe mayor que cero, con hasta dos decimales.';
    }
    if (centavos > saldoAFavorEnCentavos(abierta.cobro)) {
      return `No puede superar el saldo a favor (${this.importe(abierta.cobro, abierta.cobro.saldoAFavor)}).`;
    }
    return null;
  });

  protected readonly faltaMotivo = computed(() => this.motivoReintegro().trim() === '');

  protected readonly esEfectivo = computed(
    () => this.medioReintegro() === ReintegrarSaldoAFavorMedioEnum.EFECTIVO,
  );

  protected readonly rutaCuenta = computed(() => `/pacientes/${this.personaId()}/cuenta-corriente`);
  protected readonly rutaCobrar = computed(() => `${this.rutaCuenta()}/cobrar`);

  protected readonly cargando = computed(() => this.estado().tipo === 'cargando');

  protected readonly cobros = computed<readonly Cobro[]>(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.cobros : [];
  });

  protected readonly mensajeError = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  protected readonly faltaContexto = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' && actual.faltaContexto;
  });

  protected readonly vacia = computed(
    () => this.estado().tipo === 'listo' && this.cobros().length === 0,
  );

  constructor() {
    effect(() => {
      this.personaId();
      this.tenantContext.contextEpoch();
      untracked(() => {
        // Un comprobante de otra organizacion abierto en pantalla es una fuga de tenant.
        this.comprobante.set(null);
        this.errorDetalle.set(null);
        this.cerrarOperacion();
        this.exito.set(null);
        this.cargar();
      });
    });
  }

  protected cargar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const personaId = this.numeroDePersona();
    if (consultorioId === null || personaId === null) {
      this.estado.set({
        tipo: 'error',
        mensaje:
          'Para ver los cobros hay que saber en que sede estas. Eligi una organizacion y un ' +
          'consultorio, y volve a entrar. Tu sesion sigue abierta.',
        faltaContexto: true,
      });
      return;
    }

    this.estado.set({ tipo: 'cargando' });
    this.api.cobrosDeLaPersona(consultorioId, personaId).subscribe({
      next: (cobros) => this.estado.set({ tipo: 'listo', cobros }),
      error: (error: unknown) => {
        const traducido = traducirErrorCobro(error);
        this.estado.set({
          tipo: 'error',
          mensaje: traducido.mensaje,
          faltaContexto: traducido.causa === 'sin-contexto',
        });
      },
    });
  }

  /** Abre el comprobante releyendolo del servidor. Cerrar y volver a abrir vuelve a releer. */
  protected abrir(cobro: Cobro): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null || cobro.id === undefined) {
      return;
    }

    this.comprobante.set(null);
    this.errorDetalle.set(null);
    this.abriendo.set(cobro.id);

    this.api.verCobro(consultorioId, cobro.id).subscribe({
      next: (fresco) => {
        this.abriendo.set(null);
        this.comprobante.set(fresco);
        this.enfocarBotonDelComprobante(cobro.id);
      },
      error: (error: unknown) => {
        this.abriendo.set(null);
        this.errorDetalle.set(traducirErrorCobro(error));
      },
    });
  }

  protected cerrar(): void {
    const abierto = this.comprobante()?.id;
    this.comprobante.set(null);
    this.errorDetalle.set(null);
    this.enfocarBotonDelComprobante(abierto);
  }

  /**
   * "Ver el comprobante" y "Cerrar el comprobante" se reemplazan uno por otro en la misma celda:
   * el que se apreto desaparece y el foco caeria al `body`. Comparten `id`, asi que se enfoca el
   * que quedo (WCAG 2.4.3).
   */
  private enfocarBotonDelComprobante(cobroId: number | undefined): void {
    if (cobroId === undefined) {
      return;
    }
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>(`#comprobante-${cobroId}`)?.focus(),
      { injector: this.injector },
    );
  }

  protected esElAbierto(cobro: Cobro): boolean {
    const abierto = this.comprobante();
    return abierto !== null && cobro.id !== undefined && abierto.id === cobro.id;
  }

  /** Un importe con la moneda del propio cobro, nunca con una constante. */
  protected importe(cobro: Cobro, valor: number | undefined): string {
    return importeEnPalabras(valor, cobro.moneda);
  }

  // -------------------------------------------------------------------------------------
  // Anulacion y reintegro (F-3)
  // -------------------------------------------------------------------------------------

  protected abrirOperacion(tipo: OperacionAbierta['tipo'], cobro: Cobro): void {
    this.cerrarOperacion();
    this.exito.set(null);
    this.operacion.set({ tipo, cobro });
  }

  protected operacionSobre(cobro: Cobro): OperacionAbierta['tipo'] | null {
    const abierta = this.operacion();
    return abierta !== null && cobro.id !== undefined && abierta.cobro.id === cobro.id
      ? abierta.tipo
      : null;
  }

  protected cerrarOperacion(): void {
    this.operacion.set(null);
    this.errorOperacion.set(null);
    this.importeReintegro.set('');
    this.medioReintegro.set(ReintegrarSaldoAFavorMedioEnum.EFECTIVO);
    this.motivoReintegro.set('');
    this.referenciaReintegro.set('');
    this.reintegroIntentado.set(false);
    this.claveReintegro = '';
  }

  /** Cualquier edicion del reintegro es otro intento: la clave anterior se descarta. */
  protected editarReintegro(
    campo: 'importe' | 'medio' | 'motivo' | 'referencia',
    valor: string,
  ): void {
    switch (campo) {
      case 'importe':
        this.importeReintegro.set(valor);
        break;
      case 'medio':
        this.medioReintegro.set(valor as ReintegrarSaldoAFavorMedioEnum);
        break;
      case 'motivo':
        this.motivoReintegro.set(valor);
        break;
      case 'referencia':
        this.referenciaReintegro.set(valor);
        break;
    }
    this.claveReintegro = '';
    this.errorOperacion.set(null);
  }

  protected confirmarAnulacion(motivo: string): void {
    const consultorioId = this.tenantContext.consultorioId();
    const abierta = this.operacion();
    if (consultorioId === null || abierta === null || abierta.cobro.id === undefined) {
      return;
    }
    const cobro = abierta.cobro;
    this.enviar();
    this.api.anularCobro(consultorioId, abierta.cobro.id, motivo).subscribe({
      next: () =>
        this.terminar(
          `Se anulo el comprobante N.º ${cobro.comprobanteNumero}. Sus imputaciones devolvieron ` +
            'saldo a las deudas y sus movimientos de caja se revirtieron. El numero queda usado: ' +
            'no se borra nada.',
        ),
      error: (error: unknown) => this.fallar(error, 'anular'),
    });
  }

  protected confirmarReintegro(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const abierta = this.operacion();
    this.reintegroIntentado.set(true);
    const centavos = centavosDeTexto(this.importeReintegro());
    if (
      consultorioId === null ||
      abierta === null ||
      abierta.cobro.id === undefined ||
      centavos === null ||
      this.problemaDelImporte() !== null ||
      this.faltaMotivo()
    ) {
      return;
    }
    if (this.claveReintegro === '') {
      this.claveReintegro = nuevaClaveDeIntento();
    }
    const referencia = this.referenciaReintegro().trim();
    const cobro = abierta.cobro;

    this.enviar();
    this.api
      .reintegrarSaldoAFavor(consultorioId, abierta.cobro.id, {
        importe: deCentavos(centavos),
        medio: this.medioReintegro(),
        motivo: this.motivoReintegro().trim(),
        ...(referencia === '' ? {} : { referencia }),
        idempotencyKey: this.claveReintegro,
      })
      .subscribe({
        next: (reintegro) =>
          this.terminar(
            `Se devolvieron ${this.importe(cobro, reintegro.importe)} por ` +
              `${medioEnPalabras(reintegro.medio)}. Al cobro le quedan ` +
              `${this.importe(cobro, reintegro.saldoAFavorRestante)} a favor.`,
          ),
        error: (error: unknown) => this.fallar(error, 'reintegrar'),
      });
  }

  private enviar(): void {
    this.enviando.set(true);
    this.errorOperacion.set(null);
    this.exito.set(null);
  }

  /** Cerro bien: se cierra el panel y se RELEE, porque saldo, estado y version cambiaron. */
  private terminar(mensaje: string): void {
    this.enviando.set(false);
    this.cerrarOperacion();
    this.exito.set(mensaje);
    this.cargar();
  }

  private fallar(error: unknown, operacion: OperacionDeCobro): void {
    this.enviando.set(false);
    this.errorOperacion.set(traducirErrorCobro(error, operacion));
  }

  /** Mensaje del rechazo, con el saldo a favor real cuando el servidor lo informa. */
  protected mensajeDelRechazo(): string {
    const problema = this.errorOperacion();
    const abierta = this.operacion();
    if (problema === null) {
      return '';
    }
    if (problema.disponible === null || abierta === null) {
      return problema.mensaje;
    }
    return `${problema.mensaje} Saldo a favor real: ${this.importe(abierta.cobro, problema.disponible)}.`;
  }

  /** Recarga despues de un rechazo que dejo la pantalla vieja. */
  protected recargarTrasRechazo(): void {
    this.cerrarOperacion();
    this.cargar();
  }

  private numeroDePersona(): number | null {
    const id = Number(this.personaId());
    return Number.isFinite(id) && id > 0 ? id : null;
  }
}
