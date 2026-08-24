import { MembershipResponseRoleCodeEnum } from '../../../api/generated/model/membership-response';

/**
 * Roles de vinculo que se pueden elegir en la interfaz, con su etiqueta en pantalla.
 *
 * <p><b>Los codigos NO se escriben a mano.</b> Salen del enum del cliente generado, asi que
 * si el contrato agrega, renombra o quita un rol, esto deja de compilar en vez de ofrecer
 * en un `select` un valor que el backend rechaza con `400`. Lo unico local es el texto que
 * lee el usuario, que el contrato no tiene por que definir.
 *
 * <p>`PLATFORM_ADMIN` no aparece y no puede aparecer: no es un rol de vinculo -es de
 * plataforma- y el backend lo rechaza con `400` si llega en un `roleCode`. Al derivarse del
 * enum, tampoco esta disponible para ponerlo por error.
 */
export const ROLES_DE_VINCULO = [
  {
    codigo: MembershipResponseRoleCodeEnum.ORG_ADMIN,
    etiqueta: 'Administrador de la organizacion',
  },
  {
    codigo: MembershipResponseRoleCodeEnum.CONSULTORIO_ADMIN,
    etiqueta: 'Administrador de sede',
  },
  {
    codigo: MembershipResponseRoleCodeEnum.PROFESIONAL,
    etiqueta: 'Profesional',
  },
  {
    codigo: MembershipResponseRoleCodeEnum.ADMINISTRATIVO,
    etiqueta: 'Administrativo',
  },
] as const;

/** Estados de un vinculo, con el texto que se muestra en la columna correspondiente. */
export const ETIQUETA_DE_ESTADO: Readonly<Record<string, string>> = {
  ACTIVA: 'Activa',
  SUSPENDIDA: 'Suspendida',
  REVOCADA: 'Revocada',
};

/** Etiqueta legible de un rol, o el codigo crudo si el backend manda uno que no conocemos. */
export function etiquetaDeRol(codigo: string | undefined): string {
  return ROLES_DE_VINCULO.find((rol) => rol.codigo === codigo)?.etiqueta ?? codigo ?? '-';
}
