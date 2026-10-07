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
    const { fixture, anfitrion } = await montar([]);
    expect(anfitrion.textContent).toContain('No hay solicitudes');

    escribir(anfitrion, '#filtro-estado-bandeja', 'TODAS', 'change');
    const todas = httpMock.expectOne(esListado);
    expect(todas.request.params.has('estado')).toBe(false);
    todas.flush(null, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('ya no administra la plataforma');
  });

  it('traduce los errores que no pasan por la pantalla', () => {
    expect(traducirErrorSolicitud(new Error('x')).causa).toBe('otro');
  });

  async function montar(solicitudes: readonly object[]): Promise<{
    fixture: ComponentFixture<SolicitudesCatalogoPage>;
    anfitrion: HTMLElement;
  }> {
    const fixture = TestBed.createComponent(SolicitudesCatalogoPage);
    fixture.detectChanges();
    const pedido = httpMock.expectOne(esListado);
    expect(pedido.request.params.get('estado')).toBe('PENDIENTE');
    pedido.flush(solicitudes);
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
