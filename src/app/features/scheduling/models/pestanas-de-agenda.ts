import { Pestana } from '../../../shared/components/pestanas/pestanas';

/** `aria-label` de las pestanas de la seccion Agenda. */
export const ETIQUETA_PESTANAS_DE_AGENDA = 'Pantallas de la agenda';

/**
 * Las pantallas hermanas de la seccion Agenda (UX-01): la agenda operativa, la busqueda de horarios,
 * la recepcion del dia, las series y la lista de espera. Todas las comparten para que el usuario vea
 * las mismas pestanas este donde este.
 *
 * <p>`puedeVerTurnosDelDia` es `turno:read`, el permiso que exigen la recepcion, las series y la lista
 * de espera (`scheduling.routes.ts`). Sin el quedan las dos primeras, que el backend responde igual.
 */
export function pestanasDeAgenda(puedeVerTurnosDelDia: boolean): readonly Pestana[] {
  const agenda: Pestana = { etiqueta: 'Agenda', ruta: '/agenda', exacta: true };
  const disponibilidad: Pestana = { etiqueta: 'Disponibilidad', ruta: '/agenda/disponibilidad' };
  if (!puedeVerTurnosDelDia) {
    return [agenda, disponibilidad];
  }
  return [
    agenda,
    disponibilidad,
    { etiqueta: 'Recepción', ruta: '/agenda/recepcion' },
    { etiqueta: 'Series', ruta: '/agenda/series' },
    { etiqueta: 'Lista de espera', ruta: '/agenda/lista-de-espera' },
  ];
}
