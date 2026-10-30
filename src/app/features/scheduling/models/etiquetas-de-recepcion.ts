import {
  PrepagoDeRecepcion,
  PrepagoDeRecepcionEstadoEnum,
} from '../../../api/generated/model/prepago-de-recepcion';
import { EventoDeRecepcionTipoEnum } from '../../../api/generated/model/evento-de-recepcion';
import {
  Recepcion,
  RecepcionEstadoEnum,
  RecepcionModalidadEnum,
} from '../../../api/generated/model/recepcion';

/**
 * Textos y lecturas de la Recepcion con maquina propia (M13, AKINE E-4, DP-16).
 *
 * <p>Vive en `features/` por la misma razon que `etiquetas-de-turno`: sabe que es una llegada, una
 * validacion y una espera, y por que ninguna de las tres es una atencion (AGENT.md 4.1).
 *
 * <p><b>Ningun texto de aca dice que el paciente fue atendido.</b> `LLAMADA` significa que alguien
 * lo llamo desde la sala, no que la Sesion exista: son dos actos de dos personas (DP-05). La
 * prestacion la registra la Sesion, que es otra pantalla y otra maquina.
 */
const TEXTOS_DE_RECEPCION: Readonly<Record<RecepcionEstadoEnum, string>> = {
  [RecepcionEstadoEnum.LLEGO]: 'Llegó — falta validar cómo se atiende',
  [RecepcionEstadoEnum.VALIDADA]: 'Validada — ya se sabe cómo se atiende',
  [RecepcionEstadoEnum.OBSERVADA]:
    'Observada — la validación encontró algo; advierte, no impide pasar a espera',
  [RecepcionEstadoEnum.EN_ESPERA]: 'En espera — llegó y aguarda ser llamado',
  [RecepcionEstadoEnum.LLAMADA]:
    'Llamada — lo llamaron desde la sala; la atención es otro registro',
  [RecepcionEstadoEnum.ANULADA]: 'Anulada — el check-in fue un error y la llegada no vale',
  [RecepcionEstadoEnum.CERRADA]: 'Cerrada — el turno se canceló con la persona presente',
  [RecepcionEstadoEnum.RETIRADO]:
    'Se retiró — se fue sin ser atendido; la llegada consta y el turno ya no admite otro check-in',
};

/** Lo que significa el estado de la recepcion, sin el nombre; vacio si no hay explicacion. */
export function detalleDeEstadoDeRecepcion(estado: string | undefined): string {
  const detalle = textoDeRecepcion(estado).split(' — ')[1] ?? '';
  return detalle.charAt(0).toUpperCase() + detalle.slice(1);
}

const TEXTOS_DE_EVENTO: Readonly<Record<EventoDeRecepcionTipoEnum, string>> = {
  [EventoDeRecepcionTipoEnum.LLEGADA]: 'Llegada registrada',
  [EventoDeRecepcionTipoEnum.VALIDACION]: 'Cobertura validada',
  [EventoDeRecepcionTipoEnum.PARTICULAR]: 'Se atiende como Particular',
  [EventoDeRecepcionTipoEnum.ESPERA]: 'Paso a la sala de espera',
  [EventoDeRecepcionTipoEnum.LLAMADO]: 'Llamado desde la sala',
  [EventoDeRecepcionTipoEnum.ANULACION]: 'Llegada anulada',
  [EventoDeRecepcionTipoEnum.CIERRE_POR_CANCELACION]: 'Cerrada porque el turno se cancelo',
  [EventoDeRecepcionTipoEnum.RETIRO]: 'Se retiro sin ser atendido',
};

/** Texto de un evento del historial de la recepcion, o el codigo crudo si es uno nuevo. */
export function textoDeEventoDeRecepcion(tipo: string | undefined): string {
  if (tipo === undefined || tipo === '') {
    return 'Evento desconocido';
  }
  return TEXTOS_DE_EVENTO[tipo as EventoDeRecepcionTipoEnum] ?? tipo;
}

/** Solo el nombre del estado, sin la explicacion: para el historial, donde va "antes → despues". */
export function nombreDeEstadoDeRecepcion(estado: string | undefined): string {
  return textoDeRecepcion(estado).split(' — ')[0];
}

/** Estados en los que la recepcion ya no admite ninguna transicion. */
const CERRADOS: ReadonlySet<string> = new Set<string>([
  RecepcionEstadoEnum.ANULADA,
  RecepcionEstadoEnum.CERRADA,
  RecepcionEstadoEnum.RETIRADO,
]);

/** Texto del estado, o el codigo crudo si el contrato sumo uno que este cliente no conoce. */
export function textoDeRecepcion(estado: string | undefined): string {
  if (estado === undefined || estado === '') {
    return 'Estado desconocido';
  }
  return TEXTOS_DE_RECEPCION[estado as RecepcionEstadoEnum] ?? estado;
}

/** `Con cobertura` / `Particular`, o vacio mientras no se resolvio. */
export function textoDeModalidad(modalidad: string | undefined): string {
  switch (modalidad) {
    case 'COBERTURA':
      return 'Con cobertura';
    case 'PARTICULAR':
      return 'Particular';
    default:
      return '';
  }
}

/**
 * `true` cuando hay una recepcion que todavia admite transiciones.
 *
 * <p>Una `ANULADA` no cuenta: la llegada no valia y el turno admite un check-in nuevo. Una
 * `CERRADA` tampoco: el turno se cancelo. Una `RETIRADO` tampoco admite transiciones, pero
 * <b>sigue siendo la vigente</b>: ver {@link recepcionRetirada}.
 */
export function recepcionAbierta(recepcion: Recepcion | undefined): boolean {
  return recepcion?.estado !== undefined && !CERRADOS.has(recepcion.estado);
}

/**
 * `true` cuando la persona se retiro sin ser atendida (U-21). <b>La llegada vale</b>: a diferencia
 * de `ANULADA`, la recepcion sigue siendo la vigente del turno, asi que el turno ya no admite un
 * check-in nuevo, ni marcarlo ausente (seria falso), ni reprogramarlo. El backend responde 409 a
 * las tres; la pantalla no las ofrece.
 */
export function recepcionRetirada(recepcion: Recepcion | undefined): boolean {
  return recepcion?.estado === RecepcionEstadoEnum.RETIRADO;
}

/**
 * `true` cuando consta una llegada que vale: la recepcion esta abierta o la persona se retiro sin
 * ser atendida (U-21). Una `ANULADA` o una `CERRADA` no cuentan. Es lo que decide si el turno
 * admite otro check-in y si el prepago se lee "antes de la llegada".
 */
export function llegadaVigente(recepcion: Recepcion | undefined): boolean {
  return recepcionAbierta(recepcion) || recepcionRetirada(recepcion);
}

/**
 * `true` cuando la recepcion admite "Atender como Particular" (RF-M13-005, U-21): desde `LLEGO` u
 * `OBSERVADA`, y desde `EN_ESPERA` salvo que ya se atienda como Particular (repetirla pisaria el
 * motivo que consta: 409).
 */
export function admiteParticular(recepcion: Recepcion | undefined): boolean {
  switch (recepcion?.estado) {
    case RecepcionEstadoEnum.LLEGO:
    case RecepcionEstadoEnum.OBSERVADA:
      return true;
    case RecepcionEstadoEnum.EN_ESPERA:
      return recepcion.modalidad !== RecepcionModalidadEnum.PARTICULAR;
    default:
      return false;
  }
}

/** `true` cuando se puede registrar que la persona se retiro: solo desde `LLEGO` o `EN_ESPERA`. */
export function admiteRetiro(recepcion: Recepcion | undefined): boolean {
  return (
    recepcion?.estado === RecepcionEstadoEnum.LLEGO ||
    recepcion?.estado === RecepcionEstadoEnum.EN_ESPERA
  );
}

/**
 * En que punto del turno se lee el prepago. Cambia lo que el texto puede afirmar, no el estado.
 *
 * <ul>
 *   <li>`antesDelCheckin`: no hay recepcion vigente. Un `PENDIENTE` vale <b>"si se atiende como
 *       particular"</b>: la cobertura la resuelve la validacion de la llegada, y si cubre, el
 *       prepago deja de exigirse (E-8).</li>
 *   <li>`turnoCaido`: el turno se cancelo o quedo ausente. El servidor solo devuelve `REGISTRADO`
 *       en ese caso, y lo que dice es que hay un anticipo cobrado para una atencion que no va a
 *       ocurrir.</li>
 * </ul>
 */
export interface ContextoDePrepago {
  readonly antesDelCheckin?: boolean;
  readonly turnoCaido?: boolean;
}

/**
 * Lo que la fila dice del prepago (E-6 y E-8, DP-06 / ADR-0013), o vacio cuando no hay nada que
 * decir.
 *
 * <p>`PENDIENTE` es una <b>alerta</b>: el centro exige un anticipo para esta oferta y todavia no se
 * cobro. Nunca impide pasar a espera, llamar ni atender. El importe que acompana es el precio
 * particular <b>sugerido</b>; lo decide quien cobra. `NO_EXIGIDO` no se rotula: seria ruido en
 * cada fila de un centro que no usa la politica.
 */
export function textoDePrepago(
  prepago: PrepagoDeRecepcion | undefined,
  contexto: ContextoDePrepago = {},
): string {
  switch (prepago?.estado) {
    case PrepagoDeRecepcionEstadoEnum.PENDIENTE: {
      const sugerido = importeDePrepago(prepago.importeSugerido, prepago.moneda);
      const conSugerido = sugerido === '' ? '' : ` (sugerido ${sugerido})`;
      return contexto.antesDelCheckin
        ? `Prepago pendiente si se atiende como particular${conSugerido}: esta prestación exige ` +
            'un anticipo y no se registro. Si la cobertura la cubre, se resuelve al validar la ' +
            'llegada. Es un aviso, no impide atender.'
        : `Prepago pendiente${conSugerido}: esta prestación exige un anticipo y no se registro. ` +
            'Es un aviso, no impide atender.';
    }
    case PrepagoDeRecepcionEstadoEnum.REGISTRADO: {
      const importe = importeDePrepago(prepago.importe, prepago.moneda);
      if (contexto.turnoCaido) {
        return (
          `Prepago registrado${importe === '' ? '' : ` por ${importe}`} para un turno que no se ` +
          'va a atender: el anticipo queda a favor del paciente, para reintegrarlo o usarlo en ' +
          'otra atención.'
        );
      }
      return importe === ''
        ? 'Prepago registrado. Se imputa solo al cerrar la sesión.'
        : `Prepago registrado por ${importe}. Se imputa solo al cerrar la sesión; lo que sobre ` +
            'queda a favor del paciente.';
    }
    default:
      return '';
  }
}

/**
 * Importe con su moneda, o vacio si no vino.
 *
 * <p>Se formatea aca y no con el helper de `billing`: un feature no importa de otro (AGENT.md 4.4).
 * Con una moneda que `Intl` no conoce se muestra el codigo al lado del numero, nunca un simbolo que
 * podria estar mintiendo.
 */
export function importeDePrepago(valor: number | undefined, moneda: string | undefined): string {
  if (valor === undefined || !Number.isFinite(valor)) {
    return '';
  }
  if (moneda !== undefined && moneda !== '') {
    try {
      return new Intl.NumberFormat('es-AR', { style: 'currency', currency: moneda }).format(valor);
    } catch {
      return `${valor.toFixed(2)} ${moneda}`;
    }
  }
  return valor.toFixed(2);
}
