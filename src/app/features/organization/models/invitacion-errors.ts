import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Motivo por el que fallo una operacion sobre invitaciones (M05, AKINE-02.03).
 *
 * <p>Se ramifica por `problemType` y nunca por el texto de `detail`, igual que el resto de los
 * traductores del repo.
 *
 * <p><b>Cubre las dos mitades del flujo</b> —la del administrador que invita y la del invitado
 * que responde— y no se parte en dos archivos, aunque las pantallas sean distintas: los codigos
 * son los mismos y el que aparece en las dos puntas es justamente el mas delicado
 * (`invitacion-ya-resuelta`, que es la carrera entre las dos personas).
 */
export type CausaInvitacion =
  /** 403 missing-tenant-context: hay sesion, pero no hay organizacion elegida. */
  | 'sin-contexto'
  /** 403 forbidden: falta `colaborador:manage`. */
  | 'sin-permiso'
  /** 400 validation-error. */
  | 'validacion'
  /** 404: no existe, es de otro tenant, o el token no resuelve. */
  | 'no-encontrado'
  /** 409 invitacion-pendiente-duplicada: ya hay una viva para esa persona y ese alcance. */
  | 'pendiente-duplicada'
  /** 409 invitacion-vencida: el enlace expiro. Se resuelve reenviando. */
  | 'vencida'
  /** 409 invitacion-ya-resuelta: alguien llego primero. */
  | 'ya-resuelta'
  /** 409 colaborador-ya-vinculado: esa persona ya trabaja en la organizacion. */
  | 'ya-vinculado'
  /** 409 plan-limit-exceeded: el tenant llego al tope de miembros de su plan. */
  | 'tope-de-plan'
  /** 409 subscription-suspended: lo emite el filtro, antes del controller. */
  | 'suscripcion-suspendida'
  /** 429: hay que esperar. Ver `segundosDeEspera`. */
  | 'limite'
  /** El request nunca llego: sin red, CORS o servidor caido. */
  | 'red'
  | 'otro';

/** Error ya traducido a algo mostrable. */
export interface ErrorInvitacion {
  readonly mensaje: string;
  readonly causa: CausaInvitacion;
  /** Segundos a esperar antes de reintentar. 0 fuera de `limite`. */
  readonly segundosDeEspera: number;
}

const MENSAJE_GENERICO = 'No pudimos completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa tu conexion y volve a intentar.';
const MENSAJE_LIMITE_SIN_PLAZO =
  'Demasiados intentos. Espera un momento antes de volver a intentar.';

const MENSAJE_SIN_CONTEXTO =
  'Una invitacion la emite una organizacion concreta y todavia no elegiste ninguna. Eligi un ' +
  'consultorio para administrar las invitaciones.';

const MENSAJE_SIN_PERMISO =
  'No tenes permiso para administrar las invitaciones de esta organizacion. Pediselo a quien la ' +
  'administra.';

/**
 * 404 sobre una invitacion.
 *
 * <p>El texto sirve para las dos pantallas a proposito. En el listado del administrador
 * significa "esa fila ya no esta"; en el enlace del invitado, "este enlace no sirve" — y las dos
 * salidas son la misma: recargar o pedir uno nuevo. Distinguirlos exigiria que el backend
 * distinguiera, y lo que hace es justamente lo contrario para no dejar enumerar invitaciones
 * ajenas.
 */
const MENSAJE_NO_ENCONTRADO =
  'Este enlace no sirve. Puede que ya lo hayas usado, que lo hayan cancelado, o que este mal ' +
  'copiado. Si esperabas una invitacion, pedile a quien te invito que te la reenvie.';

const MENSAJE_PENDIENTE_DUPLICADA =
  'Ya hay una invitacion pendiente para esa persona en ese alcance. Si el enlace vencio o no le ' +
  'llego, usa "Reenviar" en la fila que ya esta: emitir otra dejaria dos enlaces validos dando ' +
  'vueltas.';

/**
 * El enlace vencio.
 *
 * <p>Es el unico caso del modulo donde el backend NO responde 404, y el texto tiene que
 * aprovecharlo: la salida es concreta y barata —pedir un reenvio— y confundirla con "no existe"
 * manda al invitado a reportar que el sistema esta roto.
 */
const MENSAJE_VENCIDA =
  'Esta invitacion vencio. Pedile a quien te invito que te la reenvie: el enlace nuevo llega al ' +
  'mismo correo y la invitacion sigue siendo la misma.';

const MENSAJE_YA_RESUELTA =
  'Esta invitacion ya fue resuelta, seguramente por otra persona o desde otra pestaña. Recarga ' +
  'para ver como quedo.';

const MENSAJE_YA_VINCULADO =
  'Esa persona ya trabaja en esta organizacion. Si lo que queres es cambiarle el rol o la sede, ' +
  'hacelo desde el listado de colaboradores.';

/**
 * El tenant llego al tope de miembros de su plan.
 *
 * <p>Aparece <b>al aceptar</b> y no al invitar, y el texto lo dice: emitir invitaciones no
 * consume cupo, justamente para que un administrador no pueda dejarse sin lugar invitando a
 * gente que nunca responde. La contracara es esta.
 */
const MENSAJE_TOPE_DE_PLAN =
  'La organizacion llego al tope de miembros de su plan. Emitir invitaciones no consume lugares ' +
  '—los consume aceptarlas—, asi que puede haber mas invitaciones pendientes que lugares libres. ' +
  'Hay que liberar un lugar o cambiar de plan.';

const MENSAJE_SUSCRIPCION_SUSPENDIDA =
  'La suscripcion de la organizacion esta suspendida, asi que no se pueden registrar cambios. Se ' +
  'resuelve desde la pantalla de suscripcion.';

/** Traduce cualquier error de las pantallas de invitaciones. */
export function traducirErrorInvitacion(error: unknown): ErrorInvitacion {
  if (!(error instanceof AkineHttpError)) {
    return { mensaje: MENSAJE_GENERICO, causa: 'otro', segundosDeEspera: 0 };
  }

  if (error.esDeRed) {
    return { mensaje: MENSAJE_DE_RED, causa: 'red', segundosDeEspera: 0 };
  }

  if (error.esRateLimited) {
    const segundos = segundosDeEspera(error);
    return {
      mensaje:
        segundos > 0
          ? `Demasiados intentos. Espera ${segundos} segundos y volve a intentar.`
          : MENSAJE_LIMITE_SIN_PLAZO,
      causa: 'limite',
      segundosDeEspera: segundos,
    };
  }

  switch (error.problemType) {
    case 'missing-tenant-context':
      return { mensaje: MENSAJE_SIN_CONTEXTO, causa: 'sin-contexto', segundosDeEspera: 0 };
    case 'invitacion-pendiente-duplicada':
      return {
        mensaje: MENSAJE_PENDIENTE_DUPLICADA,
        causa: 'pendiente-duplicada',
        segundosDeEspera: 0,
      };
    case 'invitacion-vencida':
      return { mensaje: MENSAJE_VENCIDA, causa: 'vencida', segundosDeEspera: 0 };
    case 'invitacion-ya-resuelta':
      return { mensaje: MENSAJE_YA_RESUELTA, causa: 'ya-resuelta', segundosDeEspera: 0 };
    case 'colaborador-ya-vinculado':
      return { mensaje: MENSAJE_YA_VINCULADO, causa: 'ya-vinculado', segundosDeEspera: 0 };
    case 'plan-limit-exceeded':
      return { mensaje: MENSAJE_TOPE_DE_PLAN, causa: 'tope-de-plan', segundosDeEspera: 0 };
    case 'subscription-suspended':
      return {
        mensaje: MENSAJE_SUSCRIPCION_SUSPENDIDA,
        causa: 'suscripcion-suspendida',
        segundosDeEspera: 0,
      };
    default:
      break;
  }

  if (error.status === 403) {
    return { mensaje: MENSAJE_SIN_PERMISO, causa: 'sin-permiso', segundosDeEspera: 0 };
  }

  if (error.status === 404) {
    return { mensaje: MENSAJE_NO_ENCONTRADO, causa: 'no-encontrado', segundosDeEspera: 0 };
  }

  if (error.status === 400) {
    // El backend nombra el campo concreto; su texto es mas util que cualquier generico.
    return {
      mensaje: conDetalle(error, MENSAJE_GENERICO),
      causa: 'validacion',
      segundosDeEspera: 0,
    };
  }

  return { mensaje: conDetalle(error, MENSAJE_GENERICO), causa: 'otro', segundosDeEspera: 0 };
}

/**
 * `true` si el error se resuelve reenviando la invitacion que ya existe.
 *
 * <p>Los dos casos que lo cumplen tienen la misma salida y aparecen en pantallas distintas: el
 * administrador lo ve al intentar emitir una segunda, y el invitado al abrir un enlace vencido.
 */
export function seResuelveReenviando(causa: CausaInvitacion | null): boolean {
  return causa === 'pendiente-duplicada' || causa === 'vencida';
}

/** El mensaje del backend, o el de respaldo si el cuerpo no traia `ProblemDetail`. */
function conDetalle(error: AkineHttpError, respaldo: string): string {
  return error.problem === null ? respaldo : error.message;
}

/** Espera declarada por el backend en `Retry-After`, o `0` si no la mando. */
function segundosDeEspera(error: AkineHttpError): number {
  const segundos = error.reintentarEnSegundos;
  if (segundos === null || !Number.isFinite(segundos) || segundos <= 0) {
    return 0;
  }
  return Math.ceil(segundos);
}
