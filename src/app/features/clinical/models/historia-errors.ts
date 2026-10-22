import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Por que fallo un pedido de la Historia Clinica (D-a).
 *
 * <p>Cada causa lleva a una accion distinta, y por eso no se colapsan en un "error" generico:
 * `requiere-justificacion` pide un motivo, `sin-permiso` no tiene salida desde aca, `sin-historia`
 * ofrece abrirla, `version-vieja` pide releer antes de enmendar.
 */
export type CausaHistoria =
  | 'requiere-justificacion'
  | 'sin-permiso'
  | 'sin-contexto'
  | 'sin-historia'
  | 'no-encontrado'
  | 'version-vieja'
  | 'cursor-invalido'
  | 'archivo-no-aceptado'
  | 'adjunto-no-disponible'
  | 'validacion'
  | 'limite'
  | 'red'
  | 'otro';

export interface ErrorHistoria {
  readonly causa: CausaHistoria;
  readonly mensaje: string;
}

const MENSAJES: Readonly<Record<CausaHistoria, string>> = {
  'requiere-justificacion':
    'No figura que atiendas a esta persona en esta sede, así que para ver su historia clínica ' +
    'tenés que declarar el motivo. El acceso queda registrado con ese motivo.',
  'sin-permiso':
    'No tenés permiso para ver historias clínicas en esta sede. Pediselo a quien administra el centro.',
  'sin-contexto':
    'Para ver una historia clínica hay que saber en que sede estas. Eligi una organización y un ' +
    'consultorio, y volvé a entrar.',
  'sin-historia': 'Esta persona todavía no tiene historia clínica en la organización.',
  'no-encontrado':
    'Eso no existe o no es de esta organización. Volvé a cargar la historia para ver el estado actual.',
  'version-vieja':
    'Alguien enmendo esta entrada después de que la abriste. No pisamos su correccion ni perdimos ' +
    'la tuya: relee la entrada y volvé a enmendar sobre la versión nueva.',
  'cursor-invalido':
    'No se pudo seguir paginando el timeline. Lo volvimos a cargar desde el principio.',
  'archivo-no-aceptado':
    'El archivo no se acepto: el tipo o el tamano no estan permitidos para un adjunto clínico.',
  'adjunto-no-disponible':
    'El archivo no esta disponible en el almacenamiento, aunque su registro existe. Avisale a ' +
    'quien administra el sistema: no es algo que se resuelva reintentando.',
  validacion: 'El servidor rechazo un dato. Revisa lo que escribiste.',
  limite: 'Demasiados pedidos seguidos. Espera un momento y volvé a intentar.',
  red: 'No se pudo contactar al servidor. Revisa la conexion y volvé a intentar.',
  otro: 'No pudimos completar la operación. Volvé a intentar en un momento.',
};

/**
 * Traduce un error HTTP a la causa de esta pantalla.
 *
 * <p>El 404 de la historia es "no tiene historia" y no "no existe": el backend los hace
 * indistinguibles a proposito (cross-tenant es 404), y la pantalla ofrece abrirla. Quien la abra
 * en el tenant equivocado recibe el 404 de la persona, que se informa como `no-encontrado`.
 */
export function traducirErrorHistoria(
  error: unknown,
  contexto: 'historia' | 'otro' = 'otro',
): ErrorHistoria {
  const causa = causaDe(error, contexto);
  const detalle =
    causa === 'validacion' && error instanceof AkineHttpError ? error.problem?.detail : undefined;
  return { causa, mensaje: detalle ?? MENSAJES[causa] };
}

/** El error de una causa conocida sin pasar por HTTP, con su mensaje de siempre. */
export function errorDeCausa(causa: CausaHistoria): ErrorHistoria {
  return { causa, mensaje: MENSAJES[causa] };
}

/**
 * El 403 de DP-03: hay permiso, pero falta relacion asistencial y el backend pide motivo. Exportado
 * para que casos, plan y la entrada desde el 360 lo reconozcan igual, sin copiar la condicion.
 *
 * <p>Desde el contrato 0.107.0 (`appKine-api` #132) el caso tiene tipo propio,
 * `justificacion-de-acceso-requerida`. Hasta 0.106 viajaba como `forbidden` con la extension
 * `requiereJustificacion: true`, que el backend sigue mandando: se aceptan las dos senales para no
 * depender del orden en que se despliegan los dos repos.
 */
export function requiereJustificacion(error: unknown): boolean {
  return (
    error instanceof AkineHttpError &&
    error.status === 403 &&
    (error.problemType === 'justificacion-de-acceso-requerida' ||
      error.extension('requiereJustificacion') === true)
  );
}

function causaDe(error: unknown, contexto: 'historia' | 'otro'): CausaHistoria {
  if (!(error instanceof AkineHttpError)) {
    return 'otro';
  }
  if (error.esDeRed) {
    return 'red';
  }
  if (error.esRateLimited) {
    return 'limite';
  }
  if (requiereJustificacion(error)) {
    return 'requiere-justificacion';
  }

  switch (error.problemType) {
    case 'missing-tenant-context':
      return 'sin-contexto';
    case 'forbidden':
      return 'sin-permiso';
    case 'not-found':
      return contexto === 'historia' ? 'sin-historia' : 'no-encontrado';
    case 'entrada-clinica-no-accesible':
    case 'entrada-clinica-inactiva':
    case 'adjunto-clinico-no-accesible':
    case 'adjunto-clinico-inactivo':
      return 'no-encontrado';
    case 'concurrent-modification':
    case 'conflict':
      return 'version-vieja';
    case 'cursor-invalido':
      return 'cursor-invalido';
    case 'archivo-no-aceptado':
      return 'archivo-no-aceptado';
    case 'adjunto-clinico-no-disponible':
      return 'adjunto-no-disponible';
    case 'validation-error':
      return 'validacion';
    default:
      return error.status === 403 ? 'sin-permiso' : 'otro';
  }
}
