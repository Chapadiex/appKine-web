import { TipoDePersona, filtrosDeTipo } from './tipo-de-persona';

describe('filtrosDeTipo', () => {
  it('traduce cada tipo a los dos filtros del backend', () => {
    expect(filtrosDeTipo('AMBAS')).toMatchObject({
      perfil: 'CON_PERFIL',
      actividad: 'CON_ACTIVIDAD',
    });
    expect(filtrosDeTipo('SIN_PERFIL')).toMatchObject({ perfil: 'SIN_PERFIL', actividad: 'TODOS' });
  });

  it('un tipo desconocido (por ejemplo, de una URL vieja) no filtra nada', () => {
    expect(filtrosDeTipo('OTRO' as TipoDePersona)).toMatchObject({
      perfil: 'TODOS',
      actividad: 'TODOS',
    });
  });
});
