import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import {
  avisoDeExcepcion,
  avisoDeHorarioDeSede,
  avisoDeTurnosAfectados,
  impactoDelRechazo,
  notaDeListaRecortada,
  resumenDeImpacto,
  turnosPrevistos,
} from './turnos-afectados';

const CON_TURNOS = 'https://akine.app/problems/bloqueo-con-turnos-afectados';

/**
 * Los textos del impacto de un cambio de disponibilidad (A-11) y la lectura del 409 que, desde el
 * contrato 0.154.0, trae la lista de turnos que el cambio deja afuera.
 */
describe('turnos-afectados', () => {
  describe('impactoDelRechazo', () => {
    it('lee la cuenta y la lista del 409, y descarta lo que no es un turno', () => {
      const error = new AkineHttpError(
        409,
        {
          type: CON_TURNOS,
          turnosAfectados: 3,
          turnos: [{ turnoId: 1 }, null, 'basura', { turnoId: 2 }],
        } as never,
        false,
      );

      expect(impactoDelRechazo(error)).toEqual({
        turnosAfectados: 3,
        turnos: [{ turnoId: 1 }, { turnoId: 2 }],
      });
    });

    it('sin cuenta usa el largo de la lista', () => {
      const error = new AkineHttpError(
        409,
        { type: CON_TURNOS, turnos: [{ turnoId: 1 }] } as never,
        false,
      );
      expect(impactoDelRechazo(error)?.turnosAfectados).toBe(1);
    });

    it('un backend anterior a 0.154.0 (sin lista), otro 409 u otro error no son esto', () => {
      expect(
        impactoDelRechazo(new AkineHttpError(409, { type: CON_TURNOS } as never, false)),
      ).toBeNull();
      expect(
        impactoDelRechazo(
          new AkineHttpError(
            409,
            { type: 'https://akine.app/problems/concurrent-modification' } as never,
            false,
          ),
        ),
      ).toBeNull();
      expect(impactoDelRechazo(new Error('red'))).toBeNull();
    });
  });

  it('turnosPrevistos solo cuenta cuando la consulta terminó', () => {
    expect(turnosPrevistos(null)).toBeNull();
    expect(turnosPrevistos({ tipo: 'consultando' })).toBeNull();
    expect(turnosPrevistos({ tipo: 'listo', impacto: {} })).toBe(0);
    expect(turnosPrevistos({ tipo: 'listo', impacto: { turnosAfectados: 4 } })).toBe(4);
  });

  it('resumenDeImpacto dice que no se cancela nada, en singular y en plural', () => {
    expect(resumenDeImpacto({})).toBe(
      'Ningún turno pendiente queda fuera de horario con este cambio.',
    );
    expect(resumenDeImpacto({ turnosAfectados: 1 })).toContain('1 turno pendiente queda');
    expect(resumenDeImpacto({ turnosAfectados: 2 })).toContain('2 turnos pendientes quedan');
  });

  it('notaDeListaRecortada solo aparece si la lista trae menos que la cuenta', () => {
    expect(notaDeListaRecortada({ turnosAfectados: 3, turnos: [] })).toBeNull();
    expect(notaDeListaRecortada({ turnosAfectados: 1, turnos: [{}] })).toBeNull();
    expect(notaDeListaRecortada({ turnosAfectados: 5, turnos: [{}, {}] })).toBe(
      'Se muestran los primeros 2 de 5, por fecha.',
    );
  });

  it('avisoDeTurnosAfectados avisa la diferencia con la consulta previa', () => {
    expect(avisoDeTurnosAfectados(0)).toBeNull();
    expect(avisoDeTurnosAfectados(undefined, 0)).toBeNull();
    expect(avisoDeTurnosAfectados(1)).toContain('1 turno pendiente de este profesional');
    expect(avisoDeTurnosAfectados(1)).toContain('quedo fuera');
    expect(avisoDeTurnosAfectados(2, 2)).not.toContain('consulta previa');
    expect(avisoDeTurnosAfectados(3, 2)).toContain('La consulta previa habia calculado 2');
    // Habia previstos y al confirmar ya no quedaba ninguno: tambien se explica.
    const ninguno = avisoDeTurnosAfectados(0, 2);
    expect(ninguno).toContain('Ningún turno pendiente');
    expect(ninguno).toContain('habia calculado 2');
  });

  it('avisoDeExcepcion y avisoDeHorarioDeSede callan sin turnos', () => {
    expect(avisoDeExcepcion(null)).toBeNull();
    expect(avisoDeExcepcion(0)).toBeNull();
    expect(avisoDeExcepcion(1)).toContain('1 turno pendiente quedaba');
    expect(avisoDeExcepcion(3)).toContain('3 turnos pendientes quedaban');

    expect(avisoDeHorarioDeSede(null)).toBeNull();
    expect(avisoDeHorarioDeSede({ turnosAfectados: 0 })).toBeNull();
    expect(avisoDeHorarioDeSede({ turnosAfectados: 1 })).toContain('1 turno queda');
    expect(avisoDeHorarioDeSede({ turnosAfectados: 4 })).toContain('4 turnos quedan');
  });
});
