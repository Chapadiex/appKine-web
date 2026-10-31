import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { FichaDePersonaPage } from './ficha-de-persona-page';
import { PrecargaDeFicha } from '../../services/precarga-de-ficha';
import { ResumenDePersonaResponse } from '../../../../api/generated/model/resumen-de-persona-response';
import {
  PERMISO_HC_READ,
  PERMISO_PACIENTE_MANAGE,
  PERMISO_TURNO_MANAGE,
} from '../../../../core/models/permisos';
import { FlujoDeTurnosStore } from '../../../../core/services/flujo-de-turnos.store';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { CoberturaDelHitoResponseEstadoCredencialEnum } from '../../../../api/generated/model/cobertura-del-hito-response';

const PERSONA = 7;
const RESUMEN = `/api/v1/personas/${PERSONA}/resumen`;
const BAJA_PERSONA = `/api/v1/personas/${PERSONA}`;
const BAJA_PERFIL = `/api/v1/personas/${PERSONA}/perfil-paciente`;
const PROXIMOS = (p: HttpRequest<unknown>): boolean =>
  p.url === `/api/v1/consultorios/3/turnos/personas/${PERSONA}`;

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
      // Forma real del contribuyente de B-5: la principal primero, afiliado ya enmascarado.
      seccion: 'coberturas',
      indicadores: [
        { clave: 'coberturas-vigentes', etiqueta: 'Coberturas vigentes', cantidad: 2 },
        { clave: 'credenciales-vencidas', etiqueta: 'Credenciales vencidas', cantidad: 1 },
      ],
      hitos: [
        {
          seccion: 'coberturas',
          tipo: 'COBERTURA_PRINCIPAL',
          ocurrioEn: '2026-03-01T00:00:00Z',
          titulo: 'OSDE · 310 · Afiliado ···4567 · hasta 2026-12-31',
          estado: 'VIGENTE',
          referencia: 11,
          // Desde 0.70.0 los datos viajan como campos: la pantalla no parte el titulo.
          cobertura: {
            tipo: 'FINANCIADA',
            financiadorId: 7,
            financiadorNombre: 'OSDE',
            planId: 70,
            planNombre: '310',
            afiliadoEnmascarado: '···4567',
            vigenciaDesde: '2026-03-01',
            vigenciaHasta: '2026-12-31',
            principal: true,
            estadoCredencial: CoberturaDelHitoResponseEstadoCredencialEnum.VIGENTE,
            credencialVigenciaHasta: '2027-02-28',
          },
        },
        {
          // Sin `cobertura`: un backend anterior a 0.70.0. Se degrada al titulo entero.
          seccion: 'coberturas',
          tipo: 'COBERTURA',
          ocurrioEn: '2026-01-15T00:00:00Z',
          titulo: 'IOSFA · General · Afiliado ··· · sin vencimiento',
          estado: 'CREDENCIAL_VENCIDA',
          referencia: 12,
        },
      ],
    },
    // Seccion de un contribuyente que el frontend no conoce, vacia: se pinta con la forma generica.
    { seccion: 'clases', indicadores: [], hitos: [] },
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
 *   <li><b>La pantalla no muestra nada clínico</b> y lo dice.</li>
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
    // La seccion de datos administrativos de la HC tiene su propio spec; aca solo se descarta.
    httpMock.match((p) => p.url.endsWith('/datos-administrativos'));
    // Los proximos turnos tienen su propio bloque; el resto de la ficha no depende de ellos.
    httpMock.match(PROXIMOS);
    httpMock.verify();
  });

  // -------------------------------------------------------------------------------------
  // 1. Omitida por permisos contra vacia
  // -------------------------------------------------------------------------------------

  it('una sección omitida por permisos dice que falta permiso y nombra cual', async () => {
    const fixture = await montar(RESUMEN_COMPLETO);
    const contenido = texto(fixture);

    expect(contenido).toContain('sin permiso');
    expect(contenido).toContain('No tenés permiso para ver esta sección');
    // El codigo del permiso es lo que hace accionable el aviso: sin el, quien administra el centro
    // tiene que adivinar que habilitar.
    expect(contenido).toContain('cobro:register');
  });

  it('una sección vacía dice que se consultó y no hay nada, y NO habla de permisos', async () => {
    const fixture = await montar(RESUMEN_COMPLETO);
    const contenido = texto(fixture);

    expect(contenido).toContain('Sin movimientos registrados');
    // La frase que distingue los dos casos. Si esto cambiara a "no hay datos" a secas, la seccion
    // vacia y la prohibida volverian a leerse igual.
    expect(contenido).toContain('se consultó y no hay nada');
  });

  it('la sección omitida no se confunde con la vacía: aparecen las dos, cada una con su titulo', async () => {
    const fixture = await montar(RESUMEN_COMPLETO);
    const titulos = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('h2')).map(
      (h) => (h.textContent ?? '').trim(),
    );

    expect(titulos).toContain('Coberturas');
    expect(titulos).toContain('Situación económica — sin permiso');
  });

  it('en la primera carga toma el resumen que la ruta ya pidio, sin volver a la red', async () => {
    // AKINE-LCP: la ruta lo pide apenas vuelve el refresh (PrecargaDeFicha).
    const tomar = vi
      .spyOn(TestBed.inject(PrecargaDeFicha), 'tomar')
      .mockReturnValue(of(RESUMEN_COMPLETO as ResumenDePersonaResponse));
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
    await estabilizar(fixture);

    expect(tomar).toHaveBeenCalledWith(PERSONA);
    httpMock.expectNone(RESUMEN);
    expect(texto(fixture)).toContain('Sin movimientos registrados');
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

  // -------------------------------------------------------------------------------------
  // 2b. Coberturas vigentes (B-5)
  // -------------------------------------------------------------------------------------

  it('la sección de coberturas muestra financiador, plan, afiliado enmascarado, vigencia y la credencial vencida', async () => {
    const fixture = await montar(RESUMEN_COMPLETO);
    const raiz = fixture.nativeElement as HTMLElement;
    const seccion = raiz.querySelector('[aria-labelledby="titulo-seccion-coberturas"]');
    const contenido = seccion?.textContent ?? '';

    expect(contenido).toContain('Coberturas vigentes');
    // Con campos: financiador y plan, afiliado enmascarado y vigencia salen de `cobertura`.
    expect(contenido).toContain('OSDE — 310');
    expect(contenido).not.toContain('OSDE · 310');
    expect(contenido).toContain('Afiliado ···4567');
    expect(contenido).toContain('Vigente desde el 01/03/2026 hasta el 31/12/2026 inclusive');
    expect(contenido).toContain('Credencial vigente hasta el 28/02/2027');
    expect(contenido).toContain('Principal');
    // Sin campos se degrada al titulo con las fechas legibles, y la vigencia sale de `ocurrioEn`:
    // medianoche UTC del 15 de enero es una fecha, no un instante, y no puede leerse como el 14.
    expect(contenido).toContain('IOSFA · General · Afiliado ··· · sin vencimiento');
    expect(contenido).toContain('Vigente desde el 15/01/2026');
    expect(contenido).toContain('Credencial vencida');
    expect(contenido).not.toContain('CREDENCIAL_VENCIDA');
    expect(
      seccion?.querySelector(`a[href="/pacientes/${PERSONA}/coberturas"]`)?.textContent,
    ).toContain('Ver coberturas del paciente');
  });

  it('sin coberturas vigentes dice que se atiende como particular, no "sin movimientos"', async () => {
    const fixture = await montar({
      ...RESUMEN_COMPLETO,
      secciones: [{ seccion: 'coberturas', indicadores: [], hitos: [] }],
    });
    const contenido = texto(fixture);

    expect(contenido).toContain('No tiene coberturas vigentes hoy: se atiende como particular');
    expect(contenido).not.toContain('Sin movimientos registrados');
  });

  it('un indicador de dinero se formatea con su moneda y no se suma con ningún otro', async () => {
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

  it('dice explicitamente que no muestra nada clínico', async () => {
    const fixture = await montar(RESUMEN_COMPLETO);

    // Sin el cartel, quien atiende busca la historia clinica aca y concluye que el sistema no la
    // tiene.
    expect(texto(fixture)).toContain('no muestra nada clínico');
  });

  it('con hc:read ofrece la historia clínica del paciente, sin mostrar nada de ella (D-e)', async () => {
    const fixture = await montar(RESUMEN_COMPLETO, [PERMISO_PACIENTE_MANAGE, PERMISO_HC_READ]);

    const enlace = enlaceA(fixture, 'Abrir la historia clínica');
    expect(enlace?.getAttribute('href')).toBe(`/historia-clinica/personas/${PERSONA}`);
  });

  it('sin hc:read no ofrece la historia: el backend la negaria igual (D-e)', async () => {
    const fixture = await montar(RESUMEN_COMPLETO);

    expect(enlaceA(fixture, 'Abrir la historia clínica')).toBeNull();
    expect(texto(fixture)).toContain('no muestra nada clínico');
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
    // sistema significa otra cosa. Va al aviso global y el panel se cierra (UX-12).
    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toContain('quedó dada de baja del padrón');
    expect(aviso?.descripcion).toContain('No se borro nada');
    expect((fixture.nativeElement as HTMLElement).querySelector('app-panel-lateral')).toBeNull();
  });

  it('con el motivo vacío no manda ninguna baja', async () => {
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

    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toContain('ya no tiene perfil de paciente');
    expect(aviso?.descripcion).toContain('Su ficha sigue vigente');
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
  // 3b. Turnos: el punto de entrada al flujo y los proximos
  // -------------------------------------------------------------------------------------

  it('"Nuevo turno" abre el flujo con el paciente', async () => {
    const fixture = await montar(RESUMEN_COMPLETO, [PERMISO_TURNO_MANAGE]);

    apretar(fixture, 'Nuevo turno');

    expect(TestBed.inject(FlujoDeTurnosStore).solicitud()).toEqual({
      tipo: 'nuevo',
      contexto: { origen: 'PACIENTE', personaId: PERSONA },
    });
  });

  it('sin turno:manage no ofrece "Nuevo turno"', async () => {
    const fixture = await montar(RESUMEN_COMPLETO, [PERMISO_PACIENTE_MANAGE]);

    expect(rotulosDeBoton(fixture)).not.toContain('Nuevo turno');
  });

  it('lista los próximos turnos en la zona de la sede y cada uno abre su detalle', async () => {
    const fixture = await montar(RESUMEN_COMPLETO, [PERMISO_TURNO_MANAGE]);
    const pedido = httpMock.expectOne(PROXIMOS);
    expect(pedido.request.params.get('soloFuturos')).toBe('true');
    expect(pedido.request.params.get('size')).toBe('5');
    pedido.flush({
      timezone: 'America/Argentina/Cordoba',
      turnos: [
        {
          profesionalNombre: 'Lopez, Maria',
          turno: { id: 501, inicio: '2030-03-04T12:00:00Z', ofertaNombre: 'Kinesiologia' },
        },
      ],
    });
    await estabilizar(fixture);

    const fila = (fixture.nativeElement as HTMLElement).querySelector('.proximo-turno');
    expect(fila?.textContent).toContain('Kinesiologia');
    expect(fila?.textContent).toContain('Lopez, Maria');
    // 12:00 UTC son las 09:00 en Cordoba, sea cual sea la zona del navegador.
    expect(fila?.textContent).toContain('09:00');

    fila?.querySelector('button')?.click();
    expect(TestBed.inject(FlujoDeTurnosStore).solicitud()).toEqual({
      tipo: 'detalle',
      turnoId: 501,
    });
  });

  it('sin próximos lo dice; sin permiso de turnos no inventa un error', async () => {
    const fixture = await montar(RESUMEN_COMPLETO);
    httpMock.expectOne(PROXIMOS).flush({ timezone: 'UTC', turnos: [] });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Sin turnos próximos.');

    TestBed.inject(FlujoDeTurnosStore).notificarCambio();
    fixture.detectChanges();
    httpMock.expectOne(RESUMEN).flush(RESUMEN_COMPLETO);
    httpMock
      .expectOne(PROXIMOS)
      .flush(
        { type: 'https://akine.app/problems/forbidden', status: 403 },
        { status: 403, statusText: 'F' },
      );
    await estabilizar(fixture);

    expect(texto(fixture)).not.toContain('Próximos turnos');
    expect(texto(fixture)).not.toContain('No pudimos leer los próximos turnos');
  });

  it('si falla la lectura de próximos no dice "sin turnos": lo dice y deja reintentar', async () => {
    const fixture = await montar(RESUMEN_COMPLETO);
    httpMock
      .expectOne(PROXIMOS)
      .flush({ status: 500, detail: 'Falló' }, { status: 500, statusText: 'E' });
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No pudimos leer los próximos turnos.');
    expect(texto(fixture)).not.toContain('Sin turnos próximos.');

    apretar(fixture, 'Reintentar');
    httpMock.expectOne(PROXIMOS).flush({ timezone: 'UTC', turnos: [] });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Sin turnos próximos.');
  });

  it('lo que hace el flujo se ve en el lugar: relee resumen y próximos con la ficha a la vista', async () => {
    const fixture = await montar(RESUMEN_COMPLETO);
    httpMock.expectOne(PROXIMOS).flush({ timezone: 'UTC', turnos: [] });
    await estabilizar(fixture);

    TestBed.inject(FlujoDeTurnosStore).notificarCambio();
    fixture.detectChanges();
    // La ficha sigue a la vista mientras llega la relectura: sin el "Cargando" de la entrada.
    expect(texto(fixture)).toContain('Turnos futuros');
    httpMock.expectOne(RESUMEN).flush(RESUMEN_COMPLETO);
    httpMock.expectOne(PROXIMOS).flush({ timezone: 'UTC', turnos: [] });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Turnos futuros');
  });

  // -------------------------------------------------------------------------------------
  // 4. Errores
  // -------------------------------------------------------------------------------------

  it('un 404 no habla de permisos: la persona no existe o es de otra organización', async () => {
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

    expect(texto(fixture)).toContain('no es de esta organización');
    expect(rotulosDeBoton(fixture)).toContain('Reintentar');
  });

  it('un personaId que no es un número no dispara ninguna peticion', async () => {
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

  async function montar(
    resumen: object,
    efectivos: readonly string[] = [PERMISO_PACIENTE_MANAGE],
  ): Promise<ComponentFixture<FichaDePersonaPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: efectivos });

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

  function enlaceA(fixture: ComponentFixture<FichaDePersonaPage>, rotulo: string) {
    const enlaces = (fixture.nativeElement as HTMLElement).querySelectorAll('a');
    return Array.from(enlaces).find((a) => a.textContent?.trim() === rotulo) ?? null;
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
      throw new Error(`No hay ningún botón rotulado "${rotulo}".`);
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
