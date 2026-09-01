import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { BillingApi } from '../../services/billing-api';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { Obligacion } from '../../../../api/generated/model/obligacion';
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
  imports: [RouterLink, ConfirmacionConMotivo],
  templateUrl: './cuenta-corriente-page.html',
  styleUrl: '../../billing.css',
})
export class CuentaCorrientePage {
  private readonly api = inject(BillingApi);
  private readonly tenantContext = inject(TenantContextStore);

  /** De la ruta. `withComponentInputBinding` lo liga solo. */
  readonly personaId = input.required<string>();

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

  constructor() {
    effect(() => {
      // Depende de la ruta y del contexto: cambiar de sede o de organizacion invalida todo lo que
      // hay abierto y todo lo que hay listado.
      this.personaId();
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.cerrarPanel();
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

  private numeroDePersona(): number | null {
    const id = Number(this.personaId());
    return Number.isFinite(id) && id > 0 ? id : null;
  }
}
