import { GenerarReporteRequestParams } from '../../../api/generated/api/reportes.serviceInterface';
import { IndicadorDeReporteResponse } from '../../../api/generated/model/indicador-de-reporte-response';
import { SerieDeIndicadorDeReporte } from '../../../api/generated/model/serie-de-indicador-de-reporte';

/** Codigo de reporte tal como lo tipa el cliente generado. */
export type CodigoDeReporte = GenerarReporteRequestParams['reporte'];

/**
 * Ventana maxima de un reporte, en dias, contando los dos extremos.
 *
 * <p>Es la misma que `ReporteService.MAXIMO_DIAS` del backend. Se valida aca para no gastar un
 * viaje en un pedido que va a volver con `rango-de-reporte-invalido`; el backend valida igual, y
 * cuando rechaza manda su propio maximo en `maximoDias`, que es el que se muestra.
 */
export const MAXIMO_DIAS_DE_REPORTE = 366;

/**
 * Codigo de la advertencia que el backend agrega cuando recorta el reporte a la actividad propia
 * del actor (DP-15, alcance `ACTIVIDAD_PROPIA` del `PROFESIONAL`).
 */
export const ADVERTENCIA_ACTIVIDAD_PROPIA = 'alcance-actividad-propia';

/** Los nueve reportes (M23), en el orden en que se ofrecen. Uno por RF. */
export const REPORTES: readonly { readonly codigo: CodigoDeReporte; readonly nombre: string }[] = [
  { codigo: 'OPERATIVO', nombre: 'Operativo de la sede' },
  { codigo: 'TURNOS', nombre: 'Turnos' },
  { codigo: 'CLINICO', nombre: 'Actividad clínica' },
  { codigo: 'ECONOMICO', nombre: 'Economico' },
  { codigo: 'FINANCIADORES', nombre: 'Financiadores' },
  { codigo: 'CLASES', nombre: 'Clases' },
  { codigo: 'CONTINUIDAD', nombre: 'Continuidad del circuito de salud' },
  { codigo: 'SERVICIOS', nombre: 'Ingresos por servicio' },
  { codigo: 'PASES', nombre: 'Pases' },
];

export function nombreDeReporte(codigo: string | undefined): string {
  return REPORTES.find((r) => r.codigo === codigo)?.nombre ?? codigo ?? '';
}

export function esCodigoDeReporte(valor: string | undefined): valor is CodigoDeReporte {
  return REPORTES.some((r) => r.codigo === valor);
}

/** Los permisos que una seccion puede pedir, en palabras de quien los va a pedir. */
const PERMISOS_EN_PALABRAS: Readonly<Record<string, string>> = {
  'turno:read': 'ver la agenda',
  'sesion:register': 'registrar sesiones',
  'hc:read': 'leer historia clínica',
  'cobro:register': 'cobros',
  'caja:operate': 'operar la caja',
  'reporte:read': 'reportes de toda la sede',
};

export function permisoEnPalabras(codigo: string | undefined): string {
  if (!codigo) {
    return '';
  }
  const palabras = PERMISOS_EN_PALABRAS[codigo];
  return palabras ? `${palabras} (${codigo})` : codigo;
}

/**
 * Valida un periodo con las mismas reglas que el backend: los dos extremos, en orden, y no mas
 * ancho que {@link MAXIMO_DIAS_DE_REPORTE} contando los dos dias. Devuelve el problema en
 * palabras, o `null` si el periodo sirve.
 */
export function problemaDelRango(desde: string, hasta: string): string | null {
  if (!desde || !hasta) {
    return 'Elegí el primer y el último día del periodo.';
  }
  const inicio = diaEnUtc(desde);
  const fin = diaEnUtc(hasta);
  if (inicio === null || fin === null) {
    return 'Alguna de las fechas no es valida.';
  }
  if (fin < inicio) {
    return 'El periodo termina antes de empezar. Revisa las fechas.';
  }
  const dias = Math.round((fin - inicio) / 86_400_000) + 1;
  if (dias > MAXIMO_DIAS_DE_REPORTE) {
    return (
      `El periodo tiene ${dias} días y un reporte abarca como máximo ` +
      `${MAXIMO_DIAS_DE_REPORTE}. Acortalo.`
    );
  }
  return null;
}

function diaEnUtc(fecha: string): number | null {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (partes === null) {
    return null;
  }
  const [anio, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  const instante = Date.UTC(anio, mes - 1, dia);
  const vuelta = new Date(instante);
  return vuelta.getUTCMonth() === mes - 1 && vuelta.getUTCDate() === dia ? instante : null;
}

/** `2026-09-01` → `01/09/2026`. */
export function fechaEnPalabras(fecha: string | undefined): string {
  const partes = fecha ? /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha) : null;
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : (fecha ?? '');
}

/**
 * El valor de un indicador como se lee en pantalla, segun su `tipo`.
 *
 * <p>No suma ni convierte nada: el numero es el del servidor.
 */
export function valorDeIndicador(indicador: IndicadorDeReporteResponse): string {
  return valorSegunTipo(indicador.valor, indicador.tipo, indicador.moneda);
}

/** Un valor de una serie temporal (DP-45), con el tipo y la moneda de su serie. */
export function valorDeSerie(valor: number | undefined, serie: SerieDeIndicadorDeReporte): string {
  return valorSegunTipo(valor, serie.tipo, serie.moneda);
}

function valorSegunTipo(
  valor: number | undefined | null,
  tipo: string | undefined,
  moneda: string | undefined,
): string {
  if (valor === undefined || valor === null || !Number.isFinite(valor)) {
    return '—';
  }
  if (tipo === 'DINERO' && moneda) {
    try {
      return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: moneda,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(valor);
    } catch {
      // Moneda que Intl no conoce: el numero solo, con la moneda al lado.
    }
    return `${formatoDecimal(valor, 2)} ${moneda}`;
  }
  if (tipo === 'PORCENTAJE') {
    return `${formatoDecimal(valor, 1)} %`;
  }
  return formatoDecimal(valor, 0);
}

/**
 * Hasta cuantos dias la serie se pide por dia; mas ancho, por semana ISO. El backend admite 100
 * puntos por dia, pero mas de dos meses de barras diarias ya no se leen en una tarjeta.
 */
export const MAXIMO_DIAS_POR_DIA = 62;

/** La agrupacion de la serie para un periodo ya validado (`problemaDelRango` en `null`). */
export function agrupacionDeSerie(desde: string, hasta: string): 'DIA' | 'SEMANA' {
  const inicio = diaEnUtc(desde);
  const fin = diaEnUtc(hasta);
  if (inicio === null || fin === null) {
    return 'SEMANA';
  }
  const dias = Math.round((fin - inicio) / 86_400_000) + 1;
  return dias <= MAXIMO_DIAS_POR_DIA ? 'DIA' : 'SEMANA';
}

/** `2026-09-05` → `05/09`, para el eje horizontal. */
export function diaCorto(fecha: string | undefined): string {
  const partes = fecha ? /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha) : null;
  return partes ? `${partes[3]}/${partes[2]}` : (fecha ?? '');
}

function formatoDecimal(valor: number, decimales: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(valor);
}

/**
 * Un importe que el backend manda en una celda como `BigDecimal.toPlainString()` de escala 2
 * (`1200.00`, `-35.50`): las secciones de dinero por fila (rentabilidad y caja por servicio,
 * DP-39) los mandan asi. Solo ese formato: un entero puede ser un año o una cantidad, y no se toca.
 */
const IMPORTE_EN_CELDA = /^-?\d+\.\d{2}$/;

export function esImporteEnCelda(celda: string | undefined): boolean {
  return celda !== undefined && IMPORTE_EN_CELDA.test(celda);
}

/** La celda como se lee: los importes con separadores de es-AR; lo demas, tal cual. */
export function celdaEnPalabras(celda: string | undefined): string {
  if (celda === undefined) {
    return '';
  }
  return esImporteEnCelda(celda) ? formatoDecimal(Number(celda), 2) : celda;
}

/** Nombre del archivo CSV que se descarga. */
export function nombreDeArchivo(codigo: string, desde: string, hasta: string): string {
  return `reporte-${codigo.toLowerCase()}-${desde}-a-${hasta}.csv`;
}
