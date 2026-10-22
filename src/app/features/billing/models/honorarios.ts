import { ClaseExcluidaDeHonorariosMotivoEnum as Motivo } from '../../../api/generated/model/clase-excluida-de-honorarios';
import { LineaDeHonorario } from '../../../api/generated/model/linea-de-honorario';
import { aCentavos, deCentavos, sumaDeCentavos } from './dinero';

/**
 * Honorarios por clase (DP-38, RF-M22-006/007): lo que la pantalla de liquidacion calcula sobre el
 * borrador del backend, y nada mas.
 *
 * <p><b>Una liquidacion es de UNA oferta</b>: su egreso se imputa a ella (DP-39). Un borrador pedido
 * sin oferta puede mezclar varias, y el backend responde 400 si se lo confirma entero. Por eso las
 * lineas se agrupan por oferta y cada grupo se confirma por separado, con su `ofertaId`, sus
 * `claseIds` y su total: exactamente lo que el backend recalcula con ese filtro.
 */
export interface GrupoDeHonorarios {
  readonly ofertaId: number;
  readonly ofertaNombre: string;
  readonly lineas: readonly LineaDeHonorario[];
  readonly claseIds: readonly number[];
  /** Suma exacta de las partes del colaborador, en centavos enteros. */
  readonly total: number;
  readonly moneda: string | undefined;
}

/** Agrupa las lineas por oferta, en el orden en que aparece cada una. */
export function agruparPorOferta(
  lineas: readonly LineaDeHonorario[],
): readonly GrupoDeHonorarios[] {
  const grupos = new Map<number, LineaDeHonorario[]>();
  for (const linea of lineas) {
    if (linea.ofertaId === undefined || linea.claseId === undefined) {
      continue;
    }
    const grupo = grupos.get(linea.ofertaId);
    if (grupo === undefined) {
      grupos.set(linea.ofertaId, [linea]);
    } else {
      grupo.push(linea);
    }
  }
  return [...grupos.entries()].map(([ofertaId, delGrupo]) => ({
    ofertaId,
    ofertaNombre: delGrupo[0].ofertaNombre || `Oferta #${ofertaId}`,
    lineas: delGrupo,
    claseIds: delGrupo.map((l) => l.claseId as number),
    total: sumaDeCentavos(delGrupo.map((l) => aCentavos(l.importeColaborador) ?? 0)),
    moneda: delGrupo[0].moneda,
  }));
}

/** El total de un grupo, como lo espera el contrato (decimal con dos posiciones). */
export function importeDelGrupo(grupo: GrupoDeHonorarios): number {
  return deCentavos(grupo.total);
}

/** Por que una clase del periodo no entra en la liquidacion, dicho para quien liquida. */
export function motivoDeExclusionEnPalabras(motivo: string | undefined): string {
  switch (motivo) {
    case Motivo.YA_LIQUIDADA:
      return 'Ya liquidada a este colaborador';
    case Motivo.SIN_HONORARIO:
      return 'La oferta no tenia tarifa de honorario ese día';
    case Motivo.SIN_PRESENTES:
      return 'Ningún participante presente';
    case Motivo.SIN_IMPORTE:
      return 'La parte de este instructor da cero';
    default:
      return motivo ?? '';
  }
}

/** "1 de 2": que parte del reparto le toca al colaborador. */
export function parteEnPalabras(linea: LineaDeHonorario): string {
  if (linea.instructores === undefined || linea.instructores <= 1) {
    return 'Unico instructor';
  }
  return `Parte ${linea.posicion ?? '?'} de ${linea.instructores}`;
}
