import { Pestana } from '../../../shared/components/pestanas/pestanas';
import { RUTAS_HORARIOS } from './rutas-de-horarios';

/** `aria-label` de las pestanas del horario del profesional. */
export const ETIQUETA_PESTANAS_DE_HORARIOS = 'Horarios del profesional';

/**
 * Las dos vistas del horario de un profesional (UX-01): la regla cargada (semanal) y lo que
 * resulta de aplicarle feriados, cierres y vigencias (efectivo). Las comparten para que se vean
 * como hermanas. Cierres y aperturas y el calendario de la sede son pantallas de la sede, no del
 * profesional: se llegan desde el menu.
 */
export const PESTANAS_DE_HORARIOS: readonly Pestana[] = [
  { etiqueta: 'Horario semanal', ruta: RUTAS_HORARIOS.semanal, exacta: true },
  { etiqueta: 'Horario efectivo', ruta: RUTAS_HORARIOS.efectivo },
];
