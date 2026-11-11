import { FiltroActividad, FiltroPerfil } from '../services/person-api';

/**
 * Filtro "Tipo de persona" del padrón (10/11/2026): una sola elección para el mostrador, que el
 * backend recibe como dos filtros independientes, `perfil` y `actividad`.
 *
 * <p>Paciente de kinesiología = perfil clínico vigente. De actividades = hoy tiene una inscripción
 * a una clase que no terminó, o un pase o abono vigente. Una persona puede ser las dos cosas.
 */
export type TipoDePersona = 'TODAS' | 'PACIENTES' | 'ACTIVIDADES' | 'AMBAS' | 'SIN_PERFIL';

export const TIPOS_DE_PERSONA: readonly {
  readonly valor: TipoDePersona;
  readonly etiqueta: string;
  readonly perfil: FiltroPerfil;
  readonly actividad: FiltroActividad;
}[] = [
  { valor: 'TODAS', etiqueta: 'Todas', perfil: 'TODOS', actividad: 'TODOS' },
  {
    valor: 'PACIENTES',
    etiqueta: 'Pacientes de kinesiología',
    perfil: 'CON_PERFIL',
    actividad: 'TODOS',
  },
  {
    valor: 'ACTIVIDADES',
    etiqueta: 'Hacen actividades',
    perfil: 'TODOS',
    actividad: 'CON_ACTIVIDAD',
  },
  {
    valor: 'AMBAS',
    etiqueta: 'Pacientes que además hacen actividades',
    perfil: 'CON_PERFIL',
    actividad: 'CON_ACTIVIDAD',
  },
  {
    valor: 'SIN_PERFIL',
    etiqueta: 'No son pacientes',
    perfil: 'SIN_PERFIL',
    actividad: 'TODOS',
  },
];

/** Los dos filtros del backend para el tipo elegido. */
export function filtrosDeTipo(tipo: TipoDePersona): {
  readonly perfil: FiltroPerfil;
  readonly actividad: FiltroActividad;
} {
  return TIPOS_DE_PERSONA.find((opcion) => opcion.valor === tipo) ?? TIPOS_DE_PERSONA[0];
}
