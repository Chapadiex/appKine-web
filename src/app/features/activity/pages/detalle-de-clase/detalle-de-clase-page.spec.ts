import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import {
  PERMISO_CLASE_MANAGE,
  PERMISO_CLASE_READ,
  PERMISO_INSCRIPCION_MANAGE,
  PERMISO_INSCRIPCION_READ,
} from '../../../../core/models/permisos';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import {
  URL_CLASES,
  URL_OFERTAS,
  asentar,
  clickear,
  escribir,
  otorgar,
  proveerDiaDeLaSede,
  textoDe,
} from '../../testing/activity-testing';
import { DetalleDeClasePage } from './detalle-de-clase-page';

const ID = 70;
const URL_CLASE = `${URL_CLASES}/${ID}`;
const INSCRIPCIONES = `${URL_CLASE}/inscripciones`;

const CLASE = {
  id: ID,
  ofertaId: 42,
  profesionalId: 55,
  espacioId: 9,
  estado: 'PROGRAMADA',
  inicio: '2026-10-20T21:00:00Z',
  fin: '2026-10-20T22:00:00Z',
  capacidad: 2,
  capacidadEfectiva: 2,
  ocupados: 2,
  version: 3,
};

const CUPOS = {
  claseId: ID,
  capacidad: 2,
  capacidadEfectiva: 2,
  ocupados: 2,
  disponibles: 0,
  enEspera: 1,
};

const PARTICIPANTES = [
  {
    nombre: 'Ana',
    apellido: 'Perez',
    tipoDocumento: 'DNI',
    numeroDocumento: '30111222',
    inscripcion: { id: 501, personaId: 128, estado: 'RESERVADA' },
  },
  {
    nombre: 'Luis',
    apellido: 'Gomez',
    inscripcion: { id: 502, personaId: 129, estado: 'CONFIRMADA' },
  },
  {
    nombre: 'Eva',
    apellido: 'Sosa',
    inscripcion: { id: 503, personaId: 130, estado: 'LISTA_ESPERA', posicionEspera: 1 },
  },
  {
    nombre: 'Juan',
    apellido: 'Paz',
    inscripcion: { id: 499, personaId: 131, estado: 'CANCELADA', motivoCancelacion: 'viaje' },
  },
];

describe('DetalleDeClasePage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DetalleDeClasePage],
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

  /** Responde las tres lecturas de la clase. */
  function responderClase(clase: object = CLASE, cupos: object = CUPOS): void {
    httpMock.expectOne(URL_CLASE).flush(clase);
    httpMock.expectOne(`${URL_CLASE}/cupos`).flush(cupos);
    httpMock.expectOne(`${URL_CLASE}/historial`).flush([
      { id: 1, tipo: 'CREACION', ocurridoEn: '2026-10-14T13:00:00Z' },
      {
        id: 2,
        tipo: 'REPROGRAMACION',
        ocurridoEn: '2026-10-14T14:00:00Z',
        inicioAnterior: '2026-10-20T20:00:00Z',
        inicioNuevo: '2026-10-20T21:00:00Z',
      },
    ]);
  }

  function responderNombres(): void {
    httpMock
      .expectOne((p) => p.url === URL_OFERTAS)
      .flush([{ id: 42, nombreComercial: 'Pilates reformer', modalidad: 'GRUPAL' }]);
    httpMock
      .expectOne(`${URL_OFERTAS}/42/habilitaciones`)
      .flush({ profesionales: [{ membershipId: 55, nombre: 'Lic. Diaz' }] });
  }

  async function montar(
    permisos: string[] = [
      PERMISO_CLASE_READ,
      PERMISO_CLASE_MANAGE,
      PERMISO_INSCRIPCION_READ,
      PERMISO_INSCRIPCION_MANAGE,
    ],
  ): Promise<ComponentFixture<DetalleDeClasePage>> {
    otorgar(httpMock, ...permisos);
    const fixture = TestBed.createComponent(DetalleDeClasePage);
    fixture.componentRef.setInput('claseId', String(ID));
    fixture.detectChanges();
    responderClase();
    responderNombres();
    await asentar(fixture);
    if (permisos.includes(PERMISO_INSCRIPCION_READ)) {
      httpMock.expectOne(INSCRIPCIONES).flush(PARTICIPANTES);
      await asentar(fixture);
    }
    return fixture;
  }

  it(
    'muestra la clase, sus cupos, los inscriptos, la espera, las bajas y el historial',
    async () => {
      const fixture = await montar();
      const texto = textoDe(fixture);
      expect(texto).toContain('Pilates reformer');
      expect(texto).toContain('martes 20/10, 18:00 a 19:00');
      expect(texto).toContain('Lic. Diaz');
      expect(texto).toContain('Box #9');
      expect(texto).toContain('2 de 2');
      expect(texto).toContain('Perez, Ana');
      expect(texto).toContain('DNI 30111222');
      expect(texto).toContain('Sosa, Eva — posicion 1');
      expect(texto).toContain('Paz, Juan');
      expect(texto).toContain('(viaje)');
      expect(texto).toContain('Reprogramada');
      expect(texto).toContain('Inscribir a una persona');
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  it('sin inscripcion:read no pide ni muestra participantes, y sin manage no ofrece acciones', async () => {
    const fixture = await montar([PERMISO_CLASE_READ]);
    const texto = textoDe(fixture);
    expect(texto).not.toContain('Participantes');
    expect(texto).not.toContain('Inscribir a una persona');
    expect(texto).not.toContain('Reprogramar');
    httpMock.expectNone(INSCRIPCIONES);
  });

  it('inscribir sin lugar ofrece la lista de espera y la usa', async () => {
    const fixture = await montar();
    escribir(fixture, '#inscribir-persona', 'Rios');
    await new Promise((resolve) => setTimeout(resolve, 400));
    httpMock
      .expectOne((p) => p.url === '/api/v1/personas' && p.params.get('q') === 'Rios')
      .flush({ content: [{ id: 140, apellido: 'Rios', nombre: 'Mara', numeroDocumento: '1' }] });
    await asentar(fixture);
    clickear(fixture, 'Rios, Mara');

    clickear(fixture, 'Inscribir');
    const primero = httpMock.expectOne(INSCRIPCIONES);
    expect(primero.request.body).toEqual(
      expect.objectContaining({ personaId: 140, aceptaListaEspera: false }),
    );
    const clave = (primero.request.body as { idempotencyKey: string }).idempotencyKey;
    primero.flush(
      {
        type: 'https://akine.app/problems/clase-completa',
        status: 409,
        capacidadEfectiva: 2,
        ocupados: 2,
      },
      { status: 409, statusText: 'Conflict' },
    );
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Ocupados 2 de 2');

    clickear(fixture, 'Anotar en la lista de espera');
    const segundo = httpMock.expectOne(INSCRIPCIONES);
    expect((segundo.request.body as { aceptaListaEspera: boolean }).aceptaListaEspera).toBe(true);
    expect((segundo.request.body as { idempotencyKey: string }).idempotencyKey).not.toBe(clave);
    segundo.flush({
      inscripcion: { id: 504, personaId: 140, estado: 'LISTA_ESPERA', posicionEspera: 2 },
    });
    await asentar(fixture);
    responderClase();
    await asentar(fixture);
    httpMock.expectOne(INSCRIPCIONES).flush(PARTICIPANTES);
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Rios, Mara quedo en la lista de espera, posicion 2');
  });

  it('inscribir con lugar y con espera marcada de antemano', async () => {
    const fixture = await montar();
    escribir(fixture, '#inscribir-persona', 'Rios');
    await new Promise((resolve) => setTimeout(resolve, 400));
    httpMock
      .expectOne((p) => p.url === '/api/v1/personas')
      .flush({ content: [{ id: 140, apellido: 'Rios', nombre: 'Mara' }] });
    await asentar(fixture);
    clickear(fixture, 'Rios, Mara');
    const marca = (fixture.nativeElement as HTMLElement).querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    marca.checked = true;
    marca.dispatchEvent(new Event('change'));
    clickear(fixture, 'Inscribir');
    const pedido = httpMock.expectOne(INSCRIPCIONES);
    expect((pedido.request.body as { aceptaListaEspera: boolean }).aceptaListaEspera).toBe(true);
    pedido.flush({ inscripcion: { id: 505, estado: 'RESERVADA' } });
    await asentar(fixture);
    responderClase();
    await asentar(fixture);
    httpMock.expectOne(INSCRIPCIONES).flush(PARTICIPANTES);
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Rios, Mara quedo inscripta con lugar');
  });

  it('la baja nombra a quien entro desde la espera', async () => {
    const fixture = await montar();
    clickear(fixture, 'Dar de baja a Perez, Ana');
    escribir(fixture, '#inscripcion-baja-motivo', 'No puede venir');
    const enviar = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button[type="submit"]'),
    ).find((b) => b.textContent?.includes('Dar de baja')) as HTMLButtonElement;
    enviar.click();
    fixture.detectChanges();
    const pedido = httpMock.expectOne(`${INSCRIPCIONES}/501/cancelacion`);
    expect(pedido.request.body).toEqual({ motivo: 'No puede venir' });
    pedido.flush({
      inscripcion: { id: 501, estado: 'CANCELADA' },
      promovida: { id: 503, personaId: 130, estado: 'RESERVADA' },
    });
    await asentar(fixture);
    responderClase();
    await asentar(fixture);
    httpMock.expectOne(INSCRIPCIONES).flush(PARTICIPANTES);
    await asentar(fixture);
    expect(textoDe(fixture)).toContain(
      'Se dio de baja a Perez, Ana. Sosa, Eva entro desde la lista de espera',
    );
  });

  it('confirmar una reserva y un rechazo de transicion relee la clase', async () => {
    const fixture = await montar();
    clickear(fixture, 'Confirmar a Perez, Ana');
    httpMock.expectOne(`${INSCRIPCIONES}/501/confirmacion`).flush(
      {
        type: 'https://akine.app/problems/inscripcion-transicion-no-permitida',
        status: 409,
        motivo: 'cancelada',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('La inscripcion no admite esa operacion');
    expect(textoDe(fixture)).toContain('Detalle: cancelada');
    responderClase();
    await asentar(fixture);
    httpMock.expectOne(INSCRIPCIONES).flush(PARTICIPANTES);
  });

  it('reprograma con la version leida y cancela con motivo', async () => {
    const fixture = await montar();
    clickear(fixture, 'Reprogramar');
    const raiz = fixture.nativeElement as HTMLElement;
    expect((raiz.querySelector('#reprogramar-inicio') as HTMLInputElement).value).toBe('18:00');
    escribir(fixture, '#reprogramar-inicio', '19:00');
    escribir(fixture, '#reprogramar-fin', '20:00');
    clickear(fixture, 'Guardar el cambio');
    const pedido = httpMock.expectOne(`${URL_CLASE}/reprogramacion`);
    expect(pedido.request.body).toEqual({
      inicio: '2026-10-20T22:00:00.000Z',
      fin: '2026-10-20T23:00:00.000Z',
      capacidad: 2,
      profesionalId: 55,
      version: 3,
    });
    pedido.flush({ ...CLASE, version: 4 });
    await asentar(fixture);
    responderClase();
    await asentar(fixture);
    httpMock.expectOne(INSCRIPCIONES).flush(PARTICIPANTES);
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Clase reprogramada');

    clickear(fixture, 'Cancelar la clase');
    escribir(fixture, '#clase-cancelar-motivo', 'Profesional enfermo');
    const confirmar = Array.from(raiz.querySelectorAll('button[type="submit"]')).find((b) =>
      b.textContent?.includes('Cancelar la clase'),
    ) as HTMLButtonElement;
    confirmar.click();
    fixture.detectChanges();
    const cancelacion = httpMock.expectOne(`${URL_CLASE}/cancelacion`);
    expect(cancelacion.request.body).toEqual({ motivo: 'Profesional enfermo' });
    cancelacion.flush({ ...CLASE, estado: 'CANCELADA' });
    await asentar(fixture);
    responderClase({ ...CLASE, estado: 'CANCELADA', motivoCancelacion: 'Profesional enfermo' });
    await asentar(fixture);
    httpMock.expectOne(INSCRIPCIONES).flush([]);
    await asentar(fixture);
    const texto = textoDe(fixture);
    expect(texto).toContain('Clase cancelada');
    expect(texto).toContain('Cancelada — Profesional enfermo');
    expect(texto).not.toContain('Inscribir a una persona');
  });

  it('la version vieja al reprogramar se explica y relee', async () => {
    const fixture = await montar();
    clickear(fixture, 'Reprogramar');
    escribir(fixture, '#reprogramar-fin', '17:00');
    clickear(fixture, 'Guardar el cambio');
    expect(textoDe(fixture)).toContain('La hora de fin tiene que ser posterior');
    httpMock.expectNone(`${URL_CLASE}/reprogramacion`);

    escribir(fixture, '#reprogramar-fin', '19:30');
    clickear(fixture, 'Guardar el cambio');
    httpMock
      .expectOne(`${URL_CLASE}/reprogramacion`)
      .flush(
        { type: 'https://akine.app/problems/concurrent-modification', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Alguien modifico la clase');
    responderClase();
    await asentar(fixture);
    httpMock.expectOne(INSCRIPCIONES).flush(PARTICIPANTES);
    clickear(fixture, 'Volver sin cambiar');
  });

  it('una clase que no existe muestra el error y permite reintentar', async () => {
    otorgar(httpMock, PERMISO_CLASE_READ);
    const fixture = TestBed.createComponent(DetalleDeClasePage);
    fixture.componentRef.setInput('claseId', String(ID));
    fixture.detectChanges();
    httpMock
      .expectOne(URL_CLASE)
      .flush(
        { type: 'https://akine.app/problems/not-found', status: 404 },
        { status: 404, statusText: 'Not Found' },
      );
    // Las otras dos lecturas del primer intento quedan sin respuesta util: se descartan.
    httpMock
      .match((p) => p.url.startsWith(`${URL_CLASE}/`))
      .filter((r) => !r.cancelled)
      .forEach((r) => r.flush(null, { status: 404, statusText: 'Not Found' }));
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('No se pudo leer la clase');
    clickear(fixture, 'Reintentar');
    responderClase();
    responderNombres();
  });
});
