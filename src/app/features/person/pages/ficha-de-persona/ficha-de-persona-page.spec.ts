import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { FichaDePersonaPage } from './ficha-de-persona-page';
import { PERMISO_PACIENTE_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const PERSONA = 7;
const RESUMEN = `/api/v1/personas/${PERSONA}/resumen`;
const BAJA_PERSONA = `/api/v1/personas/${PERSONA}`;
const BAJA_PERFIL = `/api/v1/personas/${PERSONA}/perfil-paciente`;

const PACIENTE = {
  id: PERSONA,
  apellido: 'Gomez',
  nombre: 'Ana',
  tipoDocumento: 'DNI',
  numeroDocumento: '27888999',
  telefono: '351-5550000',
  esPaciente: true,
  estado: 'ACTIVO',
  version: 3,
};

/** Un 360 completo: una seccion con datos, otra vacia, y una tercera omitida por permisos. */
const RESUMEN_COMPLETO = {
  persona: PACIENTE,
  adjuntosTotal: 2,
  adjuntosPorCategoria: { CREDENCIAL_COBERTURA: 1, DOCUMENTO_IDENTIDAD: 1 },
  secciones: [
    {
      seccion: 'turnos',
      indicadores: [
        { clave: 'turnos-futuros', etiqueta: 'Turnos futuros', cantidad: 3 },
        { clave: 'turnos-ausencias', etiqueta: 'Ausencias', cantidad: 0 },
      ],
      hitos: [
        {
          seccion: 'turnos',
          tipo: 'TURNO',
          ocurrioEn: '2026-09-15T12:48:00Z',
          titulo: 'Turno',
          estado: 'CONFIRMADO',
          referencia: 501,
        },
      ],
    },
    {
      seccion: 'coberturas',
      indicadores: [],
      hitos: [],
    },
  ],
  seccionesOmitidas: [{ seccion: 'economia', permisoRequerido: 'cobro:register' }],
};

/**
 * Spec de la ficha 360 (RF-M07-004, AKINE-03.02).
 *
 * <p>Cubre solo lo que decide comportamiento, y el primer bloque es la razon de ser de la
 * pantalla:
 *
 * <ol>
 *   <li><b>Una seccion omitida por permisos y una seccion vacia no se ven igual.</b> El backend
 *       recorta y no rechaza; si la pantalla tratara las dos igual, el operador leeria "sin
 *       turnos" donde en realidad dice "no podes ver los turnos". Es la unica diferencia que el
 *       usuario no puede deducir por su cuenta.</li>
 *   <li><b>Las dos bajas mandan motivo</b>, y la de persona manda ademas la version. Con el motivo
 *       vacio no sale ninguna peticion: es el defecto que 03.01 pago —un panel que rotula el campo
 *       como opcional y valida como obligatorio deja la accion inejecutable— mirado desde el otro
 *       lado, porque aca el motivo <b>si</b> es obligatorio y el default del componente es el
 *       correcto.</li>
 *   <li><b>La pantalla no muestra nada clinico</b> y lo dice.</li>
 * </ol>
 */
describe('FichaDePersonaPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FichaDePersonaPage],
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
  // 1. Omitida por permisos contra vacia
  // -------------------------------------------------------------------------------------

  it('una seccion omitida por permisos dice que falta permiso y nombra cual', async () => {
    const fixture = await montar(RESUMEN_COMPLETO);
    const contenido = texto(fixture);

    expect(contenido).toContain('sin permiso');
    expect(contenido).toContain('No tenes permiso para ver esta seccion');
    // El codigo del permiso es lo que hace accionable el aviso: sin el, quien administra el centro
    // tiene que adivinar que habilitar.
    expect(contenido).toContain('cobro:register');
  });

  it('una seccion vacia dice que se consulto y no hay nada, y NO habla de permisos', async () => {
    const fixture = await montar(RESUMEN_COMPLETO);
    const contenido = texto(fixture);

    expect(contenido).toContain('Sin movimientos registrados');
    // La frase que distingue los dos casos. Si esto cambiara a "no hay datos" a secas, la seccion
    // vacia y la prohibida volverian a leerse igual.
    expect(contenido).toContain('se consulto y no hay nada');
  });

  it('la seccion omitida no se confunde con la vacia: aparecen las dos, cada una con su titulo', async () => {
    const fixture = await montar(RESUMEN_COMPLETO);
    const titulos = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('h2')).map(
      (h) => (h.textContent ?? '').trim(),
    );

    expect(titulos).toContain('Coberturas');
    expect(titulos).toContain('Situacion economica — sin permiso');
  });

  // -------------------------------------------------------------------------------------
  // 2. Indicadores e hitos
  // -------------------------------------------------------------------------------------

  it('muestra los indicadores con su etiqueta y su valor, y los hitos con su fecha', async () => {
    const fixture = await montar(RESUMEN_COMPLETO);
    const contenido = texto(fixture);

    expect(contenido).toContain('Turnos futuros');
    expect(contenido).toContain('Turno');
    expect(contenido).toContain('CONFIRMADO');
  });

  it('un indicador de dinero se formatea con su moneda y no se suma con ningun otro', async () => {
    const fixture = await montar({
      ...RESUMEN_COMPLETO,
      seccionesOmitidas: [],
      secciones: [
        {
          seccion: 'economia',
          indicadores: [
            { clave: 'deuda-total', etiqueta: 'Deuda', importe: 8500.5, moneda: 'ARS' },
            { clave: 'obligaciones-abiertas', etiqueta: 'Deudas abiertas', cantidad: 2 },
          ],
          hitos: [],
        },
      ],
    });

    // 8500.5 se lee "8.500,50": una columna de plata se lee comparando, y "8500.5" no se compara.
    expect(texto(fixture)).toContain('8.500,50');
  });

  it('dice explicitamente que no muestra nada clinico', async () => {
    const fixture = await montar(RESUMEN_COMPLETO);

    // Sin el cartel, quien atiende busca la historia clinica aca y concluye que el sistema no la
    // tiene.
    expect(texto(fixture)).toContain('no muestra nada clinico');
  });

  // -------------------------------------------------------------------------------------
  // 3. Las dos bajas
  // -------------------------------------------------------------------------------------

  it('la baja de la persona manda motivo y expectedVersion', async () => {
    const fixture = await montar(RESUMEN_COMPLETO);

    apretar(fixture, 'Dar de baja la ficha');
    escribirEn(fixture, '#baja-persona', 'Ficha creada por error.');
    apretar(fixture, 'Confirmar la baja de la ficha');

    const pedido = httpMock.expectOne(esBaja(BAJA_PERSONA));
    const cuerpo = pedido.request.body as Record<string, unknown>;
    expect(cuerpo['motivo']).toBe('Ficha creada por error.');
    // Sin la version, el backend no puede detectar la edicion concurrente y la baja pisaria un
    // cambio ajeno en silencio.
    expect(cuerpo['expectedVersion']).toBe(3);

    pedido.flush({ ...PACIENTE, estado: 'INACTIVO', version: 4 });
    responder(httpMock.expectOne(RESUMEN), {
      ...RESUMEN_COMPLETO,
      persona: { ...PACIENTE, estado: 'INACTIVO', esPaciente: false, version: 4 },
    });
    await estabilizar(fixture);

    // El texto de exito tiene que decir que no se borro nada: "dar de baja" en cualquier otro
    // sistema significa otra cosa.
    expect(texto(fixture)).toContain('No se borro nada');
  });

  it('con el motivo vacio no manda ninguna baja', async () => {
    const fixture = await montar(RESUMEN_COMPLETO);

    apretar(fixture, 'Dar de baja la ficha');
    // Sin escribir el motivo. Una ficha que se cierra sin explicacion es lo que una auditoria
    // busca, asi que el envio tiene que quedarse aca.
    apretar(fixture, 'Confirmar la baja de la ficha');

    httpMock.expectNone(esBaja(BAJA_PERSONA));
  });

  it('la baja del perfil deja viva a la persona, y lo dice', async () => {
    const fixture = await montar(RESUMEN_COMPLETO);

    apretar(fixture, 'Dar de baja el perfil de paciente');
    escribirEn(fixture, '#baja-perfil', 'Termino el tratamiento.');
    apretar(fixture, 'Confirmar la baja del perfil');

    const pedido = httpMock.expectOne(esBaja(BAJA_PERFIL));
    expect((pedido.request.body as Record<string, unknown>)['motivo']).toBe(
      'Termino el tratamiento.',
    );

    pedido.flush({ ...PACIENTE, esPaciente: false });
    responder(httpMock.expectOne(RESUMEN), {
      ...RESUMEN_COMPLETO,
      persona: { ...PACIENTE, esPaciente: false },
    });
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Su ficha sigue vigente');
  });

  it('una persona que no es paciente no ofrece dar de baja el perfil', async () => {
    const fixture = await montar({
      ...RESUMEN_COMPLETO,
      persona: { ...PACIENTE, esPaciente: false },
    });

    // Ofrecerlo seria ofrecer una accion sin efecto: la baja es idempotente y responderia 200 sin
    // cambiar nada, que en pantalla se lee como si hubiera pasado algo.
    expect(rotulosDeBoton(fixture)).not.toContain('Dar de baja el perfil de paciente');
  });

  it('una ficha ya dada de baja no ofrece ninguna baja y explica su estado', async () => {
    const fixture = await montar({
      ...RESUMEN_COMPLETO,
      persona: {
        ...PACIENTE,
        estado: 'INACTIVO',
        esPaciente: false,
        deactivationReason: 'Duplicada.',
      },
    });

    expect(rotulosDeBoton(fixture)).not.toContain('Dar de baja la ficha');
    expect(texto(fixture)).toContain('Duplicada.');
    // La ficha dada de baja SE SIGUE LEYENDO: es justamente donde se consulta su historico.
    expect(texto(fixture)).toContain('se sigue consultando');
  });

  // -------------------------------------------------------------------------------------
  // 4. Errores
  // -------------------------------------------------------------------------------------

  it('un 404 no habla de permisos: la persona no existe o es de otra organizacion', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(FichaDePersonaPage);
    fixture.componentRef.setInput('personaId', String(PERSONA));
    fixture.detectChanges();

    httpMock
      .expectOne(RESUMEN)
      .flush(
        { type: 'https://akine.app/problems/not-found', status: 404, detail: 'No existe.' },
        { status: 404, statusText: 'Not Found' },
      );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('no es de esta organizacion');
    expect(rotulosDeBoton(fixture)).toContain('Reintentar');
  });

  it('un personaId que no es un numero no dispara ninguna peticion', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(FichaDePersonaPage);
    fixture.componentRef.setInput('personaId', 'no-soy-un-id');
    fixture.detectChanges();
    await estabilizar(fixture);

    // Mandarla produciria un 400 sobre un parametro, y el operador leeria un error que no habla de
    // nada que el haya hecho.
    httpMock.expectNone((p: HttpRequest<unknown>) => p.url.includes('/personas/'));
    expect(texto(fixture)).toContain('no identifica a ninguna persona');
  });

  // -------------------------------------------------------------------------------------
  // Accesibilidad
  // -------------------------------------------------------------------------------------

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar(RESUMEN_COMPLETO);
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------

  async function montar(resumen: object): Promise<ComponentFixture<FichaDePersonaPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_PACIENTE_MANAGE] });

    const fixture = TestBed.createComponent(FichaDePersonaPage);
    fixture.componentRef.setInput('personaId', String(PERSONA));
    fixture.detectChanges();

    responder(httpMock.expectOne(RESUMEN), resumen);
    await estabilizar(fixture);
    return fixture;
  }

  function responder(pedido: TestRequest, cuerpo: object): void {
    pedido.flush(cuerpo);
  }

  async function estabilizar(fixture: ComponentFixture<FichaDePersonaPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function esBaja(url: string) {
    return (p: HttpRequest<unknown>) => p.method === 'DELETE' && p.url === url;
  }

  function escribirEn(
    fixture: ComponentFixture<FichaDePersonaPage>,
    selector: string,
    valor: string,
  ): void {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function apretar(fixture: ComponentFixture<FichaDePersonaPage>, rotulo: string): void {
    const boton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => (b.textContent ?? '').trim() === rotulo);
    if (boton === undefined) {
      throw new Error(`No hay ningun boton rotulado "${rotulo}".`);
    }
    boton.click();
    fixture.detectChanges();
  }

  function rotulosDeBoton(fixture: ComponentFixture<FichaDePersonaPage>): string[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).map((boton) => (boton.textContent ?? '').trim());
  }

  function texto(fixture: ComponentFixture<FichaDePersonaPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }
});
