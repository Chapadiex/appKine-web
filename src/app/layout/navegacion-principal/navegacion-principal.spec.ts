import { Component, WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

import { EstadoSesion, SessionService } from '../../core/services/session.service';
import { NavegacionPrincipal } from './navegacion-principal';
import { PERMISO_COLABORADOR_READ, PERMISO_TURNO_READ } from '../../core/models/permisos';
import { MyProfileResponse } from '../../api/generated/model/my-profile-response';
import { PerfilPropioStore } from '../../core/services/perfil-propio.store';
import { PermissionsStore } from '../../core/services/permissions.store';
import { PlatformRoleStore } from '../../core/services/platform-role.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../core/testing/axe';
import { TenantContextStore } from '../../core/services/tenant-context.store';
import { provideApi } from '../../api/generated/provide-api';
import { seccionDe } from './secciones';

@Component({ template: 'pagina' })
class Pagina {}

/**
 * Barra lateral.
 *
 * <p>Se prueba <b>lo que decide que se ve</b> y nada mas: que un enlace sin permiso no se
 * rinde, que un grupo sin enlaces no se rinde, que sin contexto no hay barra, y que la seccion
 * actual queda marcada para un lector de pantalla y es una sola. Que un enlace muestre su
 * etiqueta no es comportamiento.
 *
 * <p>El router es real y no un doble: la seccion actual sale de la URL que el router navego.
 */
describe('NavegacionPrincipal', () => {
  let estado: WritableSignal<EstadoSesion>;
  let httpMock: HttpTestingController;
  let tenant: TenantContextStore;
  let router: Router;
  let adminDePlataforma: WritableSignal<boolean>;
  let restaurando: WritableSignal<boolean>;
  let perfil: WritableSignal<MyProfileResponse | null>;

  beforeEach(async () => {
    estado = signal<EstadoSesion>('activa');
    adminDePlataforma = signal(false);
    restaurando = signal(false);
    perfil = signal<MyProfileResponse | null>(null);

    await TestBed.configureTestingModule({
      imports: [NavegacionPrincipal],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi(''),
        provideRouter([
          { path: 'agenda', component: Pagina },
          { path: 'agenda/recepcion', component: Pagina },
          { path: 'agenda/ofertas/:id/reservar', component: Pagina },
          { path: 'pacientes', component: Pagina },
          { path: 'horarios', component: Pagina },
          { path: 'organizacion', component: Pagina },
          { path: 'plataforma/solicitudes', component: Pagina },
        ]),
        { provide: SessionService, useValue: { estado, restaurando } },
        {
          provide: PlatformRoleStore,
          useValue: { esAdminDePlataforma: adminDePlataforma, asegurarCargado: () => undefined },
        },
        {
          provide: PerfilPropioStore,
          useValue: { perfil, asegurarCargado: () => undefined },
        },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    tenant = TestBed.inject(TenantContextStore);
    router = TestBed.inject(Router);
  });

  afterEach(() => httpMock.verify());

  /**
   * Sin contexto no hay ninguna seccion que funcione: con un token `pre_context` el backend
   * corta todo endpoint de negocio con `403 missing-tenant-context`. La salida (elegir donde
   * trabajar) vive en la barra superior.
   */
  it('sin contexto no dibuja la barra', () => {
    estado.set('sin-contexto');

    const fixture = montar();

    expect((fixture.nativeElement as HTMLElement).querySelector('nav')).toBeNull();
  });

  /**
   * AKINE-LCP: el shell se dibuja con la restauracion de la sesion en vuelo. La barra espera;
   * los permisos, en cambio, se piden ya: es lo que adelanta.
   */
  it('con la restauracion en vuelo no dibuja la barra, pero ya pide los permisos', () => {
    restaurando.set(true);
    conContexto();
    const fixture = montar();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelector('nav')).toBeNull();
    responderPermisos([]);

    restaurando.set(false);
    fixture.detectChanges();
    expect(html.querySelector('nav')).not.toBeNull();
  });

  /** Un anonimo esta en el login: no tiene a donde navegar. */
  it('sin sesión no muestra nada', () => {
    estado.set('anonimo');

    const fixture = montar();

    expect((fixture.nativeElement as HTMLElement).querySelector('nav')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');
  });

  it('esconde la sección cuyo permiso falta y la muestra cuando llega', async () => {
    conContexto();
    const fixture = montar();
    responderPermisos([]);
    fixture.detectChanges();

    expect(enlaces(fixture)).not.toContain('Horarios de profesionales');
    // DP-22: el padron exige `paciente:read`.
    expect(enlaces(fixture)).not.toContain('Padrón');
    // Las que se autorizan por pertenencia no dependen de los permisos y se ven igual.
    expect(enlaces(fixture)).toContain('Agenda');

    // Mismo contexto, otro rol: el enlace aparece sin tocar nada mas.
    TestBed.inject(PermissionsStore).cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_COLABORADOR_READ] });
    fixture.detectChanges();

    expect(enlaces(fixture)).toContain('Horarios de profesionales');
  });

  /**
   * Un grupo sin secciones visibles no deja una cabecera huerfana, y uno con una sola seccion no se
   * despliega: su enlace va directo. Sin permisos quedan Agenda (sola, directa) y los grupos con secciones sin permiso.
   */
  it('no dibuja un grupo vacío y no despliega uno de una sola sección', () => {
    conContexto();
    const fixture = montar();
    responderPermisos([]);
    fixture.detectChanges();

    expect(rotulos(fixture)).toEqual([
      'Servicios y catálogo',
      'Espacios y horarios',
      'Configuración',
    ]);
    expect(enlaces(fixture)).toContain('Agenda');

    TestBed.inject(PermissionsStore).cargar().subscribe();
    httpMock
      .expectOne(RUTA_PERMISOS_EFECTIVOS)
      .flush({ permissions: [PERMISO_TURNO_READ, 'clase:read', 'inscripcion:read'] });
    fixture.detectChanges();

    expect(rotulos(fixture)).toEqual([
      'Atención',
      'Actividades',
      'Servicios y catálogo',
      'Espacios y horarios',
      'Configuración',
    ]);
  });

  /** Acordeon: llega desplegado el grupo de la pantalla actual, y solo ese. */
  it('despliega solo el grupo de la sección actual, y lo sigue al navegar', async () => {
    conContexto();
    const fixture = montar();
    responderPermisos([PERMISO_TURNO_READ]);

    await router.navigateByUrl('/agenda/recepcion');
    fixture.detectChanges();
    expect(desplegados(fixture)).toEqual(['Atención']);

    await router.navigateByUrl('/organizacion');
    fixture.detectChanges();
    expect(desplegados(fixture)).toEqual(['Configuración']);
  });

  /**
   * `aria-current="page"` y no solo la clase CSS: el color no existe para quien usa un lector de
   * pantalla, y "donde estoy" es la unica pregunta que un menu tiene que poder responder. Y es
   * UNA: en `/agenda/recepcion` gana la de ruta mas larga, no las dos.
   */
  it('marca la sección actual con aria-current y solo esa, por prefijo mas largo', async () => {
    conContexto();
    const fixture = montar();
    responderPermisos([PERMISO_TURNO_READ]);

    await router.navigateByUrl('/agenda');
    fixture.detectChanges();
    expect(marcados(fixture)).toEqual(['Agenda']);

    await router.navigateByUrl('/agenda/recepcion');
    fixture.detectChanges();
    expect(marcados(fixture)).toEqual(['Recepción del día']);

    await router.navigateByUrl('/agenda/ofertas/7/reservar');
    fixture.detectChanges();
    expect(marcados(fixture)).toEqual(['Agenda']);
  });

  /** AKINE-A-7: con contexto, la consola del administrador de plataforma va al pie del menu. */
  it('ofrece la consola de plataforma solo a quien la administra, y la marca como actual', async () => {
    conContexto();
    const fixture = montar();
    responderPermisos([]);
    fixture.detectChanges();
    expect(enlaces(fixture)).not.toContain('Plataforma');

    adminDePlataforma.set(true);
    fixture.detectChanges();
    expect(enlaces(fixture)).toContain('Plataforma');

    await router.navigateByUrl('/plataforma/solicitudes');
    fixture.detectChanges();
    expect(marcados(fixture)).toEqual(['Plataforma']);
  });

  /**
   * DP-45: el pie dice quien ingreso y con que rol. Se monta aparte, despues de la primera
   * pintura; hasta entonces, y mientras `/me` no responde, queda el centro solo, como antes.
   */
  it('muestra al pie el nombre y el rol de quien ingresó, sin perder el centro ni la salida', async () => {
    conContexto();
    const fixture = montar();
    responderPermisos([]);
    fixture.detectChanges();
    const pie = (fixture.nativeElement as HTMLElement).querySelector('.nav__sesion')!;

    expect(pie.textContent).toContain('Centro Kine');
    expect(pie.querySelector('.nav__avatar')?.textContent?.trim()).toBe('CK');

    // El componente llega por un `import()` dinamico: se espera a que quede montado.
    for (let intento = 0; intento < 50 && !pie.querySelector('app-quien-ingreso'); intento++) {
      await new Promise((listo) => setTimeout(listo));
      fixture.detectChanges();
    }
    expect(pie.querySelector('app-quien-ingreso')).not.toBeNull();
    expect(pie.textContent).toContain('Centro Kine');
    expect(pie.textContent).not.toContain('Administración');

    perfil.set({
      firstName: 'Ana',
      lastName: 'Prueba',
      context: { roleCode: 'ORG_ADMIN', roleLabel: 'Administración' },
    });
    fixture.detectChanges();

    expect(pie.textContent).toContain('Ana Prueba');
    expect(pie.textContent).toContain('Administración · Centro Kine');
    expect(pie.textContent).toContain('Cambiar de sede');
    expect(pie.textContent).toContain('Cerrar sesión');
  });

  /** Navegar desde el panel de tablet lo cierra: el shell escucha `cerrar`. */
  it('pide cerrar el panel al navegar', () => {
    conContexto();
    const fixture = montar();
    responderPermisos([]);
    fixture.detectChanges();

    let cerrado = 0;
    fixture.componentInstance.cerrar.subscribe(() => cerrado++);
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLAnchorElement>('.nav__enlace')
      ?.click();

    expect(cerrado).toBe(1);
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

  describe('seccionDe', () => {
    const secciones = [
      { etiqueta: 'Agenda', ruta: '/agenda' },
      { etiqueta: 'Recepcion', ruta: '/agenda/recepcion' },
    ];

    it('ignora la query y el fragmento, y no confunde prefijos de texto con segmentos', () => {
      expect(seccionDe('/agenda/recepcion?fecha=2026-10-21', secciones)?.etiqueta).toBe(
        'Recepcion',
      );
      expect(seccionDe('/agendas', secciones)).toBeNull();
      expect(seccionDe('/otra', secciones)).toBeNull();
    });
  });

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

  function rotulos(fixture: ComponentFixture<NavegacionPrincipal>): (string | undefined)[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.nav__rotulo'),
    ).map((rotulo) => rotulo.textContent?.trim());
  }

  function desplegados(fixture: ComponentFixture<NavegacionPrincipal>): (string | undefined)[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLDetailsElement>('details[open]'),
    ).map((grupo) => grupo.querySelector('.nav__rotulo')?.textContent?.trim());
  }

  function marcados(fixture: ComponentFixture<NavegacionPrincipal>): (string | undefined)[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>(
        'a[aria-current="page"]',
      ),
    ).map((enlace) => enlace.textContent?.trim());
  }
});
