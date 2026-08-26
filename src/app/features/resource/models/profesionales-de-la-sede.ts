import {
  MembershipResponse,
  MembershipResponseEstadoEnum,
  MembershipResponseRoleCodeEnum,
} from '../../../api/generated/model/membership-response';

/**
 * Quienes pueden tener horario —y recibir excepciones— en una sede concreta (M05, AKINE-02.04).
 *
 * <p>Vive aparte de las pantallas porque lo usan <b>dos</b>: el editor del horario semanal
 * arma con esto su selector de profesional, y el panel de excepciones lo necesita ademas para
 * contar <b>a cuanta gente le cambia el dia</b> una apertura de sede. Si cada una lo
 * escribiera por su lado, un dia una ofreceria a alguien que la otra no cuenta y el aviso
 * diria un numero que no coincide con la lista de al lado.
 */

/**
 * Cuantos vinculos se piden para armar el selector de profesionales.
 *
 * <p>Es el tope que el backend recorta. El selector no se pagina a proposito: un desplegable
 * con "pagina siguiente" es una interfaz que nadie entiende, y un centro con mas de cien
 * vinculos vigentes necesita un buscador, no una pagina 2.
 */
export const TOPE_DE_VINCULOS = 100;

/**
 * Un vinculo que habilita a atender en esta sede.
 *
 * <p>`consultorioId` nulo significa alcance de toda la organizacion, no "sin sede": ese
 * vinculo si habilita. Confundirlo dejaria fuera justamente a los profesionales que atienden
 * en todas las sedes.
 */
export function atiendeEn(vinculo: MembershipResponse, consultorioId: number): boolean {
  const esProfesional = vinculo.roleCode === MembershipResponseRoleCodeEnum.PROFESIONAL;
  const vigente = vinculo.estado === MembershipResponseEstadoEnum.ACTIVA;
  const alcanza =
    vinculo.consultorioId === undefined ||
    vinculo.consultorioId === null ||
    vinculo.consultorioId === consultorioId;
  return esProfesional && vigente && alcanza;
}

/** Como se nombra a un profesional en un selector o en un aviso. Nunca "undefined". */
export function nombreDeVinculo(vinculo: MembershipResponse | undefined): string {
  return vinculo?.accountName || vinculo?.accountEmail || 'el profesional';
}

/**
 * Cuantos profesionales quedan afectados, redactado.
 *
 * <p>Existe porque el aviso de la apertura de sede tiene que decir un numero concreto, y
 * "los 1 profesionales de la sede" o "los 0 profesionales de la sede" convierten una
 * advertencia seria en algo que se lee como un error de la aplicacion y se ignora.
 */
export function textoDeProfesionales(cantidad: number): string {
  if (cantidad <= 0) {
    return 'ningun profesional vinculado hoy a la sede';
  }
  if (cantidad === 1) {
    return '1 profesional';
  }
  return `${cantidad} profesionales`;
}
