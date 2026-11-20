import { Injectable, inject, signal } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Observable, catchError, map, of, switchMap } from 'rxjs';

import { CalendarioDeSedeService } from '../../api/generated/api/calendario-de-sede.service';
import { ContratacionService } from '../../api/generated/api/contratacion.service';
import { OrganizacionesService } from '../../api/generated/api/organizaciones.service';
import { PERMISO_CONSULTORIO_MANAGE } from '../models/permisos';
import { ContratacionStore } from '../services/contratacion.store';
import { PermissionsStore } from '../services/permissions.store';
import { SessionService } from '../services/session.service';
import { TenantContextStore } from '../services/tenant-context.store';
import { trasRestaurarSesion } from './tras-restaurar-sesion';

/** Query param que pone la pantalla de pasos de la sede en modo "configuración inicial". */
export const PARAM_CONFIGURACION_INICIAL = 'inicial';

/**
 * Centros que ya terminaron la configuración inicial, en esta pestaña (20/11/2026).
 *
 * <p>La guía es obligatoria y el guard corre en cada navegación: sin esto, un centro dado de alta
 * por la plataforma pediría su contratación y su calendario a la red en cada pantalla, para
 * siempre. En memoria y no en el storage (ADR-0001): en el próximo ingreso se vuelve a mirar una vez.
 */
@Injectable({ providedIn: 'root' })
export class PrimerosPasosStore {
  private readonly completos = signal<ReadonlySet<number>>(new Set());

  marcarCompleto(orgId: number): void {
    this.completos.update((actual) => new Set(actual).add(orgId));
  }

  estaCompleto(orgId: number): boolean {
    return this.completos().has(orgId);
  }

  /** La bienvenida se muestra una vez por centro y por pestaña. */
  private readonly bienvenidas = signal<ReadonlySet<number>>(new Set());

  marcarBienvenidaVista(orgId: number): void {
    this.bienvenidas.update((actual) => new Set(actual).add(orgId));
  }

  bienvenidaVista(orgId: number): boolean {
    return this.bienvenidas().has(orgId);
  }
}

/**
 * Lo que la guía deja abrir aunque la sede no tenga horario: la configuración misma (los pasos de
 * la sede) y nada más dentro del centro. Lo de fuera del centro —ingreso, cuenta, plataforma,
 * landing— no lleva este guard (ver `conPrimerosPasos` en `app.routes.ts`).
 */
const RUTA_DE_LA_CONFIGURACION = /^\/organizacion\/sedes\/\d+\/editar(\?|$)/;

/**
 * Onboarding mínimo (18/11/2026): el registro crea el centro con una sede vacía. La primera vez
 * que el dueño llega al inicio y esa única sede no tiene horario de atención, se lo lleva a la
 * pantalla de pasos de la sede para completarla, en vez de dejarlo frente a una agenda que no
 * ofrece nada.
 *
 * <p><b>Obligatoria desde el 20/11/2026:</b> corre en todas las pantallas del centro y lleva a la
 * configuración hasta que la sede tenga horario. Ante cualquier duda —sin permiso, más de una
 * sede, un error de red— deja pasar: es UX y el backend no depende de esto.
 */
export const primerosPasosGuard: CanActivateFn = (_ruta, estado) => {
  const session = inject(SessionService);
  const permisos = inject(PermissionsStore);
  const tenant = inject(TenantContextStore);
  const primerosPasos = inject(PrimerosPasosStore);
  const organizaciones = inject(OrganizacionesService);
  const calendarios = inject(CalendarioDeSedeService);
  const contratacion = inject(ContratacionService);
  const contratacionDelCentro = inject(ContratacionStore);
  const router = inject(Router);

  // Al recargar la pagina la sesion todavia se esta restaurando: sin esperarla, el contexto se ve
  // vacio y la guia no aparece nunca en una carga directa.
  return trasRestaurarSesion(estado, () => {
    const orgId = tenant.organizationId();
    if (
      session.estado() !== 'activa' ||
      orgId === null ||
      primerosPasos.estaCompleto(orgId) ||
      RUTA_DE_LA_CONFIGURACION.test(estado.url)
    ) {
      return true;
    }
    // Lo comun, sin esperar a la red: el shell ya leyo la contratacion y el centro no lo dio de
    // alta la plataforma. Un guard que pide HTTP en cada entrada demora la navegacion, y una segunda navegacion
    // en el medio deja la pantalla anterior sin recargar.
    const leida = contratacionDelCentro.contratacion();
    if (leida !== null && (!leida.altaPorPlataforma || leida.soloLectura)) {
      primerosPasos.marcarCompleto(orgId);
      return true;
    }
    return permisos.cargados()
      ? decidir(orgId)
      : permisos.cargar().pipe(
          switchMap(() => decidir(orgId)),
          catchError(() => of(true)),
        );
  });

  function decidir(orgId: number): Observable<boolean | UrlTree> {
    if (!permisos.tiene(PERMISO_CONSULTORIO_MANAGE)) {
      return of(true);
    }
    // Solo un centro que dio de alta la plataforma (18/11/2026), que es como entra todo centro
    // nuevo, en prueba o ya contratado (20/11/2026: antes se exigia la prueba y un alta contratada
    // no veia la guia). Un centro autoregistrado no se desvia nunca.
    return contratacion.getContratacionDeOrganizacion({ orgId }).pipe(
      switchMap((c) => {
        if (c.altaPorPlataforma && !c.soloLectura) {
          return sedeSinHorario(orgId);
        }
        primerosPasos.marcarCompleto(orgId);
        return of(true);
      }),
      catchError(() => of(true)),
    );
  }

  function sedeSinHorario(orgId: number): Observable<boolean | UrlTree> {
    return organizaciones
      .listOrganizationConsultorios({ orgId, estado: 'ACTIVO', page: 0, size: 2 })
      .pipe(
        switchMap((pagina) => {
          const sedes = pagina.content ?? [];
          const unica = sedes.length === 1 ? sedes[0]?.id : undefined;
          if (unica === undefined) {
            primerosPasos.marcarCompleto(orgId);
            return of(true);
          }
          // Sólo interesa el horario general: la ventana de feriados es de un día y da igual
          // cuál. `hasta` es exclusivo, así que va al día siguiente.
          const hoy = new Date();
          const desde = hoy.toISOString().slice(0, 10);
          const hasta = new Date(hoy.getTime() + 86_400_000).toISOString().slice(0, 10);
          return calendarios.getCalendarioSede({ consultorioId: unica, desde, hasta }).pipe(
            map((calendario) => {
              if ((calendario.horarioGeneral?.length ?? 0) > 0) {
                primerosPasos.marcarCompleto(orgId);
                return true;
              }
              return router.createUrlTree(['/organizacion/sedes', unica, 'editar'], {
                queryParams: { [PARAM_CONFIGURACION_INICIAL]: '1' },
              });
            }),
          );
        }),
        catchError(() => of(true)),
      );
  }
};
