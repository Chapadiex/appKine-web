import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { FinanciadoresPage } from './financiadores-page';
import { PERMISO_CONVENIO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_FINANCIADORES, RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const SEDE = 3;

const OSDE = {
  id: 10,
  codigo: '410',
  nombre: 'OSDE',
  tipo: 'PREPAGA',
  cuit: '30123456789',
  emailContacto: 'convenios@osde.test',
  telefonoContacto: '011-5555-0000',
  estado: 'ACTIVO',
  version: 4,
};

/** Dado de baja: sigue en el listado, con su motivo, y sus planes se siguen pudiendo mirar. */
const DE_BAJA = {
  id: 11,
  codigo: 'ART-01',
  nombre: 'Aseguradora del Sur',
  tipo: 'ART',
  estado: 'INACTIVO',
  deactivationReason: 'Dejamos de trabajar con ellos',
  version: 2,
};

/**
 * Spec del catalogo de financiadores (M15, AKINE-03.03).
 *
 * <p>Cubre lo que el criterio de aceptacion exige y nada mas. Los casos elegidos tienen algo en
 * comun: <b>cuando estan mal, el sintoma no es un error</b>.
 *
 * <ol>
 *   <li>El codigo tiene que quedar <b>fuera</b> del cuerpo de la edicion. Mandarlo no falla en el
 *       cliente —es un campo mas de un objeto— y el backend lo ignora o lo rechaza segun el dia;
 *       lo que la pantalla tiene que garantizar es que ni siquiera se pueda tipear.</li>
 *   <li>La baja tiene que <b>decir que no cascadea</b> antes de ejecutarse. Si no lo dice, la
 *       operacion sale igual y el malentendido aparece meses despues.</li>
 *   <li>Una ficha dada de baja tiene que seguir mostrando sus planes. Esconderlos no da ningun
 *       error: simplemente deja sin explicar una cobertura vieja.</li>
 *   <li>El `409 conflict` tiene que frenar. Reintentar en silencio pisa el cambio de otro y
 *       responde `200`.</li>
 * </ol>
 */
describe('FinanciadoresPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FinanciadoresPage],
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

  it('declara que PARTICULAR no es una ficha y que la baja no cascadea', async () => {
    const fixture = await montar();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

    // Las dos notas van arriba de la tabla porque son las causas de los dos malentendidos mas
    // caros del modulo. Si desaparecen, nada falla: alguien carga "Particular" como financiador.
    expect(texto).toContain('no es un financiador');
    expect(texto).toContain('Dar de baja no cascadea');
    expect(texto).toContain('siguen resolviendo');
  });

  it('el alta manda los obligatorios y omite los opcionales vacios', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de alta un financiador');
    escribir(fixture, '#alta-financiador-codigo', '410');
    escribir(fixture, '#alta-financiador-nombre', 'OSDE');
    elegir(fixture, '#alta-financiador-tipo', 'PREPAGA');
    // El panel de alta se renderiza ANTES de la seccion del listado, asi que el primer
    // `form[novalidate]` del documento es el suyo y no el del buscador.
    enviar(fixture, 'form[novalidate]');

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'POST' && peticion.url === RUTA_FINANCIADORES,
    );
    expect(alta.request.body).toEqual({ codigo: '410', nombre: 'OSDE', tipo: 'PREPAGA' });

    alta.flush({ ...OSDE, id: 12 });
    httpMock.expectOne(esListado()).flush([OSDE, DE_BAJA]);
    await fixture.whenStable();
    fixture.detectChanges();

    // El exito explica el paso siguiente: sin plan no se puede firmar ningun convenio.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Todavia no tiene planes');
  });

  it('la edicion NO manda el codigo, y el campo ni siquiera se puede tipear', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');

    const campoCodigo = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '#editar-financiador-codigo',
    );
    expect(campoCodigo?.disabled).toBe(true);
    expect(campoCodigo?.value).toBe('410');

    escribir(fixture, '#editar-financiador-nombre', 'OSDE Binario');
    enviar(fixture, 'tr.fila-panel form');

    const edicion = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PUT' && peticion.url === `${RUTA_FINANCIADORES}/10`,
    );
    // Solo lo que cambio, mas la version. El codigo es lo que los historicos guardan: mandarlo
    // reescribiria el significado de filas que no participan de esta llamada.
    expect(edicion.request.body).toEqual({ expectedVersion: 4, nombre: 'OSDE Binario' });

    edicion.flush({ ...OSDE, nombre: 'OSDE Binario', version: 5 });
    httpMock.expectOne(esListado()).flush([OSDE, DE_BAJA]);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('el panel de baja advierte que no cascadea ANTES de ejecutarla', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de baja');
    const panel = (fixture.nativeElement as HTMLElement).querySelector('tr.fila-panel');
    expect(panel?.textContent).toContain('NO cascadea');
    expect(panel?.textContent).toContain('No hay reactivacion');

    escribir(fixture, '#baja-financiador-motivo', 'Dejamos de trabajar con ellos');
    const confirmar = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('tr.fila-panel button'),
    ].find((boton) => (boton.textContent ?? '').trim() === 'Dar de baja');
    (confirmar as HTMLButtonElement).click();
    fixture.detectChanges();

    const baja = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'DELETE' && peticion.url === `${RUTA_FINANCIADORES}/10`,
    );
    // El motivo viaja en el CUERPO y no en la query: no tiene por que quedar en los logs de
    // acceso de ningun proxy.
    expect(baja.request.body).toEqual({ reason: 'Dejamos de trabajar con ellos' });

    baja.flush(null, { status: 204, statusText: 'No Content' });
    httpMock.expectOne(esListado()).flush([DE_BAJA]);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('un financiador dado de baja no ofrece editar ni dar de baja, pero si ver sus planes', async () => {
    const fixture = await montar();
    const filas = (fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr');
    const inactivo = filas[1] as HTMLElement;

    expect(inactivo.className).toContain('fila--revocada');
    expect(inactivo.textContent).toContain('Dejamos de trabajar con ellos');
    // Sus planes conservan sus filas y hay que poder consultarlos para explicar una cobertura
    // vieja. Esconderlos no daria ningun error: dejaria un historico sin explicacion.
    expect(
      inactivo.querySelector('a[href="/contratacion/financiadores/11/planes"]'),
    ).not.toBeNull();
    expect(
      [...inactivo.querySelectorAll('button')].map((boton) => boton.textContent?.trim()),
    ).toEqual([]);
  });

  it('el 409 conflict no pisa nada: relee, deja el panel abierto y explica', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-financiador-nombre', 'OSDE Binario');
    enviar(fixture, 'tr.fila-panel form');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'PUT' && peticion.url === `${RUTA_FINANCIADORES}/10`,
      )
      // `conflict`, NO `concurrent-modification`: es lo que emite este modulo para el bloqueo
      // optimista. Ver `contracting-errors.ts`.
      .flush(
        { type: 'https://akine.app/problems/conflict', detail: 'la version quedo vieja' },
        { status: 409, statusText: 'Conflict' },
      );
    fixture.detectChanges();

    httpMock.expectOne(esListado()).flush([{ ...OSDE, version: 9 }, DE_BAJA]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('no guardamos tus cambios para no pisar los suyos');
    expect(anfitrion.querySelector<HTMLInputElement>('#editar-financiador-nombre')?.value).toBe(
      'OSDE Binario',
    );
  });

  it('el alta manda los opcionales que si tienen contenido, ya recortados', async () => {
    // La contracara del caso de arriba. Cada opcional tiene sus dos ramas —viaja o no viaja— y
    // solo una se ejercitaba: un `agregarSiTiene` que se olvidara de un campo pasaba igual.
    const fixture = await montar();

    abrir(fixture, 'Dar de alta un financiador');
    escribir(fixture, '#alta-financiador-codigo', '  410  ');
    escribir(fixture, '#alta-financiador-nombre', 'OSDE');
    elegir(fixture, '#alta-financiador-tipo', 'PREPAGA');
    escribir(fixture, '#alta-financiador-cuit', '30-12345678-9');
    escribir(fixture, '#alta-financiador-email', 'convenios@osde.test');
    escribir(fixture, '#alta-financiador-telefono', '011-5555-0000');
    escribir(fixture, '#alta-financiador-observaciones', 'Contacto: Marta');
    enviar(fixture, 'form[novalidate]');

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'POST' && peticion.url === RUTA_FINANCIADORES,
    );
    expect(alta.request.body).toEqual({
      codigo: '410',
      nombre: 'OSDE',
      tipo: 'PREPAGA',
      // El CUIT viaja TAL COMO SE ESCRIBIO: lo normaliza el backend a 11 digitos. Limpiarlo aca
      // seria una segunda implementacion de esa regla, y es la leccion que 03.01 pago con el
      // documento de una persona.
      cuit: '30-12345678-9',
      emailContacto: 'convenios@osde.test',
      telefonoContacto: '011-5555-0000',
      observaciones: 'Contacto: Marta',
    });

    alta.flush({ ...OSDE, id: 12 });
    httpMock.expectOne(esListado()).flush([OSDE, DE_BAJA]);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('el alta con los obligatorios vacios no manda nada y senala el campo', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de alta un financiador');
    enviar(fixture, 'form[novalidate]');

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('El codigo es obligatorio');
    expect(texto).toContain('El nombre es obligatorio');
    expect(texto).toContain('Eligi que tipo de financiador es');
  });

  it('la edicion manda todos los campos que cambiaron, y solo esos', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-financiador-nombre', 'OSDE Binario');
    elegir(fixture, '#editar-financiador-tipo', 'OBRA_SOCIAL');
    escribir(fixture, '#editar-financiador-cuit', '30999999997');
    escribir(fixture, '#editar-financiador-email', 'nuevo@osde.test');
    escribir(fixture, '#editar-financiador-telefono', '011-4444-1111');
    escribir(fixture, '#editar-financiador-observaciones', 'Cambio de contacto');
    enviar(fixture, 'tr.fila-panel form');

    const edicion = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PUT' && peticion.url === `${RUTA_FINANCIADORES}/10`,
    );
    expect(edicion.request.body).toEqual({
      expectedVersion: 4,
      nombre: 'OSDE Binario',
      tipo: 'OBRA_SOCIAL',
      cuit: '30999999997',
      emailContacto: 'nuevo@osde.test',
      telefonoContacto: '011-4444-1111',
      observaciones: 'Cambio de contacto',
    });

    edicion.flush({ ...OSDE, version: 5 });
    httpMock.expectOne(esListado()).flush([OSDE, DE_BAJA]);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('un 403 no ofrece recargar: recargar no da permisos', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-financiador-nombre', 'OSDE Binario');
    enviar(fixture, 'tr.fila-panel form');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'PUT' && peticion.url === `${RUTA_FINANCIADORES}/10`,
      )
      .flush(
        { type: 'https://akine.app/problems/forbidden' },
        { status: 403, statusText: 'Forbidden' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('hace falta administrar convenios');
    expect(
      [...anfitrion.querySelectorAll('button')].some(
        (boton) => (boton.textContent ?? '').trim() === 'Recargar el listado',
      ),
    ).toBe(false);
  });

  it('un error del listado se puede reintentar, y el listado vacio explica que falta', async () => {
    const fixture = await montar();

    cambiarEstado(fixture, 'INACTIVO');
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.url === RUTA_FINANCIADORES && peticion.params.get('estado') === 'INACTIVO',
      )
      .flush({ type: 'https://akine.app/problems/internal' }, { status: 500, statusText: 'Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.querySelector('.estado--error')).not.toBeNull();

    const reintentar = [...anfitrion.querySelectorAll('button')].find(
      (boton) => (boton.textContent ?? '').trim() === 'Reintentar',
    );
    (reintentar as HTMLButtonElement).click();
    fixture.detectChanges();

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.url === RUTA_FINANCIADORES && peticion.params.get('estado') === 'INACTIVO',
      )
      .flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    // El vacio no es un error: explica que sin financiadores solo se puede cobrar particular.
    expect(anfitrion.textContent).toContain('solo puede cobrar de forma particular');
  });

  it('el filtro por tipo y la busqueda recargan con sus parametros', async () => {
    const fixture = await montar();

    elegir(fixture, '#filtro-tipo-financiador', 'ART');
    const filtrada = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.url === RUTA_FINANCIADORES && peticion.params.get('tipo') === 'ART',
    );
    expect(filtrada.request.params.get('estado')).toBe('ACTIVO');
    filtrada.flush([DE_BAJA]);
    await fixture.whenStable();
    fixture.detectChanges();

    // La busqueda va con el submit del formulario, no con cada tecla: sin `[formGroup]` el
    // `(ngSubmit)` no lo emite nadie y el boton no haria nada, sin error en ningun lado.
    escribir(fixture, '#buscar-financiador', 'sur');
    enviar(fixture, 'form.campo');
    const buscada = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.url === RUTA_FINANCIADORES && peticion.params.get('q') === 'sur',
    );
    buscada.flush([DE_BAJA]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Aseguradora del Sur');
  });

  it(
    'la pantalla no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  async function montar(): Promise<ComponentFixture<FinanciadoresPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_CONVENIO_MANAGE] });

    const fixture = TestBed.createComponent(FinanciadoresPage);
    fixture.detectChanges();

    httpMock.expectOne(esListado()).flush([OSDE, DE_BAJA]);
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  /**
   * El listado sin filtros extra, matcheado por ruta y no por URL completa.
   *
   * <p>El cliente generado agrega el `estado` por defecto, asi que la URL real lleva query string
   * y un `expectOne(RUTA_FINANCIADORES)` con string no la encuentra: compara contra
   * `urlWithParams`.
   */
  function esListado() {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'GET' &&
      peticion.url === RUTA_FINANCIADORES &&
      !peticion.params.has('tipo') &&
      !peticion.params.has('q');
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

/** El `select` de estado del listado, que vive fuera de todo formulario reactivo. */
function cambiarEstado(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  valor: string,
) {
  const campo = fixture.nativeElement.querySelector<HTMLSelectElement>(
    '#filtro-estado-financiador',
  );
  if (campo === null) {
    throw new Error('No existe el filtro de estado');
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}
