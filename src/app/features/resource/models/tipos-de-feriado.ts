/**
 * Etiquetas legibles de la clasificacion oficial de un feriado (M05, AKINE-02.04).
 *
 * <p><b>No sale de un enum generado, y no se puede.</b> El contrato publica `tipo` como texto
 * libre a proposito —la lista valida la fija el `CHECK` de la migracion `V22` y esta version del
 * contrato no ramifica comportamiento por tipo, solo lo muestra—, asi que el compilador no
 * verifica nada de lo de abajo. Por eso los cinco valores se escriben tal como los declara ese
 * `CHECK`: `INAMOVIBLE`, `TRASLADABLE`, `PUENTE`, `NO_LABORABLE`, `RELIGIOSO`.
 *
 * <p><b>El tipo no cambia si la sede cierra.</b> Eso lo decide `cierraPorFeriado` de la sede,
 * una sola casilla para todos. La clasificacion se muestra porque explica <b>por que un feriado
 * cae el dia que cae</b> —un trasladable se corre por decreto y un inamovible no—, que es lo que
 * un administrador necesita para entender un calendario que no coincide con el del año pasado.
 */
const ETIQUETAS: Readonly<Record<string, string>> = {
  INAMOVIBLE: 'Inamovible',
  TRASLADABLE: 'Trasladable',
  PUENTE: 'Puente',
  NO_LABORABLE: 'No laborable',
  RELIGIOSO: 'Religioso',
};

/**
 * Etiqueta legible de un tipo de feriado, o el codigo crudo si llega uno desconocido.
 *
 * <p>Devolver el codigo y no un guion es deliberado, igual que en `tipos-de-espacio.ts`: un tipo
 * nuevo cargado por el backend tiene que verse —aunque sea feo— y no desaparecer de la fila.
 */
export function etiquetaDeTipoDeFeriado(tipo: string | undefined): string {
  if (tipo === undefined || tipo === null || tipo === '') {
    return '-';
  }
  return ETIQUETAS[tipo] ?? tipo;
}
