import {
  HttpHeaders,
  HttpRequest,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { OfertasDeLaSedePage } from './ofertas-de-la-sede-page';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import {
  RUTA_PERMISOS_EFECTIVOS,
  RUTA_SERVICIOS,
  rutaOfertas,
} from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const SEDE = 3;
const OFERTAS = rutaOfertas(SEDE);

const SERVICIO = {
  id: 1,
  codigo: 'KRES',
  nombre: 'Kinesiologia respiratoria',
  naturaleza: 'CLINICO',
  modalidadDefault: 'INDIVIDUAL',
  requiereCasoClinicoDefault: true,
  generaRegistroClinicoDefault: true,
  estado: 'ACTIVO',
  version: 1,
};

/** Vigente hoy: se ofrece para reservar. */
const VIGENTE = {
  id: 10,
  organizationId: 1,
  consultorioId: SEDE,
  servicioId: 1,
  nombreComercial: 'Rehabilitacion respiratoria adultos',
  modalidad: 'INDIVIDUAL',
  duracionMinutos: 45,
  capacidad: 1,
  precioBase: 15000,
  moneda: 'ARS',
  admiteObraSocial: true,
  requiereCasoClinico: true,
  generaRegistroClinico: true,
  requiereProfesional: true,
  requiereEspacio: true,
  vigenciaDesde: '2026-01-01',
  estado: 'ACTIVO',
  vigenteHoy: true,
  version: 4,
};

/**
 * ACTIVA pero <b>todavia sin vigencia</b>: arranca mas adelante.
 *
 * <p>Es el caso que la pantalla existe para no aplanar. `estado` dice ACTIVO y `vigenteHoy` dice
 * `false`, y las dos cosas son correctas al mismo tiempo.
 */
const AUN_NO = {
  ...VIGENTE,
  id: 11,
  nombreComercial: 'Pilates terapeutico grupal',
  modalidad: 'GRUPAL',
  capacidad: 8,
  vigenciaDesde: '2099-03-01',
  vigenteHoy: false,
  version: 1,
};

/**
 * Servicio dado de baja del catalogo global.
 *
 * <p>La baja de un servicio <b>no cascadea</b>: una oferta vigente puede seguir colgando de el.
 * Por eso el catalogo se pide completo aunque el selector del alta solo ofrezca los activos.
 */
const SERVICIO_DADO_DE_BAJA = {
  ...SERVICIO,
  id: 2,
  codigo: 'MASO',
  nombre: 'Masoterapia',
  estado: 'INACTIVO',
};

/** Dada de baja: conserva sus historicos y no admite acciones. */
const REVOCADA = {
  ...VIGENTE,
  id: 12,
  nombreComercial: 'Magnetoterapia',
  estado: 'INACTIVO',
  vigenteHoy: false,
  deactivationReason: 'Se dejo de prestar en esta sede',
};

/** Oferta cuya `version` no llego en la respuesta. Ver el test de la edicion sin version. */
const SIN_VERSION = {
  ...VIGENTE,
  id: 13,
  nombreComercial: 'Drenaje linfatico',
  version: undefined,
};

/** 403 generico: el backend rechaza por falta de `consultorio:manage`, no por falta de sede. */
const PROBLEMA_403 = {
  type: 'https://akine.app/problems/forbidden',
  detail: 'requiere consultorio:manage',
};

/**
 * Spec de las ofertas de la sede (M27, AKINE-02.06).
 *
 * <p>Cubre lo que el criterio de aceptacion exige y nada mas. Los cuatro casos elegidos tienen algo
 * en comun: <b>cuando estan mal, el sintoma no es un error</b>.
 *
 * <ol>
 *   <li>Una oferta activa que todavia no arranco tiene que verse distinta de una operativa. Si se
 *       aplana, nadie ve un error: la oferta simplemente no aparece en la agenda y se reporta como
 *       bug de la agenda.</li>
 *   <li>Omitir un campo heredable en el alta tiene que <b>omitirlo</b>. Mandar `false` responde
 *       `201` igual, y la oferta queda con el valor apagado en vez del del catalogo.</li>
 *   <li>`limpiarVigenciaHasta` tiene que viajar solo cuando se marca la casilla. Vaciar el campo y
 *       mandarlo no saca nada, y el usuario cree que si.</li>
 *   <li>El `409 conflict` tiene que frenar. Reintentar en silencio pisa el cambio de otro y
 *       responde `200`.</li>
 * </ol>
 */
describe('OfertasDeLaSedePage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OfertasDeLaSedePage],
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

  it('distingue una oferta vigente de una activa que todavia no arranco', async () => {
    const fixture = await montar();
    const filas = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(filas.length).toBe(2);

    const laVigente = filas[0] as HTMLElement;
    const laQueNoArranco = filas[1] as HTMLElement;

    expect(laVigente.textContent).toContain('Activa y vigente');

    // Las dos son ACTIVAS. Lo que las separa es la vigencia de hoy, y la fila lo dice con
    // palabras -no solo con un gris-, porque el color no puede ser el unico portador (WCAG 1.4.1).
    expect(laQueNoArranco.textContent).toContain('Activa, todavia sin vigencia');
    expect(laQueNoArranco.textContent).toContain('no aparece en los selectores de reserva');
    expect(laQueNoArranco.className).toContain('fila--atenuada');
    expect(laQueNoArranco.className).not.toContain('fila--revocada');

    // Y la nota de arriba explica la distincion una sola vez, para no repetirla por fila.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Activa y vigente hoy no son lo mismo',
    );
  });

  it('el filtro por servicio recarga con su parametro', async () => {
    const fixture = await montar();

    elegir(fixture, '#filtro-servicio-oferta', '1');
    const filtrada = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.url === OFERTAS && peticion.params.get('servicioId') === '1',
    );
    expect(filtrada.request.params.get('estado')).toBe('ACTIVO');
    filtrada.flush([VIGENTE]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Rehabilitacion respiratoria adultos',
    );
  });

  it('el alta OMITE lo que quedo en heredar: heredar no es apagar', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de alta una oferta');
    elegir(fixture, '#alta-oferta-servicio', '1');
    escribir(fixture, '#alta-oferta-nombre', 'Kinesio respiratoria');
    escribir(fixture, '#alta-oferta-duracion', '45');
    enviar(fixture, 'form[novalidate]');

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === OFERTAS,
    );
    const cuerpo = alta.request.body as Record<string, unknown>;

    // Los tres heredables quedaron en "heredar del servicio": NO viajan. Si viajaran como
    // `false`, el backend los apagaria en vez de tomar el default del catalogo, y responderia
    // `201` igual.
    expect(cuerpo['modalidad']).toBeUndefined();
    expect(cuerpo['requiereCasoClinico']).toBeUndefined();
    expect(cuerpo['generaRegistroClinico']).toBeUndefined();
    // Estos dos no heredan nada, asi que siempre viajan con lo que dice la casilla.
    expect(cuerpo['requiereProfesional']).toBe(true);
    expect(cuerpo['requiereEspacio']).toBe(true);
    expect(cuerpo['servicioId']).toBe(1);
    expect(cuerpo['duracionMinutos']).toBe(45);
    // Precio y moneda vacios: no viaja ninguno de los dos. Uno solo es un rechazo garantizado.
    expect(cuerpo['precioBase']).toBeUndefined();
    expect(cuerpo['moneda']).toBeUndefined();

    alta.flush({ ...VIGENTE, id: 12 });
    httpMock.expectOne(esListado()).flush([VIGENTE, AUN_NO]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'quedo dada de alta en esta sede',
    );
  });

  it('la casilla es la unica forma de sacar el fin de vigencia, y ademas vacia el campo', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    marcar(fixture, '#editar-oferta-limpiar-vigencia');

    // El campo se deshabilita y se vacia: dejar en pantalla un valor que no se va a mandar es
    // un estado contradictorio, no una sutileza.
    const campo = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '#editar-oferta-hasta',
    );
    expect(campo?.disabled).toBe(true);
    expect(campo?.value).toBe('');

    enviar(fixture, 'form[novalidate]');

    const edicion = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PUT' && peticion.url === `${OFERTAS}/10`,
    );
    expect(edicion.request.body).toEqual({ expectedVersion: 4, limpiarVigenciaHasta: true });

    edicion.flush({ ...VIGENTE, version: 5 });
    httpMock.expectOne(esListado()).flush([VIGENTE, AUN_NO]);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('el 409 conflict no pisa nada: relee, deja el panel abierto y explica', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-oferta-nombre', 'Rehabilitacion respiratoria');
    enviar(fixture, 'form[novalidate]');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'PUT' && peticion.url === `${OFERTAS}/10`,
      )
      // `conflict`, NO `concurrent-modification`: es lo que emite el handler global para el
      // bloqueo optimista de este modulo. Ver `offering-errors.ts`.
      .flush(
        { type: 'https://akine.app/problems/conflict', detail: 'la version quedo vieja' },
        { status: 409, statusText: 'Conflict' },
      );
    fixture.detectChanges();

    httpMock.expectOne(esListado()).flush([{ ...VIGENTE, version: 9 }, AUN_NO]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('no guardamos tus cambios para no pisar los suyos');
    expect(anfitrion.querySelector<HTMLInputElement>('#editar-oferta-nombre')?.value).toBe(
      'Rehabilitacion respiratoria',
    );
  });

  it('sin sede elegida no consulta ofertas y manda a elegirla, no al login', async () => {
    tenantContext.select({ organizationId: 1, organizationName: 'Centro Belgrano' });
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(OfertasDeLaSedePage);
    fixture.detectChanges();

    // Ni una peticion de ofertas: la ruta empieza en el consultorio y no se puede ni armar.
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.url.includes('/ofertas'));
    httpMock.match(esCatalogo()).forEach((peticion) => peticion.flush([SERVICIO]));
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('Todavia no elegiste un consultorio');
    expect(anfitrion.querySelector('a[href="/seleccionar-contexto"]')).not.toBeNull();
    expect(anfitrion.textContent).not.toContain('Sesion expirada');
  });

  // -----------------------------------------------------------------------------------------
  // Estados de error del backend. Ninguno de estos se ve en el camino feliz, y son los que
  // dejan la pantalla sin salida cuando estan mal: el usuario ve una tabla vacia y no sabe si
  // no hay datos, si no tiene permiso o si el servidor se cayo.
  // -----------------------------------------------------------------------------------------

  it('un 403 sin permiso explica y deja reintentar sin perder la sesion', async () => {
    const fixture = await montarConListadoRoto(403, PROBLEMA_403);
    const anfitrion = fixture.nativeElement as HTMLElement;

    expect(anfitrion.textContent).toContain('No podes modificar las ofertas de esta sede');
    // La salida NO es el selector de contexto: la sede esta elegida, lo que falta es el
    // permiso. Mandarlo a elegir consultorio de nuevo seria un bucle sin fin.
    expect(anfitrion.querySelector('a[href="/seleccionar-contexto"]')).toBeNull();

    hacerClick(fixture, 'Reintentar');
    httpMock.expectOne(esListado()).flush([VIGENTE]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('Rehabilitacion respiratoria adultos');
  });

  it('un 403 por falta de sede manda a elegirla en vez de ofrecer reintentar', async () => {
    const fixture = await montarConListadoRoto(403, {
      type: 'https://akine.app/problems/missing-tenant-context',
      detail: 'sin sede',
    });
    const anfitrion = fixture.nativeElement as HTMLElement;

    // Reintentar sin sede da el mismo 403 para siempre. La unica accion que destraba es
    // elegir consultorio, y por eso es la unica que se ofrece.
    expect(anfitrion.querySelector('a[href="/seleccionar-contexto"]')).not.toBeNull();
    expect(textoDeBotones(fixture)).not.toContain('Reintentar');
    expect(anfitrion.textContent).not.toContain('Sesion expirada');
  });

  it('un error de red se distingue de un rechazo del servidor', async () => {
    const fixture = await montarConListadoRoto(0, null);

    // status 0 es "el request nunca llego". Aplanarlo contra un 500 hace que el usuario
    // reporte "el sistema anda mal" cuando lo que se cayo es su wifi.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'No se pudo contactar al servidor',
    );
  });

  it('un 409 de unicidad en el alta muestra el motivo del backend y no cierra el panel', async () => {
    const fixture = await montar();

    completarAlta(fixture);
    httpMock
      .expectOne(esAlta())
      // Un 409 SIN `type`: el backend rechazo el alta por unicidad y no publico un tipo propio
      // para ese choque. Como no hay `problemType`, la pantalla cae en su rama generica y gana
      // el `detail`, que es lo unico que nombra el conflicto concreto. Un texto fijo aca deja
      // al usuario cambiando campos al azar.
      //
      // El fixture no puede inventar una URI: `check-problem-types.mjs` falla si el frontend
      // nombra un problemType que el contrato no declara.
      .flush(
        {
          detail: 'Ya existe una oferta con ese nombre comercial en esta sede.',
        },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('Ya existe una oferta con ese nombre comercial');
    // El panel sigue abierto con lo escrito: cerrarlo obligaria a tipear todo de nuevo.
    expect(anfitrion.querySelector<HTMLInputElement>('#alta-oferta-nombre')?.value).toBe(
      'Kinesio respiratoria',
    );
    expect(anfitrion.textContent).not.toContain('quedo dada de alta en esta sede');
  });

  it('un 429 dice cuantos segundos hay que esperar, no "intenta mas tarde"', async () => {
    const fixture = await montar();

    completarAlta(fixture);
    httpMock.expectOne(esAlta()).flush(
      { type: 'https://akine.app/problems/rate-limited', detail: 'demasiados intentos' },
      {
        status: 429,
        statusText: 'Too Many Requests',
        headers: new HttpHeaders({ 'Retry-After': '45' }),
      },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    // Sin el plazo, el usuario reintenta en bucle y estira su propio bloqueo.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Espera 45 segundos');
  });

  it('un 404 en la baja ofrece recargar el listado, que es lo unico que lo resuelve', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de baja');
    escribir(fixture, '#baja-oferta-motivo', 'Se dejo de prestar');
    enviar(fixture, 'form[novalidate]');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'DELETE' && peticion.url === `${OFERTAS}/10`,
      )
      .flush(
        { type: 'https://akine.app/problems/not-found', detail: 'no existe' },
        { status: 404, statusText: 'Not Found' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('Esa oferta ya no existe');

    // Reintentar la baja sobre una fila que ya no existe da 404 otra vez: lo que destraba es
    // releer. Sin este boton el panel queda mostrando una oferta fantasma.
    hacerClick(fixture, 'Recargar el listado');
    httpMock.expectOne(esListado()).flush([AUN_NO]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.textContent).not.toContain('Rehabilitacion respiratoria adultos');
  });

  // -----------------------------------------------------------------------------------------
  // Listas vacias y filas que no ofrecen acciones.
  // -----------------------------------------------------------------------------------------

  it('sin ofertas explica que la sede no ofrece nada, en vez de mostrar una tabla vacia', async () => {
    const fixture = await montar({ ofertas: [] });
    const anfitrion = fixture.nativeElement as HTMLElement;

    expect(anfitrion.querySelector('table')).toBeNull();
    expect(anfitrion.textContent).toContain('todavia no tiene ofertas que coincidan con el filtro');
    // Una tabla con encabezados y sin filas no dice si el filtro tapa todo o si no hay nada.
    expect(anfitrion.textContent).toContain('esta sede no ofrece nada para reservar');
  });

  it('una oferta dada de baja no ofrece acciones y muestra por que se dio de baja', async () => {
    const fixture = await montar({ ofertas: [REVOCADA] });
    const anfitrion = fixture.nativeElement as HTMLElement;

    // Nada se borra (RN-M27-007): la fila sigue, con su motivo. Lo que desaparece son las
    // acciones, porque editar o volver a dar de baja una oferta inactiva es un 409 seguro.
    expect(anfitrion.textContent).toContain('Se dejo de prestar en esta sede');
    expect(textoDeBotones(fixture)).not.toContain('Editar');
    expect(textoDeBotones(fixture)).not.toContain('Dar de baja');
    expect(anfitrion.querySelector('a[href="/servicios/ofertas/12/habilitaciones"]')).toBeNull();
  });

  // -----------------------------------------------------------------------------------------
  // Permisos. Ocultar no es autorizar, pero ofrecer lo que va a dar 403 tampoco sirve.
  // -----------------------------------------------------------------------------------------

  it('sin consultorio:manage se ve el listado pero no las acciones que lo modifican', async () => {
    const fixture = await montar({ permisos: [] });
    const anfitrion = fixture.nativeElement as HTMLElement;

    expect(anfitrion.textContent).toContain('Rehabilitacion respiratoria adultos');

    const botones = textoDeBotones(fixture);
    expect(botones).not.toContain('Dar de alta una oferta');
    expect(botones).not.toContain('Editar');
    expect(botones).not.toContain('Dar de baja');

    // Habilitaciones NO esta detras del permiso: se consulta por pertenencia, y esconderla
    // dejaria a un profesional sin poder ver donde puede atender.
    expect(
      anfitrion.querySelector('a[href="/servicios/ofertas/10/habilitaciones"]'),
    ).not.toBeNull();
  });

  // -----------------------------------------------------------------------------------------
  // Validaciones que BLOQUEAN el envio. Lo que importa no es el texto que aparece: es que la
  // peticion no salga. Un formulario que muestra el error y manda igual es peor que uno mudo.
  // -----------------------------------------------------------------------------------------

  it('el alta sin servicio ni nombre ni duracion no emite ninguna peticion', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de alta una oferta');
    enviar(fixture, 'form[novalidate]');

    httpMock.expectNone(esAlta());
    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('Toda oferta cuelga de un servicio del catalogo');
    expect(anfitrion.textContent).toContain('El nombre comercial es obligatorio');
  });

  it('una duracion de cero no se manda: el 400 que devolveria no se sabe interpretar', async () => {
    const fixture = await montar();

    completarAlta(fixture, { duracion: '0' });

    httpMock.expectNone(esAlta());
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'La duracion es obligatoria y tiene que ser mayor a cero',
    );
  });

  it('una capacidad de cero no se manda aunque la duracion sea valida', async () => {
    const fixture = await montar();

    // RF-M27-003 pide capacidad explicita y no derivada de la modalidad. Cero es un turno al
    // que no entra nadie: el backend lo rechaza, y frenarlo aca evita el viaje.
    completarAlta(fixture, { capacidad: '0' });

    httpMock.expectNone(esAlta());
  });

  it('una oferta sin version no se edita: se avisa en vez de mandar una expectedVersion inventada', async () => {
    const fixture = await montar({ ofertas: [SIN_VERSION] });

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-oferta-nombre', 'Drenaje linfatico manual');
    enviar(fixture, 'form[novalidate]');

    // Sin `expectedVersion` el backend no puede detectar el conflicto optimista: mandar la
    // edicion igual seria pisar en silencio lo que otro haya guardado.
    httpMock.expectNone(
      (peticion: HttpRequest<unknown>) => peticion.method === 'PUT' && peticion.url.includes('/13'),
    );
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'No pudimos leer la version de esta oferta',
    );
  });

  // -----------------------------------------------------------------------------------------
  // Filtros en sus bordes.
  // -----------------------------------------------------------------------------------------

  it('cambiar el filtro de estado cierra el panel abierto y recarga con el estado nuevo', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#editar-oferta-nombre'),
    ).not.toBeNull();

    elegir(fixture, '#filtro-estado-oferta', 'INACTIVO');

    const filtrada = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.url === OFERTAS && peticion.params.get('estado') === 'INACTIVO',
    );
    filtrada.flush([REVOCADA]);
    await fixture.whenStable();
    fixture.detectChanges();

    // Un panel de edicion abierto sobre una fila que el filtro nuevo ya no muestra guarda
    // contra una oferta que el usuario dejo de ver.
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#editar-oferta-nombre'),
    ).toBeNull();
  });

  it('volver el filtro de servicio a "Todos" quita el parametro en vez de mandar NaN', async () => {
    const fixture = await montar();

    elegir(fixture, '#filtro-servicio-oferta', '1');
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.url === OFERTAS && peticion.params.get('servicioId') === '1',
      )
      .flush([VIGENTE]);
    await fixture.whenStable();
    fixture.detectChanges();

    elegir(fixture, '#filtro-servicio-oferta', '');
    // `Number('')` es 0, que es finito: sin el corte por cadena vacia el filtro viajaria como
    // `servicioId=0` y el listado volveria vacio para siempre.
    httpMock.expectOne(esListado()).flush([VIGENTE, AUN_NO]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Pilates terapeutico');
  });

  it('un servicio dado de baja no se puede ofertar, pero su nombre sigue resolviendo', async () => {
    const fixture = await montar({
      ofertas: [{ ...VIGENTE, servicioId: 2 }],
      catalogo: [SERVICIO, SERVICIO_DADO_DE_BAJA],
    });
    const anfitrion = fixture.nativeElement as HTMLElement;

    // La baja de un servicio global no cascadea: la fila tiene que decir "Masoterapia" y no
    // "Servicio #2", que es el id pelado justo en el caso que esta regla existe para sostener.
    expect(anfitrion.textContent).toContain('Masoterapia (MASO)');

    // Pero ofrecerlo en el alta seria empujar al usuario a un 409.
    abrir(fixture, 'Dar de alta una oferta');
    const opciones = [
      ...anfitrion.querySelectorAll<HTMLOptionElement>('#alta-oferta-servicio option'),
    ].map((opcion) => opcion.textContent?.trim());
    expect(opciones).toEqual(['Elegi un servicio', 'Kinesiologia respiratoria (KRES)']);
  });

  it('si el catalogo no carga la pantalla sigue en pie y lo dice en el selector', async () => {
    const fixture = await montar({ catalogoRoto: true });
    const anfitrion = fixture.nativeElement as HTMLElement;

    // El listado del dia a dia no se tumba porque no se pudo poblar un `select`.
    expect(anfitrion.textContent).toContain('Rehabilitacion respiratoria adultos');
    // Sin catalogo el nombre no resuelve, y se muestra el id pelado en vez de una celda vacia.
    expect(anfitrion.textContent).toContain('Servicio #1');

    abrir(fixture, 'Dar de alta una oferta');
    expect(anfitrion.textContent).toContain('No pudimos traer el catalogo de servicios');
  });

  // -----------------------------------------------------------------------------------------
  // Los `limpiar*` y el precio. "Vacio" significa "no lo toques", asi que mandar de mas o de
  // menos cambia datos que el usuario no pidio cambiar, y el backend responde 200 igual.
  // -----------------------------------------------------------------------------------------

  it('la casilla de sacar el precio gana sobre lo escrito, y desmarcarla devuelve los campos', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-oferta-precio', '20000');
    cambiarCasilla(fixture, '#editar-oferta-limpiar-precio', true);

    // Saca precio Y moneda: el contrato los trata como un solo dato.
    expect(anfitrion.querySelector<HTMLInputElement>('#editar-oferta-precio')?.disabled).toBe(true);
    expect(anfitrion.querySelector<HTMLInputElement>('#editar-oferta-moneda')?.disabled).toBe(true);

    cambiarCasilla(fixture, '#editar-oferta-limpiar-precio', false);
    expect(anfitrion.querySelector<HTMLInputElement>('#editar-oferta-precio')?.disabled).toBe(
      false,
    );

    cambiarCasilla(fixture, '#editar-oferta-limpiar-precio', true);
    enviar(fixture, 'form[novalidate]');

    const edicion = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PUT' && peticion.url === `${OFERTAS}/10`,
    );
    // Mandar `limpiarPrecio` Y un `precioBase` seria pedirle al backend dos cosas contrarias
    // en el mismo cuerpo.
    expect(edicion.request.body).toEqual({ expectedVersion: 4, limpiarPrecio: true });

    edicion.flush({ ...VIGENTE, version: 5 });
    httpMock.expectOne(esListado()).flush([VIGENTE, AUN_NO]);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('un precio nuevo sin moneda no viaja: uno solo es un rechazo garantizado', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-oferta-precio', '20000');
    escribir(fixture, '#editar-oferta-moneda', '');
    enviar(fixture, 'form[novalidate]');

    const edicion = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PUT' && peticion.url === `${OFERTAS}/10`,
    );
    const cuerpo = edicion.request.body as Record<string, unknown>;
    // El backend tiene un check que exige los dos. Mandar el precio solo devuelve un 400 que
    // habla de una restriccion de la base, no de lo que el usuario hizo.
    expect(cuerpo['precioBase']).toBeUndefined();
    expect(cuerpo['moneda']).toBeUndefined();

    edicion.flush({ ...VIGENTE, version: 5 });
    httpMock.expectOne(esListado()).flush([VIGENTE, AUN_NO]);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('cambiar precio y moneda los manda juntos, con la moneda en mayusculas', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-oferta-precio', '20000');
    escribir(fixture, '#editar-oferta-moneda', 'usd');
    enviar(fixture, 'form[novalidate]');

    const edicion = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PUT' && peticion.url === `${OFERTAS}/10`,
    );
    // Sin normalizar, `usd` y `USD` serian dos monedas distintas para el backend.
    expect(edicion.request.body).toEqual({
      expectedVersion: 4,
      precioBase: 20000,
      moneda: 'USD',
    });

    edicion.flush({ ...VIGENTE, version: 5 });
    httpMock.expectOne(esListado()).flush([VIGENTE, AUN_NO]);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it(
    'la pantalla no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  /** Contexto de trabajo y permisos ya resueltos, antes de montar el componente. */
  function prepararContexto(permisosEfectivos: readonly string[] = [PERMISO_CONSULTORIO_MANAGE]) {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: permisosEfectivos });
  }

  async function montar(opciones?: {
    readonly ofertas?: readonly unknown[];
    readonly catalogo?: readonly unknown[];
    readonly permisos?: readonly string[];
    readonly catalogoRoto?: boolean;
  }): Promise<ComponentFixture<OfertasDeLaSedePage>> {
    prepararContexto(opciones?.permisos);

    const fixture = TestBed.createComponent(OfertasDeLaSedePage);
    fixture.detectChanges();

    httpMock.expectOne(esListado()).flush(opciones?.ofertas ?? [VIGENTE, AUN_NO]);
    const catalogo = httpMock.expectOne(esCatalogo());
    if (opciones?.catalogoRoto === true) {
      catalogo.flush(null, { status: 500, statusText: 'Server Error' });
    } else {
      catalogo.flush(opciones?.catalogo ?? [SERVICIO]);
    }
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  /** Monta con el listado fallando. `estado: 0` simula que el request nunca llego. */
  async function montarConListadoRoto(
    estado: number,
    cuerpo: Record<string, unknown> | null,
    cabeceras?: HttpHeaders,
  ): Promise<ComponentFixture<OfertasDeLaSedePage>> {
    prepararContexto();

    const fixture = TestBed.createComponent(OfertasDeLaSedePage);
    fixture.detectChanges();

    const listado = httpMock.expectOne(esListado());
    if (estado === 0) {
      listado.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    } else {
      listado.flush(cuerpo, { status: estado, statusText: 'Error', headers: cabeceras });
    }

    httpMock.expectOne(esCatalogo()).flush([SERVICIO]);
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  /** Completa el alta con lo minimo valido y la envia. */
  function completarAlta(
    fixture: ComponentFixture<OfertasDeLaSedePage>,
    campos?: { readonly duracion?: string; readonly capacidad?: string },
  ) {
    abrir(fixture, 'Dar de alta una oferta');
    elegir(fixture, '#alta-oferta-servicio', '1');
    escribir(fixture, '#alta-oferta-nombre', 'Kinesio respiratoria');
    escribir(fixture, '#alta-oferta-duracion', campos?.duracion ?? '45');
    escribir(fixture, '#alta-oferta-capacidad', campos?.capacidad ?? '1');
    enviar(fixture, 'form[novalidate]');
  }

  function esAlta() {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'POST' && peticion.url === OFERTAS;
  }

  function esListado() {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'GET' && peticion.url === OFERTAS && !peticion.params.has('servicioId');
  }

  /**
   * El catalogo global, matcheado por ruta y NO por URL completa.
   *
   * <p>El cliente generado manda el filtro de estado por defecto, asi que la URL real es
   * `/api/v1/servicios?estado=ACTIVO` y un `expectOne(RUTA_SERVICIOS)` con string no la
   * encuentra. Comparar la ruta sin los parametros es lo correcto igual: lo que esta pantalla
   * necesita fijar es QUE pide el catalogo, no con que filtro por defecto lo pide el cliente.
   */
  function esCatalogo() {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'GET' && peticion.url === RUTA_SERVICIOS;
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

/** Marca o desmarca una casilla. Desmarcar es una rama propia: devuelve los campos. */
function cambiarCasilla(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: boolean,
) {
  const casilla = fixture.nativeElement.querySelector(selector) as HTMLInputElement | null;
  if (casilla === null) {
    throw new Error(`No existe la casilla ${selector}`);
  }
  casilla.checked = valor;
  casilla.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

/** Clickea por etiqueta. Igual que `abrir`, pero se lee mejor donde no se abre nada. */
function hacerClick(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  etiqueta: string,
) {
  abrir(fixture, etiqueta);
}

/** Todas las etiquetas de boton visibles, para afirmar que una NO esta. */
function textoDeBotones(fixture: { nativeElement: HTMLElement }): readonly string[] {
  return [...fixture.nativeElement.querySelectorAll('button')].map((boton) =>
    (boton.textContent ?? '').trim(),
  );
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
  formulario?.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}

function marcar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string) {
  const casilla = fixture.nativeElement.querySelector(selector) as HTMLInputElement | null;
  if (casilla === null) {
    throw new Error(`No existe la casilla ${selector}`);
  }
  casilla.checked = true;
  casilla.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}
