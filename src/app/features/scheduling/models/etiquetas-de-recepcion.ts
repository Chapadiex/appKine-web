import { Recepcion, RecepcionEstadoEnum } from '../../../api/generated/model/recepcion';

/**
 * Textos y lecturas de la Recepcion con maquina propia (M13, AKINE E-4, DP-16).
 *
 * <p>Vive en `features/` por la misma razon que `etiquetas-de-turno`: sabe que es una llegada, una
 * validacion y una espera, y por que ninguna de las tres es una atencion (AGENT.md 4.1).
 *
 * <p><b>Ningun texto de aca dice que el paciente fue atendido.</b> `LLAMADA` significa que alguien
 * lo llamo desde la sala, no que la Sesion exista: son dos actos de dos personas (DP-05). La
 * prestacion la registra la Sesion, que es otra pantalla y otra maquina.
 */
const TEXTOS_DE_RECEPCION: Readonly<Record<RecepcionEstadoEnum, string>> = {
  [RecepcionEstadoEnum.LLEGO]: 'Llego — falta validar como se atiende',
  [RecepcionEstadoEnum.VALIDADA]: 'Validada — ya se sabe como se atiende',
  [RecepcionEstadoEnum.OBSERVADA]:
    'Observada — la validacion encontro algo; advierte, no impide pasar a espera',
  [RecepcionEstadoEnum.EN_ESPERA]: 'En espera — llego y aguarda ser llamado',
  [RecepcionEstadoEnum.LLAMADA]:
    'Llamada — lo llamaron desde la sala; la atencion es otro registro',
  [RecepcionEstadoEnum.ANULADA]: 'Anulada — el check-in fue un error y la llegada no vale',
  [RecepcionEstadoEnum.CERRADA]: 'Cerrada — el turno se cancelo con la persona presente',
};

/** Estados en los que la recepcion ya no admite ninguna transicion. */
const CERRADOS: ReadonlySet<string> = new Set<string>([
  RecepcionEstadoEnum.ANULADA,
  RecepcionEstadoEnum.CERRADA,
]);

/** Texto del estado, o el codigo crudo si el contrato sumo uno que este cliente no conoce. */
export function textoDeRecepcion(estado: string | undefined): string {
  if (estado === undefined || estado === '') {
    return 'Estado desconocido';
  }
  return TEXTOS_DE_RECEPCION[estado as RecepcionEstadoEnum] ?? estado;
}

/** `Con cobertura` / `Particular`, o vacio mientras no se resolvio. */
export function textoDeModalidad(modalidad: string | undefined): string {
  switch (modalidad) {
    case 'COBERTURA':
      return 'Con cobertura';
    case 'PARTICULAR':
      return 'Particular';
    default:
      return '';
  }
}

/**
 * `true` cuando hay una recepcion que todavia admite transiciones.
 *
 * <p>Una `ANULADA` no cuenta: la llegada no valia y el turno admite un check-in nuevo. Una
 * `CERRADA` tampoco: el turno se cancelo.
 */
export function recepcionAbierta(recepcion: Recepcion | undefined): boolean {
  return recepcion?.estado !== undefined && !CERRADOS.has(recepcion.estado);
}
