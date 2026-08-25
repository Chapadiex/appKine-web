import { EspacioResponseTipoEnum } from '../../../api/generated/model/espacio-response';

/**
 * Etiquetas legibles de la clasificacion fisica de un espacio (M04, RF-M04-007).
 *
 * <p><b>El catalogo no se escribe a mano.</b> Los seis valores salen del enum generado desde
 * el contrato: si el backend suma `CONSULTORIO_EXTERNO` o renombra uno, el `Record` deja de
 * compilar y alguien tiene que decidir como se llama en pantalla. Una lista literal paralela
 * se desincroniza en silencio y el selector muestra cinco opciones de seis.
 *
 * <p><b>El tipo NO habilita servicios ni define roles</b> (RN-M04-007): que un recurso sea
 * `PILETA` no autoriza a nadie a hacer hidroterapia ahi. Eso lo resuelve la habilitacion por
 * Oferta de Servicio, que es otro modulo. Aca es descripcion fisica y nada mas, y por eso
 * ninguna etiqueta promete una prestacion.
 */
const ETIQUETAS: Readonly<Record<EspacioResponseTipoEnum, string>> = {
  [EspacioResponseTipoEnum.BOX]: 'Box',
  [EspacioResponseTipoEnum.GIMNASIO]: 'Gimnasio',
  [EspacioResponseTipoEnum.GABINETE]: 'Gabinete',
  [EspacioResponseTipoEnum.SALA_GRUPAL]: 'Sala grupal',
  [EspacioResponseTipoEnum.PILETA]: 'Pileta',
  [EspacioResponseTipoEnum.OTRO]: 'Otro',
};

/** Opciones del selector de tipo, en el orden del contrato. */
export const TIPOS_DE_ESPACIO: readonly { readonly valor: string; readonly etiqueta: string }[] =
  Object.values(EspacioResponseTipoEnum).map((valor) => ({
    valor,
    etiqueta: ETIQUETAS[valor],
  }));

/**
 * Etiqueta legible de un tipo, o el codigo crudo si el backend manda uno desconocido.
 *
 * <p>Devolver el codigo y no un guion es deliberado: un tipo nuevo publicado por el backend
 * antes de que este repo regenere el cliente tiene que verse -aunque sea feo- y no
 * desaparecer de la fila. Un espacio sin tipo visible se lee como un dato faltante.
 */
export function etiquetaDeTipo(tipo: string | undefined): string {
  if (tipo === undefined) {
    return '-';
  }
  return ETIQUETAS[tipo as EspacioResponseTipoEnum] ?? tipo;
}
