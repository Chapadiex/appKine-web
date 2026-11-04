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
 * que se cambio en esa agenda. Las comparten para que se vean como hermanas. Cierres y aperturas y
 * el calendario de la sede son pantallas de la sede, no del profesional: se llegan desde el menu.
 *
 * <p>La pestana de cambios depende de `agenda:excepciones`, el mismo permiso que exige el
 * historial en el backend (propio para el profesional). Ocultarla es UX: el backend rechaza igual.
 */
export function pestanasDeHorarios(puedeVerCambios: boolean): readonly Pestana[] {
  return puedeVerCambios ? [SEMANAL, EFECTIVO, CAMBIOS] : [SEMANAL, EFECTIVO];
}
