import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Motivo por el que fallo una operacion de la pantalla de atencion (M14, AKINE-06.01 y 06.02).
 *
 * <p>Se ramifica por `problemType` y <b>nunca</b> por el texto de `detail`, igual que en el resto
 * de las features: `detail` es prosa y cambia cuando alguien corrige una redaccion.
 *
 * <h2>Los cuatro errores propios llevan a cuatro salidas distintas</h2>
 *
 * <ul>
 *   <li><b>`sesion-ajena`</b> (409): la atencion la esta llevando <b>otro profesional</b>. No es
 *       falta de permiso —dos profesionales de la misma sede tienen el mismo `sesion:register`—
 *       sino <b>propiedad</b> de esa atencion, y por eso el backend responde 409 y no 403.
 *       Decirle "no tenes permiso" a quien si lo tiene lo manda a pedirle a un administrador algo
 *       que ya tiene, y nunca se entera de lo que realmente pasa.</li>
 *   <li><b>`turno-no-atendible`</b> (409): el turno no habilita una atencion. Viaja con `motivo`,
 *       que es lo unico que le dice al profesional que hacer —el turno esta cancelado, la persona
 *       no tiene perfil de paciente, etc.—.</li>
 *   <li><b>`concurrent-modification`</b> (409): otra pestaña guardo antes. <b>No se pierde nada</b>
 *       de lo escrito: la accion es releer la sesion y comparar.</li>
 *   <li><b>`validation-error`</b> (400): dolor fuera de la escala 0-10, o lateralidad sin zona.
 *       Ninguno depende de nada que pueda cambiar entre dos peticiones, asi que reintentar no los
 *       arregla: hay que corregir el campo.</li>
 * </ul>
 */
export type CausaAtencion =
  /** 400 validation-error: dolor fuera de 0-10, o lateralidad sin zona. */
  | 'validacion'
  /** 403 missing-tenant-context: hay sesion, pero no hay sede elegida. NUNCA cerrar sesion. */
  | 'sin-contexto'
  /** 403 forbidden: falta `sesion:register` en esta sede. */
  | 'sin-permiso'
  /** 404: la sesion, el turno o la sede no existen, o son de otro tenant. */
  | 'no-encontrado'
  /** 409 `sesion-ajena`: la atiende otro profesional. Es propiedad, no permiso. */
  | 'sesion-ajena'
  /** 409 `turno-no-atendible`: el turno no habilita una atencion. Ver `motivo`. */
  | 'turno-no-atendible'
  /** 409 `concurrent-modification`: otra pestaña guardo antes. Releer y comparar. */
  | 'version-vieja'
  /** 409 subscription-suspended: lo emite el filtro, antes del controller. */
  | 'suscripcion-suspendida'
  /** Cualquier otro 409. Gana el `detail` del backend. */
  | 'conflicto'
  /** 429: hay que esperar. */
  | 'limite'
  /** El request nunca llego: sin red, CORS o servidor caido. */
  | 'red'
  | 'otro';

/** Error ya traducido a algo mostrable. */
export interface ErrorAtencion {
  readonly mensaje: string;
  readonly causa: CausaAtencion;
  /** Por que el turno no es atendible. Vacio fuera de `turno-no-atendible`. */
  readonly motivo: string;
}

const MENSAJE_GENERICO = 'No pudimos completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED =
  'No se pudo contactar al servidor, asi que lo ultimo que escribiste todavia no esta guardado. ' +
  'No cierres esta pantalla: revisa la conexion y volve a guardar.';
const MENSAJE_LIMITE = 'Demasiados intentos seguidos. Espera un momento y volve a guardar.';

const MENSAJE_SIN_CONTEXTO =
  'Para registrar una atencion hay que saber en que sede estas. Eligi una organizacion y un ' +
  'consultorio, y volve a entrar. Tu sesion sigue abierta.';

const MENSAJE_SIN_PERMISO =
  'No tenes permiso para registrar atenciones en esta sede. Pediselo a quien administra el centro.';

const MENSAJE_NO_ENCONTRADO =
  'Ese turno o esa atencion no existen, o no son de esta sede. Volve a la agenda y entra de nuevo.';

/**
 * `sesion-ajena` explicado como lo que es: propiedad, no permiso.
 *
 * <p>El texto evita a proposito la palabra "permiso". Quien lee esto <b>si</b> tiene
 * `sesion:register`; lo que no tiene es esta atencion, que es de otro profesional.
 */
const MENSAJE_SESION_AJENA =
  'Esta atencion la esta registrando otro profesional. No es un problema de permisos: la atencion ' +
  'es de quien la lleva, y solo esa persona puede escribir en ella. Si el turno quedo asignado a ' +
  'quien no corresponde, se corrige desde la agenda.';

const MENSAJE_VERSION_VIEJA =
  'Otra pestaña guardo esta atencion despues de que vos la abriste. No pisamos nada y no perdimos ' +
  'lo que escribiste.';

const MENSAJE_SUSCRIPCION_SUSPENDIDA =
  'La suscripcion de la organizacion esta suspendida, asi que no se pueden registrar atenciones.';

const MENSAJE_CONFLICTO =
  'El servidor rechazo la operacion por un conflicto con lo que ya hay guardado. Volve a abrir ' +
  'la atencion para ver el estado actual.';

const MENSAJE_VALIDACION =
  'El servidor rechazo un dato clinico. El dolor va de 0 a 10, y la lateralidad exige una zona: ' +
  '"derecha" de que.';

/** Traduce cualquier error de la pantalla de atencion. */
export function traducirErrorAtencion(error: unknown): ErrorAtencion {
  if (!(error instanceof AkineHttpError)) {
    return { mensaje: MENSAJE_GENERICO, causa: 'otro', motivo: '' };
  }

  if (error.esDeRed) {
    return { mensaje: MENSAJE_DE_RED, causa: 'red', motivo: '' };
  }

  if (error.esRateLimited) {
    return { mensaje: MENSAJE_LIMITE, causa: 'limite', motivo: '' };
  }

  switch (error.problemType) {
    case 'missing-tenant-context':
      return { mensaje: MENSAJE_SIN_CONTEXTO, causa: 'sin-contexto', motivo: '' };
    case 'subscription-suspended':
      return {
        mensaje: MENSAJE_SUSCRIPCION_SUSPENDIDA,
        causa: 'suscripcion-suspendida',
        motivo: '',
      };
    case 'sesion-ajena':
      return { mensaje: MENSAJE_SESION_AJENA, causa: 'sesion-ajena', motivo: '' };
    case 'turno-no-atendible':
      return {
        mensaje: conDetalle(error, 'Este turno no habilita una atencion.'),
        causa: 'turno-no-atendible',
        motivo: textoDeExtension(error, 'motivo'),
      };
    case 'concurrent-modification':
      return { mensaje: MENSAJE_VERSION_VIEJA, causa: 'version-vieja', motivo: '' };
    case 'validation-error':
      return { mensaje: conDetalle(error, MENSAJE_VALIDACION), causa: 'validacion', motivo: '' };
    default:
      break;
  }

  if (error.status === 403) {
    return { mensaje: MENSAJE_SIN_PERMISO, causa: 'sin-permiso', motivo: '' };
  }

  if (error.status === 404) {
    // Inexistente y de otro tenant responden igual a proposito: distinguirlos permitiria
    // enumerar sedes ajenas probando ids.
    return { mensaje: MENSAJE_NO_ENCONTRADO, causa: 'no-encontrado', motivo: '' };
  }

  if (error.status === 409) {
    return { mensaje: conDetalle(error, MENSAJE_CONFLICTO), causa: 'conflicto', motivo: '' };
  }

  if (error.status === 400) {
    return { mensaje: conDetalle(error, MENSAJE_VALIDACION), causa: 'validacion', motivo: '' };
  }

  return { mensaje: conDetalle(error, MENSAJE_GENERICO), causa: 'otro', motivo: '' };
}

/**
 * Extension de texto, o cadena vacia.
 *
 * <p>`extension()` devuelve `unknown` a proposito: el contrato no tipa estas claves. Validar en
 * vez de confiar evita que un `motivo` numerico termine impreso como `[object Object]`.
 */
function textoDeExtension(error: AkineHttpError, clave: string): string {
  const valor = error.extension(clave);
  return typeof valor === 'string' ? valor : '';
}

/** El mensaje del backend, o el de respaldo si el cuerpo no traia `ProblemDetail`. */
function conDetalle(error: AkineHttpError, respaldo: string): string {
  return error.problem === null ? respaldo : error.mensaje;
}
