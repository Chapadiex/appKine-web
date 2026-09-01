import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CuentaCorrientePage } from './cuenta-corriente-page';
import { PERMISO_COBRO_REGISTER } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const CONSULTORIO = 3;
const PERSONA = 128;

const OBLIGACIONES = `/api/v1/consultorios/${CONSULTORIO}/obligaciones?personaId=${PERSONA}`;
const FICHA = `/api/v1/personas/${PERSONA}`;

const PENDIENTE = {
  id: 9001,
  personaId: PERSONA,
  consultorioId: CONSULTORIO,
  sesionId: 501,
  ofertaId: 42,
  estado: 'PENDIENTE',
  responsable: 'PACIENTE',
  moneda: 'ARS',
  importeOriginal: 8500.5,
  saldo: 8500.5,
  snapshotPrecio: 8500.5,
  snapshotNombre: 'Kinesiologia - sesion',
  devengadaEn: '2026-09-15T12:48:00Z',
  version: 0,
};

/**
 * Spec de la cuenta corriente (M18, AKINE-07.01).
 *
 * <p>Cubre solo lo que decide comportamiento:
 *
 * <ol>
 *   <li><b>Los importes se formatean con la moneda de la respuesta</b>, y <b>no se suman</b>. Una
 *       aritmetica de punto flotante sobre plata produce centavos que no cuadran, y el total es el
 *       numero que despues alguien le dice a un paciente.</li>
 *   <li><b>Los tres rechazos de la anulacion se mapean por `problemType`.</b> Con un mensaje
 *       generico, `obligacion-con-cobros` se leeria como "no se puede" y el administrativo nunca
 *       se enteraria de que lo que corresponde es una devolucion.</li>
 *   <li><b>El motivo es obligatorio</b> y el envio vacio no manda nada.</li>
 * </ol>
 */
describe('CuentaCorrientePage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CuentaCorrientePage],
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
  // 1. Importes
  // -------------------------------------------------------------------------------------

  it('formatea los importes con la moneda de la respuesta y sin perder los centavos', async () => {
    const fixture = await montar([PENDIENTE]);

    // 8500.5 tiene que leerse "8.500,50" y no "8500.5": una columna de plata se lee comparando.
    expect(texto(fixture)).toContain('8.500,50');
    expect(texto(fixture)).toContain('$');
  });

  it('no muestra ningun total: no se suma plata en la pantalla', async () => {
    // Dos deudas cuya suma en punto flotante da 0.30000000000000004. Si la pantalla sumara, ese
    // numero -o su redondeo- terminaria en el DOM.
    const fixture = await montar([
      { ...PENDIENTE, id: 9001, importeOriginal: 0.1, saldo: 0.1, snapshotPrecio: 0.1 },
      { ...PENDIENTE, id: 9002, importeOriginal: 0.2, saldo: 0.2, snapshotPrecio: 0.2 },
    ]);

    const contenido = texto(fixture);
    expect(contenido).not.toContain('0,30');
    expect(contenido).not.toContain('0.30000000000000004');
    expect(contenido).toContain('No se muestra un total');
  });

  it('rotula el precio como el del momento de devengar, no como el vigente', async () => {
    const fixture = await montar([PENDIENTE]);

    // Sin la aclaracion, alguien "corrige" una deuda vieja que esta bien porque la oferta hoy vale
    // otra cosa.
    expect(texto(fixture)).toContain('Precio al devengar');
  });

  it('una lista vacia no es un error, y dice de donde salen las deudas', async () => {
    const fixture = await montar([]);

    // Que alguien no deba nada es el caso bueno. Y la aclaracion importa: sin ella, un
    // administrativo puede buscar el boton de "cargar una deuda", que no existe ni va a existir
    // -la obligacion se deriva del cierre de la sesion-.
    expect(texto(fixture)).toContain('no tiene ninguna deuda registrada');
    expect(texto(fixture)).toContain('al cerrar una atencion');
  });

  it('un 403 al cargar dice que falta el permiso, no un error generico', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });

    // Sin `cobro:register` la directiva esconde el enlace de cobrar: quien no puede cobrar no ve
    // el boton, y el 403 de la lectura se explica igual.
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(CuentaCorrientePage);
    fixture.componentRef.setInput('personaId', String(PERSONA));
    fixture.detectChanges();

    httpMock.expectOne(FICHA).flush({ id: PERSONA, apellido: 'Gomez', nombre: 'Ana' });
    httpMock
      .expectOne(esListado())
      .flush(
        { type: 'https://akine.app/problems/forbidden', status: 403, detail: 'Sin permiso.' },
        { status: 403, statusText: 'Forbidden' },
      );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No tenes permiso');
    // Reintentar, y NO mandar a elegir contexto: el contexto esta, lo que falta es el permiso.
    expect(rotulosDeBoton(fixture)).toContain('Reintentar');
  });

  it('una deuda ya anulada no ofrece anularse otra vez, y muestra su motivo', async () => {
    const fixture = await montar([
      {
        ...PENDIENTE,
        estado: 'ANULADA',
        version: 1,
        motivoAnulacion: 'Cargada con la oferta equivocada.',
      },
    ]);

    // Ofrecer el boton seria ofrecer una accion que el backend rechaza con 409. Y el motivo se
    // muestra porque es lo que hace auditable la baja logica.
    expect(rotulosDeBoton(fixture)).not.toContain('Anular');
    expect(texto(fixture)).toContain('Cargada con la oferta equivocada.');
  });

  // -------------------------------------------------------------------------------------
  // 2. Los tres rechazos de la anulacion
  // -------------------------------------------------------------------------------------

  it('ante obligacion-con-cobros NO dice "no se puede": explica la devolucion y el importe cobrado', async () => {
    const fixture = await montar([PENDIENTE]);
    anular(fixture, 'Cargada por error.');

    rechazar(httpMock.expectOne(esAnular()), 'obligacion-con-cobros', { yaCobrado: 3000 });
    await estabilizar(fixture);

    const contenido = texto(fixture);
    expect(contenido).toContain('devolucion');
    // El importe ya cobrado es lo que hace decidible el paso siguiente, y va formateado con la
    // moneda de ESA obligacion: el `ProblemDetail` no la trae.
    expect(contenido).toContain('3.000,00');
    expect(contenido).not.toContain('no se puede');
  });

  it('ante obligacion-already-anulada no lo trata como una falla, y ofrece recargar', async () => {
    const fixture = await montar([PENDIENTE]);
    anular(fixture, 'Duplicada.');

    rechazar(httpMock.expectOne(esAnular()), 'obligacion-already-anulada');
    await estabilizar(fixture);

    // El estado buscado ya esta: reintentar la misma anulacion no aporta nada.
    expect(texto(fixture)).toContain('ya estaba anulada');
    expect(rotulosDeBoton(fixture)).toContain('Recargar la cuenta corriente');
  });

  it('ante concurrent-modification dice que no se piso nada y manda a recargar', async () => {
    const fixture = await montar([PENDIENTE]);
    anular(fixture, 'Error de carga.');

    rechazar(httpMock.expectOne(esAnular()), 'concurrent-modification');
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No se piso nada');
    expect(rotulosDeBoton(fixture)).toContain('Recargar la cuenta corriente');
  });

  // -------------------------------------------------------------------------------------
  // 3. El motivo
  // -------------------------------------------------------------------------------------

  it('con el motivo vacio no manda la anulacion', async () => {
    const fixture = await montar([PENDIENTE]);

    apretar(fixture, 'Anular');
    // Sin escribir nada en el campo. Una deuda que se borra sin explicacion es exactamente lo que
    // una auditoria busca, asi que el envio tiene que quedarse acá.
    apretar(fixture, 'Anular la deuda');

    httpMock.expectNone(esAnular());
  });

  it('anular manda motivo y version, y la deuda queda anulada, no borrada', async () => {
    const fixture = await montar([PENDIENTE]);
    anular(fixture, 'Cargada con la oferta equivocada.');

    const pedido = httpMock.expectOne(esAnular());
    const cuerpo = pedido.request.body as Record<string, unknown>;
    expect(cuerpo['motivo']).toBe('Cargada con la oferta equivocada.');
    expect(cuerpo['version']).toBe(0);

    pedido.flush({
      ...PENDIENTE,
      estado: 'ANULADA',
      version: 1,
      motivoAnulacion: 'Cargada con la oferta equivocada.',
    });
    await estabilizar(fixture);

    // Recarga sola: la fila tiene que reflejar el estado nuevo. La recarga vuelve a pedir la
    // ficha junto con el listado, porque `cargar()` rehace las dos lecturas.
    httpMock.expectOne(FICHA).flush({ id: PERSONA, apellido: 'Gomez', nombre: 'Ana' });
    responderListado(httpMock.expectOne(esListado()), [
      {
        ...PENDIENTE,
        estado: 'ANULADA',
        version: 1,
        motivoAnulacion: 'Cargada con la oferta equivocada.',
      },
    ]);
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('no se borra');
    expect(texto(fixture)).toContain('Anulada');
  });

  // -------------------------------------------------------------------------------------
  // Accesibilidad
  // -------------------------------------------------------------------------------------

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar([PENDIENTE]);
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------

  async function montar(obligaciones: object[]): Promise<ComponentFixture<CuentaCorrientePage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });

    // El enlace a "Registrar un cobro" va detras de `*akinePermiso`. Se siembra el store antes de
    // montar para que la directiva no salga a pedir los permisos por su cuenta.
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_COBRO_REGISTER] });

    const fixture = TestBed.createComponent(CuentaCorrientePage);
    fixture.componentRef.setInput('personaId', String(PERSONA));
    fixture.detectChanges();

    // La ficha es el encabezado: se responde para que la pantalla diga de quien es la deuda.
    httpMock.expectOne(FICHA).flush({ id: PERSONA, apellido: 'Gomez', nombre: 'Ana' });
    responderListado(httpMock.expectOne(esListado()), obligaciones);
    await estabilizar(fixture);
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<CuentaCorrientePage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Abre el panel de anulacion, escribe el motivo y confirma. */
  function anular(fixture: ComponentFixture<CuentaCorrientePage>, motivo: string): void {
    apretar(fixture, 'Anular');
    escribirEn(fixture, `#anular-${PENDIENTE.id}`, motivo);
    fixture.detectChanges();
    apretar(fixture, 'Anular la deuda');
  }

  function responderListado(pedido: TestRequest, obligaciones: object[]): void {
    pedido.flush(obligaciones);
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

  function escribirEn(
    fixture: ComponentFixture<CuentaCorrientePage>,
    selector: string,
    valor: string,
  ): void {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
  }

  function apretar(fixture: ComponentFixture<CuentaCorrientePage>, rotulo: string): void {
    const boton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => (b.textContent ?? '').trim() === rotulo);
    if (boton === undefined) {
      throw new Error(`No hay ningun boton rotulado "${rotulo}".`);
    }
    boton.click();
    fixture.detectChanges();
  }

  function rotulosDeBoton(fixture: ComponentFixture<CuentaCorrientePage>): string[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).map((boton) => (boton.textContent ?? '').trim());
  }

  function texto(fixture: ComponentFixture<CuentaCorrientePage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function esListado() {
    return (p: HttpRequest<unknown>) => p.method === 'GET' && p.urlWithParams === OBLIGACIONES;
  }

  function esAnular() {
    return (p: HttpRequest<unknown>) =>
      p.method === 'DELETE' &&
      p.url === `/api/v1/consultorios/${CONSULTORIO}/obligaciones/${PENDIENTE.id}`;
  }
});
