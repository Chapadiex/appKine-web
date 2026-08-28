/**
 * Fixtures sinteticos y router de la API para la inspeccion visual de espacios.
 *
 * NO es un mock de tests: los specs usan HttpTestingController. Esto existe solo para poder
 * MIRAR las pantallas en un navegador real sin el backend levantado.
 */
const BOX_1 = {
  id: 10,
  organizationId: 1,
  consultorioId: 3,
  name: 'Box 1',
  tipo: 'BOX',
  capacidad: 1,
  notes: 'Camilla electrica, entrada por el pasillo',
  validFrom: '2026-01-05T12:00:00Z',
  validUntil: null,
  estado: 'ACTIVO',
  enServicio: true,
  deletedAt: null,
  deactivationReason: null,
  version: 2,
};

/** El caso de la etapa: ACTIVO y todavia sin servicio. */
const BOX_FUTURO = {
  ...BOX_1,
  id: 11,
  name: 'Box 4 (ala nueva)',
  notes: null,
  capacidad: 1,
  validFrom: '2026-10-01T03:00:00Z',
  enServicio: false,
  version: 1,
};

const GIMNASIO = {
  ...BOX_1,
  id: 12,
  name: 'Gimnasio planta baja',
  tipo: 'GIMNASIO',
  capacidad: 8,
  notes: 'Colchonetas, espalderas y dos bicicletas',
  validUntil: '2027-03-01T03:00:00Z',
  version: 5,
};

/** Vigencia vencida: ACTIVO, fuera de servicio. */
const PILETA = {
  ...BOX_1,
  id: 13,
  name: 'Pileta',
  tipo: 'PILETA',
  capacidad: 6,
  notes: null,
  validFrom: '2025-11-01T03:00:00Z',
  validUntil: '2026-04-01T03:00:00Z',
  enServicio: false,
  version: 3,
};

const SALA_BAJA = {
  ...BOX_1,
  id: 14,
  name: 'Sala grupal chica',
  tipo: 'SALA_GRUPAL',
  capacidad: 4,
  notes: null,
  estado: 'INACTIVO',
  enServicio: false,
  deletedAt: '2026-06-20T14:30:00Z',
  deactivationReason: 'Se unifico con el gimnasio en la refaccion de junio',
  version: 4,
};

const TODOS = [BOX_1, BOX_FUTURO, GIMNASIO, PILETA, SALA_BAJA];

function json(cuerpo, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(cuerpo) };
}


/**
 * Padron sintetico para mirar el padron de personas (AKINE-03.01).
 *
 * Los tres casos que la pantalla existe para distinguir: alguien que NO es paciente, alguien que
 * si lo es, y alguien SIN documento -que es un estado legitimo y no un dato faltante-.
 */
const PERSONAS = [
  {
    id: 40,
    tipoDocumento: 'DNI',
    numeroDocumento: '30.111.222',
    apellido: 'Perez',
    nombre: 'Ana Maria',
    fechaNacimiento: '1985-03-14',
    email: 'ana.perez@example.com',
    telefono: '+54 11 5555-0000',
    esPaciente: false,
    estado: 'ACTIVO',
    version: 0,
  },
  {
    id: 41,
    tipoDocumento: 'DNI',
    numeroDocumento: '28444555',
    apellido: 'Gomez Iriarte',
    nombre: 'Luis Alberto',
    telefono: '3514445566',
    esPaciente: true,
    perfilPacienteId: 7,
    perfilActivadoEn: '2026-08-20T13:00:00Z',
    estado: 'ACTIVO',
    version: 3,
  },
  {
    id: 42,
    apellido: 'Ruiz',
    nombre: 'Tomas',
    notas: 'Viene con la madre. Todavia sin DNI.',
    esPaciente: false,
    estado: 'ACTIVO',
    version: 0,
  },
];

export async function instalarApiSimulada(contexto) {
  await contexto.route('**/api/v1/**', async (ruta) => {
  const url = new URL(ruta.request().url());
  const camino = url.pathname;

  if (camino === '/api/v1/auth/refresh') {
    return ruta.fulfill(
      json({
        accessToken: 'token-sintetico',
        scope: 'context',
        organizationId: 1,
        consultorioId: 3,
      }),
    );
  }

  if (camino === '/api/v1/me/contexts') {
    return ruta.fulfill(
      json([
        {
          organizationId: 1,
          organizationName: 'Centro Kine Belgrano',
          consultorioId: 3,
          consultorioName: 'Sede Centro',
        },
      ]),
    );
  }

  if (camino === '/api/v1/auth/context') {
    return ruta.fulfill(
      json({
        accessToken: 'token-sintetico',
        scope: 'context',
        organizationId: 1,
        consultorioId: 3,
      }),
    );
  }

  if (camino === '/api/v1/me/permissions') {
    return ruta.fulfill(
      json({ permissions: ['consultorio:manage', 'tenant:read', 'paciente:manage'] }),
    );
  }

  if (camino.endsWith('/espacios/availability')) {
    return ruta.fulfill(
      json(
        [BOX_1, GIMNASIO].map((espacio) => ({
          espacioId: espacio.id,
          name: espacio.name,
          tipo: espacio.tipo,
          capacidad: espacio.capacidad,
          lugaresComprometidos: 0,
          lugaresDisponibles: espacio.capacidad,
          disponible: true,
          desde: url.searchParams.get('desde'),
          hasta: url.searchParams.get('hasta'),
        })),
      ),
    );
  }

  if (camino.endsWith('/espacios')) {
    const filtro = url.searchParams.get('estado') ?? 'ACTIVO';
    const contenido =
      filtro === 'TODOS'
        ? TODOS
        : TODOS.filter((espacio) => espacio.estado === filtro);
    return ruta.fulfill(
      json({
        content: contenido,
        page: 0,
        size: 20,
        totalElements: contenido.length,
        totalPages: 1,
      }),
    );
  }

  if (camino === '/api/v1/personas') {
    // Sin filtrar por estado ni por perfil: alcanza para mirar el layout, que es lo unico que
    // este archivo existe para permitir. El comportamiento de los filtros lo cubren los specs.
    return ruta.fulfill(
      json({
        content: PERSONAS,
        page: 0,
        size: 20,
        totalElements: PERSONAS.length,
        totalPages: 1,
      }),
    );
  }

  console.log(`  [sin stub] ${ruta.request().method()} ${camino}`);
  return ruta.fulfill(json({ type: 'https://akine.app/problems/not-found' }, 404));
});
}
