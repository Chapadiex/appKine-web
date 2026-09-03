import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CoberturasDelPacientePage } from './coberturas-del-paciente-page';
import { PERMISO_PACIENTE_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const PERSONA = 7;
const FICHA = `/api/v1/personas/${PERSONA}`;
const COBERTURAS = `/api/v1/personas/${PERSONA}/coberturas`;
const FINANCIADORES = '/api/v1/financiadores';

const PACIENTE = { id: PERSONA, apellido: 'Gomez', nombre: 'Ana', esPaciente: true, version: 1 };

/** Una financiada vigente y marcada principal: es la fila con todos los campos poblados. */
const OSDE = {
  id: 300,
  personaId: PERSONA,
  tipo: 'FINANCIADA',
  estado: 'ACTIVA',
  financiadorId: 12,
  financiadorNombre: 'OSDE',
  planId: 88,
  planNombre: '210',
  numeroAfiliado: '62-1234567-01',
  copago: 3500,
  moneda: 'ARS',
  vigenciaDesde: '2026-01-01',
  credencialVigenciaHasta: '2027-01-01',
  credencialVencida: false,
  principal: true,
  vigente: true,
  requeriaCredencial: true,
  version: 0,
};

/**
 * Spec de las coberturas del paciente (M08, AKINE-03.04).
 *
 * <p>Cubre las cuatro decisiones que hacen distinta a esta pantalla de un CRUD:
 *
 * <ol>
 *   <li><b>Finalizar la vigencia y dar de baja son dos cosas</b>, y la pantalla no las deja
 *       confundir. Si se fundieran, corregir un error de carga y registrar un cambio de obra social
 *       producirian el mismo dato.</li>
 *   <li><b>PARTICULAR no manda plan ni credencial.</b> Mandarlos produce el rechazo del CHECK de la
 *       base, y el operador leeria un error que no habla de nada que el haya hecho.</li>
 *   <li><b>Marcar principal no desmarca a la otra</b>, y el 409 resalta la fila que estorba en vez
 *       de mostrar un id en un cartel.</li>
 *   <li><b>Una persona que no es paciente</b> recibe una salida concreta: activarle el perfil.</li>
 * </ol>
 */
describe('CoberturasDelPacientePage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CoberturasDelPacientePage],
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

  // -------------------------------------------------------------------------------------
  // 1. Historial y seleccion del dia
  // -------------------------------------------------------------------------------------

  it('muestra la principal vigente arriba, antes que el historial', async () => {
    const fixture = await montar([OSDE]);
    const contenido = texto(fixture);

    expect(contenido).toContain('Para atender hoy');
    expect(contenido).toContain('OSDE — 210');
    expect(contenido).toContain('62-1234567-01');
  });

  it('sin ninguna principal no es un error, y dice que se puede atender igual', async () => {
    const fixture = await montar([{ ...OSDE, principal: false }]);

    expect(texto(fixture)).toContain('No hay ninguna cobertura marcada como principal');
    expect(texto(fixture)).toContain('se puede atender igual');
  });

  it('advierte que la cobertura del paciente no es convenio del centro', async () => {
    const fixture = await montar([OSDE]);

    // La confusion mas cara del modulo: el nombre de un financiador se lee como "aca le cubren
    // esto", y esto no dice eso.
    expect(texto(fixture)).toContain('no es convenio del centro');
    expect(texto(fixture)).toContain('no significa');
  });

  it('una cobertura activa con la vigencia cerrada no se lee como dada de baja', async () => {
    const fixture = await montar([
      { ...OSDE, vigente: false, vigenciaHasta: '2026-06-30', principal: false },
    ]);
    const contenido = texto(fixture);

    // Es el caso normal de quien cambio de obra social, y sigue explicando el pasado.
    expect(contenido).toContain('Vigencia terminada');
    expect(contenido).not.toContain('Dada de baja');
  });

  it('una lista vacia dice que se atiende como particular, que siempre esta disponible', async () => {
    const fixture = await montar([]);

    expect(texto(fixture)).toContain('se atiende como particular');
  });

  it('la credencial vencida se informa y no da de baja nada', async () => {
    const fixture = await montar([
      { ...OSDE, credencialVencida: true, credencialVigenciaHasta: '2026-01-01' },
    ]);
    const contenido = texto(fixture);

    expect(contenido).toContain('Vencida el 01/01/2026');
    // La cobertura sigue vigente: vencer la credencial automaticamente daria de baja coberturas
    // reales por un dato que el mostrador copia a mano.
    expect(contenido).toContain('Vigente');
  });

  // -------------------------------------------------------------------------------------
  // 2. Alta
  // -------------------------------------------------------------------------------------

  it('una alta PARTICULAR no manda plan ni credencial', async () => {
    const fixture = await montar([]);

    apretar(fixture, 'Agregar una cobertura');
    // Al abrir se piden los financiadores: se responden aunque el alta sea particular, porque el
    // formulario permite cambiar de tipo sin cerrarlo.
    httpMock.expectOne(esFinanciadores()).flush([]);
    await estabilizar(fixture);

    escribirEn(fixture, '#alta-cobertura-desde', '2026-09-01');
    apretar(fixture, 'Agregar cobertura');

    const pedido = httpMock.expectOne(esAlta());
    const cuerpo = pedido.request.body as Record<string, unknown>;
    expect(cuerpo['tipo']).toBe('PARTICULAR');
    // Mandarlos en null produciria el rechazo del CHECK de la base, y el mensaje hablaria de una
    // restriccion y no de lo que el operador hizo.
    expect(cuerpo['planId']).toBeUndefined();
    expect(cuerpo['credencialVigenciaHasta']).toBeUndefined();

    pedido.flush({ ...OSDE, id: 301, tipo: 'PARTICULAR', financiadorNombre: undefined });
    responderListado(httpMock.expectOne(esListado()), []);
    await estabilizar(fixture);
  });

  it('elegir un financiador pide sus planes contra la fecha de inicio, no contra hoy', async () => {
    const fixture = await montar([]);

    apretar(fixture, 'Agregar una cobertura');
    httpMock.expectOne(esFinanciadores()).flush([{ id: 12, nombre: 'OSDE', estado: 'ACTIVO' }]);
    await estabilizar(fixture);

    escribirEn(fixture, '#alta-cobertura-desde', '2026-01-15');
    elegirEn(fixture, '#alta-cobertura-tipo', 'FINANCIADA');
    elegirEn(fixture, '#alta-cobertura-financiador', '12');

    const pedido = httpMock.expectOne(esPlanes(12));
    // Contra `vigenciaDesde`: ofrecer planes vigentes hoy para una cobertura que arranca en otra
    // fecha produce un 409 que el operador no puede explicarse mirando la lista que acaba de ver.
    expect(pedido.request.urlWithParams).toContain('fecha=2026-01-15');
    pedido.flush([{ id: 88, nombre: '210', estado: 'ACTIVO' }]);
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('210');
  });

  it('una FINANCIADA sin plan elegido no manda nada y nombra el campo que falta', async () => {
    const fixture = await montar([]);

    apretar(fixture, 'Agregar una cobertura');
    httpMock.expectOne(esFinanciadores()).flush([{ id: 12, nombre: 'OSDE' }]);
    await estabilizar(fixture);

    escribirEn(fixture, '#alta-cobertura-desde', '2026-09-01');
    elegirEn(fixture, '#alta-cobertura-tipo', 'FINANCIADA');
    apretar(fixture, 'Agregar cobertura');

    httpMock.expectNone(esAlta());
    expect(texto(fixture)).toContain('Elegi el plan');
  });

  it('sin fecha de inicio no manda el alta: es contra esa fecha que se congela el plan', async () => {
    const fixture = await montar([]);

    apretar(fixture, 'Agregar una cobertura');
    httpMock.expectOne(esFinanciadores()).flush([]);
    await estabilizar(fixture);

    apretar(fixture, 'Agregar cobertura');

    httpMock.expectNone(esAlta());
    expect(texto(fixture)).toContain('La fecha de inicio es obligatoria');
  });

  it('a una persona sin perfil de paciente le ofrece activarlo, no un "no se pudo"', async () => {
    const fixture = await montar([]);

    apretar(fixture, 'Agregar una cobertura');
    httpMock.expectOne(esFinanciadores()).flush([]);
    await estabilizar(fixture);

    escribirEn(fixture, '#alta-cobertura-desde', '2026-09-01');
    apretar(fixture, 'Agregar cobertura');

    rechazar(httpMock.expectOne(esAlta()), 'persona-sin-perfil-paciente');
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Activale el perfil de paciente');
    expect(enlaces(fixture)).toContain('Ir a la ficha para activar el perfil');
  });

  it('el plan no seleccionable no revela por que, y manda a revisar la fecha', async () => {
    const fixture = await montar([]);

    apretar(fixture, 'Agregar una cobertura');
    httpMock.expectOne(esFinanciadores()).flush([]);
    await estabilizar(fixture);

    escribirEn(fixture, '#alta-cobertura-desde', '2026-09-01');
    apretar(fixture, 'Agregar cobertura');

    rechazar(httpMock.expectOne(esAlta()), 'plan-no-seleccionable');
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Revisa la fecha');
  });

  // -------------------------------------------------------------------------------------
  // 3. Finalizar contra dar de baja
  // -------------------------------------------------------------------------------------

  it('poner vigenciaHasta desde la edicion finaliza la vigencia, y el panel lo dice', async () => {
    const fixture = await montar([OSDE]);

    apretar(fixture, 'Editar o finalizar');
    const panel = texto(fixture);
    expect(panel).toContain('finaliza la vigencia');
    expect(panel).toContain('No es lo mismo que darla de baja');
    // Y dice que el plan no se cambia, que es donde el operador va a buscar el selector.
    expect(panel).toContain('El plan no se puede cambiar');

    escribirEn(fixture, `#editar-hasta-${OSDE.id}`, '2026-06-30');
    apretar(fixture, 'Guardar');

    const pedido = httpMock.expectOne(esEdicion());
    const cuerpo = pedido.request.body as Record<string, unknown>;
    expect(pedido.request.method).toBe('PUT');
    expect(cuerpo['vigenciaHasta']).toBe('2026-06-30');
    // Sin la version, el backend no puede detectar la edicion concurrente.
    expect(cuerpo['expectedVersion']).toBe(0);

    pedido.flush({ ...OSDE, vigenciaHasta: '2026-06-30', version: 1 });
    responderListado(httpMock.expectOne(esListado()), [{ ...OSDE, vigenciaHasta: '2026-06-30' }]);
    await estabilizar(fixture);
  });

  it('la baja exige motivo y aclara que finalizar es otra cosa', async () => {
    const fixture = await montar([OSDE]);

    apretar(fixture, 'Dar de baja');
    expect(texto(fixture)).toContain('NUNCA debio cargarse');

    // Con el motivo vacio no sale nada: una cobertura que desaparece sin explicacion es lo que una
    // auditoria busca.
    apretar(fixture, 'Confirmar la baja de la cobertura');
    httpMock.expectNone(esBaja());

    escribirEn(fixture, `#baja-cobertura-${OSDE.id}`, 'Cargada con el plan equivocado.');
    apretar(fixture, 'Confirmar la baja de la cobertura');

    const pedido = httpMock.expectOne(esBaja());
    expect((pedido.request.body as Record<string, unknown>)['reason']).toBe(
      'Cargada con el plan equivocado.',
    );

    pedido.flush({});
    responderListado(httpMock.expectOne(esListado()), []);
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No se borro');
  });

  it('una cobertura dada de baja no ofrece ninguna accion', async () => {
    const fixture = await montar([
      { ...OSDE, estado: 'INACTIVA', principal: false, deactivationReason: 'Error de carga.' },
    ]);

    // Las tres responden 409: ofrecerlas seria ofrecer tres rechazos.
    const rotulos = rotulosDeBoton(fixture);
    expect(rotulos).not.toContain('Editar o finalizar');
    expect(rotulos).not.toContain('Marcar principal');
    expect(rotulos).not.toContain('Dar de baja');
    expect(texto(fixture)).toContain('Error de carga.');
  });

  // -------------------------------------------------------------------------------------
  // 4. Principal
  // -------------------------------------------------------------------------------------

  it('marcar principal manda su propia peticion, no un campo de la edicion', async () => {
    const fixture = await montar([{ ...OSDE, principal: false }]);

    apretar(fixture, 'Marcar principal');

    const pedido = httpMock.expectOne(esPrincipal());
    expect(pedido.request.method).toBe('POST');
    expect((pedido.request.body as Record<string, unknown>)['principal']).toBe(true);

    pedido.flush({ ...OSDE, principal: true });
    responderListado(httpMock.expectOne(esListado()), [OSDE]);
    await estabilizar(fixture);
  });

  it('el 409 de principal superpuesta resalta la fila que estorba, no muestra un id', async () => {
    const otra = { ...OSDE, id: 301, principal: true, financiadorNombre: 'Swiss Medical' };
    const fixture = await montar([{ ...OSDE, principal: false }, otra]);

    apretar(fixture, 'Marcar principal');
    rechazar(httpMock.expectOne(esPrincipal()), 'cobertura-principal-superpuesta', {
      coberturaPrincipalId: 301,
    });
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No la desmarcamos solas');
    // La fila que impide el cambio queda senalada: un id en un cartel no le sirve a nadie que este
    // mirando una tabla.
    expect(texto(fixture)).toContain('Es la que impide el cambio');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.fila-senalada').length).toBe(
      1,
    );
  });

  it('quitar la marca de principal es legitimo y se puede', async () => {
    const fixture = await montar([OSDE]);

    apretar(fixture, 'Quitar principal');
    const pedido = httpMock.expectOne(esPrincipal());
    expect((pedido.request.body as Record<string, unknown>)['principal']).toBe(false);

    pedido.flush({ ...OSDE, principal: false });
    responderListado(httpMock.expectOne(esListado()), [{ ...OSDE, principal: false }]);
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('puede no tener ninguna preferida');
  });

  // -------------------------------------------------------------------------------------
  // Accesibilidad
  // -------------------------------------------------------------------------------------

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar([OSDE]);
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------

  async function montar(
    coberturas: object[],
  ): Promise<ComponentFixture<CoberturasDelPacientePage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_PACIENTE_MANAGE] });

    const fixture = TestBed.createComponent(CoberturasDelPacientePage);
    fixture.componentRef.setInput('personaId', String(PERSONA));
    fixture.detectChanges();

    httpMock.expectOne(FICHA).flush(PACIENTE);
    responderListado(httpMock.expectOne(esListado()), coberturas);
    await estabilizar(fixture);
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<CoberturasDelPacientePage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function responderListado(pedido: TestRequest, coberturas: object[]): void {
    pedido.flush(coberturas);
  }

  function rechazar(
    pedido: TestRequest,
    tipo: string,
    extension: Record<string, unknown> = {},
  ): void {
    pedido.flush(
      {
        type: `https://akine.app/problems/${tipo}`,
        status: 409,
        detail: 'Rechazado.',
        ...extension,
      },
      { status: 409, statusText: 'Conflict' },
    );
  }

  function esListado() {
    return (p: HttpRequest<unknown>) => p.method === 'GET' && p.url === COBERTURAS;
  }

  function esAlta() {
    return (p: HttpRequest<unknown>) => p.method === 'POST' && p.url === COBERTURAS;
  }

  function esEdicion() {
    return (p: HttpRequest<unknown>) => p.method === 'PUT' && p.url === `${COBERTURAS}/${OSDE.id}`;
  }

  function esBaja() {
    return (p: HttpRequest<unknown>) =>
      p.method === 'DELETE' && p.url === `${COBERTURAS}/${OSDE.id}`;
  }

  function esPrincipal() {
    return (p: HttpRequest<unknown>) =>
      p.method === 'POST' && p.url === `${COBERTURAS}/${OSDE.id}/principal`;
  }

  function esFinanciadores() {
    return (p: HttpRequest<unknown>) => p.method === 'GET' && p.url === FINANCIADORES;
  }

  function esPlanes(financiadorId: number) {
    return (p: HttpRequest<unknown>) =>
      p.method === 'GET' && p.url === `${FINANCIADORES}/${financiadorId}/planes`;
  }

  function elegirEn(
    fixture: ComponentFixture<CoberturasDelPacientePage>,
    selector: string,
    valor: string,
  ): void {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLSelectElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function escribirEn(
    fixture: ComponentFixture<CoberturasDelPacientePage>,
    selector: string,
    valor: string,
  ): void {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function apretar(fixture: ComponentFixture<CoberturasDelPacientePage>, rotulo: string): void {
    const boton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => (b.textContent ?? '').trim() === rotulo);
    if (boton === undefined) {
      throw new Error(`No hay ningun boton rotulado "${rotulo}".`);
    }
    boton.click();
    fixture.detectChanges();
  }

  function rotulosDeBoton(fixture: ComponentFixture<CoberturasDelPacientePage>): string[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).map((boton) => (boton.textContent ?? '').trim());
  }

  function enlaces(fixture: ComponentFixture<CoberturasDelPacientePage>): string[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>,
    ).map((enlace) => (enlace.textContent ?? '').trim());
  }

  function texto(fixture: ComponentFixture<CoberturasDelPacientePage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }
});
