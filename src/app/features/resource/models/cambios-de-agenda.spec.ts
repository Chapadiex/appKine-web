import { CambioDeAgendaTipoEnum } from '../../../api/generated/model/cambio-de-agenda';
import {
  GRUPOS_DE_TIPO,
  armarParametros,
  grupoDeTipo,
  nombreDeRol,
  textoDeTipo,
  tiposDeGrupos,
} from './cambios-de-agenda';

describe('cambios de la agenda', () => {
  it('los grupos cubren todo el enum, cada tipo una sola vez y con texto', () => {
    const todos = GRUPOS_DE_TIPO.flatMap((grupo) => [...grupo.tipos]);
    expect(new Set(todos).size).toBe(todos.length);
    expect([...todos].sort()).toEqual(Object.values(CambioDeAgendaTipoEnum).sort());
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
    expect(nombreDeRol('ADMINISTRATIVO')).toBe('Administrativo');
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

  it('las fechas son dias de la sede: hasta incluido viaja como la medianoche siguiente, exclusiva', () => {
    const parametros = armarParametros({
      orgId: 1,
      profesionalId: 42,
      consultorioId: 3,
      grupos: ['Horario habitual'],
      desde: '2026-11-01',
      hasta: '2026-11-03',
      q: '  ',
      page: 2,
      size: 10,
      sort: 'ocurridoEn,asc',
      zona: 'America/Argentina/Cordoba',
    });
    expect(parametros).toEqual({
      orgId: 1,
      profesionalId: 42,
      consultorioId: 3,
      tipo: ['HORARIO_ALTA', 'HORARIO_EDICION', 'HORARIO_BAJA'],
      desde: '2026-11-01T03:00:00.000Z',
      hasta: '2026-11-04T03:00:00.000Z',
      q: undefined,
      page: 2,
      size: 10,
      sort: 'ocurridoEn,asc',
    });
  });

  it('sin filtros no manda tipo, sede ni fechas', () => {
    const parametros = armarParametros({
      orgId: 1,
      profesionalId: 42,
      consultorioId: null,
      grupos: [],
      desde: '',
      hasta: 'no es fecha',
      q: ' motivo ',
      page: 0,
      size: 10,
      sort: undefined,
      zona: '',
    });
    expect(parametros.tipo).toBeUndefined();
    expect(parametros.consultorioId).toBeUndefined();
    expect(parametros.desde).toBeUndefined();
    expect(parametros.hasta).toBeUndefined();
    expect(parametros.q).toBe('motivo');
  });
});
