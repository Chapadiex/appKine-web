import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';
import { BandejaDeSeriesPage, FILAS_POR_PAGINA } from './bandeja-de-series-page';

const CONSULTORIO = 3;
const OFERTA = 42;
const URL_SERIES = `/api/v1/consultorios/${CONSULTORIO}/series-de-turnos`;
const URL_HABILITACIONES = `/api/v1/consultorios/${CONSULTORIO}/ofertas/${OFERTA}/habilitaciones`;
const PERSONAS = '/api/v1/personas';

const FILA = {
  id: 7,
  consultorioId: CONSULTORIO,
  ofertaId: OFERTA,
  ofertaNombre: 'Kinesiologia',
  profesionalId: 55,
  personaId: 128,
  personaNombre: 'Perez, Ana',
  documento: 'DNI 30111222',
  frecuencia: 'SEMANAL',
  diasSemana: [1, 4],
  hora: '09:00:00',
  fechaDesde: '2026-10-12',
  cantidad: 12,
  timezone: 'America/Argentina/Cordoba',
  totalTurnos: 12,
  turnosPendientes: 9,
  proximoTurnoInicio: '2026-10-15T12:00:00Z',
  estado: 'VIGENTE',
};

function pagina(content: unknown[], totalPages = 1, page = 0): object {
  return { content, page, size: FILAS_POR_PAGINA, totalElements: content.length, totalPages };
}

/**
 * Spec de la bandeja de series (AKINE E-8). Lo esencial: que filtros viajan al backend, que el
 * nombre del profesional se resuelve por oferta y no por fila, y que cada fila lleva a su serie.
 */
describe('BandejaDeSeriesPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BandejaDeSeriesPage],
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

  it(
    'abre con las vigentes, resuelve el profesional por oferta y enlaza a la serie',
    async () => {
      const fixture = await montar();
      const pedido = esperarListado();
      expect(pedido.request.params.get('estado')).toBe('VIGENTE');
      expect(pedido.request.params.get('page')).toBe('0');
      expect(pedido.request.params.get('size')).toBe(String(FILAS_POR_PAGINA));
      expect(pedido.request.params.has('personaId')).toBe(false);
      // Dos filas de la misma oferta: una sola lectura de habilitaciones.
      pedido.flush(pagina([FILA, { ...FILA, id: 8, personaNombre: 'Gomez, Luis' }]));
      httpMock
        .expectOne(URL_HABILITACIONES)
        .flush({ ofertaId: OFERTA, profesionales: [{ membershipId: 55, nombre: 'Lic. Diaz' }] });
      await asentar(fixture);

      const texto = textoDe(fixture);
      expect(texto).toContain('2 series');
      expect(texto).toContain('Perez, Ana');
      expect(texto).toContain('DNI 30111222');
      expect(texto).toContain('Lic. Diaz');
      expect(texto).toContain('Lunes y jueves a las 09:00');
      expect(texto).toContain('9 pendientes de 12');
      expect(texto).toContain('Vigente');
      const enlace = (fixture.nativeElement as HTMLElement).querySelector(
        'a[href="/agenda/series/7"]',
      );
      expect(enlace).not.toBeNull();
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  it('filtra por estado y por persona, y vuelve a la primera pagina', async () => {
    const fixture = await montar();
    esperarListado().flush(pagina([{ ...FILA, profesionalId: undefined }], 3));
    await asentar(fixture);

    clickear(fixture, 'Siguiente');
    const segunda = esperarListado();
    expect(segunda.request.params.get('page')).toBe('1');
    segunda.flush(pagina([], 3, 1));
    await asentar(fixture);

    const estado = (fixture.nativeElement as HTMLElement).querySelector(
      '#series-estado',
    ) as HTMLSelectElement;
    estado.value = 'TODAS';
    estado.dispatchEvent(new Event('change'));
    const todas = esperarListado();
    expect(todas.request.params.has('estado')).toBe(false);
    expect(todas.request.params.get('page')).toBe('0');
    todas.flush(pagina([]));
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('No hay series que cumplan ese filtro');

    const campo = (fixture.nativeElement as HTMLElement).querySelector(
      '#series-persona',
    ) as HTMLInputElement;
    campo.value = 'Perez';
    campo.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    httpMock
      .expectOne((p) => p.url === PERSONAS && p.params.get('q') === 'Perez')
      .flush({ content: [{ id: 128, apellido: 'Perez', nombre: 'Ana' }] });
    await asentar(fixture);

    clickear(fixture, 'Perez, Ana');
    const dePersona = esperarListado();
    expect(dePersona.request.params.get('personaId')).toBe('128');
    dePersona.flush(pagina([]));
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Solo las series de Perez, Ana');

    clickear(fixture, 'Ver las de todos los pacientes');
    expect(esperarListado().request.params.has('personaId')).toBe(false);
  });

  it('la persona que llega por URL se filtra y toma el nombre de la primera fila', async () => {
    const fixture = await montar({ personaId: '128', estado: 'FINALIZADA' });
    const pedido = esperarListado();
    expect(pedido.request.params.get('personaId')).toBe('128');
    expect(pedido.request.params.get('estado')).toBe('FINALIZADA');
    pedido.flush(pagina([{ ...FILA, estado: 'FINALIZADA', profesionalId: undefined }]));
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Solo las series de Perez, Ana');
    expect(textoDe(fixture)).toContain('Finalizada');
  });

  it('si falla la lectura lo dice y permite reintentar', async () => {
    const fixture = await montar();
    esperarListado().flush(null, { status: 500, statusText: 'Server Error' });
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('No se pudieron leer las series');
    clickear(fixture, 'Reintentar');
    esperarListado().flush(pagina([]));
  });

  // ---------------------------------------------------------------------------------------

  async function montar(
    query: { personaId?: string; estado?: string } = {},
  ): Promise<ComponentFixture<BandejaDeSeriesPage>> {
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });
    const fixture = TestBed.createComponent(BandejaDeSeriesPage);
    if (query.personaId) {
      fixture.componentRef.setInput('personaId', query.personaId);
    }
    if (query.estado) {
      fixture.componentRef.setInput('estado', query.estado);
    }
    fixture.detectChanges();
    return fixture;
  }

  function esperarListado(): ReturnType<HttpTestingController['expectOne']> {
    return httpMock.expectOne((p: HttpRequest<unknown>) => p.url === URL_SERIES);
  }

  function textoDe(fixture: ComponentFixture<BandejaDeSeriesPage>): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  function clickear(fixture: ComponentFixture<BandejaDeSeriesPage>, texto: string): void {
    const boton = (
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
      ) as HTMLButtonElement[]
    ).find((b) => (b.textContent ?? '').includes(texto));
    expect(boton, `no se encontro el boton "${texto}"`).toBeDefined();
    boton?.click();
    fixture.detectChanges();
  }

  async function asentar(fixture: ComponentFixture<BandejaDeSeriesPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }
});
