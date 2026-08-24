import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PermisoDirective } from './permiso.directive';
import { PERMISO_COLABORADOR_MANAGE, PERMISO_COLABORADOR_READ } from '../../core/models/permisos';
import { PermissionsStore } from '../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../core/testing/rutas-api';
import { TenantContextStore } from '../../core/services/tenant-context.store';
import { provideApi } from '../../api/generated/provide-api';

const ORG_A = { organizationId: 1, organizationName: 'Centro Kine A', consultorioId: 10 };
const ORG_B = { organizationId: 2, organizationName: 'Centro Kine B', consultorioId: 20 };

@Component({
  selector: 'app-host-permiso',
  imports: [PermisoDirective],
  template: ` <button type="button" *akinePermiso="pedido()">Invitar colaborador</button> `,
})
class HostPermiso {
  readonly pedido = signal<string | readonly string[]>(PERMISO_COLABORADOR_MANAGE);
}

/**
 * Verifica la directiva estructural de permisos (AKINE-01.03).
 *
 * <p><b>Ocultar no es autorizar.</b> Lo que se prueba es que la interfaz no ofrezca
 * acciones que van a terminar en `403`, no que alguien quede impedido de invocarlas: el
 * endpoint sigue estando ahi y el backend es el que decide.
 */
describe('PermisoDirective', () => {
  let fixture: ComponentFixture<HostPermiso>;
  let store: PermissionsStore;
  let tenant: TenantContextStore;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideApi('')],
    });

    store = TestBed.inject(PermissionsStore);
    tenant = TestBed.inject(TenantContextStore);
    httpMock = TestBed.inject(HttpTestingController);

    fixture = TestBed.createComponent(HostPermiso);
  });

  afterEach(() => httpMock.verify());

  it('mientras los permisos no cargaron, OCULTA', () => {
    tenant.select(ORG_A);
    fixture.detectChanges();

    // Decision explicita: durante la ventana entre montar la pantalla y la respuesta de
    // GET /me/permissions se elige ocultar. Mostrar y despues ocultar deja clickear una
    // accion cuyo dano ya no se deshace; ocultar y despues mostrar solo agrega contenido.
    expect(hayBoton()).toBe(false);
  });

  it('con el permiso, muestra', () => {
    tenant.select(ORG_A);
    cargar([PERMISO_COLABORADOR_MANAGE]);
    fixture.detectChanges();

    expect(hayBoton()).toBe(true);
  });

  it('cargados pero sin el permiso, oculta', () => {
    tenant.select(ORG_A);
    cargar([PERMISO_COLABORADOR_READ]);
    fixture.detectChanges();

    expect(hayBoton()).toBe(false);
  });

  it('con una lista, alcanza tener alguno', () => {
    tenant.select(ORG_A);
    cargar([PERMISO_COLABORADOR_READ]);
    fixture.componentInstance.pedido.set([PERMISO_COLABORADOR_MANAGE, PERMISO_COLABORADOR_READ]);
    fixture.detectChanges();

    expect(hayBoton()).toBe(true);
  });

  it('cambiar el permiso pedido reevalua sin recrear la vista dos veces', () => {
    tenant.select(ORG_A);
    cargar([PERMISO_COLABORADOR_MANAGE]);
    fixture.detectChanges();
    expect(hayBoton()).toBe(true);

    fixture.componentInstance.pedido.set(PERMISO_COLABORADOR_READ);
    fixture.detectChanges();
    expect(hayBoton()).toBe(false);

    fixture.componentInstance.pedido.set(PERMISO_COLABORADOR_MANAGE);
    fixture.detectChanges();
    expect(botones().length).toBe(1);
  });

  it('al cambiar de contexto el boton desaparece en el primer render', () => {
    tenant.select(ORG_A);
    cargar([PERMISO_COLABORADOR_MANAGE]);
    fixture.detectChanges();
    expect(hayBoton()).toBe(true);

    // Mismo usuario, otra organizacion. Sin recargar nada mas.
    tenant.select(ORG_B);
    fixture.detectChanges();

    // Los permisos de la Org A no sobreviven ni un render bajo la Org B: la accion se
    // esconde con el cambio de contexto, no cuando llegue la respuesta de la nueva carga.
    expect(hayBoton()).toBe(false);
  });

  it('los permisos del contexto nuevo vuelven a mostrarlo', () => {
    tenant.select(ORG_A);
    cargar([PERMISO_COLABORADOR_MANAGE]);
    fixture.detectChanges();

    tenant.select(ORG_B);
    cargar([PERMISO_COLABORADOR_MANAGE]);
    fixture.detectChanges();

    expect(hayBoton()).toBe(true);
  });

  // --- Ayudas ----------------------------------------------------------------------

  function cargar(permissions: string[]): void {
    store.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions });
  }

  function botones(): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('button'));
  }

  function hayBoton(): boolean {
    return botones().length > 0;
  }
});
