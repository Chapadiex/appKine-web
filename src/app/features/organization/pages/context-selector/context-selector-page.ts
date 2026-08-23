import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, of } from 'rxjs';

import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { AuthorizedContextResponse } from '../../../../api/generated/model/authorized-context-response';
import {
  PARAM_VOLVER_A,
  RUTA_SELECTOR_CONTEXTO,
  destinoInterno,
} from '../../../../core/models/rutas';
import { SessionService } from '../../../../core/services/session.service';
import { TenantContext } from '../../../../core/services/tenant-context.store';

/** Destino cuando nadie pidio volver a ningun lado. */
const DESTINO_POR_DEFECTO = '/organizacion';

/**
 * Estado de la pantalla de seleccion de contexto (ADR-0005).
 *
 * <p>`vacio` es un estado propio y no un caso del exito: "no tenes donde trabajar" y
 * "todavia no elegiste" exigen mensajes y salidas distintas, y el backend los distingue
 * devolviendo lista vacia en lugar de un error.
 *
 * <p>`entrando` lleva `automatico` porque se llega por dos caminos que se le explican
 * distinto al usuario: la auto-seleccion cuando hay un unico contexto, y el clic sobre una
 * de varias opciones. Sin ese dato la pantalla afirmaba "tenes un solo contexto" tambien a
 * quien acababa de elegir entre dos, que es informacion falsa sobre sus propios permisos.
 */
type EstadoContextos =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'eligiendo'; readonly contextos: readonly TenantContext[] }
  | { readonly tipo: 'vacio' }
  | { readonly tipo: 'entrando'; readonly contexto: TenantContext; readonly automatico: boolean }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly esDeRed: boolean };

/**
 * Seleccion del contexto de trabajo: Organizacion + Consultorio (M01, AKINE-01.01/01.02).
 *
 * <p>Consume `GET /api/v1/me/contexts`, el unico endpoint del modulo que <b>no</b> exige
 * contexto de tenant: es con el que se averigua que contextos hay. Elegir uno canjea el
 * token contra `POST /api/v1/auth/context` a traves de {@link SessionService}: hasta que
 * ese canje ocurre el token sigue con scope `pre_context`, ningun endpoint de negocio
 * responde y el `contextGuard` rebota cualquier navegacion al destino.
 *
 * <p><b>Con un solo contexto no se muestra el selector.</b> Elegir entre una sola opcion no
 * es una decision, es un clic de tramite; la mayoria de los centros tiene una sede y se
 * comeria esa friccion en cada login.
 *
 * <p><b>Invalidacion del estado de features (AGENT.md 6).</b> El canje exitoso termina en
 * `TenantContextStore.select`, que incrementa `contextEpoch`. Las pantallas de feature
 * dependen de ese contador -no del id- para recargar, de modo que al pasar de la
 * Organizacion A a la B ningun dato de A sobrevive en pantalla. Esta pantalla no toca el
 * store por su cuenta: escribirlo antes del canje dejaria un contexto "elegido" con un
 * token que todavia no lo acompania.
 */
@Component({
  selector: 'app-context-selector-page',
  templateUrl: './context-selector-page.html',
  styleUrl: '../../organization.css',
})
export class ContextSelectorPage {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);

  protected readonly estado = signal<EstadoContextos>({ tipo: 'cargando' });

  /**
   * Aviso que sobrevive a una recarga de la lista, o `null`.
   *
   * <p>Va aparte de `estado` justamente porque tiene que seguir visible mientras el estado
   * vuelve a `cargando` y despues a `eligiendo`: es el unico rastro de por que la lista se
   * recargo sola.
   */
  protected readonly aviso = signal<string | null>(null);

  /**
   * Contextos a elegir, o `null` en cualquier otro estado.
   *
   * El estrechamiento se hace aca, en TypeScript, no en la plantilla con `$any` (ADR-0005).
   */
  protected readonly contextos = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'eligiendo' ? estado.contextos : null;
  });

  /** Contexto al que se esta entrando, o `null`. */
  protected readonly contextoEnCurso = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'entrando' ? estado.contexto : null;
  });

  /** `true` solo cuando se entro sin preguntar porque habia un unico contexto. */
  protected readonly entradaAutomatica = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'entrando' && estado.automatico;
  });

  /** Mensaje de error mostrable, o `null` si el estado no es de error. */
  protected readonly mensajeError = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.mensaje : null;
  });

  constructor() {
    this.cargar();
  }

  protected cargar(): void {
    this.estado.set({ tipo: 'cargando' });

    this.session
      .cargarContextos()
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          this.estado.set(this.aEstadoDeError(respuesta));
          return;
        }

        this.resolver(respuesta);
      });
  }

  /**
   * Canjea el token por uno acotado al contexto elegido y sigue viaje al destino.
   *
   * <p>El estado `entrando` es tambien el indicador de "llamada en curso": reemplaza a la
   * lista en pantalla, asi que no hay forma de disparar dos canjes con dos clics seguidos.
   */
  protected seleccionar(contexto: TenantContext, automatico = false): void {
    // Los contextos sin consultorio ya se filtraron en `resolver`: el contrato exige los dos
    // ids. La guarda esta para que el tipo cierre, no porque el caso pueda llegar aca.
    const consultorioId = contexto.consultorioId;
    if (consultorioId === undefined) {
      return;
    }

    this.aviso.set(null);
    this.estado.set({ tipo: 'entrando', contexto, automatico });

    this.session.seleccionarContexto(contexto.organizationId, consultorioId).subscribe({
      next: () => this.irAlDestino(),
      error: (error: unknown) => this.fallarSeleccion(error, automatico),
    });
  }

  /**
   * Camino de vuelta, saneado para que la pantalla no sirva de redireccion abierta.
   *
   * <p>El nombre del parametro y el sanitizado salen de `core/`: quien escribe el destino es
   * el `contextGuard`, y leerlo con otro nombre equivale a ignorarlo siempre.
   *
   * <p>Un destino que apunta a esta misma pantalla se descarta: seria un rebote infinito
   * entre el selector y si mismo.
   */
  private destino(): string {
    const solicitado = destinoInterno(this.ruta.snapshot.queryParamMap.get(PARAM_VOLVER_A));
    if (solicitado === null || solicitado.startsWith(RUTA_SELECTOR_CONTEXTO)) {
      return DESTINO_POR_DEFECTO;
    }
    return solicitado;
  }

  private irAlDestino(): void {
    // La promesa se maneja: una navegacion fallida en silencio deja al usuario mirando el
    // "Entrando a..." para siempre, sin saber que paso.
    this.router.navigateByUrl(this.destino()).catch((error: unknown) => {
      console.error('No se pudo navegar al destino tras elegir el contexto', error);
      this.estado.set({
        tipo: 'error',
        mensaje: 'El contexto quedo elegido pero no pudimos abrir la pantalla siguiente.',
        esDeRed: false,
      });
    });
  }

  /**
   * Traduce el fallo del canje de token.
   *
   * <p>Un par que ya no es accesible responde `404 not-found`, nunca `403`: un 403
   * confirmaria que ese consultorio existe. La salida correcta es volver al selector con la
   * lista <b>recargada</b>, porque la que se estaba mirando quedo vieja.
   *
   * <p>Cuando el contexto lo habia elegido la propia pantalla -habia uno solo- no se
   * recarga: la recarga devolveria ese mismo unico contexto, que se auto-seleccionaria y
   * volveria a fallar, en un bucle. Ahi el 404 se muestra como error con reintento manual.
   */
  private fallarSeleccion(error: unknown, automatico: boolean): void {
    const es404 = error instanceof AkineHttpError && !error.esDeRed && error.status === 404;

    if (es404 && !automatico) {
      this.aviso.set('Ese contexto ya no esta disponible. Elegi otro de la lista actualizada.');
      this.cargar();
      return;
    }

    if (es404) {
      this.estado.set({
        tipo: 'error',
        mensaje: 'Ese contexto ya no esta disponible.',
        esDeRed: false,
      });
      return;
    }

    this.estado.set(this.aEstadoDeError(error instanceof Error ? error : new Error('')));
  }

  /** Convierte un elemento de la respuesta en el contexto del store, o `null` si no es elegible. */
  private aContexto(elemento: AuthorizedContextResponse): TenantContext | null {
    const { organizationId, organizationName, consultorioId } = elemento;
    if (organizationId === undefined || organizationName === undefined) {
      return null;
    }

    // Sin consultorio no hay canje posible: `SelectContextRequest` exige los dos ids, asi
    // que ofrecer la opcion terminaria en un rechazo recien al hacer clic.
    if (consultorioId === undefined) {
      return null;
    }

    return {
      organizationId,
      organizationName,
      consultorioId,
      consultorioName: elemento.consultorioName,
    };
  }

  private resolver(respuesta: readonly AuthorizedContextResponse[]): void {
    // Todos los campos vienen opcionales del generador porque el contrato no los marca
    // required. Un elemento incompleto no es elegible: seleccionarlo produciria un contexto
    // invalido que fallaria recien en la pantalla siguiente.
    const utilizables = respuesta
      .map((elemento) => this.aContexto(elemento))
      .filter((contexto): contexto is TenantContext => contexto !== null);

    if (utilizables.length === 0) {
      this.estado.set({ tipo: 'vacio' });
      return;
    }

    if (utilizables.length === 1) {
      this.seleccionar(utilizables[0], true);
      return;
    }

    this.estado.set({ tipo: 'eligiendo', contextos: utilizables });
  }

  private aEstadoDeError(error: Error): EstadoContextos {
    if (!(error instanceof AkineHttpError)) {
      return { tipo: 'error', mensaje: 'Error inesperado al pedir tus contextos.', esDeRed: false };
    }

    if (error.esDeRed) {
      return {
        tipo: 'error',
        mensaje: 'No se pudo contactar al servidor.',
        esDeRed: true,
      };
    }

    // 403 y no 401: el backend nunca emite 401 desde endpoints de negocio, justamente para
    // que el cliente no descarte el token y entre en un bucle de login.
    if (error.status === 403) {
      return {
        tipo: 'error',
        mensaje: 'Tu sesion no esta activa. Volve a iniciar sesion.',
        esDeRed: false,
      };
    }

    return { tipo: 'error', mensaje: error.message, esDeRed: false };
  }
}
