import { IndicadorResponse } from '../../../api/generated/model/indicador-response';
import { ReporteResponse } from '../../../api/generated/model/reporte-response';
import { SeccionResponse } from '../../../api/generated/model/seccion-response';

/**
 * Lectura de la respuesta de `GET .../reportes/{reporte}` tal como la manda el backend.
 *
 * <h2>Por que existe este archivo, y por que es deuda</h2>
 *
 * <p>El contrato 0.66.0 publica <b>mal</b> dos schemas de `reporting`. El backend tiene dos records
 * llamados `IndicadorResponse` y dos llamados `SeccionResponse` —uno en `person.api.dto` (resumen
 * de la persona) y otro en `reporting.api.dto`— y springdoc los nombra por el nombre simple de la
 * clase: <b>gano el de `person`</b>. Por eso el cliente generado describe un indicador con
 * `cantidad`/`importe` y una seccion con `hitos`, mientras que el servidor de reportes manda
 * `tipo`, `valor`, `fuente`, `criterioDeFecha`, `titulo`, `columnas` y `filas`.
 *
 * <p>Lo que hace este archivo es <b>agregar</b> a los tipos generados los campos que el cable trae
 * y el contrato no declara; no duplica ninguno ni redefine los que si estan. El arreglo correcto es
 * del backend —darle nombre propio a los schemas de `reporting` con `@Schema(name = ...)`—, y
 * cuando el cliente se regenere este archivo se borra y el compilador marca cada uso.
 *
 * <p>Todos los campos agregados son opcionales: si el backend cambia la forma, la pantalla muestra
 * menos, no explota.
 */
export type IndicadorDeReporte = IndicadorResponse & {
  /** `DINERO`, `CONTEO` o `PORCENTAJE`. */
  readonly tipo?: string;
  /** El numero, decimal exacto del lado del servidor. */
  readonly valor?: number;
  /** De que modulo y tabla sale. */
  readonly fuente?: string;
  /** Con que columna se recorto el periodo. */
  readonly criterioDeFecha?: string;
};

export type SeccionDeReporte = Omit<SeccionResponse, 'indicadores'> & {
  readonly titulo?: string;
  readonly indicadores?: readonly IndicadorDeReporte[];
  readonly columnas?: readonly string[];
  readonly filas?: readonly (readonly string[])[];
};

export type ReporteLeido = Omit<ReporteResponse, 'secciones'> & {
  readonly secciones?: readonly SeccionDeReporte[];
};
