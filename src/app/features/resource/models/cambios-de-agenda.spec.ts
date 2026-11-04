import {
  GRUPOS_DE_TIPO,
  grupoDeTipo,
  nombreDeRol,
  textoDeTipo,
  tiposDeGrupos,
} from './cambios-de-agenda';

describe('cambios de la agenda', () => {
  it('cada tipo con texto pertenece a exactamente un grupo, y ninguno se repite', () => {
    const todos = GRUPOS_DE_TIPO.flatMap((grupo) => [...grupo.tipos]);
    expect(new Set(todos).size).toBe(todos.length);
    for (const tipo of todos) {
      expect(textoDeTipo(tipo)).not.toBe(tipo);
      expect(grupoDeTipo(tipo)).toBeDefined();
    }
    expect(grupoDeTipo('TURNO_TRASLADO')?.etiqueta).toBe('Turnos');
    expect(grupoDeTipo('OTRO')).toBeUndefined();
    expect(grupoDeTipo(undefined)).toBeUndefined();
  });

  it('un tipo o un rol que no conocemos se muestra crudo, nunca en blanco', () => {
    expect(textoDeTipo('TIPO_NUEVO')).toBe('TIPO_NUEVO');
    expect(textoDeTipo(undefined)).toBe('Cambio');
    expect(nombreDeRol('ROL_NUEVO')).toBe('ROL_NUEVO');
    expect(nombreDeRol('CONSULTORIO_ADMIN')).toBe('Administrador de sede');
    expect(nombreDeRol(undefined)).toBe('');
  });

  it('los grupos elegidos se expanden a sus codigos; sin grupos es "todos"', () => {
    expect(tiposDeGrupos([])).toEqual([]);
    expect(tiposDeGrupos(['Horario habitual'])).toEqual([
      'HORARIO_ALTA',
      'HORARIO_EDICION',
      'HORARIO_BAJA',
    ]);
    expect(tiposDeGrupos(['Cierres y aperturas', 'Turnos'])).toHaveLength(11);
  });
});
