import { Pestana } from '../../../shared/components/pestanas/pestanas';

/** `aria-label` de las pestanas de la seccion Agenda. */
export const ETIQUETA_PESTANAS_DE_AGENDA = 'Pantallas de la agenda';

/**
 * Las pantallas hermanas de la seccion Agenda (UX-01): buscador de turnos, recepcion del dia y
 * series. Las tres las comparten para que el usuario vea las mismas pestanas este donde este.
 *
 * <p>`puedeVerTurnosDelDia` es `turno:read`, el permiso que exigen las rutas de recepcion y de
 * series (`scheduling.routes.ts`). Sin el, queda solo el buscador y el componente no dibuja nada.
 */
export function pestanasDeAgenda(puedeVerTurnosDelDia: boolean): readonly Pestana[] {
  const buscador: Pestana = { etiqueta: 'Turnos', ruta: '/agenda', exacta: true };
  if (!puedeVerTurnosDelDia) {
    return [buscador];
  }
  return [
    buscador,
    { etiqueta: 'Recepcion', ruta: '/agenda/recepcion' },
    { etiqueta: 'Series', ruta: '/agenda/series' },
  ];
}
