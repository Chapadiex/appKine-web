import { GenerarReporteRequestParams } from '../../../api/generated/api/reportes.serviceInterface';
import { IndicadorDeReporte } from './lectura-de-reporte';

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

/** Los cinco reportes del MVP (M23), en el orden en que se ofrecen. Uno por RF. */
export const REPORTES: readonly { readonly codigo: CodigoDeReporte; readonly nombre: string }[] = [
  { codigo: 'OPERATIVO', nombre: 'Operativo de la sede' },
  { codigo: 'TURNOS', nombre: 'Turnos' },
  { codigo: 'CLINICO', nombre: 'Actividad clinica' },
  { codigo: 'ECONOMICO', nombre: 'Economico' },
  { codigo: 'FINANCIADORES', nombre: 'Financiadores' },
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
  'hc:read': 'leer historia clinica',
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
    return 'Elegi el primer y el ultimo dia del periodo.';
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
      `El periodo tiene ${dias} dias y un reporte abarca como maximo ` +
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

/** `yyyy-mm-dd` de una fecha local, sin pasar por UTC (que corre el dia de noche). */
export function fechaIso(fecha: Date): string {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

/** `2026-09-01` → `01/09/2026`. */
export function fechaEnPalabras(fecha: string | undefined): string {
  const partes = fecha ? /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha) : null;
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : (fecha ?? '');
}

/**
 * El valor de un indicador como se lee en pantalla, segun su `tipo`.
 *
 * <p>No suma ni convierte nada: el numero es el del servidor. Si el indicador no trae `valor`
 * —la forma que hoy describe el contrato— se cae a `importe`/`cantidad`.
 */
export function valorDeIndicador(indicador: IndicadorDeReporte): string {
  const valor = indicador.valor ?? indicador.importe ?? indicador.cantidad;
  if (valor === undefined || valor === null || !Number.isFinite(valor)) {
    return '—';
  }
  const tipo = indicador.tipo ?? (indicador.importe !== undefined ? 'DINERO' : 'CONTEO');
  if (tipo === 'DINERO' && indicador.moneda) {
    try {
      return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: indicador.moneda,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(valor);
    } catch {
      // Moneda que Intl no conoce: el numero solo, con la moneda al lado.
    }
    return `${formatoDecimal(valor, 2)} ${indicador.moneda}`;
  }
  if (tipo === 'PORCENTAJE') {
    return `${formatoDecimal(valor, 1)} %`;
  }
  return formatoDecimal(valor, 0);
}

function formatoDecimal(valor: number, decimales: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(valor);
}

/** Nombre del archivo CSV que se descarga. */
export function nombreDeArchivo(codigo: string, desde: string, hasta: string): string {
  return `reporte-${codigo.toLowerCase()}-${desde}-a-${hasta}.csv`;
}
