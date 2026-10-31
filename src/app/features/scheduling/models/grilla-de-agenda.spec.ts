import { AgendaOperativa } from '../../../api/generated/model/agenda-operativa';
import { OperativoDeTurnoEstadoOperativoEnum } from '../../../api/generated/model/operativo-de-turno';
import { TurnoDeCalendario } from '../../../api/generated/model/turno-de-calendario';
import {
  ColumnaDeAgenda,
  armarColumnas,
  instanteDeHoraLocal,
  minutosEnZona,
  rangoDeHoras,
} from './grilla-de-agenda';

const ZONA = 'America/Argentina/Cordoba';
const FECHA = '2026-10-30';
const LUNES = '2026-10-26';
const ANA = 55;
const LUIS = 66;

/** Hora local de Cordoba (UTC-3) a instante UTC, para leer los escenarios en la hora de la sede. */
function a(hora: string, fecha = FECHA): string {
  const [hh, mm] = hora.split(':').map(Number);
  return new Date(Date.UTC(...fechaUtc(fecha), hh + 3, mm)).toISOString();
}

function fechaUtc(fecha: string): [number, number, number] {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return [anio, mes - 1, dia];
}

let siguienteId = 1;
function turno(
  desde: string,
  hasta: string,
  opciones: {
    profesional?: number;
    espacio?: number;
    fecha?: string;
    estado?: OperativoDeTurnoEstadoOperativoEnum;
  } = {},
): TurnoDeCalendario {
  const id = siguienteId++;
  return {
    turno: {
      id,
      inicio: a(desde, opciones.fecha),
      fin: a(hasta, opciones.fecha),
      personaNombre: `Persona ${id}`,
      ofertaNombre: 'Kinesiologia',
      profesionalId: opciones.profesional ?? ANA,
      espacioId: opciones.espacio,
      operativo: {
        estadoOperativo: opciones.estado ?? OperativoDeTurnoEstadoOperativoEnum.RESERVADO,
      },
    },
  };
}

const AGENDA: AgendaOperativa = {
  timezone: ZONA,
  profesionales: [
    { membershipId: ANA, nombre: 'Ana', franjas: [{ desde: a('09:00'), hasta: a('11:00') }] },
    { membershipId: LUIS, nombre: 'Luis', franjas: [{ desde: a('10:00'), hasta: a('12:00') }] },
  ],
  espacios: [
    { id: 7, nombre: 'Box 1' },
    { id: 8, nombre: 'Box 2' },
  ],
};

/** Mucho antes de los horarios de la agenda: ninguna celda queda en el pasado. */
const ANTES = new Date('2026-10-01T00:00:00Z');

function columnas(
  agenda: Partial<AgendaOperativa>,
  opciones: Partial<Parameters<typeof armarColumnas>[0]> = {},
): readonly ColumnaDeAgenda[] {
  return armarColumnas({
    agenda: { ...AGENDA, ...agenda },
    vista: 'dia',
    agrupacion: 'profesional',
    fecha: FECHA,
    profesionalFiltrado: null,
    filtroDeTurno: () => true,
    ahora: ANTES,
    ...opciones,
  });
}

function horasDeLasCeldas(columna: ColumnaDeAgenda): readonly number[] {
  return columna.celdas.map((celda) => celda.inicioMin);
}

const min = (hora: string): number => {
  const [hh, mm] = hora.split(':').map(Number);
  return hh * 60 + mm;
};

/**
 * Lo que decide la grilla: que un horario ocupado no se ofrezca y que dos turnos que se pisan se vean.
 * Los horarios van en la zona de la sede: si salieran en la del navegador, la agenda entera se corre.
 */
describe('grilla de la agenda', () => {
  describe('carriles de lo que se pisa', () => {
    it('dos turnos que se cruzan van lado a lado y el siguiente vuelve a ocupar todo el ancho', () => {
      const [ana] = columnas({
        turnos: [turno('09:00', '10:00'), turno('09:30', '10:30'), turno('10:30', '11:00')],
      });

      expect(ana.eventos.map((e) => [e.inicioMin, e.carril, e.carriles])).toEqual([
        [min('09:00'), 0, 2],
        [min('09:30'), 1, 2],
        [min('10:30'), 0, 1],
      ]);
    });

    it('el carril que se liberó se reusa dentro del mismo grupo', () => {
      const [ana] = columnas({
        turnos: [turno('09:00', '11:00'), turno('09:30', '10:00'), turno('10:00', '10:30')],
      });

      // El tercero no se pisa con el segundo, pero sí con el primero: sigue en dos carriles.
      expect(ana.eventos.map((e) => [e.carril, e.carriles])).toEqual([
        [0, 2],
        [1, 2],
        [1, 2],
      ]);
    });
  });

  describe('celdas libres', () => {
    it('descuentan los turnos y los bloqueos de ese profesional, y traen el instante en UTC', () => {
      const [ana] = columnas({
        turnos: [turno('09:30', '10:00')],
        bloqueos: [{ excepcionId: 1, membershipId: ANA, desde: a('10:30'), hasta: a('11:00') }],
      });

      expect(horasDeLasCeldas(ana)).toEqual([min('09:00'), min('10:00')]);
      // 09:00 en Cordoba son las 12:00 UTC.
      expect(ana.celdas[0].inicio).toBe('2026-10-30T12:00:00.000Z');
      expect(ana.celdas[0].finMin).toBe(min('09:30'));
    });

    it('van al ritmo del profesional y no bajan de lo que se puede tocar', () => {
      const [propia] = columnas({}, { pasoMin: 30, duracionesPropias: new Map([[ANA, 60]]) });
      expect(horasDeLasCeldas(propia)).toEqual([min('09:00'), min('10:00')]);

      const [muyCorta] = columnas({}, { pasoMin: 1 });
      expect(horasDeLasCeldas(muyCorta)).toEqual([
        min('09:00'),
        min('09:20'),
        min('09:40'),
        min('10:00'),
        min('10:20'),
        min('10:40'),
      ]);
    });

    it('un filtro esconde el turno pero no libera su lugar; un cancelado a la vista no lo ocupa', () => {
      const conFiltro = columnas(
        { turnos: [turno('09:00', '09:30')] },
        { filtroDeTurno: () => false },
      )[0];
      expect(conFiltro.eventos).toEqual([]);
      expect(horasDeLasCeldas(conFiltro)).not.toContain(min('09:00'));

      const cancelado = columnas({
        turnos: [
          turno('09:00', '09:30', { estado: 'CANCELADO' as OperativoDeTurnoEstadoOperativoEnum }),
        ],
      })[0];
      expect(cancelado.eventos).toHaveLength(1);
      expect(horasDeLasCeldas(cancelado)).toContain(min('09:00'));
    });

    it('un turno de otro profesional no le saca horarios a este', () => {
      const [ana] = columnas({ turnos: [turno('09:00', '10:00', { profesional: LUIS })] });

      expect(horasDeLasCeldas(ana)).toEqual([
        min('09:00'),
        min('09:30'),
        min('10:00'),
        min('10:30'),
      ]);
      expect(ana.eventos).toEqual([]);
    });

    it('un horario que ya pasó no se ofrece', () => {
      const [ana] = columnas({}, { ahora: new Date(a('09:40')) });

      expect(horasDeLasCeldas(ana)).toEqual([min('10:00'), min('10:30')]);
    });

    it('sin franja no hay celdas, aunque se dibuje un turno fuera de horario', () => {
      const [ana] = columnas({
        profesionales: [{ membershipId: ANA, nombre: 'Ana', franjas: [] }],
        turnos: [turno('18:00', '18:30')],
      });

      expect(ana.celdas).toEqual([]);
      expect(ana.franjas).toEqual([]);
      // El turno fuera de franja se ve igual: esconderlo dejaría un paciente sin atender.
      expect(ana.eventos.map((e) => e.inicioMin)).toEqual([min('18:00')]);
    });
  });

  describe('bloqueos', () => {
    it('el de sede afecta a todos los profesionales; el de otro profesional, solo a ese', () => {
      const [ana, luis] = columnas({
        bloqueos: [
          { excepcionId: 1, desde: a('10:00'), hasta: a('10:30'), notas: 'Reunión' },
          {
            excepcionId: 2,
            membershipId: LUIS,
            motivo: 'CAPACITACION',
            notas: 'Curso',
            desde: a('11:00'),
            hasta: a('12:00'),
          },
        ],
      } as Parameters<typeof columnas>[0]);

      expect(luis.eventos[1].detalle).toBe('Capacitación · Curso');
      expect(ana.eventos.map((e) => e.clave)).toEqual([`b1-${FECHA}-sede`]);
      expect(ana.eventos[0].titulo).toBe('Bloqueado');
      expect(ana.eventos[0].detalle).toBe('Reunión');
      expect(luis.eventos.map((e) => e.excepcionId)).toEqual([1, 2]);
    });

    it('un bloqueo de varios días se recorta al día que se está mirando', () => {
      const [ana] = columnas({
        bloqueos: [
          {
            excepcionId: 3,
            membershipId: ANA,
            desde: a('18:00', '2026-10-29'),
            hasta: a('09:30', '2026-10-31'),
          },
        ],
      });

      expect(ana.eventos.map((e) => [e.inicioMin, e.finMin])).toEqual([[0, 24 * 60]]);
      expect(ana.celdas).toEqual([]);
    });
  });

  describe('vista por box', () => {
    it('una columna por box con sus turnos y sus clases, sin los bloqueos de los profesionales', () => {
      const [box1, box2] = columnas(
        {
          turnos: [turno('09:00', '09:30', { espacio: 7 })],
          clases: [
            {
              claseId: 9,
              espacioId: 8,
              inicio: a('10:00'),
              fin: a('11:00'),
              ocupados: 3,
              capacidad: 8,
              ofertaNombre: 'Pilates',
            },
          ],
          bloqueos: [{ excepcionId: 1, membershipId: ANA, desde: a('10:00'), hasta: a('11:00') }],
        },
        { agrupacion: 'box' },
      );

      expect(box1.titulo).toBe('Box 1');
      expect(box1.espacioId).toBe(7);
      expect(box1.profesionalId).toBeUndefined();
      expect(box1.eventos.map((e) => e.tipo)).toEqual(['turno']);
      expect(box2.eventos.map((e) => [e.tipo, e.titulo, e.detalle])).toEqual([
        ['clase', 'Pilates', 'Clase · 3/8'],
      ]);
      // Las franjas de los dos profesionales se unen: el box muestra cuándo atiende alguno.
      expect(box1.franjas).toEqual([{ inicioMin: min('09:00'), finMin: min('12:00') }]);
      expect(horasDeLasCeldas(box1)).not.toContain(min('09:00'));
      expect(horasDeLasCeldas(box1)).toContain(min('09:30'));
    });
  });

  describe('vista semana', () => {
    const semana = (opciones: Partial<Parameters<typeof armarColumnas>[0]> = {}) =>
      columnas(
        {
          turnos: [turno('09:00', '10:00')],
          profesionales: [
            {
              membershipId: ANA,
              nombre: 'Ana',
              franjas: [{ desde: a('09:00'), hasta: a('11:00') }],
            },
          ],
        },
        { vista: 'semana', fecha: LUNES, ...opciones },
      );

    it('son siete días desde el lunes y cada turno cae en el suyo', () => {
      const dias = semana();

      expect(dias.map((d) => d.fecha)).toEqual([
        '2026-10-26',
        '2026-10-27',
        '2026-10-28',
        '2026-10-29',
        '2026-10-30',
        '2026-10-31',
        '2026-11-01',
      ]);
      expect(dias[4].eventos).toHaveLength(1);
      expect(dias[3].eventos).toEqual([]);
    });

    it('sin profesional elegido no descuenta: ese horario puede estar libre para otro', () => {
      const viernes = semana()[4];

      expect(horasDeLasCeldas(viernes)).toContain(min('09:00'));
      expect(viernes.profesionalId).toBeUndefined();
    });

    it('con profesional elegido sí descuenta y la columna lleva su id', () => {
      const viernes = semana({ profesionalFiltrado: ANA })[4];

      expect(horasDeLasCeldas(viernes)).not.toContain(min('09:00'));
      expect(horasDeLasCeldas(viernes)).toContain(min('10:00'));
      expect(viernes.profesionalId).toBe(ANA);
    });
  });

  it('aplica el filtro de la pantalla sobre los turnos ya leídos', () => {
    const [ana] = columnas(
      {
        turnos: [
          turno('09:00', '09:30', { estado: OperativoDeTurnoEstadoOperativoEnum.CANCELADO }),
          turno('10:00', '10:30', { estado: OperativoDeTurnoEstadoOperativoEnum.CONFIRMADO }),
        ],
      },
      { filtroDeTurno: (t) => t.turno?.operativo?.estadoOperativo === 'CONFIRMADO' },
    );

    expect(ana.eventos.map((e) => e.inicioMin)).toEqual([min('10:00')]);
  });

  describe('rango de horas', () => {
    it('sin nada que dibujar es de 8 a 20', () => {
      expect(rangoDeHoras([])).toEqual({ inicioMin: 8 * 60, finMin: 20 * 60 });
    });

    it('cubre franjas y turnos fuera de franja, en horas enteras', () => {
      const dia = columnas({ turnos: [turno('07:30', '08:15')] });

      expect(rangoDeHoras(dia)).toEqual({ inicioMin: 7 * 60, finMin: 12 * 60 });
    });

    it('un turno que termina a medianoche llega al final del día', () => {
      const [ana] = columnas({ turnos: [turno('23:30', '24:00')] });

      expect(ana.eventos[0].finMin).toBe(24 * 60);
      expect(rangoDeHoras([ana]).finMin).toBe(24 * 60);
    });
  });

  describe('horas en la zona de la sede', () => {
    it('sin instante da cero minutos y sin zona usa UTC', () => {
      expect(minutosEnZona(undefined, ZONA)).toBe(0);
      expect(minutosEnZona('2026-10-30T12:30:00Z', '')).toBe(min('12:30'));
    });

    it('la inversa funciona aunque el desvío cruce la medianoche', () => {
      // A la 01:00 UTC en Cordoba es el día anterior: el desvío medido se normaliza.
      expect(instanteDeHoraLocal(FECHA, min('01:00'), ZONA)).toBe('2026-10-30T04:00:00.000Z');
      // Del otro lado de UTC: 23:00 en Tokio son las 14:00 UTC del mismo día.
      expect(instanteDeHoraLocal(FECHA, min('23:00'), 'Asia/Tokyo')).toBe(
        '2026-10-30T14:00:00.000Z',
      );
    });
  });
});
