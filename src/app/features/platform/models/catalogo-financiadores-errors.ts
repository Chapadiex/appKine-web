import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Por que fallo una operacion sobre el catalogo global de financiadores (DP-43, U-12).
 *
 * <p>El backend reusa los `problemType` del financiador y del plan del centro: el catalogo es la
 * misma entidad sin tenant. Se ramifica por `problemType`, nunca por el texto de `detail`.
 */
export type CausaCatalogo =
  | 'version-vieja'
  | 'codigo-repetido'
  | 'nombre-repetido'
  | 'cuit-repetido'
  | 'inactivo'
  | 'ya-dado-de-baja'
  | 'no-encontrado'
  | 'sin-permiso'
  | 'validacion'
  | 'red'
  | 'limite'
  | 'otro';

export interface ErrorCatalogo {
  readonly causa: CausaCatalogo;
  readonly mensaje: string;
}

const MENSAJES: Readonly<Record<CausaCatalogo, string>> = {
  'version-vieja':
    'Otro cambio llego a esta entrada después de que la leiste. No se aplico nada: volvimos a ' +
    'leer el catalogo, revisa como quedo y repeti el cambio si sigue haciendo falta.',
  'codigo-repetido':
    'Ese código ya lo usa otra entrada vigente. El código es unico y no se cambia después.',
  'nombre-repetido': 'Ese nombre ya lo usa otra entrada vigente.',
  'cuit-repetido': 'Ese CUIT ya lo tiene otra entrada vigente del catalogo.',
  inactivo: 'La entrada esta dada de baja y no admite planes nuevos.',
  'ya-dado-de-baja': 'Ya estaba dado de baja. No hubo que hacer nada.',
  'no-encontrado': 'Esa entrada ya no existe en el catalogo. Volvimos a leer la lista.',
  'sin-permiso': 'Tu cuenta ya no administra la plataforma, así que no puede tocar el catalogo.',
  validacion: 'El servidor rechazo el pedido. Revisa los campos.',
  red: 'No se pudo contactar al servidor. Revisa tu conexion y volvé a intentar.',
  limite: 'Demasiados intentos. Espera un momento antes de volver a intentar.',
  otro: 'No pudimos completar la operación. Volvé a intentar en un momento.',
};

export function traducirErrorCatalogo(error: unknown): ErrorCatalogo {
  const causa = causaDe(error);
  const detalle =
    causa === 'validacion' && error instanceof AkineHttpError ? error.detalle : undefined;
  return { causa, mensaje: detalle ?? MENSAJES[causa] };
}

/** Las causas que dejan la lista vieja: hay que releerla. */
export function releeElCatalogo(causa: CausaCatalogo): boolean {
  return causa === 'version-vieja' || causa === 'no-encontrado' || causa === 'ya-dado-de-baja';
}

function causaDe(error: unknown): CausaCatalogo {
  if (!(error instanceof AkineHttpError)) return 'otro';
  if (error.esDeRed) return 'red';
  if (error.esRateLimited) return 'limite';
  switch (error.problemType) {
    case 'concurrent-modification':
      return 'version-vieja';
    case 'financiador-codigo-taken':
    case 'plan-cobertura-codigo-taken':
      return 'codigo-repetido';
    case 'financiador-nombre-taken':
    case 'plan-cobertura-nombre-taken':
      return 'nombre-repetido';
    case 'financiador-cuit-taken':
      return 'cuit-repetido';
    case 'financiador-inactivo':
    case 'plan-cobertura-inactivo':
      return 'inactivo';
    case 'financiador-already-inactive':
    case 'plan-cobertura-already-inactive':
      return 'ya-dado-de-baja';
    case 'not-found':
      return 'no-encontrado';
    case 'forbidden':
      return 'sin-permiso';
    case 'validation-error':
      return 'validacion';
  }
  if (error.status === 404) return 'no-encontrado';
  if (error.status === 403) return 'sin-permiso';
  return 'otro';
}
