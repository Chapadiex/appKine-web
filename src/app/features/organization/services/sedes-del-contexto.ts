import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { catchError, of, tap } from 'rxjs';

import { ConsultorioResponse } from '../../../api/generated/model/consultorio-response';
import { OrganizacionesService } from '../../../api/generated/api/organizaciones.service';
import { TenantContextStore } from '../../../core/services/tenant-context.store';

/** Tope del backend por request. Una organizacion con mas sedes necesita paginar aca. */
const SEDES_POR_PAGINA = 100;

/**
 * Sedes de la organizacion activa, para poblar los selectores de alcance.
 *
 * <p><b>Por que existe.</b> Tanto el alta de colaborador como el cambio de alcance piden un
 * `consultorioId`. Ofrecer un campo numerico libre convierte un error de tipeo en un `404`
 * -"la sede no es de esta organizacion"- que el usuario no puede diagnosticar, y ademas
 * invita a probar ids ajenos. Con un `select` poblado desde
 * `GET /organizations/{orgId}/consultorios` el caso simplemente no se puede construir desde
 * la interfaz. El backend valida igual: esto es UX, no un control.
 *
 * <p><b>Vive en `features/organization/services` y no en `core/`.</b> Es estado de feature
 * -AGENT.md seccion 4 prohibe estado de feature en `core/`- y las dos pantallas que lo usan
 * son de esta misma feature, asi que no hay import cruzado.
 *
 * <p><b>Se invalida por epoca de contexto</b>, igual que {@link PermissionsStore}: las sedes
 * de la Organizacion A no existen bajo la B, y el cache tiene que dejar de ser vigente en el
 * mismo tick del cambio y no cuando llegue una respuesta nueva. Sin eso el selector de sede
 * ofreceria, durante un render, sedes de otro tenant — que es exactamente la fuga que el
 * aislamiento tiene que evitar.
 */
@Injectable({ providedIn: 'root' })
export class SedesDelContexto {
  private readonly organizaciones = inject(OrganizacionesService);
  private readonly tenant = inject(TenantContextStore);

  private readonly cache = signal<{
    readonly epoca: number;
    readonly sedes: readonly ConsultorioResponse[];
  } | null>(null);

  private readonly vigente = computed(() => {
    const cache = this.cache();
    return cache !== null && cache.epoca === this.tenant.contextEpoch() ? cache : null;
  });

  /** Sedes del contexto activo. Vacio mientras no haya una carga vigente. */
  readonly sedes: Signal<readonly ConsultorioResponse[]> = computed(
    () => this.vigente()?.sedes ?? [],
  );

  /** `true` si ya se resolvio una carga de ESTE contexto (con o sin resultados). */
  readonly cargadas: Signal<boolean> = computed(() => this.vigente() !== null);

  /**
   * `true` cuando la sede sobre la que esta parado el contexto activo ya no esta vigente.
   *
   * <p><b>Por que se puede deducir asi.</b> Esta lista pide `estado=ACTIVO`, asi que una
   * sede que estaba en el contexto y no aparece aca es una sede dada de baja —o una a la que
   * la cuenta dejo de tener acceso—. En los dos casos la conclusion operativa es la misma:
   * ese contexto ya no sirve para trabajar.
   *
   * <p><b>Por que importa.</b> Una sede inactiva no recibe operaciones nuevas. Sin este
   * aviso, el usuario sigue con un contexto que parece valido y descubre el problema recien
   * cuando el backend rechaza lo que intento hacer, con un error que no le dice que su sede
   * se dio de baja. La salida correcta es mandarlo a elegir otra.
   *
   * <p>Es `false` mientras la lista no haya cargado: sin datos no se puede afirmar que la
   * sede no esta, y un cartel de "tu sede se dio de baja" que aparece por una peticion
   * todavia en vuelo seria peor que no mostrar nada.
   */
  readonly sedeDelContextoInactiva: Signal<boolean> = computed(() => {
    const consultorioId = this.tenant.consultorioId();
    if (!this.cargadas() || consultorioId === null) {
      return false;
    }
    return !this.sedes().some((sede) => sede.id === consultorioId);
  });

  /**
   * Descarta la lista cargada para que la proxima consulta la vuelva a pedir.
   *
   * <p>La usan las pantallas que <b>cambian</b> las sedes: dar de alta una o darla de baja
   * deja este cache mintiendo, y el selector de sede del alta de colaborador seguiria
   * ofreciendo una sede que ya no existe hasta el proximo cambio de contexto.
   */
  invalidar(): void {
    this.cache.set(null);
  }

  /**
   * Carga las sedes si todavia no estan las de este contexto.
   *
   * <p><b>El error no se propaga: se traga a proposito.</b> El selector de sede es un
   * accesorio de dos formularios que tienen su propio manejo de errores; si esta lista no
   * llega, lo correcto es que el formulario siga siendo usable con la opcion "toda la
   * organizacion" y no que la pantalla entera muestre un cartel rojo por una peticion
   * secundaria. La operacion real -el alta, el cambio de alcance- si reporta lo suyo.
   */
  asegurarCargadas(): void {
    if (this.cargadas()) {
      return;
    }

    const orgId = this.tenant.organizationId();
    if (orgId === null) {
      return;
    }

    const epoca = this.tenant.contextEpoch();

    this.organizaciones
      // `estado: 'ACTIVO'` explicito aunque sea el default del contrato: de este valor
      // depende {@link sedeDelContextoInactiva}, y un cambio del default del backend lo
      // convertiria en silencio en un signal que nunca es `true`.
      .listOrganizationConsultorios({ orgId, estado: 'ACTIVO', page: 0, size: SEDES_POR_PAGINA })
      .pipe(
        tap((respuesta) => {
          // Una respuesta que llega despues de un cambio de contexto es de la organizacion
          // anterior: se descarta en vez de guardarse, igual que en PermissionsStore.
          if (this.tenant.contextEpoch() !== epoca) {
            return;
          }
          this.cache.set({ epoca, sedes: respuesta.content ?? [] });
        }),
        catchError(() => of(null)),
      )
      .subscribe();
  }
}
