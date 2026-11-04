import { CambioDeAgendaTipoEnum } from '../../../api/generated/model/cambio-de-agenda';
import { ListarHistorialDeAgendaRequestParams } from '../../../api/generated/api/agenda.serviceInterface';
import { MembershipResponseRoleCodeEnum } from '../../../api/generated/model/membership-response';
import { aInstanteUtc } from '../../../shared/utils/instantes';
import { textoDeBusqueda } from '../../../shared/utils/texto-de-busqueda';
import { esFechaDeCalendario, sumarDias } from './ventana-de-fechas';

/**
 * Lecturas del historial de cambios de la agenda de un profesional (M05 y M12, contrato 0.155.0):
 * que se cambio, agrupado como lo piensa quien mira, quien lo hizo y los parametros de la consulta.
 *
 * <p>Los tipos salen del enum generado: {@link TEXTOS_DE_TIPO} es un `Record` sobre el enum, asi
 * que un tipo nuevo del contrato deja de compilar en vez de quedar sin texto. Un tipo que llegue
 * igual sin conocerse (el servidor adelantado al cliente) se muestra con su codigo crudo.
 */

/** Un grupo del filtro de tipo: un rotulo y los codigos que abarca. */
export interface GrupoDeTipo {
  readonly etiqueta: string;
  readonly tipos: readonly CambioDeAgendaTipoEnum[];
}

const T = CambioDeAgendaTipoEnum;

const TEXTOS_DE_TIPO: Readonly<Record<CambioDeAgendaTipoEnum, string>> = {
  [T.HORARIO_ALTA]: 'Se agregó un horario',
  [T.HORARIO_EDICION]: 'Se cambió un horario',
  [T.HORARIO_BAJA]: 'Se quitó un horario',
  [T.EXCEPCION_ALTA]: 'Se cargó un cierre o apertura',
  [T.EXCEPCION_EDICION]: 'Se cambió un cierre o apertura',
  [T.EXCEPCION_BAJA]: 'Se quitó un cierre o apertura',
  [T.TURNO_RESERVA]: 'Se reservó un turno',
  [T.TURNO_SOBRETURNO]: 'Se dio un sobreturno',
  [T.TURNO_CONFIRMACION]: 'Se confirmó un turno',
  [T.TURNO_CANCELACION]: 'Se canceló un turno',
  [T.TURNO_AUSENCIA]: 'El paciente no vino',
  [T.TURNO_REPROGRAMACION]: 'Se movió un turno de horario',
  [T.TURNO_TRASLADO]: 'Se trasladó un turno de sede',
  [T.TURNO_OBSERVACIONES]: 'Se cambiaron las observaciones de un turno',
};

/** Los tres grupos del filtro, en el orden en que se ofrecen. Juntos cubren todo el enum. */
export const GRUPOS_DE_TIPO: readonly GrupoDeTipo[] = [
  {
    etiqueta: 'Horario habitual',
    tipos: [T.HORARIO_ALTA, T.HORARIO_EDICION, T.HORARIO_BAJA],
  },
  {
    etiqueta: 'Cierres y aperturas',
    tipos: [T.EXCEPCION_ALTA, T.EXCEPCION_EDICION, T.EXCEPCION_BAJA],
  },
  {
    etiqueta: 'Turnos',
    tipos: [
      T.TURNO_RESERVA,
      T.TURNO_SOBRETURNO,
      T.TURNO_CONFIRMACION,
      T.TURNO_CANCELACION,
      T.TURNO_AUSENCIA,
      T.TURNO_REPROGRAMACION,
      T.TURNO_TRASLADO,
      T.TURNO_OBSERVACIONES,
    ],
  },
];

/** Texto del tipo de cambio, o el codigo crudo si el contrato sumo uno que no conocemos. */
export function textoDeTipo(tipo: string | undefined): string {
  if (tipo === undefined || tipo === '') {
    return 'Cambio';
  }
  return TEXTOS_DE_TIPO[tipo as CambioDeAgendaTipoEnum] ?? tipo;
}

/** El grupo al que pertenece un tipo, o `undefined` si no es de ninguno. */
export function grupoDeTipo(tipo: string | undefined): GrupoDeTipo | undefined {
  return GRUPOS_DE_TIPO.find((grupo) => grupo.tipos.includes(tipo as CambioDeAgendaTipoEnum));
}

/**
 * Los codigos de tipo de los grupos elegidos, para el parametro `tipo`. Sin grupos elegidos
 * devuelve vacio, que para el backend es "todos".
 */
export function tiposDeGrupos(etiquetas: readonly string[]): CambioDeAgendaTipoEnum[] {
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
};

/** Rol legible; vacio si no vino (eventos viejos), el codigo crudo si no lo conocemos. */
export function nombreDeRol(codigo: string | undefined): string {
  if (codigo === undefined || codigo === '') {
    return '';
  }
  return NOMBRES_DE_ROL[codigo] ?? codigo;
}

/** Lo que el formulario de la pantalla junta para consultar. */
export interface ConsultaDeCambios {
  readonly orgId: number;
  readonly profesionalId: number;
  /** Sede a la que se acota, o `null` para todas las que el lector puede ver. */
  readonly consultorioId: number | null;
  readonly grupos: readonly string[];
  /** Primer dia (`AAAA-MM-DD`) en la zona de la sede, incluido; vacio para "sin limite". */
  readonly desde: string;
  /** Ultimo dia (`AAAA-MM-DD`) en la zona de la sede, INCLUIDO; vacio para "sin limite". */
  readonly hasta: string;
  readonly q: string;
  readonly page: number;
  readonly size: number;
  readonly sort: ListarHistorialDeAgendaRequestParams['sort'];
  /** Zona IANA de la sede; vacia cae a la del navegador. */
  readonly zona: string;
}

/**
 * Los parametros de `listarHistorialDeAgenda`.
 *
 * <p><b>Las fechas son de cuando ocurrio el cambio, no del turno</b>, y el backend las recibe como
 * instantes UTC con `hasta` exclusivo. Quien elige "hasta el 30" espera ver lo que paso ese dia: se
 * manda la medianoche del 31 en la zona de la sede. Una fecha que no es de calendario se omite.
 */
export function armarParametros(consulta: ConsultaDeCambios): ListarHistorialDeAgendaRequestParams {
  const tipos = tiposDeGrupos(consulta.grupos);
  const desde = esFechaDeCalendario(consulta.desde)
    ? aInstanteUtc(`${consulta.desde}T00:00`, consulta.zona)
    : null;
  const hasta = esFechaDeCalendario(consulta.hasta)
    ? aInstanteUtc(`${sumarDias(consulta.hasta, 1)}T00:00`, consulta.zona)
    : null;
  return {
    orgId: consulta.orgId,
    profesionalId: consulta.profesionalId,
    consultorioId: consulta.consultorioId ?? undefined,
    tipo: tipos.length > 0 ? tipos : undefined,
    desde: desde ?? undefined,
    hasta: hasta ?? undefined,
    q: textoDeBusqueda(consulta.q),
    page: consulta.page,
    size: consulta.size,
    sort: consulta.sort,
  };
}
