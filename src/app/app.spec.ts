import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Component } from '@angular/core';

import { ANCHO_AMPLIO, DATA_ANCHO } from './core/models/ancho-de-contenido';
import { App } from './app';

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
      providers: [provideRouter([])],
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

  it('el skip link es el primer elemento enfocable del documento', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const html = fixture.nativeElement as HTMLElement;
    const enfocables = html.querySelectorAll('a[href], button, input, select, textarea');

    expect(enfocables.item(0)?.classList.contains('skip-link')).toBe(true);
  });
});
