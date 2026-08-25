import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CatalogosPage } from './catalogos-page';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

/** Concepto de la plataforma: se ve, no se toca. Es la mitad conflictiva de ADR-0021. */
const GLOBAL = {
  id: 1,
  tipo: 'ESPECIALIDAD',
  alcance: 'GLOBAL',
  codigo: 'KINE',
  name: 'Kinesiologia',
  estado: 'ACTIVO',
  vigente: true,
  version: 1,
};

/** Concepto del centro: el unico que esta pantalla administra. */
const PROPIA = {
  id: 2,
  organizationId: 1,
  tipo: 'ESPECIALIDAD',
  alcance: 'ORGANIZACION',
  codigo: 'PIL',
  name: 'Pilates terapeutico',
  descripcion: 'Solo en la sede centro',
  estado: 'ACTIVO',
  vigente: true,
  version: 3,
};

const PAGINA = {
  content: [GLOBAL, PROPIA],
  page: 0,
  size: 20,
  totalElements: 2,
  totalPages: 1,
};

const LISTADO = '/api/v1/catalogos/especialidades';

/**
 * Spec del catalogo clinico (M06, AKINE-02.05).
 *
 * <p>Cubre lo que, si se rompe, <b>no da ningun error visible</b>:
 *
 * <ol>
 *   <li>Que un concepto de la plataforma no ofrezca acciones que el backend rechaza con
 *       `403`, y que diga cual es la salida. Sin eso el usuario aprieta "Editar", recibe un
 *       error y no tiene forma de enterarse de que existe la solicitud.</li>
 *   <li>Que la busqueda sea incremental y con debounce: sin el, cada tecla es una peticion
 *       contra un catalogo de miles de filas y nadie lo nota en desarrollo.</li>
 *   <li>La semantica del `PATCH`: omitido no se toca, `descripcion: ''` borra. Un formulario
 *       que mande siempre todo borra datos que nadie pidio borrar, y responde `200`.</li>
 * </ol>
 */
describe('CatalogosPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CatalogosPage],
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
    vi.useRealTimers();
    httpMock.verify();
  });

  it('un concepto de la plataforma no ofrece acciones y dice cual es la salida', async () => {
    const fixture = await montar();
    const filas = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(filas.length).toBe(2);

    const filaGlobal = filas[0] as HTMLElement;
    const filaPropia = filas[1] as HTMLElement;

    // La fila global no trae NINGUN boton: el backend responde 403 y ofrecerlo seria ofrecer
    // un error. Lo que si trae es el camino que si existe.
    expect(filaGlobal.querySelectorAll('button').length).toBe(0);
    expect(filaGlobal.textContent).toContain('La mantiene AKINE');
    expect(filaGlobal.querySelector('a[href="/catalogo/solicitudes"]')).not.toBeNull();

    // La del centro si: es la unica poblacion que esta pantalla administra.
    const acciones = [...filaPropia.querySelectorAll('button')].map((boton) =>
      (boton.textContent ?? '').trim(),
    );
    expect(acciones).toEqual(['Editar', 'Dar de baja']);

    // Y la distincion se nombra en la fila, no solo en la nota de arriba.
    expect(filaGlobal.textContent).toContain('De la plataforma');
    expect(filaPropia.textContent).toContain('De este centro');
  });

  it('la busqueda es incremental y con debounce: tres teclas, una sola peticion', async () => {
    const fixture = await montar();
    vi.useFakeTimers();

    const anfitrion = fixture.nativeElement as HTMLElement;
    const campo = anfitrion.querySelector<HTMLInputElement>('#busqueda-catalogo');
    if (campo === null) {
      throw new Error('No existe el campo de busqueda');
    }

    for (const texto of ['p', 'pi', 'pil']) {
      campo.value = texto;
      campo.dispatchEvent(new Event('input'));
    }

    // Antes de que venza el debounce no salio nada: una peticion por tecla contra un catalogo
    // de miles de filas es justamente lo que el debounce existe para evitar.
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.url === LISTADO);

    vi.advanceTimersByTime(300);
    fixture.detectChanges();

    // Y la que sale lleva el ultimo texto, no el primero.
    const busqueda = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.url === LISTADO && peticion.params.has('q'),
    );
    expect(busqueda.request.params.get('q')).toBe('pil');
    // Vuelve a la primera pagina: la 3 de la busqueda anterior puede no existir en la nueva.
    expect(busqueda.request.params.get('page')).toBe('0');
    busqueda.flush({ ...PAGINA, content: [PROPIA], totalElements: 1 });
  });

  it('el PATCH manda solo lo que cambio: la descripcion vaciada y nada mas', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-catalogo-descripcion', '');
    enviar(fixture, 'form[novalidate]');

    const patch = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PATCH' && peticion.url === `${LISTADO}/2`,
    );

    // `descripcion: ''` es la forma que el contrato define para BORRAR: se manda, no se omite.
    // El nombre no se toco, asi que NO viaja: mandarlo igual pisaria lo que otro hubiera
    // cambiado entre medio, sin que nadie pida nada.
    expect(patch.request.body).toEqual({ version: 3, descripcion: '' });

    patch.flush({ ...PROPIA, descripcion: undefined, version: 4 });
    httpMock.expectOne(esListado()).flush(PAGINA);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('quedaron guardados');
  });

  it('el alta crea siempre un concepto de este centro y omite lo que quedo vacio', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    abrir(fixture, 'Dar de alta una especialidad de este centro');

    // Primero sin completar nada: el formulario no manda nada y marca los obligatorios.
    enviar(fixture, 'form[novalidate]');
    httpMock.expectNone(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === LISTADO,
    );
    expect(anfitrion.textContent).toContain('El codigo es obligatorio');

    escribir(fixture, '#alta-catalogo-codigo', 'RPG');
    escribir(fixture, '#alta-catalogo-name', 'Reeducacion postural');
    enviar(fixture, 'form[novalidate]');

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === LISTADO,
    );
    // `alcance: ORGANIZACION` va fijo: crear uno global exige rol de plataforma y el frontend
    // no tiene forma de saber si quien mira lo tiene. La descripcion vacia no viaja.
    expect(alta.request.body).toEqual({
      codigo: 'RPG',
      name: 'Reeducacion postural',
      alcance: 'ORGANIZACION',
    });

    alta.flush({ ...PROPIA, id: 3, codigo: 'RPG', name: 'Reeducacion postural' });
    httpMock.expectOne(esListado()).flush(PAGINA);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('Solo la ve tu organizacion');
  });

  it('los dos filtros recargan con su parametro y vuelven a la primera pagina', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    elegir(fixture, '#filtro-estado-catalogo', 'INACTIVO');
    const porEstado = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.url === LISTADO && peticion.params.get('estado') === 'INACTIVO',
    );
    expect(porEstado.request.params.get('page')).toBe('0');
    porEstado.flush({ ...PAGINA, content: [], totalElements: 0, totalPages: 0 });
    await fixture.whenStable();
    fixture.detectChanges();

    // Una lista vacia no es un error: se responde la pregunta que se hizo.
    expect(anfitrion.textContent).toContain('No hay especialidades que coincidan');

    elegir(fixture, '#filtro-alcance-catalogo', 'ORGANIZACION');
    const porAlcance = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.url === LISTADO && peticion.params.get('alcance') === 'ORGANIZACION',
    );
    porAlcance.flush({ ...PAGINA, content: [PROPIA], totalElements: 1 });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('Pilates terapeutico');
  });

  it('la baja manda el motivo y explica que el codigo queda libre', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    abrir(fixture, 'Dar de baja');
    escribir(fixture, '#baja-catalogo-motivo', 'Ya no se ofrece');

    const confirmar = [...anfitrion.querySelectorAll('button')].find(
      (boton) => (boton.textContent ?? '').trim() === 'Dar de baja' && boton.type === 'submit',
    );
    confirmar?.click();
    fixture.detectChanges();

    const baja = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'POST' && peticion.url === `${LISTADO}/2/deactivate`,
    );
    expect(baja.request.body).toEqual({ reason: 'Ya no se ofrece' });
    baja.flush({ ...PROPIA, estado: 'INACTIVO' });
    httpMock.expectOne(esListado()).flush(PAGINA);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('conserva su significado');
  });

  it('un tipo que no existe no le pide nada al backend y ofrece los tres que si', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    const fixture = TestBed.createComponent(CatalogosPage);
    fixture.componentRef.setInput('tipo', 'inventado');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Ni una peticion de catalogo: mandarle al backend un slug inventado solo agrega un 404.
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.url.includes('/catalogos/'));
    httpMock
      .match(RUTA_PERMISOS_EFECTIVOS)
      .forEach((peticion) => peticion.flush({ permissions: [] }));

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('Ese catalogo no existe');
    expect(anfitrion.querySelector('a[href="/catalogo/especialidades"]')).not.toBeNull();
    expect(anfitrion.querySelector('a[href="/catalogo/nomencladores"]')).not.toBeNull();
  });

  it('sin consultorio elegido no consulta nada y manda a elegirlo, no al login', async () => {
    // Contexto con organizacion pero SIN sede: el backend arma la lista de duenos visibles con
    // el contexto completo, asi que la peticion seria invalida.
    tenantContext.select({ organizationId: 1, organizationName: 'Centro Belgrano' });

    const fixture = TestBed.createComponent(CatalogosPage);
    fixture.componentRef.setInput('tipo', 'especialidades');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    httpMock
      .match(RUTA_PERMISOS_EFECTIVOS)
      .forEach((peticion) => peticion.flush({ permissions: [] }));

    const anfitrion = fixture.nativeElement as HTMLElement;
    // Con organizacion elegida la peticion SI se puede armar: el catalogo es de la
    // organizacion, no de la sede. Lo que no puede pasar es que se cierre la sesion.
    httpMock.match(esListado()).forEach((peticion) => peticion.flush(PAGINA));
    expect(anfitrion.textContent).not.toContain('Sesion expirada');
  });

  it('el conflicto de concurrencia no pisa nada: relee y deja el panel abierto', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-catalogo-name', 'Pilates clinico');
    enviar(fixture, 'form[novalidate]');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'PATCH' && peticion.url === `${LISTADO}/2`,
      )
      .flush(
        { type: 'https://akine.app/problems/concurrent-modification', detail: 'quedo vieja' },
        { status: 409, statusText: 'Conflict' },
      );
    fixture.detectChanges();

    // Se relee el concepto para tomar la version nueva como base, y NO se reintenta solo:
    // reintentar en silencio seria pisar el cambio del otro, que es lo que el 409 evita.
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'GET' && peticion.url === `${LISTADO}/2`,
      )
      .flush({ ...PROPIA, version: 9 });
    httpMock.expectOne(esListado()).flush(PAGINA);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('no guardamos tus cambios para no pisar los suyos');
    // El panel sigue abierto con lo que el usuario habia escrito.
    expect(anfitrion.querySelector<HTMLInputElement>('#editar-catalogo-name')?.value).toBe(
      'Pilates clinico',
    );
  });

  it('en practicas se ofrece la especialidad, y filtrarla viaja como especialidadId', async () => {
    const fixture = await montarPracticas();
    const anfitrion = fixture.nativeElement as HTMLElement;

    // El selector se poblo con las especialidades activas -de la plataforma y del centro-.
    const opciones = [...anfitrion.querySelectorAll('#filtro-especialidad-catalogo option')].map(
      (opcion) => (opcion.textContent ?? '').trim(),
    );
    expect(opciones).toContain('Kinesiologia');

    elegir(fixture, '#filtro-especialidad-catalogo', '1');
    const filtrada = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.url === '/api/v1/catalogos/practicas' &&
        peticion.params.get('especialidadId') === '1',
    );
    filtrada.flush({ ...PAGINA, content: [] });
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('un concepto dado de baja no ofrece acciones y muestra su motivo', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({
      permissions: [PERMISO_CONSULTORIO_MANAGE],
    });

    const fixture = TestBed.createComponent(CatalogosPage);
    fixture.componentRef.setInput('tipo', 'especialidades');
    fixture.detectChanges();

    const inactiva = {
      ...PROPIA,
      estado: 'INACTIVO',
      vigente: false,
      deactivationReason: 'Ya no se ofrece',
    };
    httpMock.expectOne(esListado()).flush({ ...PAGINA, content: [inactiva], totalElements: 1 });
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    // La fila sigue en el listado -lo que se registro con ella la referencia- pero no se edita.
    expect(anfitrion.textContent).toContain('Dado de baja');
    expect(anfitrion.textContent).toContain('Ya no se ofrece');
    expect(anfitrion.querySelectorAll('tbody button').length).toBe(0);
  });

  it('sin permiso de gestion la tabla se lee entera y no aparece ninguna accion', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
    permisos.cargar().subscribe();
    // Un profesional: puede consultar el catalogo -lo necesita para registrar una sesion- y no
    // administrarlo. Eso es UX; la autoridad sigue siendo el backend.
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(CatalogosPage);
    fixture.componentRef.setInput('tipo', 'especialidades');
    fixture.detectChanges();

    httpMock.expectOne(esListado()).flush(PAGINA);
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.querySelectorAll('tbody tr').length).toBe(2);
    expect(anfitrion.textContent).toContain('Pilates terapeutico');
    expect(anfitrion.querySelectorAll('tbody button').length).toBe(0);
    expect(anfitrion.textContent).not.toContain('Dar de alta una especialidad');
  });

  it('la casilla es la unica forma de sacar el fin de vigencia, y el resto no se toca', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-catalogo-desde', '2027-03-01T08:00');
    marcar(fixture, '#editar-catalogo-sin-fin');
    enviar(fixture, 'form[novalidate]');

    const patch = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PATCH' && peticion.url === `${LISTADO}/2`,
    );
    const cuerpo = patch.request.body as Record<string, unknown>;

    // `clearValidUntil` viaja solo cuando la casilla esta marcada: dejar el campo vacio
    // significa "no lo toques", que es otra intencion.
    expect(cuerpo['clearValidUntil']).toBe(true);
    expect(cuerpo['validUntil']).toBeUndefined();
    expect(cuerpo['validFrom']).toBeTypeOf('string');
    // El nombre y la descripcion no se tocaron: no viajan.
    expect(cuerpo['name']).toBeUndefined();
    expect(cuerpo['descripcion']).toBeUndefined();

    patch.flush({ ...PROPIA, version: 4 });
    httpMock.expectOne(esListado()).flush(PAGINA);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('el alta de una practica manda especialidad, descripcion y ventana cuando se cargan', async () => {
    const fixture = await montarPracticas();
    const anfitrion = fixture.nativeElement as HTMLElement;

    abrir(fixture, 'Dar de alta una practica de este centro');

    escribir(fixture, '#alta-catalogo-codigo', 'DRE');
    escribir(fixture, '#alta-catalogo-name', 'Drenaje linfatico');
    escribir(fixture, '#alta-catalogo-descripcion', 'Post quirurgico');
    escribir(fixture, '#alta-catalogo-desde', '2026-09-01T08:00');
    escribir(fixture, '#alta-catalogo-hasta', '2027-09-01T08:00');
    elegir(fixture, '#alta-catalogo-especialidad', '1');
    enviar(fixture, 'form[novalidate]');

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'POST' && peticion.url === '/api/v1/catalogos/practicas',
    );
    const cuerpo = alta.request.body as Record<string, unknown>;
    expect(cuerpo['especialidadId']).toBe(1);
    expect(cuerpo['descripcion']).toBe('Post quirurgico');
    expect(cuerpo['validFrom']).toBeTypeOf('string');
    expect(cuerpo['validUntil']).toBeTypeOf('string');

    alta.flush({ ...PROPIA, id: 12, tipo: 'PRACTICA' });
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'GET' && peticion.url === '/api/v1/catalogos/practicas',
      )
      .flush({ ...PAGINA, content: [] });
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.url === LISTADO && peticion.params.get('size') === '100',
      )
      .flush(PAGINA);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('quedo dada de alta para este centro');
  });

  it('el alta de una practica sin especialidad no manda nada y lo dice en el campo', async () => {
    const fixture = await montarPracticas();
    const anfitrion = fixture.nativeElement as HTMLElement;

    abrir(fixture, 'Dar de alta una practica de este centro');
    escribir(fixture, '#alta-catalogo-codigo', 'DRE');
    escribir(fixture, '#alta-catalogo-name', 'Drenaje linfatico');
    enviar(fixture, 'form[novalidate]');

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect(anfitrion.textContent).toContain('Una practica siempre cuelga de una especialidad');
  });

  it(
    'la pantalla no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  async function montar(): Promise<ComponentFixture<CatalogosPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({
      permissions: [PERMISO_CONSULTORIO_MANAGE],
    });

    const fixture = TestBed.createComponent(CatalogosPage);
    fixture.componentRef.setInput('tipo', 'especialidades');
    fixture.detectChanges();

    httpMock.expectOne(esListado()).flush(PAGINA);
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  /** Monta la pantalla de practicas, que es la unica que pide especialidades ademas. */
  async function montarPracticas(): Promise<ComponentFixture<CatalogosPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({
      permissions: [PERMISO_CONSULTORIO_MANAGE],
    });

    const fixture = TestBed.createComponent(CatalogosPage);
    fixture.componentRef.setInput('tipo', 'practicas');
    fixture.detectChanges();

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.url === '/api/v1/catalogos/practicas' && !peticion.params.has('especialidadId'),
      )
      .flush({ ...PAGINA, content: [] });
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.url === LISTADO && peticion.params.get('size') === '100',
      )
      .flush(PAGINA);

    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  function esListado() {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'GET' && peticion.url === LISTADO && !peticion.params.has('q');
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

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
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
