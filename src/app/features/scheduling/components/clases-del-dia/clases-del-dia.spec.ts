import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { ClasesDelDia } from './clases-del-dia';

const CONSULTORIO = 3;
const AGENDA = `/api/v1/consultorios/${CONSULTORIO}/agenda`;

/**
 * Las clases del dia en la recepcion (RF-M12-013): de la agenda unificada solo se toman las
 * `CLASE`, en la zona que trae la respuesta, y cada una enlaza a su detalle.
 */
describe('ClasesDelDia', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClasesDelDia],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function montar(fecha = '2026-10-20'): ComponentFixture<ClasesDelDia> {
    const fixture = TestBed.createComponent(ClasesDelDia);
    fixture.componentRef.setInput('consultorioId', CONSULTORIO);
    fixture.componentRef.setInput('fecha', fecha);
    fixture.detectChanges();
    return fixture;
  }

  function texto(fixture: ComponentFixture<ClasesDelDia>): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  it(
    'muestra solo las clases, en hora de la sede, con enlace al detalle',
    async () => {
      const fixture = montar();
      const pedido = httpMock.expectOne((p) => p.url === AGENDA);
      expect(pedido.request.params.get('fecha')).toBe('2026-10-20');
      pedido.flush({
        fecha: '2026-10-20',
        timezone: 'America/Argentina/Cordoba',
        eventos: [
          { tipo: 'TURNO', eventoId: 7, inicio: '2026-10-20T12:00:00Z', personaId: 1 },
          {
            tipo: 'CLASE',
            eventoId: 7,
            inicio: '2026-10-20T21:00:00Z',
            fin: '2026-10-20T22:00:00Z',
            ofertaNombre: 'Pilates reformer',
            estado: 'PROGRAMADA',
            capacidad: 8,
            ocupados: 3,
          },
        ],
      });
      await fixture.whenStable();
      fixture.detectChanges();
      expect(texto(fixture)).toContain('18:00 a 19:00 — Pilates reformer — Programada');
      expect(texto(fixture)).toContain('3 de 8 lugares ocupados');
      const enlaces = (fixture.nativeElement as HTMLElement).querySelectorAll(
        'a[href="/clases/7"]',
      );
      expect(enlaces).toHaveLength(1);
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  it('dice cuando no hay clases y permite reintentar ante un error', async () => {
    const fixture = montar();
    httpMock
      .expectOne((p) => p.url === AGENDA)
      .flush(null, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    fixture.detectChanges();
    const reintentar = (fixture.nativeElement as HTMLElement).querySelector(
      'button',
    ) as HTMLButtonElement;
    reintentar.click();
    httpMock.expectOne((p) => p.url === AGENDA).flush({ eventos: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(texto(fixture)).toContain('No hay clases que empiecen este día');
  });

  it('una clase sin oferta ni titulo se nombra por su id y una fecha vacía no pide nada', async () => {
    const fixture = montar('');
    httpMock.expectNone((p) => p.url === AGENDA);
    fixture.componentRef.setInput('fecha', '2026-10-21');
    fixture.detectChanges();
    httpMock
      .expectOne((p) => p.url === AGENDA)
      .flush({ eventos: [{ tipo: 'CLASE', eventoId: 9, estado: 'OTRO' }] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(texto(fixture)).toContain('Clase #9');
    expect(texto(fixture)).toContain('OTRO');
  });
});
