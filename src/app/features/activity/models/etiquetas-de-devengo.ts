import { DevengoDeClase } from '../../../api/generated/model/devengo-de-clase';
import { importeDePase } from './etiquetas-de-pases';

/**
 * Lo que la asistencia le hizo a la deuda de una oferta `POR_CLASE` (U-39, RF-M18-008,
 * CA-M19-009-06), para el resumen del lote.
 *
 * <p><b>Asistencia no es economia.</b> La asistencia se registra o se corrige siempre, haya precio
 * o cobros: por eso `CON_COBROS` y `SIN_PRECIO` son <b>avisos</b> (`aviso: true`), no fallos. Lo
 * que piden es que alguien de administracion mire la cuenta corriente.
 *
 * <p>Sin `pase:read` (U-46 c) viaja solo el `efecto`: el texto no depende del importe y, si llega,
 * se agrega. Nunca se escribe "undefined".
 */
export interface AvisoDeDevengo {
  readonly texto: string;
  readonly aviso: boolean;
}

export function avisoDeDevengo(devengo: DevengoDeClase | undefined): AvisoDeDevengo | null {
  switch (devengo?.efecto) {
    case 'DEVENGADA': {
      const importe = importeDePase(devengo.importe, devengo.moneda);
      return {
        texto: `se genero la deuda de la clase${importe === '' ? '' : ` por ${importe}`}.`,
        aviso: false,
      };
    }
    case 'YA_DEVENGADA':
      return { texto: 'ya tenia la deuda de esta clase: no se genero otra.', aviso: false };
    case 'ANULADA':
      return {
        texto: 'se anulo la deuda de la clase. No se borra: queda anulada en la cuenta corriente.',
        aviso: false,
      };
    case 'CON_COBROS':
      return {
        texto:
          'la deuda de la clase ya tiene cobros y sigue vigente. La asistencia quedo corregida ' +
          'igual; para regularizar, se anula el cobro y después la deuda desde la cuenta corriente.',
        aviso: true,
      };
    case 'SIN_PRECIO':
      return {
        texto:
          'la oferta no tiene precio vigente el día de la clase: no se genero deuda. La ' +
          'asistencia quedo registrada igual.',
        aviso: true,
      };
    case 'SIN_DEUDA':
      return { texto: 'no tenia una deuda vigente de esta clase: no se anulo nada.', aviso: false };
    default:
      // SIN_CAMBIO, NO_APLICA o sin dato: no hay nada que decir.
      return null;
  }
}
