import { MembershipResponseRoleCodeEnum } from '../../../api/generated/model/membership-response';

/**
 * Lecturas del historial de cambios de la agenda de un profesional (M05 y M12): que se cambio,
 * agrupado como lo piensa quien mira, y quien lo hizo.
 *
 * <p>Los codigos de tipo se escriben aca como strings porque el cliente que los trae todavia no
 * esta generado; cuando llegue, {@link GRUPOS_DE_TIPO} se ata a su enum y un tipo nuevo del
 * contrato deja de compilar en vez de quedar sin grupo. Mientras tanto un tipo desconocido se
 * muestra con su codigo crudo, nunca en blanco.
 */

/** Un grupo del filtro de tipo: un rotulo y los codigos que abarca. */
export interface GrupoDeTipo {
  readonly etiqueta: string;
  readonly tipos: readonly string[];
}

const TEXTOS_DE_TIPO: Readonly<Record<string, string>> = {
  HORARIO_ALTA: 'Se agregó un horario',
  HORARIO_EDICION: 'Se cambió un horario',
  HORARIO_BAJA: 'Se quitó un horario',
  EXCEPCION_ALTA: 'Se cargó un cierre o apertura',
  EXCEPCION_EDICION: 'Se cambió un cierre o apertura',
  EXCEPCION_BAJA: 'Se quitó un cierre o apertura',
  TURNO_RESERVA: 'Se reservó un turno',
  TURNO_SOBRETURNO: 'Se dio un sobreturno',
  TURNO_CONFIRMACION: 'Se confirmó un turno',
  TURNO_CANCELACION: 'Se canceló un turno',
  TURNO_AUSENCIA: 'El paciente no vino',
  TURNO_REPROGRAMACION: 'Se movió un turno de horario',
  TURNO_TRASLADO: 'Se trasladó un turno',
  TURNO_OBSERVACIONES: 'Se cambiaron las observaciones de un turno',
};

/** Los tres grupos del filtro, en el orden en que se ofrecen. */
export const GRUPOS_DE_TIPO: readonly GrupoDeTipo[] = [
  {
    etiqueta: 'Horario habitual',
    tipos: ['HORARIO_ALTA', 'HORARIO_EDICION', 'HORARIO_BAJA'],
  },
  {
    etiqueta: 'Cierres y aperturas',
    tipos: ['EXCEPCION_ALTA', 'EXCEPCION_EDICION', 'EXCEPCION_BAJA'],
  },
  {
    etiqueta: 'Turnos',
    tipos: [
      'TURNO_RESERVA',
      'TURNO_SOBRETURNO',
      'TURNO_CONFIRMACION',
      'TURNO_CANCELACION',
      'TURNO_AUSENCIA',
      'TURNO_REPROGRAMACION',
      'TURNO_TRASLADO',
      'TURNO_OBSERVACIONES',
    ],
  },
];

/** Texto del tipo de cambio, o el codigo crudo si el contrato sumo uno que no conocemos. */
export function textoDeTipo(tipo: string | undefined): string {
  if (tipo === undefined || tipo === '') {
    return 'Cambio';
  }
  return TEXTOS_DE_TIPO[tipo] ?? tipo;
}

/** El grupo al que pertenece un tipo, o `undefined` si no es de ninguno. */
export function grupoDeTipo(tipo: string | undefined): GrupoDeTipo | undefined {
  return GRUPOS_DE_TIPO.find((grupo) => grupo.tipos.includes(tipo ?? ''));
}

/**
 * Los codigos de tipo de los grupos elegidos, para el parametro `tipo[]`. Sin grupos elegidos
 * devuelve vacio, que para el backend es "todos".
 */
export function tiposDeGrupos(etiquetas: readonly string[]): string[] {
  return GRUPOS_DE_TIPO.filter((grupo) => etiquetas.includes(grupo.etiqueta)).flatMap((grupo) => [
    ...grupo.tipos,
  ]);
}

/**
 * Nombre del rol de quien hizo el cambio. Vive aca y no se importa de `organization` porque un
 * feature no importa de otro (ADR-0004); los codigos salen del enum generado.
 */
const NOMBRES_DE_ROL: Readonly<Record<string, string>> = {
  [MembershipResponseRoleCodeEnum.ORG_ADMIN]: 'Administrador de la organización',
  [MembershipResponseRoleCodeEnum.CONSULTORIO_ADMIN]: 'Administrador de sede',
  [MembershipResponseRoleCodeEnum.PROFESIONAL]: 'Profesional',
  [MembershipResponseRoleCodeEnum.ADMINISTRATIVO]: 'Administrativo',
  PLATFORM_ADMIN: 'Soporte de la plataforma',
};

/** Rol legible; vacio si no vino, el codigo crudo si es uno que no conocemos. */
export function nombreDeRol(codigo: string | undefined): string {
  if (codigo === undefined || codigo === '') {
    return '';
  }
  return NOMBRES_DE_ROL[codigo] ?? codigo;
}
