import { CoberturaDelHitoResponse } from '../../../api/generated/model/cobertura-del-hito-response';
import { CoberturaResponse } from '../../../api/generated/model/cobertura-response';
import { HitoResponse } from '../../../api/generated/model/hito-response';
import { fechaEnPalabras } from './etiquetas-de-ficha';

/**
 * Como se redacta una cobertura del paciente en pantalla (M08, AKINE-03.04).
 *
 * <p>Todo lo que se muestra sale de la <b>copia congelada</b> que el backend guardo al dar de alta
 * la cobertura, y nunca del catalogo de hoy. No es una limitacion de esta capa: resolver el nombre
 * del financiador contra el catalogo vivo haria que renombrar un plan reescriba con que cobertura
 * se atendio al paciente el mes pasado, que es lo que RN-M08-003 prohibe.
 */

/**
 * Financiador y plan, tal como estaban el dia que se firmo.
 *
 * <p>PARTICULAR no tiene ninguno de los dos y no es un dato faltante: es la ausencia de plan
 * financiado, que es una modalidad completa y siempre disponible (RN-M08-001). Por eso se escribe
 * "Particular" y no un guion.
 */
export function coberturaEnUnaLinea(cobertura: CoberturaResponse): string {
  if (cobertura.tipo === 'PARTICULAR') {
    return 'Particular';
  }
  const financiador = cobertura.financiadorNombre ?? 'Financiador sin nombre';
  const plan = cobertura.planNombre;
  return plan === undefined || plan === '' ? financiador : `${financiador} — ${plan}`;
}

/**
 * La vigencia en una linea.
 *
 * <p>Sin `vigenciaHasta` dice "sin fecha de fin" y no deja el campo vacio: una cobertura abierta es
 * el caso normal —el paciente sigue afiliado— y un hueco invita a "completarlo" poniendo una fecha
 * inventada, que despues cierra una cobertura que estaba bien.
 */
export function vigenciaEnPalabras(cobertura: CoberturaResponse): string {
  const desde = fechaEnPalabras(cobertura.vigenciaDesde);
  const hasta = fechaEnPalabras(cobertura.vigenciaHasta);
  if (desde === '') {
    return hasta === '' ? 'Sin vigencia declarada' : `Hasta el ${hasta}`;
  }
  return hasta === '' ? `Desde el ${desde}, sin fecha de fin` : `${desde} — ${hasta}`;
}

/**
 * En que situacion esta la cobertura, en una sola frase.
 *
 * <p>Son <b>tres cosas distintas</b> y la pantalla no las puede fundir en un unico "estado", que es
 * el error que hace que alguien de de baja una cobertura correcta:
 *
 * <ul>
 *   <li><b>Dada de baja</b> es ciclo de vida: "nunca debio cargarse".</li>
 *   <li><b>Vigencia terminada</b> es ACTIVA con la vigencia cerrada: es el caso normal de un
 *       paciente que cambio de obra social, y sigue explicando el pasado.</li>
 *   <li><b>Vigente</b> es la que aplica hoy.</li>
 * </ul>
 */
export function situacionEnPalabras(cobertura: CoberturaResponse): string {
  if (coberturaInactiva(cobertura)) {
    return 'Dada de baja';
  }
  return cobertura.vigente === true ? 'Vigente' : 'Vigencia terminada';
}

/** `true` cuando la cobertura esta dada de baja: se lee, no se edita ni se marca principal. */
export function coberturaInactiva(cobertura: CoberturaResponse): boolean {
  return cobertura.estado === 'INACTIVA';
}

/**
 * Que decir de la credencial.
 *
 * <p><b>Una credencial vencida no invalida la cobertura</b>, y por eso esto informa en vez de
 * cambiar ningun estado: vencerla automaticamente daria de baja coberturas reales por un dato que
 * el mostrador copia a mano de un plastico.
 */
export function credencialEnPalabras(cobertura: CoberturaResponse): string {
  const hasta = fechaEnPalabras(cobertura.credencialVigenciaHasta);
  if (hasta === '') {
    return cobertura.requeriaCredencial === true
      ? 'Sin vencimiento cargado (el plan la exigia)'
      : 'Sin vencimiento cargado';
  }
  return cobertura.credencialVencida === true ? `Vencida el ${hasta}` : `Vigente hasta el ${hasta}`;
}

/**
 * `true` cuando la cobertura admite las acciones de la pantalla.
 *
 * <p>Una dada de baja no se edita, no se marca principal y no se vuelve a dar de baja: las tres
 * responden 409. Ofrecer los botones seria ofrecer tres rechazos.
 */
export function coberturaOperable(cobertura: CoberturaResponse): boolean {
  return !coberturaInactiva(cobertura);
}

/**
 * Por que una cobertura vigente no aplica a una oferta, o a una practica de ella (RF-M08-006).
 *
 * <p>Los cuatro valores son los del contrato. Uno desconocido devuelve un texto neutro en vez de
 * la constante cruda: un codigo en pantalla no le dice nada a quien atiende el mostrador.
 */
export function motivoDeNoAplicable(motivo: string | undefined): string {
  switch (motivo) {
    case 'OFERTA_NO_ADMITE_OBRA_SOCIAL':
      return 'La oferta no admite obra social: se atiende como particular aunque el paciente tenga cobertura.';
    case 'OFERTA_SIN_PRACTICAS':
      return 'La oferta no declara practicas, asi que no hay nada que facturarle al financiador.';
    case 'SIN_CONVENIO_VIGENTE':
      return 'El centro no tiene convenio vigente con este financiador y plan para ese dia.';
    case 'SIN_ARANCEL_VIGENTE':
      return 'Hay convenio, pero sin arancel vigente para la practica ese dia.';
    default:
      return 'No aplica a esta oferta.';
  }
}

// -----------------------------------------------------------------------------------------
// La seccion "coberturas" del Paciente 360 (B-5)
// -----------------------------------------------------------------------------------------

/** Clave estable con la que `person` aporta las coberturas vigentes al 360. */
export const SECCION_COBERTURAS = 'coberturas';

/** Una cobertura vigente del 360, ya redactada para pintarla. */
export interface CoberturaDelResumen {
  readonly principal: boolean;
  /** Financiador y plan congelados, "Particular", o el titulo entero si no vinieron los campos. */
  readonly descripcion: string;
  /** "Afiliado ···4567", o vacio si no hay numero o no vinieron los campos. */
  readonly afiliado: string;
  /** La vigencia en una frase, o vacio si no se puede redactar. */
  readonly vigencia: string;
  /** Que decir de la credencial cuando NO esta vencida, o vacio. */
  readonly credencial: string;
  readonly credencialVencida: boolean;
}

/**
 * Lee un hito de la seccion `coberturas` del 360.
 *
 * <p>Desde el contrato 0.70.0 (A-11) cada hito trae `cobertura` con los datos como campos:
 * financiador y plan congelados, afiliado <b>ya enmascarado</b>, vigencia y credencial como fechas
 * sin hora. Esos campos son los que mandan. El `titulo` es para leer, no para partir: partirlo ataba
 * la pantalla a una redaccion del backend que nadie prometio mantener.
 *
 * <p><b>Degradacion:</b> si `cobertura` viene nula —un backend anterior a 0.70.0— se muestra el
 * titulo entero con las fechas ISO vueltas legibles, sin intentar separarlo, y la vigencia sale de
 * `ocurrioEn` (inicio de vigencia a medianoche UTC, que se lee como fecha y no pasa por `Date`).
 */
export function coberturaDelResumen(hito: HitoResponse): CoberturaDelResumen {
  const principal = hito.tipo === 'COBERTURA_PRINCIPAL';
  const datos = hito.cobertura;
  if (datos === undefined || datos === null) {
    return degradado(hito, principal);
  }

  const vencida = datos.estadoCredencial === 'VENCIDA';
  return {
    principal: datos.principal ?? principal,
    descripcion: financiadorYPlan(datos),
    afiliado: datos.afiliadoEnmascarado ? `Afiliado ${datos.afiliadoEnmascarado}` : '',
    vigencia: vigenciaDelHito(datos.vigenciaDesde, datos.vigenciaHasta),
    credencial: vencida ? '' : credencialDelHito(datos),
    credencialVencida: vencida,
  };
}

function financiadorYPlan(datos: CoberturaDelHitoResponse): string {
  if (datos.tipo === 'PARTICULAR') {
    return 'Particular';
  }
  const financiador = datos.financiadorNombre || 'Financiador sin nombre';
  return datos.planNombre ? `${financiador} — ${datos.planNombre}` : financiador;
}

/** `vigenciaHasta` es el ultimo dia de la cobertura: inclusivo. */
function vigenciaDelHito(desde: string | undefined, hasta: string | null | undefined): string {
  const inicio = fechaEnPalabras(desde);
  const fin = fechaEnPalabras(hasta);
  if (inicio === '') {
    return fin === '' ? '' : `Vigente hasta el ${fin} inclusive.`;
  }
  return fin === ''
    ? `Vigente desde el ${inicio}, sin fecha de fin.`
    : `Vigente desde el ${inicio} hasta el ${fin} inclusive.`;
}

function credencialDelHito(datos: CoberturaDelHitoResponse): string {
  const hasta = fechaEnPalabras(datos.credencialVigenciaHasta);
  if (datos.estadoCredencial === 'VIGENTE' && hasta !== '') {
    return `Credencial vigente hasta el ${hasta}.`;
  }
  if (datos.estadoCredencial === 'SIN_VENCIMIENTO') {
    return 'Credencial sin vencimiento cargado.';
  }
  return '';
}

function degradado(hito: HitoResponse, principal: boolean): CoberturaDelResumen {
  const titulo = hito.titulo?.trim() ?? '';
  const fechaDeInicio = /^(\d{4}-\d{2}-\d{2})T/.exec(hito.ocurrioEn ?? '');
  const desde = fechaDeInicio === null ? '' : fechaEnPalabras(fechaDeInicio[1]);
  return {
    principal,
    descripcion:
      titulo === ''
        ? 'Cobertura sin descripcion'
        : titulo.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1'),
    afiliado: '',
    vigencia: desde === '' ? '' : `Vigente desde el ${desde}.`,
    credencial: '',
    credencialVencida: hito.estado === 'CREDENCIAL_VENCIDA',
  };
}
