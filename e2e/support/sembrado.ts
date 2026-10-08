import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  APIRequestContext,
  APIResponse,
  expect,
  request as fabricaDeRequest,
} from '@playwright/test';

import { PASSWORD, emailUnico, esperarCupoDeRegistro, nonce } from './akine';

/**
 * Sembrado por la API REAL para los E2E de agenda, ciclo del turno y recepcion (AKINE E-2).
 *
 * <h2>Por que todo pasa por la API y nada por SQL</h2>
 *
 * <p>Los E2E de agenda de 05.01/05.02 sintetizaban las respuestas con `route.fulfill` porque
 * "el backend real no produce a pedido" los conflictos. Resulto que si los produce, y sin tocar
 * la base: `slot-completo` es reservar el mismo horario dos veces, `recurso-ocupado` es reservar
 * al mismo profesional desde otra oferta, `slot-no-disponible` es una excepcion de cierre cargada
 * despues de leer la agenda, y `persona-sin-perfil-paciente` es una persona del padron sin perfil.
 * Todo eso se monta con los mismos endpoints que usa la aplicacion, asi que lo que se prueba es
 * el producto y no el sembrado.
 *
 * <p>Tampoco la activacion de la cuenta pasa por SQL, a diferencia de `support/akine.ts`: con el
 * perfil `local` el backend manda el correo por SMTP a <b>Mailpit</b>, y el enlace se lee de su
 * API. Es el mismo camino que recorre una persona.
 *
 * <h2>Un centro por corrida, un dia por test</h2>
 *
 * <p>El alta self-service esta limitada a 5 por minuto y por IP, asi que el centro (cuenta
 * administradora, profesional, disponibilidad) se siembra UNA vez, en el proyecto `agenda-setup`,
 * y se comparte por archivo. Cada test crea lo suyo encima —su oferta, sus personas, sus turnos—
 * y trabaja en <b>su propio dia</b> ({@link DIAS}): el profesional es uno solo, y dos tests en el
 * mismo dia se ocuparian el horario entre si.
 *
 * <p>El profesional atiende de 00:00 a 23:45 los siete dias. No es realista y es a proposito: la
 * recepcion necesita un turno HOY a una hora todavia futura, y con una franja corta la suite solo
 * podria correr de mañana.
 */

/** Backend directo, sin el proxy de dev: el sembrado no es parte de lo que se prueba. */
export const API = process.env['AKINE_E2E_API'] ?? 'http://localhost:8080';

/** API HTTP de Mailpit (contenedor `akine-mailpit` de `appKine-api/compose.yaml`). */
export const MAILPIT = process.env['AKINE_E2E_MAILPIT'] ?? 'http://localhost:8025';

const ARCHIVO_DEL_CENTRO = nodePath.join(nodeOs.tmpdir(), 'akine-e2e-centro-agenda.json');

/**
 * Dia de trabajo de cada test, como desplazamiento desde HOY en la fecha local de la sede.
 *
 * <p>Centralizado para que dos tests no compartan dia por descuido: el profesional es uno solo y
 * un turno de un test le ocuparia el horario al otro (`recurso-ocupado`, o un slot `Completo` que
 * el otro no esperaba). El 0 es de la recepcion, que solo opera turnos del dia.
 *
 * <p>Cada valor es el comienzo de un BLOQUE de tres dias y no un dia fijo: el backend trae cargado
 * el calendario de feriados nacionales, y un dia fijo cae tarde o temprano en uno (el 12 de
 * octubre lo hizo en la primera corrida). El test usa el primer dia del bloque con turnos.
 */
export const DIAS = {
  recepcion: 0,
  reservaFeliz: 2,
  reservaCompleto: 5,
  reservaNoDisponible: 8,
  reservaRecursoOcupado: 11,
  reservaSinPerfil: 14,
  reservaDobleClick: 17,
  buscadorSlotCompleto: 20,
  cicloCancelar: 23,
  cicloReprogramar: 26,
  cicloConflicto: 29,
  // El buscador de motivos necesita cinco dias habiles seguidos y los busca desde aca.
  buscadorMotivos: 40,
} as const;

/** Cada test busca su dia dentro de su bloque: ver {@link diaDeTrabajo}. */
const LARGO_DEL_BLOQUE = 3;

/** Lo que el proyecto `agenda-setup` deja escrito para el resto de la corrida. */
export interface Centro {
  readonly emailAdmin: string;
  readonly organizationId: number;
  readonly consultorioId: number;
  readonly nombreCentro: string;
  readonly timezone: string;
  readonly servicioId: number;
  readonly profesional: { readonly membershipId: number; readonly nombre: string };
}

export interface Oferta {
  readonly id: number;
  readonly nombre: string;
  readonly version: number;
}

export interface Persona {
  readonly id: number;
  readonly nombre: string;
  readonly apellido: string;
}

export interface Slot {
  readonly desde: string;
  readonly hasta: string;
  readonly profesionalId?: number;
  readonly cupoTotal?: number;
  readonly cupoLibre?: number;
}

export interface DiaDeAgenda {
  readonly fecha: string;
  readonly motivoSinSlots?: string;
  readonly slots: readonly Slot[];
}

export interface Turno {
  readonly id: number;
  readonly inicio: string;
  readonly fin: string;
  readonly estado: string;
  readonly version: number;
  readonly personaId: number;
}

// ---------------------------------------------------------------------------------------------
// Fechas y horas en la zona de la sede
// ---------------------------------------------------------------------------------------------

/** Fecha local `YYYY-MM-DD` de la sede, `dias` despues de hoy. */
export function fechaLocal(timezone: string, dias = 0): string {
  const hoy = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return sumarDias(hoy, dias);
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** `09:00` en la zona de la sede, en reloj de 24 horas. */
export function hora(instante: string, timezone: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).format(new Date(instante));
}

/** `09:00 a 09:45`, el mismo texto que dibuja la grilla. */
export function rango(slot: Slot, timezone: string): string {
  return `${hora(slot.desde, timezone)} a ${hora(slot.hasta, timezone)}`;
}

/** Literal de un `type` de Problem Details. Lo verifica `npm run api:check` contra el contrato. */
export function uriDeProblema(slug: string): string {
  return `https://akine.app/problems/${slug}`;
}

// ---------------------------------------------------------------------------------------------
// Logins de la misma cuenta, de a uno
// ---------------------------------------------------------------------------------------------

const CERROJO_DE_LOGIN = nodePath.join(nodeOs.tmpdir(), 'akine-e2e-login-agenda.lock');

/**
 * Ejecuta `accion` sin ningun otro login de la cuenta compartida en curso, en ningun worker.
 *
 * <p><b>Rodeo de un defecto del backend, no una preferencia.</b> Dos logins simultaneos de la misma
 * cuenta chocan: el login reescribe la fila `cuenta` (`ultimo_login_en`) con `@Version`, y de
 * cinco logins en paralelo uno entra, otro recibe 409 `concurrent-modification` y tres reciben
 * 500 por deadlock de InnoDB. Medido el 07/10/2026 contra `main` (contrato 0.67.0). Le pasa a
 * cualquier persona que abra AKINE en dos dispositivos a la vez; aca le pasaba a dos workers.
 *
 * <p>`mkdir` es atomico entre procesos. Un cerrojo huerfano de mas de 60 s se fuerza.
 */
export async function deAUnLogin<T>(accion: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      nodeFs.mkdirSync(CERROJO_DE_LOGIN);
      break;
    } catch {
      try {
        if (Date.now() - nodeFs.statSync(CERROJO_DE_LOGIN).mtimeMs > 60_000) {
          nodeFs.rmSync(CERROJO_DE_LOGIN, { recursive: true, force: true });
        }
      } catch {
        /* lo solto otro proceso entre medio */
      }
      await new Promise((resolver) => setTimeout(resolver, 100));
    }
  }
  try {
    return await accion();
  } finally {
    nodeFs.rmSync(CERROJO_DE_LOGIN, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Cliente HTTP con sesion
// ---------------------------------------------------------------------------------------------

/**
 * Cliente de la API autenticado como la administradora del centro, con contexto ya elegido.
 *
 * <p>El access token dura 10 minutos y una corrida puede durar mas: ante un 401 se vuelve a
 * ingresar una vez y se repite el pedido. Se ingresa una vez por worker y no una por test porque
 * login y refresh comparten un limite de 30 por minuto y por IP con el login por pantalla.
 */
export class ApiAkine {
  private token: string | null = null;

  private constructor(
    private readonly http: APIRequestContext,
    private readonly email: string,
  ) {}

  static async como(email: string): Promise<ApiAkine> {
    const http = await fabricaDeRequest.newContext({ baseURL: API });
    const api = new ApiAkine(http, email);
    await api.ingresar();
    return api;
  }

  async cerrar(): Promise<void> {
    await this.http.dispose();
  }

  private async ingresar(): Promise<void> {
    await deAUnLogin(() => this.ingresarSinCerrojo());
  }

  private async ingresarSinCerrojo(): Promise<void> {
    const login = await this.http.post('/api/v1/auth/login', {
      data: { email: this.email, password: PASSWORD },
    });
    expect(login.status(), `login de ${this.email}: ${await login.text()}`).toBe(200);
    const preContexto = ((await login.json()) as { accessToken: string }).accessToken;

    const contextos = await this.http.get('/api/v1/me/contexts', {
      headers: { authorization: `Bearer ${preContexto}` },
    });
    const [contexto] = (await contextos.json()) as {
      organizationId: number;
      consultorioId: number;
    }[];
    expect(contexto, `${this.email} tiene un contexto de trabajo`).toBeDefined();

    const elegido = await this.http.post('/api/v1/auth/context', {
      headers: { authorization: `Bearer ${preContexto}` },
      data: { organizationId: contexto.organizationId, consultorioId: contexto.consultorioId },
    });
    expect(elegido.status(), 'seleccion de contexto').toBe(200);
    this.token = ((await elegido.json()) as { accessToken: string }).accessToken;
  }

  /** Pedido crudo: devuelve la respuesta tal cual, para que el test afirme sobre los errores. */
  async pedir(
    metodo: 'GET' | 'POST' | 'PUT' | 'DELETE',
    ruta: string,
    cuerpo?: unknown,
  ): Promise<APIResponse> {
    const hacer = (): Promise<APIResponse> =>
      this.http.fetch(ruta, {
        method: metodo,
        headers: {
          authorization: `Bearer ${this.token ?? ''}`,
          accept: 'application/json, application/problem+json',
        },
        data: cuerpo,
      });
    let respuesta = await hacer();
    if (respuesta.status() === 401) {
      await this.ingresar();
      respuesta = await hacer();
    }
    return respuesta;
  }

  /** Pedido que tiene que salir bien; si no, falla nombrando la ruta y el cuerpo del error. */
  async exigir<T>(
    metodo: 'GET' | 'POST' | 'PUT' | 'DELETE',
    ruta: string,
    cuerpo?: unknown,
  ): Promise<T> {
    const respuesta = await this.pedir(metodo, ruta, cuerpo);
    expect(
      respuesta.ok(),
      `${metodo} ${ruta} respondio ${respuesta.status()}: ${await respuesta.text()}`,
    ).toBe(true);
    const texto = await respuesta.text();
    return (texto === '' ? undefined : JSON.parse(texto)) as T;
  }
}

// ---------------------------------------------------------------------------------------------
// Alta y activacion de cuentas
// ---------------------------------------------------------------------------------------------

async function registrar(
  http: APIRequestContext,
  datos: { email: string; firstName: string; lastName: string; organizationName: string },
): Promise<void> {
  await esperarCupoDeRegistro();
  const respuesta = await http.post('/api/v1/auth/register', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { ...datos, password: PASSWORD },
  });
  expect(respuesta.status(), `alta de ${datos.email}: ${await respuesta.text()}`).toBe(202);
}

/**
 * Activa una cuenta con el enlace que el backend le mando por correo.
 *
 * <p>Se busca el mensaje en Mailpit por destinatario y se canjea el `token` del enlace contra
 * `POST /auth/activate`, que es lo mismo que hace la pantalla `auth/activar`. El correo sale por
 * el outbox, asi que puede tardar unos segundos en llegar.
 */
export async function activarPorMailpit(http: APIRequestContext, email: string): Promise<void> {
  const correo = await fabricaDeRequest.newContext({ baseURL: MAILPIT });
  try {
    let token: string | undefined;
    await expect(async () => {
      const busqueda = await correo.get('/api/v1/search', {
        params: { query: `to:"${email}" subject:"Activa"` },
      });
      expect(busqueda.ok(), 'Mailpit responde (docker compose up -d en appKine-api)').toBe(true);
      const { messages } = (await busqueda.json()) as { messages: { ID: string }[] };
      expect(messages.length, `llego el correo de activacion a ${email}`).toBeGreaterThan(0);
      const mensaje = await correo.get(`/api/v1/message/${messages[0].ID}`);
      const { Text } = (await mensaje.json()) as { Text: string };
      token = /[?&]token=([A-Za-z0-9_-]+)/.exec(Text)?.[1];
      expect(token, 'el correo trae el enlace con su token').toBeDefined();
    }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });

    const activacion = await http.post('/api/v1/auth/activate', { data: { token } });
    expect(activacion.status(), `activacion de ${email}: ${await activacion.text()}`).toBe(204);
  } finally {
    await correo.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// El centro compartido
// ---------------------------------------------------------------------------------------------

/**
 * Siembra el centro de la corrida. Lo llama SOLO `agenda.setup.ts`.
 *
 * <p>Dos altas self-service: la administradora, que es con quien se opera, y una segunda cuenta
 * que se vincula como PROFESIONAL por `POST /memberships` (vincula a alguien ya registrado). La
 * profesional no necesita activarse: nunca ingresa, solo atiende en la agenda.
 */
export async function sembrarCentro(): Promise<Centro> {
  const http = await fabricaDeRequest.newContext({ baseURL: API });
  try {
    const sufijo = nonce();
    const emailAdmin = emailUnico('e2e.agenda.admin');
    const emailProfesional = emailUnico('e2e.agenda.profesional');
    const nombreCentro = `Centro Agenda E2E ${sufijo}`;

    await registrar(http, {
      email: emailAdmin,
      firstName: 'Ana',
      lastName: 'Recepcion',
      organizationName: nombreCentro,
    });
    await registrar(http, {
      email: emailProfesional,
      firstName: 'Pablo',
      lastName: `Kinesiologo ${sufijo}`,
      organizationName: `Consultorio Propio ${sufijo}`,
    });
    await activarPorMailpit(http, emailAdmin);

    const api = await ApiAkine.como(emailAdmin);
    try {
      const [contexto] = await api.exigir<{ organizationId: number; consultorioId: number }[]>(
        'GET',
        '/api/v1/me/contexts',
      );
      const { organizationId, consultorioId } = contexto;
      const sede = await api.exigir<{ timezone: string }>(
        'GET',
        `/api/v1/organizations/${organizationId}/consultorios/${consultorioId}`,
      );

      const { membershipId } = await api.exigir<{ membershipId: number }>(
        'POST',
        '/api/v1/memberships',
        {
          email: emailProfesional,
          roleCode: 'PROFESIONAL',
          consultorioId,
          reason: 'Profesional sintetico de los E2E de agenda',
        },
      );

      // De 00:00 a 23:45 los siete dias: ver la cabecera de este archivo.
      for (let diaSemana = 1; diaSemana <= 7; diaSemana++) {
        await api.exigir(
          'POST',
          `/api/v1/consultorios/${consultorioId}/profesionales/${membershipId}/disponibilidad`,
          {
            diaSemana,
            horaDesde: '00:00',
            horaHasta: '23:45',
          },
        );
      }

      const centro: Centro = {
        emailAdmin,
        organizationId,
        consultorioId,
        nombreCentro,
        timezone: sede.timezone,
        servicioId: await servicioAgendable(api),
        profesional: { membershipId, nombre: `Pablo Kinesiologo ${sufijo}` },
      };
      nodeFs.writeFileSync(ARCHIVO_DEL_CENTRO, JSON.stringify(centro));
      return centro;
    } finally {
      await api.cerrar();
    }
  } finally {
    await http.dispose();
  }
}

/**
 * Un servicio ACTIVO del catalogo global, que es de donde cuelga toda oferta.
 *
 * <p><b>Limite declarado:</b> crear un servicio exige rol de plataforma, y la unica forma de
 * tener esa cuenta en un despliegue nuevo es el bootstrap de DP-14 (`AKINE_BOOTSTRAP_ADMIN_EMAIL`).
 * Este sembrado no lo hace: usa el primer servicio activo que haya. Una base recien creada no
 * tiene ninguno, y ahi la suite falla aca, diciendo por que, en vez de fallar en cada test.
 */
async function servicioAgendable(api: ApiAkine): Promise<number> {
  const servicios = await api.exigir<{ id: number }[]>('GET', '/api/v1/servicios');
  expect(
    servicios.length,
    'El catalogo global no tiene ningun servicio ACTIVO y crearlo exige rol de plataforma. ' +
      'Arranca el backend con AKINE_BOOTSTRAP_ADMIN_EMAIL (DP-14), activa esa cuenta y da de ' +
      'alta un servicio en /plataforma antes de correr estos E2E.',
  ).toBeGreaterThan(0);
  return servicios[0].id;
}

/** El centro que sembro `agenda-setup` en esta corrida. */
export function leerCentro(): Centro {
  if (!nodeFs.existsSync(ARCHIVO_DEL_CENTRO)) {
    throw new Error(
      `No existe ${ARCHIVO_DEL_CENTRO}. Estos E2E dependen del proyecto agenda-setup: ` +
        'corre `npx playwright test --project=agenda` y no el archivo suelto.',
    );
  }
  return JSON.parse(nodeFs.readFileSync(ARCHIVO_DEL_CENTRO, 'utf8')) as Centro;
}

// ---------------------------------------------------------------------------------------------
// Lo que cada test siembra encima
// ---------------------------------------------------------------------------------------------

/**
 * Oferta propia del test, con nombre unico para poder elegirla del selector.
 *
 * <p>Por defecto habilita EXPLICITAMENTE al profesional del centro. Sin habilitaciones la oferta
 * la presta cualquier PROFESIONAL de la sede —la lista vacia significa "todos"— y la agenda
 * funciona igual, pero `GET /habilitaciones` no devuelve a nadie y las pantallas no tienen de
 * donde sacar el NOMBRE del profesional: el selector del buscador queda vacio y el resumen de la
 * reserva no dice quien atiende.
 *
 * <p>La contracara: la habilitacion nace AHORA, y el motor la evalua al mediodia local de cada
 * dia, asi que una habilitacion cargada a la tarde no vale para HOY. La recepcion, que trabaja
 * con turnos de hoy, pide `habilitarProfesional: false`.
 */
export async function crearOferta(
  api: ApiAkine,
  centro: Centro,
  opciones: {
    nombre?: string;
    duracionMinutos?: number;
    vigenciaHasta?: string;
    habilitarProfesional?: boolean;
  } = {},
): Promise<Oferta> {
  const nombre = opciones.nombre ?? `Kinesio E2E ${nonce()}`;
  const oferta = await api.exigir<{ id: number; version: number }>(
    'POST',
    `/api/v1/consultorios/${centro.consultorioId}/ofertas`,
    {
      servicioId: centro.servicioId,
      nombreComercial: nombre,
      capacidad: 1,
      duracionMinutos: opciones.duracionMinutos ?? 45,
      requiereProfesional: true,
      requiereEspacio: false,
      vigenciaHasta: opciones.vigenciaHasta,
    },
  );
  if (opciones.habilitarProfesional ?? true) {
    const habilitaciones = await api.exigir<{ ofertaVersion: number }>(
      'PUT',
      `/api/v1/consultorios/${centro.consultorioId}/ofertas/${oferta.id}/habilitaciones/profesionales`,
      { expectedVersion: oferta.version, ids: [centro.profesional.membershipId] },
    );
    return { id: oferta.id, nombre, version: habilitaciones.ofertaVersion };
  }
  return { id: oferta.id, nombre, version: oferta.version };
}

/** Persona del padron. Con `conPerfil` le activa el perfil de paciente, que es lo que se reserva. */
export async function crearPersona(
  api: ApiAkine,
  opciones: { conPerfil?: boolean; nombre?: string } = {},
): Promise<Persona> {
  const datos = { nombre: opciones.nombre ?? 'Luis', apellido: `Sintetico${nonce()}` };
  const persona = await api.exigir<{ id: number }>('POST', '/api/v1/personas', datos);
  if (opciones.conPerfil ?? true) {
    await api.exigir('POST', `/api/v1/personas/${persona.id}/perfil-paciente`, {});
  }
  return { id: persona.id, ...datos };
}

export async function agendaDe(
  api: ApiAkine,
  centro: Centro,
  ofertaId: number,
  desde: string,
  hasta: string = sumarDias(desde, 1),
): Promise<readonly DiaDeAgenda[]> {
  const agenda = await api.exigir<{ dias: DiaDeAgenda[] }>(
    'GET',
    `/api/v1/consultorios/${centro.consultorioId}/ofertas/${ofertaId}/agenda?desde=${desde}&hasta=${hasta}`,
  );
  return agenda.dias;
}

/** Los slots de un dia, en el orden de la grilla. Falla si el dia vino vacio. */
export async function slotsDelDia(
  api: ApiAkine,
  centro: Centro,
  ofertaId: number,
  fecha: string,
): Promise<readonly Slot[]> {
  const [dia] = await agendaDe(api, centro, ofertaId, fecha);
  expect(
    dia.slots.length,
    `el ${fecha} tiene slots (motivo: ${dia.motivoSinSlots})`,
  ).toBeGreaterThan(0);
  return dia.slots;
}

/** El primer dia con turnos del bloque que empieza en `desdeHoy` (ver {@link DIAS}). */
export async function diaDeTrabajo(
  api: ApiAkine,
  centro: Centro,
  ofertaId: number,
  desdeHoy: number,
): Promise<{ readonly fecha: string; readonly slots: readonly Slot[] }> {
  const desde = fechaLocal(centro.timezone, desdeHoy);
  const dias = await agendaDe(api, centro, ofertaId, desde, sumarDias(desde, LARGO_DEL_BLOQUE));
  const dia = dias.find((d) => d.slots.length > 0);
  expect(
    dia,
    `ningun dia de ${desde} a ${sumarDias(desde, LARGO_DEL_BLOQUE - 1)} tiene turnos: ` +
      dias.map((d) => `${d.fecha}=${d.motivoSinSlots}`).join(', '),
  ).toBeDefined();
  return { fecha: dia!.fecha, slots: dia!.slots };
}

/**
 * El primer dia desde `desdeHoy` que abre `largo` dias seguidos todos con turnos: una ventana sin
 * feriados en el medio. La da una oferta cualquiera, porque el feriado es de la sede.
 */
export async function ventanaHabil(
  api: ApiAkine,
  centro: Centro,
  ofertaId: number,
  desdeHoy: number,
  largo: number,
): Promise<string> {
  const desde = fechaLocal(centro.timezone, desdeHoy);
  const dias = await agendaDe(api, centro, ofertaId, desde, sumarDias(desde, largo + 14));
  for (let i = 0; i + largo <= dias.length; i++) {
    if (dias.slice(i, i + largo).every((d) => d.slots.length > 0)) {
      return dias[i].fecha;
    }
  }
  throw new Error(`no hay ${largo} dias habiles seguidos desde ${desde}`);
}

/** Reserva por la API. Devuelve la respuesta cruda: hay tests que esperan un 409. */
export function pedirReserva(
  api: ApiAkine,
  centro: Centro,
  ofertaId: number,
  personaId: number,
  inicio: string,
): Promise<APIResponse> {
  return api.pedir(
    'POST',
    `/api/v1/consultorios/${centro.consultorioId}/turnos/ofertas/${ofertaId}`,
    {
      inicio,
      personaId,
      profesionalId: centro.profesional.membershipId,
      idempotencyKey: randomUUID(),
    },
  );
}

export async function reservar(
  api: ApiAkine,
  centro: Centro,
  ofertaId: number,
  personaId: number,
  inicio: string,
): Promise<Turno> {
  const respuesta = await pedirReserva(api, centro, ofertaId, personaId, inicio);
  expect(respuesta.status(), `reserva de ${inicio}: ${await respuesta.text()}`).toBe(201);
  return (await respuesta.json()) as Turno;
}

/** Fila de un turno tal como la lee la recepcion (`GET /turnos/{id}`), con su recepcion. */
export function verTurno(
  api: ApiAkine,
  centro: Centro,
  turnoId: number,
): Promise<Turno & { recepcion?: { estado: string; modalidad?: string } }> {
  return api.exigir('GET', `/api/v1/consultorios/${centro.consultorioId}/turnos/${turnoId}`);
}
