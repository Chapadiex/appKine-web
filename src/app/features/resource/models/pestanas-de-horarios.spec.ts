import { RUTA_HORARIOS_CAMBIOS } from './rutas-de-horarios';
import { pestanasDeHorarios } from './pestanas-de-horarios';

describe('pestanasDeHorarios', () => {
  it('la pestana de cambios aparece solo para quien puede ver el historial', () => {
    expect(pestanasDeHorarios(false).map((p) => p.etiqueta)).toEqual([
      'Horario semanal',
      'Horario efectivo',
    ]);
    const conCambios = pestanasDeHorarios(true);
    expect(conCambios.map((p) => p.etiqueta)).toEqual([
      'Horario semanal',
      'Horario efectivo',
      'Cambios',
    ]);
    expect(conCambios[2].ruta).toBe(RUTA_HORARIOS_CAMBIOS);
  });
});
