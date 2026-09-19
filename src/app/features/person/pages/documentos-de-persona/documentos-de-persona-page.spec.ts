import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { DocumentosDePersonaPage } from './documentos-de-persona-page';
import { PERMISO_PACIENTE_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const PERSONA = 7;
const FICHA = `/api/v1/personas/${PERSONA}`;
const ADJUNTOS = `/api/v1/personas/${PERSONA}/adjuntos`;

const ACTIVA = {
  id: PERSONA,
  apellido: 'Gomez',
  nombre: 'Ana',
  esPaciente: true,
  estado: 'ACTIVO',
  version: 1,
};

const CREDENCIAL = {
  id: 900,
  personaId: PERSONA,
  categoria: 'CREDENCIAL_COBERTURA',
  titulo: 'Credencial OSDE',
  nombreArchivo: 'credencial.pdf',
  contentType: 'application/pdf',
  tamanoBytes: 2_097_152,
  subidoEn: '2026-09-01T10:00:00Z',
  estado: 'DISPONIBLE',
  estadoCicloDeVida: 'ACTIVO',
  version: 0,
};

/**
 * Spec de la documentacion administrativa (M25, AKINE-03.02).
 *
 * <p>Cubre lo que decide comportamiento:
 *
 * <ol>
 *   <li><b>La subida viaja como multipart con la categoria en la query</b>, que es como lo declara
 *       el contrato, y sin archivo no sale nada.</li>
 *   <li><b>Los dos motivos de rechazo del archivo dan mensajes distintos.</b> "Elegi otro formato"
 *       y "elegi un archivo mas chico" son dos instrucciones distintas: con un mensaje generico el
 *       operador reintenta el mismo archivo.</li>
 *   <li><b>Un contenido no disponible se avisa ANTES de tocar descargar</b>, y el boton queda
 *       deshabilitado: el listado ya trae el dato.</li>
 *   <li><b>La baja exige motivo</b> y dice que el archivo no se borra.</li>
 *   <li><b>Una ficha dada de baja no ofrece subir</b>, y sigue listando lo que ya tiene.</li>
 * </ol>
 */
describe('DocumentosDePersonaPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DocumentosDePersonaPage],
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
  // 1. Listado
  // -------------------------------------------------------------------------------------

  it('muestra el titulo, la categoria en castellano y el tamano legible', async () => {
    const fixture = await montar([CREDENCIAL]);
    const contenido = texto(fixture);

    expect(contenido).toContain('Credencial OSDE');
    expect(contenido).toContain('Credencial de cobertura');
    // 2 MiB exactos. "2097152" no le dice nada a nadie parado en un mostrador.
    expect(contenido).toContain('2 MB');
  });

  it('avisa que aca no va nada clinico y que un adjunto no reemplaza un dato', async () => {
    const fixture = await montar([CREDENCIAL]);
    const contenido = texto(fixture);

    // Las dos confusiones mas caras del modulo, las dos arriba y no en letra chica.
    expect(contenido).toContain('Aca no va nada clinico');
    expect(contenido).toContain('no reemplaza un dato cargado');
  });

  it('el filtro de dados de baja manda incluirDadosDeBaja y el de vigentes lo omite', async () => {
    const fixture = await montar([CREDENCIAL]);

    elegirEn(fixture, '#documentos-filtro-estado', 'TODOS');
    const conBajas = httpMock.expectOne(esListado());
    expect(conBajas.request.urlWithParams).toContain('incluirDadosDeBaja=true');
    conBajas.flush(pagina([CREDENCIAL]));
    await estabilizar(fixture);

    elegirEn(fixture, '#documentos-filtro-estado', 'VIGENTES');
    const soloVigentes = httpMock.expectOne(esListado());
    // Omitido y no `false`: el backend ya tiene ese default, y mandarlo explicito diria lo mismo
    // con una URL distinta que despues cuesta reconocer en un log.
    expect(soloVigentes.request.urlWithParams).not.toContain('incluirDadosDeBaja');
    soloVigentes.flush(pagina([CREDENCIAL]));
    await estabilizar(fixture);
  });

  it('una lista vacia no es un error y dice que es normal', async () => {
    const fixture = await montar([]);

    expect(texto(fixture)).toContain('No hay documentos cargados');
    expect(texto(fixture)).toContain('cuando el paciente los trae');
  });

  // -------------------------------------------------------------------------------------
  // 2. Subida
  // -------------------------------------------------------------------------------------

  it('la subida viaja como multipart, con la categoria y el titulo en la query', async () => {
    const fixture = await montar([]);

    abrirSubidaCon(fixture, 'DOCUMENTO_IDENTIDAD', 'DNI frente');

    const pedido = httpMock.expectOne(esSubida());
    expect(pedido.request.body instanceof FormData).toBe(true);
    expect(pedido.request.urlWithParams).toContain('categoria=DOCUMENTO_IDENTIDAD');
    expect(pedido.request.urlWithParams).toContain('titulo=DNI');

    pedido.flush({
      ...CREDENCIAL,
      id: 901,
      categoria: 'DOCUMENTO_IDENTIDAD',
      titulo: 'DNI frente',
    });
    responderListado(httpMock.expectOne(esListado()), []);
    await estabilizar(fixture);

    // El exito repite la regla que produce el error mas caro del modulo.
    expect(texto(fixture)).toContain('no completa ningun dato de la ficha');
  });

  it('sin archivo elegido no manda nada', async () => {
    const fixture = await montar([]);

    apretar(fixture, 'Subir un documento');
    elegirEn(fixture, '#subida-categoria', 'OTRO');
    // Sin pasar por el input de archivo. El backend responderia 400 sobre un parametro, y el
    // operador leeria un error que no nombra el campo que le falta.
    apretar(fixture, 'Subir');

    httpMock.expectNone(esSubida());
  });

  it('sin categoria elegida no manda nada y marca el campo', async () => {
    const fixture = await montar([]);

    apretar(fixture, 'Subir un documento');
    adjuntarArchivo(fixture);
    apretar(fixture, 'Subir');

    httpMock.expectNone(esSubida());
    expect(texto(fixture)).toContain('Elegi la categoria del documento');
  });

  it('un archivo rechazado por TAMANO no dice que el formato este mal', async () => {
    const fixture = await montar([]);
    abrirSubidaCon(fixture, 'OTRO', '');

    httpMock.expectOne(esSubida()).flush(
      {
        type: 'https://akine.app/problems/archivo-no-aceptado',
        status: 400,
        detail: 'Archivo rechazado.',
        motivo: 'DEMASIADO_GRANDE',
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('pesa mas de lo que se admite');
    // Decirle que cambie el formato lo manda a exportar el mismo escaneo a otro tipo y a fallar de
    // nuevo por el mismo motivo.
    expect(texto(fixture)).not.toContain('solo se aceptan PDF, PNG y JPEG');
  });

  it('un archivo rechazado por TIPO explica que el tipo se decide por el contenido', async () => {
    const fixture = await montar([]);
    abrirSubidaCon(fixture, 'OTRO', '');

    httpMock.expectOne(esSubida()).flush(
      {
        type: 'https://akine.app/problems/archivo-no-aceptado',
        status: 400,
        detail: 'Archivo rechazado.',
        motivo: 'TIPO_NO_PERMITIDO',
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await estabilizar(fixture);

    // Sin esta frase, el reflejo es renombrar el archivo a .pdf y reintentar.
    expect(texto(fixture)).toContain('renombrarlo no cambia nada');
  });

  it('una ficha dada de baja no ofrece subir y lo explica, pero sigue listando', async () => {
    const fixture = await montar([CREDENCIAL], { ...ACTIVA, estado: 'INACTIVO' });

    expect(rotulosDeBoton(fixture)).not.toContain('Subir un documento');
    expect(texto(fixture)).toContain('no admite documentos nuevos');
    // Lo que ya tiene se sigue consultando: es RN-M07-004 aplicada al documento.
    expect(texto(fixture)).toContain('Credencial OSDE');
  });

  // -------------------------------------------------------------------------------------
  // 3. Contenido no disponible
  // -------------------------------------------------------------------------------------

  it('un contenido no disponible se avisa antes, y el boton de descargar queda deshabilitado', async () => {
    const fixture = await montar([{ ...CREDENCIAL, estado: 'NO_DISPONIBLE' }]);

    expect(texto(fixture)).toContain('Contenido no disponible');
    expect(botonDeshabilitado(fixture, 'Descargar')).toBe(true);
  });

  // -------------------------------------------------------------------------------------
  // 4. Reclasificar y dar de baja
  // -------------------------------------------------------------------------------------

  it('reclasificar manda un PATCH con la categoria nueva y dice que el archivo no se reemplaza', async () => {
    const fixture = await montar([CREDENCIAL]);

    apretar(fixture, 'Reclasificar');
    expect(texto(fixture)).toContain('El archivo, su nombre');
    elegirEn(fixture, `#reclasificar-categoria-${CREDENCIAL.id}`, 'OTRO');
    apretar(fixture, 'Guardar');

    const pedido = httpMock.expectOne(esReclasificar());
    expect(pedido.request.method).toBe('PATCH');
    expect((pedido.request.body as Record<string, unknown>)['categoria']).toBe('OTRO');

    pedido.flush({ ...CREDENCIAL, categoria: 'OTRO', version: 1 });
    responderListado(httpMock.expectOne(esListado()), [{ ...CREDENCIAL, categoria: 'OTRO' }]);
    await estabilizar(fixture);
  });

  it('con el motivo vacio no manda la baja del documento', async () => {
    const fixture = await montar([CREDENCIAL]);

    apretar(fixture, 'Dar de baja');
    apretar(fixture, 'Dar de baja el documento');

    httpMock.expectNone(esBaja());
  });

  it('la baja manda el motivo y aclara que el archivo no se borra', async () => {
    const fixture = await montar([CREDENCIAL]);

    apretar(fixture, 'Dar de baja');
    escribirEn(fixture, `#baja-adjunto-${CREDENCIAL.id}`, 'Se vencio la credencial.');
    apretar(fixture, 'Dar de baja el documento');

    const pedido = httpMock.expectOne(esBaja());
    expect((pedido.request.body as Record<string, unknown>)['motivo']).toBe(
      'Se vencio la credencial.',
    );

    pedido.flush({ ...CREDENCIAL, estadoCicloDeVida: 'INACTIVO' });
    responderListado(httpMock.expectOne(esListado()), []);
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('El archivo no se borro');
  });

  it('un documento dado de baja se puede descargar y no se puede reclasificar', async () => {
    const fixture = await montar([
      { ...CREDENCIAL, estadoCicloDeVida: 'INACTIVO', deactivationReason: 'Vencida.' },
    ]);

    const rotulos = rotulosDeBoton(fixture);
    // La descarga sobrevive a la baja a proposito: una baja logica dice "esto ya no corresponde
    // para operar", no "esto nunca existio".
    expect(rotulos).toContain('Descargar');
    expect(rotulos).not.toContain('Reclasificar');
    expect(texto(fixture)).toContain('Vencida.');
  });

  // -------------------------------------------------------------------------------------
  // 5. Estados de error del listado
  //
  // Los dos 403 llegan con el mismo status y necesitan salidas OPUESTAS: uno se arregla
  // eligiendo contexto y el otro pidiendo el permiso.
  // -------------------------------------------------------------------------------------

  it('una direccion que no identifica a nadie no dispara ninguna peticion', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_PACIENTE_MANAGE] });

    const fixture = TestBed.createComponent(DocumentosDePersonaPage);
    fixture.componentRef.setInput('personaId', 'sin-sentido');
    fixture.detectChanges();
    await estabilizar(fixture);

    // Sin este corte sale un `GET /personas/NaN/adjuntos`, que el backend contesta con un 400
    // sobre un parametro que el operador nunca escribio.
    httpMock.expectNone(esListado());
    expect(texto(fixture)).toContain('La direccion no identifica a ninguna persona');
  });

  it('un 403 por falta de permiso ofrece reintentar y no manda a elegir contexto', async () => {
    const fixture = await montarConListado((pedido) =>
      pedido.flush(
        { type: 'https://akine.app/problems/forbidden', detail: 'sin permiso' },
        { status: 403, statusText: 'Forbidden' },
      ),
    );

    expect(texto(fixture)).toContain('hace falta el permiso de gestion de pacientes');
    expect(rotulosDeBoton(fixture)).toContain('Reintentar');
    expect(fixture.nativeElement.querySelector('a[href="/seleccionar-contexto"]')).toBeNull();
  });

  it('un 403 por falta de contexto manda a elegir contexto y no ofrece reintentar', async () => {
    const fixture = await montarConListado((pedido) =>
      pedido.flush(
        { type: 'https://akine.app/problems/missing-tenant-context', detail: 'sin contexto' },
        { status: 403, statusText: 'Forbidden' },
      ),
    );

    // Y dice que la sesion sigue abierta: el reflejo ante un 403 es pensar que se deslogueo.
    expect(texto(fixture)).toContain('Tu sesion sigue abierta');
    expect(rotulosDeBoton(fixture)).not.toContain('Reintentar');
    expect(fixture.nativeElement.querySelector('a[href="/seleccionar-contexto"]')).not.toBeNull();
  });

  it('sin paciente:manage se listan y se descargan los documentos, y no se modifican', async () => {
    const fixture = await montarConListado((pedido) => responderListado(pedido, [CREDENCIAL]), []);

    const ofrecidos = rotulosDeBoton(fixture);
    // Consultar el padron si se puede, y por eso el listado se sigue viendo entero.
    expect(texto(fixture)).toContain('Credencial OSDE');
    expect(ofrecidos).toContain('Descargar');
    expect(ofrecidos).not.toContain('Subir un documento');
    expect(ofrecidos).not.toContain('Reclasificar');
    expect(ofrecidos).not.toContain('Dar de baja');
  });

  // -------------------------------------------------------------------------------------
  // 6. Descarga
  // -------------------------------------------------------------------------------------

  it('el archivo se guarda con el nombre que declara Content-Disposition, y el objectURL se revoca', async () => {
    const fixture = await montar([CREDENCIAL]);
    const descarga = espiarDescarga();

    apretar(fixture, 'Descargar');
    httpMock.expectOne(esDescarga()).flush(new Blob(['pdf']), {
      headers: {
        'Content-Disposition': "attachment; filename*=UTF-8''credencial%20ma%C3%B1ana.pdf",
      },
    });
    await estabilizar(fixture);

    // La forma extendida es la unica que sobrevive a los acentos; la simple los transliteran.
    expect(descarga.enlace.download).toBe('credencial mañana.pdf');
    // Un objectURL que no se revoca retiene el archivo entero en memoria toda la sesion, y esta
    // es una pantalla de mostrador que descarga muchos.
    expect(descarga.revocar).toHaveBeenCalledWith('blob:sintetico');
    descarga.restaurar();
  });

  it('un Content-Disposition mal codificado no tira la descarga: cae en la forma simple', async () => {
    const fixture = await montar([CREDENCIAL]);
    const descarga = espiarDescarga();

    apretar(fixture, 'Descargar');
    // `%E1` suelto hace explotar a `decodeURIComponent`. Dejar que la excepcion suba cancelaria
    // una descarga que el navegador podia resolver igual.
    httpMock.expectOne(esDescarga()).flush(new Blob(['pdf']), {
      headers: {
        'Content-Disposition': 'attachment; filename*=UTF-8\'\'rot%E1; filename="credencial.pdf"',
      },
    });
    await estabilizar(fixture);

    expect(descarga.enlace.download).toBe('credencial.pdf');
    descarga.restaurar();
  });

  it('una descarga rechazada muestra el problema real, con ningun panel abierto', async () => {
    const fixture = await montar([CREDENCIAL]);
    const descarga = espiarDescarga();

    apretar(fixture, 'Descargar');
    // La descarga viaja con `responseType: 'blob'`, asi que el cuerpo del error tambien llega
    // como Blob y NO como objeto: se reproduce tal cual, porque es lo que pasa en el navegador.
    httpMock.expectOne(esDescarga()).flush(
      new Blob(
        [
          JSON.stringify({
            type: 'https://akine.app/problems/adjunto-no-disponible',
            detail: 'sin contenido',
          }),
        ],
        { type: 'application/problem+json' },
      ),
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);

    // Lo que NO puede pasar bajo ningun arreglo: que el rechazo se lea como un exito, o que la
    // pantalla se quede sin la fila que el operador estaba mirando.
    expect(texto(fixture)).not.toContain('Se guardo');
    expect(texto(fixture)).toContain('Credencial OSDE');
    // El aviso se ve CON TODOS LOS PANELES CERRADOS, que es el estado normal al tocar
    // "Descargar": antes solo se renderizaba dentro de la subida y de los dos paneles de fila,
    // asi que el boton parecia no hacer nada.
    // Y dice el problema real, no el generico: el `type` viaja dentro de un Blob porque la
    // descarga usa `responseType: 'blob'`, y es lo unico que le dice al operador que NO vuelva a
    // subir el archivo sobre esta fila.
    expect(texto(fixture)).toContain('No lo vuelvas a subir sobre esta fila');
    // Y no se entrega ningun archivo: un `download` disparado sobre un error guardaria el
    // ProblemDetail con nombre de PDF.
    expect(descarga.revocar).not.toHaveBeenCalled();
    descarga.restaurar();
  });

  // -------------------------------------------------------------------------------------
  // 7. Errores de las mutaciones
  // -------------------------------------------------------------------------------------

  it('reclasificar un documento dado de baja lo dice y no ofrece recargar', async () => {
    const fixture = await montar([CREDENCIAL]);

    apretar(fixture, 'Reclasificar');
    elegirEn(fixture, `#reclasificar-categoria-${CREDENCIAL.id}`, 'OTRO');
    apretar(fixture, 'Guardar');

    // La carrera real: alguien lo dio de baja desde otra pantalla mientras este panel estaba
    // abierto.
    httpMock
      .expectOne(esReclasificar())
      .flush(
        { type: 'https://akine.app/problems/adjunto-inactivo', detail: 'dado de baja' },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Se sigue pudiendo descargar');
    // Recargar no cambia el desenlace de este caso: lo que hay que hacer es subir el archivo
    // nuevo, y el mensaje ya lo dice.
    expect(rotulosDeBoton(fixture)).not.toContain('Recargar los documentos');
  });

  it('un conflicto de concurrencia al reclasificar ofrece recargar los documentos', async () => {
    const fixture = await montar([CREDENCIAL]);

    apretar(fixture, 'Reclasificar');
    elegirEn(fixture, `#reclasificar-categoria-${CREDENCIAL.id}`, 'OTRO');
    apretar(fixture, 'Guardar');

    httpMock
      .expectOne(esReclasificar())
      .flush(
        { type: 'https://akine.app/problems/conflict', detail: 'version vieja' },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);

    // Aca si: lo unico que resuelve el error es ver como quedo la fila.
    expect(rotulosDeBoton(fixture)).toContain('Recargar los documentos');
    apretar(fixture, 'Recargar los documentos');
    responderListado(httpMock.expectOne(esListado()), [CREDENCIAL]);
    await estabilizar(fixture);
  });

  it('una baja que falla deja el panel abierto con el mensaje del backend', async () => {
    const fixture = await montar([CREDENCIAL]);

    apretar(fixture, 'Dar de baja');
    escribirEn(fixture, `#baja-adjunto-${CREDENCIAL.id}`, 'Se vencio.');
    apretar(fixture, 'Dar de baja el documento');

    httpMock
      .expectOne(esBaja())
      .flush(
        { type: 'https://akine.app/problems/forbidden', detail: 'sin permiso' },
        { status: 403, statusText: 'Forbidden' },
      );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('hace falta el permiso de gestion de pacientes');
    // Cerrar el panel obligaria a reescribir el motivo solo para leer por que fallo.
    expect(fixture.nativeElement.querySelector(`#baja-adjunto-${CREDENCIAL.id}`)).not.toBeNull();
  });

  // -------------------------------------------------------------------------------------
  // 8. Filtro por categoria
  // -------------------------------------------------------------------------------------

  it('filtrar por categoria manda el parametro y volver a todas lo omite', async () => {
    const fixture = await montar([CREDENCIAL]);

    elegirEn(fixture, '#documentos-filtro-categoria', 'CREDENCIAL_COBERTURA');
    const filtrado = httpMock.expectOne(esListado());
    expect(filtrado.request.urlWithParams).toContain('categoria=CREDENCIAL_COBERTURA');
    responderListado(filtrado, [CREDENCIAL]);
    await estabilizar(fixture);

    elegirEn(fixture, '#documentos-filtro-categoria', '');
    const todas = httpMock.expectOne(esListado());
    // Omitido y no vacio: `categoria=` es un valor, y el backend tendria que decidir si lo
    // interpreta como "ninguna" o como "todas".
    expect(todas.request.urlWithParams).not.toContain('categoria=');
    responderListado(todas, [CREDENCIAL]);
    await estabilizar(fixture);
  });

  // -------------------------------------------------------------------------------------
  // Accesibilidad
  // -------------------------------------------------------------------------------------

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar([CREDENCIAL]);
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------

  async function montar(
    adjuntos: object[],
    ficha: object = ACTIVA,
  ): Promise<ComponentFixture<DocumentosDePersonaPage>> {
    return montarConListado(
      (pedido) => responderListado(pedido, adjuntos),
      [PERMISO_PACIENTE_MANAGE],
      ficha,
    );
  }

  /** Monta dejando que cada caso decida como responde el listado y que permisos tiene quien mira. */
  async function montarConListado(
    responder: (pedido: TestRequest) => void,
    otorgados: readonly string[] = [PERMISO_PACIENTE_MANAGE],
    ficha: object = ACTIVA,
  ): Promise<ComponentFixture<DocumentosDePersonaPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: otorgados });

    const fixture = TestBed.createComponent(DocumentosDePersonaPage);
    fixture.componentRef.setInput('personaId', String(PERSONA));
    fixture.detectChanges();

    httpMock.expectOne(FICHA).flush(ficha);
    responder(httpMock.expectOne(esListado()));
    await estabilizar(fixture);
    return fixture;
  }

  /**
   * Sustituye el ancla efimera y las dos funciones de `URL`, que jsdom no implementa.
   *
   * <p>El ancla se devuelve para poder afirmar con que nombre se habria guardado el archivo: es
   * el unico lugar donde eso queda escrito, y guardarlo con el id deja al operador con una
   * carpeta de descargas ilegible.
   */
  function espiarDescarga() {
    const crearOriginal = document.createElement.bind(document);
    const enlace = crearOriginal('a');
    vi.spyOn(enlace, 'click').mockImplementation(() => undefined);
    const creador = vi
      .spyOn(document, 'createElement')
      .mockImplementation(((etiqueta: string) =>
        etiqueta === 'a' ? enlace : crearOriginal(etiqueta)) as typeof document.createElement);

    const urlGlobal = URL as unknown as Record<string, unknown>;
    const crearPrevio = urlGlobal['createObjectURL'];
    const revocarPrevio = urlGlobal['revokeObjectURL'];
    const revocar = vi.fn();
    urlGlobal['createObjectURL'] = vi.fn(() => 'blob:sintetico');
    urlGlobal['revokeObjectURL'] = revocar;

    return {
      enlace,
      revocar,
      restaurar(): void {
        creador.mockRestore();
        urlGlobal['createObjectURL'] = crearPrevio;
        urlGlobal['revokeObjectURL'] = revocarPrevio;
      },
    };
  }

  function esDescarga() {
    return (p: HttpRequest<unknown>) =>
      p.method === 'GET' && p.url === `${ADJUNTOS}/${CREDENCIAL.id}/contenido`;
  }

  /** Abre el formulario, adjunta un archivo sintetico, elige categoria y envia. */
  function abrirSubidaCon(
    fixture: ComponentFixture<DocumentosDePersonaPage>,
    categoria: string,
    titulo: string,
  ): void {
    apretar(fixture, 'Subir un documento');
    adjuntarArchivo(fixture);
    elegirEn(fixture, '#subida-categoria', categoria);
    if (titulo !== '') {
      escribirEn(fixture, '#subida-titulo', titulo);
    }
    apretar(fixture, 'Subir');
  }

  /**
   * Adjunta un archivo al input de tipo `file`.
   *
   * <p>No se puede asignar `files` sobre el input real —es de solo lectura—, asi que se despacha el
   * `change` con un `target` armado a mano. Es lo mismo que hace el navegador: el componente lee
   * `files[0]` del target del evento, no del elemento.
   */
  function adjuntarArchivo(fixture: ComponentFixture<DocumentosDePersonaPage>): void {
    const archivo = new File(['contenido sintetico'], 'dni.pdf', { type: 'application/pdf' });
    const componente = fixture.componentInstance as unknown as {
      elegirArchivo(entrada: EventTarget | null): void;
    };
    componente.elegirArchivo({ files: [archivo] } as unknown as EventTarget);
    fixture.detectChanges();
  }

  async function estabilizar(fixture: ComponentFixture<DocumentosDePersonaPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function pagina(contenido: object[]): object {
    return {
      content: contenido,
      page: 0,
      size: 20,
      totalElements: contenido.length,
      totalPages: 1,
    };
  }

  function responderListado(pedido: TestRequest, adjuntos: object[]): void {
    pedido.flush(pagina(adjuntos));
  }

  function esListado() {
    return (p: HttpRequest<unknown>) => p.method === 'GET' && p.url === ADJUNTOS;
  }

  function esSubida() {
    return (p: HttpRequest<unknown>) => p.method === 'POST' && p.url === ADJUNTOS;
  }

  function esReclasificar() {
    return (p: HttpRequest<unknown>) =>
      p.method === 'PATCH' && p.url === `${ADJUNTOS}/${CREDENCIAL.id}`;
  }

  function esBaja() {
    return (p: HttpRequest<unknown>) =>
      p.method === 'DELETE' && p.url === `${ADJUNTOS}/${CREDENCIAL.id}`;
  }

  function elegirEn(
    fixture: ComponentFixture<DocumentosDePersonaPage>,
    selector: string,
    valor: string,
  ): void {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLSelectElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function escribirEn(
    fixture: ComponentFixture<DocumentosDePersonaPage>,
    selector: string,
    valor: string,
  ): void {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function apretar(fixture: ComponentFixture<DocumentosDePersonaPage>, rotulo: string): void {
    const boton = botonDe(fixture, rotulo);
    if (boton === undefined) {
      throw new Error(`No hay ningun boton rotulado "${rotulo}".`);
    }
    boton.click();
    fixture.detectChanges();
  }

  function botonDeshabilitado(
    fixture: ComponentFixture<DocumentosDePersonaPage>,
    rotulo: string,
  ): boolean {
    return botonDe(fixture, rotulo)?.disabled === true;
  }

  function botonDe(
    fixture: ComponentFixture<DocumentosDePersonaPage>,
    rotulo: string,
  ): HTMLButtonElement | undefined {
    return Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => (b.textContent ?? '').trim() === rotulo);
  }

  function rotulosDeBoton(fixture: ComponentFixture<DocumentosDePersonaPage>): string[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).map((boton) => (boton.textContent ?? '').trim());
  }

  function texto(fixture: ComponentFixture<DocumentosDePersonaPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }
});
