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
  ofertaNombre: 'Pilates reformer',
  profesionalNombre: 'Lic. Diaz',
  espacioNombre: 'Sala grande',
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

  function montar(semana?: string, vista?: string) {
    elegirSede();
    const fixture = TestBed.createComponent(ClasesDeLaSemanaPage);
    if (semana !== undefined) {
      fixture.componentRef.setInput('semana', semana);
    }
    if (vista !== undefined) {
      fixture.componentRef.setInput('vista', vista);
    }
    fixture.detectChanges();
    return fixture;
  }

  function esperarClases(): ReturnType<HttpTestingController['expectOne']> {
    return httpMock.expectOne((p: HttpRequest<unknown>) => p.url === URL_CLASES);
  }

  it(
    'pide la semana de la sede en UTC, pinta los siete días y marca la clase completa',
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
      await asentar(fixture);

      const texto = textoDe(fixture);
      expect(texto).toContain('Semana del lunes 12/10 al domingo 18/10');
      // La semana es la vista por defecto: siete dias en columnas, con su cantidad.
      const raiz = fixture.nativeElement as HTMLElement;
      expect(raiz.querySelectorAll('.dia-clases')).toHaveLength(7);
      expect(raiz.querySelector('.filtros-barra__resultados')?.textContent?.trim()).toBe('1 clase');
      expect(raiz.querySelector('section.tarjeta app-filtros')).not.toBeNull();
      expect(raiz.querySelector('.tabla')).toBeNull();
      expect(texto).toContain('18:00 a 19:00');
      expect(texto).toContain('Pilates reformer');
      expect(texto).toContain('Lic. Diaz');
      expect(texto).toContain('Sala grande');
      // Los nombres vienen en la clase: no se releen las ofertas.
      httpMock.expectNone((p) => p.url.endsWith('/ofertas'));
      expect(texto).toContain('8 de 8 lugares ocupados');
      expect(texto).toContain('Completa');
      expect(texto).toContain('Programada');
      expect(texto).toContain('Programar clase');
      expect(raiz.querySelector('a.clase-tarjeta[href="/clases/70"]')).not.toBeNull();
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
    await asentar(fixture);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('app-estado-vacio')?.textContent,
    ).toContain('No hay clases esta semana');
    expect(textoDe(fixture)).not.toContain('Programar clase');

    clickear(fixture, 'Semana siguiente');
    await asentar(fixture);
    const siguiente = esperarClases();
    expect(decodeURIComponent(siguiente.request.params.get('desde') ?? '')).toBe(
      '2026-10-05T03:00:00.000Z',
    );
    siguiente.flush([]);
    await asentar(fixture);
    expect(textoDe(fixture)).not.toContain('Yoga suave');

    clickear(fixture, 'Hoy');
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

  it('los filtros rápidos cuentan por estado sobre la semana entera y filtran', async () => {
    otorgar(httpMock, PERMISO_CLASE_READ);
    const fixture = montar('2026-10-14');
    esperarClases().flush([
      { ...CLASE, id: 1, titulo: 'Yoga suave' },
      { ...CLASE, id: 2, titulo: 'Pilates mat' },
      { ...CLASE, id: 3, titulo: 'Funcional', estado: 'CANCELADA' },
    ]);
    await asentar(fixture);

    const opcion = (nombre: string) =>
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
          '.filtros-rapidos__opcion',
        ),
      ).find((b) => (b.textContent ?? '').includes(nombre)) as HTMLButtonElement;
    expect(opcion('Todas').textContent).toContain('3');
    expect(opcion('Programadas').textContent).toContain('2');
    expect(opcion('Canceladas').textContent).toContain('1');

    opcion('Canceladas').click();
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Funcional');
    expect(textoDe(fixture)).not.toContain('Yoga suave');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.filtros-barra__resultados')
        ?.textContent,
    ).toContain('1 clase');
  });

  it('la lista pagina de a 10 y, sin coincidencias, ofrece limpiar los filtros', async () => {
    otorgar(httpMock, PERMISO_CLASE_READ);
    const fixture = montar('2026-10-14', 'lista');
    esperarClases().flush(
      Array.from({ length: 12 }, (_, i) => ({ ...CLASE, id: i + 1, titulo: `Clase ${i + 1}` })),
    );
    await asentar(fixture);
    const raiz = fixture.nativeElement as HTMLElement;
    expect(raiz.querySelectorAll('tbody tr')).toHaveLength(10);
    expect(raiz.querySelector('.paginacion-pie__resumen')?.textContent).toContain(
      'Mostrando 1–10 de 12',
    );
    clickear(fixture, 'Página siguiente');
    await asentar(fixture);
    expect(raiz.querySelectorAll('tbody tr')).toHaveLength(2);

    const busqueda = raiz.querySelector('#clases-busqueda') as HTMLInputElement;
    busqueda.value = 'zzz';
    busqueda.dispatchEvent(new Event('input'));
    await asentar(fixture);
    expect(raiz.querySelector('app-estado-vacio')?.textContent).toContain('No encontramos clases');
    clickear(fixture, 'Limpiar filtros');
    await asentar(fixture);
    expect(raiz.querySelectorAll('tbody tr')).toHaveLength(10);
  });

  it(
    'la lista conserva la tabla con orden, cupo y enlace a la clase',
    async () => {
      otorgar(httpMock, PERMISO_CLASE_READ);
      const fixture = montar('2026-10-14', 'lista');
      esperarClases().flush([CLASE]);
      await asentar(fixture);
      const raiz = fixture.nativeElement as HTMLElement;
      expect(raiz.querySelectorAll('tbody tr')).toHaveLength(1);
      expect(raiz.querySelector('.paginacion-pie__resumen')?.textContent).toContain(
        'Mostrando 1–1 de 1',
      );
      expect(textoDe(fixture)).toContain('8 de 8 lugares ocupados — completa');
      expect(raiz.querySelector('a[href="/clases/70"]')).not.toBeNull();
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  it(
    'el mes pide seis semanas, resume cada día y abre la semana del día',
    async () => {
      otorgar(httpMock, PERMISO_CLASE_READ);
      const fixture = montar('2026-10-14', 'mes');
      const pedido = esperarClases();
      // Octubre 2026 empieza un jueves: el calendario arranca el lunes 28/09 y cubre 42 dias.
      expect(decodeURIComponent(pedido.request.params.get('desde') ?? '')).toBe(
        '2026-09-28T03:00:00.000Z',
      );
      expect(decodeURIComponent(pedido.request.params.get('hasta') ?? '')).toBe(
        '2026-11-09T03:00:00.000Z',
      );
      pedido.flush(
        Array.from({ length: 4 }, (_, i) => ({ ...CLASE, id: i + 1, titulo: `Clase ${i + 1}` })),
      );
      await asentar(fixture);
      const raiz = fixture.nativeElement as HTMLElement;
      expect(textoDe(fixture)).toContain('Octubre de 2026');
      expect(textoDe(fixture)).toContain('4 clases');
      expect(textoDe(fixture)).toContain('+1 más');
      await esperarSinViolaciones(fixture.nativeElement);

      const dia = raiz.querySelector('button[aria-label^="miércoles 14/10"]') as HTMLButtonElement;
      dia.click();
      fixture.detectChanges();
      await asentar(fixture);
      expect(decodeURIComponent(esperarClases().request.params.get('desde') ?? '')).toBe(
        '2026-10-12T03:00:00.000Z',
      );
      expect(textoDe(fixture)).toContain('Semana del lunes 12/10 al domingo 18/10');
    },
    TIMEOUT_AXE,
  );

  it('filtra por profesional con las opciones de lo que llegó', async () => {
    otorgar(httpMock, PERMISO_CLASE_READ);
    const fixture = montar('2026-10-14');
    esperarClases().flush([
      { ...CLASE, id: 1, titulo: 'Yoga suave', profesionalId: 5, profesionalNombre: 'Ana' },
      { ...CLASE, id: 2, titulo: 'Pilates mat', profesionalId: 6, profesionalNombre: 'Beto' },
    ]);
    await asentar(fixture);
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      '#clases-profesional',
    ) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual([
      'Todos',
      'Ana',
      'Beto',
    ]);
    select.value = '6';
    select.dispatchEvent(new Event('change'));
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Pilates mat');
    expect(textoDe(fixture)).not.toContain('Yoga suave');
  });

  it('un error de lectura se muestra y se reintenta', async () => {
    otorgar(httpMock, PERMISO_CLASE_READ);
    const fixture = montar();
    esperarClases().flush(
      { type: 'https://akine.app/problems/forbidden', status: 403, detail: 'No' },
      { status: 403, statusText: 'Forbidden' },
    );
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('No se pudieron leer las clases');
    expect(textoDe(fixture)).toContain('clase:read');
    clickear(fixture, 'Reintentar');
    esperarClases().flush([]);
  });
});
