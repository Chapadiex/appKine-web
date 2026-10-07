import { Component, WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

import { EstadoSesion, SessionService } from '../../core/services/session.service';
import { NavegacionPrincipal } from './navegacion-principal';
import { PERMISO_COLABORADOR_READ } from '../../core/models/permisos';
import { PermissionsStore } from '../../core/services/permissions.store';
import { PlatformRoleStore } from '../../core/services/platform-role.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../core/testing/axe';
import { TenantContextStore } from '../../core/services/tenant-context.store';
import { provideApi } from '../../api/generated/provide-api';

@Component({ template: 'pagina' })
class Pagina {}

/**
 * Navegacion principal.
 *
 * <p>Se prueba <b>lo que decide que se ve</b> y nada mas: que un enlace sin permiso no se
 * rinde, que sin contexto no hay navegacion, y que la seccion actual queda marcada para un
 * lector de pantalla. Que un enlace muestre su etiqueta no es comportamiento.
 *
 * <p>El router es real y no un doble: `aria-current` sale de `routerLinkActive`, y un doble
 * que devuelva `isActive` a gusto probaria el doble.
 */
describe('NavegacionPrincipal', () => {
  let estado: WritableSignal<EstadoSesion>;
  let httpMock: HttpTestingController;
  let tenant: TenantContextStore;
  let router: Router;
  let adminDePlataforma: WritableSignal<boolean>;

  beforeEach(() => {
    estado = signal<EstadoSesion>('activa');
    adminDePlataforma = signal(false);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi(''),
        provideRouter([
          { path: 'agenda', component: Pagina },
          { path: 'pacientes', component: Pagina },
          { path: 'horarios', component: Pagina },
          { path: 'organizacion', component: Pagina },
        ]),
        { provide: SessionService, useValue: { estado } },
        {
          provide: PlatformRoleStore,
          useValue: { esAdminDePlataforma: adminDePlataforma, asegurarCargado: () => undefined },
        },
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    tenant = TestBed.inject(TenantContextStore);
    router = TestBed.inject(Router);
  });

  afterEach(() => httpMock.verify());

  /**
   * Sin contexto no hay ninguna seccion que funcione: con un token `pre_context` el backend
   * corta todo endpoint de negocio con `403 missing-tenant-context`. Ofrecer el menu igual
   * seria ofrecer siete pantallas que se abren vacias.
   */
  it('sin contexto no muestra la navegacion y ofrece elegir donde trabajar', () => {
    estado.set('sin-contexto');

    const fixture = montar();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelector('nav')).toBeNull();

    const salida = html.querySelector<HTMLAnchorElement>('a.contexto__cambiar');
    expect(salida?.getAttribute('href')).toBe('/seleccionar-contexto');
  });

  /**
   * AKINE-A-7: un administrador de plataforma no tiene contexto, y el enlace a su consola es su
   * unica salida desde la cabecera. Con contexto, va al final del menu.
   */
  it('ofrece la consola de plataforma solo a quien la administra, con o sin contexto', () => {
    estado.set('sin-contexto');
    const sinContexto = montar();
    expect((sinContexto.nativeElement as HTMLElement).textContent).not.toContain('Consola');

    adminDePlataforma.set(true);
    sinContexto.detectChanges();
    const consola = Array.from(
      (sinContexto.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('a'),
    ).find((enlace) => enlace.textContent?.includes('Consola de plataforma'));
    expect(consola?.getAttribute('href')).toBe('/plataforma/solicitudes');

    estado.set('activa');
    conContexto();
    sinContexto.detectChanges();
    responderPermisos([]);
    sinContexto.detectChanges();
    expect(enlaces(sinContexto)).toContain('Plataforma');
  });

  /** Un anonimo esta en el login: no tiene a donde navegar y el selector tampoco le sirve. */
  it('sin sesion no muestra nada', () => {
    estado.set('anonimo');

    const fixture = montar();

    expect((fixture.nativeElement as HTMLElement).querySelector('a')).toBeNull();
  });

  /**
   * La regresion que importa: un enlace a una seccion que iba a terminar en "no tenes
   * permiso". Horarios es la unica seccion cuya ruta lleva `permissionGuard`, y sin
   * `colaborador:read` no puede aparecer.
   */
  it('esconde la seccion cuyo permiso falta y la muestra cuando llega', async () => {
    conContexto();
    const fixture = montar();
    responderPermisos([]);
    fixture.detectChanges();

    expect(enlaces(fixture)).not.toContain('Horarios');
    // Las que se autorizan por pertenencia no dependen de los permisos y se ven igual.
    expect(enlaces(fixture)).toContain('Agenda');

    // Mismo contexto, otro rol: el enlace aparece sin tocar nada mas.
    TestBed.inject(PermissionsStore).cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_COLABORADOR_READ] });
    fixture.detectChanges();

    expect(enlaces(fixture)).toContain('Horarios');
  });

  /**
   * `aria-current="page"` y no solo la clase CSS: el subrayado de color no existe para quien
   * usa un lector de pantalla, y "donde estoy" es la unica pregunta que un menu tiene que
   * poder responder.
   */
  it('marca la seccion actual con aria-current y solo esa', async () => {
    conContexto();
    const fixture = montar();
    responderPermisos([]);

    await router.navigateByUrl('/pacientes');
    fixture.detectChanges();

    const marcados = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>(
        'a[aria-current="page"]',
      ),
    ).map((enlace) => enlace.textContent?.trim());

    expect(marcados).toEqual(['Pacientes']);
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      conContexto();
      const fixture = montar();
      responderPermisos([PERMISO_COLABORADOR_READ]);
      fixture.detectChanges();

      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // --- Ayudantes ---------------------------------------------------------------------

  function montar(): ComponentFixture<NavegacionPrincipal> {
    const fixture = TestBed.createComponent(NavegacionPrincipal);
    fixture.detectChanges();
    return fixture;
  }

  function conContexto(): void {
    tenant.select({
      organizationId: 1,
      organizationName: 'Centro Kine',
      consultorioId: 2,
      consultorioName: 'Sede Centro',
    });
  }

  /** El menu pide los permisos solo: nadie mas lo hace en una pantalla sin `permissionGuard`. */
  function responderPermisos(permissions: readonly string[]): void {
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions });
  }

  function enlaces(fixture: ComponentFixture<NavegacionPrincipal>): (string | undefined)[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('.nav__enlace'),
    ).map((enlace) => enlace.textContent?.trim());
  }
});
