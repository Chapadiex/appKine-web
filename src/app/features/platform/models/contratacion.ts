import { PlanResponse } from '../../../api/generated/model/plan-response';
import { SolicitudDePruebaResponse } from '../../../api/generated/model/solicitud-de-prueba-response';

/**
 * Vocabulario de la contratacion de un centro (landing y prueba gratis, 18/11/2026): plan, servicios
 * y adicional de IA. Lo comparten la bandeja de pedidos, el alta de un centro y la suscripcion.
 *
 * <p>Los valores salen de los enums del cliente generado; aca solo viven los rotulos y las reglas de
 * presentacion (que plan sugerir para un pedido, cuantos dias le quedan a una prueba).
 */
export type Servicio = 'KINESIOLOGIA' | 'ACTIVIDADES';
export type Sedes = NonNullable<SolicitudDePruebaResponse['sedes']>;

export const SERVICIOS: readonly { readonly valor: Servicio; readonly etiqueta: string }[] = [
  { valor: 'KINESIOLOGIA', etiqueta: 'Kinesiología y rehabilitación' },
  { valor: 'ACTIVIDADES', etiqueta: 'Actividades' },
];

const ETIQUETA_CORTA: Readonly<Record<Servicio, string>> = {
  KINESIOLOGIA: 'Kinesiología',
  ACTIVIDADES: 'Actividades',
};

/** "Kinesiología y Actividades", "Actividades" o "Ninguno". */
export function serviciosEnTexto(servicios: readonly string[] | undefined): string {
  const nombres = (servicios ?? [])
    .filter((s): s is Servicio => s in ETIQUETA_CORTA)
    .map((s) => ETIQUETA_CORTA[s]);
  return nombres.length === 0 ? 'Ninguno' : nombres.join(' y ');
}

/** Los servicios que pidio un pedido de prueba, como lista. */
export function serviciosDelPedido(pedido: SolicitudDePruebaResponse): Servicio[] {
  return [
    ...(pedido.kinesiologia ? (['KINESIOLOGIA'] as const) : []),
    ...(pedido.actividades ? (['ACTIVIDADES'] as const) : []),
  ];
}

const ETIQUETA_DE_SEDES: Readonly<Record<Sedes, string>> = {
  UNA: 'Una',
  HASTA_TRES: 'Hasta tres',
  MAS_DE_TRES: 'Más de tres',
};

export function etiquetaDeSedes(sedes: Sedes | undefined): string {
  return sedes ? ETIQUETA_DE_SEDES[sedes] : 'Sin dato';
}

/** El plan que corresponde a las sedes que declaro el pedido (diseño §2.1). */
export const PLAN_SUGERIDO: Readonly<Record<Sedes, string>> = {
  UNA: 'BASE',
  HASTA_TRES: 'CRECIMIENTO',
  MAS_DE_TRES: 'RED',
};

/** Solo los planes que se ofrecen: BASICO y PROFESIONAL siguen para quien los tiene, no se venden. */
export function planesOfrecidos(planes: readonly PlanResponse[]): PlanResponse[] {
  return planes.filter((plan) => plan.ofrecido === true);
}

/** "Hasta 1 sede", "Hasta 3 sedes" o "Sin tope de sedes". */
export function topeDeSedes(plan: PlanResponse | undefined): string {
  const limite = plan?.limits?.find((l) => l.code === 'MAX_CONSULTORIOS');
  return rotuloDeTope(limite === undefined || limite.unlimited ? null : (limite.value ?? null));
}

export function rotuloDeTope(maxSedes: number | null | undefined): string {
  if (maxSedes === null || maxSedes === undefined) return 'Sin tope de sedes';
  return maxSedes === 1 ? 'Hasta 1 sede' : `Hasta ${maxSedes} sedes`;
}

const UN_DIA = 24 * 60 * 60 * 1000;

/** Dias que le quedan a una prueba, redondeando para arriba; 0 o menos = vencida. */
export function diasRestantes(pruebaHasta: string | undefined, ahora = Date.now()): number | null {
  if (!pruebaHasta) return null;
  const fin = Date.parse(pruebaHasta);
  return Number.isNaN(fin) ? null : Math.ceil((fin - ahora) / UN_DIA);
}

/** Marca de estado (color + texto + icono, norma §3) de una suscripcion. */
export interface MarcaDeEstado {
  readonly clase: string;
  readonly texto: string;
}

/**
 * El rotulo de una suscripcion. Una prueba vencida sigue guardada como `PRUEBA` pero el centro
 * opera en solo lectura: se rotula aparte para que no parezca vigente.
 */
export function marcaDeSuscripcion(estado: string | undefined, vencida = false): MarcaDeEstado {
  switch (estado) {
    case 'PRUEBA':
      return vencida
        ? { clase: 'marca-estado--suspendida', texto: 'Prueba vencida' }
        : { clase: 'marca-estado--info', texto: 'En prueba' };
    case 'ACTIVA':
      return { clase: 'marca-estado--activa', texto: 'Activa' };
    case 'SUSPENDIDA':
      return { clase: 'marca-estado--suspendida', texto: 'Suspendida' };
    case 'CANCELADA':
      return { clase: 'marca-estado--revocada', texto: 'Cancelada' };
    default:
      return { clase: 'marca-estado--neutra', texto: estado ?? 'Sin dato' };
  }
}

/** Marca del estado de un pedido de prueba. */
export function marcaDePedido(estado: SolicitudDePruebaResponse['estado']): MarcaDeEstado {
  switch (estado) {
    case 'PENDIENTE':
      return { clase: 'marca-estado--info', texto: 'Pendiente' };
    case 'APROBADA':
      return { clase: 'marca-estado--activa', texto: 'Aprobado' };
    case 'DESCARTADA':
      return { clase: 'marca-estado--revocada', texto: 'Descartado' };
    default:
      return { clase: 'marca-estado--neutra', texto: 'Sin dato' };
  }
}

/** Si la lista de adicionales trae la IA. */
export function tieneIa(adicionales: readonly string[] | undefined): boolean {
  return (adicionales ?? []).includes('IA');
}

/** Insignia de un plan en un listado: sigla, nombre y la clase de color (texto + color, nunca solo color). */
export interface MarcaDePlan {
  readonly sigla: string;
  readonly texto: string;
  readonly clase: string;
}

/** Los tres escalones que se venden; BASICO y PROFESIONAL son los nombres viejos del base e intermedio. */
const ESCALON_DE_PLAN: Readonly<Record<string, Omit<MarcaDePlan, 'texto'> & { nombre: string }>> = {
  BASE: { sigla: 'PB', clase: 'marca-plan--base', nombre: 'Base' },
  BASICO: { sigla: 'PB', clase: 'marca-plan--base', nombre: 'Básico' },
  CRECIMIENTO: { sigla: 'PC', clase: 'marca-plan--crecimiento', nombre: 'Crecimiento' },
  PROFESIONAL: { sigla: 'PC', clase: 'marca-plan--crecimiento', nombre: 'Profesional' },
  RED: { sigla: 'PR', clase: 'marca-plan--red', nombre: 'Red' },
};

/**
 * "PB Base", "PC Crecimiento", "PR Red". El nombre que manda el servidor gana sobre el de respaldo;
 * un plan desconocido va sin sigla y en neutro.
 */
export function marcaDePlan(code: string | undefined, name?: string): MarcaDePlan {
  const escalon = code === undefined ? undefined : ESCALON_DE_PLAN[code];
  const texto = name?.trim() || escalon?.nombre || code || 'Sin plan';
  return escalon
    ? { sigla: escalon.sigla, texto, clase: escalon.clase }
    : { sigla: '', texto, clase: 'marca-plan--otro' };
}
