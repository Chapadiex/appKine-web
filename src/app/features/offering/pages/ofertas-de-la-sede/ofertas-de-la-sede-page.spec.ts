import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { OfertasDeLaSedePage } from './ofertas-de-la-sede-page';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import {
  RUTA_PERMISOS_EFECTIVOS,
  RUTA_SERVICIOS,
  rutaOfertas,
} from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const SEDE = 3;
const OFERTAS = rutaOfertas(SEDE);

const SERVICIO = {
  id: 1,
  codigo: 'KRES',
  nombre: 'Kinesiologia respiratoria',
  naturaleza: 'CLINICO',
  modalidadDefault: 'INDIVIDUAL',
  requiereCasoClinicoDefault: true,
  generaRegistroClinicoDefault: true,
  estado: 'ACTIVO',
  version: 1,
};

/** Vigente hoy: se ofrece para reservar. */
const VIGENTE = {
  id: 10,
  organizationId: 1,
  consultorioId: SEDE,
  servicioId: 1,
  nombreComercial: 'Rehabilitacion respiratoria adultos',
  modalidad: 'INDIVIDUAL',
  duracionMinutos: 45,
  capacidad: 1,
  precioBase: 15000,
  moneda: 'ARS',
  admiteObraSocial: true,
  requiereCasoClinico: true,
  generaRegistroClinico: true,
  requiereProfesional: true,
  requiereEspacio: true,
  vigenciaDesde: '2026-01-01',
  estado: 'ACTIVO',
  vigenteHoy: true,
  version: 4,
};

/**
 * ACTIVA pero <b>todavia sin vigencia</b>: arranca mas adelante.
 *
 * <p>Es el caso que la pantalla existe para no aplanar. `estado` dice ACTIVO y `vigenteHoy` dice
 * `false`, y las dos cosas son correctas al mismo tiempo.
 */
const AUN_NO = {
  ...VIGENTE,
  id: 11,
  nombreComercial: 'Pilates terapeutico grupal',
  modalidad: 'GRUPAL',
  capacidad: 8,
  vigenciaDesde: '2099-03-01',
  vigenteHoy: false,
  version: 1,
};

/**
 * Spec de las ofertas de la sede (M27, AKINE-02.06).
 *
 * <p>Cubre lo que el criterio de aceptacion exige y nada mas. Los cuatro casos elegidos tienen algo
 * en comun: <b>cuando estan mal, el sintoma no es un error</b>.
 *
 * <ol>
 *   <li>Una oferta activa que todavia no arranco tiene que verse distinta de una operativa. Si se
 *       aplana, nadie ve un error: la oferta simplemente no aparece en la agenda y se reporta como
 *       bug de la agenda.</li>
 *   <li>Omitir un campo heredable en el alta tiene que <b>omitirlo</b>. Mandar `false` responde
 *       `201` igual, y la oferta queda con el valor apagado en vez del del catalogo.</li>
 *   <li>`limpiarVigenciaHasta` tiene que viajar solo cuando se marca la casilla. Vaciar el campo y
 *       mandarlo no saca nada, y el usuario cree que si.</li>
 *   <li>El `409 conflict` tiene que frenar. Reintentar en silencio pisa el cambio de otro y
 *       responde `200`.</li>
 * </ol>
 */
describe('OfertasDeLaSedePage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OfertasDeLaSedePage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    tenantContext = TestBed.inject(TenantContextStore);
    permisos = TestBed.inject(PermissionsStore);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('distingue una oferta vigente de una activa que todavia no arranco', async () => {
    const fixture = await montar();
    const filas = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(filas.length).toBe(2);

    const laVigente = filas[0] as HTMLElement;
    const laQueNoArranco = filas[1] as HTMLElement;

    expect(laVigente.textContent).toContain('Activa y vigente');

    // Las dos son ACTIVAS. Lo que las separa es la vigencia de hoy, y la fila lo dice con
    // palabras -no solo con un gris-, porque el color no puede ser el unico portador (WCAG 1.4.1).
    expect(laQueNoArranco.textContent).toContain('Activa, todavia sin vigencia');
    expect(laQueNoArranco.textContent).toContain('no aparece en los selectores de reserva');
    expect(laQueNoArranco.className).toContain('fila--atenuada');
    expect(laQueNoArranco.className).not.toContain('fila--revocada');

    // Y la nota de arriba explica la distincion una sola vez, para no repetirla por fila.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Activa y vigente hoy no son lo mismo',
    );
  });

  it('el filtro por servicio recarga con su parametro', async () => {
    const fixture = await montar();

    elegir(fixture, '#filtro-servicio-oferta', '1');
    const filtrada = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.url === OFERTAS && peticion.params.get('servicioId') === '1',
    );
    expect(filtrada.request.params.get('estado')).toBe('ACTIVO');
    filtrada.flush([VIGENTE]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Rehabilitacion respiratoria adultos',
    );
  });

  it('el alta OMITE lo que quedo en heredar: heredar no es apagar', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de alta una oferta');
    elegir(fixture, '#alta-oferta-servicio', '1');
    escribir(fixture, '#alta-oferta-nombre', 'Kinesio respiratoria');
    escribir(fixture, '#alta-oferta-duracion', '45');
    enviar(fixture, 'form[novalidate]');

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === OFERTAS,
    );
    const cuerpo = alta.request.body as Record<string, unknown>;

    // Los tres heredables quedaron en "heredar del servicio": NO viajan. Si viajaran como
    // `false`, el backend los apagaria en vez de tomar el default del catalogo, y responderia
    // `201` igual.
    expect(cuerpo['modalidad']).toBeUndefined();
    expect(cuerpo['requiereCasoClinico']).toBeUndefined();
    expect(cuerpo['generaRegistroClinico']).toBeUndefined();
    // Estos dos no heredan nada, asi que siempre viajan con lo que dice la casilla.
    expect(cuerpo['requiereProfesional']).toBe(true);
    expect(cuerpo['requiereEspacio']).toBe(true);
    expect(cuerpo['servicioId']).toBe(1);
    expect(cuerpo['duracionMinutos']).toBe(45);
    // Precio y moneda vacios: no viaja ninguno de los dos. Uno solo es un rechazo garantizado.
    expect(cuerpo['precioBase']).toBeUndefined();
    expect(cuerpo['moneda']).toBeUndefined();

    alta.flush({ ...VIGENTE, id: 12 });
    httpMock.expectOne(esListado()).flush([VIGENTE, AUN_NO]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'quedo dada de alta en esta sede',
    );
  });

  it('la casilla es la unica forma de sacar el fin de vigencia, y ademas vacia el campo', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    marcar(fixture, '#editar-oferta-limpiar-vigencia');

    // El campo se deshabilita y se vacia: dejar en pantalla un valor que no se va a mandar es
    // un estado contradictorio, no una sutileza.
    const campo = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '#editar-oferta-hasta',
    );
    expect(campo?.disabled).toBe(true);
    expect(campo?.value).toBe('');

    enviar(fixture, 'form[novalidate]');

    const edicion = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PUT' && peticion.url === `${OFERTAS}/10`,
    );
    expect(edicion.request.body).toEqual({ expectedVersion: 4, limpiarVigenciaHasta: true });

    edicion.flush({ ...VIGENTE, version: 5 });
    httpMock.expectOne(esListado()).flush([VIGENTE, AUN_NO]);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('el 409 conflict no pisa nada: relee, deja el panel abierto y explica', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-oferta-nombre', 'Rehabilitacion respiratoria');
    enviar(fixture, 'form[novalidate]');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'PUT' && peticion.url === `${OFERTAS}/10`,
      )
      // `conflict`, NO `concurrent-modification`: es lo que emite el handler global para el
      // bloqueo optimista de este modulo. Ver `offering-errors.ts`.
      .flush(
        { type: 'https://akine.app/problems/conflict', detail: 'la version quedo vieja' },
        { status: 409, statusText: 'Conflict' },
      );
    fixture.detectChanges();

    httpMock.expectOne(esListado()).flush([{ ...VIGENTE, version: 9 }, AUN_NO]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('no guardamos tus cambios para no pisar los suyos');
    expect(anfitrion.querySelector<HTMLInputElement>('#editar-oferta-nombre')?.value).toBe(
      'Rehabilitacion respiratoria',
    );
  });

  it('sin sede elegida no consulta ofertas y manda a elegirla, no al login', async () => {
    tenantContext.select({ organizationId: 1, organizationName: 'Centro Belgrano' });
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(OfertasDeLaSedePage);
    fixture.detectChanges();

    // Ni una peticion de ofertas: la ruta empieza en el consultorio y no se puede ni armar.
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.url.includes('/ofertas'));
    httpMock.match(esCatalogo()).forEach((peticion) => peticion.flush([SERVICIO]));
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('Todavia no elegiste un consultorio');
    expect(anfitrion.querySelector('a[href="/seleccionar-contexto"]')).not.toBeNull();
    expect(anfitrion.textContent).not.toContain('Sesion expirada');
  });

  it(
    'la pantalla no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  async function montar(): Promise<ComponentFixture<OfertasDeLaSedePage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({
      permissions: [PERMISO_CONSULTORIO_MANAGE],
    });

    const fixture = TestBed.createComponent(OfertasDeLaSedePage);
    fixture.detectChanges();

    httpMock.expectOne(esListado()).flush([VIGENTE, AUN_NO]);
    httpMock.expectOne(esCatalogo()).flush([SERVICIO]);
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  function esListado() {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'GET' && peticion.url === OFERTAS && !peticion.params.has('servicioId');
  }

  /**
   * El catalogo global, matcheado por ruta y NO por URL completa.
   *
   * <p>El cliente generado manda el filtro de estado por defecto, asi que la URL real es
   * `/api/v1/servicios?estado=ACTIVO` y un `expectOne(RUTA_SERVICIOS)` con string no la
   * encuentra. Comparar la ruta sin los parametros es lo correcto igual: lo que esta pantalla
   * necesita fijar es QUE pide el catalogo, no con que filtro por defecto lo pide el cliente.
   */
  function esCatalogo() {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'GET' && peticion.url === RUTA_SERVICIOS;
  }
});

function elegir(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: string,
) {
  const campo = fixture.nativeElement.querySelector(selector) as HTMLSelectElement | null;
  if (campo === null) {
    throw new Error(`No existe el selector ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

function abrir(fixture: { nativeElement: HTMLElement; detectChanges(): void }, etiqueta: string) {
  const boton = [...fixture.nativeElement.querySelectorAll('button')].find(
    (candidato) => (candidato.textContent ?? '').trim() === etiqueta,
  );
  if (boton === undefined) {
    throw new Error(`No existe el boton ${etiqueta}`);
  }
  boton.click();
  fixture.detectChanges();
}

function escribir(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: string,
) {
  const campo = fixture.nativeElement.querySelector<HTMLInputElement>(selector);
  if (campo === null) {
    throw new Error(`No existe el campo ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function enviar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string) {
  const formulario = fixture.nativeElement.querySelector<HTMLFormElement>(selector);
  formulario?.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}

function marcar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string) {
  const casilla = fixture.nativeElement.querySelector(selector) as HTMLInputElement | null;
  if (casilla === null) {
    throw new Error(`No existe la casilla ${selector}`);
  }
  casilla.checked = true;
  casilla.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}
