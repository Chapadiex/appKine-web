import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Component } from '@angular/core';

import { ANCHO_AMPLIO, DATA_ANCHO } from './core/models/ancho-de-contenido';
import { FlujoDeTurnosStore } from './core/services/flujo-de-turnos.store';
import { SessionService } from './core/services/session.service';
import { PlatformRoleStore } from './core/services/platform-role.store';
import { PerfilPropioStore } from './core/services/perfil-propio.store';
import { TenantContextStore } from './core/services/tenant-context.store';
import { ServicioNoDisponibleStore } from './core/services/servicio-no-disponible.store';
import { App } from './app';
import { provideApi } from './api/generated/provide-api';

/**
 * El shell monta la navegacion principal, que lee la sesion y los permisos efectivos. Sin
 * estos proveedores el layout no se puede instanciar.
 *
 * <p>No hace falta stubear la sesion: sin token, `estado()` es `anonimo` y la navegacion no
 * dibuja nada, que es exactamente el escenario donde estas pruebas del skip link tienen que
 * seguir valiendo.
 */
const PROVIDERS = [provideHttpClient(), provideHttpClientTesting(), provideApi('')];

@Component({ template: 'página de prueba' })
class PaginaDePrueba {}

/**
 * Smoke del layout raiz (AKINE-00.02).
 *
 * <p>Verifica las garantias de accesibilidad que el layout aporta a toda pantalla. La
 * logica de cada pagina se prueba en su propio spec.
 */
describe('App (layout)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [...PROVIDERS, provideRouter([])],
    }).compileComponents();
  });

  it('monta el layout', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
  });

  /**
   * El ancho lo pide la ruta y el shell lo aplica.
   *
   * <p>Es la unica prueba nueva de este cambio, y cubre la regresion que importa: que al
   * salir de una pantalla de tabla el ancho <b>vuelva</b> al de lectura. Una implementacion
   * que solo suma la clase deja anchas todas las pantallas siguientes, y eso no se ve en
   * ningun test de pantalla porque jsdom no calcula estilos: se ve en produccion, con los
   * parrafos del login midiendo 150 caracteres por renglon.
   */
  it('aplica el ancho de tabla solo en las rutas que lo piden, y lo devuelve al salir', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        ...PROVIDERS,
        provideRouter([
          { path: 'tabla', component: PaginaDePrueba, data: { [DATA_ANCHO]: ANCHO_AMPLIO } },
          { path: 'prosa', component: PaginaDePrueba },
        ]),
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const main = () => (fixture.nativeElement as HTMLElement).querySelector('main.contenido');

    await router.navigateByUrl('/tabla');
    fixture.detectChanges();
    expect(main()?.classList.contains('contenido--amplio')).toBe(true);

    await router.navigateByUrl('/prosa');
    fixture.detectChanges();
    expect(main()?.classList.contains('contenido--amplio')).toBe(false);
  });

  it('expone un skip link que apunta al contenido principal', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const html = fixture.nativeElement as HTMLElement;
    const skipLink = html.querySelector<HTMLAnchorElement>('a.skip-link');

    expect(skipLink).toBeTruthy();
    expect(skipLink?.getAttribute('href')).toBe('#contenido');
  });

  it('el skip link mueve el foco al contenido sin navegar', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const html = fixture.nativeElement as HTMLElement;
    expect(html.isConnected).toBe(true);
    const clic = new MouseEvent('click', { bubbles: true, cancelable: true });
    html.querySelector<HTMLAnchorElement>('a.skip-link')?.dispatchEvent(clic);

    // Con `<base href="/">` la navegacion por defecto iria a `/#contenido`: no tiene que ocurrir.
    expect(clic.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(html.querySelector('main#contenido'));
  });

  it('define los landmarks semanticos y el destino del skip link', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelector('header')).toBeTruthy();

    const main = html.querySelector('main#contenido');
    expect(main).toBeTruthy();
    // tabindex="-1" permite que el skip link mueva el foco al contenido.
    expect(main?.getAttribute('tabindex')).toBe('-1');
  });

  /**
   * Se monta CON contexto a proposito: la navegacion principal agrega siete enlaces a la
   * cabecera, y es justo el caso donde el skip link podria dejar de ser el primero. Sin
   * contexto el menu no dibuja nada y esta prueba no probaria lo que dice.
   */
  it('el skip link sigue siendo el primer elemento enfocable con la navegacion montada', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        ...PROVIDERS,
        provideRouter([]),
        {
          provide: SessionService,
          // El selector de sede y el perfil se montan despues de la primera pintura y leen esto.
          useValue: {
            estado: () => 'activa',
            restaurando: () => false,
            contextos: () => [],
            epocaDeIdentidad: () => 0,
            cargarContextos: () => of([]),
          },
        },
        {
          provide: PlatformRoleStore,
          useValue: { esAdminDePlataforma: () => false, asegurarCargado: () => undefined },
        },
        {
          provide: PerfilPropioStore,
          useValue: { perfil: () => null, asegurarCargado: () => undefined },
        },
      ],
    }).compileComponents();

    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro Kine',
      consultorioId: 2,
      consultorioName: 'Sede Centro',
    });

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const html = fixture.nativeElement as HTMLElement;
    const enfocables = html.querySelectorAll('a[href], button, input, select, textarea');

    expect(enfocables.length).toBeGreaterThan(1);
    expect(enfocables.item(0)?.classList.contains('skip-link')).toBe(true);
  });

  it('monta el flujo de turnos recién cuando alguien lo pide, y una sola vez', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const raiz = fixture.nativeElement as HTMLElement;
    const flujo = TestBed.inject(FlujoDeTurnosStore);
    expect(raiz.querySelector('app-flujo-de-turnos')).toBeNull();

    flujo.verTurno(7);
    fixture.detectChanges();
    // Es el mismo modulo que importa el shell: cuando resuelve esto, resolvio el del shell.
    await import('./features/scheduling/flujo/flujo-de-turnos');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(raiz.querySelectorAll('app-flujo-de-turnos').length).toBe(1);

    flujo.cerrar();
    flujo.nuevoTurno({ origen: 'AGENDA' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(raiz.querySelectorAll('app-flujo-de-turnos').length).toBe(1);
  });

  it('sin sesión no queda nada del flujo abierto', () => {
    const flujo = TestBed.inject(FlujoDeTurnosStore);
    flujo.verTurno(7);

    TestBed.createComponent(App).detectChanges();

    expect(flujo.solicitud()).toBeNull();
  });

  it('muestra el aviso de 503 en una region viva y lo cierra sin tocar nada mas', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const raiz = fixture.nativeElement as HTMLElement;
    const region = raiz.querySelector('[role="status"]');
    expect(region?.textContent?.trim()).toBe('');

    TestBed.inject(ServicioNoDisponibleStore).avisar(20);
    fixture.detectChanges();
    expect(region?.textContent).toContain('Reintentá en 20 segundos');

    raiz.querySelector<HTMLButtonElement>('.aviso-servicio__cerrar')?.click();
    fixture.detectChanges();
    expect(region?.textContent?.trim()).toBe('');
  });
});
