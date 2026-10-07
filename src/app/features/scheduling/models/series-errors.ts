import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { CausaAgenda, ErrorAgenda, traducirErrorAgenda } from './agenda-errors';
import { fechaHoraEnZona } from './etiquetas-de-turno';

/**
 * Errores de las series de turnos (M12, AKINE E-3).
 *
 * <p><b>El backend no publico tipos nuevos para las series</b>, y es deliberado: una ocurrencia sin
 * lugar responde con el tipo de la causa —`slot-no-disponible`, `slot-completo`,
 * `recurso-ocupado`, `oferta-no-agendable`— y agrega la extension <b>`ocurrenciaInicio`</b>, el
 * instante UTC de la ocurrencia que no entro. Por eso este traductor delega en
 * {@link traducirErrorAgenda} y cambia lo que en una serie significa otra cosa:
 *
 * <ul>
 *   <li><b>Con `ocurrenciaInicio`</b>, el mensaje dice que <b>no se reservo ninguno</b> y nombra la
 *       fecha. "Tomar el siguiente horario" no aplica a una serie: lo que se corrige es la
 *       regla.</li>
 *   <li><b>El `conflict` generico</b> en la cancelacion es la cantidad confirmada que ya no
 *       coincide: alguien movio, cancelo o atendio un turno entre la previsualizacion y el click.
 *       Se resuelve volviendo a previsualizar.</li>
 *   <li><b>`turno-transicion-no-permitida`</b> en la cancelacion es "no queda ningun turno
 *       pendiente en el alcance".</li>
 * </ul>
 */
export type AccionSerie =
  /** Volver a previsualizar las ocurrencias de la regla y corregirla. */
  | 'revisar-ocurrencias'
  /** Volver a pedir la previsualizacion del alcance: lo confirmado quedo viejo. */
  | 'releer-alcance'
  | 'activar-perfil'
  | 'reintentar-con-clave-nueva'
  | 'elegir-contexto'
  | 'ninguna';

export interface ErrorSerie {
  readonly mensaje: string;
  readonly causa: CausaAgenda;
  readonly accion: AccionSerie;
  /** Instante UTC de la ocurrencia que no entro. Vacio si el error no nombra ninguna. */
  readonly ocurrenciaInicio: string;
  /** Lo que el servidor agrego en `motivo`, si algo. */
  readonly motivo: string;
}

const MENSAJE_CANTIDAD_CAMBIO =
  'La serie cambio desde que se previsualizo: la cantidad de turnos afectados ya no es la que ' +
  'confirmaste. No se cancelo nada. Volve a previsualizar y confirma de nuevo.';

const MENSAJE_NADA_PENDIENTE =
  'No queda ningun turno pendiente en ese alcance: los que hay ya pasaron, ya estan cancelados o ' +
  'tienen una atencion. No se cancelo nada.';

const MENSAJE_SIN_LUGAR_SIN_FECHA =
  'Una de las fechas de la serie no tiene lugar, asi que no se reservo ningun turno: la serie ' +
  'entra entera o no entra. Revisa las ocurrencias y cambia el dia, la hora o la fecha de inicio.';

/** Traduce un error de alta o cancelacion de serie. `timezone` es la de la sede, para la fecha. */
export function traducirErrorSerie(error: unknown, timezone = ''): ErrorSerie {
  const base = traducirErrorAgenda(error);
  const ocurrenciaInicio = extensionDeTexto(error, 'ocurrenciaInicio');

  if (ocurrenciaInicio !== '' || esSinLugar(base.causa)) {
    return {
      ...resumen(base, 'revisar-ocurrencias'),
      ocurrenciaInicio,
      mensaje:
        ocurrenciaInicio === ''
          ? MENSAJE_SIN_LUGAR_SIN_FECHA
          : `No se reservo ningun turno: la serie entra entera o no entra. El turno del ` +
            `${fechaHoraEnZona(ocurrenciaInicio, timezone)} ${causaDeOcurrencia(base)}. Cambia ` +
            'el dia, la hora o la fecha de inicio y volve a previsualizar.',
    };
  }

  switch (base.causa) {
    case 'conflicto':
      return { ...resumen(base, 'releer-alcance'), mensaje: MENSAJE_CANTIDAD_CAMBIO };
    case 'turno-transicion-no-permitida':
      return { ...resumen(base, 'releer-alcance'), mensaje: MENSAJE_NADA_PENDIENTE };
    case 'persona-sin-perfil-paciente':
      return resumen(base, 'activar-perfil');
    case 'clave-reusada':
      return resumen(base, 'reintentar-con-clave-nueva');
    case 'sin-contexto':
      return resumen(base, 'elegir-contexto');
    default:
      return resumen(base, 'ninguna');
  }
}

function esSinLugar(causa: CausaAgenda): boolean {
  return causa === 'slot-no-disponible' || causa === 'slot-completo' || causa === 'recurso-ocupado';
}

function causaDeOcurrencia(base: ErrorAgenda): string {
  switch (base.causa) {
    case 'slot-no-disponible':
      return 'no tiene un horario disponible en la agenda';
    case 'slot-completo':
      return 'ya no tiene cupo';
    case 'recurso-ocupado':
      return base.recurso === ''
        ? 'choca con otro turno'
        : `choca con otro turno del ${base.recurso}`;
    case 'oferta-no-agendable':
      return 'cae en un dia en que la oferta no se puede agendar';
    default:
      return 'no tiene lugar';
  }
}

function resumen(base: ErrorAgenda, accion: AccionSerie): ErrorSerie {
  return {
    mensaje: base.mensaje,
    causa: base.causa,
    accion,
    ocurrenciaInicio: '',
    motivo: base.motivo,
  };
}

function extensionDeTexto(error: unknown, clave: string): string {
  if (!(error instanceof AkineHttpError)) {
    return '';
  }
  const valor = error.extension(clave);
  return typeof valor === 'string' ? valor : '';
}
