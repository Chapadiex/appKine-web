import { SesionVersion } from '../../../api/generated/model/sesion-version';
import { TratamientoEnVersion } from '../../../api/generated/model/tratamiento-en-version';
import {
  CONDUCTAS,
  EVOLUCIONES,
  LATERALIDADES,
  TOLERANCIAS,
  etiquetaDe,
} from './etiquetas-de-atencion';
import { ladoLegible, valorLegible } from './examen-y-tratamiento';

/**
 * El contenido de una version de sesion como filas legibles (AKINE-06.06, RF-M24-005).
 *
 * <p>Cada version trae el contenido <b>completo</b> y no un diff: la comparacion la arma la
 * pantalla. Para poder comparar, cada fila tiene una <b>clave estable</b> entre versiones —el
 * campo, el `tratamientoId`, la medida y su lado— y un valor ya escrito en palabras.
 */
export interface FilaDeContenido {
  readonly clave: string;
  readonly campo: string;
  readonly valor: string;
}

/** Una fila de la comparacion entre dos versiones. */
export interface FilaComparada {
  readonly clave: string;
  readonly campo: string;
  readonly antes: string;
  readonly despues: string;
  readonly cambio: boolean;
}

/** Las filas de una version, en el orden en que se leen: evaluacion, cierre, tratamientos, examen. */
export function contenidoDe(version: SesionVersion): FilaDeContenido[] {
  const filas: FilaDeContenido[] = [];
  const agregar = (clave: string, campo: string, valor: string | undefined) =>
    filas.push({ clave, campo, valor: valor ?? '' });

  agregar('dolorEva', 'Dolor (0 a 10)', version.dolorEva?.toString());
  agregar('dolorZona', 'Zona del dolor', version.dolorZona);
  agregar('dolorLateralidad', 'Lateralidad', etiquetaDe(LATERALIDADES, version.dolorLateralidad));
  agregar('evolucion', 'Evolucion', etiquetaDe(EVOLUCIONES, version.evolucion));
  agregar('objetivoSesion', 'Objetivo de la sesion', version.objetivoSesion);
  agregar('motivoClinico', 'Motivo clinico', version.motivoClinico);
  agregar('limitacionFuncional', 'Limitacion funcional', version.limitacionFuncional);
  agregar('notaDeCierre', 'Nota de cierre', version.notaDeCierre);
  agregar('respuestaTratamiento', 'Respuesta al tratamiento', version.respuestaTratamiento);
  agregar('tolerancia', 'Tolerancia', etiquetaDe(TOLERANCIAS, version.tolerancia));
  agregar('indicaciones', 'Indicaciones', version.indicaciones);
  agregar('proximaConducta', 'Proxima conducta', etiquetaDe(CONDUCTAS, version.proximaConducta));

  for (const tratamiento of version.tratamientos ?? []) {
    agregar(
      `tratamiento-${tratamiento.tratamientoId ?? tratamiento.orden}`,
      `Tratamiento: ${tratamiento.practicaNombre ?? 'practica'}`,
      resumenDeTratamiento(tratamiento),
    );
  }
  for (const medicion of version.mediciones ?? []) {
    agregar(
      `medicion-${medicion.definicionId}-${medicion.lateralidad ?? 'NO_APLICA'}`,
      `Medicion: ${medicion.nombre ?? 'medida'} (${ladoLegible(medicion.lateralidad)})`,
      [valorLegible(medicion), medicion.nota ? `nota: ${medicion.nota}` : '']
        .filter((parte) => parte !== '')
        .join('; '),
    );
  }
  return filas;
}

/**
 * Compara dos versiones fila por fila. Una fila que existe en una sola —un tratamiento dado de
 * baja, una medicion quitada— aparece igual, vacia del lado que no la tiene: que algo desaparecio
 * es justamente lo que una enmienda tiene que dejar ver.
 */
export function compararVersiones(antes: SesionVersion, despues: SesionVersion): FilaComparada[] {
  const filasAntes = contenidoDe(antes);
  const filasDespues = contenidoDe(despues);
  const porClaveAntes = new Map(filasAntes.map((fila) => [fila.clave, fila]));
  const porClaveDespues = new Map(filasDespues.map((fila) => [fila.clave, fila]));

  const claves = [
    ...filasDespues.map((fila) => fila.clave),
    ...filasAntes.map((fila) => fila.clave).filter((clave) => !porClaveDespues.has(clave)),
  ];

  return claves
    .map((clave) => {
      const a = porClaveAntes.get(clave);
      const d = porClaveDespues.get(clave);
      const antesTexto = a?.valor ?? '';
      const despuesTexto = d?.valor ?? '';
      return {
        clave,
        campo: d?.campo ?? a?.campo ?? clave,
        antes: antesTexto,
        despues: despuesTexto,
        cambio: antesTexto !== despuesTexto,
      };
    })
    .filter((fila) => fila.antes !== '' || fila.despues !== '');
}

/** Un tratamiento en una linea: tecnica, zona y lado, duracion, parametros y observacion. */
export function resumenDeTratamiento(tratamiento: TratamientoEnVersion): string {
  const zona = tratamiento.zona
    ? `zona ${tratamiento.zona}${
        tratamiento.lateralidad ? ` (${etiquetaDe(LATERALIDADES, tratamiento.lateralidad)})` : ''
      }`
    : '';
  const parametros = (tratamiento.parametros ?? [])
    .map((parametro) => `${parametro.clave}: ${valorLegible(parametro)}`)
    .join(', ');
  return (
    [
      tratamiento.tecnica ? `tecnica ${tratamiento.tecnica}` : '',
      zona,
      tratamiento.duracionMinutos ? `${tratamiento.duracionMinutos} minutos` : '',
      tratamiento.espacioNombre ? `en ${tratamiento.espacioNombre}` : '',
      parametros,
      tratamiento.observacion ?? '',
    ]
      .filter((parte) => parte !== '')
      .join('; ') || 'Realizado, sin detalle cargado'
  );
}
