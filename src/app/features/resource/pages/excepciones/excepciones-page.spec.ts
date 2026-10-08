import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { ExcepcionesPage } from './excepciones-page';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import {
  RUTA_PERMISOS_EFECTIVOS,
  rutaCalendarioSede,
  rutaExcepciones,
  rutaMemberships,
} from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const ORG = 1;
const SEDE = 3;
const ANA_ID = 42;

const EXCEPCIONES = rutaExcepciones(SEDE);
const CALENDARIO = rutaCalendarioSede(SEDE);

const ANA = {
  id: ANA_ID,
  accountName: 'Ana Kine',
  accountEmail: 'ana@example.test',
  roleCode: 'PROFESIONAL',
  estado: 'ACTIVA',
  consultorioId: null,
};

const BETO = {
  id: 43,
  accountName: 'Beto Fisio',
  accountEmail: 'beto@example.test',
  roleCode: 'PROFESIONAL',
  estado: 'ACTIVA',
  consultorioId: SEDE,
};

/** No es profesional: no cuenta para el aviso ni aparece en los selectores. */
const RECEPCION = {
  id: 44,
  accountName: 'Recepcion',
  accountEmail: 'recepcion@example.test',
  roleCode: 'ADMINISTRATIVO',
  estado: 'ACTIVA',
  consultorioId: SEDE,
};

/** Cierre de TODA la sede: `membershipId` ausente es el alcance, no un dato que falte. */
const CIERRE_DE_SEDE = {
  id: 500,
  consultorioId: SEDE,
  organizationId: ORG,
  membershipId: null,
  tipo: 'CIERRE',
  motivo: 'BLOQUEO',
  fechaDesde: '2026-09-01',
  fechaHasta: '2026-09-03',
  horaDesde: null,
  horaHasta: null,
  notes: 'Obra en el pasillo',
  estado: 'ACTIVO',
  version: 1,
};

/** Apertura de sede con franja que llega al final del dia: la medianoche es el string 24:00. */
const APERTURA_DE_SEDE = {
  id: 501,
  consultorioId: SEDE,
  organizationId: ORG,
  membershipId: null,
  tipo: 'APERTURA',
  motivo: 'AMPLIACION',
  fechaDesde: '2026-09-10',
  fechaHasta: '2026-09-11',
  horaDesde: '20:00',
  horaHasta: '24:00',
  estado: 'ACTIVO',
  version: 1,
};

const VIGENTES = [CIERRE_DE_SEDE, APERTURA_DE_SEDE];

const FERIADO = {
  id: 9,
  fecha: '2026-09-10',
  nombre: 'Dia del maestro',
  pais: 'AR',
  tipo: 'INAMOVIBLE',
};

/**
 * Spec del panel de excepciones (M05, RF-M05-004, AKINE-02.04).
 *
 * <p>Cubre lo que, si se rompe, <b>no produce ningun error visible</b>:
 *
 * <ol>
 *   <li>Que una apertura de <b>sede</b> sobre un feriado que la sede cierra no se guarde sin
 *       decir a cuanta gente le cambia el dia. Guardarla en silencio deja a todos los
 *       profesionales del centro con la agenda recortada y un `201` en la consola.</li>
 *   <li>Que "sin profesional" se lea como <b>alcance</b> y no como un dato faltante.</li>
 *   <li>Que la medianoche siga siendo el string `24:00` al mostrarla y al mandarla.</li>
 *   <li>Que la pantalla <b>no</b> invente conflictos de solapamiento: el backend no los emite y
 *       dos excepciones que se pisan son las dos legitimas.</li>
 * </ol>
 */
describe('ExcepcionesPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  /**
   * La query string con la que se abre la pantalla.
   *
   * <p>Se lee en el momento en que el componente se crea —de ahi el getter— para que cada test
   * pueda escribirla antes de montar sin volver a configurar el `TestBed`.
   */
  let queryParams: Record<string, string> = {};

  beforeEach(async () => {
    queryParams = {};

    await TestBed.configureTestingModule({
      imports: [ExcepcionesPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              get queryParamMap() {
                return convertToParamMap(queryParams);
              },
            },
          },
        },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    tenantContext = TestBed.inject(TenantContextStore);
    permisos = TestBed.inject(PermissionsStore);
  });

  afterEach(() => httpMock.verify());

  it('una excepcion sin profesional se muestra como alcance de toda la sede', async () => {
    const fixture = await montar();
    const contenido = texto(fixture);

    // El alcance se nombra. Una celda vacia se lee como "falta cargar el profesional", que es
    // justo lo contrario de lo que significa.
    expect(contenido).toContain('Cierre numero 500 — Toda la sede');
    expect(contenido).toContain('Apertura numero 501 — Toda la sede');

    // El fin es exclusivo: se muestra el ultimo dia REALMENTE cubierto, no el que se cargo.
    expect(contenido).toContain('Del 1 de septiembre de 2026 al 2 de septiembre de 2026 inclusive');

    expect(contenido).toContain('Dia completo');
    // La medianoche se muestra como el string del contrato, con su traduccion al lado.
    expect(contenido).toContain('20:00 a medianoche (24:00)');

    // Y la apertura de sede avisa, en su propia fila, que puede reemplazar el horario de todos.
    // La fila NO cuenta gente: el numero solo aparece donde decide algo -el aviso previo al
    // guardado- y solo cuando se lo pudo medir.
    expect(contenido).toContain(
      'reemplaza el horario habitual de todos los profesionales que atienden aca',
    );

    // El motivo se rotula con la misma tabla que arma el selector del alta: `BLOQUEO` es un
    // valor del contrato, no una palabra de la aplicacion.
    expect(contenido).toContain('Motivo declarado: Bloqueo');
    expect(contenido).not.toContain('BLOQUEO');
    expect(contenido).not.toContain('AMPLIACION');

    // Nada de solapamientos: el backend no los emite para excepciones y la pantalla no los inventa.
    expect(contenido).not.toContain('se pisa');
  });

  /**
   * El salto desde el horario efectivo tiene que aterrizar filtrado.
   *
   * <p>La explicacion de un dia vacio dice "la excepcion de cierre numero 42 cubre el dia
   * entero" y ofrece venir a mirarla. Con los valores por defecto de esta pantalla —solo las de
   * toda la sede, noventa dias desde hoy— un cierre de Ana, que es el caso corriente de una
   * ausencia, <b>no esta en la lista</b>, y nada indica que un filtro lo esta tapando. El enlace
   * carga el profesional y el dia; aca se verifica que la pantalla los use de verdad.
   */
  it('un enlace con profesional y dia abre la lista filtrada por eso y no por los valores por defecto', async () => {
    queryParams = { membershipId: String(ANA_ID), desde: '2026-09-02', hasta: '2026-09-03' };

    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(ExcepcionesPage);
    fixture.detectChanges();

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaMemberships(ORG))
      .flush({ content: [ANA, BETO], page: 0, size: 100, totalElements: 2, totalPages: 1 });

    const consulta = listado();
    expect(consulta.request.params.get('desde')).toBe('2026-09-02');
    expect(consulta.request.params.get('hasta')).toBe('2026-09-03');
    expect(consulta.request.params.get('membershipId')).toBe(String(ANA_ID));

    consulta.flush(VIGENTES);
    await estabilizar(fixture);

    // Y los campos muestran lo consultado: el usuario ve por que esta viendo lo que ve.
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>('#filtro-alcance')
        ?.value,
    ).toBe(String(ANA_ID));
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#ventana-desde')
        ?.value,
    ).toBe('2026-09-02');
  });

  it('una apertura de sede sobre un feriado no se guarda sin decir a cuantos afecta', async () => {
    const fixture = await montar();

    abrir(fixture, 'Cargar un cierre o una apertura');
    seleccionar(fixture, '#alta-excepcion-tipo', 'APERTURA');
    seleccionar(fixture, '#alta-excepcion-motivo', 'AMPLIACION');
    escribir(fixture, '#alta-excepcion-desde', '2026-09-10');
    escribir(fixture, '#alta-excepcion-hasta', '2026-09-11');
    marcar(fixture, '#alta-excepcion-dia-completo', false);
    escribir(fixture, '#alta-excepcion-hora-desde', '10:00');
    escribir(fixture, '#alta-excepcion-hora-hasta', '24:00');
    enviar(fixture, '#form-alta-excepcion');

    // Lo unico que sale a la red es la consulta del calendario. NO se crea nada todavia.
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    const consulta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'GET' && peticion.url === CALENDARIO,
    );
    expect(consulta.request.params.get('desde')).toBe('2026-09-10');
    expect(consulta.request.params.get('hasta')).toBe('2026-09-11');

    consulta.flush({
      consultorioId: SEDE,
      pais: 'AR',
      cierraPorFeriado: true,
      existePersistida: true,
      feriados: [FERIADO],
      version: 2,
    });
    await estabilizar(fixture);

    const aviso = texto(fixture);

    // El aviso dice la CONSECUENCIA CONCRETA: cuantos profesionales y que les pasa.
    expect(aviso).toContain('Esta apertura le cambia el dia a toda la sede');
    expect(aviso).toContain('10 de septiembre de 2026 — Dia del maestro');
    expect(aviso).toContain('el horario habitual de 2 profesionales no va a aplicar');
    expect(aviso).toContain('reemplaza');
    // Un "estas seguro" generico no serviria: hay que ver que se le cambia el dia a N personas.
    expect(aviso).not.toContain('Estas seguro');

    // Recien la confirmacion explicita sigue: consulta el impacto y, sin turnos afectados, crea.
    abrir(fixture, 'Entiendo: cargar igual');
    sinImpacto();

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'POST' && peticion.url === EXCEPCIONES,
    );
    expect(alta.request.body).toEqual({
      tipo: 'APERTURA',
      motivo: 'AMPLIACION',
      fechaDesde: '2026-09-10',
      fechaHasta: '2026-09-11',
      // Las horas viajan tal cual llegaron del campo: `24:00` es el valor del contrato.
      horaDesde: '10:00',
      horaHasta: '24:00',
    });
    // Sin `membershipId`: omitirlo ES el alcance de sede.
    expect(Object.keys(alta.request.body as object)).not.toContain('membershipId');

    alta.flush({ ...APERTURA_DE_SEDE, id: 502 }, { status: 201, statusText: 'Created' });
    listado().flush(VIGENTES);
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('La apertura quedo cargada');
  });

  /**
   * Lo que se confirma es lo que el formulario dice AL CONFIRMAR.
   *
   * <p>El aviso se muestra con el formulario vivo debajo, y lo primero que hace quien lo lee es
   * corregir lo que el aviso le acaba de senalar: acotar el alcance a una persona. Si el alta
   * posteara el cuerpo capturado al enviar, se crearia una apertura de <b>sede</b> —todos los
   * profesionales pierden su horario base ese feriado— mientras la pantalla muestra una de un
   * solo profesional. El cartel terminaria causando exactamente el destrozo que existe para
   * evitar.
   */
  it('acotar el alcance con el aviso abierto cambia lo que se guarda', async () => {
    const fixture = await montar();

    abrir(fixture, 'Cargar un cierre o una apertura');
    seleccionar(fixture, '#alta-excepcion-tipo', 'APERTURA');
    seleccionar(fixture, '#alta-excepcion-motivo', 'AMPLIACION');
    escribir(fixture, '#alta-excepcion-desde', '2026-09-10');
    escribir(fixture, '#alta-excepcion-hasta', '2026-09-11');
    enviar(fixture, '#form-alta-excepcion');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'GET' && peticion.url === CALENDARIO,
      )
      .flush({ consultorioId: SEDE, pais: 'AR', cierraPorFeriado: true, feriados: [FERIADO] });
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('el horario habitual de 2 profesionales no va a aplicar');

    // El admin hace lo sensato: acota la apertura a una sola persona, con el select que esta
    // ahi mismo, y recien despues confirma.
    seleccionar(fixture, '#alta-excepcion-alcance', String(ANA_ID));
    abrir(fixture, 'Entiendo: cargar igual');

    // Una apertura de UN profesional no descarta el horario de nadie mas: no se vuelve a
    // consultar el calendario.
    httpMock.expectNone(
      (peticion: HttpRequest<unknown>) => peticion.method === 'GET' && peticion.url === CALENDARIO,
    );
    // La consulta de impacto tambien va con el cuerpo de AHORA.
    expect(sinImpacto().membershipId).toBe(ANA_ID);

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'POST' && peticion.url === EXCEPCIONES,
    );
    // Lo que viaja es lo que el formulario dice AHORA, con membershipId. El cuerpo viejo
    // —sin membershipId, es decir de sede— no se guarda.
    expect(alta.request.body).toEqual({
      tipo: 'APERTURA',
      motivo: 'AMPLIACION',
      fechaDesde: '2026-09-10',
      fechaHasta: '2026-09-11',
      membershipId: ANA_ID,
    });

    alta.flush({ ...APERTURA_DE_SEDE, id: 504, membershipId: ANA_ID });
    listado().flush(VIGENTES);
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('La apertura quedo cargada');
  });

  /** Mover las fechas con el aviso abierto obliga a verificar de nuevo: son otros feriados. */
  it('mover las fechas con el aviso abierto vuelve a verificar antes de guardar', async () => {
    const fixture = await montar();

    abrir(fixture, 'Cargar un cierre o una apertura');
    seleccionar(fixture, '#alta-excepcion-tipo', 'APERTURA');
    escribir(fixture, '#alta-excepcion-desde', '2026-09-10');
    escribir(fixture, '#alta-excepcion-hasta', '2026-09-11');
    enviar(fixture, '#form-alta-excepcion');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'GET' && peticion.url === CALENDARIO,
      )
      .flush({ consultorioId: SEDE, pais: 'AR', cierraPorFeriado: true, feriados: [FERIADO] });
    await estabilizar(fixture);

    escribir(fixture, '#alta-excepcion-desde', '2026-09-20');
    escribir(fixture, '#alta-excepcion-hasta', '2026-09-21');
    abrir(fixture, 'Entiendo: cargar igual');

    // Nada se guarda con la ventana vieja: se vuelve a preguntar por los feriados de la nueva.
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    const revision = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'GET' && peticion.url === CALENDARIO,
    );
    expect(revision.request.params.get('desde')).toBe('2026-09-20');

    revision.flush({ consultorioId: SEDE, pais: 'AR', cierraPorFeriado: true, feriados: [] });
    await estabilizar(fixture);
    sinImpacto();

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'POST' && peticion.url === EXCEPCIONES,
    );
    expect(alta.request.body).toMatchObject({ fechaDesde: '2026-09-20', fechaHasta: '2026-09-21' });

    alta.flush(APERTURA_DE_SEDE, { status: 201, statusText: 'Created' });
    listado().flush(VIGENTES);
    await estabilizar(fixture);
  });

  /**
   * Con la lista de vinculos caida, el alta NO puede guardar un alcance de sede.
   *
   * <p>Es el escenario mas caro de esta pantalla y el que ningun cartel cubria. El desplegable
   * "A quien alcanza" tiene una opcion fija —"Toda la sede — todos los profesionales"— y todas
   * las demas salen de `listMemberships`. Si esa consulta falla, el desplegable colapsa a la
   * unica opcion fija: quien abrio el alta para cerrarle la semana a UNA persona no encuentra su
   * nombre, no necesariamente registra por que, y envia. El resultado es un cierre de todo el
   * centro por todo el rango, y el aviso de apertura no lo frena porque solo cubre APERTURA
   * sobre sede.
   *
   * <p>El test mira las dos mitades: que no salga <b>ningun</b> POST, y que la pantalla diga por
   * que en vez de quedarse muda.
   */
  it('con los profesionales desconocidos, el alta no puede guardar un alcance de sede', async () => {
    const fixture = await montarSinProfesionales();

    abrir(fixture, 'Cargar un cierre o una apertura');

    // El desplegable de alcance no existe: la unica opcion que quedaria significa "todos".
    expect(fixture.nativeElement.querySelector('#alta-excepcion-alcance')).toBeNull();
    expect(texto(fixture)).toContain('no sabemos a quien podes alcanzar');

    escribir(fixture, '#alta-excepcion-desde', '2026-09-10');
    escribir(fixture, '#alta-excepcion-hasta', '2026-09-30');
    enviar(fixture, '#form-alta-excepcion');
    await estabilizar(fixture);

    // Ni el alta ni la verificacion de feriados: no hay nada que verificar de algo que no se va
    // a guardar.
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    httpMock.expectNone(
      (peticion: HttpRequest<unknown>) => peticion.method === 'GET' && peticion.url === CALENDARIO,
    );

    expect(texto(fixture)).toContain('No pudimos leer los profesionales de la sede');
    expect(texto(fixture)).toContain('"toda la sede"');
  });

  /**
   * Una nomina recortada no puede sostener el numero del aviso.
   *
   * <p>Es el mismo error que el de la consulta caida, entrando por otra puerta.
   * `listMemberships` no filtra por sede y el backend recorta la pagina en cien: una
   * organizacion de 250 vinculos cuyos primeros cien traen 2 profesionales de esta sede haria
   * que el cartel prometiera "el horario habitual de 2 profesionales no va a aplicar" sobre una
   * apertura que se lo cambia a todos los que la sede tenga de verdad. Un numero mas chico que
   * el real es peor que ningun numero: el admin lo lee y confirma.
   */
  it('con la nomina recortada por el tope, el aviso no afirma un numero', async () => {
    const fixture = await montarConNominaRecortada();

    // La lista sirve para elegir —los que llegaron, llegaron— pero avisa que puede faltar gente.
    expect(texto(fixture)).toContain('la lista puede estar incompleta');

    abrir(fixture, 'Cargar un cierre o una apertura');
    seleccionar(fixture, '#alta-excepcion-tipo', 'APERTURA');
    escribir(fixture, '#alta-excepcion-desde', '2026-09-10');
    escribir(fixture, '#alta-excepcion-hasta', '2026-09-11');
    enviar(fixture, '#form-alta-excepcion');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'GET' && peticion.url === CALENDARIO,
      )
      .flush({ consultorioId: SEDE, pais: 'AR', cierraPorFeriado: true, feriados: [FERIADO] });
    await estabilizar(fixture);

    const aviso = texto(fixture);

    expect(aviso).toContain('Esta apertura le cambia el dia a toda la sede');
    expect(aviso).toContain('No sabemos a cuantos profesionales alcanza');
    expect(aviso).toContain('No es cero');

    // Y sobre todo: NINGUN numero. Los dos que llegaron no son los de la sede.
    expect(aviso).not.toContain('de 2 profesionales');
    expect(aviso).not.toContain('ningun profesional vinculado hoy a la sede');

    abrir(fixture, 'Volver y cambiar el alcance');
  });

  it('sin feriados en el periodo la apertura de sede se guarda derecho, sin aviso', async () => {
    const fixture = await montar();

    abrir(fixture, 'Cargar un cierre o una apertura');
    seleccionar(fixture, '#alta-excepcion-tipo', 'APERTURA');
    escribir(fixture, '#alta-excepcion-desde', '2026-09-20');
    escribir(fixture, '#alta-excepcion-hasta', '2026-09-21');
    enviar(fixture, '#form-alta-excepcion');

    // La sede cierra por feriado, pero en esta ventana no cae ninguno: no hay horario de nadie
    // que reemplazar, asi que advertir seria ruido que ensena a ignorar el cartel.
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'GET' && peticion.url === CALENDARIO,
      )
      .flush({ consultorioId: SEDE, pais: 'AR', cierraPorFeriado: true, feriados: [], version: 1 });
    await estabilizar(fixture);

    expect(texto(fixture)).not.toContain('le cambia el dia a toda la sede');
    sinImpacto();

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'POST' && peticion.url === EXCEPCIONES,
    );
    // El alta es idempotente sin `Idempotency-Key`: 200 tambien es exito.
    alta.flush(APERTURA_DE_SEDE, { status: 200, statusText: 'OK' });
    listado().flush(VIGENTES);
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('La apertura quedo cargada');
  });

  it('si no se puede leer el calendario, la apertura de sede se frena y lo dice', async () => {
    const fixture = await montar();

    abrir(fixture, 'Cargar un cierre o una apertura');
    seleccionar(fixture, '#alta-excepcion-tipo', 'APERTURA');
    enviar(fixture, '#form-alta-excepcion');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'GET' && peticion.url === CALENDARIO,
      )
      .flush(
        { type: 'https://akine.app/problems/internal-error' },
        { status: 500, statusText: 'X' },
      );
    await estabilizar(fixture);

    // No se guarda a ciegas: seguir de largo crearia en silencio justo el caso que el aviso
    // existe para frenar.
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect(texto(fixture)).toContain('No pudimos consultar el calendario de feriados');

    // Y se puede volver a elegir el alcance en vez de confirmar.
    abrir(fixture, 'Volver y cambiar el alcance');
    expect(texto(fixture)).not.toContain('No pudimos consultar el calendario de feriados');
  });

  it('un cierre de un profesional no consulta el calendario y viaja con su membershipId', async () => {
    const fixture = await montar();

    abrir(fixture, 'Cargar un cierre o una apertura');
    seleccionar(fixture, '#alta-excepcion-motivo', 'LICENCIA');
    seleccionar(fixture, '#alta-excepcion-alcance', String(ANA_ID));
    escribir(fixture, '#alta-excepcion-desde', '2026-10-01');
    escribir(fixture, '#alta-excepcion-hasta', '2026-10-15');
    escribir(fixture, '#alta-excepcion-notas', '  Licencia acordada  ');
    enviar(fixture, '#form-alta-excepcion');

    // Un cierre no descarta el horario de nadie mas: preguntar por los feriados seria un viaje
    // de red que no cambia ninguna decision.
    httpMock.expectNone(
      (peticion: HttpRequest<unknown>) => peticion.method === 'GET' && peticion.url === CALENDARIO,
    );
    sinImpacto();

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'POST' && peticion.url === EXCEPCIONES,
    );
    expect(alta.request.body).toEqual({
      tipo: 'CIERRE',
      motivo: 'LICENCIA',
      fechaDesde: '2026-10-01',
      fechaHasta: '2026-10-15',
      membershipId: ANA_ID,
      notes: 'Licencia acordada',
    });

    alta.flush({ ...CIERRE_DE_SEDE, id: 503, membershipId: ANA_ID, motivo: 'LICENCIA' });
    listado().flush(VIGENTES);
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('El cierre quedo cargado');
    expect(texto(fixture)).not.toContain('Turnos para revisar');
  });

  it('un cierre de sede que deja turnos afuera nombra a cada profesional y espera confirmacion', async () => {
    const fixture = await montar();

    abrir(fixture, 'Cargar un cierre o una apertura');
    escribir(fixture, '#alta-excepcion-desde', '2026-10-01');
    escribir(fixture, '#alta-excepcion-hasta', '2026-10-02');
    enviar(fixture, '#form-alta-excepcion');

    const consulta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'POST' && peticion.url === `${EXCEPCIONES}/impacto-de-alta`,
    );
    consulta.flush({
      turnosAfectados: 2,
      turnos: [
        {
          turnoId: 1,
          membershipId: ANA_ID,
          inicio: '2026-10-01T12:00:00Z',
          fin: '2026-10-01T12:30:00Z',
        },
        {
          turnoId: 2,
          membershipId: BETO.id,
          inicio: '2026-10-01T13:00:00Z',
          fin: '2026-10-01T13:30:00Z',
        },
      ],
      evaluadoHasta: '2026-10-02',
    });
    await estabilizar(fixture);

    // No se crea nada: la excepcion de sede alcanza a todos y la lista dice de quien es cada turno.
    httpMock.expectNone(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'POST' && peticion.url === EXCEPCIONES,
    );
    const contenido = texto(fixture);
    expect(contenido).toContain('Turnos afectados: 2.');
    expect(contenido).toContain('Ana Kine');
    expect(contenido).toContain('Beto Fisio');

    abrir(fixture, 'Cargar igual');
    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'POST' && peticion.url === EXCEPCIONES,
    );
    alta.flush(CIERRE_DE_SEDE, { status: 201, statusText: 'Created' });
    listado().flush(VIGENTES);
    await estabilizar(fixture);

    // ExcepcionResponse no trae la cuenta: el aviso la atribuye a la consulta previa.
    expect(texto(fixture)).toContain('Segun la consulta previa, 2 turnos pendientes quedaban');
  });

  it('las fechas incoherentes y la franja a medias no salen a la red', async () => {
    const fixture = await montar();

    abrir(fixture, 'Cargar un cierre o una apertura');

    // Misma fecha en los dos campos: cero dias cubiertos. El backend lo rechaza igual y gastar
    // ese viaje deja al usuario sin saber cual de los dos campos corregir.
    escribir(fixture, '#alta-excepcion-desde', '2026-09-01');
    escribir(fixture, '#alta-excepcion-hasta', '2026-09-01');
    enviar(fixture, '#form-alta-excepcion');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect(texto(fixture)).toContain('El fin tiene que ser posterior al primer dia');

    // Una franja necesita las DOS horas: el contrato manda las dos o ninguna.
    escribir(fixture, '#alta-excepcion-hasta', '2026-09-02');
    marcar(fixture, '#alta-excepcion-dia-completo', false);
    escribir(fixture, '#alta-excepcion-hora-desde', '10:00');
    enviar(fixture, '#form-alta-excepcion');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect(texto(fixture)).toContain('Una franja necesita las dos horas');

    // Y el fin tiene que ser posterior al inicio.
    escribir(fixture, '#alta-excepcion-hora-hasta', '08:00');
    enviar(fixture, '#form-alta-excepcion');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect(texto(fixture)).toContain('La hora de fin tiene que ser posterior a la de inicio');

    // Una hora mal escrita se senala en el campo.
    escribir(fixture, '#alta-excepcion-hora-hasta', '25:30');
    enviar(fixture, '#form-alta-excepcion');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect(texto(fixture)).toContain('Escribi la hora de fin como HH:MM');
  });

  it('la baja pide motivo, y dar de baja dos veces dice que ya estaba dada de baja', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de baja');

    // La consulta previa sale al abrir el panel.
    httpMock
      .expectOne(`${EXCEPCIONES}/${CIERRE_DE_SEDE.id}/impacto-de-baja`)
      .flush({ turnosAfectados: 0, turnos: [], evaluadoHasta: null });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Ningun turno pendiente queda fuera de horario');

    // Sin motivo no sale a la red: el backend lo exige igual.
    enviar(fixture, 'akine-confirmacion-con-motivo form');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'DELETE');
    expect(texto(fixture)).toContain('El motivo es obligatorio');

    escribir(fixture, '#baja-excepcion-reason', 'La obra se suspendio');
    enviar(fixture, 'akine-confirmacion-con-motivo form');

    const baja = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'DELETE',
    );
    expect(baja.request.url).toBe(`${EXCEPCIONES}/${CIERRE_DE_SEDE.id}`);
    // El motivo viaja en el CUERPO: en la query string quedaria en los logs de cualquier proxy.
    expect(baja.request.body).toEqual({ reason: 'La obra se suspendio' });

    baja.flush(
      { type: 'https://akine.app/problems/excepcion-already-inactive' },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);

    // "Ya estaba dada de baja" es informacion distinta de "no existe", y el traductor propio de
    // esta pantalla la distingue.
    const contenido = texto(fixture);
    expect(contenido).toContain('ya estaba dada de baja');
    expect(contenido).toContain('No es lo mismo que no existir');

    abrir(fixture, 'Recargar el periodo');
    listado().flush([APERTURA_DE_SEDE]);
    await estabilizar(fixture);
  });

  it('filtrar por un profesional pide sus excepciones y ademas las de la sede', async () => {
    const fixture = await montar();

    seleccionar(fixture, '#filtro-alcance', String(ANA_ID));

    const filtrado = listado();
    expect(filtrado.request.params.get('membershipId')).toBe(String(ANA_ID));
    filtrado.flush([CIERRE_DE_SEDE]);
    await estabilizar(fixture);

    // La semantica del filtro se dice en pantalla: sin ella, ver un cierre de sede en la lista
    // de una persona parece un error de la aplicacion.
    expect(texto(fixture)).toContain('las suyas y ademas las de toda la sede');

    // Y volver a "toda la sede" saca el parametro en vez de mandarlo vacio.
    seleccionar(fixture, '#filtro-alcance', '');
    const sinFiltro = listado();
    expect(sinFiltro.request.params.has('membershipId')).toBe(false);
    sinFiltro.flush(VIGENTES);
    await estabilizar(fixture);
  });

  it('una ventana invertida o mas larga que el tope no sale a la red', async () => {
    const fixture = await montar();

    escribir(fixture, '#ventana-hasta', '2020-01-01');
    enviar(fixture, '#form-ventana');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.url === EXCEPCIONES);
    expect(texto(fixture)).toContain('tiene que ser posterior al inicio');

    escribir(fixture, '#ventana-desde', '2026-01-01');
    escribir(fixture, '#ventana-hasta', '2030-01-01');
    enviar(fixture, '#form-ventana');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.url === EXCEPCIONES);
    expect(texto(fixture)).toContain('no puede superar los 366 dias');
  });

  it('si el listado de excepciones falla, se puede reintentar sin recargar la pagina', async () => {
    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(ExcepcionesPage);
    fixture.detectChanges();

    // Los profesionales tambien fallan: la pantalla sigue usable y ofrece reintentar cada cosa
    // por separado.
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaMemberships(ORG))
      .flush(
        { type: 'https://akine.app/problems/internal-error' },
        { status: 500, statusText: 'X' },
      );
    listado().flush(
      { type: 'https://akine.app/problems/forbidden' },
      { status: 403, statusText: 'F' },
    );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No tenes permiso para administrar los cierres');

    abrir(fixture, 'Reintentar los profesionales');
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaMemberships(ORG))
      .flush({ content: [ANA], page: 0, size: 100, totalElements: 1, totalPages: 1 });

    abrir(fixture, 'Reintentar');
    listado().flush(VIGENTES);
    await estabilizar(fixture);

    // Sin `consultorio:manage` no se ofrece ninguna accion que termine en 403.
    expect(texto(fixture)).not.toContain('Cargar un cierre o una apertura');
    expect(texto(fixture)).toContain('Apertura numero 501 — Toda la sede');
  });

  it('sin sede elegida no consulta nada y ofrece elegir consultorio', async () => {
    tenantContext.select({ organizationId: ORG, organizationName: 'Belgrano' });

    const fixture = TestBed.createComponent(ExcepcionesPage);
    fixture.detectChanges();
    await estabilizar(fixture);

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.url === EXCEPCIONES);
    httpMock.match(RUTA_PERMISOS_EFECTIVOS).forEach((p) => p.flush({ permissions: [] }));

    const contenido = texto(fixture);
    expect(contenido).toContain('Todavia no elegiste un consultorio');
    expect(contenido).toContain('Tu sesion sigue abierta');
    expect(fixture.nativeElement.querySelector('a[href="/seleccionar-contexto"]')).not.toBeNull();
  });

  it('la pantalla vacia dice que el horario cargado se aplica tal cual', async () => {
    const fixture = await montar([]);

    expect(texto(fixture)).toContain('No hay cierres ni aperturas vigentes en este periodo');
  });

  it(
    'la pantalla no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      abrir(fixture, 'Cargar un cierre o una apertura');
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  /** Monta la pantalla con contexto, permiso de gestion, dos profesionales y el listado cargado. */
  async function montar(
    excepciones: Record<string, unknown>[] = VIGENTES,
  ): Promise<ComponentFixture<ExcepcionesPage>> {
    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock
      .expectOne(RUTA_PERMISOS_EFECTIVOS)
      .flush({ permissions: [PERMISO_CONSULTORIO_MANAGE] });

    const fixture = TestBed.createComponent(ExcepcionesPage);
    fixture.detectChanges();

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaMemberships(ORG))
      .flush({
        content: [ANA, BETO, RECEPCION],
        page: 0,
        size: 100,
        totalElements: 3,
        totalPages: 1,
      });

    listado().flush(excepciones);
    await estabilizar(fixture);

    return fixture;
  }

  /** Igual que {@link montar}, pero con el listado de vinculos caido: la cantidad es DESCONOCIDA. */
  /**
   * Igual que {@link montar}, pero con la nomina RECORTADA por el tope de pagina.
   *
   * <p>La consulta responde bien: cien vinculos, y `totalElements` diciendo que hay 250. Ana y
   * Beto estan entre los que llegaron; los profesionales de la sede que quedaron afuera, no.
   */
  async function montarConNominaRecortada(): Promise<ComponentFixture<ExcepcionesPage>> {
    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock
      .expectOne(RUTA_PERMISOS_EFECTIVOS)
      .flush({ permissions: [PERMISO_CONSULTORIO_MANAGE] });

    const fixture = TestBed.createComponent(ExcepcionesPage);
    fixture.detectChanges();

    const relleno = Array.from({ length: 98 }, (_, indice) => ({
      ...RECEPCION,
      id: 1000 + indice,
    }));

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaMemberships(ORG))
      .flush({
        content: [ANA, BETO, ...relleno],
        page: 0,
        size: 100,
        totalElements: 250,
        totalPages: 3,
      });

    listado().flush(VIGENTES);
    await estabilizar(fixture);

    return fixture;
  }

  async function montarSinProfesionales(): Promise<ComponentFixture<ExcepcionesPage>> {
    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock
      .expectOne(RUTA_PERMISOS_EFECTIVOS)
      .flush({ permissions: [PERMISO_CONSULTORIO_MANAGE] });

    const fixture = TestBed.createComponent(ExcepcionesPage);
    fixture.detectChanges();

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaMemberships(ORG))
      .flush(
        { type: 'https://akine.app/problems/internal-error' },
        { status: 500, statusText: 'X' },
      );

    listado().flush(VIGENTES);
    await estabilizar(fixture);

    return fixture;
  }

  /** El `GET` del listado de excepciones, que siempre lleva la ventana en la query string. */
  /** Responde la consulta de impacto del alta sin turnos afectados y devuelve su cuerpo. */
  function sinImpacto(): { membershipId?: number } {
    const consulta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'POST' && peticion.url === `${EXCEPCIONES}/impacto-de-alta`,
    );
    consulta.flush({ turnosAfectados: 0, turnos: [], evaluadoHasta: '2026-12-31' });
    return consulta.request.body as { membershipId?: number };
  }

  function listado() {
    return httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'GET' && peticion.url === EXCEPCIONES,
    );
  }
});

async function estabilizar(fixture: ComponentFixture<ExcepcionesPage>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
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
  const campo = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(selector);
  if (campo === null) {
    throw new Error(`No existe el campo ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function marcar(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: boolean,
) {
  const casilla = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(selector);
  if (casilla === null) {
    throw new Error(`No existe la casilla ${selector}`);
  }
  casilla.checked = valor;
  casilla.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

function seleccionar(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: string,
) {
  const desplegable = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
    selector,
  );
  if (desplegable === null) {
    throw new Error(`No existe el desplegable ${selector}`);
  }
  desplegable.value = valor;
  desplegable.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

/**
 * Envia un formulario, y <b>falla si no existe</b>.
 *
 * <p>Con el `?.` que tenia antes, un id renombrado convertia a este helper en un no-op: cada
 * `expectNone(POST)` seguia pasando porque nunca se enviaba nada, y el spec quedaba verde
 * afirmando que la pantalla no sale a la red. Falla cerrado, como `abrir`, `escribir` y
 * `seleccionar`.
 */
function enviar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string) {
  const formulario = (fixture.nativeElement as HTMLElement).querySelector<HTMLFormElement>(
    selector,
  );
  if (formulario === null) {
    throw new Error(`No existe el formulario ${selector}`);
  }
  formulario.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}
