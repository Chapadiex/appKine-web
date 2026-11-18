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
import { AvisosStore } from '../../../../core/services/avisos.store';

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

  it('una orden dada de baja no ofrece ninguna acción y muestra su motivo', async () => {
    const fixture = await montar({
      ordenes: [{ ...ORDEN, estado: 'INACTIVA', deactivationReason: 'Cargada por error.' }],
    });

    expect(rotulosDeBoton(fixture)).not.toContain('Dar de baja la orden');
    expect(texto(fixture)).toContain('Cargada por error.');
  });

  it('avisa del vencimiento próximo cuando el backend lo calcula', async () => {
    const fixture = await montar({ ordenes: [{ ...ORDEN, diasParaVencer: 3 }] });

    // El aviso sale de `diasParaVencer`, que se calcula al leer: no hay ningun job que mueva
    // estados y por eso nunca queda desactualizado.
    expect(texto(fixture)).toContain('Vence en 3 días');
  });

  it('una autorización rechazada sigue viva, muestra su motivo y no habilita', async () => {
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

  it('el saldo se muestra con la salvedad de que el consumo todavía no se cablea', async () => {
    const fixture = await montar({ autorizaciones: [PENDIENTE] });

    // `cantidadConsumida` vale siempre 0 en esta version, y sin la aclaracion un "0 consumidas"
    // sobre un paciente que ya vino cinco veces se lee como un dato roto.
    expect(texto(fixture)).toContain('20 de 20');
  });

  it('marca la fila que tiene consumos a revisar, y solo esa', async () => {
    const fixture = await montar({
      autorizaciones: [PENDIENTE, { ...PENDIENTE, id: 99, numero: 'AUT-99', consumosARevisar: 2 }],
    });

    const filas = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '[aria-label="Listado de autorizaciones"] tbody tr',
      ),
    ).map((fila) => fila.textContent ?? '');
    expect(filas).toHaveLength(2);
    expect(filas[0]).not.toContain('a revisar');
    expect(filas[1]).toContain('2 consumos a revisar');
  });

  it('cada listado sigue el patrón de UX-14: búsqueda, resultados, pie y vacío', async () => {
    const fixture = await montar({
      ordenes: [ORDEN],
      autorizaciones: [PENDIENTE, { ...PENDIENTE, id: 99, numero: 'AUT-99' }],
    });
    const raiz = fixture.nativeElement as HTMLElement;
    const autorizaciones = raiz.querySelector('section[aria-labelledby="titulo-autorizaciones"]');

    expect(autorizaciones?.querySelector('.filtros-barra__resultados')?.textContent?.trim()).toBe(
      '2 autorizaciones',
    );
    expect(autorizaciones?.querySelector('app-paginacion')?.textContent).toContain(
      'Mostrando 1–2 de 2',
    );
    expect(raiz.querySelector('caption')).toBeNull();
    // Las altas van arriba a la derecha, en la cabecera, no dentro de cada tarjeta.
    expect(autorizaciones?.textContent).not.toContain('Registrar una autorización');
    expect(raiz.querySelector('app-cabecera-de-ficha')?.textContent).toContain(
      'Registrar una autorización',
    );

    const busqueda = raiz.querySelector('#autorizaciones-busqueda') as HTMLInputElement;
    busqueda.value = 'aut-99';
    busqueda.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(autorizaciones?.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(autorizaciones?.querySelector('.filtros-barra__resultados')?.textContent?.trim()).toBe(
      '1 autorización',
    );

    busqueda.value = 'no existe';
    busqueda.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const vacio = autorizaciones?.querySelector('app-estado-vacio');
    expect(vacio?.textContent).toContain('No encontramos autorizaciones');
    (vacio?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(autorizaciones?.querySelectorAll('tbody tr')).toHaveLength(2);
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

  it('aprobar manda la acción APROBAR con la cantidad recortada y la versión', async () => {
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

    // UX-12: el panel se cierra y el resultado va al aviso global.
    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toBe('Autorización aprobada');
    expect(aviso?.descripcion).toContain('Aprobada es terminal');
    expect((fixture.nativeElement as HTMLElement).querySelector('app-panel-lateral')).toBeNull();
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
    escribirEn(fixture, `#resolver-motivo-${PENDIENTE.id}`, 'Sin cobertura para esa práctica.');
    apretar(fixture, 'Registrar la respuesta');

    const pedido = httpMock.expectOne(esResolver());
    const cuerpo = pedido.request.body as Record<string, unknown>;
    expect(cuerpo['accion']).toBe('RECHAZAR');
    expect(cuerpo['motivo']).toBe('Sin cobertura para esa práctica.');
    // Mandar una cantidad en un rechazo seria decir que se autorizo algo.
    expect(cuerpo['cantidadAutorizada']).toBeUndefined();

    pedido.flush({ ...PENDIENTE, estadoAutorizacion: 'RECHAZADA' });
    responderCarga(fixture, {
      autorizaciones: [{ ...PENDIENTE, estadoAutorizacion: 'RECHAZADA' }],
    });
    await estabilizar(fixture);
  });

  it('una autorización APROBADA no ofrece resolverse otra vez: es terminal', async () => {
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
        detail: 'Una autorización APROBADA no admite la acción APROBAR.',
        estadoActual: 'APROBADA',
        accion: 'APROBAR',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);

    // Es tambien la respuesta a la aprobacion concurrente: el segundo en llegar encuentra la
    // autorizacion ya resuelta.
    // Error general del panel: arriba del formulario, con la salida.
    const alerta = (fixture.nativeElement as HTMLElement).querySelector('form > app-alerta');
    expect(alerta?.textContent).toContain('No pudimos registrar la respuesta');
    expect(alerta?.textContent).toContain('no admite la acción APROBAR');
    expect(rotulosDeBoton(fixture)).toContain('Recargar');
  });

  it('el 409 de solapamiento resalta la autorización que se pisa', async () => {
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
    // El conflicto va pegado a la vigencia, como advertencia, con la salida a la fila que estorba.
    const raiz = fixture.nativeElement as HTMLElement;
    const alerta = raiz.querySelector(`#resolver-superpuesta-${PENDIENTE.id}`);
    expect(alerta?.getAttribute('tipo')).toBe('advertencia');
    expect(raiz.querySelector('form > app-alerta[tipo="error"]')).toBeNull();
    apretar(fixture, 'Ver la autorización');
    expect(raiz.querySelector('app-panel-lateral')).toBeNull();
    expect(raiz.querySelectorAll('.fila-senalada').length).toBe(1);
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

  it('el alta de autorización solo ofrece PENDIENTE y APROBADA como estado inicial', async () => {
    const fixture = await montar();

    apretar(fixture, 'Registrar una autorización');
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

  it('elegir la opción vacía desvincula, y no da de baja el documento', async () => {
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
    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toBe('Documento desvinculado');
    expect(aviso?.descripcion).toContain('El archivo sigue estando en la ficha');
  });

  it('corregir una orden manda la versión y dice que el paciente no se cambia', async () => {
    const fixture = await montar({ ordenes: [{ ...ORDEN, vencida: true }] });

    apretar(fixture, 'Corregir');
    expect(texto(fixture)).toContain('vencida si se corrige');
    // Refactor UX/UI del 28/10/2026: el formulario se abre en un panel lateral, fuera de la tabla,
    // y la fila queda marcada.
    const raiz = fixture.nativeElement as HTMLElement;
    const campo = raiz.querySelector(`#editar-orden-hasta-${ORDEN.id}`)!;
    expect(campo.closest('dialog.panel-lateral')).not.toBeNull();
    expect(campo.closest('table')).toBeNull();
    expect(raiz.querySelector('tr.fila--seleccionada')?.textContent).toContain(ORDEN.numero);
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

  it('corregir una autorización no ofrece cambiar cobertura, práctica ni estado', async () => {
    const fixture = await montar({ autorizaciones: [PENDIENTE] });

    apretar(fixture, 'Corregir');
    const panel = texto(fixture);
    // Las dos primeras son otra autorizacion; el estado se mueve con la respuesta del financiador.
    expect(panel).toContain('no se corrigen acá');

    escribirEn(fixture, `#editar-aut-numero-${PENDIENTE.id}`, 'AUT-9');
    apretar(fixture, 'Guardar la autorización');

    const pedido = httpMock.expectOne(esEdicionDeAutorizacion());
    const cuerpo = pedido.request.body as Record<string, unknown>;
    expect(cuerpo['numero']).toBe('AUT-9');
    expect(cuerpo['coberturaId']).toBeUndefined();
    expect(cuerpo['expectedVersion']).toBe(0);

    pedido.flush({ ...PENDIENTE, numero: 'AUT-9', version: 1 });
    responderCarga(fixture, { autorizaciones: [{ ...PENDIENTE, numero: 'AUT-9' }] });
    await estabilizar(fixture);
  });

  it('el comprobante de una autorización se elige entre los documentos ya cargados', async () => {
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

    expect(texto(fixture)).toContain('No podés dar de alta ni editar');
    expect(rotulosDeBoton(fixture)).toContain('Reintentar');
  });

  it('el 403 del catalogo clínico no tira la pantalla: carga sin prácticas y dice por que', async () => {
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

    // DP-36: leer el catalogo exige `catalogo:read`. Un rol sin el no es una falla de la pantalla.
    httpMock
      .expectOne(esListado(CATALOGO))
      .flush(
        { type: 'https://akine.app/problems/forbidden', status: 403 },
        { status: 403, statusText: 'Forbidden' },
      );
    httpMock.expectOne(FICHA).flush(PACIENTE);
    httpMock.expectOne(esListado(ORDENES)).flush([]);
    httpMock.expectOne(esListado(AUTORIZACIONES)).flush([]);
    httpMock.expectOne(esListado(COBERTURAS)).flush([COBERTURA]);
    httpMock.expectOne(esListado(ADJUNTOS)).flush({ content: [] });
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No tenés permiso para consultar el catalogo clínico');
    expect(rotulosDeBoton(fixture)).not.toContain('Reintentar');
  });

  it('con el motivo vacío no manda la baja de la orden', async () => {
    const fixture = await montar({ ordenes: [ORDEN] });

    apretar(fixture, 'Dar de baja la orden');
    apretar(fixture, 'Confirmar la baja de la orden');

    httpMock.expectNone(esBajaDeOrden());
  });

  it('la baja de la autorización aclara que no es rechazar ni vencer', async () => {
    const fixture = await montar({ autorizaciones: [PENDIENTE] });

    apretar(fixture, 'Dar de baja la autorización');
    expect(texto(fixture)).toContain('NO es rechazar y NO es vencer');

    escribirEn(fixture, `#baja-autorizacion-${PENDIENTE.id}`, 'Cargada por error.');
    apretar(fixture, 'Confirmar la baja de la autorización');

    const pedido = httpMock.expectOne(esBajaDeAutorizacion());
    expect((pedido.request.body as Record<string, unknown>)['reason']).toBe('Cargada por error.');

    pedido.flush({});
    responderCarga(fixture, {});
    await estabilizar(fixture);
  });

  // -------------------------------------------------------------------------------------
  // 4. Elegibilidad
  // -------------------------------------------------------------------------------------

  it('la lista vacía con elegible=true explica cual de las situaciones es', async () => {
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
    expect(contenido).toContain('No le falta ningún papel');
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
    expect(contenido).toContain('Orden médica: FALTA');
    expect(contenido).toContain('Autorización: cumplido');
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

  it('sin cobertura o sin práctica no consulta nada', async () => {
    const fixture = await montar();

    apretar(fixture, 'Consultar');

    httpMock.expectNone(esElegibilidad());
    expect(texto(fixture)).toContain('Elegí la cobertura');
  });

  it('sin ninguna cobertura activa lo dice y enlaza a cargarla', async () => {
    const fixture = await montar({ coberturas: [] });

    // Sin coberturas los dos selectores quedarian vacios y el operador no tendria como saber por
    // que no puede trabajar.
    expect(texto(fixture)).toContain('no tiene ninguna cobertura activa cargada');
    expect(enlaces(fixture)).toContain('Cargar una cobertura');
  });

  // -------------------------------------------------------------------------------------
  // B-4 (DP-23): situacion de la orden e historial de la autorizacion
  // -------------------------------------------------------------------------------------

  it('la orden muestra la situación que deriva el backend y las sesiones consumidas', async () => {
    const fixture = await montar({
      ordenes: [{ ...ORDEN, situacion: 'EN_CURSO', sesionesConsumidas: 3 }],
    });
    const contenido = texto(fixture);

    expect(contenido).toContain('En curso: ya tiene sesiones consumidas');
    expect(contenido).toContain('3 de 10 consumidas');
  });

  it(
    'el historial se lee paginado, del mas viejo al mas nuevo, y dice si esta vencida',
    async () => {
      const fixture = await montar({ autorizaciones: [PENDIENTE] });

      apretar(fixture, 'Historial');
      const primera = httpMock.expectOne(esHistorial(PENDIENTE.id));
      expect(primera.request.params.get('page')).toBe('0');
      expect(primera.request.params.get('size')).toBe('10');
      primera.flush({
        autorizacionId: PENDIENTE.id,
        estadoActual: 'APROBADA',
        activa: true,
        vencida: true,
        vencidaDesde: '2027-01-01',
        page: 0,
        size: 10,
        totalElements: 21,
        totalPages: 3,
        content: [
          {
            id: 1,
            tipo: 'ALTA',
            estadoNuevo: 'PENDIENTE',
            ocurridoEn: '2026-08-01T13:00:00Z',
            detalle: 'Reconstruido al crear el historial',
          },
          {
            id: 2,
            tipo: 'CONSUMO',
            estadoAnterior: 'APROBADA',
            estadoNuevo: 'APROBADA',
            cantidad: 1,
            actorCuentaId: 42,
            ocurridoEn: '2026-08-10T13:00:00Z',
          },
        ],
      });
      await estabilizar(fixture);

      const contenido = texto(fixture);
      expect(contenido).toContain('Historial de la autorización AUT-1');
      expect(contenido).toContain('Nace como pendiente de respuesta');
      expect(contenido).toContain('Reconstruido al crear el historial');
      expect(contenido).toContain('Consumo de una sesión');
      expect(contenido).toContain('Cantidad: 1');
      expect(contenido).toContain('Cuenta 42');
      expect(contenido).toContain('Vencida');
      // El pie estandar de UX-14: "Mostrando 1–10 de 21" y los botones de pagina.
      expect(contenido).toContain('Mostrando 1–10 de 21');
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);

      (
        Array.from(
          (fixture.nativeElement as HTMLElement).querySelectorAll('.paginacion button'),
        ) as HTMLButtonElement[]
      )
        .find((b) => b.textContent?.includes('Página siguiente'))
        ?.click();
      fixture.detectChanges();
      const segunda = httpMock.expectOne(esHistorial(PENDIENTE.id));
      expect(segunda.request.params.get('page')).toBe('1');
      expect(segunda.request.params.get('size')).toBe('10');
      segunda.flush({ page: 1, size: 10, totalElements: 21, totalPages: 3, content: [] });
      await estabilizar(fixture);

      apretar(fixture, 'Cerrar el historial');
      expect(texto(fixture)).not.toContain('Historial de la autorización AUT-1');
    },
    TIMEOUT_AXE,
  );

  it('el saldo y los consumos se abren por fila y una reversión relee solo el listado', async () => {
    const fixture = await montar({ autorizaciones: [PENDIENTE] });
    const base = `/api/v1/autorizaciones/${PENDIENTE.id}`;

    apretar(fixture, 'Saldo y consumos');
    httpMock.expectOne(esListado(`${base}/saldo`)).flush({ cantidadAutorizada: 20, saldo: 19 });
    httpMock
      .expectOne(esListado(`${base}/movimientos`))
      .flush([{ id: 1, tipo: 'CONSUMO', tipoOrigen: 'SESION', referenciaOrigen: 70 }]);
    httpMock.expectOne(esListado(`${base}/alertas`)).flush([]);
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Saldo y consumos de la autorización AUT-1');

    apretar(fixture, 'Revertir el consumo #1');
    escribirEn(fixture, '#revertir-consumo-1', 'Error de carga');
    apretar(fixture, 'Confirmar la reversión');
    httpMock
      .expectOne((p) => p.method === 'POST' && p.url === `${base}/reversiones`)
      .flush({ id: 2, tipo: 'REVERSION', movimientoOrigenId: 1 });
    httpMock.expectOne(esListado(`${base}/saldo`)).flush({ cantidadAutorizada: 20, saldo: 20 });
    httpMock.expectOne(esListado(`${base}/movimientos`)).flush([]);
    httpMock.expectOne(esListado(`${base}/alertas`)).flush([]);
    // Solo el listado de autorizaciones: la pantalla no vuelve a "cargando" y el panel sigue abierto.
    httpMock.expectOne(esListado(AUTORIZACIONES)).flush([{ ...PENDIENTE, saldo: 20 }]);
    await estabilizar(fixture);
    expect(TestBed.inject(AvisosStore).avisos()[0]?.titulo).toBe('Consumo #1 revertido');

    apretar(fixture, 'Cerrar el saldo');
    expect(texto(fixture)).not.toContain('Saldo y consumos de la autorización AUT-1');
  });

  // -------------------------------------------------------------------------------------
  // Ramas de error, datos opcionales y modos alternativos
  // -------------------------------------------------------------------------------------

  const ORDEN_MINIMA = {
    id: 501,
    personaId: PERSONA,
    estado: 'ACTIVA',
    profesionalEmisor: 'Dr. Zeta',
  };
  const AUTORIZACION_MINIMA = {
    id: 602,
    personaId: PERSONA,
    estado: 'ACTIVA',
    estadoAutorizacion: 'PENDIENTE',
    numero: 'AUT-MIN',
  };

  it('ordena cada columna de los dos listados aunque haya filas sin datos opcionales', async () => {
    const fixture = await montar({
      ordenes: [ORDEN, ORDEN_MINIMA],
      autorizaciones: [PENDIENTE, { ...AUTORIZACION_MINIMA, numero: undefined }],
    });
    const raiz = fixture.nativeElement as HTMLElement;

    const botones = Array.from(raiz.querySelectorAll('button.tabla__orden')) as HTMLButtonElement[];
    expect(botones).toHaveLength(9);
    for (const boton of botones) {
      boton.click();
      fixture.detectChanges();
      boton.click();
      fixture.detectChanges();
    }

    // La orden sin numero se lista con un guion, no con un hueco.
    expect(raiz.querySelectorAll('[aria-label="Listado de autorizaciones"] tbody tr')).toHaveLength(
      2,
    );
    expect(texto(fixture)).toContain('—');
    expect(raiz.querySelector('th[aria-sort="descending"]')).not.toBeNull();
  });

  it('una autorización dada de baja lo dice y sólo ofrece las acciones de lectura', async () => {
    const fixture = await montar({
      autorizaciones: [{ ...PENDIENTE, estado: 'INACTIVA', diasParaVencer: 2 }],
    });

    expect(texto(fixture)).toContain('dada de baja');
    expect(texto(fixture)).toContain('Vence en 2 días');
    expect(rotulosDeBoton(fixture)).not.toContain('Corregir');
    expect(rotulosDeBoton(fixture)).toContain('Historial');
  });

  it('sin un id válido en la dirección no sale nada a la red', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_PACIENTE_MANAGE] });

    const fixture = TestBed.createComponent(OrdenesYAutorizacionesPage);
    fixture.componentRef.setInput('personaId', 'abc');
    fixture.detectChanges();
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('La dirección no identifica a ninguna persona');
    apretar(fixture, 'Reintentar');

    // Cada accion se corta antes de pedir nada: el id de la URL no es un numero.
    const pagina = fixture.componentInstance as unknown as Record<
      string,
      (...a: unknown[]) => void
    >;
    pagina['enviarOrden']();
    pagina['enviarAutorizacion']();
    pagina['enviarEdicionDeOrden']();
    pagina['enviarEdicionDeAutorizacion']();
    pagina['enviarResolucion']();
    pagina['confirmarBajaDeOrden']('x');
    pagina['confirmarBajaDeAutorizacion']('x');
    pagina['enviarDocumento']();
    pagina['consultarElegibilidad']();
    pagina['releerAutorizaciones']();
    pagina['alternarHistorial'](PENDIENTE);
    pagina['paginaDeHistorial'](1);
    // Filas sin id: ningun panel se abre.
    pagina['abrirEdicionDeOrden']({});
    pagina['abrirEdicionDeAutorizacion']({});
    pagina['abrirResolucion']({});
    pagina['abrirBajaDeOrden']({});
    pagina['alternarHistorial']({});
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('app-panel-lateral')).toBeNull();
  });

  it('sin contexto de trabajo la salida es elegirlo, no reintentar', async () => {
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

    httpMock.expectOne(esListado(ORDENES)).flush([]);
    httpMock.expectOne(esListado(AUTORIZACIONES)).flush([]);
    httpMock.expectOne(esListado(COBERTURAS)).flush([]);
    httpMock.expectOne(esListado(CATALOGO)).flush({ content: [] });
    httpMock.expectOne(esListado(ADJUNTOS)).flush({ content: [] });
    httpMock
      .expectOne(FICHA)
      .flush(
        { type: 'https://akine.app/problems/missing-tenant-context', status: 400 },
        { status: 400, statusText: 'Bad Request' },
      );
    await estabilizar(fixture);

    expect(enlaces(fixture)).toContain('Elegir contexto de trabajo');
    expect(rotulosDeBoton(fixture)).not.toContain('Reintentar');
  });

  it('un fallo del catalogo que no es 403 tira la carga entera', async () => {
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
    responderCarga(fixture, { catalogo: 'falla' });
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No pudimos leer las órdenes y autorizaciones');
    expect(rotulosDeBoton(fixture)).toContain('Reintentar');
  });

  it('el alta de autorización sin permiso de catalogo avisa que no hay prácticas', async () => {
    const fixture = await montar({ catalogo: 'prohibido', adjuntos: {} });

    apretar(fixture, 'Registrar una autorización');

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('app-panel-lateral')?.textContent,
    ).toContain('No tenés permiso para consultar el catalogo clínico');
  });

  it('el rechazo de la consulta de elegibilidad va arriba de su formulario', async () => {
    const fixture = await montar();

    escribirEn(fixture, '#elegibilidad-fecha', '2026-09-03');
    consultarElegibilidad(fixture);
    const pedido = httpMock.expectOne(esElegibilidad());
    expect(pedido.request.params.get('fecha')).toBe('2026-09-03');
    pedido.flush(
      { type: 'https://akine.app/problems/not-found', status: 404 },
      { status: 404, statusText: 'Not Found' },
    );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No pudimos consultar qué le falta');
  });

  it('el alta de orden con todos los campos los manda, y sus rechazos nombran la salida', async () => {
    const fixture = await montar();

    apretar(fixture, 'Registrar una orden');
    escribirEn(fixture, '#orden-emisor', '  Dr. Lopez  ');
    escribirEn(fixture, '#orden-matricula', 'MP 1');
    escribirEn(fixture, '#orden-numero', 'OM-9');
    escribirEn(fixture, '#orden-emision', '2026-09-01');
    escribirEn(fixture, '#orden-sesiones', '10');
    escribirEn(fixture, '#orden-desde', '2026-09-02');
    escribirEn(fixture, '#orden-hasta', '2026-12-31');
    elegirEn(fixture, '#orden-cobertura', String(COBERTURA.id));
    escribirEn(fixture, '#orden-indicacion', 'Lumbalgia');
    escribirEn(fixture, '#orden-observaciones', 'Urgente');
    apretar(fixture, 'Registrar orden');

    const primero = httpMock.expectOne(esAltaDeOrden());
    expect(primero.request.body).toEqual({
      profesionalEmisor: 'Dr. Lopez',
      matriculaEmisor: 'MP 1',
      numero: 'OM-9',
      fechaEmision: '2026-09-01',
      vigenciaDesde: '2026-09-02',
      vigenciaHasta: '2026-12-31',
      sesionesPrescriptas: 10,
      coberturaId: COBERTURA.id,
      indicacion: 'Lumbalgia',
      observaciones: 'Urgente',
    });
    primero.flush(
      { type: 'https://akine.app/problems/persona-sin-perfil-paciente', status: 409 },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);
    expect(enlaces(fixture)).toContain('Ir a la ficha para activar el perfil');

    apretar(fixture, 'Registrar orden');
    httpMock
      .expectOne(esAltaDeOrden())
      .flush(
        { type: 'https://akine.app/problems/documento-numero-taken', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);
    const raiz = fixture.nativeElement as HTMLElement;
    expect(raiz.querySelector('#orden-numero-en-uso')?.textContent).toContain(
      'Ese número ya está en uso',
    );
    expect(raiz.querySelector('#orden-numero')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('sin fecha de emisión no manda el alta de orden', async () => {
    const fixture = await montar();

    apretar(fixture, 'Registrar una orden');
    escribirEn(fixture, '#orden-emisor', 'Dr. Lopez');
    apretar(fixture, 'Registrar orden');

    httpMock.expectNone(esAltaDeOrden());
    expect(texto(fixture)).toContain('La fecha de emision es obligatoria');
  });

  it('el alta de autorización valida, manda el cuerpo y muestra cada conflicto donde va', async () => {
    const fixture = await montar({
      ordenes: [ORDEN, { ...ORDEN_MINIMA, numero: '' }],
      autorizaciones: [{ ...PENDIENTE, id: 601, numero: 'AUT-2', estadoAutorizacion: 'APROBADA' }],
    });

    apretar(fixture, 'Registrar una autorización');
    apretar(fixture, 'Registrar autorizacion');
    httpMock.expectNone((p) => p.method === 'POST' && p.url === AUTORIZACIONES);
    const contenido = texto(fixture);
    expect(contenido).toContain('Elegí la cobertura');
    expect(contenido).toContain('Elegí la práctica');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#autorizacion-numero-error'),
    ).not.toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#autorizacion-desde-error'),
    ).not.toBeNull();
    // El selector de orden rotula cada una por numero, o por quien la firmo si no tiene.
    expect(
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('#autorizacion-orden option'),
      ).map((o) => o.textContent ?? ''),
    ).toEqual(expect.arrayContaining([expect.stringContaining('N° OM-1')]));

    escribirEn(fixture, '#autorizacion-numero', ' AUT-3 ');
    elegirEn(fixture, '#autorizacion-cobertura', String(COBERTURA.id));
    elegirEn(fixture, '#autorizacion-practica', String(PRACTICA.id));
    elegirEn(fixture, '#autorizacion-orden', String(ORDEN.id));
    escribirEn(fixture, '#autorizacion-cantidad', '8');
    escribirEn(fixture, '#autorizacion-desde', '2026-09-01');
    escribirEn(fixture, '#autorizacion-hasta', '2026-10-01');
    elegirEn(fixture, '#autorizacion-estado', 'APROBADA');
    escribirEn(fixture, '#autorizacion-observaciones', 'Por fax');
    apretar(fixture, 'Registrar autorizacion');

    const esAlta = (p: HttpRequest<unknown>) => p.method === 'POST' && p.url === AUTORIZACIONES;
    const primero = httpMock.expectOne(esAlta);
    expect(primero.request.body).toEqual({
      numero: 'AUT-3',
      coberturaId: COBERTURA.id,
      practicaId: PRACTICA.id,
      ordenMedicaId: ORDEN.id,
      cantidadAutorizada: 8,
      vigenciaDesde: '2026-09-01',
      vigenciaHasta: '2026-10-01',
      estadoInicial: 'APROBADA',
      observaciones: 'Por fax',
    });
    expect(rotulosDeBoton(fixture)).toContain('Guardando...');
    primero.flush(
      { type: 'https://akine.app/problems/persona-sin-perfil-paciente', status: 409 },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);
    expect(enlaces(fixture)).toContain('Ir a la ficha para activar el perfil');

    apretar(fixture, 'Registrar autorizacion');
    httpMock
      .expectOne(esAlta)
      .flush(
        { type: 'https://akine.app/problems/documento-numero-taken', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#autorizacion-numero-en-uso'),
    ).not.toBeNull();

    apretar(fixture, 'Registrar autorizacion');
    httpMock.expectOne(esAlta).flush(
      {
        type: 'https://akine.app/problems/autorizacion-superpuesta',
        status: 409,
        autorizacionExistenteId: 601,
      },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#autorizacion-superpuesta'),
    ).not.toBeNull();
    apretar(fixture, 'Ver la autorización');
    expect((fixture.nativeElement as HTMLElement).querySelector('app-panel-lateral')).toBeNull();
    expect(texto(fixture)).toContain('Es la que se pisa');
  });

  it('corregir una orden sin datos opcionales manda versión 0 y ofrece recargar ante el 409', async () => {
    const fixture = await montar({ ordenes: [ORDEN_MINIMA] });

    apretar(fixture, 'Corregir');
    expect(valorDe(fixture, `#editar-orden-numero-${ORDEN_MINIMA.id}`)).toBe('');
    apretar(fixture, 'Guardar la orden');

    const esEdicion = (p: HttpRequest<unknown>) =>
      p.method === 'PUT' && p.url === `${ORDENES}/${ORDEN_MINIMA.id}`;
    const pedido = httpMock.expectOne(esEdicion);
    expect(pedido.request.body).toEqual({ profesionalEmisor: 'Dr. Zeta', expectedVersion: 0 });
    pedido.flush(
      { type: 'https://akine.app/problems/concurrent-modification', status: 409 },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('No pudimos corregir la orden');
    expect(rotulosDeBoton(fixture)).toContain('Recargar');

    apretar(fixture, 'Guardar la orden');
    httpMock
      .expectOne(esEdicion)
      .flush(
        { type: 'https://akine.app/problems/documento-numero-taken', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        `#editar-orden-numero-en-uso-${ORDEN_MINIMA.id}`,
      ),
    ).not.toBeNull();
  });

  it('corregir una autorización con datos opcionales y sus dos conflictos', async () => {
    const fixture = await montar({
      autorizaciones: [{ ...AUTORIZACION_MINIMA, ordenMedicaId: ORDEN.id }],
    });

    apretar(fixture, 'Corregir');
    apretar(fixture, 'Guardar la autorización');

    const esEdicion = (p: HttpRequest<unknown>) =>
      p.method === 'PUT' && p.url === `${AUTORIZACIONES}/${AUTORIZACION_MINIMA.id}`;
    const pedido = httpMock.expectOne(esEdicion);
    expect(pedido.request.body).toEqual({
      numero: 'AUT-MIN',
      ordenMedicaId: ORDEN.id,
      expectedVersion: 0,
    });
    pedido.flush(
      { type: 'https://akine.app/problems/concurrent-modification', status: 409 },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('No pudimos corregir la autorización');
    expect(rotulosDeBoton(fixture)).toContain('Recargar');

    apretar(fixture, 'Guardar la autorización');
    httpMock
      .expectOne(esEdicion)
      .flush(
        { type: 'https://akine.app/problems/documento-numero-taken', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        `#editar-aut-numero-en-uso-${AUTORIZACION_MINIMA.id}`,
      ),
    ).not.toBeNull();
  });

  it('aprobar una autorización sin cantidad ni vigencias no inventa ningún valor', async () => {
    const fixture = await montar({ autorizaciones: [AUTORIZACION_MINIMA] });

    apretar(fixture, 'Respuesta del financiador');
    apretar(fixture, 'Registrar la respuesta');

    const pedido = httpMock.expectOne(
      (p) => p.method === 'POST' && p.url === `${AUTORIZACIONES}/${AUTORIZACION_MINIMA.id}/estado`,
    );
    expect(pedido.request.body).toEqual({ accion: 'APROBAR', expectedVersion: 0 });
    pedido.flush({ ...AUTORIZACION_MINIMA, estadoAutorizacion: 'APROBADA' });
    responderCarga(fixture, {});
    await estabilizar(fixture);
  });

  it('vincular documentos: el rechazo queda en el panel y el adjunto sin título usa su archivo', async () => {
    const sinTitulo = { id: 901, nombreArchivo: 'escaneo.jpg' };
    const fixture = await montar({
      ordenes: [ORDEN],
      autorizaciones: [PENDIENTE],
      adjuntos: { content: [sinTitulo] },
    });

    apretar(fixture, 'Escaneo');
    expect(texto(fixture)).toContain('escaneo.jpg');
    elegirEn(fixture, `#doc-orden-${ORDEN.id}`, String(sinTitulo.id));
    apretar(fixture, 'Guardar el vinculo');
    httpMock
      .expectOne(esVincularOrden())
      .flush(
        { type: 'https://akine.app/problems/adjunto-inactivo', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('No pudimos vincular el documento');

    apretar(fixture, 'Comprobante');
    expect(texto(fixture)).toContain('escaneo.jpg');
    apretar(fixture, 'Guardar el vinculo');
    httpMock
      .expectOne(esVincularAutorizacion())
      .flush(
        { type: 'https://akine.app/problems/not-found', status: 404 },
        { status: 404, statusText: 'Not Found' },
      );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('No pudimos vincular el documento');
  });

  it('el rechazo de una baja queda en su panel, para la orden y para la autorización', async () => {
    const fixture = await montar({ ordenes: [ORDEN], autorizaciones: [PENDIENTE] });

    apretar(fixture, 'Dar de baja la orden');
    escribirEn(fixture, `#baja-orden-${ORDEN.id}`, 'Repetida');
    apretar(fixture, 'Confirmar la baja de la orden');
    const baja = httpMock.expectOne(esBajaDeOrden());
    expect((baja.request.body as Record<string, unknown>)['reason']).toBe('Repetida');
    baja.flush(
      { type: 'https://akine.app/problems/orden-already-inactive', status: 409 },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('No pudimos dar de baja la orden');

    apretar(fixture, 'Dar de baja la autorización');
    escribirEn(fixture, `#baja-autorizacion-${PENDIENTE.id}`, 'Repetida');
    apretar(fixture, 'Confirmar la baja de la autorización');
    httpMock
      .expectOne(esBajaDeAutorizacion())
      .flush(
        { type: 'https://akine.app/problems/autorizacion-already-inactive', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('No pudimos dar de baja la autorización');
  });

  it('la baja de la orden confirmada avisa que no se borró nada', async () => {
    const fixture = await montar({ ordenes: [ORDEN] });

    apretar(fixture, 'Dar de baja la orden');
    escribirEn(fixture, `#baja-orden-${ORDEN.id}`, 'Repetida');
    apretar(fixture, 'Confirmar la baja de la orden');
    httpMock.expectOne(esBajaDeOrden()).flush({});
    responderCarga(fixture, {});
    await estabilizar(fixture);

    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toBe('Orden dada de baja');
  });

  it('el historial que falla ofrece reintentar, y la respuesta tardía se descarta', async () => {
    const fixture = await montar({ autorizaciones: [PENDIENTE] });

    apretar(fixture, 'Historial');
    httpMock
      .expectOne(esHistorial(PENDIENTE.id))
      .flush(
        { type: 'https://akine.app/problems/not-found', status: 404 },
        { status: 404, statusText: 'Not Found' },
      );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('No pudimos leer el historial');

    const panel = (fixture.nativeElement as HTMLElement).querySelector('app-panel-lateral')!;
    (
      Array.from(panel.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Reintentar',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    // Sin pagina ni totales, sin id ni fecha en el hecho, y con motivo.
    httpMock.expectOne(esHistorial(PENDIENTE.id)).flush({
      content: [{ tipo: 'RESOLUCION', estadoNuevo: 'RECHAZADA', motivo: 'Sin cupo' }],
    });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Sin fecha');
    expect(texto(fixture)).toContain('Motivo: Sin cupo');

    // Volver a apretar "Historial" lo cierra.
    apretar(fixture, 'Historial');
    expect(texto(fixture)).not.toContain('Motivo: Sin cupo');

    // Una respuesta (o un error) que llega con el panel cerrado no lo vuelve a abrir.
    apretar(fixture, 'Historial');
    const tardio = httpMock.expectOne(esHistorial(PENDIENTE.id));
    apretar(fixture, 'Cerrar el historial');
    tardio.flush({ content: [] });
    apretar(fixture, 'Historial');
    const tardioConError = httpMock.expectOne(esHistorial(PENDIENTE.id));
    apretar(fixture, 'Saldo y consumos');
    tardioConError.flush(
      { type: 'https://akine.app/problems/not-found', status: 404 },
      { status: 404, statusText: 'Not Found' },
    );
    const base = `/api/v1/autorizaciones/${PENDIENTE.id}`;
    httpMock.expectOne(esListado(`${base}/saldo`)).flush({ cantidadAutorizada: 20, saldo: 20 });
    httpMock.expectOne(esListado(`${base}/movimientos`)).flush([]);
    httpMock.expectOne(esListado(`${base}/alertas`)).flush([]);
    await estabilizar(fixture);
    expect(texto(fixture)).not.toContain('No pudimos leer el historial');

    // "Saldo y consumos" otra vez cierra el panel; paginar sin historial abierto no pide nada.
    apretar(fixture, 'Saldo y consumos');
    (fixture.componentInstance as unknown as Record<string, (p: number) => void>)[
      'paginaDeHistorial'
    ](1);
    expect((fixture.nativeElement as HTMLElement).querySelector('app-panel-lateral')).toBeNull();
  });

  it('la relectura de autorizaciones que falla avisa con un reintento', async () => {
    const fixture = await montar({ autorizaciones: [PENDIENTE] });

    (fixture.componentInstance as unknown as Record<string, () => void>)['releerAutorizaciones']();
    httpMock
      .expectOne(esListado(AUTORIZACIONES))
      .flush({ type: 'about:blank', status: 500 }, { status: 500, statusText: 'Server Error' });
    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toBe('No pudimos releer las autorizaciones');
    aviso?.accion?.ejecutar();
    httpMock.expectOne(esListado(AUTORIZACIONES)).flush([PENDIENTE]);
  });

  function esHistorial(autorizacionId: number) {
    return (p: HttpRequest<unknown>) =>
      p.method === 'GET' && p.url === `${AUTORIZACIONES}/${autorizacionId}/historial`;
  }

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
    /** Respuesta cruda del listado de adjuntos. Por defecto, una pagina con `ADJUNTO`. */
    readonly adjuntos?: object;
    /** `prohibido` responde 403 (DP-36); `falla` responde 500 y tira la carga. */
    readonly catalogo?: 'prohibido' | 'falla';
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
    httpMock.expectOne(esListado(ADJUNTOS)).flush(
      datos.adjuntos ?? {
        content: [ADJUNTO],
        page: 0,
        size: 100,
        totalElements: 1,
        totalPages: 1,
      },
    );
    // El catalogo va ULTIMO: si falla, el `forkJoin` cancela lo que quede en vuelo.
    const catalogo = httpMock.expectOne(esListado(CATALOGO));
    if (datos.catalogo === undefined) {
      catalogo.flush({ content: [PRACTICA], page: 0, size: 200, totalElements: 1, totalPages: 1 });
    } else {
      const status = datos.catalogo === 'prohibido' ? 403 : 500;
      catalogo.flush(
        { type: 'about:blank', status, detail: 'No.' },
        { status, statusText: 'Error' },
      );
    }
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
      throw new Error(`No hay ningún botón rotulado "${rotulo}".`);
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
