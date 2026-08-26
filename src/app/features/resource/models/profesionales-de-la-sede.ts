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

/**
 * Si la respuesta trae <b>todos</b> los vinculos de la organizacion, o solo los primeros.
 *
 * <p><b>Por que hace falta preguntarlo.</b> `listMemberships` solo acepta `page` y `size`: no
 * filtra por sede ni por rol, y el backend recorta el tamaño de pagina en
 * {@link TOPE_DE_VINCULOS}. Las tres pantallas piden la pagina 0 y nada mas —el selector no se
 * pagina a proposito—, asi que en una organizacion con mas vinculos que el tope <b>se ve un
 * recorte de la nomina, ordenado por id</b>. Los profesionales de esta sede pueden estar casi
 * todos afuera.
 *
 * <p><b>Lo que esto NO puede hacer es corregir el numero.</b> `totalElements` cuenta los
 * vinculos de la organizacion entera —administrativos, otras sedes, vencidos— y no se parece al
 * numero de profesionales de esta sede. Sirve para una sola cosa, que es justamente la que hace
 * falta: <b>detectar que la lista puede estar incompleta</b>. Con eso, el aviso de la apertura
 * de sede vuelve a decir que no pudo medir, en vez de afirmar un numero mas chico que el real.
 *
 * <p>Se considera incompleta tambien cuando llego <b>exactamente</b> llena sin `totalElements`:
 * una pagina que raspa el tope es indistinguible de una que quedo cortada, y ante la duda esta
 * funcion elige dudar. El precio de equivocarse hacia este lado es un cartel que dice "no
 * sabemos"; hacia el otro, un cierre de sede confirmado sobre un numero falso.
 */
export function esListaCompleta(respuesta: {
  readonly content?: readonly unknown[];
  readonly totalElements?: number;
}): boolean {
  const recibidos = respuesta.content?.length ?? 0;

  if (recibidos >= TOPE_DE_VINCULOS) {
    return false;
  }

  const total = respuesta.totalElements;
  return typeof total !== 'number' || total <= recibidos;
}

/**
 * Lo que se dice al lado de un selector armado con una lista que puede estar recortada.
 *
 * <p>Un desplegable al que le falta gente se lee como "esa persona no esta vinculada", que es
 * una conclusion falsa y ademas accionable: manda a Colaboradores a arreglar un vinculo que
 * esta perfecto. El texto nombra el tope porque es lo unico que le permite a quien lo lee
 * entender por que pasa y que no es un error de sus datos.
 */
export const TEXTO_LISTA_INCOMPLETA =
  `Esta organizacion tiene mas de ${TOPE_DE_VINCULOS} vinculos y aca se muestran solo los ` +
  'primeros, asi que la lista puede estar incompleta. Si no encontras a alguien, no significa ' +
  'que no este vinculado a esta sede.';
