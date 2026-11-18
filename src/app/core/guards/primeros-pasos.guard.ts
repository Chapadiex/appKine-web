import { Injectable, inject, signal } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Observable, catchError, map, of, switchMap } from 'rxjs';

import { CalendarioDeSedeService } from '../../api/generated/api/calendario-de-sede.service';
import { ContratacionService } from '../../api/generated/api/contratacion.service';
import { OrganizacionesService } from '../../api/generated/api/organizaciones.service';
import { PERMISO_CONSULTORIO_MANAGE } from '../models/permisos';
import { PermissionsStore } from '../services/permissions.store';
import { SessionService } from '../services/session.service';
import { TenantContextStore } from '../services/tenant-context.store';
import { trasRestaurarSesion } from './tras-restaurar-sesion';

/** Query param que pone la pantalla de pasos de la sede en modo "configuración inicial". */
export const PARAM_CONFIGURACION_INICIAL = 'inicial';

/**
 * Lo que decidió quien entra por primera vez, sólo para esta pestaña.
 *
 * <p>En memoria y no en el storage a propósito: el lint prohíbe el storage (ADR-0001), y que la
 * guía vuelva a aparecer en el próximo ingreso mientras la sede siga sin horario es lo buscado.
 * Se guarda la organización para que "Ahora no" en un centro no lo apague en otro.
 */
@Injectable({ providedIn: 'root' })
export class PrimerosPasosStore {
  private readonly postergada = signal<ReadonlySet<number>>(new Set());

  postergar(orgId: number): void {
    this.postergada.update((actual) => new Set(actual).add(orgId));
  }

  estaPostergada(orgId: number): boolean {
    return this.postergada().has(orgId);
  }
}

/**
 * Onboarding mínimo (18/11/2026): el registro crea el centro con una sede vacía. La primera vez
 * que el dueño llega al inicio y esa única sede no tiene horario de atención, se lo lleva a la
 * pantalla de pasos de la sede para completarla, en vez de dejarlo frente a una agenda que no
 * ofrece nada.
 *
 * <p>Nunca bloquea: ante cualquier duda —sin permiso, más de una sede, un error de red— deja
 * pasar. Es UX; el backend no depende de esto.
 */
export const primerosPasosGuard: CanActivateFn = (_ruta, estado) => {
  const session = inject(SessionService);
  const permisos = inject(PermissionsStore);
  const tenant = inject(TenantContextStore);
  const primerosPasos = inject(PrimerosPasosStore);
  const organizaciones = inject(OrganizacionesService);
  const calendarios = inject(CalendarioDeSedeService);
  const contratacion = inject(ContratacionService);
  const router = inject(Router);

  // Al recargar la pagina la sesion todavia se esta restaurando: sin esperarla, el contexto se ve
  // vacio y la guia no aparece nunca en una carga directa.
  return trasRestaurarSesion(estado, () => {
    const orgId = tenant.organizationId();
    if (session.estado() !== 'activa' || orgId === null || primerosPasos.estaPostergada(orgId)) {
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
    // Solo un centro en prueba: nace del alta de la plataforma (18/11/2026), que es como entra
    // todo centro nuevo. Un centro autoregistrado o ya contratado no se desvia nunca.
    return contratacion.getContratacionDeOrganizacion({ orgId }).pipe(
      switchMap((c) =>
        c.estado === 'PRUEBA' && !c.soloLectura ? sedeSinHorario(orgId) : of(true),
      ),
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
            return of(true);
          }
          // Sólo interesa el horario general: la ventana de feriados es de un día y da igual
          // cuál. `hasta` es exclusivo, así que va al día siguiente.
          const hoy = new Date();
          const desde = hoy.toISOString().slice(0, 10);
          const hasta = new Date(hoy.getTime() + 86_400_000).toISOString().slice(0, 10);
          return calendarios.getCalendarioSede({ consultorioId: unica, desde, hasta }).pipe(
            map((calendario) =>
              (calendario.horarioGeneral?.length ?? 0) > 0
                ? true
                : router.createUrlTree(['/organizacion/sedes', unica, 'editar'], {
                    queryParams: { [PARAM_CONFIGURACION_INICIAL]: '1' },
                  }),
            ),
          );
        }),
        catchError(() => of(true)),
      );
  }
};
