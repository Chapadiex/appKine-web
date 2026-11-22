import {
  ConvenioResponse,
  ConvenioResponseModalidadEnum,
} from '../../../api/generated/model/convenio-response';
import {
  FinanciadorResponse,
  FinanciadorResponseTipoEnum,
} from '../../../api/generated/model/financiador-response';

/**
 * Como se nombran en pantalla los enumerados y los importes de `contracting` (M15 y M16).
 *
 * <p><b>Los tipos se derivan del contrato, no se copian</b> (ADR-0002). `TipoDeFinanciador` es
 * literalmente el tipo del campo de {@link FinanciadorResponse}: si el backend agrega un septimo
 * valor, las tablas de abajo dejan de estar completas y el compilador lo dice en el `satisfies`.
 * Escribir la union a mano no daria ninguna de las dos cosas.
 *
 * <p><b>Que hace este archivo y que no.</b> Traduce codigos a palabras, explica que significa cada
 * opcion y redacta importes. <b>No decide nada</b>: ninguna pantalla puede ramificar por el tipo
 * de financiador ni por la modalidad del convenio, porque ninguna de las dos cosas cambia
 * comportamiento en F3. La modalidad se guarda para que M18 sepa como liquidar, y hoy es
 * clasificacion.
 */
export type TipoDeFinanciador = NonNullable<FinanciadorResponse['tipo']>;
export type ModalidadDeConvenio = NonNullable<ConvenioResponse['modalidad']>;

/** Una opcion de un `select`, con su explicacion para el texto de ayuda. */
export interface OpcionEnumerada<T extends string> {
  readonly valor: T;
  readonly etiqueta: string;
  readonly ayuda: string;
}

export const TIPOS_DE_FINANCIADOR = [
  {
    valor: FinanciadorResponseTipoEnum.OBRA_SOCIAL,
    etiqueta: 'Obra social',
    ayuda: 'Cobertura sindical o estatal obligatoria.',
  },
  {
    valor: FinanciadorResponseTipoEnum.PREPAGA,
    etiqueta: 'Prepaga',
    ayuda: 'Medicina privada contratada de forma voluntaria.',
  },
  {
    valor: FinanciadorResponseTipoEnum.ART,
    etiqueta: 'ART',
    ayuda: 'Aseguradora de riesgos del trabajo: cubre accidentes laborales.',
  },
  {
    valor: FinanciadorResponseTipoEnum.MUTUAL,
    etiqueta: 'Mutual',
    ayuda: 'Asociación mutual o de socios.',
  },
  {
    valor: FinanciadorResponseTipoEnum.ORGANISMO_PUBLICO,
    etiqueta: 'Organismo público',
    ayuda: 'Programa o dependencia estatal que financia prestaciones.',
  },
  {
    valor: FinanciadorResponseTipoEnum.OTRO,
    etiqueta: 'Otro',
    ayuda: 'Cualquier financiador que no encaje en los anteriores.',
  },
] as const satisfies readonly OpcionEnumerada<TipoDeFinanciador>[];

/**
 * Las cuatro modalidades de liquidacion del convenio.
 *
 * <p>Se <b>guardan y se muestran</b>, y hoy nadie las interpreta: quien las aplique es M18. La
 * ayuda de cada una existe para que quien carga el convenio elija la que figura en el contrato
 * firmado, no la que le suena mejor — el dia que la liquidacion las lea, cambiarlas ya no va a
 * ser inocuo.
 */
export const MODALIDADES_DE_CONVENIO = [
  {
    valor: ConvenioResponseModalidadEnum.POR_PRESTACION,
    etiqueta: 'Por prestación',
    ayuda: 'Se liquida cada práctica realizada, con su propio arancel.',
  },
  {
    valor: ConvenioResponseModalidadEnum.POR_SESION,
    etiqueta: 'Por sesión',
    ayuda: 'Se liquida la sesión completa, sin importar cuántas prácticas incluya.',
  },
  {
    valor: ConvenioResponseModalidadEnum.MODULO,
    etiqueta: 'Modulo',
    ayuda: 'Un paquete cerrado de prestaciones se liquida como una sola unidad.',
  },
  {
    valor: ConvenioResponseModalidadEnum.CAPITA,
    etiqueta: 'Capita',
    ayuda: 'Se liquida un monto por afiliado y por período, se atienda o no.',
  },
] as const satisfies readonly OpcionEnumerada<ModalidadDeConvenio>[];

/** Etiqueta de un tipo de financiador, o el codigo crudo si el backend manda uno desconocido. */
export function etiquetaDeTipo(valor: string | undefined): string {
  return TIPOS_DE_FINANCIADOR.find((opcion) => opcion.valor === valor)?.etiqueta ?? valor ?? '-';
}

/** Etiqueta de una modalidad de convenio, o el codigo crudo si es una que no conocemos. */
export function etiquetaDeModalidad(valor: string | undefined): string {
  return MODALIDADES_DE_CONVENIO.find((opcion) => opcion.valor === valor)?.etiqueta ?? valor ?? '-';
}

/**
 * `PARTICULAR` no es una fila del catalogo, y la pantalla tiene que decirlo.
 *
 * <p>RN-M15-004: la cobertura particular se modela en M08 como la <b>ausencia</b> de plan
 * financiado, no como un financiador llamado "Particular". El registro de cierre de 03.03 explica
 * por que no se siembra: sembrarlo lo volveria borrable, renombrable y duplicable, y obligaria a
 * que alguna decision del sistema dependiera de un nombre.
 *
 * <p>El texto vive aca y no suelto en una plantilla: es el que muestra el catalogo de financiadores.
 */
export const NOTA_PARTICULAR =
  'La atención particular no es un financiador y no la vas a encontrar en esta lista: en AKINE ' +
  'un paciente particular es, literalmente, uno que no tiene plan financiado. Si lo cargas como ' +
  'una ficha mas, alguien la va a poder renombrar o dar de baja y con eso romperia el cobro ' +
  'particular de todo el centro.';

/**
 * Un importe redactado con su moneda, o la aclaracion de que no lo hay.
 *
 * <p><b>Importe y moneda viajan juntos o no viajan.</b> Un importe sin moneda no es un importe, y
 * este SaaS va a operar en más de un pais: mostrar un numero pelado es exactamente la ambiguedad
 * que el CHECK de la base evita. El backend rechaza un copago sin moneda con un 400.
 *
 * <p>Un plan <b>sin copago no está mal cargado</b>: `null` significa "sin copago declarado", que
 * <b>no</b> es lo mismo que cero. Por eso el texto de ausencia dice "sin declarar" y no "$ 0".
 */
export function importeEnPalabras(
  importe: number | undefined | null,
  moneda: string | undefined | null,
  ausente = 'Sin declarar',
): string {
  if (importe === undefined || importe === null || !moneda) {
    return ausente;
  }
  return `${moneda} ${importe.toFixed(2)}`;
}

/**
 * Nombre de un financiador en un selector: `OSDE (OSDE)` queda feo, `OSDE-410` no dice nada.
 *
 * <p>El codigo va al lado del nombre y no en una columna aparte porque en un `select` no hay
 * columnas, y el codigo es lo que el equipo administrativo tiene memorizado. Se omite cuando
 * coincide con el nombre, para no repetirlo.
 */
export function enUnaLinea(ficha: { readonly codigo?: string; readonly nombre?: string }): string {
  const nombre = ficha.nombre ?? '';
  const codigo = ficha.codigo ?? '';
  if (codigo === '' || codigo === nombre) {
    return nombre;
  }
  return `${nombre} (${codigo})`;
}
