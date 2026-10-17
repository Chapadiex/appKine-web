import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { SolicitudesCatalogoPage } from './solicitudes-catalogo-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';
import { traducirErrorSolicitud } from '../../models/solicitud-errors';

const LISTADO = '/api/v1/catalogo-solicitudes';
const CENTROS = '/api/v1/platform/organizations';

/** Una pagina del listado de centros de la plataforma. */
function paginaDeCentros(
  centros: readonly { id: number; name: string }[],
  page = 0,
  totalPages = 1,
): object {
  return { content: centros, page, size: 100, totalPages, totalElements: centros.length };
}

const CENTRO_SUR = paginaDeCentros([{ id: 3, name: 'Centro Kinesio Sur' }]);

const PRACTICA = {
  id: 9,
  organizationId: 3,
  consultorioId: 30,
  tipo: 'PRACTICA',
  nombrePropuesto: 'Drenaje linfatico',
  codigoPropuesto: 'DL-01',
  justificacion: 'La pide la obra social provincial',
  estado: 'PENDIENTE',
  createdAt: '2026-10-01T12:00:00Z',
  version: 4,
};

const ESPECIALIDAD = {
  ...PRACTICA,
  id: 10,
  tipo: 'ESPECIALIDAD',
  nombrePropuesto: 'Terapia ocupacional',
  codigoPropuesto: undefined,
  version: 1,
};

/**
 * Bandeja de solicitudes de la consola de plataforma (AKINE-A-7, RF-M06-005).
 *
 * <p>Cubre lo que cuesta caro si se rompe: que aprobar mande la normalizacion precargada con lo
 * propuesto y la especialidad de una practica; que el 409 de duplicado diga que la solicitud
 * <b>sigue pendiente</b>; y que un rechazo viaje sin datos de concepto (sino es 400).
 */
describe('SolicitudesCatalogoPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SolicitudesCatalogoPage],
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
    'aprobar una practica publica con lo propuesto y la especialidad global elegida',
    async () => {
      const { fixture, anfitrion } = await montar([PRACTICA]);
      await esperarSinViolaciones(anfitrion);

      clickEn(anfitrion, 'Revisar');
      fixture.detectChanges();
      clickEn(anfitrion, 'Aprobar y publicar');
      fixture.detectChanges();

      const especialidades = httpMock.expectOne(
        (r) => r.url === '/api/v1/catalogos/especialidades',
      );
      expect(especialidades.request.params.get('alcance')).toBe('GLOBAL');
      especialidades.flush({ content: [{ id: 5, name: 'Kinesiologia', codigo: 'KIN' }] });
      fixture.detectChanges();

      // Precargado con lo que propuso el centro.
      expect(valor(anfitrion, '#resolucion-codigo')).toBe('DL-01');
      expect(valor(anfitrion, '#resolucion-nombre')).toBe('Drenaje linfatico');

      // Sin especialidad ni nota, no sale nada.
      enviar(anfitrion);
      fixture.detectChanges();
      expect(anfitrion.textContent).toContain('necesita su especialidad');
      expect(anfitrion.textContent).toContain('La nota es obligatoria');

      escribir(anfitrion, '#resolucion-especialidad', '5', 'change');
      escribir(anfitrion, '#resolucion-nota', 'Alta segun nomenclador provincial');
      fixture.detectChanges();
      await esperarSinViolaciones(anfitrion);
      enviar(anfitrion);

      const resolver = httpMock.expectOne(`${LISTADO}/9/resolve`);
      expect(resolver.request.body).toEqual({
        estado: 'APROBADA',
        nota: 'Alta segun nomenclador provincial',
        version: 4,
        codigo: 'DL-01',
        nombre: 'Drenaje linfatico',
        especialidadId: 5,
      });
      resolver.flush({ ...PRACTICA, estado: 'APROBADA', conceptoId: 77, version: 5 });
      httpMock.expectOne(esListado).flush([]);
      fixture.detectChanges();

      expect(anfitrion.textContent).toContain('ya esta publicado en el catalogo comun');
      expect(anfitrion.textContent).toContain('concepto 77');
    },
    TIMEOUT_AXE,
  );

  it('un codigo ya tomado lo dice en el campo y aclara que la solicitud sigue pendiente', async () => {
    const { fixture, anfitrion } = await montar([ESPECIALIDAD]);

    clickEn(anfitrion, 'Revisar');
    fixture.detectChanges();
    clickEn(anfitrion, 'Aprobar y publicar');
    fixture.detectChanges();
    escribir(anfitrion, '#resolucion-codigo', 'TO');
    escribir(anfitrion, '#resolucion-nota', 'Alta');
    fixture.detectChanges();
    enviar(anfitrion);

    httpMock
      .expectOne(`${LISTADO}/10/resolve`)
      .flush(
        { type: 'https://akine.app/problems/catalogo-code-taken', status: 409, detail: 'x' },
        { status: 409, statusText: 'Conflict' },
      );
    fixture.detectChanges();

    const codigo = anfitrion.querySelector('#resolucion-codigo');
    expect(codigo?.getAttribute('aria-invalid')).toBe('true');
    expect(anfitrion.textContent).toContain('La solicitud sigue pendiente');
    // No se relee la bandeja: el formulario queda para corregir.
  });

  it('rechazar manda solo la nota, sin datos de concepto', async () => {
    const { fixture, anfitrion } = await montar([ESPECIALIDAD]);

    clickEn(anfitrion, 'Revisar');
    fixture.detectChanges();
    clickEn(anfitrion, 'Rechazar');
    fixture.detectChanges();
    escribir(anfitrion, '#resolucion-nota', 'Ya existe como Terapia ocupacional (TO)');
    fixture.detectChanges();
    enviar(anfitrion);

    const resolver = httpMock.expectOne(`${LISTADO}/10/resolve`);
    expect(resolver.request.body).toEqual({
      estado: 'RECHAZADA',
      nota: 'Ya existe como Terapia ocupacional (TO)',
      version: 1,
    });
    // Otra persona llego primero: se descarta el detalle y se relee la bandeja.
    resolver.flush(
      { type: 'https://akine.app/problems/catalogo-solicitud-ya-resuelta', status: 409 },
      { status: 409, statusText: 'Conflict' },
    );
    httpMock.expectOne(esListado).flush([]);
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('Otra persona resolvio');
    expect(anfitrion.querySelector('#resolucion-nota')).toBeNull();
  });

  it('el filtro relee la bandeja con el estado elegido', async () => {
    const { fixture, anfitrion } = await montar([], null);
    expect(anfitrion.textContent).toContain('No hay solicitudes');

    escribir(anfitrion, '#filtro-estado-bandeja', 'TODAS', 'change');
    const todas = httpMock.expectOne(esListado);
    expect(todas.request.params.has('estado')).toBe(false);
    todas.flush(null, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('ya no administra la plataforma');
  });

  it('nombra al centro en la bandeja y en el detalle, sin mostrar sus ids (RNF-M01-005)', async () => {
    const { fixture, anfitrion } = await montar([PRACTICA]);

    const fila = anfitrion.querySelector('tbody tr');
    expect(fila?.textContent).toContain('Centro Kinesio Sur');
    expect(
      [...(fila?.querySelectorAll('td') ?? [])].map((td) => td.textContent?.trim()),
    ).not.toContain('3');

    clickEn(anfitrion, 'Revisar');
    fixture.detectChanges();
    const detalle = anfitrion.querySelector('dl.detalle')?.textContent ?? '';
    expect(detalle).toContain('Centro Kinesio Sur');
    expect(detalle).toContain('la pidio desde una de sus sedes');
    expect(detalle).not.toContain('sede 30');
  });

  it('recorre las paginas de centros hasta encontrarlos y no los vuelve a pedir', async () => {
    const OTRO = { ...ESPECIALIDAD, organizationId: 250 };
    const fixture = TestBed.createComponent(SolicitudesCatalogoPage);
    fixture.detectChanges();
    httpMock.expectOne(esListado).flush([PRACTICA, OTRO]);

    const primera = httpMock.expectOne((r) => r.url === CENTROS);
    expect(primera.request.params.get('page')).toBe('0');
    expect(primera.request.params.get('size')).toBe('100');
    primera.flush(paginaDeCentros([{ id: 3, name: 'Centro Kinesio Sur' }], 0, 5));
    const segunda = httpMock.expectOne((r) => r.url === CENTROS);
    expect(segunda.request.params.get('page')).toBe('1');
    segunda.flush(paginaDeCentros([{ id: 250, name: 'Rehabilitar Norte' }], 1, 5));
    // Con los dos encontrados no pide la tercera de las cinco paginas.
    httpMock.expectNone((r) => r.url === CENTROS);
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('Centro Kinesio Sur');
    expect(anfitrion.textContent).toContain('Rehabilitar Norte');

    // Releer la bandeja con centros ya conocidos no vuelve a recorrer el listado.
    escribir(anfitrion, '#filtro-estado-bandeja', 'TODAS', 'change');
    httpMock.expectOne(esListado).flush([OTRO]);
    httpMock.expectNone((r) => r.url === CENTROS);
  });

  it('un centro que no figura en el listado, o un listado que falla, no muestra el id', async () => {
    const { fixture, anfitrion } = await montar([PRACTICA], paginaDeCentros([]));
    expect(anfitrion.querySelector('tbody tr')?.textContent).toContain(
      'Centro dado de baja o no disponible',
    );

    escribir(anfitrion, '#filtro-estado-bandeja', 'TODAS', 'change');
    httpMock.expectOne(esListado).flush([PRACTICA]);
    httpMock
      .expectOne((r) => r.url === CENTROS)
      .flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    // La bandeja sigue en pie: solo le falta el nombre.
    expect(anfitrion.querySelector('tbody tr')?.textContent).toContain(
      'Centro dado de baja o no disponible',
    );
    expect(anfitrion.textContent).toContain('Drenaje linfatico');
  });

  it('traduce los errores que no pasan por la pantalla', () => {
    expect(traducirErrorSolicitud(new Error('x')).causa).toBe('otro');
  });

  async function montar(
    solicitudes: readonly object[],
    centros: object | null = CENTRO_SUR,
  ): Promise<{
    fixture: ComponentFixture<SolicitudesCatalogoPage>;
    anfitrion: HTMLElement;
  }> {
    const fixture = TestBed.createComponent(SolicitudesCatalogoPage);
    fixture.detectChanges();
    const pedido = httpMock.expectOne(esListado);
    expect(pedido.request.params.get('estado')).toBe('PENDIENTE');
    pedido.flush(solicitudes);
    if (centros !== null) {
      httpMock.expectOne((r) => r.url === CENTROS).flush(centros);
    }
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, anfitrion: fixture.nativeElement as HTMLElement };
  }
});

function esListado(peticion: HttpRequest<unknown>): boolean {
  return peticion.method === 'GET' && peticion.url === LISTADO;
}

function clickEn(anfitrion: HTMLElement, texto: string): void {
  const boton = [...anfitrion.querySelectorAll('button')].find(
    (candidato) => (candidato.textContent ?? '').trim() === texto,
  );
  if (boton === undefined) {
    throw new Error(`No hay boton "${texto}"`);
  }
  boton.click();
}

function escribir(anfitrion: HTMLElement, selector: string, texto: string, evento = 'input'): void {
  const campo = anfitrion.querySelector<HTMLInputElement>(selector);
  if (campo === null) {
    throw new Error(`No hay ${selector}`);
  }
  campo.value = texto;
  campo.dispatchEvent(new Event(evento));
}

function valor(anfitrion: HTMLElement, selector: string): string | undefined {
  return anfitrion.querySelector<HTMLInputElement>(selector)?.value;
}

function enviar(anfitrion: HTMLElement): void {
  anfitrion.querySelector('form')?.dispatchEvent(new Event('submit'));
}
