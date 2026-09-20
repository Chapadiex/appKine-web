import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { ArancelesDelConvenioPage } from './aranceles-del-convenio-page';
import { PERMISO_CONVENIO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import {
  RUTA_PERMISOS_EFECTIVOS,
  rutaAranceles,
  rutaConvenios,
} from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const SEDE = 3;
const CONVENIO = 7;
const ARANCELES = rutaAranceles(SEDE, CONVENIO);
const RUTA_PRACTICAS = '/api/v1/catalogos/practicas';

const EL_CONVENIO = {
  id: CONVENIO,
  consultorioId: SEDE,
  codigo: 'CONV-OSDE-210',
  nombre: 'OSDE 210 kinesiologia',
  moneda: 'ARS',
  vigenciaDesde: '2026-01-01',
  vigenciaHasta: '2026-12-31',
  estado: 'ACTIVO',
  vigente: true,
  version: 2,
};

const PRACTICA = { id: 55, codigo: 'KIN-01', name: 'Sesion de kinesiologia', tipo: 'PRACTICA' };

/** Vigente hoy. Los tres importes cuadran: 9000 + 3000 = 12000. */
const VIGENTE = {
  id: 900,
  convenioId: CONVENIO,
  practicaId: 55,
  importeTotal: 12000,
  importeFinanciador: 9000,
  coseguro: 3000,
  vigenciaDesde: '2026-01-01',
  vigenciaHasta: '2026-06-30',
  estado: 'ACTIVO',
  vigente: true,
  version: 1,
};

/**
 * El arancel del semestre anterior, de la <b>misma practica</b>.
 *
 * <p>Convivir es el caso normal, no un duplicado: es lo que hace que una prestacion de enero se
 * pueda explicar con el precio de enero. Lo que no pueden es solaparse.
 */
const ANTERIOR = {
  ...VIGENTE,
  id: 901,
  importeTotal: 9000,
  importeFinanciador: 7000,
  coseguro: 2000,
  vigenciaDesde: '2025-07-01',
  vigenciaHasta: '2025-12-31',
  vigente: false,
};

/**
 * Spec de la grilla de aranceles (M16, AKINE-03.05).
 *
 * <p>Los casos elegidos comparten la propiedad de siempre: <b>cuando estan mal, el sintoma no es
 * un error</b>, y aca ademas el dano es economico.
 *
 * <ol>
 *   <li>La terna tiene que cuadrar <b>y compararse en centavos enteros</b>. Con flotantes crudos,
 *       un arancel legitimo de 1000.10 + 2000.20 quedaria rechazado por la pantalla mientras el
 *       backend —que usa BigDecimal— lo acepta.</li>
 *   <li>La moneda tiene que salir del <b>convenio</b>. El arancel no la declara, y una grilla de
 *       numeros sin unidad es exactamente la ambiguedad que este modulo evita.</li>
 *   <li>La edicion manda <b>los tres importes</b> aunque solo se toque uno: se validan como terna,
 *       y subir el total sin repartir la diferencia es el descuido tipico.</li>
 *   <li>La pantalla tiene que ensenar que subir un precio no es editar el arancel. Si no lo dice,
 *       alguien lo edita y borra el rastro del precio anterior sin ningun error.</li>
 * </ol>
 */
describe('ArancelesDelConvenioPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArancelesDelConvenioPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ convenioId: String(CONVENIO) }) } },
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

  it('los importes se muestran con la moneda del convenio, que el arancel no declara', async () => {
    const fixture = await montar();
    const filas = (fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr');
    expect(filas.length).toBe(2);

    const vigente = filas[0] as HTMLElement;
    expect(vigente.textContent).toContain('ARS 12000.00');
    expect(vigente.textContent).toContain('ARS 9000.00');
    expect(vigente.textContent).toContain('ARS 3000.00');

    // Los dos aranceles son de la MISMA practica y conviven. Es lo que hace que una prestacion de
    // 2025 se pueda explicar con el precio de 2025.
    expect((filas[1] as HTMLElement).textContent).toContain('ARS 9000.00');
    expect((filas[1] as HTMLElement).className).toContain('fila--atenuada');
  });

  it('ensena que subir un precio no es editar el arancel', async () => {
    const fixture = await montar();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

    // Sin esta explicacion alguien edita el importe para "actualizarlo" y borra el rastro del
    // precio anterior. No falla nada: la historia simplemente deja de existir.
    expect(texto).toContain('Subir un precio no es editar el arancel');
    expect(texto).toContain('cerrale la vigencia al arancel actual y carga otro');
    // Y la regla economica, que no tiene porcentaje a proposito.
    expect(texto).toContain('financiador + coseguro = total');
  });

  it('el alta frena si los tres importes no cuadran, y dice de cuanto es la diferencia', async () => {
    const fixture = await montar();

    abrir(fixture, 'Cargar un arancel');
    elegir(fixture, '#alta-arancel-practica', '55');
    escribir(fixture, '#alta-arancel-total', '12000');
    escribir(fixture, '#alta-arancel-financiador', '9000');
    escribir(fixture, '#alta-arancel-coseguro', '2500');
    escribir(fixture, '#alta-arancel-desde', '2026-07-01');
    enviar(fixture, 'form[novalidate]');

    // Ni una peticion: el backend lo rechazaria igual —hay un CHECK en la base— pero su 400 no
    // puede decir cual de los tres numeros esta mal.
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('tienen que cuadrar');
    expect(texto).toContain('difiere del total en 500');

    escribir(fixture, '#alta-arancel-coseguro', '3000');
    enviar(fixture, 'form[novalidate]');

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === ARANCELES,
    );
    const cuerpo = alta.request.body as Record<string, unknown>;
    expect(cuerpo['practicaId']).toBe(55);
    expect(cuerpo['importeTotal']).toBe(12000);
    expect(cuerpo['importeFinanciador']).toBe(9000);
    expect(cuerpo['coseguro']).toBe(3000);
    // La moneda NO viaja: la hereda del convenio.
    expect(cuerpo['moneda']).toBeUndefined();

    alta.flush({ ...VIGENTE, id: 902 });
    httpMock.expectOne(esListado()).flush([VIGENTE, ANTERIOR]);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('un coseguro en cero es valido: cobertura total no es un dato faltante', async () => {
    const fixture = await montar();

    abrir(fixture, 'Cargar un arancel');
    elegir(fixture, '#alta-arancel-practica', '55');
    escribir(fixture, '#alta-arancel-total', '9000');
    escribir(fixture, '#alta-arancel-financiador', '9000');
    escribir(fixture, '#alta-arancel-coseguro', '0');
    escribir(fixture, '#alta-arancel-desde', '2026-07-01');
    enviar(fixture, 'form[novalidate]');

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === ARANCELES,
    );
    expect((alta.request.body as Record<string, unknown>)['coseguro']).toBe(0);

    alta.flush({ ...VIGENTE, id: 903 });
    httpMock.expectOne(esListado()).flush([VIGENTE, ANTERIOR]);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('la edicion manda los TRES importes aunque se toque uno solo', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    // Se corrige el reparto sin mover el total: la terna sigue cuadrando.
    escribir(fixture, '#editar-arancel-financiador', '8000');
    escribir(fixture, '#editar-arancel-coseguro', '4000');
    enviar(fixture, 'tr.fila-panel form');

    const edicion = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PUT' && peticion.url === `${ARANCELES}/900`,
    );
    // El total viaja aunque no cambio: el backend valida la terna completa, y mandar solo las
    // partes lo obligaria a componerla con un valor que no esta en el cuerpo.
    expect(edicion.request.body).toEqual({
      expectedVersion: 1,
      importeTotal: 12000,
      importeFinanciador: 8000,
      coseguro: 4000,
    });

    edicion.flush({ ...VIGENTE, importeFinanciador: 8000, coseguro: 4000, version: 2 });
    httpMock.expectOne(esListado()).flush([VIGENTE, ANTERIOR]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'NO es la forma de subir un precio',
    );
  });

  /**
   * El unico campo numerico del repositorio cuyo vaciado NO terminaba en un 400.
   *
   * <p>Un `<input type="number">` vaciado entrega `null`, no `''`. La guarda vieja
   * (`valores.campo !== ''`) lo dejaba pasar, `Number(null)` daba `0`, la terna `0 = 0 + 0`
   * cuadraba y el contrato declara `minimum: 0.00`: el backend aceptaba y el arancel del convenio
   * quedaba en cero pesos <b>con cartel de exito</b>. El formulario de alta nunca tuvo el hueco
   * porque sus tres importes llevan `Validators.required`; el de edicion no lleva ninguno.
   */
  it('vaciar un importe en la edicion no guarda un cero: no manda nada y lo dice', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-arancel-total', '');
    enviar(fixture, 'tr.fila-panel form');

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'PUT');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Los tres importes tienen que tener un valor',
    );
  });

  it('vaciar el coseguro en la edicion tampoco guarda un cero', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-arancel-coseguro', '');
    enviar(fixture, 'tr.fila-panel form');

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'PUT');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Los tres importes tienen que tener un valor',
    );
  });

  it('el alta sin practica ni importes no manda nada', async () => {
    const fixture = await montar();

    abrir(fixture, 'Cargar un arancel');
    enviar(fixture, 'form[novalidate]');

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Eligi a que practica');
    expect(texto).toContain('El importe total es obligatorio');
  });

  it('el alta con fin de vigencia lo manda, y el fin es inclusivo', async () => {
    const fixture = await montar();

    abrir(fixture, 'Cargar un arancel');
    elegir(fixture, '#alta-arancel-practica', '55');
    escribir(fixture, '#alta-arancel-total', '15000');
    escribir(fixture, '#alta-arancel-financiador', '10000');
    escribir(fixture, '#alta-arancel-coseguro', '5000');
    escribir(fixture, '#alta-arancel-desde', '2026-07-01');
    escribir(fixture, '#alta-arancel-hasta', '2026-12-31');
    enviar(fixture, 'form[novalidate]');

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === ARANCELES,
    );
    expect(alta.request.body).toEqual({
      practicaId: 55,
      importeTotal: 15000,
      importeFinanciador: 10000,
      coseguro: 5000,
      vigenciaDesde: '2026-07-01',
      vigenciaHasta: '2026-12-31',
    });

    alta.flush({ ...VIGENTE, id: 904 });
    httpMock.expectOne(esListado()).flush([VIGENTE, ANTERIOR]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('la hereda');
  });

  it('la edicion frena si la terna deja de cuadrar', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    // Se sube el total sin repartir la diferencia: el descuido con el que se rompe la invariante
    // economica sin que nadie lo note.
    escribir(fixture, '#editar-arancel-total', '15000');
    enviar(fixture, 'tr.fila-panel form');

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'PUT');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('difiere del total en');
  });

  it('la edicion que solo mueve la vigencia no toca los importes', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-arancel-hasta', '2026-08-31');
    enviar(fixture, 'tr.fila-panel form');

    const edicion = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PUT' && peticion.url === `${ARANCELES}/900`,
    );
    // Los importes no viajan porque no se tocaron: mandarlos igual seria pedirle al backend que
    // revalide una terna que nadie cambio.
    expect(edicion.request.body).toEqual({ expectedVersion: 1, vigenciaHasta: '2026-08-31' });

    edicion.flush({ ...VIGENTE, vigenciaHasta: '2026-08-31', version: 2 });
    httpMock.expectOne(esListado()).flush([VIGENTE, ANTERIOR]);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('la baja del arancel avisa que libera el periodo', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de baja');
    const panel = (fixture.nativeElement as HTMLElement).querySelector('tr.fila-panel');
    expect(panel?.textContent).toContain('Libera el PERIODO');

    escribir(fixture, '#baja-arancel-motivo', 'Se cargo con el precio equivocado');
    const confirmar = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('tr.fila-panel button'),
    ].find((boton) => (boton.textContent ?? '').trim() === 'Dar de baja');
    (confirmar as HTMLButtonElement).click();
    fixture.detectChanges();

    const baja = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'DELETE' && peticion.url === `${ARANCELES}/900`,
    );
    expect(baja.request.body).toEqual({ reason: 'Se cargo con el precio equivocado' });

    baja.flush(null, { status: 204, statusText: 'No Content' });
    httpMock.expectOne(esListado()).flush([ANTERIOR]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('su periodo quedo libre');
  });

  it('el 409 de solapamiento no ofrece recargar la grilla', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-arancel-hasta', '2026-12-31');
    enviar(fixture, 'tr.fila-panel form');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'PUT' && peticion.url === `${ARANCELES}/900`,
      )
      .flush(
        { type: 'https://akine.app/problems/arancel-solapado', detail: 'choca con el 901' },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('cerra la vigencia del que ya esta');
    // Recargar no mueve el periodo que choca: ofrecerlo manda a apretar algo que no cambia nada.
    expect(
      [...anfitrion.querySelectorAll('button')].some(
        (boton) => (boton.textContent ?? '').trim() === 'Recargar la grilla',
      ),
    ).toBe(false);
  });

  it('el filtro y la fecha recargan, y el vacio explica que el convenio no resuelve nada', async () => {
    const fixture = await montar();

    cambiarSelect(fixture, '#filtro-estado-arancel', 'INACTIVO');
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.url === ARANCELES && peticion.params.get('estado') === 'INACTIVO',
      )
      .flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'no resuelve ningun precio',
    );

    cambiarSelect(fixture, '#filtro-fecha-arancel', '2025-09-10');
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.url === ARANCELES && peticion.params.get('fecha') === '2025-09-10',
      )
      .flush([{ ...ANTERIOR, vigente: true }]);
    await fixture.whenStable();
    fixture.detectChanges();

    // El arancel que hoy esta vencido, en septiembre de 2025 si regia.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Activo y vigente');
  });

  it('un convenio dado de baja no ofrece cargar aranceles, pero los sigue mostrando', async () => {
    const fixture = await montar({ ...EL_CONVENIO, estado: 'INACTIVO' });
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(texto).toContain('no admite aranceles nuevos');
    expect(
      [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].some(
        (boton) => (boton.textContent ?? '').trim() === 'Cargar un arancel',
      ),
    ).toBe(false);
    // Y las filas siguen ahi: hay que poder verlas para explicar una liquidacion vieja.
    expect(texto).toContain('Sesion de kinesiologia');
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
    convenio: Record<string, unknown> = EL_CONVENIO,
  ): Promise<ComponentFixture<ArancelesDelConvenioPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_CONVENIO_MANAGE] });

    const fixture = TestBed.createComponent(ArancelesDelConvenioPage);
    fixture.detectChanges();

    httpMock.expectOne(esListado()).flush([VIGENTE, ANTERIOR]);
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) => peticion.url === `${rutaConvenios(SEDE)}/${CONVENIO}`,
      )
      .flush(convenio);
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === RUTA_PRACTICAS)
      .flush({ content: [PRACTICA] });
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  function esListado() {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'GET' && peticion.url === ARANCELES;
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
  if (formulario === null) {
    throw new Error(`No existe el formulario ${selector}`);
  }
  formulario.dispatchEvent(new Event('submit'));
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
