import { CasoClinicoEstadoEnum } from '../../../api/generated/model/caso-clinico';
import { CasoEventoTipoEnum } from '../../../api/generated/model/caso-evento';
import {
  CasoProfesional,
  CasoProfesionalRolEnum,
} from '../../../api/generated/model/caso-profesional';
import { PlanTratamientoEstadoEnum } from '../../../api/generated/model/plan-tratamiento';

/**
 * Rotulos de casos y planes (D-b, D-c). Salen de los enums generados: un valor nuevo del contrato
 * no compila sin su rotulo.
 */
export const ESTADOS_DE_CASO: Readonly<Record<CasoClinicoEstadoEnum, string>> = {
  ACTIVO: 'Activo',
  CERRADO: 'Cerrado',
};

export const ROLES_EN_CASO: Readonly<Record<CasoProfesionalRolEnum, string>> = {
  RESPONSABLE: 'Responsable',
  TRATANTE: 'Tratante',
};

export const EVENTOS_DE_CASO: Readonly<Record<CasoEventoTipoEnum, string>> = {
  APERTURA: 'Apertura',
  EDICION: 'Edicion',
  CIERRE: 'Cierre',
  REAPERTURA: 'Reapertura',
  CAMBIO_DE_EQUIPO: 'Cambio de equipo',
};

export const ESTADOS_DE_PLAN: Readonly<Record<PlanTratamientoEstadoEnum, string>> = {
  BORRADOR: 'Borrador',
  ACTIVO: 'Activo',
  SUSPENDIDO: 'Suspendido',
  FINALIZADO: 'Finalizado',
};

/** Quien sigue en el caso: el que salio tiene fecha de `hasta` y sigue figurando como historia. */
export function esVigente(integrante: CasoProfesional): boolean {
  return integrante.vigente !== false && integrante.hasta === undefined;
}

/**
 * Una fecha `YYYY-MM-DD` en dia/mes/año. Solo para fechas de calendario (una vigencia): un
 * instante se muestra con `fechaYHora`, que lo pasa a la zona local.
 */
export function diaEnPalabras(valor: string | undefined): string {
  if (!valor) return 'sin fecha';
  const [anio, mes, dia] = valor.slice(0, 10).split('-');
  return dia && mes && anio ? `${dia}/${mes}/${anio}` : valor;
}
