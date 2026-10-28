import { Page, Request, Route } from '@playwright/test';

import { CONSULTORIO_ID, ORGANIZATION_ID, instalarApiDeTurnos } from './agenda-simulada';

/**
 * API simulada para la auditoria de ANCHO DE TELEFONO (`e2e/movil.spec.ts`).
 *
 * <p>Mismo mecanismo que los arneses de contraste: lo unico sintetico es la respuesta HTTP. Las
 * pantallas se pintan <b>con datos</b> y no en su estado de error, porque lo que desborda un
 * telefono son las filas largas, los nombres compuestos y las celdas de importes —un estado de
 * error de una linea no desborda nunca—. Los datos se eligen largos a proposito.
 *
 * <p>Se apila sobre {@link instalarApiDeTurnos}: este router atiende primero y lo que no conoce lo
 * pasa con `route.fallback()` al de turnos (agenda, ofertas, habilitaciones), que a su vez
 * responde 501 a lo que nadie simula. Un 501 deja la pantalla en error, a la vista.
 */

export const FECHA_MOVIL = '2026-10-07';
export const PERSONA_ID = 41;

const PERMISOS = [
  'tenant:read',
  'tenant:manage',
  'turno:read',
  'turno:manage',
  'paciente:read',
  'paciente:manage',
  'cobro:register',
  'caja:operate',
  'convenio:manage',
  'colaborador:read',
  'colaborador:manage',
  'reporte:read',
  'auditoria:read',
  'consultorio:manage',
];

const PERSONA = {
  id: PERSONA_ID,
  tipoDocumento: 'DNI',
  numeroDocumento: '28444555',
  apellido: 'Gomez Iriarte de la Fuente',
  nombre: 'Luis Alberto Maximiliano',
  fechaNacimiento: '1980-05-02',
  email: 'luis.alberto.gomez.iriarte@ejemplo-de-correo-largo.test',
  telefono: '+54 9 351 555-0000',
  esPaciente: true,
  perfilPacienteId: 7,
  estado: 'ACTIVO',
  version: 3,
};

const OTRA_PERSONA = {
  ...PERSONA,
  id: 40,
  apellido: 'Perez',
  nombre: 'Ana Maria',
  numeroDocumento: '30111222',
  email: 'ana.perez@example.com',
  esPaciente: false,
  perfilPacienteId: undefined,
};

const TURNOS_DEL_DIA = [
  {
    id: 301,
    estado: 'CONFIRMADO',
    inicio: `${FECHA_MOVIL}T12:00:00Z`,
    fin: `${FECHA_MOVIL}T12:45:00Z`,
    personaNombre: 'Gomez Iriarte de la Fuente, Luis Alberto Maximiliano',
    documento: 'DNI 28444555',
    ofertaId: 77,
    ofertaNombre: 'Kinesiologia deportiva y rehabilitacion postquirurgica',
    version: 2,
  },
  {
    id: 304,
    estado: 'RESERVADO',
    inicio: `${FECHA_MOVIL}T15:00:00Z`,
    fin: `${FECHA_MOVIL}T15:45:00Z`,
    llegadaEn: `${FECHA_MOVIL}T14:55:00Z`,
    recepcion: {
      id: 904,
      turnoId: 304,
      estado: 'LLEGO',
      llegadaEn: `${FECHA_MOVIL}T14:55:00Z`,
      version: 1,
    },
    personaNombre: 'Ibarra, Dario',
    documento: 'DNI 35666777',
    ofertaId: 77,
    ofertaNombre: 'Kinesiologia deportiva',
    version: 4,
  },
  {
    id: 303,
    estado: 'CANCELADO',
    inicio: `${FECHA_MOVIL}T14:00:00Z`,
    fin: `${FECHA_MOVIL}T14:45:00Z`,
    motivoCancelacion: 'El profesional pidio el dia por una capacitacion fuera de la ciudad',
    personaNombre: 'Vega, Carla',
    documento: 'DNI 33444555',
    ofertaId: 77,
    ofertaNombre: 'Kinesiologia deportiva',
    version: 3,
  },
];

const JORNADA = {
  id: 77,
  consultorioId: CONSULTORIO_ID,
  estado: 'ABIERTA',
  moneda: 'ARS',
  fechaNegocio: FECHA_MOVIL,
  abiertaEn: `${FECHA_MOVIL}T11:00:00Z`,
  saldoInicial: 1000,
  saldoTeorico: 1234567.5,
  totalesPorMedio: [
    { medio: 'EFECTIVO', total: 1233567.5, afectaArqueo: true },
    { medio: 'TRANSFERENCIA', total: 98000, afectaArqueo: false },
  ],
  // La tira de la jornada (DP-45), con importes de siete cifras para medir el ancho.
  resumen: {
    ingresos: 1331567.5,
    egresos: 0,
    efectivoIngresos: 1233567.5,
    efectivoEgresos: 0,
    otrosMediosIngresos: 98000,
    otrosMediosEgresos: 0,
    cantidadMovimientos: 2,
  },
};

/** La tira del mes de egresos (DP-45). */
const RESUMEN_DE_EGRESOS = {
  consultorioId: CONSULTORIO_ID,
  desde: '2026-10-01',
  hasta: '2026-10-31',
  porMoneda: [
    {
      moneda: 'ARS',
      cantidad: 1,
      registrado: 1500000.5,
      pagado: 1000000.5,
      pendiente: 500000,
      cantidadBorrador: 1,
      importeBorrador: 850000,
      cantidadAnulados: 0,
    },
  ],
  porCategoria: [],
};

const MOVIMIENTOS = [
  {
    id: 501,
    jornadaCajaId: 77,
    tipo: 'INGRESO',
    tipoOrigen: 'MANUAL',
    medio: 'EFECTIVO',
    importe: 1233567.5,
    moneda: 'ARS',
    concepto: 'Cambio para el dia y reposicion del fondo fijo de la recepcion',
    registradoEn: `${FECHA_MOVIL}T11:05:00Z`,
  },
];

const EGRESOS = [
  {
    id: 41,
    consultorioId: CONSULTORIO_ID,
    estado: 'CONFIRMADO',
    categoria: 'HONORARIOS_PROFESIONALES',
    concepto: 'Honorarios de septiembre por sesiones de kinesiologia deportiva',
    beneficiarioNombre: 'Lic. Mariana Sintetica Fernandez',
    tipoBeneficiario: 'COLABORADOR',
    beneficiarioMembershipId: 7,
    importeTotal: 1500000.5,
    saldoPendiente: 500000,
    moneda: 'ARS',
    registradoEn: '2026-10-05T14:00:00Z',
    version: 1,
  },
  {
    id: 42,
    consultorioId: CONSULTORIO_ID,
    estado: 'BORRADOR',
    categoria: 'ALQUILER',
    concepto: 'Alquiler del local',
    beneficiarioNombre: 'Inmobiliaria del Centro S.R.L.',
    tipoBeneficiario: 'EXTERNO',
    importeTotal: 850000,
    saldoPendiente: 850000,
    moneda: 'ARS',
    registradoEn: '2026-10-06T14:00:00Z',
    version: 0,
  },
];

const MEMBERSHIPS = [
  {
    id: 7,
    organizationId: ORGANIZATION_ID,
    consultorioId: CONSULTORIO_ID,
    accountId: 70,
    accountName: 'Mariana Sintetica Fernandez',
    accountEmail: 'mariana.sintetica.fernandez@centro-kine-belgrano.test',
    roleCode: 'PROFESIONAL',
    estado: 'ACTIVA',
    active: true,
    founder: false,
    validFrom: '2026-01-05T12:00:00Z',
  },
  {
    id: 1,
    organizationId: ORGANIZATION_ID,
    accountId: 10,
    accountName: 'Ana Duena',
    accountEmail: 'ana@ejemplo.test',
    roleCode: 'ORG_ADMIN',
    estado: 'ACTIVA',
    active: true,
    founder: true,
    validFrom: '2025-12-01T12:00:00Z',
  },
];

const FINANCIADORES = [
  {
    id: 7,
    codigo: 'OSDE',
    nombre: 'OSDE Organizacion de Servicios Directos Empresarios',
    tipo: 'PREPAGA',
    estado: 'ACTIVO',
    version: 0,
  },
];

const PRESENTACIONES = [
  {
    id: 900,
    numero: 12,
    consultorioId: CONSULTORIO_ID,
    financiadorId: 7,
    financiadorNombre: 'OSDE Organizacion de Servicios Directos Empresarios',
    estado: 'FACTURADA',
    periodoDesde: '2026-09-01',
    periodoHasta: '2026-09-30',
    moneda: 'ARS',
    totalPresentado: 2345678.9,
    totalCobrado: 1000000,
    totalDebitado: 12345.67,
    saldo: 1333333.23,
    facturaNumero: '0001-00004567',
    creadaEn: '2026-10-01T12:00:00Z',
    items: [],
    version: 2,
  },
];

const CATALOGO_DE_REPORTES = {
  reportes: [
    {
      reporte: 'OPERATIVO',
      secciones: [
        { seccion: 'turnos', titulo: 'Turnos', permisoRequerido: 'turno:read', clinica: false },
        {
          seccion: 'economia',
          titulo: 'Economia',
          permisoRequerido: 'reporte:read',
          clinica: false,
        },
      ],
    },
    { reporte: 'TURNOS', secciones: [] },
  ],
};

const RESUMEN_360 = {
  persona: PERSONA,
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
          titulo: 'Turno de kinesiologia deportiva y rehabilitacion postquirurgica',
          estado: 'CONFIRMADO',
          referencia: 501,
        },
      ],
    },
    {
      seccion: 'coberturas',
      indicadores: [{ clave: 'coberturas-vigentes', etiqueta: 'Coberturas vigentes', cantidad: 1 }],
      hitos: [
        {
          seccion: 'coberturas',
          tipo: 'COBERTURA_PRINCIPAL',
          ocurrioEn: '2026-03-01T00:00:00Z',
          titulo: 'OSDE · 310 · Afiliado ···4567 · hasta 2026-12-31',
          estado: 'VIGENTE',
          referencia: 11,
        },
      ],
    },
  ],
  seccionesOmitidas: [],
};

const COBERTURAS = [
  {
    id: 11,
    personaId: PERSONA_ID,
    tipo: 'FINANCIADA',
    estado: 'ACTIVA',
    financiadorId: 7,
    financiadorCodigo: 'OSDE',
    financiadorNombre: 'OSDE Organizacion de Servicios Directos Empresarios',
    financiadorTipo: 'PREPAGA',
    planId: 70,
    planCodigo: '310',
    planNombre: 'Plan 310 con internacion',
    numeroAfiliado: '61234567890123401',
    principal: true,
    vigente: true,
    vigenciaDesde: '2026-03-01',
    vigenciaHasta: '2026-12-31',
    version: 1,
  },
];

const ORDENES = [
  {
    id: 21,
    personaId: PERSONA_ID,
    coberturaId: 11,
    numero: 'OM-2026-000123456',
    estado: 'ACTIVA',
    situacion: 'EN_CURSO',
    fechaEmision: '2026-09-20',
    vigenciaDesde: '2026-09-20',
    vigenciaHasta: '2026-12-20',
    vigente: true,
    diasParaVencer: 74,
    profesionalEmisor: 'Dr. Ernesto Traumatologo Rodriguez Pena',
    matriculaEmisor: 'MP 123456',
    indicacion: 'Rehabilitacion de ligamento cruzado anterior de rodilla derecha',
    sesionesPrescriptas: 20,
    sesionesConsumidas: 4,
    version: 0,
  },
];

const AUTORIZACIONES = [
  {
    id: 31,
    personaId: PERSONA_ID,
    coberturaId: 11,
    ordenMedicaId: 21,
    numero: 'AUT-OSDE-2026-99887766',
    estado: 'ACTIVA',
    estadoAutorizacion: 'APROBADA',
    convenioId: 5,
    convenioCodigo: 'OSDE-KINE-2026',
    convenioNombre: 'Convenio de kinesiologia OSDE 2026',
    practicaId: 250101,
    cantidadAutorizada: 20,
    cantidadConsumida: 4,
    saldo: 16,
    vigenciaDesde: '2026-09-20',
    vigenciaHasta: '2026-12-20',
    vigente: true,
    habilita: true,
    diasParaVencer: 74,
    version: 0,
  },
];

function pagina(contenido: readonly unknown[]): unknown {
  return { content: contenido, page: 0, size: 20, totalElements: contenido.length, totalPages: 1 };
}

/**
 * Instala la API simulada de todas las pantallas que audita el spec de telefono, con sesion
 * ACTIVA y contexto. `conSesion: false` deja el refresh en 401, que es como se llega al login.
 */
export async function instalarApiMovil(
  page: Page,
  opciones: { readonly conSesion?: boolean } = {},
): Promise<void> {
  const conSesion = opciones.conSesion ?? true;
  const turnos = await instalarApiDeTurnos(page);
  turnos.permisos = PERMISOS;

  await page.route('**/api/v1/**', async (ruta: Route) => {
    const peticion: Request = ruta.request();
    const url = new URL(peticion.url());
    const camino = url.pathname;
    const metodo = peticion.method();
    const json = (cuerpo: unknown): Promise<void> =>
      ruta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) });

    if (!conSesion && camino === '/api/v1/auth/refresh') {
      return ruta.fulfill({
        status: 401,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'https://akine.app/problems/invalid-refresh',
          title: 'invalid-refresh',
          status: 401,
        }),
      });
    }
    if (metodo !== 'GET') return ruta.fallback();

    const base = `/api/v1/consultorios/${CONSULTORIO_ID}`;
    const org = `/api/v1/organizations/${ORGANIZATION_ID}`;
    const persona = `/api/v1/personas/${PERSONA_ID}`;

    if (camino === '/api/v1/me/platform-role') return json({ platformAdmin: false });
    if (camino === '/api/v1/me/permissions') return json({ permissions: PERMISOS });

    if (camino === `${base}/turnos`) {
      return json({
        fecha: FECHA_MOVIL,
        timezone: 'America/Argentina/Cordoba',
        turnos: TURNOS_DEL_DIA,
      });
    }
    if (camino === `${base}/caja/jornadas`) return json([JORNADA]);
    if (camino === `${base}/caja/jornadas/${JORNADA.id}`) return json(JORNADA);
    if (camino === `${base}/caja/movimientos`) return json(MOVIMIENTOS);
    if (camino === `${base}/egresos`) return json(EGRESOS);
    if (camino === `${base}/egresos/resumen`) return json(RESUMEN_DE_EGRESOS);
    if (camino === `${base}/presentaciones`) return json(PRESENTACIONES);
    if (camino === `${base}/reportes`) return json(CATALOGO_DE_REPORTES);
    if (camino === `${org}/memberships`) return json(pagina(MEMBERSHIPS));
    if (camino === '/api/v1/financiadores') return json(FINANCIADORES);

    if (camino === '/api/v1/personas') return json(pagina([PERSONA, OTRA_PERSONA]));
    if (camino === persona) return json(PERSONA);
    if (camino === `${persona}/resumen`) return json(RESUMEN_360);
    if (camino === `${persona}/coberturas`) return json(COBERTURAS);
    if (camino === `${persona}/ordenes`) return json(ORDENES);
    if (camino === `${persona}/autorizaciones`) return json(AUTORIZACIONES);
    if (camino === `${persona}/adjuntos`) return json({ ...(pagina([]) as object) });
    if (camino === '/api/v1/catalogos/practicas') {
      return json(
        pagina([
          {
            id: 250101,
            codigo: '25.01.01',
            nombre: 'Fisiokinesioterapia por sesion',
            estado: 'ACTIVO',
          },
        ]),
      );
    }

    return ruta.fallback();
  });
}
