/**
 * El armador de la landing: con cuántas sedes, qué servicios y si suma IA, qué plan corresponde y
 * qué incluye (`appKine-api/docs/diseno/AKINE-landing-y-ofertas.md` §2). Sin precios: no están
 * definidos (§9.1).
 *
 * <p>Es texto de venta, no una regla del sistema: el tope de sedes lo hace cumplir el backend con
 * `plan_limit` y lo que se contrata lo carga la plataforma.
 */

export type CantidadDeSedes = 'una' | 'hasta-tres' | 'mas-de-tres';
export type ServiciosElegidos = 'kinesiologia' | 'actividades' | 'ambos';
export type ConIa = 'si' | 'no';

export type CodigoDePlan = 'base' | 'crecimiento' | 'red';

export interface OpcionesDelArmador {
  readonly sedes: CantidadDeSedes;
  readonly servicios: ServiciosElegidos;
  readonly ia: ConIa;
}

export interface Plan {
  readonly codigo: CodigoDePlan;
  readonly nombre: string;
  readonly sedes: string;
  readonly paraQuien: string;
}

export interface GrupoIncluido {
  readonly titulo: string;
  readonly items: readonly string[];
}

export interface Recomendacion {
  readonly plan: Plan;
  readonly incluye: readonly GrupoIncluido[];
}

export const PLANES: readonly Plan[] = [
  {
    codigo: 'base',
    nombre: 'Base',
    sedes: '1 sede',
    paraQuien: 'Un consultorio o un estudio.',
  },
  {
    codigo: 'crecimiento',
    nombre: 'Crecimiento',
    sedes: 'De 1 a 3 sedes',
    paraQuien: 'El centro que abre su segunda o su tercera sede.',
  },
  {
    codigo: 'red',
    nombre: 'Red',
    sedes: 'Más de 3 sedes, a convenir',
    paraQuien: 'Cadenas y franquicias. Lo armamos con vos.',
  },
];

const PLAN_POR_SEDES: Record<CantidadDeSedes, CodigoDePlan> = {
  una: 'base',
  'hasta-tres': 'crecimiento',
  'mas-de-tres': 'red',
};

const SIEMPRE: readonly string[] = [
  'Padrón de personas, agenda y turnos',
  'Recepción del día',
  'Caja, cobros y egresos',
  'Colaboradores con permisos por sede',
  'Marca propia del centro',
  'Reportes de lo que tengas contratado',
];

const KINESIOLOGIA: readonly string[] = [
  'Historia clínica, casos y plan de tratamiento',
  'Sesiones de evaluación con examen y mediciones',
  'Coberturas, convenios, órdenes y autorizaciones',
  'Presentaciones a financiadores',
];

const ACTIVIDADES: readonly string[] = [
  'Clases, inscripciones y asistencia',
  'Pases, abonos y productos',
  'Honorarios por clase',
];

const IA_PARA_TODOS: readonly string[] = ['Asistente de datos', 'Dictado por voz'];

/** Sólo tienen sentido con Kinesiología (§2.3). */
const IA_CLINICA: readonly string[] = [
  'Analizador de evolución del caso',
  'Sugerencias con citas de tu biblioteca',
  'Biblioteca del centro',
];

export function planPorCodigo(codigo: CodigoDePlan): Plan {
  return PLANES.find((plan) => plan.codigo === codigo) ?? PLANES[0];
}

export function recomendarPlan(opciones: OpcionesDelArmador): Recomendacion {
  const plan = planPorCodigo(PLAN_POR_SEDES[opciones.sedes]);
  const conKine = opciones.servicios !== 'actividades';
  const conActividades = opciones.servicios !== 'kinesiologia';

  const incluye: GrupoIncluido[] = [{ titulo: plan.sedes, items: SIEMPRE }];
  if (conKine) {
    incluye.push({ titulo: 'Kinesiología y rehabilitación', items: KINESIOLOGIA });
  }
  if (conActividades) {
    incluye.push({ titulo: 'Actividades', items: ACTIVIDADES });
  }
  if (opciones.ia === 'si') {
    incluye.push({
      titulo: 'Adicional de IA',
      items: conKine ? [...IA_PARA_TODOS, ...IA_CLINICA] : IA_PARA_TODOS,
    });
  }

  return { plan, incluye };
}
