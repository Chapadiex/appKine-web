import { Location } from '@angular/common';
import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

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
      expect(raiz.querySelector('.clases > app-filtros.clases-barra')).not.toBeNull();
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

  it('la tarjeta no repite los días del título: los dice la columna', async () => {
    otorgar(httpMock, PERMISO_CLASE_READ);
    const fixture = montar('2026-10-14');
    esperarClases().flush([
      { ...CLASE, id: 1, titulo: 'Yoga martes y jueves' },
      { ...CLASE, id: 2, titulo: 'Clase de los sábados' },
    ]);
    await asentar(fixture);
    const nombres = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.clase-tarjeta__nombre'),
    ).map((n) => n.textContent?.trim());
    expect(nombres).toEqual(['Yoga', 'Clase de los sábados']);
  });

  it('cada clase tiene su color en todos sus días, distinto del de las demás', async () => {
    otorgar(httpMock, PERMISO_CLASE_READ);
    const fixture = montar('2026-10-14');
    const dia = (n: number) => ({
      inicio: `2026-10-1${n}T21:00:00Z`,
      fin: `2026-10-1${n}T22:00:00Z`,
    });
    esperarClases().flush([
      { ...CLASE, id: 1, titulo: 'Yoga martes y jueves', ...dia(3) },
      { ...CLASE, id: 2, titulo: 'Yoga lunes y miércoles', ...dia(4) },
      { ...CLASE, id: 3, titulo: 'Yoga martes y jueves', ...dia(5) },
    ]);
    await asentar(fixture);
    const tonos = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.clase-tarjeta'),
    ).map((t) => Array.from(t.classList).find((c) => c.startsWith('clase-tarjeta--tono-')));
    expect(tonos[0]).toBe(tonos[2]);
    expect(tonos[1]).not.toBe(tonos[0]);
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

  function desdeDe(pedido: ReturnType<HttpTestingController['expectOne']>): string {
    return decodeURIComponent(pedido.request.params.get('desde') ?? '');
  }

  function seleccionar(fixture: ReturnType<typeof montar>, id: string, valor: string): void {
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      `#${id}`,
    ) as HTMLSelectElement;
    select.value = valor;
    select.dispatchEvent(new Event('change'));
  }

  it('la vista mes avanza y retrocede de a un mes, cruza el año y lo deja en la URL', async () => {
    otorgar(httpMock, PERMISO_CLASE_READ);
    const replaceState = vi.spyOn(TestBed.inject(Location), 'replaceState');
    const fixture = montar('2026-12-10', 'mes');
    // Diciembre 2026 empieza un martes: el calendario arranca el lunes 30/11.
    const diciembre = esperarClases();
    expect(desdeDe(diciembre)).toBe('2026-11-30T03:00:00.000Z');
    diciembre.flush([]);
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Diciembre de 2026');

    clickear(fixture, 'Mes siguiente');
    await asentar(fixture);
    // Enero 2027 empieza un viernes: el calendario arranca el lunes 28/12/2026.
    const enero = esperarClases();
    expect(desdeDe(enero)).toBe('2026-12-28T03:00:00.000Z');
    enero.flush([]);
    await asentar(fixture);
    // El mes vacio no muestra "No hay clases esta semana": dibuja el calendario igual.
    expect(textoDe(fixture)).toContain('Enero de 2027');
    expect(textoDe(fixture)).not.toContain('No hay clases esta semana');
    expect(replaceState).toHaveBeenLastCalledWith('/clases', 'vista=mes&semana=2027-01-01');
    const raiz = fixture.nativeElement as HTMLElement;
    expect(
      raiz.querySelector('button[aria-label^="viernes 01/01"]')?.getAttribute('aria-label'),
    ).toBe('viernes 01/01, sin clases. Ver la semana');

    clickear(fixture, 'Mes anterior');
    await asentar(fixture);
    esperarClases().flush([]);
    clickear(fixture, 'Mes anterior');
    await asentar(fixture);
    // Noviembre 2026 empieza un domingo: el calendario arranca el lunes 26/10.
    const noviembre = esperarClases();
    expect(desdeDe(noviembre)).toBe('2026-10-26T03:00:00.000Z');
    noviembre.flush([]);
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Noviembre de 2026');
  });

  it('cambiar de vista conserva el período y lo escribe en la URL', async () => {
    otorgar(httpMock, PERMISO_CLASE_READ);
    const replaceState = vi.spyOn(TestBed.inject(Location), 'replaceState');
    const fixture = montar('2026-10-14');
    esperarClases().flush([CLASE]);
    await asentar(fixture);

    clickear(fixture, 'Lista');
    await asentar(fixture);
    expect(replaceState).toHaveBeenLastCalledWith('/clases', 'vista=lista&semana=2026-10-12');
    httpMock.match((p) => p.url === URL_CLASES).forEach((p) => p.flush([CLASE]));
    await asentar(fixture);
    expect((fixture.nativeElement as HTMLElement).querySelector('.tabla')).not.toBeNull();

    clickear(fixture, 'Mes');
    await asentar(fixture);
    expect(replaceState).toHaveBeenLastCalledWith('/clases', 'vista=mes&semana=2026-10-12');
    const mes = httpMock.match((p) => p.url === URL_CLASES);
    expect(desdeDe(mes[mes.length - 1])).toBe('2026-09-28T03:00:00.000Z');
    mes.forEach((p) => p.flush([]));
    await asentar(fixture);

    clickear(fixture, 'Semana');
    await asentar(fixture);
    // La semana es la vista por defecto: no se escribe en la URL.
    expect(replaceState).toHaveBeenLastCalledWith('/clases', 'semana=2026-10-12');
    const semana = httpMock.match((p) => p.url === URL_CLASES);
    expect(desdeDe(semana[semana.length - 1])).toBe('2026-10-12T03:00:00.000Z');
  });

  it('una fecha borrada en el calendario no mueve la semana', async () => {
    otorgar(httpMock, PERMISO_CLASE_READ);
    // Sin `?semana` ni `?vista` (el router los pone en undefined): la semana de hoy de la sede.
    const fixture = montar(undefined as unknown as string, undefined as unknown as string);
    const pedido = esperarClases();
    expect(desdeDe(pedido)).toBe('2026-10-12T03:00:00.000Z');
    pedido.flush([]);
    await asentar(fixture);
    const fecha = (fixture.nativeElement as HTMLElement).querySelector(
      '#clases-fecha',
    ) as HTMLInputElement;
    fecha.value = '';
    fecha.dispatchEvent(new Event('change'));
    await asentar(fixture);
    httpMock.expectNone((p) => p.url === URL_CLASES);
    expect(textoDe(fixture)).toContain('Semana del lunes 12/10 al domingo 18/10');
  });

  it('sin sede elegida no pide clases', async () => {
    const fixture = TestBed.createComponent(ClasesDeLaSemanaPage);
    fixture.detectChanges();
    await asentar(fixture);
    httpMock.expectNone((p) => p.url === URL_CLASES);
    expect((fixture.nativeElement as HTMLElement).querySelector('app-estado-vacio')).toBeNull();
  });

  it('la respuesta de una semana que ya se dejó no pisa la que se está mirando', async () => {
    otorgar(httpMock, PERMISO_CLASE_READ);
    const fixture = montar('2026-10-14');
    const vieja = esperarClases();
    clickear(fixture, 'Semana siguiente');
    await asentar(fixture);
    const nueva = esperarClases();
    nueva.flush([{ ...CLASE, titulo: 'Funcional', inicio: '2026-10-21T21:00:00Z' }]);
    await asentar(fixture);
    vieja.flush([{ ...CLASE, titulo: 'Yoga suave' }]);
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Funcional');
    expect(textoDe(fixture)).not.toContain('Yoga suave');
  });

  it('filtra por actividad y por lugar, cuenta los filtros activos y los limpia', async () => {
    otorgar(httpMock, PERMISO_CLASE_READ);
    const fixture = montar('2026-10-14');
    esperarClases().flush([
      { ...CLASE, id: 1, titulo: 'Yoga suave', ofertaId: 42, espacioId: 9 },
      // Sin nombre de lugar ni de actividad: la opcion muestra el id.
      {
        ...CLASE,
        id: 2,
        titulo: 'Pilates mat',
        ofertaId: 43,
        ofertaNombre: undefined,
        espacioId: 10,
        espacioNombre: undefined,
      },
      { ...CLASE, id: 3, titulo: 'Funcional', ofertaId: 43, ofertaNombre: undefined, espacioId: 9 },
    ]);
    await asentar(fixture);
    const raiz = fixture.nativeElement as HTMLElement;
    const opciones = (id: string) =>
      Array.from((raiz.querySelector(`#${id}`) as HTMLSelectElement).options).map((o) =>
        o.textContent?.trim(),
      );
    expect(opciones('clases-lugar')).toEqual(['Todos', '#10', 'Sala grande']);
    expect(opciones('clases-actividad')).toEqual(['Todas', '#43', 'Pilates reformer']);

    seleccionar(fixture, 'clases-actividad', '43');
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Pilates mat');
    expect(textoDe(fixture)).toContain('Funcional');
    expect(textoDe(fixture)).not.toContain('Yoga suave');

    seleccionar(fixture, 'clases-lugar', '9');
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Funcional');
    expect(textoDe(fixture)).not.toContain('Pilates mat');
    expect(raiz.querySelector('.filtros-barra__contador')?.textContent).toContain('2');

    const canceladas = Array.from(
      raiz.querySelectorAll<HTMLButtonElement>('.filtros-rapidos__opcion'),
    ).find((b) => (b.textContent ?? '').includes('Canceladas')) as HTMLButtonElement;
    canceladas.click();
    await asentar(fixture);
    // El estado tambien cuenta como filtro activo.
    expect(raiz.querySelector('.filtros-barra__contador')?.textContent).toContain('3');
    expect(raiz.querySelector('app-estado-vacio')?.textContent).toContain('No encontramos clases');

    (raiz.querySelector('.filtros-barra__limpiar .boton-texto') as HTMLButtonElement).click();
    await asentar(fixture);
    expect(raiz.querySelector('.filtros-barra__contador')).toBeNull();
    expect((raiz.querySelector('#clases-lugar') as HTMLSelectElement).value).toBe('');
    expect(textoDe(fixture)).toContain('Yoga suave');
    expect(textoDe(fixture)).toContain('Pilates mat');
    expect(textoDe(fixture)).toContain('Funcional');
  });

  it('en la lista, una clase con datos incompletos se dibuja sin inventarlos', async () => {
    otorgar(httpMock, PERMISO_CLASE_READ);
    const fixture = montar('2026-10-14', 'lista');
    esperarClases().flush([
      {
        estado: 'PROGRAMADA',
        inicio: '2026-10-15T21:00:00Z',
        fin: '2026-10-15T22:00:00Z',
        titulo: 'Yoga sin sala',
        version: 0,
      },
      {
        ...CLASE,
        id: 5,
        titulo: 'Stretching',
        capacidadEfectiva: undefined,
        capacidad: 4,
        ocupados: 4,
      },
      { ...CLASE, id: 6, titulo: 'Sin fecha', inicio: undefined, fin: undefined, ocupados: 2 },
    ]);
    await asentar(fixture);
    const raiz = fixture.nativeElement as HTMLElement;
    const filas = () =>
      Array.from(raiz.querySelectorAll('tbody tr')).map((tr) =>
        (tr.textContent ?? '').replace(/\s+/g, ' '),
      );
    // Lo que no tiene inicio va primero; sin capacidad no esta "completa"; sin id no hay enlace.
    expect(filas()[0]).toContain('Sin fecha');
    const yoga = filas().find((f) => f.includes('Yoga sin sala')) as string;
    expect(yoga).toContain('0 de 0 lugares ocupados');
    expect(yoga).not.toContain('completa');
    expect(yoga).toContain('—');
    expect(yoga).not.toContain('Ver clase');
    // La capacidad efectiva que falta se toma de la capacidad declarada.
    expect(filas().find((f) => f.includes('Stretching'))).toContain(
      '4 de 4 lugares ocupados — completa',
    );

    // La busqueda tolera los nombres que faltan.
    const busqueda = raiz.querySelector('#clases-busqueda') as HTMLInputElement;
    busqueda.value = 'sin sala';
    busqueda.dispatchEvent(new Event('input'));
    await asentar(fixture);
    expect(filas()).toHaveLength(1);

    // Ordenar por cupo con una clase sin ocupados: va primera.
    busqueda.value = '';
    busqueda.dispatchEvent(new Event('input'));
    await asentar(fixture);
    const cupo = Array.from(raiz.querySelectorAll<HTMLButtonElement>('th button')).find((b) =>
      (b.textContent ?? '').includes('Cupo'),
    ) as HTMLButtonElement;
    cupo.click();
    await asentar(fixture);
    expect(filas()[0]).toContain('Yoga sin sala');
  });

  it('en la semana, la tarjeta sin profesional ni lugar no deja renglones vacíos', async () => {
    otorgar(httpMock, PERMISO_CLASE_READ);
    const fixture = montar('2026-10-14');
    esperarClases().flush([
      {
        id: 9,
        titulo: 'Yoga sin sala',
        inicio: '2026-10-15T21:00:00Z',
        fin: '2026-10-15T22:00:00Z',
        version: 0,
      },
    ]);
    await asentar(fixture);
    const tarjeta = (fixture.nativeElement as HTMLElement).querySelector(
      '.clase-tarjeta',
    ) as HTMLElement;
    // Solo el horario: ni profesional ni lugar.
    expect(tarjeta.querySelectorAll('.clase-tarjeta__dato')).toHaveLength(1);
    expect(tarjeta.textContent).toContain('0/0');
    expect(tarjeta.textContent).not.toContain('Completa');
  });
});
