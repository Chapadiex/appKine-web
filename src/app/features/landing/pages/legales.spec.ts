import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { PieDeLanding } from '../components/pie-de-landing/pie-de-landing';
import { Privacidad } from './privacidad/privacidad';
import { Terminos } from './terminos/terminos';

const AVISO = 'Borrador para revisión legal. Este texto no está vigente.';

describe('páginas legales de la landing', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it.each([
    ['Términos y condiciones', Terminos],
    ['Política de privacidad', Privacidad],
  ] as [string, Type<unknown>][])(
    '%s: título, aviso de borrador, marcadores a completar e índice',
    (titulo, pagina) => {
      const fixture = TestBed.createComponent(pagina);
      fixture.detectChanges();
      const raiz = fixture.nativeElement as HTMLElement;

      expect(raiz.querySelector('h1')?.textContent).toContain(titulo);
      const aviso = raiz.querySelector('app-alerta');
      expect(aviso?.textContent).toContain(AVISO);
      expect(aviso?.getAttribute('role')).toBe('alert');
      expect(raiz.textContent).toContain('[Razón social]');
      expect(raiz.textContent).toContain('[CUIT]');

      // Cada entrada del índice apunta a una sección que existe en la página.
      const enlaces = [...raiz.querySelectorAll<HTMLAnchorElement>('.indice a')];
      expect(enlaces.length).toBeGreaterThan(5);
      for (const enlace of enlaces) {
        const id = enlace.getAttribute('href')!.split('#')[1];
        expect(raiz.querySelector(`#${id}`), id).not.toBeNull();
      }
      expect(raiz.querySelector('app-pie-de-landing')).not.toBeNull();
    },
  );

  it('el pie enlaza los dos textos legales', () => {
    const fixture = TestBed.createComponent(PieDeLanding);
    fixture.detectChanges();
    const hrefs = [...(fixture.nativeElement as HTMLElement).querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    );

    expect(hrefs).toContain('/terminos');
    expect(hrefs).toContain('/privacidad');
  });
});
