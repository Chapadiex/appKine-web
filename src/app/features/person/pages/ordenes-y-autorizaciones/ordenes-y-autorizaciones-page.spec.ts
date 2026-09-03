import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { OrdenesYAutorizacionesPage } from './ordenes-y-autorizaciones-page';
import { PERMISO_PACIENTE_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const PERSONA = 7;
const FICHA = `/api/v1/personas/${PERSONA}`;
const ORDENES = `/api/v1/personas/${PERSONA}/ordenes`;
const AUTORIZACIONES = `/api/v1/personas/${PERSONA}/autorizaciones`;
const COBERTURAS = `/api/v1/personas/${PERSONA}/coberturas`;
const ADJUNTOS = `/api/v1/personas/${PERSONA}/adjuntos`;
const ELEGIBILIDAD = `/api/v1/personas/${PERSONA}/elegibilidad`;
const CATALOGO = '/api/v1/catalogos/practicas';

const PACIENTE = { id: PERSONA, apellido: 'Gomez', nombre: 'Ana', esPaciente: true, version: 1 };

const COBERTURA = {
  id: 400,
  tipo: 'FINANCIADA',
  estado: 'ACTIVA',
  financiadorNombre: 'OSDE',
  planNombre: '210',
  vigente: true,
};

const PRACTICA = { id: 55, name: 'Kinesiologia', tipo: 'PRACTICA', estado: 'ACTIVO' };

const ADJUNTO = { id: 900, titulo: 'Orden escaneada', nombreArchivo: 'orden.pdf' };

const ORDEN = {
  id: 500,
  personaId: PERSONA,
  estado: 'ACTIVA',
  profesionalEmisor: 'Dra. Perez',
  matriculaEmisor: '12345',
  numero: 'OM-1',
  fechaEmision: '2026-08-01',
  vigenciaDesde: '2026-08-01',
  vigenciaHasta: '2026-12-31',
  sesionesPrescriptas: 10,
  vigente: true,
  vencida: false,
  version: 0,
};

const PENDIENTE = {
  id: 600,
  personaId: PERSONA,
  estado: 'ACTIVA',
  estadoAutorizacion: 'PENDIENTE',
  numero: 'AUT-1',
  coberturaId: COBERTURA.id,
  practicaId: PRACTICA.id,
  cantidadAutorizada: 20,
  cantidadConsumida: 0,
  saldo: 20,
  vigenciaDesde: '2026-08-01',
  vigenciaHasta: '2026-12-31',
  vigente: true,
  vencida: false,
  agotada: false,
  habilita: false,
  version: 0,
};

/**
 * Spec de ordenes, autorizaciones y elegibilidad (M17, AKINE-03.06).
 *
 * <p>Cubre las cuatro cosas que hacen distinta a esta pantalla de un CRUD, y las cuatro son
 * distinciones que si se pierden producen un dato equivocado:
 *
 * <ol>
 *   <li><b>Vencida, rechazada y dada de baja no son lo mismo.</b> Una orden vencida se sigue
 *       pudiendo corregir; una autorizacion rechazada sigue viva y explica por que no se atendio.</li>
 *   <li><b>Resolver manda una ACCION</b>, y al aprobar la cantidad del formulario <b>pisa</b> lo
 *       pedido: es la autorizacion parcial. Los campos vienen precargados por eso.</li>
 *   <li><b>APROBADA y RECHAZADA son terminales</b>: no se ofrece ninguna accion sobre ellas.</li>
 *   <li><b>La elegibilidad vacia con `elegible = true` es el caso normal</b>, y la pantalla dice
 *       cual de las tres situaciones es.</li>
 * </ol>
 */
describe('OrdenesYAutorizacionesPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrdenesYAutorizacionesPage],
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
  // 1. Las distinciones de estado
  // -------------------------------------------------------------------------------------

  it('explica arriba que vencido, rechazado y dado de baja no son lo mismo', async () => {
    const fixture = await montar();

    expect(texto(fixture)).toContain('Vencido, rechazado y dado de baja no son lo mismo');
  });

  it('una orden vencida sigue siendo corregible y no se lee como dada de baja', async () => {
    const fixture = await montar({
      ordenes: [{ ...ORDEN, vencida: true, vigente: false, diasParaVencer: undefined }],
    });
    const contenido = texto(fixture);

    expect(contenido).toContain('Vencida');
    expect(contenido).not.toContain('Dada de baja');
    // "Un documento vencido no desaparece": bloquear la correccion obligaria a dar de baja y
    // recargar para arreglar una fecha mal tipeada.
    expect(rotulosDeBoton(fixture)).toContain('Corregir');
  });

  it('una orden dada de baja no ofrece ninguna accion y muestra su motivo', async () => {
    const fixture = await montar({
      ordenes: [{ ...ORDEN, estado: 'INACTIVA', deactivationReason: 'Cargada por error.' }],
    });

    expect(rotulosDeBoton(fixture)).not.toContain('Dar de baja la orden');
    expect(texto(fixture)).toContain('Cargada por error.');
  });

  it('avisa del vencimiento proximo cuando el backend lo calcula', async () => {
    const fixture = await montar({ ordenes: [{ ...ORDEN, diasParaVencer: 3 }] });

    // El aviso sale de `diasParaVencer`, que se calcula al leer: no hay ningun job que mueva
    // estados y por eso nunca queda desactualizado.
    expect(texto(fixture)).toContain('Vence en 3 dias');
  });

  it('una autorizacion rechazada sigue viva, muestra su motivo y no habilita', async () => {
    const fixture = await montar({
      autorizaciones: [
        {
          ...PENDIENTE,
          estadoAutorizacion: 'RECHAZADA',
          motivo: 'Falta la orden del especialista.',
        },
      ],
    });
    const contenido = texto(fixture);

    expect(contenido).toContain('Rechazada');
    // Es lo que explica por que no se pudo atender: sin el motivo, el mostrador no sabe que
    // corregir para volver a presentarla.
    expect(contenido).toContain('Falta la orden del especialista.');
    expect(contenido).toContain('No habilita');
  });

  it('el saldo se muestra con la salvedad de que el consumo todavia no se cablea', async () => {
    const fixture = await montar({ autorizaciones: [PENDIENTE] });

    // `cantidadConsumida` vale siempre 0 en esta version, y sin la aclaracion un "0 consumidas"
    // sobre un paciente que ya vino cinco veces se lee como un dato roto.
    expect(texto(fixture)).toContain('20 de 20');
  });

  // -------------------------------------------------------------------------------------
  // 2. Resolver: accion, no estado destino
  // -------------------------------------------------------------------------------------

  it('el panel de resolucion viene precargado con lo pedido, porque aprobar lo pisa', async () => {
    const fixture = await montar({ autorizaciones: [PENDIENTE] });

    apretar(fixture, 'Respuesta del financiador');

    // Si estuviera vacio, aprobar tal cual lo pedido exigiria tipearlo de nuevo, y aprobar una
    // parcial —seis de veinte— seria una edicion posterior que nadie se acuerda de hacer.
    expect(valorDe(fixture, `#resolver-cantidad-${PENDIENTE.id}`)).toBe('20');
    expect(texto(fixture)).toContain('pisa lo que se pidio');
  });

  it('aprobar manda la accion APROBAR con la cantidad recortada y la version', async () => {
    const fixture = await montar({ autorizaciones: [PENDIENTE] });

    apretar(fixture, 'Respuesta del financiador');
    escribirEn(fixture, `#resolver-cantidad-${PENDIENTE.id}`, '6');
    apretar(fixture, 'Registrar la respuesta');

    const pedido = httpMock.expectOne(esResolver());
    const cuerpo = pedido.request.body as Record<string, unknown>;
    expect(cuerpo['accion']).toBe('APROBAR');
    // La autorizacion parcial: el financiador otorgo seis donde se pidieron veinte.
    expect(cuerpo['cantidadAutorizada']).toBe(6);
    expect(cuerpo['expectedVersion']).toBe(0);

    pedido.flush({ ...PENDIENTE, estadoAutorizacion: 'APROBADA', cantidadAutorizada: 6 });
    responderCarga(fixture, {
      autorizaciones: [{ ...PENDIENTE, estadoAutorizacion: 'APROBADA', cantidadAutorizada: 6 }],
    });
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Aprobada es terminal');
  });

  it('observar sin motivo no manda nada: sin motivo el mostrador no sabe que corregir', async () => {
    const fixture = await montar({ autorizaciones: [PENDIENTE] });

    apretar(fixture, 'Respuesta del financiador');
    elegirEn(fixture, `#resolver-accion-${PENDIENTE.id}`, 'OBSERVAR');
    apretar(fixture, 'Registrar la respuesta');

    httpMock.expectNone(esResolver());
    expect(texto(fixture)).toContain('hay que declarar el motivo');
  });

  it('rechazar manda motivo y NO manda la cantidad, que solo significa algo al aprobar', async () => {
    const fixture = await montar({ autorizaciones: [PENDIENTE] });

    apretar(fixture, 'Respuesta del financiador');
    elegirEn(fixture, `#resolver-accion-${PENDIENTE.id}`, 'RECHAZAR');
    escribirEn(fixture, `#resolver-motivo-${PENDIENTE.id}`, 'Sin cobertura para esa practica.');
    apretar(fixture, 'Registrar la respuesta');

    const pedido = httpMock.expectOne(esResolver());
    const cuerpo = pedido.request.body as Record<string, unknown>;
    expect(cuerpo['accion']).toBe('RECHAZAR');
    expect(cuerpo['motivo']).toBe('Sin cobertura para esa practica.');
    // Mandar una cantidad en un rechazo seria decir que se autorizo algo.
    expect(cuerpo['cantidadAutorizada']).toBeUndefined();

    pedido.flush({ ...PENDIENTE, estadoAutorizacion: 'RECHAZADA' });
    responderCarga(fixture, {
      autorizaciones: [{ ...PENDIENTE, estadoAutorizacion: 'RECHAZADA' }],
    });
    await estabilizar(fixture);
  });

  it('una autorizacion APROBADA no ofrece resolverse otra vez: es terminal', async () => {
    const fixture = await montar({
      autorizaciones: [{ ...PENDIENTE, estadoAutorizacion: 'APROBADA', habilita: true }],
    });

    // Ofrecerlo sugeriria que una decision tomada se puede deshacer, que es justamente lo que no
    // se puede: el saldo ya contado desapareceria retroactivamente.
    expect(rotulosDeBoton(fixture)).not.toContain('Respuesta del financiador');
    expect(texto(fixture)).toContain('Habilita a atender');
  });

  it('el 409 de transicion no permitida usa el detalle del backend y ofrece recargar', async () => {
    const fixture = await montar({ autorizaciones: [PENDIENTE] });

    apretar(fixture, 'Respuesta del financiador');
    apretar(fixture, 'Registrar la respuesta');

    httpMock.expectOne(esResolver()).flush(
      {
        type: 'https://akine.app/problems/autorizacion-transicion-no-permitida',
        status: 409,
        detail: 'Una autorizacion APROBADA no admite la accion APROBAR.',
        estadoActual: 'APROBADA',
        accion: 'APROBAR',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);

    // Es tambien la respuesta a la aprobacion concurrente: el segundo en llegar encuentra la
    // autorizacion ya resuelta.
    expect(texto(fixture)).toContain('no admite la accion APROBAR');
    expect(rotulosDeBoton(fixture)).toContain('Recargar');
  });

  it('el 409 de solapamiento resalta la autorizacion que se pisa', async () => {
    const otra = { ...PENDIENTE, id: 601, numero: 'AUT-2', estadoAutorizacion: 'APROBADA' };
    const fixture = await montar({ autorizaciones: [PENDIENTE, otra] });

    apretar(fixture, 'Respuesta del financiador');
    apretar(fixture, 'Registrar la respuesta');
    httpMock.expectOne(esResolver()).flush(
      {
        type: 'https://akine.app/problems/autorizacion-superpuesta',
        status: 409,
        detail: 'Se pisa.',
        autorizacionExistenteId: 601,
      },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Es la que se pisa');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.fila-senalada').length).toBe(
      1,
    );
  });

  // -------------------------------------------------------------------------------------
  // 3. Altas y vinculo de documentos
  // -------------------------------------------------------------------------------------

  it('el alta de orden manda el emisor como texto libre y no exige matricula', async () => {
    const fixture = await montar();

    apretar(fixture, 'Registrar una orden');
    escribirEn(fixture, '#orden-emisor', 'Dr. Lopez');
    escribirEn(fixture, '#orden-emision', '2026-09-01');
    apretar(fixture, 'Registrar orden');

    const pedido = httpMock.expectOne(esAltaDeOrden());
    const cuerpo = pedido.request.body as Record<string, unknown>;
    expect(cuerpo['profesionalEmisor']).toBe('Dr. Lopez');
    // La matricula es opcional a proposito: resuelve el documento ilegible sin rechazar la carga.
    expect(cuerpo['matriculaEmisor']).toBeUndefined();
    // Sin cobertura, la orden vale para cualquiera: una prescripcion la firma un medico.
    expect(cuerpo['coberturaId']).toBeUndefined();

    pedido.flush(ORDEN);
    responderCarga(fixture, { ordenes: [ORDEN] });
    await estabilizar(fixture);
  });

  it('sin emisor no manda el alta de orden', async () => {
    const fixture = await montar();

    apretar(fixture, 'Registrar una orden');
    escribirEn(fixture, '#orden-emision', '2026-09-01');
    apretar(fixture, 'Registrar orden');

    httpMock.expectNone(esAltaDeOrden());
    expect(texto(fixture)).toContain('Escribi quien firmo la orden');
  });

  it('el alta de autorizacion solo ofrece PENDIENTE y APROBADA como estado inicial', async () => {
    const fixture = await montar();

    apretar(fixture, 'Registrar una autorizacion');
    const opciones = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '#autorizacion-estado option',
      ) as NodeListOf<HTMLOptionElement>,
    ).map((o) => o.value);

    // Observada y rechazada son la RESPUESTA a un pedido: ofrecerlas al cargar dejaria construir
    // cualquier estado desde el cliente.
    expect(opciones).toEqual(['PENDIENTE', 'APROBADA']);
  });

  it('vincular un documento no sube nada: elige entre los que ya tiene la persona', async () => {
    const fixture = await montar({ ordenes: [ORDEN] });

    apretar(fixture, 'Escaneo');
    expect(texto(fixture)).toContain('no se sube nada');
    elegirEn(fixture, `#doc-orden-${ORDEN.id}`, String(ADJUNTO.id));
    apretar(fixture, 'Guardar el vinculo');

    const pedido = httpMock.expectOne(esVincularOrden());
    expect((pedido.request.body as Record<string, unknown>)['adjuntoId']).toBe(ADJUNTO.id);

    pedido.flush({ ...ORDEN, adjuntoId: ADJUNTO.id });
    responderCarga(fixture, { ordenes: [{ ...ORDEN, adjuntoId: ADJUNTO.id }] });
    await estabilizar(fixture);
  });

  it('elegir la opcion vacia desvincula, y no da de baja el documento', async () => {
    const fixture = await montar({ ordenes: [{ ...ORDEN, adjuntoId: ADJUNTO.id }] });

    apretar(fixture, 'Escaneo');
    elegirEn(fixture, `#doc-orden-${ORDEN.id}`, '');
    apretar(fixture, 'Guardar el vinculo');

    const pedido = httpMock.expectOne(esVincularOrden());
    expect((pedido.request.body as Record<string, unknown>)['adjuntoId']).toBeUndefined();

    pedido.flush(ORDEN);
    responderCarga(fixture, { ordenes: [ORDEN] });
    await estabilizar(fixture);

    // El archivo sigue en la ficha: desvincular no es dar de baja el documento.
    expect(texto(fixture)).toContain('El archivo sigue estando en la ficha');
  });

  it('corregir una orden manda la version y dice que el paciente no se cambia', async () => {
    const fixture = await montar({ ordenes: [{ ...ORDEN, vencida: true }] });

    apretar(fixture, 'Corregir');
    expect(texto(fixture)).toContain('vencida si se corrige');
    escribirEn(fixture, `#editar-orden-hasta-${ORDEN.id}`, '2027-01-31');
    apretar(fixture, 'Guardar la orden');

    const pedido = httpMock.expectOne(esEdicionDeOrden());
    const cuerpo = pedido.request.body as Record<string, unknown>;
    expect(pedido.request.method).toBe('PUT');
    expect(cuerpo['vigenciaHasta']).toBe('2027-01-31');
    expect(cuerpo['expectedVersion']).toBe(0);
    // La cobertura no viaja: mudar una orden de paciente reescribiria quien presento que papel.
    expect(cuerpo['coberturaId']).toBeUndefined();

    pedido.flush({ ...ORDEN, vigenciaHasta: '2027-01-31', version: 1 });
    responderCarga(fixture, { ordenes: [ORDEN] });
    await estabilizar(fixture);
  });

  it('corregir una autorizacion no ofrece cambiar cobertura, practica ni estado', async () => {
    const fixture = await montar({ autorizaciones: [PENDIENTE] });

    apretar(fixture, 'Corregir');
    const panel = texto(fixture);
    // Las dos primeras son otra autorizacion; el estado se mueve con la respuesta del financiador.
    expect(panel).toContain('no se corrigen aca');

    escribirEn(fixture, `#editar-aut-numero-${PENDIENTE.id}`, 'AUT-9');
    apretar(fixture, 'Guardar la autorizacion');

    const pedido = httpMock.expectOne(esEdicionDeAutorizacion());
    const cuerpo = pedido.request.body as Record<string, unknown>;
    expect(cuerpo['numero']).toBe('AUT-9');
    expect(cuerpo['coberturaId']).toBeUndefined();
    expect(cuerpo['expectedVersion']).toBe(0);

    pedido.flush({ ...PENDIENTE, numero: 'AUT-9', version: 1 });
    responderCarga(fixture, { autorizaciones: [{ ...PENDIENTE, numero: 'AUT-9' }] });
    await estabilizar(fixture);
  });

  it('el comprobante de una autorizacion se elige entre los documentos ya cargados', async () => {
    const fixture = await montar({ autorizaciones: [PENDIENTE] });

    apretar(fixture, 'Comprobante');
    elegirEn(fixture, `#doc-aut-${PENDIENTE.id}`, String(ADJUNTO.id));
    apretar(fixture, 'Guardar el vinculo');

    const pedido = httpMock.expectOne(esVincularAutorizacion());
    expect((pedido.request.body as Record<string, unknown>)['adjuntoId']).toBe(ADJUNTO.id);

    pedido.flush({ ...PENDIENTE, adjuntoId: ADJUNTO.id });
    responderCarga(fixture, { autorizaciones: [{ ...PENDIENTE, adjuntoId: ADJUNTO.id }] });
    await estabilizar(fixture);
  });

  it('un fallo al cargar la pantalla la deja en error y ofrece reintentar', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(OrdenesYAutorizacionesPage);
    fixture.componentRef.setInput('personaId', String(PERSONA));
    fixture.detectChanges();

    // Las seis lecturas van en un forkJoin: si una falla, la pantalla no se muestra a medias.
    // Mostrarla con los selectores vacios seria peor que un error, porque el operador intentaria
    // trabajar y no entenderia por que no puede.
    httpMock.expectOne(FICHA).flush(PACIENTE);
    httpMock.expectOne(esListado(AUTORIZACIONES)).flush([]);
    httpMock.expectOne(esListado(COBERTURAS)).flush([]);
    httpMock.expectOne(esListado(CATALOGO)).flush({ content: [] });
    httpMock.expectOne(esListado(ADJUNTOS)).flush({ content: [] });
    // La que falla se responde ULTIMA a proposito: el `forkJoin` cancela las que quedan en vuelo
    // en cuanto una falla, y responderlas despues da "Cannot flush a cancelled request".
    httpMock
      .expectOne(esListado(ORDENES))
      .flush(
        { type: 'https://akine.app/problems/forbidden', status: 403, detail: 'Sin permiso.' },
        { status: 403, statusText: 'Forbidden' },
      );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No podes dar de alta ni editar');
    expect(rotulosDeBoton(fixture)).toContain('Reintentar');
  });

  it('con el motivo vacio no manda la baja de la orden', async () => {
    const fixture = await montar({ ordenes: [ORDEN] });

    apretar(fixture, 'Dar de baja la orden');
    apretar(fixture, 'Confirmar la baja de la orden');

    httpMock.expectNone(esBajaDeOrden());
  });

  it('la baja de la autorizacion aclara que no es rechazar ni vencer', async () => {
    const fixture = await montar({ autorizaciones: [PENDIENTE] });

    apretar(fixture, 'Dar de baja la autorizacion');
    expect(texto(fixture)).toContain('NO es rechazar y NO es vencer');

    escribirEn(fixture, `#baja-autorizacion-${PENDIENTE.id}`, 'Cargada por error.');
    apretar(fixture, 'Confirmar la baja de la autorizacion');

    const pedido = httpMock.expectOne(esBajaDeAutorizacion());
    expect((pedido.request.body as Record<string, unknown>)['reason']).toBe('Cargada por error.');

    pedido.flush({});
    responderCarga(fixture, {});
    await estabilizar(fixture);
  });

  // -------------------------------------------------------------------------------------
  // 4. Elegibilidad
  // -------------------------------------------------------------------------------------

  it('la lista vacia con elegible=true explica cual de las situaciones es', async () => {
    const fixture = await montar();

    consultarElegibilidad(fixture);
    httpMock.expectOne(esElegibilidad()).flush({
      elegible: true,
      motivo: 'SIN_CONVENIO_VIGENTE',
      requisitos: [],
      fecha: '2026-09-03',
    });
    await estabilizar(fixture);

    const contenido = texto(fixture);
    expect(contenido).toContain('No le falta ningun papel');
    // Sin esto, "todo en orden" sobre un paciente sin convenio se lee como que el sistema no
    // verifico nada, y alguien sale a buscar la autorizacion igual.
    expect(contenido).toContain('no tiene convenio vigente con ese plan');
    expect(contenido).toContain('No es un error de carga');
  });

  it('un requisito faltante no se muestra como una falla, sino como lo que hay que conseguir', async () => {
    const fixture = await montar();

    consultarElegibilidad(fixture);
    httpMock.expectOne(esElegibilidad()).flush({
      elegible: false,
      convenioNombre: 'Convenio OSDE 2026',
      requisitos: [
        { tipo: 'ORDEN', cumplido: false, detalle: 'No hay orden vigente para esa fecha.' },
        { tipo: 'AUTORIZACION', cumplido: true, referenciaId: 600, saldo: 20 },
      ],
    });
    await estabilizar(fixture);

    const contenido = texto(fixture);
    expect(contenido).toContain('Le falta documentacion');
    expect(contenido).toContain('Orden medica: FALTA');
    expect(contenido).toContain('Autorizacion: cumplido');
    expect(contenido).toContain('Convenio OSDE 2026');
  });

  it('el tope mensual viaja informativo y la pantalla lo dice', async () => {
    const fixture = await montar();

    consultarElegibilidad(fixture);
    httpMock
      .expectOne(esElegibilidad())
      .flush({ elegible: true, requisitos: [], limiteSesionesMensual: 12 });
    await estabilizar(fixture);

    // Verificarlo exige contar sesiones ya atendidas, que es el consumo que esta version no cablea.
    expect(texto(fixture)).toContain('Es informativo');
  });

  it('sin cobertura o sin practica no consulta nada', async () => {
    const fixture = await montar();

    apretar(fixture, 'Consultar');

    httpMock.expectNone(esElegibilidad());
    expect(texto(fixture)).toContain('Elegi la cobertura');
  });

  it('sin ninguna cobertura activa lo dice y enlaza a cargarla', async () => {
    const fixture = await montar({ coberturas: [] });

    // Sin coberturas los dos selectores quedarian vacios y el operador no tendria como saber por
    // que no puede trabajar.
    expect(texto(fixture)).toContain('no tiene ninguna cobertura activa cargada');
    expect(enlaces(fixture)).toContain('Cargar una cobertura');
  });

  // -------------------------------------------------------------------------------------
  // Accesibilidad
  // -------------------------------------------------------------------------------------

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar({ ordenes: [ORDEN], autorizaciones: [PENDIENTE] });
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------

  interface Datos {
    readonly ordenes?: object[];
    readonly autorizaciones?: object[];
    readonly coberturas?: object[];
  }

  async function montar(datos: Datos = {}): Promise<ComponentFixture<OrdenesYAutorizacionesPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_PACIENTE_MANAGE] });

    const fixture = TestBed.createComponent(OrdenesYAutorizacionesPage);
    fixture.componentRef.setInput('personaId', String(PERSONA));
    fixture.detectChanges();

    responderCarga(fixture, datos);
    await estabilizar(fixture);
    return fixture;
  }

  /**
   * Responde las seis lecturas que la pantalla dispara en paralelo.
   *
   * <p>Van todas juntas a proposito: el componente las pide con un `forkJoin`, y responder solo
   * algunas dejaria la pantalla en estado de carga para siempre — que es exactamente el sintoma
   * que un `httpMock.verify()` tiene que delatar.
   */
  function responderCarga(
    fixture: ComponentFixture<OrdenesYAutorizacionesPage>,
    datos: Datos,
  ): void {
    httpMock.expectOne(FICHA).flush(PACIENTE);
    httpMock.expectOne(esListado(ORDENES)).flush(datos.ordenes ?? []);
    httpMock.expectOne(esListado(AUTORIZACIONES)).flush(datos.autorizaciones ?? []);
    httpMock.expectOne(esListado(COBERTURAS)).flush(datos.coberturas ?? [COBERTURA]);
    httpMock.expectOne(esListado(CATALOGO)).flush({
      content: [PRACTICA],
      page: 0,
      size: 200,
      totalElements: 1,
      totalPages: 1,
    });
    httpMock.expectOne(esListado(ADJUNTOS)).flush({
      content: [ADJUNTO],
      page: 0,
      size: 100,
      totalElements: 1,
      totalPages: 1,
    });
    fixture.detectChanges();
  }

  function consultarElegibilidad(fixture: ComponentFixture<OrdenesYAutorizacionesPage>): void {
    elegirEn(fixture, '#elegibilidad-cobertura', String(COBERTURA.id));
    elegirEn(fixture, '#elegibilidad-practica', String(PRACTICA.id));
    apretar(fixture, 'Consultar');
  }

  async function estabilizar(fixture: ComponentFixture<OrdenesYAutorizacionesPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function esListado(url: string) {
    return (p: HttpRequest<unknown>) => p.method === 'GET' && p.url === url;
  }

  function esAltaDeOrden() {
    return (p: HttpRequest<unknown>) => p.method === 'POST' && p.url === ORDENES;
  }

  function esBajaDeOrden() {
    return (p: HttpRequest<unknown>) => p.method === 'DELETE' && p.url === `${ORDENES}/${ORDEN.id}`;
  }

  function esEdicionDeOrden() {
    return (p: HttpRequest<unknown>) => p.method === 'PUT' && p.url === `${ORDENES}/${ORDEN.id}`;
  }

  function esEdicionDeAutorizacion() {
    return (p: HttpRequest<unknown>) =>
      p.method === 'PUT' && p.url === `${AUTORIZACIONES}/${PENDIENTE.id}`;
  }

  function esVincularAutorizacion() {
    return (p: HttpRequest<unknown>) =>
      p.method === 'POST' && p.url === `${AUTORIZACIONES}/${PENDIENTE.id}/documento`;
  }

  function esVincularOrden() {
    return (p: HttpRequest<unknown>) =>
      p.method === 'POST' && p.url === `${ORDENES}/${ORDEN.id}/documento`;
  }

  function esResolver() {
    return (p: HttpRequest<unknown>) =>
      p.method === 'POST' && p.url === `${AUTORIZACIONES}/${PENDIENTE.id}/estado`;
  }

  function esBajaDeAutorizacion() {
    return (p: HttpRequest<unknown>) =>
      p.method === 'DELETE' && p.url === `${AUTORIZACIONES}/${PENDIENTE.id}`;
  }

  function esElegibilidad() {
    return (p: HttpRequest<unknown>) => p.method === 'GET' && p.url === ELEGIBILIDAD;
  }

  function valorDe(
    fixture: ComponentFixture<OrdenesYAutorizacionesPage>,
    selector: string,
  ): string {
    return (fixture.nativeElement.querySelector(selector) as HTMLInputElement).value;
  }

  function elegirEn(
    fixture: ComponentFixture<OrdenesYAutorizacionesPage>,
    selector: string,
    valor: string,
  ): void {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLSelectElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function escribirEn(
    fixture: ComponentFixture<OrdenesYAutorizacionesPage>,
    selector: string,
    valor: string,
  ): void {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function apretar(fixture: ComponentFixture<OrdenesYAutorizacionesPage>, rotulo: string): void {
    const boton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => (b.textContent ?? '').trim() === rotulo);
    if (boton === undefined) {
      throw new Error(`No hay ningun boton rotulado "${rotulo}".`);
    }
    boton.click();
    fixture.detectChanges();
  }

  function rotulosDeBoton(fixture: ComponentFixture<OrdenesYAutorizacionesPage>): string[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).map((boton) => (boton.textContent ?? '').trim());
  }

  function enlaces(fixture: ComponentFixture<OrdenesYAutorizacionesPage>): string[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>,
    ).map((enlace) => (enlace.textContent ?? '').trim());
  }

  function texto(fixture: ComponentFixture<OrdenesYAutorizacionesPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }
});
