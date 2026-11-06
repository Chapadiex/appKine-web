/**
 * Paises y provincias que ofrece el alta de sede (M03, alta de sede con ubicacion, 05/11/2026).
 *
 * <p>Codigos ISO 3166-1 alfa-2, que es lo que el backend guarda y lo que el geocodificador
 * recibe como `countrycodes`. La lista es corta a proposito: AKINE se vende en Argentina y en la
 * region; un centro en otro pais elige "Otro" y escribe el codigo. El nombre se muestra en
 * castellano porque el selector es para humanos.
 */
export interface Pais {
  readonly codigo: string;
  readonly nombre: string;
}

export const PAIS_POR_DEFECTO = 'AR';

export const PAISES: readonly Pais[] = [
  { codigo: 'AR', nombre: 'Argentina' },
  { codigo: 'UY', nombre: 'Uruguay' },
  { codigo: 'PY', nombre: 'Paraguay' },
  { codigo: 'CL', nombre: 'Chile' },
  { codigo: 'BO', nombre: 'Bolivia' },
  { codigo: 'BR', nombre: 'Brasil' },
  { codigo: 'PE', nombre: 'Perú' },
  { codigo: 'EC', nombre: 'Ecuador' },
  { codigo: 'CO', nombre: 'Colombia' },
  { codigo: 'VE', nombre: 'Venezuela' },
  { codigo: 'MX', nombre: 'México' },
  { codigo: 'ES', nombre: 'España' },
  { codigo: 'US', nombre: 'Estados Unidos' },
];

/** Provincias argentinas, con la Ciudad Autonoma primero por ser la mas elegida. */
export const PROVINCIAS_ARGENTINAS: readonly string[] = [
  'Ciudad Autónoma de Buenos Aires',
  'Buenos Aires',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán',
];

/** El nombre de un pais a partir de su codigo, o el codigo si no esta en la lista. */
export function nombreDePais(codigo: string | null | undefined): string {
  if (codigo === null || codigo === undefined || codigo === '') {
    return '';
  }
  const mayusculas = codigo.toUpperCase();
  return PAISES.find((pais) => pais.codigo === mayusculas)?.nombre ?? mayusculas;
}
