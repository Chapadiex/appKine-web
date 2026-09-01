import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { traducirErrorAtencion } from './atencion-errors';

/**
 * Spec del traductor de errores de la atencion (M14, AKINE-06.01 y 06.02).
 *
 * <p>Lo unico que verifica es la <b>causa</b>, que es lo que la pantalla ramifica. Los textos no
 * se fijan: son prosa y cambian cuando alguien corrige una redaccion, y un test que los copie
 * convierte cada correccion editorial en un build roto.
 */
describe('traducirErrorAtencion', () => {
  it.each([
    ['sesion-ajena', 409, 'sesion-ajena'],
    ['turno-no-atendible', 409, 'turno-no-atendible'],
    ['concurrent-modification', 409, 'version-vieja'],
    ['validation-error', 400, 'validacion'],
  ])('mapea %s por problemType, no por el texto de detail', (tipo, status, causa) => {
    // El `detail` dice una cosa distinta a proposito: si el traductor lo mirara, fallaria aca.
    expect(traducirErrorAtencion(problema(tipo, status, 'texto que no dice nada')).causa).toBe(
      causa,
    );
  });

  it('rescata el motivo de turno-no-atendible, que es lo unico accionable del rechazo', () => {
    const error = new AkineHttpError(
      409,
      {
        type: 'https://akine.app/problems/turno-no-atendible',
        status: 409,
        detail: 'No atendible.',
        properties: { motivo: 'El turno esta cancelado' },
      },
      false,
    );

    expect(traducirErrorAtencion(error).motivo).toBe('El turno esta cancelado');
  });

  it('un 403 crudo NO se confunde con sesion-ajena: uno es permiso y el otro propiedad', () => {
    expect(traducirErrorAtencion(problema('forbidden', 403, 'Sin permiso.')).causa).toBe(
      'sin-permiso',
    );
  });

  function problema(tipo: string, status: number, detail: string): AkineHttpError {
    return new AkineHttpError(
      status,
      { type: `https://akine.app/problems/${tipo}`, status, detail },
      false,
    );
  }
});
