import { AutorizacionResponse } from '../../../api/generated/model/autorizacion-response';
import { ElegibilidadResponse } from '../../../api/generated/model/elegibilidad-response';
import { OrdenResponse } from '../../../api/generated/model/orden-response';
import { RequisitoResponse } from '../../../api/generated/model/requisito-response';
import { fechaEnPalabras } from './etiquetas-de-ficha';

/**
 * Como se redactan las ordenes, las autorizaciones y la elegibilidad (M17, AKINE-03.06).
 *
 * <p>La mitad de este archivo existe para sostener una distincion: <b>vencido, agotado, rechazado y
 * dado de baja son cuatro cosas distintas</b>, y una pantalla que las funda en un solo "estado"
 * hace que alguien de de baja un papel valido o vuelva a pedir una autorizacion que ya tiene.
 */

// -----------------------------------------------------------------------------------------
// Ordenes
// -----------------------------------------------------------------------------------------

/** `true` cuando la orden esta dada de baja: se lee, no se edita. */
export function ordenInactiva(orden: OrdenResponse): boolean {
  return orden.estado === 'INACTIVA';
}

/**
 * La situacion de una orden, en una frase.
 *
 * <p><b>Vencida no es dada de baja.</b> Una orden vencida sigue activa, se sigue listando y se
 * sigue pudiendo corregir —"un documento vencido no desaparece"—: dar de baja significa que nunca
 * debio cargarse. Fundirlas dejaria sin poder arreglar una fecha mal tipeada, que es el caso mas
 * frecuente de todos.
 */
export function situacionDeOrden(orden: OrdenResponse): string {
  if (ordenInactiva(orden)) {
    return 'Dada de baja';
  }
  if (orden.vencida === true) {
    return 'Vencida';
  }
  return orden.vigente === true ? 'Vigente' : 'Todavia no vigente';
}

/**
 * El aviso de vencimiento proximo (RF-M17-006).
 *
 * <p>Sale de `diasParaVencer`, que el backend <b>calcula al leer</b>: no hay ningun job que mueva
 * estados, y por eso el aviso nunca puede quedar desactualizado. Cadena vacia significa que no hay
 * nada que avisar, y la plantilla no dibuja nada — un "sin alerta" seria ruido en una tabla que se
 * escanea con la vista.
 */
export function avisoDeVencimiento(dias: number | undefined): string {
  if (dias === undefined || !Number.isFinite(dias) || dias < 0 || dias > 30) {
    return '';
  }
  if (dias === 0) {
    return 'Vence hoy';
  }
  return dias === 1 ? 'Vence manana' : `Vence en ${dias} dias`;
}

/** Quien firmo, con matricula si la hay. La matricula es opcional: el papel puede ser ilegible. */
export function emisorEnPalabras(orden: OrdenResponse): string {
  const emisor = orden.profesionalEmisor ?? 'Emisor sin nombre';
  const matricula = orden.matriculaEmisor;
  return matricula === undefined || matricula === '' ? emisor : `${emisor} (MP ${matricula})`;
}

/** La vigencia de una orden en una linea, con el mismo criterio que la de una cobertura. */
export function vigenciaDeDocumento(desde: string | undefined, hasta: string | undefined): string {
  const inicio = fechaEnPalabras(desde);
  const fin = fechaEnPalabras(hasta);
  if (inicio === '') {
    return fin === '' ? 'Sin vigencia declarada' : `Hasta el ${fin}`;
  }
  return fin === '' ? `Desde el ${inicio}, sin vencimiento` : `${inicio} — ${fin}`;
}

// -----------------------------------------------------------------------------------------
// Autorizaciones
// -----------------------------------------------------------------------------------------

const NOMBRES_DE_ESTADO: Record<string, string> = {
  PENDIENTE: 'Pendiente de respuesta',
  APROBADA: 'Aprobada',
  OBSERVADA: 'Observada',
  RECHAZADA: 'Rechazada',
};

export function estadoDeAutorizacion(autorizacion: AutorizacionResponse): string {
  const estado = autorizacion.estadoAutorizacion;
  return estado === undefined ? 'Sin estado' : (NOMBRES_DE_ESTADO[estado] ?? estado);
}

/** `true` cuando la autorizacion esta dada de baja. Distinto de rechazada y de vencida. */
export function autorizacionInactiva(autorizacion: AutorizacionResponse): boolean {
  return autorizacion.estado === 'INACTIVA';
}

/**
 * `true` cuando el estado admite alguna accion del financiador.
 *
 * <p>PENDIENTE y OBSERVADA admiten las tres; APROBADA y RECHAZADA son <b>terminales</b> y
 * responden 409. Ofrecer los botones sobre una terminal seria ofrecer un rechazo, y ademas
 * sugeriria que una decision tomada se puede deshacer — que es justamente lo que no se puede, para
 * que el saldo ya contado no desaparezca retroactivamente.
 */
export function admiteResolucion(autorizacion: AutorizacionResponse): boolean {
  if (autorizacionInactiva(autorizacion)) {
    return false;
  }
  const estado = autorizacion.estadoAutorizacion;
  return estado === 'PENDIENTE' || estado === 'OBSERVADA';
}

/**
 * El saldo en palabras, con la salvedad que hace falta decir.
 *
 * <p><b>`cantidadConsumida` vale siempre 0 en esta version</b> y no es un bug: RN-M17-001 separa lo
 * autorizado de lo consumido, y quien mueve la resta es la sesion clinica, en una integracion
 * posterior. La pantalla lo dice, porque un "0 consumidas" sobre un paciente que ya vino cinco
 * veces se lee como un dato roto.
 */
export function saldoEnPalabras(autorizacion: AutorizacionResponse): string {
  const autorizadas = autorizacion.cantidadAutorizada;
  if (autorizadas === undefined) {
    return 'Sin cantidad declarada';
  }
  const consumidas = autorizacion.cantidadConsumida ?? 0;
  const saldo = autorizacion.saldo ?? autorizadas - consumidas;
  return `${saldo} de ${autorizadas}`;
}

/**
 * El veredicto completo: si esta autorizacion habilita a atender hoy.
 *
 * <p>Es `habilita` del backend —activa, APROBADA, vigente y con saldo, las cuatro— y consultarlo
 * <b>no consume nada</b>. Se muestra como frase y no como un tilde: "si" y "no" sin motivo obligan
 * a quien mira a reconstruir cual de las cuatro condiciones falla.
 */
export function habilitaEnPalabras(autorizacion: AutorizacionResponse): string {
  if (autorizacion.habilita === true) {
    return 'Habilita a atender';
  }
  if (autorizacionInactiva(autorizacion)) {
    return 'No habilita: esta dada de baja';
  }
  if (autorizacion.estadoAutorizacion !== 'APROBADA') {
    return `No habilita: esta ${estadoDeAutorizacion(autorizacion).toLowerCase()}`;
  }
  if (autorizacion.vencida === true) {
    return 'No habilita: esta vencida';
  }
  if (autorizacion.agotada === true) {
    return 'No habilita: no le queda saldo';
  }
  return 'No habilita';
}

// -----------------------------------------------------------------------------------------
// Elegibilidad
// -----------------------------------------------------------------------------------------

const NOMBRES_DE_REQUISITO: Record<string, string> = {
  ORDEN: 'Orden medica',
  AUTORIZACION: 'Autorizacion',
  CREDENCIAL: 'Credencial vigente',
};

export function nombreDeRequisito(requisito: RequisitoResponse): string {
  const tipo = requisito.tipo;
  return tipo === undefined ? 'Requisito' : (NOMBRES_DE_REQUISITO[tipo] ?? tipo);
}

/**
 * Por que la lista de requisitos vino vacia con `elegible = true`.
 *
 * <p><b>Es el caso normal y no un error</b>, y pasa en cuatro situaciones frecuentes. Sin esta
 * explicacion, una respuesta "todo en orden, no falta nada" sobre un paciente sin convenio se lee
 * como que el sistema no verifico nada — y alguien sale a buscar la autorizacion igual.
 *
 * <p>RN-M17-005 y RN-M17-006: una actividad no cubierta <b>no debe</b> pedir orden ni autorizacion
 * artificialmente.
 */
export function motivoDeElegibilidad(respuesta: ElegibilidadResponse): string {
  switch (respuesta.motivo) {
    case 'COBERTURA_PARTICULAR':
      return (
        'La cobertura es particular, asi que no hay financiador que exija nada. No falta ningun ' +
        'papel.'
      );
    case 'SIN_CONVENIO_VIGENTE':
      return (
        'Este centro no tiene convenio vigente con ese plan, asi que el paciente se atiende como ' +
        'particular. No es un error de carga.'
      );
    case 'SIN_ARANCEL_VIGENTE':
      return (
        'Hay convenio, pero esa practica no tiene arancel cargado. Es un hueco de configuracion ' +
        'del centro y no un motivo para negar la atencion: avisale a quien administra los ' +
        'convenios.'
      );
    default:
      return '';
  }
}

/** Como se lee un requisito: que es, si esta cumplido, y con que. */
export function requisitoEnPalabras(requisito: RequisitoResponse): string {
  const nombre = nombreDeRequisito(requisito);
  const estado = requisito.cumplido === true ? 'cumplido' : 'FALTA';
  const detalle = requisito.detalle;
  const base = `${nombre}: ${estado}`;
  return detalle === undefined || detalle === '' ? base : `${base} — ${detalle}`;
}
