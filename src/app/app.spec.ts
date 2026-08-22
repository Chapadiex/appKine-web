import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';

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
