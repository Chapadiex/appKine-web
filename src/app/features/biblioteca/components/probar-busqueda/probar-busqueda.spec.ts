import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { ProbarBusqueda } from './probar-busqueda';

describe('ProbarBusqueda', () => {
  it('rotula una sola vez el pasaje debajo del corte y dice que no alcanza', async () => {
    await TestBed.configureTestingModule({
      imports: [ProbarBusqueda],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();
    const httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
    const fixture = TestBed.createComponent(ProbarBusqueda);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    const campo = el.querySelector<HTMLTextAreaElement>('textarea')!;
    campo.value = 'dolor lumbar';
    campo.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();

    httpMock
      .expectOne((r) => r.method === 'POST' && r.url.endsWith('/biblioteca/busquedas'))
      .flush({
        alcanza: false,
        camino: 'VECTOR',
        corte: 0.5,
        pasajes: [
          {
            libroId: 1,
            titulo: 'Libro A',
            paginaDesde: 3,
            paginaHasta: 3,
            puntaje: 0.71,
            superaCorte: true,
            texto: 'uno',
          },
          {
            libroId: 2,
            titulo: 'Libro B',
            paginaDesde: 4,
            paginaHasta: 5,
            puntaje: 0.2,
            superaCorte: false,
            texto: 'dos',
          },
        ],
      });
    fixture.detectChanges();

    expect(el.textContent).toContain('La biblioteca no alcanza para esta pregunta');
    expect(el.textContent!.split('debajo del corte').length - 1).toBe(1);
  });
});
