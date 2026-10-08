import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { Component } from '@angular/core';

import { ANCHO_AMPLIO, DATA_ANCHO } from './core/models/ancho-de-contenido';
import { SessionService } from './core/services/session.service';
import { PlatformRoleStore } from './core/services/platform-role.store';
import { TenantContextStore } from './core/services/tenant-context.store';
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

@Component({ template: 'pagina de prueba' })
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
        { provide: SessionService, useValue: { estado: () => 'activa' } },
        {
          provide: PlatformRoleStore,
          useValue: { esAdminDePlataforma: () => false, asegurarCargado: () => undefined },
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
});
