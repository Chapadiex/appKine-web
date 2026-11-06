import { AkineHttpError, ProblemDetail } from '../interceptors/error.interceptor';
import { ProblemDetailConflictoTipoEnum as Tipo } from '../../api/generated/model/problem-detail';
import {
  clasesDelRechazo,
  conflictoDelProblema,
  conflictoEnOtraSede,
  describirConflicto,
  sedeDelConflicto,
  superposicionesDelProblema,
} from './conflicto-de-agenda';

function problema(tipo: string, extras: Record<string, unknown>): AkineHttpError {
  return new AkineHttpError(
    409,
    { type: `https://akine.app/problems/${tipo}`, status: 409, ...extras } as ProblemDetail,
    false,
  );
}

const hora = (instante: string): string => instante.slice(11, 16);

describe('conflicto de agenda (0.158.0)', () => {
  it('lee solo las extensiones con la forma esperada', () => {
    const conflicto = conflictoDelProblema(
      problema('recurso-ocupado', {
        conflictoTipo: 'CLASE',
        conflictoConsultorioId: 8,
        conflictoConsultorioNombre: '',
        conflictoMismaSede: 'no',
        instructorNombre: 'Paz, Ana',
      }),
    );

    expect(conflicto).toEqual({
      conflictoTipo: 'CLASE',
      conflictoConsultorioId: 8,
      instructorNombre: 'Paz, Ana',
    });
    expect(conflictoDelProblema(null)).toEqual({});
  });

  it('la bandera del servidor decide si es otra sede; sin ella, los ids', () => {
    expect(conflictoEnOtraSede({ conflictoMismaSede: true, conflictoConsultorioId: 8 }, 3)).toBe(
      false,
    );
    expect(conflictoEnOtraSede({ conflictoConsultorioId: 8 }, 3)).toBe(true);
    expect(conflictoEnOtraSede({ conflictoConsultorioId: 3 }, 3)).toBe(false);
    expect(conflictoEnOtraSede({}, 3)).toBe(false);
  });

  it('nombra la sede del servidor, o la de los contextos', () => {
    expect(sedeDelConflicto({ conflictoConsultorioNombre: 'Norte' }, {})).toBe('Norte');
    expect(
      sedeDelConflicto({ conflictoConsultorioId: 8 }, { nombreDeSede: (id) => `Sede ${id}` }),
    ).toBe('Sede 8');
    expect(sedeDelConflicto({ conflictoConsultorioId: 8 }, {})).toBe('');
  });

  it('describe causa, sede, franja e instructor; nunca supone "otra sede"', () => {
    const forma = { hora, consultorioActual: 3 };

    expect(
      describirConflicto(
        {
          conflictoTipo: Tipo.BLOQUEO,
          conflictoConsultorioNombre: 'Centro',
          conflictoInicio: '2030-03-04T10:00:00Z',
          conflictoFin: '2030-03-04T12:00:00Z',
          instructorNombre: 'Paz, Ana',
        },
        { ...forma, fecha: (instante) => instante.slice(0, 10) },
      ),
    ).toBe('Agenda bloqueada en la sede Centro, 2030-03-04 de 10:00 a 12:00 · instructor Paz, Ana');
    expect(
      describirConflicto(
        {
          conflictoTipo: Tipo.DISPONIBILIDAD,
          conflictoConsultorioNombre: 'Centro',
          conflictoFecha: '2030-03-04',
          conflictoHoraDesde: '09:00',
          conflictoHoraHasta: '13:00',
        },
        forma,
      ),
    ).toBe('Horario de atención en la sede Centro, 04/03/2030 de 09:00 a 13:00');
    // Otra sede sin nombre: vacio, para que quien muestra use el detail del servidor.
    expect(
      describirConflicto(
        { conflictoTipo: Tipo.TURNO, conflictoConsultorioId: 8, conflictoInicio: 'x' },
        forma,
      ),
    ).toBe('');
    expect(describirConflicto({ conflictoTipo: Tipo.TURNO }, forma)).toBe('');
    expect(describirConflicto({}, forma)).toBe('');
  });

  it('lee las superposiciones de una apertura y las clases afectadas de un cierre', () => {
    const solapado = problema('bloque-solapado', {
      superposiciones: [
        { conflictoTipo: 'DISPONIBILIDAD', conflictoConsultorioNombre: 'Centro' },
        'basura',
      ],
    });
    expect(superposicionesDelProblema(solapado)).toEqual([
      { conflictoTipo: 'DISPONIBILIDAD', conflictoConsultorioNombre: 'Centro' },
    ]);
    expect(superposicionesDelProblema(new Error('x'))).toEqual([]);

    const cierre = problema('bloqueo-con-turnos-afectados', {
      clases: [
        { claseId: 4, instructorMembershipId: 21, inicio: 'a', fin: 'b' },
        { claseId: 5, inicio: 'c', fin: 'd' },
        { claseId: 'x' },
      ],
    });
    expect(clasesDelRechazo(cierre)).toEqual([
      { claseId: 4, instructorMembershipId: 21, inicio: 'a', fin: 'b' },
      { claseId: 5, inicio: 'c', fin: 'd' },
    ]);
    expect(clasesDelRechazo(solapado)).toEqual([]);
  });
});
