import { LlamadaDeHerramientaDelAsistente } from '../../../../api/generated/model/llamada-de-herramienta-del-asistente';
import { RespuestaAsistenteResponse } from '../../../../api/generated/model/respuesta-asistente-response';
import { pasoDelAgente, personasDeLaRespuesta } from './charla-del-asistente';

function llamada(
  parcial: Partial<LlamadaDeHerramientaDelAsistente>,
): LlamadaDeHerramientaDelAsistente {
  return {
    herramienta: 'turnos',
    sinPermiso: false,
    filas: 0,
    ...parcial,
  } as LlamadaDeHerramientaDelAsistente;
}

function respuesta(parcial: Partial<RespuestaAsistenteResponse>): RespuestaAsistenteResponse {
  return {
    texto: '',
    resultado: 'RESPONDIDA',
    filas: [],
    opciones: [],
    advertencias: [],
    herramientas: [],
    ...parcial,
  } as unknown as RespuestaAsistenteResponse;
}

describe('pasoDelAgente', () => {
  it('usaLaEtiquetaConocidaYCompactaLaEntrada', () => {
    const paso = pasoDelAgente(
      llamada({
        herramienta: 'practicas_aplicadas',
        filas: 3,
        entrada: {
          practica: 'TENS',
          desde: null,
          hasta: '',
          persona_id: undefined,
          ids: [1, 2],
          datos: { a: 1 },
        },
      }),
    );

    expect(paso.etiqueta).toBe('Prácticas aplicadas');
    expect(paso.entrada).toBe('practica: TENS · ids: 1, 2 · datos: {"a":1}');
    expect(paso.filas).toBe(3);
    expect(paso.sinPermiso).toBe(false);
  });

  it('herramientaDesconocidaSinEntradaYSinPermiso', () => {
    const paso = pasoDelAgente(
      llamada({ herramienta: 'algo_nuevo', sinPermiso: true, entrada: undefined }),
    );

    expect(paso.etiqueta).toBe('algo nuevo');
    expect(paso.entrada).toBe('');
    expect(paso.sinPermiso).toBe(true);
  });
});

describe('personasDeLaRespuesta', () => {
  it('juntaOpcionesEnlaceFilasYTextoSinRepetir', () => {
    const ids = personasDeLaRespuesta(
      respuesta({
        opciones: [{ personaId: 7, etiqueta: 'Pérez, Juan' }],
        enlace: '/pacientes/8',
        filas: [{ persona_id: 9 }, { personaId: '10' }, { persona_id: 7 }, { nombre: 'sin id' }],
        texto: 'Ver [Ana](/pacientes/11).',
      }),
    );

    expect(ids).toEqual([7, 8, 9, 10, 11]);
  });

  it('descartaIdsInvalidosYEnlacesQueNoSonDePersona', () => {
    const ids = personasDeLaRespuesta(
      respuesta({
        enlace: '/agenda/recepcion',
        filas: [{ persona_id: -1 }, { persona_id: 'abc' }, { persona_id: 1.5 }, { persona_id: 0 }],
      }),
    );

    expect(ids).toEqual([]);
  });

  it('cortaEnDiezPersonas', () => {
    const filas = Array.from({ length: 15 }, (_, i) => ({ persona_id: i + 1 }));

    expect(personasDeLaRespuesta(respuesta({ filas }))).toHaveLength(10);
  });
});
