import { Page, Request, Route } from '@playwright/test';

/**
 * Harness de los E2E de la vertical de turnos (M12, AKINE-05.01 y 05.02).
 *
 * <h2>Por que estos E2E simulan la API y los cuatro anteriores no</h2>
 *
 * <p>`auth-flujo`, `contexto-sin-fuga`, `errores-sin-internals` y `smoke` golpean el stack real
 * —backend en 8080 y MySQL en Docker— y eso esta bien para lo que prueban: que la cadena
 * completa se habla y que la sesion es real. Esta suite prueba <b>otra cosa</b>, y por eso
 * necesita otra herramienta.
 *
 * <p>Lo que la vertical de turnos tiene para ofrecer que ningun test unitario cubre son
 * <b>los caminos que fallan</b>: los cuatro conflictos de la reserva, el dia sin slots con su
 * motivo, la ventana recortada. Todos son <b>respuestas puntuales del servidor que el backend
 * real no produce a pedido</b>: `slot-completo` exige que alguien mas llene el cupo entre la
 * lectura y la escritura, y `recurso-ocupado` exige un turno cruzado que hay que sembrar por SQL
 * en tablas que 05.02 acaba de crear. Con el stack real, esos seis escenarios o no se pueden
 * montar o se montan sembrando tanto estado que lo que termina probandose es el sembrado.
 *
 * <p><b>Lo que si es real aca:</b> el navegador, el router de Angular, los guards, los signals,
 * el cliente generado, los interceptores y las dos pantallas enteras. Lo unico sintetico es la
 * respuesta HTTP. Es exactamente el mismo criterio —y el mismo mecanismo, `route.fulfill`— que
 * `scripts/api-simulada.mjs` viene usando desde AKINE-02.02 para mirar pantallas sin backend,
 * con la diferencia de que aca si se afirma.
 *
 * <p><b>Lo que esta suite NO prueba, y hay que decirlo:</b> que el backend devuelva de verdad
 * esos tipos de problema con esas extensiones. Eso lo fijan los tests de integracion de
 * `appKine-api`. Si el backend renombra `slot-completo`, esta suite sigue en verde y la pantalla
 * queda rota. El contrato es lo unico que une las dos mitades.
 */

export const ORGANIZATION_ID = 1;
export const CONSULTORIO_ID = 3;
export const OFERTA_ID = 77;
export const PROFESIONAL_ID = 501;

/** La sede esta en UTC-3, distinta de la zona del runner de CI: es lo que hace visible un bug de huso. */
export const ZONA = 'America/Argentina/Buenos_Aires';

export const NOMBRE_OFERTA = 'Kinesiologia individual';
export const NOMBRE_PROFESIONAL = 'Lic. Marta Bianchi';

/** Fecha fija para las pantallas que se abren por URL directa. No depende del dia de la corrida. */
export const FECHA = '2026-09-15';

export interface RespuestaSimulada {
  readonly status: number;
  readonly body: unknown;
  readonly contentType?: string;
}

export function ok(body: unknown): RespuestaSimulada {
  return { status: 200, body };
}

export function creado(body: unknown): RespuestaSimulada {
  return { status: 201, body };
}

/**
 * Un `ProblemDetail` RFC 7807 tal como lo emite el backend.
 *
 * <p>Las extensiones van en la <b>raiz</b> y no bajo `properties`: es como Spring serializa
 * `setProperty(...)`, y es la forma que `AkineHttpError.extension` encuentra primero.
 */
export function problema(
  status: number,
  tipo: string,
  detail: string,
  extensiones: Readonly<Record<string, unknown>> = {},
): RespuestaSimulada {
  return {
    status,
    contentType: 'application/problem+json',
    body: {
      type: `https://akine.app/problems/${tipo}`,
      title: tipo,
      status,
      detail,
      ...extensiones,
    },
  };
}

// -------------------------------------------------------------------------------------------
// Fixtures de agenda
// -------------------------------------------------------------------------------------------

export interface SlotSimulado {
  readonly desde: string;
  readonly hasta: string;
  readonly cupoLibre: number;
  readonly cupoTotal: number;
  readonly profesionalId: number;
}

export interface DiaSimulado {
  readonly fecha: string;
  readonly motivoSinSlots?: string;
  readonly slots?: readonly SlotSimulado[];
}

/** Instante UTC de una hora de la sede (UTC-3). `09:00` local -> `12:00Z`. */
function instante(fecha: string, horaLocal: string): string {
  const [hh, mm] = horaLocal.split(':').map(Number);
  const utc = new Date(`${fecha}T00:00:00Z`);
  utc.setUTCMinutes(utc.getUTCMinutes() + (hh + 3) * 60 + mm);
  return utc.toISOString().replace('.000Z', 'Z');
}

/**
 * Un slot de 45 minutos que arranca a `horaLocal` en la zona de la sede.
 *
 * <p>Las horas se declaran en <b>hora de la sede</b> y se convierten a UTC aca, que es como
 * viajan en el contrato. Escribirlas ya en UTC haria que un error de huso en la pantalla
 * coincidiera con el fixture y el test lo bendijera.
 */
export function slot(
  fecha: string,
  horaLocal: string,
  opciones: { readonly cupoLibre?: number; readonly cupoTotal?: number } = {},
): SlotSimulado {
  const desde = instante(fecha, horaLocal);
  const fin = new Date(desde);
  fin.setUTCMinutes(fin.getUTCMinutes() + 45);
  return {
    desde,
    hasta: fin.toISOString().replace('.000Z', 'Z'),
    cupoLibre: opciones.cupoLibre ?? 1,
    cupoTotal: opciones.cupoTotal ?? 1,
    profesionalId: PROFESIONAL_ID,
  };
}

/** Las tres horas que usan todos los escenarios: 09:00, 09:45 y 10:30 de la sede. */
export const HORAS = ['09:00', '09:45', '10:30'] as const;

export function diaConSlots(
  fecha: string,
  opciones: { readonly completoElPrimero?: boolean } = {},
): DiaSimulado {
  return {
    fecha,
    slots: HORAS.map((hora, indice) =>
      slot(
        fecha,
        hora,
        indice === 0 && opciones.completoElPrimero === true ? { cupoLibre: 0, cupoTotal: 3 } : {},
      ),
    ),
  };
}

export function diaVacio(fecha: string, motivo: string): DiaSimulado {
  return { fecha, motivoSinSlots: motivo, slots: [] };
}

export function agendaDe(dias: readonly DiaSimulado[]): unknown {
  return {
    consultorioId: CONSULTORIO_ID,
    ofertaId: OFERTA_ID,
    nombreComercial: NOMBRE_OFERTA,
    duracionMinutos: 45,
    timezone: ZONA,
    dias,
  };
}

/** Suma dias a una fecha `YYYY-MM-DD`. */
export function masDias(fecha: string, dias: number): string {
  const dia = new Date(`${fecha}T00:00:00Z`);
  dia.setUTCDate(dia.getUTCDate() + dias);
  return dia.toISOString().slice(0, 10);
}

/** Dias completos entre dos fechas `YYYY-MM-DD`. `hasta` es exclusivo. */
export function anchoEnDias(desde: string, hasta: string): number {
  return Math.round(
    (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000,
  );
}

export const PERSONA_CON_PERFIL = {
  id: 41,
  tipoDocumento: 'DNI',
  numeroDocumento: '28444555',
  apellido: 'Gomez Iriarte',
  nombre: 'Luis Alberto',
  esPaciente: true,
  perfilPacienteId: 7,
  estado: 'ACTIVO',
  version: 3,
};

export function turno(inicio: string, estado: 'RESERVADO' | 'CONFIRMADO', id = 5001): unknown {
  const fin = new Date(inicio);
  fin.setUTCMinutes(fin.getUTCMinutes() + 45);
  return {
    id,
    consultorioId: CONSULTORIO_ID,
    ofertaId: OFERTA_ID,
    personaId: PERSONA_CON_PERFIL.id,
    profesionalId: PROFESIONAL_ID,
    espacioId: 10,
    inicio,
    fin: fin.toISOString().replace('.000Z', 'Z'),
    estado,
    reservadoEn: '2026-09-01T12:00:00Z',
    confirmadoEn: estado === 'CONFIRMADO' ? '2026-09-01T12:00:30Z' : undefined,
    version: estado === 'CONFIRMADO' ? 1 : 0,
  };
}

// -------------------------------------------------------------------------------------------
// El router
// -------------------------------------------------------------------------------------------

export interface ReservaRecibida {
  readonly inicio: string;
  readonly personaId: number;
  readonly idempotencyKey: string;
}

/**
 * API simulada de la vertical de turnos, con todo lo que el escenario necesita observar.
 *
 * <p>Los handlers son campos mutables: un test los reemplaza para su caso sin tocar el router.
 */
export class ApiDeTurnos {
  /** Respuesta del `GET .../agenda`. Recibe la URL para poder ramificar por la ventana pedida. */
  agenda: (url: URL) => RespuestaSimulada = (url) =>
    ok(agendaDe([diaConSlots(url.searchParams.get('desde') ?? FECHA)]));

  /**
   * Respuesta del `POST .../turnos/ofertas/{id}`. Recibe el cuerpo y cuantas van.
   *
   * <p>Puede ser asincrono a proposito: el escenario del doble click necesita retener la primera
   * respuesta en vuelo para que el segundo click ocurra mientras la primera todavia viaja.
   */
  reservar: (
    cuerpo: ReservaRecibida,
    intento: number,
  ) => RespuestaSimulada | Promise<RespuestaSimulada> = (cuerpo) =>
    creado(turno(cuerpo.inicio, 'RESERVADO'));

  personas: readonly unknown[] = [PERSONA_CON_PERFIL];

  /** Permisos del contexto. Sin `turno:manage` el slot se dibuja pero no es un boton. */
  permisos: readonly string[] = ['tenant:read', 'turno:read', 'turno:manage'];

  /** Ventanas pedidas al endpoint de agenda, en orden. Es lo que prueba el recorte y la recarga. */
  readonly ventanasPedidas: { readonly desde: string; readonly hasta: string }[] = [];

  /** Cuerpos de reserva recibidos, en orden. Es lo que prueba la idempotencia. */
  readonly reservasRecibidas: ReservaRecibida[] = [];

  readonly confirmaciones: number[] = [];
}

/**
 * Instala la API simulada y deja la sesion ACTIVA con contexto.
 *
 * <p>La sesion se resuelve por el mismo camino que en produccion: `provideAppInitializer` llama a
 * `restaurarSesion()`, que pide `POST /auth/refresh`; devolver ahi un token con `scope: context`
 * es lo que hace que `authGuard` y `contextGuard` dejen pasar. <b>No se toca ningun store ni se
 * inyecta nada en la pagina</b>: un atajo por dentro dejaria los guards sin ejercitar.
 */
export async function instalarApiDeTurnos(page: Page): Promise<ApiDeTurnos> {
  const api = new ApiDeTurnos();

  await page.route('**/api/v1/**', async (ruta: Route) => {
    const peticion: Request = ruta.request();
    const url = new URL(peticion.url());
    const camino = url.pathname;
    const metodo = peticion.method();

    const responder = (respuesta: RespuestaSimulada): Promise<void> =>
      ruta.fulfill({
        status: respuesta.status,
        contentType: respuesta.contentType ?? 'application/json',
        body: JSON.stringify(respuesta.body),
      });

    // --- Sesion -----------------------------------------------------------------------
    if (camino === '/api/v1/auth/refresh' || camino === '/api/v1/auth/context') {
      return responder(
        ok({
          accessToken: 'token-sintetico-de-e2e',
          scope: 'context',
          organizationId: ORGANIZATION_ID,
          consultorioId: CONSULTORIO_ID,
        }),
      );
    }

    if (camino === '/api/v1/me/contexts') {
      return responder(
        ok([
          {
            organizationId: ORGANIZATION_ID,
            organizationName: 'Centro Kine Belgrano',
            consultorioId: CONSULTORIO_ID,
            consultorioName: 'Sede Centro',
          },
        ]),
      );
    }

    if (camino === '/api/v1/me/permissions') {
      return responder(ok({ permissions: [...api.permisos] }));
    }

    // --- Agenda -----------------------------------------------------------------------
    if (camino.endsWith('/agenda') && metodo === 'GET') {
      api.ventanasPedidas.push({
        desde: url.searchParams.get('desde') ?? '',
        hasta: url.searchParams.get('hasta') ?? '',
      });
      return responder(api.agenda(url));
    }

    // --- Reserva y confirmacion --------------------------------------------------------
    if (/\/turnos\/ofertas\/\d+$/.test(camino) && metodo === 'POST') {
      const cuerpo = JSON.parse(peticion.postData() ?? '{}') as ReservaRecibida;
      api.reservasRecibidas.push(cuerpo);
      return responder(await api.reservar(cuerpo, api.reservasRecibidas.length));
    }

    const confirmacion = camino.match(/\/turnos\/(\d+)\/confirmacion$/);
    if (confirmacion !== null && metodo === 'POST') {
      const id = Number(confirmacion[1]);
      api.confirmaciones.push(id);
      const ultima = api.reservasRecibidas.at(-1);
      return responder(ok(turno(ultima?.inicio ?? instante(FECHA, '09:00'), 'CONFIRMADO', id)));
    }

    // --- Ofertas, habilitaciones y padron ----------------------------------------------
    if (camino.endsWith('/habilitaciones') && metodo === 'GET') {
      return responder(
        ok({
          ofertaId: OFERTA_ID,
          capacidadComercial: 1,
          capacidadEfectiva: 1,
          restringidaPorProfesional: true,
          restringidaPorEspacio: false,
          profesionales: [
            {
              id: 900,
              membershipId: PROFESIONAL_ID,
              nombre: NOMBRE_PROFESIONAL,
              roleCode: 'PROFESIONAL',
              estado: 'ACTIVO',
              vinculoVigente: true,
              vigenteHoy: true,
              version: 0,
            },
          ],
          espacios: [],
        }),
      );
    }

    if (camino.endsWith('/ofertas') && metodo === 'GET') {
      return responder(
        ok([
          {
            id: OFERTA_ID,
            organizationId: ORGANIZATION_ID,
            consultorioId: CONSULTORIO_ID,
            servicioId: 12,
            nombreComercial: NOMBRE_OFERTA,
            duracionMinutos: 45,
            capacidad: 1,
            modalidad: 'INDIVIDUAL',
            estado: 'ACTIVO',
            vigenteHoy: true,
            requiereProfesional: true,
            requiereEspacio: true,
            version: 0,
          },
        ]),
      );
    }

    if (camino === '/api/v1/personas' && metodo === 'GET') {
      return responder(
        ok({
          content: [...api.personas],
          page: 0,
          size: 10,
          totalElements: api.personas.length,
          totalPages: 1,
        }),
      );
    }

    // Un endpoint sin stub tiene que ROMPER el test, no devolver algo plausible: si la pantalla
    // empieza a pedir algo nuevo, el 501 lo delata en vez de esconderlo detras de un 404 que la
    // pantalla ya sabe manejar.
    return responder(problema(501, 'not-implemented', `El harness no simula ${metodo} ${camino}`));
  });

  return api;
}

/** URL de la reserva para un slot, tal como la arma el buscador. */
export function urlDeReserva(fecha: string, horaLocal: string): string {
  return (
    `/agenda/ofertas/${OFERTA_ID}/reservar` +
    `?fecha=${fecha}&inicio=${encodeURIComponent(instante(fecha, horaLocal))}` +
    `&profesionalId=${PROFESIONAL_ID}`
  );
}

export { instante };
