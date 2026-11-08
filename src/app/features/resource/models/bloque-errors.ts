import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { conflictoDelProblema, sedeDelConflicto } from '../../../core/models/conflicto-de-agenda';
import { formatearFecha } from '../../../shared/utils/instantes';
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
  /**
   * 409 franja-fuera-del-horario-de-sede (0.162.0): la franja se sale del horario general de la
   * sede. Trae {@link FranjaFueraDeSede} por cada dia que no entra.
   */
  | 'fuera-de-horario-sede'
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
  /** Solo en `fuera-de-horario-sede`: cada dia pedido que no entra. Vacia en cualquier otra causa. */
  readonly fueraDeHorario?: readonly FranjaFueraDeSede[];
}

/**
 * Un dia pedido que no entra en el horario de la sede (regla del 08/11/2026), con el horario de
 * la sede ese dia: es la referencia para corregir la franja. Vacio: la sede no abre ese dia.
 */
export interface FranjaFueraDeSede {
  readonly diaSemana: number;
  readonly horarioDeSede: readonly { readonly horaDesde: string; readonly horaHasta: string }[];
}

/**
 * El horario de la sede de los dias que no entran, con los dias del mismo horario juntos: "Lunes a
 * viernes la sede abre de 09:00 a 22:30. Sabado no abre." Un lote de seis dias da dos frases y no
 * seis.
 */
export function redactarHorarioDeSede(fuera: readonly FranjaFueraDeSede[]): string {
  const porHorario = new Map<string, number[]>();
  for (const franja of fuera) {
    const horario = enUnaFrase(franja.horarioDeSede);
    porHorario.set(horario, [...(porHorario.get(horario) ?? []), franja.diaSemana]);
  }
  return [...porHorario.entries()]
    .map(([horario, dias], indice) => {
      const quien = indice === 0 ? `${diasJuntos(dias)} la sede` : diasJuntos(dias);
      return `${quien} ${horario}.`;
    })
    .join(' ');
}

function enUnaFrase(horario: FranjaFueraDeSede['horarioDeSede']): string {
  if (horario.length === 0) {
    return 'no abre';
  }
  const tramos = horario.map((tramo) => `de ${rangoHorario(tramo.horaDesde, tramo.horaHasta)}`);
  return `abre ${tramos.length === 1 ? tramos[0] : `${tramos.slice(0, -1).join(', ')} y ${tramos.at(-1)}`}`;
}

/** "Lunes a viernes", "Martes y jueves", "Sabado": corridos consecutivos con "a". */
function diasJuntos(dias: readonly number[]): string {
  const ordenados = [...new Set(dias)].sort((a, b) => a - b);
  const tramos: string[] = [];
  for (let i = 0; i < ordenados.length;) {
    let fin = i;
    while (fin + 1 < ordenados.length && ordenados[fin + 1] === ordenados[fin] + 1) {
      fin++;
    }
    const desde = etiquetaDeDia(ordenados[i]).toLowerCase();
    tramos.push(
      fin - i >= 2
        ? `${desde} a ${etiquetaDeDia(ordenados[fin]).toLowerCase()}`
        : ordenados
            .slice(i, fin + 1)
            .map((dia) => etiquetaDeDia(dia).toLowerCase())
            .join(', '),
    );
    i = fin + 1;
  }
  const texto =
    tramos.length === 1 ? tramos[0] : `${tramos.slice(0, -1).join(', ')} y ${tramos.at(-1)}`;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function franjasFueraDe(error: AkineHttpError): FranjaFueraDeSede[] {
  const crudas = error.extension('franjasFueraDeHorario');
  if (!Array.isArray(crudas)) {
    return [];
  }
  return crudas.flatMap((cruda: unknown) => {
    if (typeof cruda !== 'object' || cruda === null) {
      return [];
    }
    const fila = cruda as { diaSemana?: unknown; horarioDeSede?: unknown };
    if (typeof fila.diaSemana !== 'number') {
      return [];
    }
    const horario = Array.isArray(fila.horarioDeSede) ? fila.horarioDeSede : [];
    return [
      {
        diaSemana: fila.diaSemana,
        horarioDeSede: horario.flatMap((tramo: unknown) => {
          const t = tramo as { horaDesde?: unknown; horaHasta?: unknown } | null;
          return typeof t?.horaDesde === 'string' && typeof t.horaHasta === 'string'
            ? [{ horaDesde: t.horaDesde, horaHasta: t.horaHasta }]
            : [];
        }),
      },
    ];
  });
}

const MENSAJE_GENERICO = 'No pudimos completar la operación. Volvé a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa tu conexion y volvé a intentar.';
const MENSAJE_LIMITE_SIN_PLAZO =
  'Demasiados intentos. Espera un momento antes de volver a intentar.';

const MENSAJE_SIN_CONTEXTO =
  'El horario de un profesional se carga en una sede concreta y todavía no elegiste ninguna. ' +
  'Eligi un consultorio para ver y editar su horario semanal.';

const MENSAJE_SIN_PERMISO =
  'No tenés permiso para administrar el horario de los profesionales de esta sede. Pediselo a ' +
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
  'Alguien mas modifico este bloque mientras lo estabas editando, así que no guardamos tus ' +
  'cambios para no pisar los suyos. Recarga el horario, revisa como quedo y volvé a intentar si ' +
  'seguis queriendo el cambio.';

/**
 * El profesional no atiende en esta sede.
 *
 * <p>El texto nombra la salida —el vinculo— porque el error se lee facilmente como "el
 * profesional no existe", que es otra cosa y se resuelve en otra pantalla.
 */
const MENSAJE_NO_VINCULADO =
  'Este profesional no tiene un vinculo vigente que lo habilite a atender en esta sede, así que ' +
  'no se le puede cargar horario acá. Revisalo en Colaboradores: puede estar acotado a otra ' +
  'sede, suspendido o vencido.';

const MENSAJE_SEDE_INACTIVA =
  'La sede esta dada de baja y no admite horarios nuevos. Los bloques que ya tenia se pueden ' +
  'editar y dar de baja, que es con lo que se ordena el horario de un centro que cierra.';

const MENSAJE_SUSCRIPCION_SUSPENDIDA =
  'La suscripción de la organización esta suspendida, así que no se pueden registrar cambios. ' +
  'Se resuelve desde la pantalla de suscripción.';

/**
 * Redacta el solapamiento nombrando <b>el otro bloque</b>, en una linea.
 *
 * <p>"Ya existe un horario para el martes de 09:00 a 13:00": dia y horas del bloque con el que se
 * choca, y la grilla marca esa fila. Corto a proposito (rediseño del 05/11/2026): el mensaje vive
 * pegado a los campos y no puede desarmar el formulario. Que contiguo no es solapado lo explica
 * la ayuda "?" del horario, no el error.
 */
function mensajeDeSolapamiento(conflicto: BloqueEnConflicto): string {
  if (conflicto.horaDesde === null || conflicto.horaHasta === null) {
    return 'Ya existe un horario que se pisa con el pedido.';
  }
  const dia =
    conflicto.diaSemana === null
      ? ''
      : ` para el ${etiquetaDeDia(conflicto.diaSemana).toLowerCase()}`;
  return `Ya existe un horario${dia} de ${rangoHorario(conflicto.horaDesde, conflicto.horaHasta)}.`;
}

/**
 * El bloque choca con la disponibilidad de la misma persona en otra sede (0.158.0): su horario
 * habitual o una apertura futura. Sin nombre de sede, el `detail` del servidor, que ya la redacta.
 */
function mensajeEntreSedes(error: AkineHttpError): string {
  const conflicto = conflictoDelProblema(error);
  const sede = sedeDelConflicto(conflicto, {});
  if (sede === '') {
    return conDetalle(error, 'Conflicto con actividad en otra sede.');
  }
  const que =
    conflicto.conflictoOrigen === 'APERTURA' ? 'una apertura de agenda' : 'horario de atención';
  const dia = error.numeroDeExtension('diaSemana');
  const nombreDelDia = dia === null ? '' : etiquetaDeDia(dia).toLowerCase();
  const cuando =
    conflicto.conflictoFecha !== undefined
      ? ` el ${formatearFecha(conflicto.conflictoFecha)}`
      : nombreDelDia === ''
        ? ''
        : ` los ${nombreDelDia}${nombreDelDia.endsWith('s') ? '' : 's'}`;
  const desde = conflicto.conflictoHoraDesde;
  const franja =
    desde === undefined ? '' : ` de ${rangoHorario(desde, conflicto.conflictoHoraHasta ?? '')}`;
  return `Conflicto con actividad en otra sede: ya tiene ${que} en ${sede}${cuando}${franja}.`;
}

function conflictoDe(error: AkineHttpError): BloqueEnConflicto {
  // Desde 0.158.0 `horaDesde`/`horaHasta` son las horas PEDIDAS y las del bloque que ya existe
  // viajan en `conflictoHoraDesde`/`conflictoHoraHasta`. El mensaje nombra al bloque existente:
  // "ya existe un horario de 09:00 a 13:00", no "de 10:00 a 12:00", que es lo que se pidio.
  const horaDesde = error.extension('conflictoHoraDesde') ?? error.extension('horaDesde');
  const horaHasta = error.extension('conflictoHoraHasta') ?? error.extension('horaHasta');

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
          ? `Demasiados intentos. Espera ${segundos} segundos y volvé a intentar.`
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
      // Desde 0.158.0 el choque puede ser con el horario o una apertura de la misma persona en OTRA
      // sede: se nombra la sede y la franja, y no se marca ninguna fila de esta grilla.
      if (error.extension('conflictoMismaSede') === false) {
        return { ...base(mensajeEntreSedes(error), 'solapado'), conflicto: null };
      }
      const conflicto = conflictoDe(error);
      return { ...base(mensajeDeSolapamiento(conflicto), 'solapado'), conflicto };
    }
    case 'franja-fuera-del-horario-de-sede': {
      // Regla del 08/11/2026: el horario del profesional queda dentro del de la sede. El mensaje
      // dice el horario de la sede de cada dia que no entra: es lo que hace falta para corregirla.
      const fuera = franjasFueraDe(error);
      const mensaje =
        fuera.length === 0
          ? conDetalle(error, 'El horario tiene que quedar dentro del horario de la sede.')
          : `Fuera del horario de la sede. ${redactarHorarioDeSede(fuera)}`;
      return { ...base(mensaje, 'fuera-de-horario-sede'), fueraDeHorario: fuera };
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
