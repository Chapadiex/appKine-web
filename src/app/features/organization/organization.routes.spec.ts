import { ActivatedRouteSnapshot, Router, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { Type } from '@angular/core';

import { AuditPage } from './pages/audit/audit-page';
import { CollaboratorsPage } from './pages/collaborators/collaborators-page';
import { ConsultoriosPage } from './pages/consultorios/consultorios-page';
import { InvitacionesPage } from './pages/invitaciones/invitaciones-page';
import { NewCollaboratorPage } from './pages/new-collaborator/new-collaborator-page';
import { NewConsultorioPage } from './pages/new-consultorio/new-consultorio-page';
import { OrganizationPage } from './pages/organization/organization-page';
import { SubscriptionPage } from './pages/subscription/subscription-page';
import { NotFound } from '../../shared/pages/not-found/not-found';
import { PermissionsStore } from '../../core/services/permissions.store';
import { SessionService } from '../../core/services/session.service';
import { routes as rutasDeLaApp } from '../../app.routes';

/**
 * Pineo de los prefijos de ruta de `/organizacion` (M01/M05/M24, deuda de AKINE-01.02/02.03).
 *
 * <p>Misma forma que `horarios.routes.spec.ts` (AKINE-02.04) y `auth.routes.spec.ts`: navega
 * de verdad contra `app.routes.ts` y comprueba a que componente llega cada URL, en vez de
 * confiar en que el path escrito en `organization.routes.ts` coincide con el que alguien
 * enlaza desde una plantilla.
 *
 * <p><b>Sin constante propia.</b> Ningun archivo de `organization` concentra estos ocho
 * literales — a diferencia de `/horarios`, aca no existe todavia un `rutas-de-organizacion.ts`
 * del que derivarlos, y crear uno no es parte de esta tarea: `core/models/rutas.ts` y
 * `features/resource/models/rutas-de-horarios.ts` son las dos convenciones existentes, y
 * ninguna aplica a pantallas que ninguna otra parte del codigo necesita nombrar por ahora
 * (documentado en el reporte de esta tarea).
 *
 * <p>Los guards se doblan igual que en `horarios.routes.spec.ts`: lo que se prueba aca es el
 * mapeo URL → componente, no que `authGuard`, `contextGuard` o `permissionGuard` decidan bien
 * — eso ya lo cubren sus propios specs.
 */
describe('Rutas de /organizacion', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(rutasDeLaApp),
        { provide: SessionService, useValue: { estado: () => 'activa' } },
        {
          provide: PermissionsStore,
          useValue: { cargados: () => true, tieneAlguno: () => true, tiene: () => true },
        },
      ],
    });

    router = TestBed.inject(Router);
  });

  it('cada una de las ocho resuelve a su pantalla', async () => {
    expect(await componenteDe('/organizacion')).toBe(OrganizationPage);
    expect(await componenteDe('/organizacion/suscripcion')).toBe(SubscriptionPage);
    expect(await componenteDe('/organizacion/colaboradores/nuevo')).toBe(NewCollaboratorPage);
    expect(await componenteDe('/organizacion/colaboradores/invitaciones')).toBe(InvitacionesPage);
    expect(await componenteDe('/organizacion/colaboradores')).toBe(CollaboratorsPage);
    expect(await componenteDe('/organizacion/sedes/nueva')).toBe(NewConsultorioPage);
    expect(await componenteDe('/organizacion/sedes')).toBe(ConsultoriosPage);
    expect(await componenteDe('/organizacion/auditoria')).toBe(AuditPage);
  });

  it('ninguna de las ocho cae en el comodin', async () => {
    const urls = [
      '/organizacion',
      '/organizacion/suscripcion',
      '/organizacion/colaboradores/nuevo',
      '/organizacion/colaboradores/invitaciones',
      '/organizacion/colaboradores',
      '/organizacion/sedes/nueva',
      '/organizacion/sedes',
      '/organizacion/auditoria',
    ];
    for (const url of urls) {
      expect(await componenteDe(url)).not.toBe(NotFound);
    }
  });

  it('un segmento inventado bajo /organizacion si cae en el comodin', async () => {
    // La contracara del test anterior: sin esto, un `componenteDe` roto que devolviera
    // siempre algo distinto de NotFound haria pasar la afirmacion de arriba sin probar nada.
    expect(await componenteDe('/organizacion/inventado')).toBe(NotFound);
  });

  /** Navega de verdad y devuelve el componente de la hoja activada. */
  async function componenteDe(url: string): Promise<Type<unknown> | null> {
    const navego = await router.navigateByUrl(url);
    expect(navego).toBe(true);

    let nodo: ActivatedRouteSnapshot = router.routerState.snapshot.root;
    while (nodo.firstChild !== null) {
      nodo = nodo.firstChild;
    }
    return nodo.component as Type<unknown> | null;
  }
});
