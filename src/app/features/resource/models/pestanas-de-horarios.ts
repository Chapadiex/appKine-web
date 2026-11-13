import { Pestana } from '../../../shared/components/pestanas/pestanas';
import { RUTAS_HORARIOS } from './rutas-de-horarios';

/** `aria-label` de las pestanas del horario del profesional. */
export const ETIQUETA_PESTANAS_DE_HORARIOS = 'Horarios del profesional';

const SEMANAL: Pestana = {
  etiqueta: 'Horario semanal',
  ruta: RUTAS_HORARIOS.semanal,
  exacta: true,
};
const EFECTIVO: Pestana = { etiqueta: 'Horario efectivo', ruta: RUTAS_HORARIOS.efectivo };
const CAMBIOS: Pestana = { etiqueta: 'Cambios', ruta: RUTAS_HORARIOS.cambios };

/**
 * Las vistas del horario de un profesional (UX-01): la regla cargada (semanal), lo que resulta de
 * aplicarle feriados, cierres y vigencias (efectivo) y, para quien puede verlo, el historial de lo
 * que se cambio en esa agenda. Las comparten para que se vean como hermanas. El calendario de la sede
 * y los cierres y aperturas son de la sede, no del profesional: tienen sus propias pestañas.
 *
 * <p>La pestana de cambios depende de `agenda:excepciones`, el mismo permiso que exige el
 * historial en el backend (propio para el profesional). Ocultarla es UX: el backend rechaza igual.
 */
export function pestanasDeHorarios(puedeVerCambios: boolean): readonly Pestana[] {
  return puedeVerCambios ? [SEMANAL, EFECTIVO, CAMBIOS] : [SEMANAL, EFECTIVO];
}

/** `aria-label` de las pestañas del calendario de la sede. */
export const ETIQUETA_PESTANAS_DEL_CALENDARIO = 'Secciones del calendario de la sede';

/**
 * El calendario de la sede (08/11/2026): tres paneles de la misma pantalla —resumen y politica,
 * horario general, feriados— y los cierres y aperturas, que son otra pantalla. Todas cuelgan de
 * `/horarios/calendario`, asi la barra lateral marca una sola entrada.
 */
export const PESTANAS_DEL_CALENDARIO: readonly Pestana[] = [
  { etiqueta: 'Resumen y política', ruta: RUTAS_HORARIOS.calendario, exacta: true },
  { etiqueta: 'Horario general', ruta: RUTAS_HORARIOS.calendarioHorario },
  { etiqueta: 'Feriados', ruta: RUTAS_HORARIOS.calendarioFeriados },
  { etiqueta: 'Cierres y aperturas', ruta: RUTAS_HORARIOS.excepciones },
];
