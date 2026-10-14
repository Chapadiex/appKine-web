import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ConveniosDeLaSedePage } from './convenios-de-la-sede-page';
import { PERMISO_CONVENIO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import {
  RUTA_FINANCIADORES,
  RUTA_PERMISOS_EFECTIVOS,
  rutaConvenios,
  rutaPlanes,
} from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const SEDE = 3;
const CONVENIOS = rutaConvenios(SEDE);

const OSDE = { id: 10, codigo: '410', nombre: 'OSDE', tipo: 'PREPAGA', estado: 'ACTIVO' };
const SWISS = { id: 11, codigo: 'SM', nombre: 'Swiss Medical', tipo: 'PREPAGA', estado: 'ACTIVO' };

const PLAN_210 = {
  id: 100,
  financiadorId: 10,
  codigo: '210',
  nombre: 'Plan 210',
  estado: 'ACTIVO',
};

const VIGENTE = {
  id: 7,
  consultorioId: SEDE,
  financiadorId: 10,
  planId: 100,
  codigo: 'CONV-OSDE-210',
  nombre: 'OSDE 210 kinesiologia',
  modalidad: 'POR_PRESTACION',
  moneda: 'ARS',
  vigenciaDesde: '2026-01-01',
  requiereOrden: true,
  requiereAutorizacion: false,
  requiereCredencial: true,
  limiteSesionesMensual: 12,
  estado: 'ACTIVO',
  vigente: true,
  version: 2,
};

/** ACTIVO con la vigencia terminada: el caso borde "convenio vencido" del registro de cierre. */
const VENCIDO = {
  ...VIGENTE,
  id: 8,
  financiadorId: 11,
  planId: 101,
  codigo: 'CONV-SM-VIEJO',
  nombre: 'Swiss Medical 2025',
  vigenciaDesde: '2025-01-01',
  vigenciaHasta: '2025-12-31',
  vigente: false,
  version: 1,
};

/**
 * Spec de los convenios de la sede (M16, AKINE-03.05).
 *
 * <p>Los casos elegidos comparten la propiedad de siempre: <b>cuando estan mal, el sintoma no es
 * un error</b>.
 *
 * <ol>
 *   <li>Cambiar de financiador tiene que <b>limpiar el plan elegido</b>. Si no lo hace, el
 *       `select` se repuebla y queda seleccionado un plan del financiador anterior: el formulario
 *       se ve bien y el backend recibe una combinacion invalida.</li>
 *   <li>El `409 convenio-solapado` tiene que <b>ensenar la operacion correcta</b> —cerrar la
 *       vigencia del que ya esta— y NO ofrecer "recargar", que no arregla nada. Sin eso el
 *       usuario da de baja el convenio anterior, que es terminal.</li>
 *   <li>Un convenio vencido tiene que verse distinto de uno dado de baja: la salida de uno es
 *       editarlo y la del otro no existe.</li>
 *   <li>La edicion no manda ni codigo, ni financiador, ni plan, ni moneda.</li>
 * </ol>
 */
describe('ConveniosDeLaSedePage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConveniosDeLaSedePage],
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

  it('distingue un convenio vigente de uno vencido, y explica que renovar no es dar de baja', async () => {
    const fixture = await montar();
    const filas = (fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr');
    expect(filas.length).toBe(2);

    expect((filas[0] as HTMLElement).textContent).toContain('Activo y vigente');

    const vencido = filas[1] as HTMLElement;
    expect(vencido.textContent).toContain('Activo, vigencia terminada');
    expect(vencido.className).toContain('fila--atenuada');
    expect(vencido.className).not.toContain('fila--revocada');

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Renovar es cerrar la vigencia, no dar de baja',
    );
  });

  it('elegir el financiador pide SUS planes, y cambiarlo limpia el plan ya elegido', async () => {
    const fixture = await montar();

    abrir(fixture, 'Firmar un convenio');

    elegir(fixture, '#alta-convenio-financiador', '10');
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'GET' && peticion.url === rutaPlanes(10),
      )
      .flush([PLAN_210]);
    await fixture.whenStable();
    fixture.detectChanges();

    elegir(fixture, '#alta-convenio-plan', '100');
    expect(valorDe(fixture, '#alta-convenio-plan')).toBe('100');

    // Cambiar de financiador tiene que resetear el plan. Sin esto queda seleccionado un plan del
    // financiador anterior sobre un `select` repoblado: el formulario se ve bien y el backend
    // recibe una combinacion que rechaza con un 400 que nadie sabe interpretar.
    elegir(fixture, '#alta-convenio-financiador', '11');
    expect(valorDe(fixture, '#alta-convenio-plan')).toBe('');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'GET' && peticion.url === rutaPlanes(11),
      )
      .flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    // Y lo dice: sin plan activo no se puede firmar, y la salida es cargarlo en la ficha.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('no tiene planes activos');
  });

  it('el alta manda el plan y la moneda en mayusculas', async () => {
    const fixture = await montar();

    abrir(fixture, 'Firmar un convenio');
    elegir(fixture, '#alta-convenio-financiador', '10');
    httpMock.expectOne(rutaPlanesConEstado(10)).flush([PLAN_210]);
    await fixture.whenStable();
    fixture.detectChanges();

    elegir(fixture, '#alta-convenio-plan', '100');
    escribir(fixture, '#alta-convenio-codigo', 'CONV-OSDE-210');
    escribir(fixture, '#alta-convenio-nombre', 'OSDE 210 kinesiologia');
    elegir(fixture, '#alta-convenio-modalidad', 'POR_PRESTACION');
    escribir(fixture, '#alta-convenio-moneda', 'ars');
    escribir(fixture, '#alta-convenio-desde', '2026-01-01');
    enviar(fixture, 'form[novalidate]');

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === CONVENIOS,
    );
    const cuerpo = alta.request.body as Record<string, unknown>;
    expect(cuerpo['financiadorId']).toBe(10);
    // El plan es obligatorio: es lo que hace que no pueda haber dos convenios candidatos para la
    // misma consulta, y por eso el arancel resuelto es unico sin ninguna regla de desempate.
    expect(cuerpo['planId']).toBe(100);
    expect(cuerpo['moneda']).toBe('ARS');
    expect(cuerpo['vigenciaDesde']).toBe('2026-01-01');

    alta.flush({ ...VIGENTE, id: 9 });
    httpMock.expectOne(esListado()).flush([VIGENTE, VENCIDO]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Todavia no resuelve ningun precio',
    );
  });

  it('el 409 de solapamiento manda a cerrar la vigencia y NO ofrece recargar', async () => {
    const fixture = await montar();

    abrir(fixture, 'Firmar un convenio');
    elegir(fixture, '#alta-convenio-financiador', '10');
    httpMock.expectOne(rutaPlanesConEstado(10)).flush([PLAN_210]);
    await fixture.whenStable();
    fixture.detectChanges();

    elegir(fixture, '#alta-convenio-plan', '100');
    escribir(fixture, '#alta-convenio-codigo', 'CONV-OSDE-210');
    escribir(fixture, '#alta-convenio-nombre', 'OSDE 210 kinesiologia');
    elegir(fixture, '#alta-convenio-modalidad', 'POR_PRESTACION');
    escribir(fixture, '#alta-convenio-moneda', 'ARS');
    escribir(fixture, '#alta-convenio-desde', '2026-01-01');
    enviar(fixture, 'form[novalidate]');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'POST' && peticion.url === CONVENIOS,
      )
      .flush(
        { type: 'https://akine.app/problems/convenio-solapado', detail: 'choca con el id 7' },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('cerra la vigencia del que ya esta');
    // Recargar no arregla un solapamiento: el periodo que choca sigue estando ahi. Ofrecer el
    // boton mandaria al usuario a apretar algo que no cambia nada.
    expect(
      [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].some(
        (boton) => (boton.textContent ?? '').trim() === 'Recargar el listado',
      ),
    ).toBe(false);
  });

  it('la edicion no manda codigo, financiador, plan ni moneda: son la identidad del convenio', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-convenio-hasta', '2026-12-31');
    enviar(fixture, 'tr.fila-panel form');

    const edicion = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PUT' && peticion.url === `${CONVENIOS}/7`,
    );
    // Cerrar la vigencia ES esta operacion, y el convenio queda ACTIVO.
    expect(edicion.request.body).toEqual({ expectedVersion: 2, vigenciaHasta: '2026-12-31' });

    edicion.flush({ ...VIGENTE, vigenciaHasta: '2026-12-31', version: 3 });
    httpMock.expectOne(esListado()).flush([VIGENTE, VENCIDO]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'cerrar la vigencia no es darlo de baja',
    );
  });

  it('el alta manda los opcionales que estan cargados', async () => {
    const fixture = await montar();

    abrir(fixture, 'Firmar un convenio');
    elegir(fixture, '#alta-convenio-financiador', '10');
    httpMock.expectOne(rutaPlanesConEstado(10)).flush([PLAN_210]);
    await fixture.whenStable();
    fixture.detectChanges();

    elegir(fixture, '#alta-convenio-plan', '100');
    escribir(fixture, '#alta-convenio-codigo', 'CONV-OSDE-210');
    escribir(fixture, '#alta-convenio-nombre', 'OSDE 210 kinesiologia');
    elegir(fixture, '#alta-convenio-modalidad', 'POR_SESION');
    escribir(fixture, '#alta-convenio-moneda', 'ARS');
    escribir(fixture, '#alta-convenio-desde', '2026-01-01');
    escribir(fixture, '#alta-convenio-hasta', '2026-12-31');
    escribir(fixture, '#alta-convenio-tope', '12');
    escribir(fixture, '#alta-convenio-documentacion', 'Fotocopia del DNI');
    escribir(fixture, '#alta-convenio-observaciones', 'Renovacion anual');
    marcar(fixture, '#alta-convenio-orden');
    marcar(fixture, '#alta-convenio-credencial');
    enviar(fixture, 'form[novalidate]');

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === CONVENIOS,
    );
    expect(alta.request.body).toEqual({
      codigo: 'CONV-OSDE-210',
      nombre: 'OSDE 210 kinesiologia',
      financiadorId: 10,
      planId: 100,
      modalidad: 'POR_SESION',
      moneda: 'ARS',
      vigenciaDesde: '2026-01-01',
      vigenciaHasta: '2026-12-31',
      limiteSesionesMensual: 12,
      documentacionRequerida: 'Fotocopia del DNI',
      observaciones: 'Renovacion anual',
      requiereOrden: true,
      requiereAutorizacion: false,
      requiereCredencial: true,
    });

    alta.flush({ ...VIGENTE, id: 9 });
    httpMock.expectOne(esListado()).flush([VIGENTE, VENCIDO]);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('el alta sin financiador ni plan no manda nada', async () => {
    const fixture = await montar();

    abrir(fixture, 'Firmar un convenio');
    enviar(fixture, 'form[novalidate]');

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Eligi con que financiador se firma');
    expect(texto).toContain('El plan es obligatorio');
    expect(texto).toContain('Eligi como se liquida');
    expect(texto).toContain('La moneda es obligatoria');
  });

  it('la edicion manda todo lo que cambio', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-convenio-nombre', 'OSDE 210 rehabilitacion');
    elegir(fixture, '#editar-convenio-modalidad', 'MODULO');
    escribir(fixture, '#editar-convenio-desde', '2026-02-01');
    escribir(fixture, '#editar-convenio-tope', '20');
    escribir(fixture, '#editar-convenio-documentacion', 'Credencial vigente');
    escribir(fixture, '#editar-convenio-observaciones', 'Revisado en febrero');
    marcar(fixture, '#editar-convenio-autorizacion');
    enviar(fixture, 'tr.fila-panel form');

    const edicion = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PUT' && peticion.url === `${CONVENIOS}/7`,
    );
    expect(edicion.request.body).toEqual({
      expectedVersion: 2,
      nombre: 'OSDE 210 rehabilitacion',
      modalidad: 'MODULO',
      vigenciaDesde: '2026-02-01',
      limiteSesionesMensual: 20,
      documentacionRequerida: 'Credencial vigente',
      observaciones: 'Revisado en febrero',
      requiereAutorizacion: true,
    });

    edicion.flush({ ...VIGENTE, version: 3 });
    httpMock.expectOne(esListado()).flush([VIGENTE, VENCIDO]);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('la baja avisa que no cascadea a los aranceles y que libera el periodo', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de baja');
    const panel = (fixture.nativeElement as HTMLElement).querySelector('tr.fila-panel');
    expect(panel?.textContent).toContain('la operacion NO es esta');
    expect(panel?.textContent).toContain('No cascadea a los aranceles');

    escribir(fixture, '#baja-convenio-motivo', 'Se rescindio el contrato');
    const confirmar = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('tr.fila-panel button'),
    ].find((boton) => (boton.textContent ?? '').trim() === 'Dar de baja');
    (confirmar as HTMLButtonElement).click();
    fixture.detectChanges();

    const baja = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'DELETE' && peticion.url === `${CONVENIOS}/7`,
    );
    expect(baja.request.body).toEqual({ reason: 'Se rescindio el contrato' });

    baja.flush(null, { status: 204, statusText: 'No Content' });
    httpMock.expectOne(esListado()).flush([VENCIDO]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'El codigo y el periodo quedan libres',
    );
  });

  it('el 409 conflict relee y deja el panel abierto', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-convenio-nombre', 'OSDE 210 rehabilitacion');
    enviar(fixture, 'tr.fila-panel form');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'PUT' && peticion.url === `${CONVENIOS}/7`,
      )
      .flush(
        {
          type: 'https://akine.app/problems/concurrent-modification',
          detail: 'la version quedo vieja',
        },
        { status: 409, statusText: 'Conflict' },
      );
    fixture.detectChanges();

    httpMock.expectOne(esListado()).flush([{ ...VIGENTE, version: 9 }, VENCIDO]);
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('no guardamos tus cambios para no pisar los suyos');
    expect(anfitrion.querySelector<HTMLInputElement>('#editar-convenio-nombre')?.value).toBe(
      'OSDE 210 rehabilitacion',
    );
  });

  it('el filtro y la fecha recargan, y el vacio manda al catalogo de financiadores', async () => {
    const fixture = await montar();

    cambiarSelect(fixture, '#filtro-estado-convenio', 'TODOS');
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.url === CONVENIOS && peticion.params.get('estado') === 'TODOS',
      )
      .flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('todo lo que se atienda en esta sede se cobra como');
    expect(anfitrion.querySelector('a[href="/contratacion/financiadores"]')).not.toBeNull();

    cambiarSelect(fixture, '#filtro-fecha-convenio', '2025-06-15');
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.url === CONVENIOS && peticion.params.get('fecha') === '2025-06-15',
      )
      .flush([{ ...VENCIDO, vigente: true }]);
    await fixture.whenStable();
    fixture.detectChanges();

    // El convenio que hoy esta vencido, en junio de 2025 si resolvia. Eso es lo que explica por
    // que una prestacion de entonces se cobro lo que se cobro.
    expect(anfitrion.textContent).toContain('Activo y vigente');
  });

  it('sin permiso el listado se ve pero no aparece ninguna accion', async () => {
    // Las lecturas se autorizan por pertenencia y no existe `convenio:read`: esconder la pantalla
    // entera dejaria a recepcion sin poder consultar cuanto cobrar.
    const fixture = await montar([]);
    const anfitrion = fixture.nativeElement as HTMLElement;

    expect(anfitrion.textContent).toContain('OSDE 210 kinesiologia');
    expect(
      [...anfitrion.querySelectorAll('button')].map((boton) => (boton.textContent ?? '').trim()),
    ).toEqual([]);
    // El enlace a los aranceles no lleva permiso: es otra lectura.
    expect(anfitrion.querySelector('a[href="/contratacion/convenios/7/aranceles"]')).not.toBeNull();
  });

  it('sin sede elegida no consulta convenios y manda a elegirla, no al login', async () => {
    tenantContext.select({ organizationId: 1, organizationName: 'Centro Belgrano' });
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(ConveniosDeLaSedePage);
    fixture.detectChanges();

    // Ni una peticion de convenios: la ruta empieza en el consultorio y no se puede ni armar.
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.url.includes('/convenios'));
    httpMock
      .match((peticion: HttpRequest<unknown>) => peticion.url === RUTA_FINANCIADORES)
      .forEach((peticion) => peticion.flush([OSDE]));
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

  async function montar(
    concedidos: readonly string[] = [PERMISO_CONVENIO_MANAGE],
  ): Promise<ComponentFixture<ConveniosDeLaSedePage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: concedidos });

    const fixture = TestBed.createComponent(ConveniosDeLaSedePage);
    fixture.detectChanges();

    httpMock.expectOne(esListado()).flush([VIGENTE, VENCIDO]);
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === RUTA_FINANCIADORES)
      .flush([OSDE, SWISS]);
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  function esListado() {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'GET' && peticion.url === CONVENIOS;
  }

  function rutaPlanesConEstado(financiadorId: number) {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'GET' && peticion.url === rutaPlanes(financiadorId);
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

function valorDe(fixture: { nativeElement: HTMLElement }, selector: string): string {
  return fixture.nativeElement.querySelector<HTMLSelectElement>(selector)?.value ?? '';
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
  if (formulario === null) {
    throw new Error(`No existe el formulario ${selector}`);
  }
  formulario.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}

/** Marca una casilla de un formulario reactivo. */
function marcar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string) {
  const casilla = fixture.nativeElement.querySelector<HTMLInputElement>(selector);
  if (casilla === null) {
    throw new Error(`No existe la casilla ${selector}`);
  }
  casilla.checked = true;
  casilla.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

/** Un control de filtro, que vive fuera de todo formulario reactivo y escucha `change`. */
function cambiarSelect(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: string,
) {
  const campo = fixture.nativeElement.querySelector<HTMLSelectElement | HTMLInputElement>(selector);
  if (campo === null) {
    throw new Error(`No existe el control ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}
