import {
  ArancelEfectivoResponse,
  ArancelEfectivoResponseMotivoEnum,
} from '../../../api/generated/model/arancel-efectivo-response';
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
export type MotivoSinArancel = NonNullable<ArancelEfectivoResponse['motivo']>;

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
    ayuda: 'Asociacion mutual o de socios.',
  },
  {
    valor: FinanciadorResponseTipoEnum.ORGANISMO_PUBLICO,
    etiqueta: 'Organismo publico',
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
    etiqueta: 'Por prestacion',
    ayuda: 'Se liquida cada practica realizada, con su propio arancel.',
  },
  {
    valor: ConvenioResponseModalidadEnum.POR_SESION,
    etiqueta: 'Por sesion',
    ayuda: 'Se liquida la sesion completa, sin importar cuantas practicas incluya.',
  },
  {
    valor: ConvenioResponseModalidadEnum.MODULO,
    etiqueta: 'Modulo',
    ayuda: 'Un paquete cerrado de prestaciones se liquida como una sola unidad.',
  },
  {
    valor: ConvenioResponseModalidadEnum.CAPITA,
    etiqueta: 'Capita',
    ayuda: 'Se liquida un monto por afiliado y por periodo, se atienda o no.',
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
 * <p>El texto vive aca y no suelto en una plantilla porque lo usan <b>dos</b> pantallas —el
 * catalogo de financiadores y la consulta de arancel efectivo, que manda a cobrar como particular
 * cuando no hay convenio— y las dos tienen que decir lo mismo.
 */
export const NOTA_PARTICULAR =
  'La atencion particular no es un financiador y no la vas a encontrar en esta lista: en AKINE ' +
  'un paciente particular es, literalmente, uno que no tiene plan financiado. Si lo cargas como ' +
  'una ficha mas, alguien la va a poder renombrar o dar de baja y con eso romperia el cobro ' +
  'particular de todo el centro.';

/**
 * Un importe redactado con su moneda, o la aclaracion de que no lo hay.
 *
 * <p><b>Importe y moneda viajan juntos o no viajan.</b> Un importe sin moneda no es un importe, y
 * este SaaS va a operar en mas de un pais: mostrar un numero pelado es exactamente la ambiguedad
 * que el CHECK de la base evita. El backend rechaza un copago sin moneda con un 400.
 *
 * <p>Un plan <b>sin copago no esta mal cargado</b>: `null` significa "sin copago declarado", que
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
 * Los tres importes del arancel, ya redactados.
 *
 * <p><b>Son tres y no dos, y no hay porcentaje de cobertura.</b> §37 y el registro de cierre de
 * 03.05 lo fundamentan: un porcentaje obliga a multiplicar y redondear, y el redondeo de un
 * arancel es la diferencia de un centavo que aparece seis meses despues en una presentacion
 * rechazada. Con los tres explicitos no hay nada que redondear.
 *
 * <p>La moneda no viaja en el cuerpo del arancel: la <b>hereda del convenio</b>. Por eso entra
 * por parametro y no se lee de la fila.
 */
export function ternaEnPalabras(
  arancel: {
    readonly importeTotal?: number;
    readonly importeFinanciador?: number;
    readonly coseguro?: number;
  },
  moneda: string | undefined,
): string {
  const total = importeEnPalabras(arancel.importeTotal, moneda, '-');
  const financiador = importeEnPalabras(arancel.importeFinanciador, moneda, '-');
  const coseguro = importeEnPalabras(arancel.coseguro, moneda, '-');
  return `${total} = ${financiador} (financiador) + ${coseguro} (paciente)`;
}

/**
 * `true` si los tres importes cuadran: financiador + coseguro = total.
 *
 * <p><b>La autoridad es el backend</b>, que lo hace cumplir con `ck_arancel_partes_suman_total`
 * desde la base. Esto se calcula igual para poder decirlo <b>antes</b> de mandar, con el campo
 * senalado, en vez de gastar un `400` para comunicar algo que ya se sabia.
 *
 * <p>Se comparan <b>centavos enteros</b> y no los flotantes crudos: en JavaScript
 * `0.1 + 0.2 !== 0.3`, y un arancel legitimo de `1000.10 + 2000.20` quedaria rechazado por la
 * pantalla mientras el backend —que usa `BigDecimal`— lo acepta. El redondeo a centavos es la
 * unidad en la que el contrato declara los importes (`DECIMAL(12,2)`).
 */
export function importesCuadran(total: number, financiador: number, coseguro: number): boolean {
  if (![total, financiador, coseguro].every((valor) => Number.isFinite(valor))) {
    return false;
  }
  return enCentavos(financiador) + enCentavos(coseguro) === enCentavos(total);
}

function enCentavos(importe: number): number {
  return Math.round(importe * 100);
}

/**
 * Que decir cuando la resolucion NO encontro arancel.
 *
 * <h2>Esto no es un error, y la pantalla no puede tratarlo como uno</h2>
 *
 * <p>`GET /aranceles/efectivo` responde <b>200</b> con `resuelto = false` y un motivo. El contrato
 * lo justifica: no encontrar convenio es el desenlace <b>mas frecuente</b> —la mayoria de los
 * pacientes se atienden como particulares— y un 404 obligaria a la pantalla a tratar el caso
 * normal como una excepcion. Mostrar un cartel rojo, o peor, un vacio, seria exactamente eso.
 *
 * <p><b>Los dos motivos mandan a hacer cosas distintas y por eso hacen falta los dos:</b>
 * `SIN_CONVENIO_VIGENTE` manda a cobrar como particular (RN-M16-005), `SIN_ARANCEL_VIGENTE` dice
 * que el convenio existe y lo que falta es el precio de <b>esa</b> practica. Aplanarlos en un
 * "no hay arancel" deja al usuario sin saber si tiene que cobrar o cargar un dato.
 */
export interface ExplicacionSinArancel {
  readonly titulo: string;
  readonly detalle: string;
  /** Que hacer ahora. Es lo unico accionable de todo el bloque. */
  readonly queHacer: string;
}

export function explicarSinArancel(motivo: string | undefined): ExplicacionSinArancel {
  if (motivo === ArancelEfectivoResponseMotivoEnum.SIN_ARANCEL_VIGENTE) {
    return {
      titulo: 'Hay convenio, pero esa practica no tiene precio cargado para esa fecha',
      detalle:
        'El convenio con ese financiador y ese plan se aplica en la fecha consultada, asi que la ' +
        'cobertura existe. Lo que falta es el arancel de esta practica en particular: puede que ' +
        'nunca se haya cargado, o que el que habia tenga la vigencia terminada.',
      queHacer:
        'Carga el arancel de esa practica en la grilla del convenio. Hasta que exista, esta ' +
        'prestacion no se puede liquidar contra el financiador.',
    };
  }

  return {
    titulo: 'No hay convenio vigente para ese financiador y ese plan en esa fecha',
    detalle:
      'Puede que nunca se haya firmado un convenio con ese plan en esta sede, que el que habia ' +
      'tenga la vigencia terminada, o que este dado de baja. Sin convenio aplicable no se asume ' +
      'ninguna cobertura: es la regla, no una falla de la consulta.',
    queHacer:
      'La prestacion se cobra como particular. Si el convenio deberia existir, cargalo en esta ' +
      'sede; si lo que vencio es la vigencia, edita el convenio y estirale el fin.',
  };
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
