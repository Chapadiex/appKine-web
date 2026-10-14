import { DiaDeAgendaMotivoSinSlotsEnum } from '../../../api/generated/model/dia-de-agenda';
import { AkineHttpError, ProblemDetail } from '../../../core/interceptors/error.interceptor';
import {
  clasificarOcurrencias,
  diaIso,
  expandirRegla,
  fechaEnZona,
  horarioDesplazado,
  textoDeDias,
  textoDeOmitido,
  ventanasDeAgenda,
} from './series';
import { traducirErrorSerie } from './series-errors';

const ZONA = 'America/Argentina/Cordoba';

/**
 * Spec de las reglas de pantalla de las series (AKINE E-3).
 *
 * <p>Cubre lo que decide comportamiento: que la expansion de la regla sea la misma que la del
 * backend —si difiere, la previsualizacion muestra fechas que el servidor no va a reservar—, que la
 * clasificacion marque lo que choca, y que el 409 de una ocurrencia nombre la fecha.
 */
describe('series — expansion de la regla', () => {
  it('cuenta ocurrencias, no semanas, y arranca el mismo dia si coincide', () => {
    // 2026-10-12 es lunes. Lunes y jueves, 4 turnos.
    const { fechas } = expandirRegla({ fechaDesde: '2026-10-12', diasSemana: [1, 4], cantidad: 4 });
    expect(fechas).toEqual(['2026-10-12', '2026-10-15', '2026-10-19', '2026-10-22']);
  });

  it('con fecha fin la incluye', () => {
    const { fechas } = expandirRegla({
      fechaDesde: '2026-10-12',
      diasSemana: [1],
      fechaHasta: '2026-10-26',
    });
    expect(fechas).toEqual(['2026-10-12', '2026-10-19', '2026-10-26']);
  });

  it('marca el exceso del tope de 52 en vez de expandir sin fin', () => {
    const expansion = expandirRegla({
      fechaDesde: '2026-10-12',
      diasSemana: [1, 2, 3],
      fechaHasta: '2027-10-12',
    });
    expect(expansion.excedeElTope).toBe(true);
    expect(expansion.fechas.length).toBe(52);
  });

  it('sin dias o sin fin no produce nada', () => {
    expect(expandirRegla({ fechaDesde: '2026-10-12', diasSemana: [], cantidad: 3 }).fechas).toEqual(
      [],
    );
    expect(expandirRegla({ fechaDesde: '2026-10-12', diasSemana: [1] }).fechas).toEqual([]);
  });

  it('dia ISO: domingo es 7', () => {
    expect(diaIso('2026-10-18')).toBe(7);
    expect(diaIso('2026-10-12')).toBe(1);
  });

  it('parte el rango en ventanas de a lo sumo 62 dias, con hasta exclusivo', () => {
    expect(ventanasDeAgenda('2026-10-12', '2026-10-12')).toEqual([
      { desde: '2026-10-12', hasta: '2026-10-13' },
    ]);
    const ventanas = ventanasDeAgenda('2026-01-01', '2026-04-30');
    expect(ventanas[0]).toEqual({ desde: '2026-01-01', hasta: '2026-03-04' });
    expect(ventanas[ventanas.length - 1].hasta).toBe('2026-05-01');
  });
});

describe('series — clasificacion contra la agenda', () => {
  const agenda = {
    timezone: ZONA,
    dias: [
      {
        fecha: '2026-10-12',
        slots: [{ desde: '2026-10-12T12:00:00Z', cupoLibre: 1, cupoTotal: 1, profesionalId: 31 }],
      },
      {
        fecha: '2026-10-19',
        slots: [{ desde: '2026-10-19T12:00:00Z', cupoLibre: 0, cupoTotal: 1, profesionalId: 31 }],
      },
      { fecha: '2026-10-26', slots: [], motivoSinSlots: DiaDeAgendaMotivoSinSlotsEnum.FERIADO },
      {
        fecha: '2026-11-02',
        slots: [{ desde: '2026-11-02T13:00:00Z', cupoLibre: 1, cupoTotal: 1, profesionalId: 31 }],
      },
    ],
  };

  it('libre, completo, feriado, otra hora y dia que no vino', () => {
    const resultado = clasificarOcurrencias(
      ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'],
      '09:00',
      [agenda],
      31,
    );
    expect(resultado.map((o) => o.estado)).toEqual([
      'libre',
      'completo',
      'sin-horario',
      'sin-horario',
      'sin-horario',
    ]);
    expect(resultado[0].instante).toBe('2026-10-12T12:00:00Z');
    expect(resultado[2].detalle).toContain('Feriado');
    expect(resultado[3].detalle).toContain('09:00');
  });

  it('otro profesional no cuenta como lugar', () => {
    const [unica] = clasificarOcurrencias(['2026-10-12'], '09:00', [agenda], 99);
    expect(unica.estado).toBe('sin-horario');
  });

  it('textos de apoyo', () => {
    expect(fechaEnZona('2026-10-13T02:00:00Z', ZONA)).toBe('2026-10-12');
    expect(textoDeDias([1, 4])).toBe('Lunes y jueves');
    expect(textoDeOmitido('EN_ESPERA')).toContain('llego');
  });
});

describe('traducirErrorSerie', () => {
  function problema(status: number, tipo: string, extras: Record<string, unknown> = {}) {
    return new AkineHttpError(
      status,
      {
        type: `https://akine.app/problems/${tipo}`,
        status,
        detail: 'Rechazado por el servidor.',
        ...extras,
      } as ProblemDetail,
      false,
    );
  }

  it('una ocurrencia sin lugar dice que no se reservo ninguna y nombra la fecha', () => {
    const error = traducirErrorSerie(
      problema(409, 'recurso-ocupado', {
        recurso: 'profesional',
        ocurrenciaInicio: '2026-10-19T12:00:00Z',
      }),
      ZONA,
    );
    expect(error.accion).toBe('revisar-ocurrencias');
    expect(error.ocurrenciaInicio).toBe('2026-10-19T12:00:00Z');
    expect(error.mensaje).toContain('No se reservo ningun turno');
    expect(error.mensaje).toContain('19/10/2026');
    expect(error.mensaje).toContain('profesional');
  });

  it('el conflict generico es la cantidad confirmada que cambio', () => {
    const error = traducirErrorSerie(problema(409, 'conflict'));
    expect(error.accion).toBe('releer-alcance');
    expect(error.mensaje).toContain('No se cancelo nada');
  });

  it('sin turnos pendientes en el alcance', () => {
    const error = traducirErrorSerie(problema(409, 'turno-transicion-no-permitida'));
    expect(error.accion).toBe('releer-alcance');
    expect(error.mensaje).toContain('ningun turno pendiente');
  });

  it('en la reprogramacion, el destino sin lugar dice que no se movio ninguno', () => {
    const error = traducirErrorSerie(
      problema(409, 'slot-completo', { ocurrenciaInicio: '2026-10-20T13:00:00Z' }),
      ZONA,
      'reprogramar',
    );
    expect(error.mensaje).toContain('No se movio ningun turno');
    expect(error.mensaje).toContain('20/10/2026');
    expect(error.mensaje).not.toContain('reservo');
    expect(traducirErrorSerie(problema(409, 'conflict'), ZONA, 'reprogramar').mensaje).toContain(
      'No se movio nada',
    );
  });

  it('la clave reusada pide reintentar con otra', () => {
    expect(traducirErrorSerie(problema(409, 'idempotency-key-conflict')).accion).toBe(
      'reintentar-con-clave-nueva',
    );
  });
});

describe('horarioDesplazado', () => {
  it('corre cada turno lo mismo que el pivote, en hora local de la sede', () => {
    // Pivote: lunes 12/10 09:00 -> martes 13/10 10:00 (Cordoba, UTC-3): +1 dia y +1 hora.
    const pivote = '2026-10-12T12:00:00Z';
    const nuevo = '2026-10-13T13:00:00Z';
    expect(horarioDesplazado('2026-10-26T12:00:00Z', pivote, nuevo, ZONA)).toBe(
      'martes, 27 de octubre, 10:00',
    );
    // Un turno movido a mano a las 11:00 conserva su diferencia.
    expect(horarioDesplazado('2026-10-19T14:00:00Z', pivote, nuevo, ZONA)).toContain('12:00');
    expect(horarioDesplazado(undefined, pivote, nuevo, ZONA)).toBe('');
  });
});
