import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';

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
