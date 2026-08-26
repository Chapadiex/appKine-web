import {
  MAXIMO_DIAS_VENTANA,
  diasEntre,
  esFechaDeCalendario,
  etiquetaDeFecha,
  hoyLocal,
  sumarDias,
} from './ventana-de-fechas';
import { textoDeProfesionales } from './profesionales-de-la-sede';

/**
 * Spec de las fechas de calendario del modulo de horarios (M05, AKINE-02.04).
 *
 * <p>Lo que se cubre aca es el corrimiento de un dia: el bug que no rompe nada, no tira ningun
 * error y aparece recien cuando un feriado sale un dia antes o un cierre cubre un dia de menos.
 */
describe('ventana-de-fechas', () => {
  it('sumar dias cruza fin de mes, fin de año y el 29 de febrero de un bisiesto', () => {
    expect(sumarDias('2026-01-31', 1)).toBe('2026-02-01');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2028-02-28', 1)).toBe('2028-02-29');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
  });

  /** Un texto que no es una fecha no puede producir "NaN-NaN-NaN" en un campo del formulario. */
  it('sumar dias sobre algo que no es una fecha devuelve vacio', () => {
    expect(sumarDias('', 1)).toBe('');
    expect(sumarDias('mañana', 1)).toBe('');
  });

  it('los dias de la ventana se cuentan con el fin exclusivo, y la invertida da negativo', () => {
    expect(diasEntre('2026-06-01', '2026-06-02')).toBe(1);
    expect(diasEntre('2026-06-01', '2026-06-01')).toBe(0);
    expect(diasEntre('2026-06-02', '2026-06-01')).toBe(-1);
    expect(diasEntre('2026-01-01', '2027-01-01')).toBe(365);
    expect(diasEntre('', '2026-06-01')).toBeNull();
    expect(diasEntre('2026-06-01', 'nunca')).toBeNull();
  });

  /**
   * El cruce del horario de verano no puede comerse ni agregar un dia.
   *
   * <p>Es el motivo por el que las fechas se construyen al <b>mediodia</b> local: a medianoche,
   * un huso que adelanta el reloj deja la resta en 23 o en 25 horas y el redondeo se corre.
   */
  it('una ventana que cruza un cambio de hora sigue midiendo los dias justos', () => {
    expect(diasEntre('2026-10-15', '2026-11-15')).toBe(31);
    expect(diasEntre('2026-03-01', '2026-04-01')).toBe(31);
  });

  it('reconoce la forma YYYY-MM-DD y rechaza cualquier otra', () => {
    expect(esFechaDeCalendario('2026-06-01')).toBe(true);
    expect(esFechaDeCalendario('2026-6-1')).toBe(false);
    expect(esFechaDeCalendario('01/06/2026')).toBe(false);
    expect(esFechaDeCalendario('')).toBe(false);
  });

  /**
   * `hoyLocal` usa los componentes locales.
   *
   * <p>El atajo `toISOString().slice(0, 10)` daria el dia UTC: en Argentina, cualquier momento
   * despues de las 21:00 se guardaria como el dia siguiente.
   */
  it('hoy es el dia local, no el dia UTC', () => {
    // 1 de junio de 2026, 23:30 hora local: en UTC ya es el dia 2.
    expect(hoyLocal(new Date(2026, 5, 1, 23, 30))).toBe('2026-06-01');
    expect(hoyLocal(new Date(2026, 0, 5, 0, 15))).toBe('2026-01-05');
  });

  /**
   * La fecha se redacta a mano y no con `toLocaleDateString`.
   *
   * <p>Ese resultado depende del locale del navegador: en una maquina en `en-US` la misma fecha
   * se escribiria "June 1, 2026" y la pantalla mezclaria dos idiomas segun quien la mire.
   */
  it('la fecha se redacta en castellano y sin depender del locale de la maquina', () => {
    expect(etiquetaDeFecha('2026-06-01')).toBe('1 de junio de 2026');
    expect(etiquetaDeFecha('2026-12-25')).toBe('25 de diciembre de 2026');
  });

  /** Lo que no es una fecha se muestra tal cual: inventar una seria peor que no formatearla. */
  it('lo que no es una fecha se muestra tal cual y el undefined no imprime "undefined"', () => {
    expect(etiquetaDeFecha('cualquier cosa')).toBe('cualquier cosa');
    expect(etiquetaDeFecha(undefined)).toBe('');
  });

  it('el tope de la ventana es el que declara el contrato', () => {
    expect(MAXIMO_DIAS_VENTANA).toBe(366);
  });
});

/**
 * El numero del aviso de la apertura de sede.
 *
 * <p>No es cosmetico: "los 1 profesionales de la sede" convierte una advertencia seria en algo
 * que se lee como un error de la aplicacion y se ignora, que es exactamente lo que este aviso
 * no se puede permitir.
 */
describe('textoDeProfesionales', () => {
  it('redacta el singular, el plural y el caso de la sede sin profesionales', () => {
    expect(textoDeProfesionales(0)).toBe('ningun profesional vinculado hoy a la sede');
    expect(textoDeProfesionales(1)).toBe('1 profesional');
    expect(textoDeProfesionales(7)).toBe('7 profesionales');
  });
});
