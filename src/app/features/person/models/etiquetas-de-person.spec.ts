import { PersonaResponse } from '../../../api/generated/model/persona-response';
import {
  documentoEnUnaLinea,
  etiquetaDePerfil,
  etiquetaDeTipoDocumento,
  nombreCompleto,
  perfilEnPalabras,
  personaInactiva,
} from './etiquetas-de-person';

/**
 * Spec de la redaccion del padron (M07, AKINE-03.01).
 *
 * <p>Prueba <b>textos</b>, que suena trivial y no lo es: las dos decisiones que este archivo
 * sostiene —que "sin documento" no se muestre como un hueco, y que la columna negativa no diga
 * "pendiente"— existen para no empujar al operador a hacer algo incorrecto. Un cambio de
 * redaccion que las pierda no rompe ningun test de pantalla.
 */
describe('etiquetas de person', () => {
  it('una persona sin documento lo dice con palabras, no con una celda vacia', () => {
    // Un guion o un hueco invitan a "completarlo" inventando un numero, que contamina el padron
    // con claves que despues chocan de verdad.
    expect(documentoEnUnaLinea(persona({}))).toBe('Sin documento');
    // Tipo sin numero tampoco es un documento: el par es indivisible.
    expect(documentoEnUnaLinea(persona({ tipoDocumento: 'DNI' }))).toBe('Sin documento');
  });

  it('un documento cargado se muestra con el tipo en palabras', () => {
    expect(
      documentoEnUnaLinea(persona({ tipoDocumento: 'PASAPORTE', numeroDocumento: 'AB123456' })),
    ).toBe('Pasaporte AB123456');
  });

  it('un tipo que el catalogo no conoce se muestra tal cual en vez de desaparecer', () => {
    // El contrato puede sumar un tipo antes que esta tabla. Mostrar el codigo crudo es peor que
    // mostrar nada solo en apariencia: nada seria un dato perdido.
    expect(etiquetaDeTipoDocumento('LIBRETA_NUEVA')).toBe('LIBRETA_NUEVA');
    expect(etiquetaDeTipoDocumento(undefined)).toBe('');
  });

  it('la columna de perfil no llama "pendiente" a quien no es paciente', () => {
    expect(etiquetaDePerfil(persona({ esPaciente: false }))).toBe('Persona');
    expect(etiquetaDePerfil(persona({ esPaciente: true }))).toBe('Paciente');
  });

  it('el detalle del perfil aclara que ser paciente no implica tener historia clinica', () => {
    expect(perfilEnPalabras(persona({ esPaciente: true }))).toContain('historia clinica es otra');
    expect(perfilEnPalabras(persona({ esPaciente: false }))).toContain('actividades no clinicas');
  });

  it('el nombre se arma como se busca a alguien en un mostrador', () => {
    expect(nombreCompleto(persona({}))).toBe('Perez, Ana Maria');
  });

  it('reconoce la ficha dada de baja', () => {
    expect(personaInactiva(persona({ estado: 'INACTIVO' }))).toBe(true);
    expect(personaInactiva(persona({}))).toBe(false);
  });
});

function persona(cambios: Partial<Record<keyof PersonaResponse, unknown>>): PersonaResponse {
  return {
    id: 1,
    apellido: 'Perez',
    nombre: 'Ana Maria',
    esPaciente: false,
    estado: 'ACTIVO',
    version: 0,
    ...cambios,
  } as PersonaResponse;
}
