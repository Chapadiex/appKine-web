import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, of, shareReplay, switchMap, tap } from 'rxjs';

import {
  AccessTokenResponse,
  AccessTokenResponseScopeEnum,
} from '../../api/generated/model/access-token-response';
import { AuthorizedContextResponse } from '../../api/generated/model/authorized-context-response';
import { MiCuentaService } from '../../api/generated/api/mi-cuenta.service';
import { SesionService as SesionApi } from '../../api/generated/api/sesion.service';
import { AuthTokenStore } from './auth-token.store';
import { TenantContextStore } from './tenant-context.store';

/** Estado de sesion visible para las pantallas y los guards. */
export type EstadoSesion = 'anonimo' | 'sin-contexto' | 'activa';

/**
 * Unico duenio del ciclo de vida de la sesion de AKINE (AKINE-01.02, DP-02).
 *
 * <p><b>Flujo obligatorio.</b> El backend no acepta elegir rol antes de autenticar:
 *
 * <pre>
 * POST /api/v1/auth/login    -&gt; accessToken con scope "pre_context"
 * GET  /api/v1/me/contexts   -&gt; los pares Organizacion + Consultorio habilitados
 * POST /api/v1/auth/context  -&gt; accessToken con scope "context", ya operativo
 * </pre>
 *
 * Con `pre_context` <b>ningun</b> endpoint de negocio responde: el backend corta con
 * `403 missing-tenant-context`. Solo `/api/v1/auth/**` y `/api/v1/me/contexts` estan
 * exceptuados. Por eso `estado` distingue `sin-contexto` de `activa`: son dos situaciones
 * autenticadas y solo una puede pedir datos.
 *
 * <p><b>Donde vive cada token.</b> El access token queda en memoria
 * ({@link AuthTokenStore}) y muere con la pestania. El refresh viaja en la cookie
 * `akine_rt`, `httpOnly` `Secure` `SameSite=Strict`, que este codigo no puede leer ni
 * necesita leer: alcanza con `withCredentials`, que ya pone el interceptor de auth.
 *
 * <p><b>La sesion cae a las 12 h del login, se refresque o no.</b> El vencimiento del
 * backend es absoluto y la rotacion no lo mueve: no hay nada que este servicio pueda hacer
 * para extenderla, solo reaccionar al 401 final.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly api = inject(SesionApi);
  private readonly miCuenta = inject(MiCuentaService);
  private readonly tokenStore = inject(AuthTokenStore);
  private readonly tenantStore = inject(TenantContextStore);

  private readonly scope = signal<AccessTokenResponseScopeEnum | null>(null);
  private readonly contextosDisponibles = signal<readonly AuthorizedContextResponse[]>([]);
  private readonly contextoElegido = signal<AuthorizedContextResponse | null>(null);

  /**
   * `anonimo` sin token, `sin-contexto` con token `pre_context`, `activa` con `context`.
   *
   * <p>Derivado, nunca escrito a mano: un estado que se setea aparte del token se
   * desincroniza el dia que alguien agrega una rama de limpieza y se olvida de uno de los
   * dos.
   */
  readonly estado: Signal<EstadoSesion> = computed(() => {
    if (this.tokenStore.token() === null) {
      return 'anonimo';
    }
    return this.scope() === AccessTokenResponseScopeEnum.CONTEXT ? 'activa' : 'sin-contexto';
  });

  /** Contextos autorizados de la cuenta. Copia nueva en cada cambio: zoneless + OnPush. */
  readonly contextos: Signal<AuthorizedContextResponse[]> = computed(() => [
    ...this.contextosDisponibles(),
  ]);

  readonly contextoActivo: Signal<AuthorizedContextResponse | null> =
    this.contextoElegido.asReadonly();

  /**
   * Refresh en vuelo, compartido. Ver {@link refrescar}: es la mitad del mecanismo
   * single-flight; la otra mitad la consume el interceptor de auth.
   */
  private refreshEnVuelo: Observable<void> | null = null;

  /**
   * Autentica la identidad. El token que devuelve es `pre_context`: no habilita negocio.
   *
   * <p>Credenciales incorrectas, cuenta sin activar y cuenta bloqueada devuelven el mismo
   * `401 invalid-credentials`, con el mismo cuerpo (ADR-0018 del backend). Es
   * anti-enumeracion deliberada: el error se propaga tal cual y la pantalla muestra un
   * unico mensaje. No hay forma de distinguir cual de los tres fue, y no hay que intentarlo.
   */
  login(email: string, password: string): Observable<void> {
    return this.api.login({ loginRequest: { email, password } }).pipe(
      tap((respuesta) => {
        // Login siempre arranca de cero: si habia una sesion anterior a medio limpiar, su
        // contexto no puede sobrevivir al cambio de identidad.
        this.limpiarEstadoDeContexto();
        this.aplicarToken(respuesta);
      }),
      map(() => undefined),
    );
  }

  /**
   * Pares Organizacion + Consultorio habilitados.
   *
   * Una lista vacia no es un error: significa "no tenes ninguno". La pantalla distingue
   * "no elegiste" de "no tenes donde".
   */
  cargarContextos(): Observable<AuthorizedContextResponse[]> {
    return this.miCuenta
      .listMyContexts()
      .pipe(tap((contextos) => this.contextosDisponibles.set(contextos)));
  }

  /**
   * Elige (o cambia) el contexto de trabajo y canjea el token por uno acotado.
   *
   * <p><b>Invalida el estado de las features.</b> `TenantContextStore.select` incrementa
   * `contextEpoch`, y los servicios de feature deben descartar su cache al verlo cambiar.
   * Sin eso, los datos de la Organizacion A quedan en pantalla bajo la Organizacion B: es
   * el bug de aislamiento mas grave del frontend porque expone datos clinicos ajenos
   * (AGENT.md 6).
   *
   * <p>Un par no accesible responde `404 not-found`, nunca `403`: un 403 confirmaria que
   * ese consultorio existe. La salida de ese error es volver al selector.
   */
  seleccionarContexto(organizationId: number, consultorioId: number): Observable<void> {
    return this.api.selectContext({ selectContextRequest: { organizationId, consultorioId } }).pipe(
      tap((respuesta) => this.aplicarToken(respuesta)),
      map(() => undefined),
    );
  }

  /**
   * Canjea la cookie de refresh por un access token nuevo. <b>Cola single-flight.</b>
   *
   * <p>La rotacion del backend es estricta: cada canje invalida el refresh presentado, y
   * presentar uno ya canjeado se interpreta como robo y revoca <b>toda la familia de
   * sesion</b>. Dos pestanias, o dos peticiones que reciben 401 a la vez, disparan dos
   * refresh; el segundo cuenta como reuso y el usuario legitimo queda afuera.
   *
   * <p>Por eso hay un unico refresh en vuelo: mientras haya uno, todos reciben <b>el
   * mismo</b> observable. El `shareReplay` hace que la peticion HTTP salga una sola vez y
   * que quien llegue tarde reciba igual el resultado; el `finalize` libera el hueco para el
   * proximo ciclo, tanto si salio bien como si fallo.
   *
   * <p>`refCount: false` es deliberado: con `refCount: true`, que todos los suscriptores se
   * desuscribieran (una navegacion, por ejemplo) cancelaria el refresh a mitad de camino y
   * el canje quedaria consumido en el backend sin que nadie guarde el token nuevo.
   */
  refrescar(): Observable<void> {
    const enVuelo = this.refreshEnVuelo;
    if (enVuelo !== null) {
      return enVuelo;
    }

    const flujo = this.api.refreshSession().pipe(
      tap((respuesta) => this.aplicarToken(respuesta)),
      map(() => undefined),
      finalize(() => {
        this.refreshEnVuelo = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    this.refreshEnVuelo = flujo;
    return flujo;
  }

  /**
   * Cierra esta sesion. El backend responde `204` siempre, incluso sin cookie.
   *
   * <p>El estado local se limpia pase lo que pase: si la llamada falla, dejar el token
   * puesto seria peor que el error que la hizo fallar. Un logout que no desloguea es la
   * unica falla inaceptable de esta operacion.
   */
  logout(): Observable<void> {
    return this.api.logout().pipe(
      catchError(() => of(undefined)),
      tap(() => this.limpiarSesion()),
      map(() => undefined),
    );
  }

  /**
   * Revoca los refresh vivos de la cuenta en todos los dispositivos y limpia el local.
   *
   * Los access token ya emitidos siguen siendo criptograficamente validos hasta diez
   * minutos (ADR-0017): la revocacion es real sobre el refresh, no sobre el access en
   * vuelo. La UI no debe prometer un corte instantaneo.
   */
  cerrarTodasLasSesiones(): Observable<number> {
    return this.api.closeAllSessions().pipe(
      map((respuesta) => respuesta.closedSessions ?? 0),
      tap(() => this.limpiarSesion()),
    );
  }

  /**
   * Arranque de la aplicacion: recupera la sesion que sobrevivio a la recarga.
   *
   * <p>El access token murio con la pestania, asi que se pide uno nuevo contra
   * `/auth/refresh` usando la cookie. Devuelve `false` cuando no habia sesion.
   *
   * <p><b>No explota ni loguea nada si no hay cookie:</b> ese es el caso normal de un
   * visitante que nunca se logueo. Tratarlo como error llenaria la consola de ruido en la
   * pantalla de login y, peor, escondaria los errores de verdad entre el ruido.
   *
   * <p>Si el token vuelve ya con contexto (la familia recordaba donde se estaba trabajando)
   * se rehidratan los nombres pidiendo los contextos: el token trae ids, no nombres, y la
   * barra superior necesita mostrar donde esta parado el usuario.
   */
  restaurarSesion(): Observable<boolean> {
    return this.refrescar().pipe(
      switchMap(() => (this.estado() === 'activa' ? this.rehidratarContexto() : of(undefined))),
      map(() => true),
      catchError(() => {
        this.limpiarSesion();
        return of(false);
      }),
    );
  }

  /**
   * Borra todo rastro local de la sesion. Lo usa el interceptor cuando el refresh falla.
   *
   * No llama al backend: es limpieza local. O el backend ya invalido lo suyo, o nunca hubo
   * nada que invalidar.
   */
  limpiarSesion(): void {
    this.tokenStore.clear();
    this.scope.set(null);
    this.limpiarEstadoDeContexto();
  }

  // --- Interno ---------------------------------------------------------------------

  private aplicarToken(respuesta: AccessTokenResponse): void {
    const token = respuesta.accessToken;
    if (!token) {
      // Un 200 sin token es un contrato roto, no una sesion valida. Fallar aca es mejor
      // que guardar `null` y descubrirlo tres pantallas despues.
      throw new Error('El backend respondio sin accessToken');
    }

    this.tokenStore.set(token);
    this.scope.set(respuesta.scope ?? AccessTokenResponseScopeEnum.PRE_CONTEXT);

    if (respuesta.scope !== AccessTokenResponseScopeEnum.CONTEXT) {
      // El refresh puede DEGRADAR a pre_context si la membership dejo de ser accesible
      // (revocada, suscripcion cancelada). Quedarse con el contexto viejo dibujaria una
      // organizacion sobre la que ya no se puede operar.
      this.limpiarEstadoDeContexto();
      return;
    }

    if (respuesta.organizationId !== undefined && respuesta.consultorioId !== undefined) {
      this.fijarContexto(respuesta.organizationId, respuesta.consultorioId);
    }
  }

  /**
   * Sincroniza el contexto activo con el store de tenant.
   *
   * <p>Los nombres salen del listado de contextos si ya se cargo; si no, se arma un texto
   * provisorio con los ids y {@link rehidratarContexto} lo completa. Nunca se bloquea una
   * sesion que el backend acepto por no tener un nombre: es dato de presentacion.
   */
  private fijarContexto(organizationId: number, consultorioId: number): void {
    const conocido = this.contextosDisponibles().find(
      (contexto) =>
        contexto.organizationId === organizationId && contexto.consultorioId === consultorioId,
    );

    const contexto: AuthorizedContextResponse = conocido ?? {
      organizationId,
      consultorioId,
      organizationName: `Organizacion ${organizationId}`,
      consultorioName: `Consultorio ${consultorioId}`,
    };

    this.contextoElegido.set(contexto);
    this.tenantStore.select({
      organizationId,
      organizationName: contexto.organizationName ?? `Organizacion ${organizationId}`,
      consultorioId,
      consultorioName: contexto.consultorioName,
    });
  }

  /** Completa los nombres del contexto que el token trajo solo como ids. */
  private rehidratarContexto(): Observable<unknown> {
    const activo = this.contextoElegido();
    if (activo === null) {
      return of(undefined);
    }

    return this.cargarContextos().pipe(
      tap(() => {
        if (activo.organizationId !== undefined && activo.consultorioId !== undefined) {
          this.fijarContexto(activo.organizationId, activo.consultorioId);
        }
      }),
      // Que falle el listado de nombres no invalida una sesion que el backend ya acepto.
      catchError(() => of(undefined)),
    );
  }

  private limpiarEstadoDeContexto(): void {
    this.contextoElegido.set(null);
    this.contextosDisponibles.set([]);
    this.tenantStore.clear();
  }
}
