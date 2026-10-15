import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { PERMISO_CLASE_MANAGE, PERMISO_CLASE_READ } from '../../../../core/models/permisos';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import {
  URL_CLASES,
  URL_OFERTAS,
  asentar,
  clickear,
  elegirSede,
  otorgar,
  proveerDiaDeLaSede,
  textoDe,
} from '../../testing/activity-testing';
import { ClasesDeLaSemanaPage } from './clases-de-la-semana-page';

const CLASE = {
  id: 70,
  ofertaId: 42,
  estado: 'PROGRAMADA',
  inicio: '2026-10-14T21:00:00Z',
  fin: '2026-10-14T22:00:00Z',
  capacidad: 8,
  capacidadEfectiva: 8,
  ocupados: 8,
  version: 0,
};

describe('ClasesDeLaSemanaPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClasesDeLaSemanaPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
        proveerDiaDeLaSede(),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function montar(semana?: string) {
    elegirSede();
    const fixture = TestBed.createComponent(ClasesDeLaSemanaPage);
    if (semana !== undefined) {
      fixture.componentRef.setInput('semana', semana);
    }
    fixture.detectChanges();
    return fixture;
  }

  function esperarClases(): ReturnType<HttpTestingController['expectOne']> {
    return httpMock.expectOne((p: HttpRequest<unknown>) => p.url === URL_CLASES);
  }

  function responderOfertas(): void {
    httpMock
      .expectOne((p) => p.url === URL_OFERTAS)
      .flush([
        { id: 42, nombreComercial: 'Pilates reformer', modalidad: 'GRUPAL' },
        { id: 43, nombreComercial: 'Kinesio individual', modalidad: 'INDIVIDUAL' },
      ]);
  }

  it(
    'pide la semana de la sede en UTC, pinta los siete dias y marca la clase completa',
    async () => {
      otorgar(httpMock, PERMISO_CLASE_READ, PERMISO_CLASE_MANAGE);
      const fixture = montar();
      const pedido = esperarClases();
      // Lunes 12/10 00:00 de Cordoba = 03:00 UTC.
      expect(decodeURIComponent(pedido.request.params.get('desde') ?? '')).toBe(
        '2026-10-12T03:00:00.000Z',
      );
      expect(decodeURIComponent(pedido.request.params.get('hasta') ?? '')).toBe(
        '2026-10-19T03:00:00.000Z',
      );
      pedido.flush([CLASE]);
      responderOfertas();
      await asentar(fixture);

      const texto = textoDe(fixture);
      expect(texto).toContain('Semana del lunes 12/10 al domingo 18/10');
      expect(texto).toContain('1 clase en la semana');
      expect(texto).toContain('18:00 a 19:00');
      expect(texto).toContain('Pilates reformer');
      expect(texto).toContain('8 de 8 lugares ocupados — completa');
      expect(texto).toContain('Programar una clase');
      expect((fixture.nativeElement as HTMLElement).querySelectorAll('.dia')).toHaveLength(7);
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('a[href="/clases/70"]'),
      ).not.toBeNull();
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  it('navega de semana y toma la de la URL', async () => {
    otorgar(httpMock, PERMISO_CLASE_READ);
    const fixture = montar('2026-10-01');
    const primero = esperarClases();
    expect(decodeURIComponent(primero.request.params.get('desde') ?? '')).toBe(
      '2026-09-28T03:00:00.000Z',
    );
    primero.flush([]);
    responderOfertas();
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('0 clases en la semana');
    expect(textoDe(fixture)).not.toContain('Programar una clase');

    clickear(fixture, 'Semana siguiente');
    await asentar(fixture);
    const siguiente = esperarClases();
    expect(decodeURIComponent(siguiente.request.params.get('desde') ?? '')).toBe(
      '2026-10-05T03:00:00.000Z',
    );
    siguiente.flush([{ ...CLASE, titulo: 'Yoga suave', estado: 'CANCELADA', ocupados: 0 }]);
    await asentar(fixture);
    expect(textoDe(fixture)).not.toContain('Yoga suave');

    clickear(fixture, 'Esta semana');
    await asentar(fixture);
    esperarClases().flush([{ ...CLASE, titulo: 'Yoga suave', estado: 'CANCELADA' }]);
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Yoga suave');
    expect(textoDe(fixture)).toContain('Cancelada');

    const fecha = (fixture.nativeElement as HTMLElement).querySelector(
      '#clases-fecha',
    ) as HTMLInputElement;
    fecha.value = '2026-11-04';
    fecha.dispatchEvent(new Event('change'));
    await asentar(fixture);
    expect(decodeURIComponent(esperarClases().request.params.get('desde') ?? '')).toBe(
      '2026-11-02T03:00:00.000Z',
    );

    clickear(fixture, 'Semana anterior');
    await asentar(fixture);
    expect(decodeURIComponent(esperarClases().request.params.get('desde') ?? '')).toBe(
      '2026-10-26T03:00:00.000Z',
    );
  });

  it('un error de lectura se muestra y se reintenta', async () => {
    otorgar(httpMock, PERMISO_CLASE_READ);
    const fixture = montar();
    esperarClases().flush(
      { type: 'https://akine.app/problems/forbidden', status: 403, detail: 'No' },
      { status: 403, statusText: 'Forbidden' },
    );
    responderOfertas();
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('No se pudieron leer las clases');
    expect(textoDe(fixture)).toContain('clase:read');
    clickear(fixture, 'Reintentar');
    esperarClases().flush([]);
  });
});
