import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, concat, of, tap } from 'rxjs';

import { BillingApi } from '../../services/billing-api';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { Cobro } from '../../../../api/generated/model/cobro';
import { Obligacion } from '../../../../api/generated/model/obligacion';
import { ErrorCobro, traducirErrorCobro } from '../../models/cobro-errors';
import { aCentavos, centavosDeTexto, deCentavos, sumaDeCentavos } from '../../models/dinero';
import { instanteEnPalabras } from '../../models/etiquetas-de-cobro';
import {
  deudasImputables,
  estaAnulado,
  nuevaClaveDeIntento,
  saldoAFavorEnCentavos,
} from '../../models/operaciones-de-cobro';
import { PERMISO_COBRO_REGISTER } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { PersonaResponse } from '../../../../api/generated/model/persona-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import {
  CausaObligacion,
  ErrorObligacion,
  hayQueRecargar,
  traducirErrorObligacion,
} from '../../models/obligacion-errors';
import {
  claseDeEstado,
  estadoEnPalabras,
  fechaEnPalabras,
  importeEnPalabras,
  sePuedeAnular,
} from '../../models/etiquetas-de-obligacion';

/** En cual de los tres estados esta el listado. No es paginado: el backend devuelve un array. */
type EstadoCuenta =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly obligaciones: readonly Obligacion[] }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly faltaContexto: boolean };

/**
 * La cuenta corriente de un paciente (M18, AKINE-07.01).
 *
 * <p>Cuelga del padron —`/pacientes/:personaId/cuenta-corriente`— porque asi es como se llega:
 * primero se busca a la persona y despues se mira que debe. No es una seccion del menu principal y
 * no puede serlo: sin una persona elegida no hay ninguna consulta que hacer.
 *
 * <h2>1. La deuda es de la ORGANIZACION, y la pantalla lo dice</h2>
 *
 * <p>El `consultorioId` de la URL de la API es de donde sale el tenant y contra donde se evalua
 * `cobro:register`, <b>no</b> un filtro. Un paciente que se atendio en dos sedes del mismo centro
 * tiene una sola cuenta corriente. Presentarla como "la deuda de esta sede" seria falso y
 * obligaria al administrativo a sumar de memoria entre pantallas.
 *
 * <h2>2. Aca no se hace aritmetica de plata, y por eso no hay total</h2>
 *
 * <p>Los importes llegan como `number` porque el contrato no tiene otra cosa, y un `number` es un
 * flotante binario: sumar veinte saldos produce centavos que no cuadran contra la base, que si
 * guarda decimales exactos. El backend no devuelve ningun total y esta pantalla <b>no lo
 * calcula</b>: un total inventado con punto flotante es el numero que despues alguien le dice a un
 * paciente. Lo unico que se hace con un importe es formatearlo con `Intl.NumberFormat` y la
 * `moneda` que vino en la respuesta.
 *
 * <h2>3. `snapshotPrecio` es historia, no el precio de hoy</h2>
 *
 * <p>Es el precio de la oferta <b>al momento de devengar</b>. Editar la oferta manana no cambia
 * una cuenta corriente ya emitida, y la pantalla lo rotula asi en vez de dejarlo como "precio" a
 * secas: leerlo como el precio vigente haria que alguien "corrija" una deuda vieja que esta bien.
 *
 * <h2>4. Anular exige motivo, y el rechazo por cobros no dice "no se puede"</h2>
 *
 * <p>El motivo no es opcional aca —a diferencia de activar un perfil de paciente— porque una deuda
 * que se borra sin explicacion es exactamente lo que una auditoria busca. Se usa
 * {@link ConfirmacionConMotivo} con su default: `motivoObligatorio` vale `true`.
 *
 * <p>Cuando la deuda ya tiene cobros imputados, el 409 <b>no</b> se muestra como una prohibicion:
 * hay algo que hacer y es una devolucion (M19). Ademas se muestra <b>cuanto se cobro ya</b>, que
 * es el dato que hace decidible el paso siguiente, formateado con la moneda de esa obligacion.
 *
 * <h2>5. El caso que rompe la pantalla</h2>
 *
 * <p>Cambiar de organizacion o de consultorio con un panel de anulacion abierto. El `effect` de
 * contexto cierra los paneles, limpia los avisos y recarga: un motivo a medio escribir apuntando a
 * una deuda de otra organizacion es la fuga de tenant que el aislamiento existe para evitar.
 */
@Component({
  selector: 'app-cuenta-corriente-page',
  imports: [RouterLink, ConfirmacionConMotivo, PermisoDirective],
  templateUrl: './cuenta-corriente-page.html',
  styleUrl: '../../billing.css',
})
export class CuentaCorrientePage {
  private readonly api = inject(BillingApi);
  private readonly tenantContext = inject(TenantContextStore);

  /** De la ruta. `withComponentInputBinding` lo liga solo. */
  readonly personaId = input.required<string>();

  protected readonly PERMISO_COBRO_REGISTER = PERMISO_COBRO_REGISTER;

  /**
   * Las dos rutas hermanas de esta pantalla, absolutas.
   *
   * <p>Absolutas y no `..`: el enlace relativo depende de la ruta activa y se rompe en silencio el
   * dia que esta pantalla se monte en otro lado.
   */
  protected readonly rutaCobrar = computed(
    () => `/pacientes/${this.personaId()}/cuenta-corriente/cobrar`,
  );
  protected readonly rutaCobros = computed(
    () => `/pacientes/${this.personaId()}/cuenta-corriente/cobros`,
  );

  protected readonly estadoEnPalabras = estadoEnPalabras;
  protected readonly claseDeEstado = claseDeEstado;
  protected readonly fechaEnPalabras = fechaEnPalabras;
  protected readonly sePuedeAnular = sePuedeAnular;

  protected readonly estado = signal<EstadoCuenta>({ tipo: 'cargando' });
  protected readonly persona = signal<PersonaResponse | null>(null);

  /** Deuda que se esta anulando, o `null`. Solo una a la vez. */
  protected readonly objetivo = signal<Obligacion | null>(null);

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<ErrorObligacion | null>(null);
  protected readonly exito = signal<string | null>(null);

  protected readonly obligaciones = computed<readonly Obligacion[]>(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.obligaciones : [];
  });

  protected readonly cargando = computed(() => this.estado().tipo === 'cargando');

  protected readonly mensajeError = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  protected readonly faltaContexto = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' && actual.faltaContexto;
  });

  protected readonly vacia = computed(
    () => this.estado().tipo === 'listo' && this.obligaciones().length === 0,
  );

  /** Nombre de quien debe, o vacio si la ficha no cargo. La deuda se muestra igual. */
  protected readonly nombreDeLaPersona = computed(() => {
    const ficha = this.persona();
    if (ficha === null) {
      return '';
    }
    return `${ficha.apellido ?? ''}, ${ficha.nombre ?? ''}`.trim();
  });

  /** `true` cuando lo unico util despues del rechazo es volver a leer la cuenta corriente. */
  protected readonly recargable = computed(() => hayQueRecargar(this.causaDelRechazo()));

  private readonly causaDelRechazo = computed<CausaObligacion | null>(
    () => this.errorAccion()?.causa ?? null,
  );

  // -------------------------------------------------------------------------------------
  // F-3: saldo a favor e imputacion posterior
  // -------------------------------------------------------------------------------------

  protected readonly instanteEnPalabras = instanteEnPalabras;
  protected readonly importeEnPalabras = importeEnPalabras;

  /**
   * Los cobros de la persona, o `null` si no cargaron. Su fallo no voltea la cuenta corriente:
   * la deuda se sigue viendo y la seccion de saldo a favor dice que no se pudo leer.
   */
  private readonly cobros = signal<readonly Cobro[] | null>([]);
  protected readonly cobrosNoCargaron = computed(() => this.cobros() === null);

  /** Solo los cobros vigentes que todavia tienen algo a favor. */
  protected readonly conSaldoAFavor = computed<readonly Cobro[]>(() =>
    (this.cobros() ?? []).filter((c) => !estaAnulado(c) && saldoAFavorEnCentavos(c) > 0),
  );

  /** El cobro cuyo saldo se esta imputando, o `null`. */
  protected readonly imputando = signal<Cobro | null>(null);
  /** Importe tipeado por deuda, por id de obligacion. Vacio = esa deuda no se toca. */
  protected readonly importesDeImputacion = signal<Readonly<Record<number, string>>>({});
  protected readonly imputacionIntentada = signal(false);
  protected readonly enviandoImputacion = signal(false);
  protected readonly errorImputacion = signal<ErrorCobro | null>(null);
  /** Cuantas imputaciones entraron antes del rechazo. Es un pedido por deuda: puede ser parcial. */
  protected readonly imputadasAntesDelRechazo = signal(0);
  /**
   * Clave por deuda. Se descarta la de una deuda cuando se edita su importe; las demas se reusan,
   * asi reintentar despues de un fallo a mitad de camino no imputa dos veces las que ya entraron.
   */
  private clavesDeImputacion = new Map<number, string>();

  protected readonly deudasDelImputando = computed<readonly Obligacion[]>(() => {
    const cobro = this.imputando();
    return cobro === null ? [] : deudasImputables(cobro, this.obligaciones());
  });

  /** Las lineas con importe, ya en centavos. `null` en el importe si no se entiende. */
  private readonly lineasDeImputacion = computed(() => {
    const importes = this.importesDeImputacion();
    return this.deudasDelImputando()
      .filter((d) => d.id !== undefined && (importes[d.id] ?? '').trim() !== '')
      .map((d) => ({ deuda: d, centavos: centavosDeTexto(importes[d.id as number]) }));
  });

  /** Por que la imputacion no se puede mandar, o `null`. Todo en centavos enteros. */
  protected readonly problemaDeImputacion = computed<string | null>(() => {
    const cobro = this.imputando();
    if (cobro === null) {
      return null;
    }
    const lineas = this.lineasDeImputacion();
    if (lineas.length === 0) {
      return 'Escribi el importe a imputar en al menos una deuda.';
    }
    for (const { deuda, centavos } of lineas) {
      if (centavos === null || centavos <= 0) {
        return `El importe para "${deuda.snapshotNombre ?? 'la deuda'}" tiene que ser mayor que cero, con hasta dos decimales.`;
      }
      if (centavos > (aCentavos(deuda.saldo) ?? 0)) {
        return `El importe para "${deuda.snapshotNombre ?? 'la deuda'}" supera su saldo (${this.importe(deuda, deuda.saldo)}).`;
      }
    }
    const total = sumaDeCentavos(lineas.map((l) => l.centavos ?? 0));
    if (total > saldoAFavorEnCentavos(cobro)) {
      return `Entre todas suman mas que el saldo a favor del cobro (${importeEnPalabras(cobro.saldoAFavor, cobro.moneda)}).`;
    }
    return null;
  });

  constructor() {
    effect(() => {
      // Depende de la ruta y del contexto: cambiar de sede o de organizacion invalida todo lo que
      // hay abierto y todo lo que hay listado.
      this.personaId();
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.cerrarPanel();
        this.cerrarImputacion();
        this.cargar();
      });
    });
  }

  // -------------------------------------------------------------------------------------
  // Carga
  // -------------------------------------------------------------------------------------

  protected cargar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const personaId = this.numeroDePersona();
    if (consultorioId === null || personaId === null) {
      this.estado.set({
        tipo: 'error',
        mensaje:
          'Para ver la cuenta corriente hay que saber en que sede estas. Eligi una organizacion y ' +
          'un consultorio, y volve a entrar. Tu sesion sigue abierta.',
        faltaContexto: true,
      });
      return;
    }

    this.estado.set({ tipo: 'cargando' });

    // La ficha se pide en paralelo y su fallo se descarta: es el encabezado, no el dato.
    this.api
      .verPersona(personaId)
      .pipe(catchError(() => of(null)))
      .subscribe((ficha) => this.persona.set(ficha));

    // Los cobros, para el saldo a favor. Tambien en paralelo y sin voltear la deuda si fallan.
    this.api
      .cobrosDeLaPersona(consultorioId, personaId)
      .pipe(catchError(() => of(null)))
      .subscribe((cobros) => this.cobros.set(cobros));

    this.api.deLaPersona(consultorioId, personaId).subscribe({
      next: (obligaciones) => this.estado.set({ tipo: 'listo', obligaciones }),
      error: (error: unknown) => {
        const traducido = traducirErrorObligacion(error);
        this.estado.set({
          tipo: 'error',
          mensaje: traducido.mensaje,
          faltaContexto: traducido.causa === 'sin-contexto',
        });
      },
    });
  }

  // -------------------------------------------------------------------------------------
  // Importes
  // -------------------------------------------------------------------------------------

  /**
   * Un importe de esta obligacion, ya formateado.
   *
   * <p>La moneda sale de la propia fila y no de una constante: dos obligaciones podrian venir en
   * monedas distintas y un simbolo cableado diria una cosa mientras el numero es de otra.
   */
  protected importe(obligacion: Obligacion, valor: number | undefined): string {
    return importeEnPalabras(valor, obligacion.moneda);
  }

  /**
   * Mensaje del rechazo, con el importe ya cobrado cuando lo hay.
   *
   * <p>El numero se formatea aca —y no en el traductor de errores— porque la moneda vive en la
   * obligacion y no en el `ProblemDetail`. Sin el importe, "registra una devolucion" es una
   * instruccion sin monto.
   */
  protected mensajeDelRechazo(): string {
    const problema = this.errorAccion();
    if (problema === null) {
      return '';
    }
    const objetivo = this.objetivo();
    if (problema.yaCobrado === null || objetivo === null) {
      return problema.mensaje;
    }
    return `${problema.mensaje} Ya se cobraron ${importeEnPalabras(problema.yaCobrado, objetivo.moneda)} sobre esta deuda.`;
  }

  // -------------------------------------------------------------------------------------
  // Anulacion
  // -------------------------------------------------------------------------------------

  protected abrirAnulacion(obligacion: Obligacion): void {
    this.cerrarPanel();
    this.cerrarImputacion();
    this.objetivo.set(obligacion);
  }

  protected esObjetivo(obligacion: Obligacion): boolean {
    const abierta = this.objetivo();
    return abierta !== null && obligacion.id !== undefined && abierta.id === obligacion.id;
  }

  /**
   * Anula la deuda.
   *
   * <p>La `version` es la que se leyo. Ausente se manda `0`, que produce el 409 en vez de pisar en
   * silencio un cambio ajeno: el generado la declara opcional aunque el contrato la exija.
   */
  protected confirmarAnulacion(motivo: string): void {
    const consultorioId = this.tenantContext.consultorioId();
    const obligacion = this.objetivo();
    if (consultorioId === null || obligacion === null || obligacion.id === undefined) {
      return;
    }

    this.enviando.set(true);
    this.errorAccion.set(null);
    this.exito.set(null);

    this.api.anular(consultorioId, obligacion.id, motivo, obligacion.version ?? 0).subscribe({
      next: (anulada) => {
        this.enviando.set(false);
        this.objetivo.set(null);
        this.exito.set(
          `Se anulo la deuda de ${this.importe(anulada, anulada.importeOriginal)} por ` +
            `"${anulada.snapshotNombre ?? 'la prestacion'}". Queda registrada como anulada, ` +
            'con su motivo: no se borra.',
        );
        this.cargar();
      },
      error: (error: unknown) => {
        this.enviando.set(false);
        this.errorAccion.set(traducirErrorObligacion(error));
      },
    });
  }

  protected cerrarPanel(): void {
    this.objetivo.set(null);
    this.errorAccion.set(null);
    this.exito.set(null);
  }

  // -------------------------------------------------------------------------------------
  // Imputacion posterior del saldo a favor (F-3)
  // -------------------------------------------------------------------------------------

  protected abrirImputacion(cobro: Cobro): void {
    this.cerrarPanel();
    this.cerrarImputacion();
    this.imputando.set(cobro);
  }

  protected esElImputando(cobro: Cobro): boolean {
    const abierto = this.imputando();
    return abierto !== null && cobro.id !== undefined && abierto.id === cobro.id;
  }

  protected cerrarImputacion(): void {
    this.imputando.set(null);
    this.importesDeImputacion.set({});
    this.imputacionIntentada.set(false);
    this.errorImputacion.set(null);
    this.imputadasAntesDelRechazo.set(0);
    this.clavesDeImputacion = new Map();
  }

  protected importeTipeado(deuda: Obligacion): string {
    return deuda.id === undefined ? '' : (this.importesDeImputacion()[deuda.id] ?? '');
  }

  protected cambiarImporteDeImputacion(deuda: Obligacion, texto: string): void {
    if (deuda.id === undefined) {
      return;
    }
    this.importesDeImputacion.update((actual) => ({ ...actual, [deuda.id as number]: texto }));
    this.clavesDeImputacion.delete(deuda.id);
    this.errorImputacion.set(null);
  }

  /**
   * Imputa el saldo a favor, una deuda por pedido y en serie.
   *
   * <p>En serie y no en paralelo: el backend toma el lock del cobro en cada pedido, asi que en
   * paralelo se pelearian por el mismo saldo. Si uno falla, los siguientes no salen y la pantalla
   * dice cuantos entraron.
   */
  protected confirmarImputacion(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const cobro = this.imputando();
    this.imputacionIntentada.set(true);
    if (
      consultorioId === null ||
      cobro === null ||
      cobro.id === undefined ||
      this.problemaDeImputacion() !== null
    ) {
      return;
    }
    const cobroId = cobro.id;

    const pedidos = this.lineasDeImputacion().map(({ deuda, centavos }) => {
      const obligacionId = deuda.id as number;
      let clave = this.clavesDeImputacion.get(obligacionId);
      if (clave === undefined) {
        clave = nuevaClaveDeIntento();
        this.clavesDeImputacion.set(obligacionId, clave);
      }
      return this.api
        .imputarSaldoAFavor(consultorioId, cobroId, {
          obligacionId,
          importe: deCentavos(centavos ?? 0),
          idempotencyKey: clave,
        })
        .pipe(tap(() => this.imputadasAntesDelRechazo.update((n) => n + 1)));
    });

    this.enviandoImputacion.set(true);
    this.errorImputacion.set(null);
    this.imputadasAntesDelRechazo.set(0);
    this.exito.set(null);

    concat(...pedidos).subscribe({
      error: (error: unknown) => {
        this.enviandoImputacion.set(false);
        this.errorImputacion.set(traducirErrorCobro(error, 'imputar'));
      },
      complete: () => {
        this.enviandoImputacion.set(false);
        const cuantas = pedidos.length;
        this.cerrarImputacion();
        this.exito.set(
          `Se imputo el saldo a favor del comprobante N.º ${cobro.comprobanteNumero} a ` +
            `${cuantas === 1 ? 'una deuda' : `${cuantas} deudas`}. No se movio la caja: la plata ` +
            'entro cuando se cobro.',
        );
        this.cargar();
      },
    });
  }

  /** Despues de un rechazo: cerrar y releer deuda y cobros, que pudieron cambiar a medias. */
  protected recargarTrasImputacion(): void {
    this.cerrarImputacion();
    this.cargar();
  }

  private numeroDePersona(): number | null {
    const id = Number(this.personaId());
    return Number.isFinite(id) && id > 0 ? id : null;
  }
}
