import { DIAS_DE_LA_SEMANA, etiquetaDeDia } from './dias-de-la-semana';
import {
  HORA_MEDIANOCHE,
  esHoraDePared,
  etiquetaDeHora,
  minutosDeHora,
  rangoHorario,
} from './horas-de-pared';

/**
 * Spec de las horas de pared y de los dias (M05, AKINE-02.04).
 *
 * <p>Lo que se prueba aca es lo que <b>ningun error visible</b> delataria: que `24:00` siga
 * siendo un valor legitimo de punta a punta, y que la numeracion de los dias sea la ISO-8601
 * del contrato y no la de `Date#getDay()`, que arranca en domingo.
 */
describe('horas de pared', () => {
  it('24:00 es una hora valida y 00:00 no es lo mismo', () => {
    // El caso limite del contrato: la hora de fin es EXCLUSIVA, asi que el final del dia se
    // escribe 24:00. Un validador copiado de cualquier regex de hora lo rechazaria.
    expect(esHoraDePared(HORA_MEDIANOCHE)).toBe(true);
    expect(minutosDeHora(HORA_MEDIANOCHE)).toBe(1440);

    // Y las 00:00 siguen existiendo: son el PRINCIPIO del dia, un inicio valido.
    expect(esHoraDePared('00:00')).toBe(true);
    expect(minutosDeHora('00:00')).toBe(0);
  });

  it('rechaza lo que no es una hora de pared, incluido el 24:30 que 24:00 podria sugerir', () => {
    for (const invalida of ['', '9:00', '24:30', '25:00', '09:60', '09-00', 'nueve']) {
      expect(esHoraDePared(invalida), `${invalida} no deberia ser valida`).toBe(false);
      expect(minutosDeHora(invalida)).toBeNull();
    }
  });

  it('ordena por minutos, con la medianoche al final y sin ningun caso especial', () => {
    expect(minutosDeHora('09:00')).toBeLessThan(minutosDeHora('12:00') ?? 0);
    expect(minutosDeHora('23:59')).toBeLessThan(minutosDeHora(HORA_MEDIANOCHE) ?? 0);
  });

  it('el rango nombra la medianoche en palabras y nunca imprime undefined', () => {
    expect(rangoHorario('09:00', '12:00')).toBe('09:00 a 12:00');
    // "20:00 a 24:00" se lee como un error de carga; el valor que se envia sigue siendo 24:00.
    expect(rangoHorario('20:00', HORA_MEDIANOCHE)).toBe('20:00 a medianoche (24:00)');

    // Todos los campos del contrato son opcionales: un `undefined` no puede terminar en la
    // grilla escrito con letras.
    expect(etiquetaDeHora(undefined)).toBe('');
    expect(rangoHorario(undefined, undefined)).toBe(' a ');
  });
});

describe('dias de la semana', () => {
  it('usa la numeracion ISO del contrato: lunes = 1, domingo = 7', () => {
    // NO la de `Date#getDay()`, que arranca en domingo = 0. Las dos se parecen lo suficiente
    // como para que un corrimiento de un dia pase inadvertido en revision.
    expect(DIAS_DE_LA_SEMANA.length).toBe(7);
    expect(etiquetaDeDia(1)).toBe('Lunes');
    expect(etiquetaDeDia(7)).toBe('Domingo');
  });

  it('un numero desconocido degrada a un rotulo legible en vez de romper la grilla', () => {
    expect(etiquetaDeDia(9)).toBe('Dia 9');
    expect(etiquetaDeDia(undefined)).toBe('Dia ?');
  });
});
