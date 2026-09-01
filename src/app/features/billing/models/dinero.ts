/**
 * Aritmetica de plata en centavos enteros (M19, AKINE-07.02).
 *
 * <p>Vive en `features/billing` y no en `shared/`: no es un helper numerico generico, es la
 * decision de como esta feature trata el dinero. `shared/` no puede saber de dominio.
 *
 * <h2>Por que existe este archivo</h2>
 *
 * <p>`etiquetas-de-obligacion.ts` pudo prohibirse la aritmetica entera —la cuenta corriente
 * formatea y no calcula— porque el backend le da todos los numeros hechos. <b>El registro de un
 * cobro no puede darse ese lujo</b>: la pantalla tiene que sumar los medios de pago y las
 * imputaciones para saber si el cuerpo va a cuadrar antes de mandarlo, y el servidor rechaza con
 * 400 `cobro-no-cuadra` cualquier diferencia de un centavo.
 *
 * <p>Hacer esa suma con `number` es un defecto real y no una sutileza teorica:
 * `0.1 + 0.2 === 0.30000000000000004`, asi que un cobro de $0,30 pagado con dos medios de $0,10 y
 * $0,20 se compararia como distinto del total y la pantalla bloquearia un cobro perfectamente
 * valido. Al reves es peor: dos sumas que difieren en un centavo pero que el flotante iguala
 * pasarian el control local y el arqueo del dia no cerraria.
 *
 * <h2>La regla</h2>
 *
 * <p><b>Todo importe se convierte a un entero de centavos en la frontera y vuelve a decimal recien
 * al armar el cuerpo del pedido.</b> Adentro no hay un solo `+` entre flotantes. Lo que entra por
 * teclado se parsea <b>desde el texto</b>, sin pasar nunca por `parseFloat`: `Number('0.29')`
 * ya es un valor que no vale exactamente 0,29.
 *
 * <p>El limite superior es `Number.MAX_SAFE_INTEGER` centavos, o sea unos 90 billones. Una cuenta
 * corriente de kinesiologia no se acerca, y {@link centavosDeTexto} acota la entrada mucho antes.
 */

/**
 * Formato aceptado: hasta nueve digitos enteros, opcionalmente coma o punto y hasta dos decimales.
 *
 * <p>Nueve digitos son mil millones y el tope esta puesto ahi porque no hace falta mas: lo que
 * evita es que un pegado accidental de veinte cifras entre como un importe.
 */
const IMPORTE_TIPEADO = /^(\d{1,9})(?:[.,](\d{0,2}))?$/;

/**
 * Un importe del contrato, en centavos enteros.
 *
 * <p>El contrato declara los importes como `number` porque el generador no tiene un decimal, asi
 * que lo que llega ya es un flotante. `Math.round(valor * 100)` lo recupera exacto <b>porque el
 * backend nunca manda mas de dos decimales</b>: `8.32 * 100` da `832.0000000000001` y el redondeo
 * lo devuelve a `832`. Con tres decimales esto perderia informacion, y por eso el redondeo es
 * hacia el centavo mas cercano y no un truncado, que sesgaria siempre para el mismo lado.
 *
 * <p>Devuelve `null` para lo que no es un importe utilizable —ausente, `NaN`, infinito— en vez de
 * un `0` que se sumaria sin avisar.
 */
export function aCentavos(valor: number | undefined | null): number | null {
  if (valor === undefined || valor === null || !Number.isFinite(valor)) {
    return null;
  }
  return Math.round(valor * 100);
}

/**
 * Centavos enteros de vuelta al decimal que viaja en el cuerpo del pedido.
 *
 * <p>Es la unica division del archivo y ocurre <b>una sola vez por importe</b>, al final. Un
 * entero de centavos dividido por 100 tiene representacion exacta en `double` para cualquier
 * magnitud que este producto pueda ver, y el backend lo recibe como `BigDecimal`.
 */
export function deCentavos(centavos: number): number {
  return centavos / 100;
}

/**
 * Lo que el operador tipeo, en centavos enteros, o `null` si no es un importe.
 *
 * <p><b>Se parsea el texto y no el numero.</b> `Number('0.29') * 100` da `28.999999999999996`:
 * el flotante ya perdio el valor antes de que nadie sume nada. Aca la parte entera y la decimal
 * se separan como strings y se combinan con multiplicacion y suma de enteros, asi que el
 * resultado es exacto por construccion.
 *
 * <p>Se aceptan coma y punto como separador porque en Argentina se escribe con coma y los teclados
 * numericos mandan punto. Rechazar uno de los dos produce el error mas caro que puede tener una
 * pantalla de cobro: el operador ve su importe escrito y la pantalla dice que no es un numero.
 *
 * <p>Un decimal solo —`'8,5'`— vale 8,50 y no 8,05: se completa a la derecha, que es como se lee.
 */
export function centavosDeTexto(texto: string): number | null {
  const limpio = texto.trim().replace(/\s/g, '');
  if (limpio === '') {
    return null;
  }

  const partes = IMPORTE_TIPEADO.exec(limpio);
  if (partes === null) {
    return null;
  }

  const enteros = partes[1];
  const decimales = (partes[2] ?? '').padEnd(2, '0');
  return Number(enteros) * 100 + Number(decimales);
}

/**
 * Centavos enteros al texto que va dentro de un `<input>`.
 *
 * <p>Siempre con dos decimales y con punto: es lo que el propio {@link centavosDeTexto} vuelve a
 * leer sin ambiguedad. <b>No lleva simbolo de moneda ni separador de miles</b> —eso es
 * presentacion y la hace `importeEnPalabras`—: un campo editable con `$` adentro es un campo
 * que el operador tiene que limpiar antes de corregir.
 */
export function textoDeCentavos(centavos: number): string {
  const signo = centavos < 0 ? '-' : '';
  const absoluto = Math.abs(centavos);
  const enteros = Math.trunc(absoluto / 100);
  const resto = absoluto % 100;
  return `${signo}${enteros}.${String(resto).padStart(2, '0')}`;
}

/**
 * Suma de centavos enteros.
 *
 * <p>Existe para que en la pantalla no haya ni un `reduce` sobre importes decimales sueltos: la
 * suma de dinero pasa toda por aca, y aca los operandos son enteros.
 */
export function sumaDeCentavos(valores: readonly number[]): number {
  return valores.reduce((total, valor) => total + valor, 0);
}
