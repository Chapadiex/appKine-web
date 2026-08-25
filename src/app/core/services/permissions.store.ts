import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { Observable, finalize, map, tap } from 'rxjs';

import { MiCuentaService } from '../../api/generated/api/mi-cuenta.service';
import { TenantContextStore } from './tenant-context.store';

/** Instancia unica del conjunto vacio: evita crear un `Set` nuevo en cada lectura. */
const SIN_PERMISOS: ReadonlySet<string> = new Set<string>();

/**
 * Permisos efectivos del contexto activo. <b>Insumo de UX, nunca de seguridad</b>
 * (AKINE-01.03, seccion 9 del diseno de permisos).
 *
 * <p><b>Lo que este store decide es que ve el usuario, no que puede hacer.</b> La
 * autoridad es el backend, que evalua rol + grants + alcance + habilitacion en cada
 * request y rechaza igual a quien llegue por URL directa, edite el bundle o pegue el
 * request en curl. Un permiso que falte aca esconde un boton; un permiso de mas dibuja un
 * boton que termina en `403`. Ninguno de los dos casos eleva privilegios.
 *
 * <p><b>No se persiste.</b> Ni `localStorage`, ni `sessionStorage`, ni cookie legible: los
 * permisos viven en memoria por el mismo motivo que el access token (ADR-0001). Un XSS que
 * lea el storage no puede ademas decidir que acciones se le dibujan al usuario. Y hay un
 * segundo motivo, independiente del XSS: un permiso persistido es un permiso obsoleto —
 * sobrevive a la revocacion del rol que lo otorgaba.
 *
 * <p><b>Los permisos son del contexto, no de la cuenta</b> (RN-M02-002: el rol vive en la
 * membership). Los de la Organizacion A no valen bajo la B. Por eso el cache guarda la
 * <b>epoca</b> de {@link TenantContextStore} en la que se cargo, y todo lo que se expone se
 * deriva comparandola con la epoca actual: al cambiar de contexto los permisos viejos
 * dejan de estar vigentes <b>en el mismo tick</b>, sin esperar a un `effect`. Con un
 * `effect` que limpiara habria una ventana -un render- en la que los permisos de la
 * Organizacion A ya estarian dibujados sobre la B.
 */
@Injectable({ providedIn: 'root' })
export class PermissionsStore {
  private readonly cuenta = inject(MiCuentaService);
  private readonly tenant = inject(TenantContextStore);

  /** Ultima carga, con la epoca de contexto en la que se obtuvo. `null` = nunca se cargo. */
  private readonly cache = signal<{
    readonly epoca: number;
    readonly permisos: ReadonlySet<string>;
  } | null>(null);

  /**
   * `true` mientras hay un `GET /me/permissions` viajando. Ver {@link asegurarCargados}.
   *
   * <p>Campo plano y no signal a proposito: nadie lo lee para renderizar. Un signal escrito
   * desde el `effect` de la directiva agregaria una dependencia que ese `effect` tendria que
   * ignorar a mano, y no habilita nada que aca haga falta.
   */
  private cargaEnVuelo = false;

  /** El cache, pero solo si sigue perteneciendo al contexto activo. */
  private readonly vigente = computed(() => {
    const cache = this.cache();
    return cache !== null && cache.epoca === this.tenant.contextEpoch() ? cache : null;
  });

  /** Permisos del contexto activo. Vacio mientras no haya una carga vigente. */
  readonly permisos: Signal<ReadonlySet<string>> = computed(
    () => this.vigente()?.permisos ?? SIN_PERMISOS,
  );

  /**
   * `true` solo si hay una carga <b>de este contexto</b>.
   *
   * <p>Distinguir "todavia no se", que es este signal en `false`, de "no tiene ninguno",
   * que es `true` con {@link permisos} vacio, es lo que le permite a la directiva y al
   * guard no tratar el arranque como una denegacion definitiva.
   */
  readonly cargados: Signal<boolean> = computed(() => this.vigente() !== null);

  /** `true` si el contexto activo tiene ese permiso. Falso mientras no hayan cargado. */
  tiene(permiso: string): boolean {
    return this.permisos().has(permiso);
  }

  /**
   * `true` si el contexto activo tiene <b>al menos uno</b> de los permisos.
   *
   * <p>Sin argumentos devuelve `false`: "no exijo nada" no es una pregunta que este store
   * pueda responder que si. Quien no necesita permisos no llama a este metodo, y una lista
   * vacia por un bug -un spread de un array vacio- tiene que fallar visiblemente y no
   * abrir todo.
   */
  tieneAlguno(...permisos: string[]): boolean {
    const efectivos = this.permisos();
    return permisos.some((permiso) => efectivos.has(permiso));
  }

  /**
   * Pide los permisos efectivos del contexto activo.
   *
   * <p><b>El endpoint es del contrato, no un stub.</b> `GET /api/v1/me/permissions` llego
   * en el contrato `0.4.0` y se consume por {@link MiCuentaService#getMyPermissions}, que
   * devuelve `EffectivePermissionsResponse`. Hasta `0.3.0` esto era un `HttpClient.get`
   * contra una ruta escrita a mano y un DTO local: los dos se borraron al regenerar el
   * cliente, que es la unica fuente de tipos que acepta AGENT.md seccion 5.
   *
   * <p><b>Un array plano y ordenado.</b> El backend devuelve los codigos ya evaluados para
   * el contexto activo -rol base mas grants, acotados por alcance y vigencia-, en orden
   * alfabetico estable. El orden no le importa a este store, que guarda un `Set`, pero si
   * le importa a los tests y a comparar una respuesta contra otra.
   *
   * <p><b>Sin contexto el backend responde `403 missing-tenant-context`; sin sesion, `403`
   * a secas.</b> Nunca `401`: en AKINE ningun endpoint de negocio lo usa, esta reservado al
   * canje de credenciales. El error se propaga sin interpretar y quien ramifica por
   * `problemType` es el llamador — {@link permissionGuard} deniega, y una pantalla que lo
   * pidio por su cuenta manda al selector de contexto.
   *
   * <p><b>El error no se traga.</b> Se propaga para que el llamador decida: fallar la carga
   * y quedarse con el conjunto vacio son cosas distintas, y confundirlas dibujaria "no
   * tenes permisos" ante una caida de red. El store queda como estaba: `cargados()` sigue
   * en `false`.
   *
   * <p><b>Una respuesta que llega tarde se descarta.</b> Se sella la epoca al salir y se
   * compara al volver: si el usuario cambio de contexto mientras la peticion viajaba, esos
   * permisos son de la Organizacion anterior y guardarlos seria exactamente el bug de
   * aislamiento que este store existe para evitar.
   */
  cargar(): Observable<void> {
    const epoca = this.tenant.contextEpoch();

    return this.cuenta.getMyPermissions().pipe(
      tap((respuesta) => {
        if (this.tenant.contextEpoch() !== epoca) {
          return;
        }
        this.cache.set({ epoca, permisos: new Set(respuesta.permissions ?? []) });
      }),
      map(() => undefined),
    );
  }

  /**
   * Carga los permisos del contexto activo si hacen falta. <b>Idempotente: llamarla de mas
   * no cuesta una peticion de mas.</b>
   *
   * <p><b>Existe porque hasta AKINE-02.02 el unico que llamaba a {@link cargar} era
   * `permissionGuard`.</b> Eso dejaba un agujero en toda pantalla que <b>no</b> lleva ese
   * guard y aun asi usa `*akinePermiso` para mostrar sus acciones —el listado de sedes y el
   * de espacios, que se abren con solo ser miembro—: nadie pedia los permisos, `cargados()`
   * quedaba en `false`, y la directiva escondia <b>todos</b> los botones. Un administrador
   * veia la tabla completa y ni una accion, sin ningun error en consola que lo explicara.
   *
   * <p>Se detecto mirando la pantalla en el navegador: ningun test lo veia porque todos los
   * specs siembran el store a mano antes de montar el componente.
   *
   * <p><b>Quien la llama es {@link PermisoDirective}, no las pantallas.</b> Dejarsela a cada
   * pantalla es exactamente como nacio el defecto: la que se olvide manana vuelve a tenerlo,
   * y no hay nada que falle para avisarlo. La directiva no se puede olvidar, porque pedir los
   * permisos es parte de usarla.
   *
   * <h2>Las tres cosas que este metodo no puede hacer</h2>
   *
   * <p><b>1. Una peticion por cada elemento con la directiva.</b> Una tabla de veinte filas
   * instancia veinte directivas que llaman aca en el mismo tick, antes de que ninguna
   * respuesta llegue: `cargados()` sigue en `false` para las veinte. Por eso ademas del cache
   * hay una bandera de <b>carga en vuelo</b>: la primera sale a la red y las otras diecinueve
   * no hacen nada. Sin ella serian veinte `GET /me/permissions` identicos.
   *
   * <p><b>2. Salir a pedir permisos sin contexto.</b> Sin contexto el backend responde
   * `403 missing-tenant-context`, y sin sesion `403` a secas: la peticion no puede terminar
   * bien, y saldria en <b>cada</b> pantalla publica —login, activacion, restablecer— que algun
   * dia use la directiva, dejando un error rojo en consola que no significa nada. Los permisos
   * son <b>de un contexto</b>: sin contexto la pregunta ni siquiera existe.
   *
   * <p><b>3. Interferir con la invalidacion por epoca.</b> No toca el cache: delega en
   * {@link cargar}, que sella la epoca al salir y descarta la respuesta que llega tarde. El
   * cambio de contexto sigue invalidando en el mismo tick, sin `effect` de por medio.
   *
   * <p><b>No devuelve nada y se suscribe sola.</b> Quien la llama no tiene nada que hacer con
   * el resultado: si la carga falla, `cargados()` sigue en `false` y las acciones siguen
   * ocultas, que es la degradacion correcta —la autoridad es el backend, que rechazaria igual—.
   */
  asegurarCargados(): void {
    if (this.cargados() || this.cargaEnVuelo || !this.tenant.hasContext()) {
      return;
    }

    this.cargaEnVuelo = true;
    this.cargar()
      .pipe(
        finalize(() => {
          this.cargaEnVuelo = false;
        }),
      )
      .subscribe({
        error: () => {
          // Silencio deliberado: el store queda como estaba y la pantalla muestra la tabla sin
          // acciones. Ensuciar la consola aca escondaria los errores de verdad.
        },
      });
  }

  /**
   * Descarta los permisos cargados. Lo llama el logout, junto al resto de la limpieza.
   *
   * <p>El cambio de contexto <b>no</b> necesita llamarlo -la comparacion de epoca ya lo
   * invalida-, pero limpiar igual mantiene la propiedad de que despues de un logout no
   * queda ni el `Set` viejo en memoria.
   */
  limpiar(): void {
    this.cache.set(null);
  }
}
