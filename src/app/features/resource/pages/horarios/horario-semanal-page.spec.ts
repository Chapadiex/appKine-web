import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { HorarioSemanalPage } from './horario-semanal-page';
import {
  PERMISO_AGENDA_HORARIO,
  PERMISO_TURNO_MANAGE,
  PERMISO_TURNO_READ,
} from '../../../../core/models/permisos';
import { FlujoDeTurnosStore } from '../../../../core/services/flujo-de-turnos.store';
import { PerfilPropioStore } from '../../../../core/services/perfil-propio.store';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import {
  RUTA_PERMISOS_EFECTIVOS,
  rutaBloquesDisponibilidad,
  rutaMemberships,
} from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const ORG = 1;
const SEDE = 3;
const PROFESIONAL = 42;

const BLOQUES = rutaBloquesDisponibilidad(SEDE, PROFESIONAL);
/** El alta en lote (contrato 0.159.0): todos los dias en un pedido. */
const LOTE = `${BLOQUES}/lote`;

/** Profesional con vinculo de alcance organizacion: habilita en TODAS las sedes, incluida esta. */
const ANA = {
  id: PROFESIONAL,
  accountName: 'Ana Kine',
  accountEmail: 'ana@example.test',
  roleCode: 'PROFESIONAL',
  estado: 'ACTIVA',
  consultorioId: null,
};

/** No es profesional: no se le carga horario de atencion. No tiene que aparecer en el selector. */
const RECEPCION = {
  id: 43,
  accountName: 'Recepcion',
  accountEmail: 'recepcion@example.test',
  roleCode: 'ADMINISTRATIVO',
  estado: 'ACTIVA',
  consultorioId: SEDE,
};

/** Profesional acotado a OTRA sede: el backend responderia 409 profesional-no-vinculado. */
const OTRA_SEDE = {
  id: 44,
  accountName: 'Beto Fisio',
  accountEmail: 'beto@example.test',
  roleCode: 'PROFESIONAL',
  estado: 'ACTIVA',
  consultorioId: 99,
};

/** Manana del lunes. Es el bloque contra el que choca el 409 del spec. */
const LUNES_MANANA = {
  id: 100,
  consultorioId: SEDE,
  membershipId: PROFESIONAL,
  diaSemana: 1,
  horaDesde: '09:00',
  horaHasta: '12:00',
  vigenciaDesde: '2026-01-05',
  estado: 'ACTIVO',
  version: 1,
  turnosAfectados: 0,
};

/**
 * Tarde del lunes, que <b>empieza donde termina la manana</b>.
 *
 * <p>Es el horario mas comun que existe y NO es un solapamiento: la hora de fin es exclusiva.
 * Si la pantalla lo tratara como conflicto, el error se veria en todos los centros reales.
 */
const LUNES_TARDE = {
  id: 101,
  consultorioId: SEDE,
  membershipId: PROFESIONAL,
  diaSemana: 1,
  horaDesde: '12:00',
  horaHasta: '15:00',
  vigenciaDesde: '2026-01-05',
  estado: 'ACTIVO',
  version: 1,
  turnosAfectados: 0,
};

/** El caso limite del contrato: llega hasta el final del dia, y eso se escribe `24:00`. */
const MARTES_NOCHE = {
  id: 102,
  consultorioId: SEDE,
  membershipId: PROFESIONAL,
  diaSemana: 2,
  horaDesde: '20:00',
  horaHasta: '24:00',
  vigenciaDesde: '2026-01-05',
  vigenciaHasta: null,
  estado: 'ACTIVO',
  version: 4,
  turnosAfectados: 0,
};

const HORARIO = [LUNES_MANANA, LUNES_TARDE, MARTES_NOCHE];

/**
 * Spec del horario semanal del profesional (M05, AKINE-02.04).
 *
 * <p>Cubre lo que, si se rompe, <b>no produce ningun error visible</b>:
 *
 * <ol>
 *   <li>Que dos bloques contiguos convivan. Un formulario que los rechace no falla: rechaza
 *       silenciosamente el horario mas comun que hay.</li>
 *   <li>Que la medianoche siga siendo el string `24:00` al mostrarla y al mandarla. Parseada a
 *       `Date` vuelve como `00:00` y el bloque pasa a durar cero minutos, con `200` del
 *       backend.</li>
 *   <li>Que el `409` de solapamiento senale <b>los dos</b> bloques. Un toast generico deja al
 *       administrador comparando horas a ojo, y la operacion parece rota sin estarlo.</li>
 * </ol>
 */
describe('HorarioSemanalPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  /** La query string con la que se abre la pantalla. Se lee al crear el componente. */
  let queryParams: Record<string, string> = {};

  beforeEach(async () => {
    queryParams = {};

    await TestBed.configureTestingModule({
      imports: [HorarioSemanalPage],
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

  it('la semana muestra los siete días y dos bloques contiguos conviven sin conflicto', async () => {
    const fixture = await montar();
    const contenido = texto(fixture);

    // Los siete, siempre. Saltear un dia sin bloques correria la grilla y el lector veria el
    // horario del jueves creyendo que es el del miercoles.
    expect(fixture.nativeElement.querySelectorAll('.dia').length).toBe(7);
    expect(contenido).toContain('Miercoles');
    expect(contenido).toContain('No atiende');

    // Manana y tarde del lunes, las dos presentes y ninguna marcada como conflicto.
    expect(contenido).toContain('09:00 a 12:00');
    expect(contenido).toContain('12:00 a 15:00');
    expect(fixture.nativeElement.querySelectorAll('.bloque--conflicto').length).toBe(0);
    expect(contenido).not.toContain('Este es el bloque con el que se pisa');

    // UX-14: el profesional y su semana en una sola tarjeta, con la cuenta en la barra.
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelectorAll('section.tarjeta').length).toBe(1);
    expect(host.querySelector('.filtros-barra__resultados')?.textContent?.trim()).toMatch(
      /^\d+ bloques? cargados?$/,
    );

    // El selector ofrece solo a quien puede tener horario en ESTA sede: ni la administrativa ni
    // el profesional acotado a la sede 99, cuyo alta terminaria siempre en 409.
    const opciones = [...fixture.nativeElement.querySelectorAll('#selector-profesional option')];
    expect(opciones.map((opcion) => (opcion as HTMLOptionElement).textContent?.trim())).toEqual([
      'Sin elegir',
      'Ana Kine',
    ]);
  });

  it('un bloque hasta la medianoche se muestra como 24:00 y se reenvia como 24:00', async () => {
    const fixture = await montar();

    // Se muestra el string del contrato, con su traduccion en palabras al lado: "24:00" a secas
    // se lee como un error de carga.
    expect(texto(fixture)).toContain('20:00 a medianoche (24:00)');

    // Y se puede volver a escribir: el campo es de texto justamente porque un `type="time"`
    // rechaza 24:00 y vacia el control sin decir nada.
    abrir(fixture, 'Agregar horario');
    seleccionar(fixture, '#alta-bloque-desde', '20:00');
    seleccionar(fixture, '#alta-bloque-hasta', '24:00');
    elegirDias(fixture, [3]);
    enviar(fixture, 'form');

    // Un solo pedido al lote, con el dia elegido y las horas tal cual (contrato 0.159.0).
    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === LOTE,
    );
    expect(alta.request.body).toEqual({ diasSemana: [3], horaDesde: '20:00', horaHasta: '24:00' });

    alta.flush(
      { bloques: [{ ...MARTES_NOCHE, id: 103, diaSemana: 3 }], creados: 1, existentes: 0 },
      { status: 201, statusText: 'Created' },
    );
    httpMock.expectOne(BLOQUES).flush(HORARIO);
    await estabilizar(fixture);

    expect(titulosDeAvisos()).toEqual(['Horario agregado']);
    expect(fixture.nativeElement.querySelector('app-panel-lateral')).toBeNull();
  });

  it('un 409 de solapamiento muestra los dos bloques que chocan, no un cartel generico', async () => {
    const fixture = await montar();

    abrir(fixture, 'Agregar horario');
    seleccionar(fixture, '#alta-bloque-desde', '10:00');
    seleccionar(fixture, '#alta-bloque-hasta', '11:00');
    enviar(fixture, 'form');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === LOTE,
      )
      .flush(
        {
          type: 'https://akine.app/problems/bloque-solapado',
          bloqueEnConflictoId: LUNES_MANANA.id,
          diaSemana: 1,
          horaDesde: '10:00',
          horaHasta: '11:00',
          conflictoHoraDesde: '09:00',
          conflictoHoraHasta: '12:00',
          conflictoMismaSede: true,
        },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);

    const contenido = texto(fixture);

    // 1. El mensaje NOMBRA el otro bloque, en una linea: sin esto hay que recorrer la semana
    //    comparando horas. Que contiguo no es solapado lo explica la ayuda "?", no el error.
    expect(contenido).toContain('Ya existe un horario para el lunes de 09:00 a 12:00');
    expect(contenido).not.toContain('conviven');

    // 3. La fila del bloque en conflicto queda senalada, y SOLO esa. El color no es lo unico
    //    que la distingue: dentro de la fila hay un texto que lo dice.
    const marcados = [...fixture.nativeElement.querySelectorAll('.bloque--conflicto')];
    expect(marcados.length).toBe(1);
    expect(marcados[0].textContent).toContain('09:00 a 12:00');
    expect(marcados[0].textContent).toContain('Este es el bloque con el que se pisa');

    // 4. El panel sigue abierto con lo escrito: la correccion es sobre eso mismo.
    expect(campo(fixture, '#alta-bloque-desde')).toBe('10:00');

    // 5. El choque es el unico mensaje de la fila de horas, y los dos selectores lo describen.
    const error = fixture.nativeElement.querySelector('#alta-bloque-horas-error');
    expect(error?.textContent).toContain('Ya existe un horario para el lunes');
    for (const selector of ['#alta-bloque-desde', '#alta-bloque-hasta']) {
      const control = fixture.nativeElement.querySelector(selector);
      expect(control?.getAttribute('aria-invalid')).toBe('true');
      expect(control?.getAttribute('aria-describedby')).toBe('alta-bloque-horas-error');
    }
  });

  it('la baja pide motivo antes de enviar nada a la red', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de baja');

    // La irreversibilidad se dice ANTES de confirmar: el contrato no publica reactivacion.
    expect(texto(fixture)).toContain('no se puede deshacer');

    // La consulta previa sale al abrir el panel (A-11): no hay nada que escribir antes.
    httpMock.expectOne(`${BLOQUES}/${LUNES_MANANA.id}/impacto-de-baja`).flush({
      turnosAfectados: 2,
      primerTurnoAfectado: '2026-10-12T12:00:00Z',
      turnos: [
        {
          turnoId: 900,
          membershipId: PROFESIONAL,
          inicio: '2026-10-12T12:00:00Z',
          fin: '2026-10-12T12:30:00Z',
        },
        {
          turnoId: 901,
          membershipId: PROFESIONAL,
          inicio: '2026-10-19T12:00:00Z',
          fin: '2026-10-19T12:30:00Z',
        },
      ],
      evaluadoHasta: '2027-01-06',
    });
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Turnos afectados: 2.');
    expect(fixture.nativeElement.querySelectorAll('app-impacto-previo li').length).toBe(2);
    expect(texto(fixture)).toContain('hasta el 5 de enero de 2027 inclusive');
    // La cuenta es exacta desde A-11: el texto de cota superior no puede volver.
    expect(texto(fixture)).not.toContain('cota superior');

    // Sin motivo NO sale a la red. El backend lo exige igual, y gastar un rechazo del servidor
    // para decir algo que ya se sabe deja al usuario esperando un viaje de ida y vuelta.
    enviar(fixture, 'akine-confirmacion-con-motivo form');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'DELETE');
    expect(texto(fixture)).toContain('El motivo es obligatorio');

    escribir(fixture, '#baja-bloque-reason', 'Dejo de atender los lunes a la mañana');
    enviar(fixture, 'akine-confirmacion-con-motivo form');

    const baja = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'DELETE',
    );
    expect(baja.request.url).toBe(`${BLOQUES}/${LUNES_MANANA.id}`);
    // Ya se vio que deja turnos afuera: la baja los confirma (contrato 0.154.0).
    expect(baja.request.body).toEqual({
      reason: 'Dejo de atender los lunes a la mañana',
      confirmaTurnosAfectados: true,
    });

    baja.flush({ ...LUNES_MANANA, estado: 'INACTIVO', turnosAfectados: 3 });
    httpMock.expectOne(BLOQUES).flush([LUNES_TARDE, MARTES_NOCHE]);
    await estabilizar(fixture);

    const [exito, turnos] = TestBed.inject(AvisosStore).avisos();
    expect(exito?.titulo).toBe('Bloque dado de baja');
    expect(exito?.descripcion).toContain('Sobrevive con su motivo');
    // Manda el numero de la mutacion, y si difiere de la consulta previa se dice por que. Es una
    // advertencia que queda hasta que la cierren: hay turnos que revisar en la agenda.
    expect(turnos?.tipo).toBe('advertencia');
    expect(turnos?.titulo).toBe('Turnos para revisar');
    expect(turnos?.duracion).toBeNull();
    expect(turnos?.descripcion).toContain(
      '3 turnos pendientes de este profesional en la sede quedaron',
    );
    expect(turnos?.descripcion).toContain('La consulta previa habia calculado 2');
  });

  it('la edicion manda solo lo que cambio, y siempre la versión', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');

    // El formulario carga las horas TAL CUAL llegaron, sin reformatear.
    expect(campo(fixture, '#editar-bloque-desde')).toBe('09:00');

    seleccionar(fixture, '#editar-bloque-dia', '4');
    enviar(fixture, 'form');

    // Primero la consulta sin efectos, con el mismo cuerpo y SIN version. Sin turnos afectados
    // la edicion sigue de largo: no hay nada que confirmar.
    const consulta = httpMock.expectOne(`${BLOQUES}/${LUNES_MANANA.id}/impacto-de-edicion`);
    expect(consulta.request.body).toEqual({ diaSemana: 4 });
    consulta.flush({ turnosAfectados: 0, turnos: [], evaluadoHasta: '2027-01-06' });

    const edicion = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'PUT',
    );

    // Solo el dia y la version. Las horas y la vigencia no viajan: omitido significa "no lo
    // toques", y reenviarlas pisaria lo que otro haya cambiado en el medio.
    expect(edicion.request.body).toEqual({ version: 1, diaSemana: 4 });

    edicion.flush({ ...LUNES_MANANA, diaSemana: 4, version: 2 });
    httpMock.expectOne(BLOQUES).flush(HORARIO);
    await estabilizar(fixture);

    // Sin turnos afectados no hay aviso de turnos que hacer.
    expect(titulosDeAvisos()).toEqual(['Cambios del bloque guardados']);
  });

  it('un 409 con turnos afectados muestra la lista y el reenvío confirma (contrato 0.154.0)', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    seleccionar(fixture, '#editar-bloque-dia', '4');
    enviar(fixture, 'form');

    httpMock
      .expectOne(`${BLOQUES}/${LUNES_MANANA.id}/impacto-de-edicion`)
      .flush({ turnosAfectados: 0, turnos: [], evaluadoHasta: '2027-01-06' });
    // Entre la consulta y el guardado entro un turno: el backend lo rechaza con la lista.
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'PUT')
      .flush(
        {
          type: 'https://akine.app/problems/bloqueo-con-turnos-afectados',
          status: 409,
          turnosAfectados: 1,
          turnos: [
            {
              turnoId: 900,
              membershipId: PROFESIONAL,
              personaNombre: 'Perez, Ana',
              inicio: '2026-10-12T14:00:00Z',
              fin: '2026-10-12T14:30:00Z',
            },
          ],
        },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Turnos afectados: 1.');
    expect(texto(fixture)).toContain('Perez, Ana');
    abrir(fixture, 'Guardar igual');

    const confirmada = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'PUT',
    );
    expect(confirmada.request.body).toEqual({
      version: 1,
      diaSemana: 4,
      confirmaTurnosAfectados: true,
    });
    confirmada.flush({ ...LUNES_MANANA, diaSemana: 4, version: 2 });
    httpMock.expectOne(BLOQUES).flush(HORARIO);
    await estabilizar(fixture);
  });

  it('una baja sin turnos previstos que el backend rechaza con la lista la muestra y confirma al reenviar', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de baja');
    httpMock
      .expectOne(`${BLOQUES}/${LUNES_MANANA.id}/impacto-de-baja`)
      .flush({ turnosAfectados: 0, turnos: [], evaluadoHasta: '2027-01-06' });
    await estabilizar(fixture);

    escribir(fixture, '#baja-bloque-reason', 'Cambia de horario');
    enviar(fixture, 'akine-confirmacion-con-motivo form');

    const baja = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'DELETE',
    );
    // La consulta dijo cero: no hay nada que confirmar todavia.
    expect(baja.request.body).toEqual({ reason: 'Cambia de horario' });
    baja.flush(
      {
        type: 'https://akine.app/problems/bloqueo-con-turnos-afectados',
        status: 409,
        turnosAfectados: 1,
        turnos: [
          {
            turnoId: 905,
            membershipId: PROFESIONAL,
            personaNombre: 'Gomez, Juan',
            inicio: '2026-10-12T12:00:00Z',
            fin: '2026-10-12T12:30:00Z',
          },
        ],
      },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Gomez, Juan');
    expect(texto(fixture)).toContain('Este cambio deja turnos fuera del horario');
    expect(titulosDeAvisos()).toEqual([]);

    // Ya se vio la lista: el reenvio confirma.
    enviar(fixture, 'akine-confirmacion-con-motivo form');
    const confirmada = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'DELETE',
    );
    expect(confirmada.request.body).toEqual({
      reason: 'Cambia de horario',
      confirmaTurnosAfectados: true,
    });
    confirmada.flush({ ...LUNES_MANANA, estado: 'INACTIVO', turnosAfectados: 1 });
    httpMock.expectOne(BLOQUES).flush([LUNES_TARDE, MARTES_NOCHE]);
    await estabilizar(fixture);
    expect(titulosDeAvisos()).toContain('Bloque dado de baja');
  });

  it('con agenda:horario propio, el horario de otro profesional se mira y no se toca', async () => {
    (TestBed.inject(PerfilPropioStore) as unknown as { membershipId: unknown }).membershipId =
      signal(7);
    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({
      permissions: [PERMISO_AGENDA_HORARIO],
      ownScopedPermissions: [PERMISO_AGENDA_HORARIO],
    });
    const fixture = TestBed.createComponent(HorarioSemanalPage);
    fixture.detectChanges();
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaMemberships(ORG))
      .flush({ content: [ANA], page: 0, size: 100, totalElements: 1, totalPages: 1 });
    await estabilizar(fixture);

    // Sin profesional elegido todavia no hay nada ajeno.
    expect(texto(fixture)).not.toContain('cambiar solo el tuyo');

    seleccionar(fixture, '#selector-profesional', String(PROFESIONAL));
    httpMock.expectOne(BLOQUES).flush(HORARIO);
    await estabilizar(fixture);

    expect(texto(fixture)).toContain(
      'podés consultar el horario de otros profesionales, pero cambiar solo el tuyo',
    );
    const rotulos = [...fixture.nativeElement.querySelectorAll('button')].map((b) =>
      (b.textContent ?? '').trim(),
    );
    expect(rotulos).not.toContain('Agregar horario');
    expect(rotulos).not.toContain('Editar');
  });

  it('un rango invertido no sale a la red, y volver a "Sin elegir" vacía la semana', async () => {
    const fixture = await montar();

    abrir(fixture, 'Agregar horario');
    seleccionar(fixture, '#alta-bloque-desde', '15:00');
    seleccionar(fixture, '#alta-bloque-hasta', '09:00');
    enviar(fixture, 'form');

    // Un bloque nunca cruza al dia siguiente: el backend lo rechazaria con 400 y gastar ese
    // viaje no aporta nada.
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect(texto(fixture)).toContain('La hora de fin debe ser posterior al inicio');

    // Y una hora mal escrita en el campo de hora exacta se senala en la fila, en una linea.
    seleccionar(fixture, '#alta-bloque-desde', 'otra');
    escribir(fixture, '#alta-bloque-desde-exacta', '9:00');
    enviar(fixture, 'form');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect(texto(fixture)).toContain('Ingresá una hora válida');

    // Deseleccionar vuelve al estado inicial sin consultar nada: la semana que quedaba en
    // pantalla era de un profesional que ya no esta elegido.
    seleccionar(fixture, '#selector-profesional', '');
    expect(texto(fixture)).toContain('Elegí un profesional para ver su horario semanal');
  });

  it('un bloque dado de baja no se edita: el formulario queda deshabilitado', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    seleccionar(fixture, '#editar-bloque-dia', '5');
    enviar(fixture, 'form');

    // La consulta previa ya lo sabe: el PUT no llega a salir.
    httpMock
      .expectOne(`${BLOQUES}/${LUNES_MANANA.id}/impacto-de-edicion`)
      .flush(
        { type: 'https://akine.app/problems/bloque-inactivo' },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);

    // Dejar el formulario activo invitaria a reenviar algo que ya sabemos que va a fallar.
    expect(texto(fixture)).toContain('La baja no se deshace');
    const dia: HTMLSelectElement | null = fixture.nativeElement.querySelector('#editar-bloque-dia');
    expect(dia?.disabled).toBe(true);
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'PUT');
  });

  it('una edicion que deja turnos afuera los muestra y espera "Guardar igual"', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    seleccionar(fixture, '#editar-bloque-hasta', '11:00');
    enviar(fixture, 'form');

    httpMock.expectOne(`${BLOQUES}/${LUNES_MANANA.id}/impacto-de-edicion`).flush({
      turnosAfectados: 1,
      turnos: [
        {
          turnoId: 900,
          membershipId: PROFESIONAL,
          inicio: '2026-10-12T14:00:00Z',
          fin: '2026-10-12T14:30:00Z',
        },
      ],
      evaluadoHasta: '2027-01-06',
    });
    await estabilizar(fixture);

    // No guarda solo: muestra el numero y la lista, y el boton cambia de sentido.
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'PUT');
    expect(texto(fixture)).toContain('Turnos afectados: 1.');
    expect(texto(fixture)).toContain('1 turno pendiente queda fuera de horario');
    abrir(fixture, 'Guardar igual');

    const edicion = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'PUT',
    );
    expect(edicion.request.body).toEqual({
      version: 1,
      horaHasta: '11:00',
      confirmaTurnosAfectados: true,
    });
    edicion.flush({ ...LUNES_MANANA, horaHasta: '11:00', version: 2, turnosAfectados: 1 });
    httpMock.expectOne(BLOQUES).flush(HORARIO);
    await estabilizar(fixture);

    // Coincide con lo previsto: se informa el numero, sin hablar de diferencias.
    const turnos = TestBed.inject(AvisosStore)
      .avisos()
      .find((aviso) => aviso.titulo === 'Turnos para revisar');
    expect(turnos?.descripcion).toContain('1 turno pendiente de este profesional en la sede quedo');
    expect(turnos?.descripcion).not.toContain('La consulta previa habia calculado');
  });

  it('si la consulta previa falla por otra causa, lo dice y deja guardar igual', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de baja');
    httpMock
      .expectOne(`${BLOQUES}/${LUNES_MANANA.id}/impacto-de-baja`)
      .flush({}, { status: 500, statusText: 'Server Error' });
    await estabilizar(fixture);

    // Nunca "ningun turno afectado": no saber no es cero.
    expect(texto(fixture)).toContain('No pudimos calcular de antemano');
    expect(texto(fixture)).not.toContain('Ningún turno pendiente');

    escribir(fixture, '#baja-bloque-reason', 'Cierre de la franja');
    enviar(fixture, 'akine-confirmacion-con-motivo form');
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'DELETE')
      .flush({ ...LUNES_MANANA, estado: 'INACTIVO', turnosAfectados: 0 });
    httpMock.expectOne(BLOQUES).flush([LUNES_TARDE, MARTES_NOCHE]);
    await estabilizar(fixture);

    expect(titulosDeAvisos()).toEqual(['Bloque dado de baja']);
  });

  it('si el listado de profesionales falla, se puede reintentar sin recargar la página', async () => {
    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(HorarioSemanalPage);
    fixture.detectChanges();

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaMemberships(ORG))
      .flush(
        { type: 'https://akine.app/problems/internal-error' },
        { status: 500, statusText: 'X' },
      );
    await estabilizar(fixture);

    // No se pide ningun horario: sin selector no hay profesional que consultar.
    httpMock.expectNone((peticion: HttpRequest<unknown>) =>
      peticion.url.includes('/disponibilidad'),
    );
    expect(fixture.nativeElement.querySelector('#selector-profesional')).toBeNull();

    abrir(fixture, 'Reintentar');
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaMemberships(ORG))
      .flush({ content: [ANA], page: 0, size: 100, totalElements: 1, totalPages: 1 });
    await estabilizar(fixture);

    expect(fixture.nativeElement.querySelector('#selector-profesional')).not.toBeNull();
    // Sin `consultorio:manage` no se ofrece ninguna accion que termine en 403.
    expect(texto(fixture)).not.toContain('Agregar horario');
  });

  /**
   * Lo que fallo es una LECTURA de colaboradores, no una mutacion del horario.
   *
   * <p>El traductor de bloques redacta su 403 desde la mutacion —"no tenes permiso para
   * administrar el horario"— y este endpoint pide `colaborador:read`. Quien administre el centro
   * lee ese cartel y otorga `consultorio:manage`, que no destraba nada. Es el mismo arreglo que
   * el horario efectivo ya tenia.
   */
  it('un 403 al leer los colaboradores nombra colaborador:read, no "administrar el horario"', async () => {
    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(HorarioSemanalPage);
    fixture.detectChanges();

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaMemberships(ORG))
      .flush(
        { type: 'https://akine.app/problems/forbidden', detail: 'Sin permiso' },
        { status: 403, statusText: 'Forbidden' },
      );
    await estabilizar(fixture);

    const contenido = texto(fixture);
    expect(contenido).toContain('colaborador:read');
    expect(contenido).not.toContain('administrar el horario');
  });

  /**
   * El numero del bloque tiene que verse, porque otra pantalla lo NOMBRA.
   *
   * <p>El horario efectivo explica cada franja con "la produjo el horario semanal, bloque numero
   * 100". Con dos bloques parecidos en el mismo dia, esa frase no identifica ninguno si la
   * grilla no muestra el numero.
   */
  it('cada bloque muestra su número: es la referencia que usa el horario efectivo', async () => {
    const fixture = await montar();
    const contenido = texto(fixture);

    expect(contenido).toContain('bloque número 100');
    expect(contenido).toContain('bloque número 101');
    expect(contenido).toContain('bloque número 102');
  });

  /** Venir desde una explicacion del horario efectivo abre la semana de esa persona. */
  it('con un profesional elegido ofrece ver su agenda y darle un turno', async () => {
    const fixture = await montar([PERMISO_TURNO_READ, PERMISO_TURNO_MANAGE]);
    const raiz = fixture.nativeElement as HTMLElement;

    expect(
      raiz.querySelector(`a[href="/agenda?profesional=${PROFESIONAL}"]`)?.textContent,
    ).toContain('Ver agenda');

    Array.from(raiz.querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').trim() === 'Nuevo turno')
      ?.click();

    expect(TestBed.inject(FlujoDeTurnosStore).solicitud()).toEqual({
      tipo: 'nuevo',
      contexto: { origen: 'PROFESIONAL', profesionalId: PROFESIONAL },
    });
  });

  it('sin permisos de turnos no ofrece ni la agenda ni el turno', async () => {
    const fixture = await montar();

    expect(texto(fixture)).not.toContain('Ver agenda');
    expect(texto(fixture)).not.toContain('Nuevo turno');
  });

  it('un enlace con profesional abre su horario sin volver a elegirlo en la lista', async () => {
    queryParams = { membershipId: String(PROFESIONAL) };

    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(HorarioSemanalPage);
    fixture.detectChanges();

    // El horario sale sin esperar a la lista de vinculos: son dos peticiones independientes.
    httpMock.expectOne(BLOQUES).flush(HORARIO);
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaMemberships(ORG))
      .flush({ content: [ANA], page: 0, size: 100, totalElements: 1, totalPages: 1 });
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('09:00 a 12:00');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
        '#selector-profesional',
      )?.value,
    ).toBe(String(PROFESIONAL));
  });

  /**
   * "No hay profesionales" no se afirma sobre una nomina recortada.
   *
   * <p>`listMemberships` no filtra por sede y el backend recorta la pagina en cien. Si los cien
   * primeros vinculos de una organizacion grande no incluyen a ninguno de esta sede, la pantalla
   * decia "no hay profesionales con un vinculo vigente", que es falso y manda a Colaboradores a
   * arreglar vinculos que estan perfectos.
   */
  it('con la nomina recortada no afirma que no haya profesionales: dice que la lista puede faltar', async () => {
    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(HorarioSemanalPage);
    fixture.detectChanges();

    // Cien vinculos que llegaron, ninguno profesional de esta sede, y 250 en total.
    const relleno = Array.from({ length: 100 }, (_, indice) => ({
      ...RECEPCION,
      id: 1000 + indice,
    }));

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaMemberships(ORG))
      .flush({ content: relleno, page: 0, size: 100, totalElements: 250, totalPages: 3 });
    await estabilizar(fixture);

    const contenido = texto(fixture);
    expect(contenido).not.toContain('No hay profesionales con un vinculo vigente');
    expect(contenido).toContain('la lista puede estar incompleta');
    // El selector sigue en pie: los que llegaron se pueden elegir igual.
    expect(fixture.nativeElement.querySelector('#selector-profesional')).not.toBeNull();
  });

  it('sin sede elegida no consulta ningún horario y ofrece elegir consultorio', async () => {
    // Contexto con organizacion pero SIN sede: el horario cuelga de una sede concreta.
    tenantContext.select({ organizationId: ORG, organizationName: 'Belgrano' });

    const fixture = TestBed.createComponent(HorarioSemanalPage);
    fixture.detectChanges();
    await estabilizar(fixture);

    httpMock.expectNone((peticion: HttpRequest<unknown>) =>
      peticion.url.includes('/disponibilidad'),
    );
    httpMock.match(RUTA_PERMISOS_EFECTIVOS).forEach((p) => p.flush({ permissions: [] }));

    const contenido = texto(fixture);
    expect(contenido).toContain('Todavía no elegiste un consultorio');
    // La salida es elegir sede, NO re-autenticarse: las credenciales estan bien.
    expect(contenido).toContain('Tu sesión sigue abierta');
    expect(fixture.nativeElement.querySelector('a[href="/seleccionar-contexto"]')).not.toBeNull();
  });

  it(
    'la pantalla no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  /** Monta la pantalla con contexto, permiso de gestion, el selector cargado y Ana elegida. */
  async function montar(
    otrosPermisos: readonly string[] = [],
  ): Promise<ComponentFixture<HorarioSemanalPage>> {
    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock
      .expectOne(RUTA_PERMISOS_EFECTIVOS)
      .flush({ permissions: [PERMISO_AGENDA_HORARIO, ...otrosPermisos] });

    const fixture = TestBed.createComponent(HorarioSemanalPage);
    fixture.detectChanges();

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaMemberships(ORG))
      .flush({
        content: [ANA, RECEPCION, OTRA_SEDE],
        page: 0,
        size: 100,
        totalElements: 3,
        totalPages: 1,
      });
    await estabilizar(fixture);

    seleccionar(fixture, '#selector-profesional', String(PROFESIONAL));

    httpMock.expectOne(BLOQUES).flush(HORARIO);
    await estabilizar(fixture);

    return fixture;
  }
});

async function estabilizar(fixture: ComponentFixture<HorarioSemanalPage>): Promise<void> {
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
    throw new Error(`No existe el botón ${etiqueta}`);
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

function enviar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string) {
  const formulario = (fixture.nativeElement as HTMLElement).querySelector<HTMLFormElement>(
    selector,
  );
  // Falla cerrado. Con `?.` este helper se volvia un no-op silencioso ante un selector que
  // no casa, y TODOS los `expectNone` del spec pasaban sin que se enviara nada: el spec
  // quedaba verde afirmando que la pantalla no sale a la red.
  if (formulario === null) {
    throw new Error(`No existe el formulario ${selector}`);
  }
  formulario.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}

function campo(fixture: { nativeElement: HTMLElement }, selector: string): string {
  return (
    (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(selector)?.value ?? ''
  );
}

/** Titulos de los avisos globales publicados (UX-12): el shell los dibuja, el spec mira el store. */
function titulosDeAvisos(): string[] {
  return TestBed.inject(AvisosStore)
    .avisos()
    .map((aviso) => aviso.titulo);
}

/**
 * Elige exactamente esos dias en el alta: pasa al modo personalizado y deja marcadas solo esas
 * pastillas. Las pastillas son casillas nativas: se marcan con un click.
 */
function elegirDias(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  dias: readonly number[],
) {
  const host = fixture.nativeElement as HTMLElement;
  // El `[value]` del radio lo administra Angular y no llega al DOM: se busca por su rotulo.
  const personalizado =
    [...host.querySelectorAll<HTMLLabelElement>('label.pastilla')]
      .find((pastilla) => (pastilla.textContent ?? '').trim() === 'Personalizado')
      ?.querySelector<HTMLInputElement>('input[name="modoDias"]') ?? null;
  if (personalizado === null) {
    throw new Error('No existe la opción Personalizado');
  }
  personalizado.click();
  fixture.detectChanges();
  for (let dia = 1; dia <= 7; dia++) {
    const casilla = host.querySelector<HTMLInputElement>(`#alta-bloque-dia-${dia}`);
    if (casilla === null) {
      throw new Error(`No existe la pastilla del día ${dia}`);
    }
    if (casilla.checked !== dias.includes(dia)) {
      casilla.click();
      fixture.detectChanges();
    }
  }
}
