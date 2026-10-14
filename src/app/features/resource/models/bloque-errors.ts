import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import {
  MensajeTraducido,
  conDetalle,
  mensajeTraducido,
  segundosDeEspera,
} from './errores-comunes';
import { etiquetaDeDia } from '../../../shared/utils/dias-de-la-semana';
import { rangoHorario } from '../../../shared/utils/horas-de-pared';

/**
 * Motivo por el que fallo una operacion sobre bloques de disponibilidad (M05, AKINE-02.04).
 *
 * <p>Mismo criterio que `espacio-errors.ts`: se ramifica por `problemType` y <b>nunca</b> por
 * el texto de `detail`, que es prosa para humanos y cambia cuando alguien corrige una
 * redaccion.
 *
 * <p><b>No se fusiona con `espacio-errors.ts` aunque vivan en la misma feature.</b> Los `409`
 * son otros —solapamiento, profesional no vinculado— y sobre todo el de solapamiento no
 * termina en un cartel: termina senalando <b>dos</b> filas de la grilla. Ese dato viaja en las
 * extensiones del Problem Details y no existe en el mundo de los espacios.
 *
 * <p><b>La version vieja de un bloque llega como `concurrent-modification` (DP-21).</b> Desde el
 * contrato 0.80.0 todos los modulos responden asi a la version desactualizada, y `conflict`
 * queda solo para conflictos de negocio. Ramificar por el codigo equivocado dejaria el conflicto
 * de concurrencia cayendo en la rama generica, que dice "no pudimos completar la operacion"
 * sobre el unico error donde hay que recargar antes de reintentar.
 */
export type CausaBloque =
  /** 403 missing-tenant-context: hay sesion, pero no hay sede elegida. NUNCA cerrar sesion. */
  | 'sin-contexto'
  /** 403 forbidden: falta `consultorio:manage` (mutar) o `colaborador:read` (leer). */
  | 'sin-permiso'
  /** 400 validation-error: horas mal formadas, ventana incoherente, motivo vacio. */
  | 'validacion'
  /** 404: el bloque no existe, es de otra sede, de otro profesional o de otro tenant. */
  | 'no-encontrado'
  /** 409 bloque-solapado: se pisa con otro bloque activo. Trae {@link BloqueEnConflicto}. */
  | 'solapado'
  /** 409 bloque-inactivo: esta dado de baja y no admite ediciones. */
  | 'bloque-inactivo'
  /** 409 bloque-already-inactive: la baja ya estaba hecha. Hay que recargar. */
  | 'ya-inactivo'
  /** 409 concurrent-modification: la `version` enviada quedo vieja. Recargar y decidir de nuevo. */
  | 'concurrencia'
  /** 409 profesional-no-vinculado: la membership no habilita a atender en ESTA sede. */
  | 'profesional-no-vinculado'
  /** 409 consultorio-inactive: la sede esta dada de baja y no origina hechos nuevos. */
  | 'sede-inactiva'
  /** 409 subscription-suspended: lo emite el filtro, antes del controller. */
  | 'suscripcion-suspendida'
  /** 429: hay que esperar. Ver `segundosDeEspera`. */
  | 'limite'
  /** El request nunca llego: sin red, CORS o servidor caido. */
  | 'red'
  | 'otro';

/**
 * El <b>otro</b> bloque del solapamiento, tal como lo publica el backend.
 *
 * <p>Es lo que convierte el `409` en algo accionable. Sin el id, el administrador lee
 * "conflicto" y tiene que recorrer la grilla comparando horas a ojo para descubrir cual de
 * sus bloques choca; con el, la pantalla puede senalar las dos filas que colisionan y el
 * cambio se hace en un movimiento.
 *
 * <p>Los campos son opcionales porque un Problem Details puede llegar sin extensiones: la
 * pantalla degrada a un mensaje sin senalamiento en vez de romperse.
 */
export interface BloqueEnConflicto {
  readonly id: number | null;
  readonly diaSemana: number | null;
  readonly horaDesde: string | null;
  readonly horaHasta: string | null;
}

/**
 * Error ya traducido a algo mostrable.
 *
 * <p><b>No lleva `maximoDias`, y no es un olvido.</b> Ninguna de las cuatro operaciones sobre
 * bloques recibe una ventana de fechas, asi que ninguna puede responder
 * `ventana-demasiado-amplia`: la rama que lo manejaba era inalcanzable y ademas <b>peor</b> que
 * la generica, porque devolvia el `detail` crudo del backend justo donde los otros dos
 * traductores redactan el tope en palabras. El tope se traduce donde el endpoint si tiene
 * ventana: `excepcion-errors.ts` y `horario-efectivo-errors.ts`.
 */
export interface ErrorBloque extends MensajeTraducido<CausaBloque> {
  /** Solo en `solapado`. `null` en cualquier otra causa. */
  readonly conflicto: BloqueEnConflicto | null;
}

const MENSAJE_GENERICO = 'No pudimos completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa tu conexion y volve a intentar.';
const MENSAJE_LIMITE_SIN_PLAZO =
  'Demasiados intentos. Espera un momento antes de volver a intentar.';

const MENSAJE_SIN_CONTEXTO =
  'El horario de un profesional se carga en una sede concreta y todavia no elegiste ninguna. ' +
  'Eligi un consultorio para ver y editar su horario semanal.';

const MENSAJE_SIN_PERMISO =
  'No tenes permiso para administrar el horario de los profesionales de esta sede. Pediselo a ' +
  'quien la administra.';

const MENSAJE_NO_ENCONTRADO =
  'Ese bloque ya no existe, o pertenece a otro profesional o a otra sede. Recarga el horario ' +
  'para ver el que hay ahora.';

const MENSAJE_BLOQUE_INACTIVO =
  'Este bloque esta dado de baja y por eso no se puede editar. La baja no se deshace: si el ' +
  'profesional vuelve a atender en esa franja, cargala como un bloque nuevo.';

const MENSAJE_YA_INACTIVO =
  'Este bloque ya estaba dado de baja, seguramente por otra persona. Recarga el horario para ' +
  'ver como quedo.';

const MENSAJE_CONCURRENCIA =
  'Alguien mas modifico este bloque mientras lo estabas editando, asi que no guardamos tus ' +
  'cambios para no pisar los suyos. Recarga el horario, revisa como quedo y volve a intentar si ' +
  'seguis queriendo el cambio.';

/**
 * El profesional no atiende en esta sede.
 *
 * <p>El texto nombra la salida —el vinculo— porque el error se lee facilmente como "el
 * profesional no existe", que es otra cosa y se resuelve en otra pantalla.
 */
const MENSAJE_NO_VINCULADO =
  'Este profesional no tiene un vinculo vigente que lo habilite a atender en esta sede, asi que ' +
  'no se le puede cargar horario aca. Revisalo en Colaboradores: puede estar acotado a otra ' +
  'sede, suspendido o vencido.';

const MENSAJE_SEDE_INACTIVA =
  'La sede esta dada de baja y no admite horarios nuevos. Los bloques que ya tenia se pueden ' +
  'editar y dar de baja, que es con lo que se ordena el horario de un centro que cierra.';

const MENSAJE_SUSCRIPCION_SUSPENDIDA =
  'La suscripcion de la organizacion esta suspendida, asi que no se pueden registrar cambios. ' +
  'Se resuelve desde la pantalla de suscripcion.';

/**
 * Redacta el solapamiento nombrando <b>el otro bloque</b>.
 *
 * <p>El mensaje dice el dia y las horas del bloque con el que se choca; la grilla, ademas,
 * marca esa fila. Las dos cosas juntas: el cartel se lee donde esta el foco despues del
 * envio, y la marca resuelve cual de dos bloques parecidos es.
 *
 * <p><b>Aclara que ser contiguo no es solapar</b> porque es la confusion inmediata de quien
 * acaba de cargar la tarde despues de la manana: la hora de fin es exclusiva, y 09:00-12:00
 * con 12:00-15:00 conviven sin conflicto. Sin la aclaracion, el usuario "corrige" un horario
 * que estaba bien.
 */
function mensajeDeSolapamiento(conflicto: BloqueEnConflicto): string {
  if (conflicto.horaDesde === null || conflicto.horaHasta === null) {
    return (
      'El horario que pediste se pisa con otro bloque activo de este profesional en esta sede. ' +
      'Ojo: dos bloques que se tocan en un extremo NO se pisan, porque la hora de fin es ' +
      'exclusiva.'
    );
  }

  const dia =
    conflicto.diaSemana === null ? '' : ` del ${etiquetaDeDia(conflicto.diaSemana).toLowerCase()}`;

  return (
    `El horario que pediste se pisa con el bloque${dia} de ` +
    `${rangoHorario(conflicto.horaDesde, conflicto.horaHasta)}, que quedo marcado en la grilla. ` +
    'Corregi uno de los dos. Ojo: dos bloques que se tocan en un extremo NO se pisan, porque la ' +
    'hora de fin es exclusiva: la manana de 09:00 a 12:00 y la tarde de 12:00 a 15:00 conviven.'
  );
}

function conflictoDe(error: AkineHttpError): BloqueEnConflicto {
  const horaDesde = error.extension('horaDesde');
  const horaHasta = error.extension('horaHasta');

  return {
    id: error.numeroDeExtension('bloqueEnConflictoId'),
    diaSemana: error.numeroDeExtension('diaSemana'),
    horaDesde: typeof horaDesde === 'string' ? horaDesde : null,
    horaHasta: typeof horaHasta === 'string' ? horaHasta : null,
  };
}

/** Traduce cualquier error de las pantallas de horarios de profesional. */
export function traducirErrorBloque(error: unknown): ErrorBloque {
  if (!(error instanceof AkineHttpError)) {
    return base(MENSAJE_GENERICO, 'otro');
  }

  if (error.esDeRed) {
    return base(MENSAJE_DE_RED, 'red');
  }

  if (error.esRateLimited) {
    const segundos = segundosDeEspera(error);
    return {
      ...base(
        segundos > 0
          ? `Demasiados intentos. Espera ${segundos} segundos y volve a intentar.`
          : MENSAJE_LIMITE_SIN_PLAZO,
        'limite',
      ),
      segundosDeEspera: segundos,
    };
  }

  switch (error.problemType) {
    case 'missing-tenant-context':
      return base(MENSAJE_SIN_CONTEXTO, 'sin-contexto');
    case 'bloque-solapado': {
      const conflicto = conflictoDe(error);
      return { ...base(mensajeDeSolapamiento(conflicto), 'solapado'), conflicto };
    }
    case 'bloque-inactivo':
      return base(MENSAJE_BLOQUE_INACTIVO, 'bloque-inactivo');
    case 'bloque-already-inactive':
      return base(MENSAJE_YA_INACTIVO, 'ya-inactivo');
    case 'concurrent-modification':
      return base(MENSAJE_CONCURRENCIA, 'concurrencia');
    case 'profesional-no-vinculado':
      return base(MENSAJE_NO_VINCULADO, 'profesional-no-vinculado');
    case 'consultorio-inactive':
      return base(MENSAJE_SEDE_INACTIVA, 'sede-inactiva');
    case 'subscription-suspended':
      return base(MENSAJE_SUSCRIPCION_SUSPENDIDA, 'suscripcion-suspendida');
    default:
      break;
  }

  if (error.status === 403) {
    return base(MENSAJE_SIN_PERMISO, 'sin-permiso');
  }

  if (error.status === 404) {
    // Inexistente, de otro profesional, de otra sede y de otro tenant responden los cuatro
    // igual: distinguirlos permitiria reconstruir el horario de cualquiera probando ids.
    return base(MENSAJE_NO_ENCONTRADO, 'no-encontrado');
  }

  if (error.status === 400) {
    // El backend nombra el campo concreto; su texto es mas util que cualquier generico.
    return base(conDetalle(error, MENSAJE_GENERICO), 'validacion');
  }

  return base(conDetalle(error, MENSAJE_GENERICO), 'otro');
}

function base(mensaje: string, causa: CausaBloque): ErrorBloque {
  return { ...mensajeTraducido(mensaje, causa), conflicto: null };
}
