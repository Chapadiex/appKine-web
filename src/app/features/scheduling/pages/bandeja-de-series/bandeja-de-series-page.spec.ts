import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';
import { FILAS_POR_PAGINA_INICIAL } from '../../../../shared/components/paginacion/paginacion';
import { BandejaDeSeriesPage } from './bandeja-de-series-page';

const CONSULTORIO = 3;
const OFERTA = 42;
const URL_SERIES = `/api/v1/consultorios/${CONSULTORIO}/series-de-turnos`;
const URL_HABILITACIONES = `/api/v1/consultorios/${CONSULTORIO}/ofertas/${OFERTA}/habilitaciones`;

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

function pagina(
  content: unknown[],
  totalPages = 1,
  page = 0,
  totalElements = content.length,
): object {
  return { content, page, size: FILAS_POR_PAGINA_INICIAL, totalElements, totalPages };
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
      // UX-14: 10 filas por pagina de entrada, como toda tabla de AKINE.
      expect(pedido.request.params.get('size')).toBe('10');
      expect(pedido.request.params.has('personaId')).toBe(false);
      // Dos filas de la misma oferta: una sola lectura de habilitaciones.
      pedido.flush(pagina([FILA, { ...FILA, id: 8, personaNombre: 'Gomez, Luis' }]));
      httpMock
        .expectOne(URL_HABILITACIONES)
        .flush({ ofertaId: OFERTA, profesionales: [{ membershipId: 55, nombre: 'Lic. Diaz' }] });
      await asentar(fixture);

      const texto = textoDe(fixture);
      // El contador vive en la toolbar, en la misma fila que la busqueda (UX-14 §1).
      expect(html(fixture).querySelector('.filtros-barra__resultados')?.textContent).toBe(
        '2 series',
      );
      expect(html(fixture).querySelector('.paginacion-pie__resumen')?.textContent).toBe(
        'Mostrando 1–2 de 2',
      );
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

  it('filtra por estado, busca y ordena en el servidor, y vuelve a la primera página', async () => {
    const fixture = await montar();
    esperarListado().flush(pagina([{ ...FILA, profesionalId: undefined }], 3));
    await asentar(fixture);

    clickear(fixture, 'Página siguiente');
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
    expect(html(fixture).querySelector('app-estado-vacio')?.textContent).toContain(
      'No encontramos series',
    );

    const campo = (fixture.nativeElement as HTMLElement).querySelector(
      '#series-busqueda',
    ) as HTMLInputElement;
    campo.value = ' Perez ';
    campo.dispatchEvent(new Event('change'));
    const buscadas = esperarListado();
    expect(buscadas.request.params.get('q')).toBe('Perez');
    expect(buscadas.request.params.get('page')).toBe('0');
    buscadas.flush(pagina([{ ...FILA, profesionalId: undefined }], 3));
    await asentar(fixture);

    clickear(fixture, 'Patrón y vigencia');
    const ordenadas = esperarListado();
    expect(decodeURIComponent(ordenadas.request.params.get('sort')!)).toBe('fechaDesde,asc');
    expect(ordenadas.request.params.get('q')).toBe('Perez');
    ordenadas.flush(pagina([]));
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Ninguna serie coincide con la búsqueda');
  });

  it('cambia las filas por página en el servidor y vuelve a la primera', async () => {
    const fixture = await montar();
    esperarListado().flush(pagina([FILA], 3, 0, 27));
    httpMock.expectOne(URL_HABILITACIONES).flush({ ofertaId: OFERTA, profesionales: [] });
    await asentar(fixture);
    expect(html(fixture).querySelector('.paginacion-pie__resumen')?.textContent).toBe(
      'Mostrando 1–10 de 27',
    );

    const selector = html(fixture).querySelector(
      '.paginacion-pie__por-pagina select',
    ) as HTMLSelectElement;
    selector.value = '25';
    selector.dispatchEvent(new Event('change'));
    const pedido = esperarListado();
    expect(pedido.request.params.get('size')).toBe('25');
    expect(pedido.request.params.get('page')).toBe('0');
    pedido.flush(pagina([], 1));
  });

  it('distingue "todavía no hay" de "no hay con estos filtros" y limpia los filtros', async () => {
    const fixture = await montar();
    esperarListado().flush(pagina([]));
    await asentar(fixture);
    expect(html(fixture).querySelector('app-estado-vacio')?.textContent).toContain(
      'No hay series vigentes',
    );
    expect(html(fixture).querySelector('table')).toBeNull();

    const campo = html(fixture).querySelector('#series-busqueda') as HTMLInputElement;
    campo.value = 'Zarate';
    campo.dispatchEvent(new Event('change'));
    esperarListado().flush(pagina([]));
    await asentar(fixture);
    expect(html(fixture).querySelector('app-estado-vacio')?.textContent).toContain(
      'No encontramos series',
    );

    clickear(fixture, 'Limpiar filtros');
    const limpio = esperarListado();
    expect(limpio.request.params.has('q')).toBe(false);
    expect(limpio.request.params.get('estado')).toBe('VIGENTE');
    limpio.flush(pagina([]));
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

    clickear(fixture, 'Ver las de todos los pacientes');
    expect(esperarListado().request.params.has('personaId')).toBe(false);
  });

  it('si falla la lectura lo dice y permite reintentar', async () => {
    const fixture = await montar();
    esperarListado().flush(null, { status: 500, statusText: 'Server Error' });
    await asentar(fixture);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('app-alerta')?.textContent,
    ).toContain('No pudimos leer las series');
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

  function html(fixture: ComponentFixture<BandejaDeSeriesPage>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
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
    expect(boton, `no se encontro el botón "${texto}"`).toBeDefined();
    boton?.click();
    fixture.detectChanges();
  }

  async function asentar(fixture: ComponentFixture<BandejaDeSeriesPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }
});
