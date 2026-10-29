import { ApplicationRef, Component, WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { AuthorizedContextResponse } from '../../api/generated/model/authorized-context-response';
import { BarraSuperior } from './barra-superior';
import { EstadoSesion, SessionService } from '../../core/services/session.service';
import { MigasStore } from '../../core/services/migas.store';
import { MyProfileResponse } from '../../api/generated/model/my-profile-response';
import { PermissionsStore } from '../../core/services/permissions.store';
import { PerfilPropioStore } from '../../core/services/perfil-propio.store';
import { PlatformRoleStore } from '../../core/services/platform-role.store';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../core/testing/axe';
import { TenantContextStore } from '../../core/services/tenant-context.store';

@Component({ template: 'pagina' })
class Pagina {}

/**
 * Barra superior (cabecera global, 28/10/2026).
 *
 * <p>Se prueba lo que decide que se ve: sin contexto, la unica salida y la cuenta; con contexto,
 * el titulo de la pantalla, la sede (fija con una, desplegable con varias) y el perfil con su
 * menu; y que el boton de menu dice si el panel esta abierto y avisa al shell.
 */
describe('BarraSuperior', () => {
  let estado: WritableSignal<EstadoSesion>;
  let restaurando: WritableSignal<boolean>;
  let adminDePlataforma: WritableSignal<boolean>;
  let contextos: WritableSignal<AuthorizedContextResponse[]>;
  let perfil: WritableSignal<MyProfileResponse | null>;
  let logout: ReturnType<typeof vi.fn>;
  let tenant: TenantContextStore;

  beforeEach(() => {
    estado = signal<EstadoSesion>('activa');
    restaurando = signal(false);
    adminDePlataforma = signal(false);
    contextos = signal<AuthorizedContextResponse[]>([]);
    perfil = signal<MyProfileResponse | null>(null);
    logout = vi.fn(() => of(undefined));

    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'organizacion', component: Pagina, title: 'AKINE - Organización' },
          { path: 'egresos/:id', component: Pagina, title: 'AKINE - Detalle del egreso' },
          { path: 'pacientes/:id/coberturas', component: Pagina, title: 'AKINE - Coberturas' },
          { path: 'auth/ingresar', component: Pagina },
        ]),
        {
          provide: SessionService,
          useValue: {
            estado,
            restaurando,
            contextos,
            epocaDeIdentidad: signal(1),
            cargarContextos: () => of([]),
            logout,
          },
        },
        {
          provide: PlatformRoleStore,
          useValue: { esAdminDePlataforma: adminDePlataforma, asegurarCargado: () => undefined },
        },
        { provide: PerfilPropioStore, useValue: { perfil, asegurarCargado: () => undefined } },
      ],
    });
    tenant = TestBed.inject(TenantContextStore);
  });

  it('sin contexto ofrece elegir donde trabajar, la consola solo a quien la administra, y la cuenta', async () => {
    estado.set('sin-contexto');
    const fixture = await montar();
    const html = fixture.nativeElement as HTMLElement;

    expect(enlace(html, 'Elegí donde vas a trabajar')?.getAttribute('href')).toBe(
      '/seleccionar-contexto',
    );
    expect(enlace(html, 'Consola de plataforma')).toBeUndefined();
    expect(html.querySelector('app-selector-de-sede')).toBeNull();
    expect(html.querySelector('app-menu-de-perfil')).not.toBeNull();

    adminDePlataforma.set(true);
    fixture.detectChanges();
    expect(enlace(html, 'Consola de plataforma')?.getAttribute('href')).toBe(
      '/plataforma/solicitudes',
    );
  });

  it('con contexto dice donde estoy, donde trabajo y quien soy', async () => {
    conContexto();
    perfil.set({ firstName: 'Ana', lastName: 'Admin', email: 'ana@ejemplo.test' });
    const fixture = await montar();
    await TestBed.inject(Router).navigateByUrl('/organizacion');
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelector('.titulo')?.textContent?.trim()).toBe('Organización');
    // Una seccion del menu es la raiz: un solo paso, sin ruta de navegacion.
    expect(html.querySelector('nav[aria-label="Ubicación"]')).toBeNull();
    expect(html.querySelector('.sede__nombre')?.textContent?.trim()).toBe('Sede Centro');
    expect(html.querySelector('.perfil__avatar')?.textContent?.trim()).toBe('AA');
    expect(html.querySelector('.perfil__nombre')?.textContent?.trim()).toBe('Ana Admin');
    // La marca vive en la barra lateral cuando hay contexto, y el cambio de sede ya no es un enlace.
    expect(html.querySelector('.marca')).toBeNull();
    expect(enlace(html, 'Cambiar')).toBeUndefined();
  });

  describe('ruta de navegacion', () => {
    it(
      'en una pantalla hija ofrece volver a la seccion del menu que la contiene',
      async () => {
        conContexto();
        permisos(true);
        const html = await abrir('/egresos/7');

        const ubicacion = html.querySelector('nav[aria-label="Ubicación"]')!;
        expect(pasos(ubicacion)).toEqual(['Egresos', 'Detalle del egreso']);
        expect(enlace(html, 'Egresos')?.getAttribute('href')).toBe('/egresos');
        const actual = ubicacion.querySelector('[aria-current="page"]');
        expect(actual?.textContent?.trim()).toBe('Detalle del egreso');
        expect(actual?.tagName).not.toBe('A');
        await esperarSinViolaciones(html);
      },
      TIMEOUT_AXE,
    );

    it('no ofrece una seccion que la sesion no puede abrir', async () => {
      conContexto();
      permisos(false);
      const html = await abrir('/egresos/7');

      expect(html.querySelector('nav[aria-label="Ubicación"]')).toBeNull();
      expect(html.querySelector('.titulo')?.textContent?.trim()).toBe('Detalle del egreso');
    });

    it('las migas de la pantalla mandan: nombres propios y el nombre de la actual', async () => {
      conContexto();
      permisos(true);
      const dueno = {};
      TestBed.inject(MigasStore).publicar(dueno, [
        { etiqueta: 'Padrón', ruta: '/pacientes' },
        { etiqueta: 'Pérez, Ana', ruta: ['/pacientes', 7] },
        { etiqueta: 'Coberturas del paciente' },
      ]);
      const html = await abrir('/pacientes/7/coberturas');

      const ubicacion = html.querySelector('nav[aria-label="Ubicación"]')!;
      expect(pasos(ubicacion)).toEqual(['Padrón', 'Pérez, Ana', 'Coberturas del paciente']);
      expect(enlace(html, 'Pérez, Ana')?.getAttribute('href')).toBe('/pacientes/7');
      // En telefono queda solo el paso anterior, como "volver".
      expect(ubicacion.querySelector('.ubicacion__paso--padre')?.textContent?.trim()).toBe(
        'Pérez, Ana',
      );

      // Al irse la pantalla, la barra vuelve a deducir sola.
      TestBed.inject(MigasStore).retirar(dueno);
      await TestBed.inject(Router).navigateByUrl('/egresos/7');
      await TestBed.inject(ApplicationRef).whenStable();
      expect(pasos(html.querySelector('nav[aria-label="Ubicación"]')!)).toEqual([
        'Egresos',
        'Detalle del egreso',
      ]);
    });

    async function abrir(url: string): Promise<HTMLElement> {
      const fixture = await montar();
      await TestBed.inject(Router).navigateByUrl(url);
      fixture.autoDetectChanges();
      await fixture.whenStable();
      return fixture.nativeElement as HTMLElement;
    }

    function permisos(concedidos: boolean): void {
      vi.spyOn(TestBed.inject(PermissionsStore), 'tieneAlguno').mockReturnValue(concedidos);
    }

    function pasos(ubicacion: Element): string[] {
      return Array.from(ubicacion.querySelectorAll('.ubicacion__paso')).map(
        (paso) => paso.textContent?.trim() ?? '',
      );
    }
  });

  it('con una sola sede la muestra sin ofrecer cambiarla', async () => {
    conContexto();
    contextos.set([sede(1, 2, 'Sede Centro')]);
    const fixture = await montar();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelector('.sede--fija')?.textContent).toContain('Sede Centro');
    expect(html.querySelector('button[aria-controls="panel-de-sedes"]')).toBeNull();
  });

  it('con varias sedes despliega la lista con la actual primero y marcada', async () => {
    conContexto();
    contextos.set([sede(1, 3, 'Sede Norte'), sede(1, 2, 'Sede Centro')]);
    const fixture = await montar();
    const html = fixture.nativeElement as HTMLElement;

    const boton = html.querySelector<HTMLButtonElement>('button[aria-controls="panel-de-sedes"]')!;
    boton.click();
    fixture.detectChanges();

    expect(boton.getAttribute('aria-expanded')).toBe('true');
    const opciones = Array.from(html.querySelectorAll<HTMLButtonElement>('.sede__opcion'));
    expect(opciones.map((opcion) => opcion.textContent?.trim())).toEqual([
      'Sede Centro',
      'Sede Norte',
    ]);
    expect(opciones[0]!.getAttribute('aria-current')).toBe('true');
    expect(opciones[1]!.getAttribute('aria-current')).toBeNull();
    // Con dos sedes la lista se lee de un vistazo: sin buscador.
    expect(html.querySelector('input[type="search"]')).toBeNull();
  });

  it('con muchas sedes el buscador filtra sin importar las tildes', async () => {
    conContexto();
    contextos.set([
      sede(1, 2, 'Sede Centro'),
      sede(1, 3, 'Sede Nueva Córdoba'),
      sede(1, 4, 'Sede General Paz'),
      sede(1, 5, 'Sede Cerro'),
      sede(1, 6, 'Sede Alta Córdoba'),
      sede(1, 7, 'Sede Güemes'),
    ]);
    const fixture = await montar();
    const html = fixture.nativeElement as HTMLElement;
    html.querySelector<HTMLButtonElement>('button[aria-controls="panel-de-sedes"]')!.click();
    fixture.detectChanges();

    const buscador = html.querySelector<HTMLInputElement>('input[type="search"]')!;
    buscador.value = 'cordoba';
    buscador.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(
      Array.from(html.querySelectorAll('.sede__opcion')).map((opcion) =>
        opcion.textContent?.trim(),
      ),
    ).toEqual(['Sede Nueva Córdoba', 'Sede Alta Córdoba']);
  });

  it('el menu del perfil dice quien soy y deja cerrar sesion al final', async () => {
    conContexto();
    perfil.set({
      firstName: 'Ana',
      lastName: 'Admin',
      email: 'ana@ejemplo.test',
      context: { roleCode: 'ORG_ADMIN', roleLabel: 'Administración' },
    });
    const fixture = await montar();
    const html = fixture.nativeElement as HTMLElement;
    html.querySelector<HTMLButtonElement>('button[aria-controls="menu-de-perfil"]')!.click();
    fixture.detectChanges();

    const panel = html.querySelector('#menu-de-perfil')!;
    expect(panel.textContent).toContain('Administración');
    expect(panel.textContent).toContain('ana@ejemplo.test');
    expect(enlace(html, 'Mi perfil')?.getAttribute('href')).toBe('/mi-cuenta/perfil');
    expect(enlace(html, 'Preferencias')?.getAttribute('href')).toBe('/mi-cuenta/preferencias');
    const items = panel.querySelectorAll('.desplegable__item');
    const salir = items[items.length - 1] as HTMLButtonElement;
    expect(salir.textContent?.trim()).toBe('Cerrar sesión');

    salir.click();
    await fixture.whenStable();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(Router).url).toBe('/auth/ingresar');
  });

  it('Escape cierra el menu y devuelve el foco al boton', async () => {
    conContexto();
    const fixture = await montar();
    const html = fixture.nativeElement as HTMLElement;
    const boton = html.querySelector<HTMLButtonElement>('button[aria-controls="menu-de-perfil"]')!;
    boton.click();
    fixture.detectChanges();

    html
      .querySelector('#menu-de-perfil')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(html.querySelector('#menu-de-perfil')).toBeNull();
    expect(document.activeElement).toBe(boton);
  });

  /** Con la restauracion en vuelo el contexto tiene un rotulo provisorio: la barra espera. */
  it('con la restauracion en vuelo muestra solo la marca', async () => {
    restaurando.set(true);
    conContexto();
    const fixture = await montar(false);
    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelector('app-selector-de-sede')).toBeNull();
    expect(html.querySelector('.marca')).not.toBeNull();
  });

  it('el botón de menu refleja si el panel esta abierto y avisa al shell', async () => {
    conContexto();
    const fixture = await montar();
    const boton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button[aria-controls="navegacion-principal"]',
    );
    expect(boton?.getAttribute('aria-expanded')).toBe('false');

    let pedidos = 0;
    fixture.componentInstance.alternarMenu.subscribe(() => pedidos++);
    boton?.click();
    expect(pedidos).toBe(1);

    fixture.componentRef.setInput('menuAbierto', true);
    fixture.detectChanges();
    expect(boton?.getAttribute('aria-expanded')).toBe('true');
  });

  it(
    'no tiene violaciones de accesibilidad, con el selector de sede abierto',
    async () => {
      conContexto();
      contextos.set([sede(1, 2, 'Sede Centro'), sede(1, 3, 'Sede Norte')]);
      const fixture = await montar();
      const html = fixture.nativeElement as HTMLElement;
      html.querySelector<HTMLButtonElement>('button[aria-controls="panel-de-sedes"]')!.click();
      fixture.detectChanges();

      await esperarSinViolaciones(html);
    },
    TIMEOUT_AXE,
  );

  // --- Ayudantes ---------------------------------------------------------------------

  /**
   * Sede y perfil llegan por un `import()` despues de la primera pintura: se espera a que el
   * perfil quede montado, que esta en las dos ramas (con y sin contexto).
   */
  async function montar(esperarDesplegables = true): Promise<ComponentFixture<BarraSuperior>> {
    const fixture = TestBed.createComponent(BarraSuperior);
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    for (
      let intento = 0;
      esperarDesplegables && intento < 50 && !html.querySelector('app-menu-de-perfil');
      intento++
    ) {
      await new Promise((listo) => setTimeout(listo));
      fixture.detectChanges();
    }
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

  function sede(
    organizationId: number,
    consultorioId: number,
    consultorioName: string,
  ): AuthorizedContextResponse {
    return { organizationId, organizationName: 'Centro Kine', consultorioId, consultorioName };
  }

  function enlace(html: HTMLElement, texto: string): HTMLAnchorElement | undefined {
    return Array.from(html.querySelectorAll<HTMLAnchorElement>('a')).find(
      (candidato) => candidato.textContent?.trim() === texto,
    );
  }
});
