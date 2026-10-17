import { ErrorAtencionGrupal, traducirErrorAtencionGrupal } from './atencion-grupal-errors';

/**
 * Lo propio de DERIVAR a un participante (AKINE-08.04) sobre la traduccion del panel grupal.
 *
 * <p>Los `problemType` son los mismos que traduce {@link traducirErrorAtencionGrupal}; cambian dos
 * textos que alli hablan de otra operacion:
 *
 * <ul>
 *   <li><b>403 sin permiso</b>: derivar pide `inscripcion:read` en la sede y `hc:write` (y
 *       `paciente:manage` si se activa el perfil), no `sesion:register`.</li>
 *   <li><b>400 `validation-error`</b>: en el panel es la reversion sin motivo; aca el motivo es
 *       opcional, asi que un 400 es un dato que el servidor no acepto.</li>
 * </ul>
 */
export function traducirErrorDeDerivacion(error: unknown): ErrorAtencionGrupal {
  const traducido = traducirErrorAtencionGrupal(error);
  switch (traducido.causa) {
    case 'sin-permiso':
      return { ...traducido, mensaje: MENSAJE_SIN_PERMISO };
    case 'motivo-obligatorio':
      return { causa: 'otro', mensaje: MENSAJE_DATOS_INVALIDOS };
    case 'sin-perfil-paciente':
      return { ...traducido, mensaje: MENSAJE_SIN_PERFIL };
    default:
      return traducido;
  }
}

/** Texto de cada bloqueo de la elegibilidad. Un codigo nuevo se muestra tal cual, nunca se oculta. */
export function textoDeBloqueo(motivo: string): string {
  return BLOQUEOS[motivo] ?? motivo;
}

const BLOQUEOS: Readonly<Record<string, string>> = {
  OFERTA_NO_CLINICA:
    'La oferta de esta clase no genera registro clinico: sus participantes no se derivan.',
  SIN_ASISTENCIA: 'No tiene asistencia registrada en esta clase: primero se toma lista.',
  AUSENTE:
    'Figura ausente. Solo se deriva a quien estuvo: si fue un error de la lista, corregi la ' +
    'asistencia (con motivo).',
};

const MENSAJE_SIN_PERMISO =
  'No tenes permiso para derivar en esta sede. Derivar pide ver las inscripciones de la clase ' +
  '(inscripcion:read) y escribir en la historia clinica (hc:write).';

const MENSAJE_DATOS_INVALIDOS =
  'El servidor no acepto los datos de la derivacion. Revisa el caso elegido y volve a intentar.';

const MENSAJE_SIN_PERFIL =
  'La persona todavia no es paciente. Su perfil de paciente se activa desde el padron, y despues ' +
  'se le abre un caso en la historia clinica.';
