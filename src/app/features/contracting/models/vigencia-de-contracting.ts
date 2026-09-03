/**
 * Estado administrativo y vigencia de una ficha de contratacion (M15 y M16).
 *
 * <h2>La distincion que estas pantallas no pueden aplanar</h2>
 *
 * <p>`estado` y `vigente` <b>no son lo mismo</b>, y la API los devuelve por separado justamente
 * para que la pantalla pueda explicar la diferencia. Los dos registros de cierre lo declaran con
 * las mismas palabras —"Ciclo de vida ≠ vigencia"— y las dos etapas nombran el mismo caso borde:
 * *"plan sin nuevas altas pero con pacientes vigentes"* en 03.03, *"convenio vencido"* en 03.05.
 *
 * <ul>
 *   <li><b>`estado`</b> (ACTIVO / INACTIVO) es el <b>ciclo de vida administrativo</b>: si la
 *       ficha fue dada de baja. La baja es logica, terminal —<b>no hay reactivacion</b>—, exige
 *       motivo y no borra nada.</li>
 *   <li><b>`vigente`</b> dice si <b>en la fecha consultada</b> la ficha se aplica. Exige
 *       `estado = ACTIVO` <b>y ademas</b> que la fecha caiga dentro de
 *       `[vigenciaDesde, vigenciaHasta]`.</li>
 * </ul>
 *
 * <p><b>Cerrar la vigencia es el PUT; dar de baja es el DELETE.</b> Son dos operaciones distintas
 * y RF-M15-005 y RF-M16-003 piden las dos. Un convenio con la vigencia cerrada sigue ACTIVO y
 * consultable, y eso es lo que hace que una prestacion de marzo se pueda seguir explicando en
 * octubre. Colapsar las dos cosas en un solo control es el error que estas pantallas no cometen.
 *
 * <h2>`vigenciaHasta` es INCLUSIVA, y aca no es lo mismo que en `offering`</h2>
 *
 * <p>Es la trampa mas cara de este modulo, porque el precedente del repositorio dice lo
 * contrario: `features/offering/models/situacion-de-vigencia.ts` documenta que el fin de la
 * <b>oferta</b> es <b>exclusivo</b>. En `contracting` no: el registro de cierre de 03.03 lo
 * declara —"`vigencia_hasta` es INCLUSIVA y se declara"—, el CHECK de la base admite
 * `hasta = desde` porque un plan que vale un solo dia es un estado real, y el contrato de M16 lo
 * repite en cada operacion: *"vigenciaHasta es el ULTIMO dia INCLUSIVE"*.
 *
 * <p>Copiar el texto de `offering` —"el dia que pongas es el primero en que ya no se ofrece"—
 * seria decirle al usuario exactamente lo contrario de lo que hace el backend, y el sintoma
 * seria un convenio que "vence un dia tarde" que nadie sabria de donde sale. Por eso este archivo
 * existe aparte en vez de reusar el de `offering`, y por eso las tres pantallas redactan el fin
 * con la palabra <b>inclusive</b>.
 *
 * <h2>El calculo es del backend, y no se replica</h2>
 *
 * <p>`vigente` se calcula <b>contra la fecha que se pidio</b> —el parametro `fecha` de las
 * lecturas, o hoy si se omite— y del lado del servidor. Esta pantalla nunca lo recalcula con el
 * reloj del navegador: las fechas locales se usan <b>solo para redactar</b> el motivo. Si no se
 * puede precisar por cual de los dos extremos cae afuera, se dice que esta fuera de su ventana, y
 * eso sigue siendo cierto.
 */

/**
 * Lo minimo que hay que saber de una ficha para clasificarla.
 *
 * <p><b>No es un DTO manual</b> (ADR-0002). Es una <b>restriccion estructural</b> sobre los tipos
 * generados, del mismo tipo que `PaginaDelBackend` en `shared/utils/estado-de-listado.ts`: no
 * viaja por la red, ningun servicio la serializa, y `PlanCoberturaResponse`, `ConvenioResponse` y
 * `ArancelResponse` la satisfacen tal cual vienen del generador. Si el contrato renombrara
 * `vigente`, esto deja de compilar en las tres pantallas a la vez, que es exactamente lo que se
 * quiere.
 *
 * <p>Los cuatro campos son opcionales porque asi los declara el contrato.
 */
export interface FichaConVigencia {
  readonly estado?: 'ACTIVO' | 'INACTIVO';
  readonly vigente?: boolean;
  readonly vigenciaDesde?: string;
  readonly vigenciaHasta?: string;
}

export type ClaveDeVigencia =
  /** ACTIVA y dentro de la ventana: se aplica. */
  | 'vigente'
  /** ACTIVA pero `vigenciaDesde` todavia no llego. */
  | 'aun-no'
  /** ACTIVA pero `vigenciaHasta` ya paso. La vigencia esta cerrada, la ficha no dada de baja. */
  | 'ya-no'
  /** ACTIVA y fuera de la ventana, sin poder precisar por cual de los dos extremos. */
  | 'fuera-de-ventana'
  /** INACTIVA: dada de baja, con motivo y sin vuelta atras. La ventana ya no importa. */
  | 'dada-de-baja';

export interface SituacionDeVigencia {
  readonly clave: ClaveDeVigencia;
  /** Texto corto de la marca de estado. Ej: "Activo, vigencia terminada". */
  readonly resumen: string;
  /** Por que, y que hacer. `null` cuando no hay nada que aclarar. */
  readonly explicacion: string | null;
  /** `true` si la fila se pinta atenuada: hoy no se aplica. */
  readonly atenuada: boolean;
}

/**
 * Como se nombra la ficha dentro del motivo redactado.
 *
 * <p>Existe porque la frase util no es la misma para las tres: un plan "no se ofrece para
 * coberturas nuevas", un convenio "no resuelve aranceles" y un arancel "no le pone precio a esa
 * practica". Un texto generico —"no se aplica"— seria correcto y no le diria nada a nadie.
 */
export type SujetoDeVigencia = 'plan' | 'convenio' | 'arancel';

const CONSECUENCIA: Readonly<Record<SujetoDeVigencia, string>> = {
  plan: 'no se ofrece para coberturas nuevas',
  convenio: 'no resuelve ningun arancel',
  arancel: 'no le pone precio a esa practica',
};

const NOMBRE: Readonly<Record<SujetoDeVigencia, string>> = {
  plan: 'El plan',
  convenio: 'El convenio',
  arancel: 'El arancel',
};

/**
 * Clasifica una ficha, con el motivo redactado.
 *
 * <p>`fecha` entra por parametro como `YYYY-MM-DD` y no se lee de `Date.now()` adentro: asi la
 * funcion es pura y su test no depende del reloj de la maquina que lo corre. Ademas es la
 * <b>misma</b> fecha que se le mando al backend en el parametro `fecha`, asi que la explicacion
 * no puede contradecir al campo `vigente` que viene al lado.
 *
 * <p>Las comparaciones son <b>entre strings</b> y no entre `Date`. Dos motivos: `YYYY-MM-DD`
 * ordena lexicograficamente igual que cronologicamente, y `new Date('2026-05-25')` se interpreta
 * como <b>UTC</b> segun la especificacion de JavaScript, asi que en Argentina retrocede un dia.
 * Es el bug clasico que `features/resource` ya documenta para los feriados.
 */
export function situacionDeVigencia(
  ficha: FichaConVigencia,
  fecha: string,
  sujeto: SujetoDeVigencia,
): SituacionDeVigencia {
  if (ficha.estado === 'INACTIVO') {
    return {
      clave: 'dada-de-baja',
      resumen: 'Dado de baja',
      explicacion:
        `${NOMBRE[sujeto]} fue dado de baja y no hay reactivacion. Lo que ya se firmo o se ` +
        'liquido bajo el sigue valiendo con su copia congelada: dar de baja nunca reescribe ' +
        'historicos.',
      atenuada: true,
    };
  }

  if (ficha.vigente === true) {
    return { clave: 'vigente', resumen: 'Activo y vigente', explicacion: null, atenuada: false };
  }

  const desde = ficha.vigenciaDesde ?? '';
  if (desde !== '' && desde > fecha) {
    return {
      clave: 'aun-no',
      resumen: 'Activo, todavia sin vigencia',
      explicacion:
        `Arranca el ${enPalabras(desde)}, y hasta entonces ${CONSECUENCIA[sujeto]}. No es un ` +
        'error: ya esta cargado y empieza a aplicarse solo ese dia.',
      atenuada: true,
    };
  }

  const hasta = ficha.vigenciaHasta ?? '';
  if (hasta !== '' && hasta < fecha) {
    return {
      clave: 'ya-no',
      resumen: 'Activo, vigencia terminada',
      explicacion:
        `Sigue activo, pero su vigencia termino el ${enPalabras(hasta)} —ese dia todavia se ` +
        `aplico, porque el fin es inclusivo—, y desde entonces ${CONSECUENCIA[sujeto]}. Para que ` +
        'vuelva a aplicarse, edita el fin de vigencia: dar de baja y volver a dar de alta seria ' +
        'otra ficha.',
      atenuada: true,
    };
  }

  return {
    clave: 'fuera-de-ventana',
    resumen: 'Activo, sin vigencia en esa fecha',
    explicacion: `En la fecha consultada queda fuera de su ventana, asi que ${CONSECUENCIA[sujeto]}.`,
    atenuada: true,
  };
}

/**
 * El dia de hoy en hora <b>local</b>, como `YYYY-MM-DD`.
 *
 * <p>Nunca en UTC: hoy es hoy aca. Se usa como valor inicial del filtro de fecha y para redactar
 * motivos, jamas para decidir si algo esta vigente — esa decision es del backend.
 */
export function hoyLocal(referencia: Date = new Date()): string {
  const mes = String(referencia.getMonth() + 1).padStart(2, '0');
  const dia = String(referencia.getDate()).padStart(2, '0');
  return `${referencia.getFullYear()}-${mes}-${dia}`;
}

const NOMBRES_DE_MES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/**
 * `2026-09-01` -&gt; `1 de septiembre de 2026`. Devuelve el original si no tiene esa forma.
 *
 * <p>Se parte el string en vez de construir un `Date`, por el mismo motivo que la comparacion:
 * pasar por `Date` en una fecha sin hora es la forma mas comun de perder un dia.
 */
export function enPalabras(fecha: string): string {
  const partes = fecha.split('-');
  if (partes.length !== 3) {
    return fecha;
  }
  const mes = Number(partes[1]);
  const dia = Number(partes[2]);
  if (!Number.isInteger(mes) || mes < 1 || mes > 12 || !Number.isInteger(dia)) {
    return fecha;
  }
  return `${dia} de ${NOMBRES_DE_MES[mes - 1]} de ${partes[0]}`;
}

/**
 * La ventana de vigencia redactada en una linea, con el fin <b>nombrado como inclusivo</b>.
 *
 * <p>La palabra "inclusive" no es decoracion: es la diferencia entre esta feature y `offering`,
 * y sin ella el usuario no tiene forma de saber cual de las dos convenciones rige. Un convenio
 * que termina el 31 de diciembre <b>se aplica</b> el 31 de diciembre.
 *
 * <p>Sin fin no se escribe "hasta siempre": se dice <b>sin fin previsto</b>, que es lo que
 * significa el `null` del contrato y admite que alguien lo cierre manana.
 */
export function ventanaEnPalabras(ficha: FichaConVigencia): string {
  const desde = ficha.vigenciaDesde ?? '';
  const inicio = desde === '' ? 'Sin inicio declarado' : `Desde el ${enPalabras(desde)}`;
  const hasta = ficha.vigenciaHasta ?? '';
  return hasta === ''
    ? `${inicio}, sin fin previsto`
    : `${inicio} hasta el ${enPalabras(hasta)} inclusive`;
}
