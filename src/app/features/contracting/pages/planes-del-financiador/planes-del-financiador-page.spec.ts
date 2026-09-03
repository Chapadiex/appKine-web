import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { convertToParamMap } from '@angular/router';

import { PERMISO_CONVENIO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { PlanesDelFinanciadorPage } from './planes-del-financiador-page';
import {
  RUTA_FINANCIADORES,
  RUTA_PERMISOS_EFECTIVOS,
  rutaPlanes,
} from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const FINANCIADOR = 10;
const PLANES = rutaPlanes(FINANCIADOR);

const OSDE = {
  id: FINANCIADOR,
  codigo: '410',
  nombre: 'OSDE',
  tipo: 'PREPAGA',
  estado: 'ACTIVO',
  version: 1,
};

/** Activo y vigente hoy: se puede elegir. */
const VIGENTE = {
  id: 100,
  financiadorId: FINANCIADOR,
  codigo: '210',
  nombre: 'Plan 210',
  vigenciaDesde: '2026-01-01',
  copago: 1500,
  moneda: 'ARS',
  requiereAutorizacion: true,
  requiereCredencial: false,
  estado: 'ACTIVO',
  vigente: true,
  version: 3,
};

/**
 * ACTIVO con la vigencia <b>cerrada</b>. Es el caso borde de la etapa —"plan sin nuevas altas
 * pero con pacientes vigentes"— y es un estado correcto, no un dato mal cargado.
 *
 * <p>Ademas no tiene copago: `null` es "sin copago declarado", que NO es cero.
 */
const VIGENCIA_CERRADA = {
  id: 101,
  financiadorId: FINANCIADOR,
  codigo: '310',
  nombre: 'Plan 310',
  vigenciaDesde: '2020-01-01',
  vigenciaHasta: '2026-08-31',
  requiereAutorizacion: false,
  requiereCredencial: false,
  estado: 'ACTIVO',
  vigente: false,
  version: 1,
};

/**
 * Spec de los planes de cobertura (M15, AKINE-03.03).
 *
 * <p>Los casos elegidos comparten la propiedad de siempre: <b>cuando estan mal, el sintoma no es
 * un error</b>.
 *
 * <ol>
 *   <li>Un plan con la vigencia cerrada tiene que verse distinto de uno operativo <b>y</b> de uno
 *       dado de baja. Aplanarlos deja al usuario dando de baja un plan cuando lo que queria era
 *       cerrarle la vigencia — y esa operacion no tiene vuelta atras.</li>
 *   <li>Copago sin moneda no puede salir. El backend responde `400`, pero el usuario ve un
 *       rechazo generico en vez del campo que falta.</li>
 *   <li>Un financiador dado de baja no puede ofrecer "dar de alta un plan": el `409` esta
 *       garantizado, y ofrecerlo es empujar al usuario a el.</li>
 *   <li>La edicion no manda el codigo, que es lo que las coberturas guardan.</li>
 * </ol>
 */
describe('PlanesDelFinanciadorPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanesDelFinanciadorPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ financiadorId: String(FINANCIADOR) }) },
          },
        },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    tenantContext = TestBed.inject(TenantContextStore);
    permisos = TestBed.inject(PermissionsStore);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('distingue un plan vigente de uno con la vigencia cerrada, y dice que el fin es inclusivo', async () => {
    const fixture = await montar();
    const filas = (fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr');
    expect(filas.length).toBe(2);

    expect((filas[0] as HTMLElement).textContent).toContain('Activo y vigente');

    // Los dos son ACTIVOS. Lo que los separa es la vigencia, y la fila lo dice con palabras —no
    // solo con un gris—, porque el color no puede ser el unico portador (WCAG 1.4.1).
    const cerrada = filas[1] as HTMLElement;
    expect(cerrada.textContent).toContain('Activo, vigencia terminada');
    expect(cerrada.className).toContain('fila--atenuada');
    expect(cerrada.className).not.toContain('fila--revocada');
    // La palabra que separa esta feature de `offering`, donde el fin es EXCLUSIVO.
    expect(cerrada.textContent).toContain('inclusive');

    // Y la nota de arriba explica, una sola vez, que cerrar la vigencia no es dar de baja.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Cerrar la vigencia no es dar de baja',
    );
  });

  it('copago sin declarar no se muestra como cero', async () => {
    // Son dos cosas distintas en el mostrador: "no lo sabemos" contra "el paciente no paga nada".
    const fixture = await montar();
    const filas = (fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr');
    expect((filas[1] as HTMLElement).textContent).toContain('Sin declarar');
    expect((filas[0] as HTMLElement).textContent).toContain('ARS 1500.00');
  });

  it('el alta no deja mandar copago sin moneda, y lo dice antes de la peticion', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de alta un plan');
    escribir(fixture, '#alta-plan-codigo', '450');
    escribir(fixture, '#alta-plan-nombre', 'Plan 450');
    escribir(fixture, '#alta-plan-copago', '2000');
    enviar(fixture, 'form[novalidate]');

    // Ni una peticion: el backend lo rechazaria con un 400 generico y el usuario no sabria cual
    // de los dos campos completar.
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'van juntos o no van ninguno',
    );

    escribir(fixture, '#alta-plan-moneda', 'ars');
    enviar(fixture, 'form[novalidate]');

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === PLANES,
    );
    const cuerpo = alta.request.body as Record<string, unknown>;
    expect(cuerpo['copago']).toBe(2000);
    // La moneda va en mayusculas: el backend la compara asi, y `ars` seria otra moneda.
    expect(cuerpo['moneda']).toBe('ARS');
    expect(cuerpo['codigo']).toBe('450');

    alta.flush({ ...VIGENTE, id: 102 });
    httpMock.expectOne(esListado()).flush([VIGENTE, VIGENCIA_CERRADA]);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('un financiador dado de baja no ofrece dar de alta, y explica por que', async () => {
    // El 409 financiador-inactivo esta garantizado. Ofrecer el boton seria empujar al usuario a
    // un rechazo que la pantalla ya sabia predecir.
    const fixture = await montar({ ...OSDE, estado: 'INACTIVO' });
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(texto).toContain('no admite planes nuevos');
    expect(
      [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].some(
        (boton) => (boton.textContent ?? '').trim() === 'Dar de alta un plan',
      ),
    ).toBe(false);
    // Pero sus planes se siguen editando: la baja no congela lo que ya existe.
    expect(texto).toContain('se siguen pudiendo editar');
  });

  it('la edicion manda solo lo que cambio, con la version y sin el codigo', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-plan-hasta', '2026-12-31');
    enviar(fixture, 'tr.fila-panel form');

    const edicion = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PUT' && peticion.url === `${PLANES}/100`,
    );
    // Cerrar la vigencia ES esta operacion: el plan queda ACTIVO. Si ademas viajara el codigo,
    // el backend estaria recibiendo un intento de reescribir lo que los historicos guardan.
    expect(edicion.request.body).toEqual({ expectedVersion: 3, vigenciaHasta: '2026-12-31' });

    edicion.flush({ ...VIGENTE, vigenciaHasta: '2026-12-31', version: 4 });
    httpMock.expectOne(esListado()).flush([VIGENTE, VIGENCIA_CERRADA]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'cerrar la vigencia no es darlo de baja',
    );
  });

  it('el alta manda todos los campos cuando estan completos', async () => {
    // La contracara del caso del copago: cada opcional tiene sus dos ramas —viaja o no viaja— y
    // solo se ejercitaba la de omitir.
    const fixture = await montar();

    abrir(fixture, 'Dar de alta un plan');
    escribir(fixture, '#alta-plan-codigo', '450');
    escribir(fixture, '#alta-plan-nombre', 'Plan 450');
    escribir(fixture, '#alta-plan-descripcion', 'Plan superior');
    escribir(fixture, '#alta-plan-desde', '2026-01-01');
    escribir(fixture, '#alta-plan-hasta', '2026-12-31');
    escribir(fixture, '#alta-plan-copago', '1200');
    escribir(fixture, '#alta-plan-moneda', 'ARS');
    marcar(fixture, '#alta-plan-autorizacion');
    marcar(fixture, '#alta-plan-credencial');
    enviar(fixture, 'form[novalidate]');

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === PLANES,
    );
    expect(alta.request.body).toEqual({
      codigo: '450',
      nombre: 'Plan 450',
      descripcion: 'Plan superior',
      vigenciaDesde: '2026-01-01',
      vigenciaHasta: '2026-12-31',
      copago: 1200,
      moneda: 'ARS',
      requiereAutorizacion: true,
      requiereCredencial: true,
    });

    alta.flush({ ...VIGENTE, id: 102 });
    httpMock.expectOne(esListado()).flush([VIGENTE, VIGENCIA_CERRADA]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'activo pero todavia sin vigencia',
    );
  });

  it('el alta sin los obligatorios no manda nada', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de alta un plan');
    // `vigenciaDesde` arranca en hoy, asi que lo que falta es codigo y nombre.
    enviar(fixture, 'form[novalidate]');

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('El codigo es obligatorio');
    expect(texto).toContain('El nombre es obligatorio');
  });

  it('la edicion manda todo lo que cambio, incluido el par copago y moneda', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-plan-nombre', 'Plan 210 Plus');
    escribir(fixture, '#editar-plan-descripcion', 'Con reintegros');
    escribir(fixture, '#editar-plan-desde', '2026-02-01');
    escribir(fixture, '#editar-plan-copago', '1800');
    escribir(fixture, '#editar-plan-moneda', 'ARS');
    marcar(fixture, '#editar-plan-credencial');
    enviar(fixture, 'tr.fila-panel form');

    const edicion = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PUT' && peticion.url === `${PLANES}/100`,
    );
    expect(edicion.request.body).toEqual({
      expectedVersion: 3,
      nombre: 'Plan 210 Plus',
      descripcion: 'Con reintegros',
      vigenciaDesde: '2026-02-01',
      copago: 1800,
      moneda: 'ARS',
      requiereCredencial: true,
    });

    edicion.flush({ ...VIGENTE, version: 4 });
    httpMock.expectOne(esListado()).flush([VIGENTE, VIGENCIA_CERRADA]);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('la baja del plan avisa que cerrar la vigencia era otra operacion', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de baja');
    const panel = (fixture.nativeElement as HTMLElement).querySelector('tr.fila-panel');
    // Es la advertencia que evita el error caro: dar de baja no se deshace y cerrar la vigencia si.
    expect(panel?.textContent).toContain('la operacion NO es esta');
    expect(panel?.textContent).toContain('no hay reactivacion');

    escribir(fixture, '#baja-plan-motivo', 'El financiador lo discontinuo');
    const confirmar = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('tr.fila-panel button'),
    ].find((boton) => (boton.textContent ?? '').trim() === 'Dar de baja');
    (confirmar as HTMLButtonElement).click();
    fixture.detectChanges();

    const baja = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'DELETE' && peticion.url === `${PLANES}/100`,
    );
    expect(baja.request.body).toEqual({ reason: 'El financiador lo discontinuo' });

    baja.flush(null, { status: 204, statusText: 'No Content' });
    httpMock.expectOne(esListado()).flush([VIGENCIA_CERRADA]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'siguen resolviendo con su copia congelada',
    );
  });

  it('el 409 conflict relee y deja el panel abierto con lo escrito', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-plan-nombre', 'Plan 210 Plus');
    enviar(fixture, 'tr.fila-panel form');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'PUT' && peticion.url === `${PLANES}/100`,
      )
      .flush(
        { type: 'https://akine.app/problems/conflict', detail: 'la version quedo vieja' },
        { status: 409, statusText: 'Conflict' },
      );
    fixture.detectChanges();

    httpMock.expectOne(esListado()).flush([{ ...VIGENTE, version: 9 }, VIGENCIA_CERRADA]);
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('no guardamos tus cambios para no pisar los suyos');
    expect(anfitrion.querySelector<HTMLInputElement>('#editar-plan-nombre')?.value).toBe(
      'Plan 210 Plus',
    );
  });

  it('el filtro de estado recarga, y el vacio explica que sin plan no hay convenio', async () => {
    const fixture = await montar();

    cambiarSelect(fixture, '#filtro-estado-plan', 'TODOS');
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.url === PLANES && peticion.params.get('estado') === 'TODOS',
      )
      .flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'no se puede firmar ningun convenio',
    );
  });

  it('la fecha de vigencia no filtra: cambia contra que dia se calcula, y recarga', async () => {
    const fixture = await montar();

    cambiarFecha(fixture, '#filtro-fecha-plan', '2026-03-15');
    const conFecha = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.url === PLANES && peticion.params.get('fecha') === '2026-03-15',
    );
    expect(conFecha.request.params.get('estado')).toBe('ACTIVO');
    conFecha.flush([{ ...VIGENCIA_CERRADA, vigente: true }]);
    await fixture.whenStable();
    fixture.detectChanges();

    // El mismo plan que hoy no se ofrece, en marzo si se ofrecia. Eso es lo que explica una
    // cobertura vieja, y es imposible de contestar recalculando en el navegador.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Activo y vigente');
  });

  it('si no se puede leer el financiador, la pantalla sigue sirviendo', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_CONVENIO_MANAGE] });

    const fixture = TestBed.createComponent(PlanesDelFinanciadorPage);
    fixture.detectChanges();

    httpMock.expectOne(esListado()).flush([VIGENTE, VIGENCIA_CERRADA]);
    httpMock
      .expectOne(`${RUTA_FINANCIADORES}/${FINANCIADOR}`)
      .flush(
        { type: 'https://akine.app/problems/not-found' },
        { status: 404, statusText: 'Not Found' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    // Degrada al id en el titulo en vez de tumbar el listado: no poner un nombre en un encabezado
    // no es motivo para dejar sin planes a quien entro a verlos.
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Planes del financiador #10');
    expect(texto).toContain('Plan 210');
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
    financiador: Record<string, unknown> = OSDE,
  ): Promise<ComponentFixture<PlanesDelFinanciadorPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_CONVENIO_MANAGE] });

    const fixture = TestBed.createComponent(PlanesDelFinanciadorPage);
    fixture.detectChanges();

    httpMock.expectOne(esListado()).flush([VIGENTE, VIGENCIA_CERRADA]);
    httpMock.expectOne(`${RUTA_FINANCIADORES}/${FINANCIADOR}`).flush(financiador);
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  /** El listado inicial: lleva `estado` y `fecha`, que el cliente arma como query string. */
  function esListado() {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'GET' &&
      peticion.url === PLANES &&
      peticion.params.get('estado') === 'ACTIVO';
  }
});

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

/** Un `input[type=date]` fuera de un formulario reactivo: la pantalla lo escucha con `change`. */
function cambiarFecha(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: string,
) {
  const campo = fixture.nativeElement.querySelector<HTMLInputElement>(selector);
  if (campo === null) {
    throw new Error(`No existe el campo ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('change'));
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

/** Un `select` que vive fuera de todo formulario reactivo: la pantalla lo escucha con `change`. */
function cambiarSelect(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: string,
) {
  const campo = fixture.nativeElement.querySelector<HTMLSelectElement>(selector);
  if (campo === null) {
    throw new Error(`No existe el selector ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}
