import { DiaDeAgendaMotivoSinSlotsEnum } from '../../../api/generated/model/dia-de-agenda';
import {
  fechaEnPalabras,
  horaEnZona,
  rangoEnZona,
  slotCompleto,
  sumarDias,
  textoDeCupo,
  textoSinSlots,
} from './etiquetas-de-agenda';

const ZONA = 'America/Argentina/Cordoba';
const INSTANTE = '2026-09-15T12:00:00Z';

/**
 * Spec de los textos de la agenda (M12, AKINE-05.01).
 *
 * <p>Dos afirmaciones, las dos de comportamiento: que <b>ningun dia vacio quede sin explicacion</b>
 * —el motivo del contrato es lo unico que distingue "hay que cargar un horario" de "probá otro
 * dia"— y que la hora se formatee en la <b>zona de la sede</b> y no en la del navegador.
 */
describe('textoSinSlots', () => {
  it('los diez motivos del contrato tienen un texto propio', () => {
    const motivos = Object.values(DiaDeAgendaMotivoSinSlotsEnum);
    const textos = motivos.map((motivo) =>
      textoSinSlots({ fecha: '2026-09-15', motivoSinSlots: motivo }),
    );

    expect(motivos.length).toBe(10);
    // Uno por motivo y todos distintos: si dos compartieran texto, el operador no podria
    // distinguir un feriado de una oferta vencida, que se arreglan en pantallas distintas.
    expect(new Set(textos).size).toBe(10);
    expect(textos.every((texto) => texto.length > 0)).toBe(true);
  });

  it('el dia vacio sin motivo tampoco queda en blanco', () => {
    // El contrato promete que nunca pasa. Si pasara, un espacio vacio es indistinguible de un
    // error del sistema, que es justamente lo que la etapa existe para evitar.
    expect(textoSinSlots({ fecha: '2026-09-15' })).toContain('no dijo por que');
  });

  it('un motivo que este cliente no conoce cae en el texto de respaldo', () => {
    const desconocido = { fecha: '2026-09-15', motivoSinSlots: 'HUELGA' } as never;

    expect(textoSinSlots(desconocido)).toContain('no dijo por que');
  });
});

describe('horaEnZona', () => {
  it('formatea el instante UTC en la zona de la sede, no en la del navegador', () => {
    // 12:00Z son las 09:00 en Cordoba. Formatear con la zona local mostraria horarios corridos
    // sin que nada falle, que es el peor bug posible en una agenda.
    expect(horaEnZona('2026-09-15T12:00:00Z', 'America/Argentina/Cordoba')).toBe('09:00');
    expect(horaEnZona('2026-09-15T12:00:00Z', 'UTC')).toBe('12:00');
  });

  it('una zona invalida no rompe la grilla entera', () => {
    expect(horaEnZona('2026-09-15T12:00:00Z', 'Marte/Olympus')).toBe('12:00');
  });
});

describe('slotCompleto', () => {
  it('un slot con cupo libre en cero esta completo y se muestra igual', () => {
    expect(slotCompleto({ cupoLibre: 0, cupoTotal: 1 })).toBe(true);
    expect(slotCompleto({ cupoLibre: 2, cupoTotal: 3 })).toBe(false);
    // Un slot sin cupo declarado se trata como lleno: ofrecer un hueco que el backend va a
    // rechazar es peor que no ofrecerlo.
    expect(slotCompleto({})).toBe(true);
  });
});

describe('textoDeCupo', () => {
  it('solo habla de cupo cuando la oferta es grupal', () => {
    expect(textoDeCupo({ cupoLibre: 2, cupoTotal: 3 })).toBe('2 de 3 libres');
    // En una oferta individual "1 de 1 libres" es ruido en cada slot de la grilla.
    expect(textoDeCupo({ cupoLibre: 1, cupoTotal: 1 })).toBe('');
    expect(textoDeCupo({})).toBe('');
  });
});

describe('rangoEnZona y fechaEnPalabras', () => {
  it('arman el rango y la fecha sin correrse de dia', () => {
    expect(rangoEnZona({ desde: INSTANTE, hasta: '2026-09-15T12:45:00Z' }, ZONA)).toBe(
      '09:00 a 09:45',
    );
    // La fecha del dia ya es local de la sede: interpretarla con la zona del navegador la
    // correria un dia hacia atras en todo el pais.
    expect(fechaEnPalabras('2026-09-15')).toContain('15');
    expect(fechaEnPalabras('')).toBe('');
    expect(fechaEnPalabras('no es una fecha')).toBe('');
    expect(horaEnZona(undefined, ZONA)).toBe('');
    expect(horaEnZona('no es un instante', ZONA)).toBe('');
  });
});

describe('sumarDias', () => {
  it('cruza el fin de mes y no toca una fecha invalida', () => {
    expect(sumarDias('2026-09-30', 1)).toBe('2026-10-01');
    expect(sumarDias('no es una fecha', 1)).toBe('no es una fecha');
  });
});
