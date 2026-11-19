import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { provideApi } from '../../api/generated/provide-api';

import { LandingPage } from './landing-page';
import { recomendarPlan } from './models/armador-de-plan';

describe('LandingPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi(''),
      ],
    });
  });

  it('muestra todas las secciones de la landing y el CTA a la prueba', () => {
    const fixture = TestBed.createComponent(LandingPage);
    fixture.detectChanges();
    const raiz = fixture.nativeElement as HTMLElement;

    for (const id of ['portada', 'servicios', 'sedes', 'ia', 'planes', 'prueba', 'preguntas']) {
      expect(raiz.querySelector(`#${id}`), id).not.toBeNull();
    }
    expect(raiz.querySelector('h1')?.textContent).toContain('El día entero de tu centro');
    expect(raiz.querySelector('a[href="#prueba"]')).not.toBeNull();
    // Sin autoregistro: los centros los crea la plataforma.
    expect(raiz.textContent).not.toContain('Crear una cuenta');
    expect(raiz.querySelector('#prueba form app-segmentado')).not.toBeNull();
    expect(raiz.querySelectorAll('#preguntas details').length).toBeGreaterThan(3);
  });

  it('el armador recomienda el plan que corresponde y cambia al elegir otra opción', () => {
    const fixture = TestBed.createComponent(LandingPage);
    fixture.detectChanges();
    const raiz = fixture.nativeElement as HTMLElement;
    const plan = (): string => raiz.querySelector('.resultado__nombre')?.textContent?.trim() ?? '';

    expect(plan()).toBe('Base');

    const opcion = [...raiz.querySelectorAll<HTMLInputElement>('app-armador-de-plan input')].find(
      (input) => input.value === 'mas-de-tres',
    );
    opcion!.click();
    fixture.detectChanges();

    expect(plan()).toBe('Red');
    expect(raiz.querySelector('.plan--elegido')?.textContent).toContain('Red');
    // El pedido de prueba se precarga con lo elegido en el armador.
    const sedesDelPedido = raiz.querySelector<HTMLInputElement>('#pedido-sedes input:checked');
    expect(sedesDelPedido?.value).toBe('MAS_DE_TRES');
  });
});

describe('recomendarPlan', () => {
  it('una sede y sólo kinesiología, sin IA: Base, sin actividades ni IA', () => {
    const r = recomendarPlan({ sedes: 'una', servicios: 'kinesiologia', ia: 'no' });

    expect(r.plan.codigo).toBe('base');
    expect(r.incluye.map((g) => g.titulo)).toEqual(['1 sede', 'Kinesiología y rehabilitación']);
  });

  it('dos o tres sedes con los dos servicios e IA: Crecimiento con toda la IA', () => {
    const r = recomendarPlan({ sedes: 'hasta-tres', servicios: 'ambos', ia: 'si' });

    expect(r.plan.codigo).toBe('crecimiento');
    const ia = r.incluye.find((g) => g.titulo === 'Adicional de IA');
    expect(ia?.items).toContain('Biblioteca del centro');
    expect(r.incluye.some((g) => g.titulo === 'Actividades')).toBe(true);
  });

  it('más de tres sedes con sólo actividades e IA: Red, y la IA sin las funciones clínicas', () => {
    const r = recomendarPlan({ sedes: 'mas-de-tres', servicios: 'actividades', ia: 'si' });

    expect(r.plan.codigo).toBe('red');
    const ia = r.incluye.find((g) => g.titulo === 'Adicional de IA');
    expect(ia?.items).toEqual(['Asistente de datos', 'Dictado por voz']);
    expect(r.incluye.some((g) => g.titulo === 'Kinesiología y rehabilitación')).toBe(false);
  });
});
