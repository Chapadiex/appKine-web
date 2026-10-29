import { PersonaResponse } from '../../api/generated/model/persona-response';
import { migasDePersona, modeloDeCabeceraDePersona } from './cabecera-de-persona';
import {
  PERMISO_COBRO_REGISTER,
  PERMISO_HC_READ,
  PERMISO_PACIENTE_READ,
  PERMISO_PASE_READ,
} from './permisos';

const PACIENTE = {
  id: '7',
  apellido: 'Sintetica',
  nombre: 'Lucia',
  tipoDocumento: 'DNI',
  numeroDocumento: '30111222',
  estado: 'ACTIVO',
  esPaciente: true,
} as unknown as PersonaResponse;

const con =
  (...permisos: string[]) =>
  (permiso: string) =>
    permisos.includes(permiso);

const etiquetas = (m: ReturnType<typeof modeloDeCabeceraDePersona>) =>
  m.pestanas.map((p) => p.etiqueta);

describe('modeloDeCabeceraDePersona', () => {
  it('en la ficha, con todos los permisos, ofrece el hub completo y la persona arriba', () => {
    const m = modeloDeCabeceraDePersona(
      { personaId: '7', persona: PACIENTE, actual: 'ficha' },
      con(PERMISO_HC_READ, PERMISO_COBRO_REGISTER, PERMISO_PASE_READ),
    );
    expect(etiquetas(m)).toEqual([
      'Ficha',
      'Historia clínica',
      'Documentos',
      'Coberturas',
      'Órdenes y autorizaciones',
      'Cuenta corriente',
      'Pases',
    ]);
    expect(m.titulo).toBe('Sintetica, Lucia');
    expect(m.datos).toEqual(['DNI 30111222']);
    expect(m.marcas.map((x) => x.texto)).toEqual(['Activa', 'Paciente']);
    // En la ficha el nombre es la pantalla actual de la ruta de navegacion.
    expect(migasDePersona({ personaId: '7', persona: PACIENTE, actual: 'ficha' }, con())).toEqual([
      { etiqueta: 'Padrón', ruta: '/pacientes' },
      { etiqueta: 'Sintetica, Lucia' },
    ]);
  });

  it('en una pestana el nombre lleva a la ficha y la pantalla agrega sus pasos', () => {
    expect(
      migasDePersona(
        {
          personaId: '7',
          persona: PACIENTE,
          actual: 'cuenta-corriente',
          masMigas: [{ etiqueta: 'Cuenta corriente', ruta: '/pacientes/7/cuenta-corriente' }],
        },
        con(PERMISO_PACIENTE_READ),
      ),
    ).toEqual([
      { etiqueta: 'Padrón', ruta: '/pacientes' },
      { etiqueta: 'Sintetica, Lucia', ruta: '/pacientes/7' },
      { etiqueta: 'Cuenta corriente', ruta: '/pacientes/7/cuenta-corriente' },
    ]);
    // Sin la ficha cargada todavia, el nombre no se inventa.
    expect(migasDePersona({ personaId: '7', persona: null, actual: 'coberturas' }, con())).toEqual([
      { etiqueta: 'Padrón', ruta: '/pacientes' },
    ]);
  });

  it('sin hc:read no ofrece la historia clinica, y a una persona que no es paciente tampoco', () => {
    const sinPermiso = modeloDeCabeceraDePersona(
      { personaId: '7', persona: PACIENTE, actual: 'ficha' },
      con(),
    );
    expect(etiquetas(sinPermiso)).not.toContain('Historia clínica');

    const persona = { ...PACIENTE, esPaciente: false } as PersonaResponse;
    const noPaciente = modeloDeCabeceraDePersona(
      { personaId: '7', persona, actual: 'ficha' },
      con(PERMISO_HC_READ),
    );
    expect(etiquetas(noPaciente)).not.toContain('Historia clínica');
    expect(noPaciente.marcas[1].texto).toBe('Persona');
  });

  it('fuera del padron y sin paciente:read no ofrece la ficha, ni migas, ni enlace en el nombre', () => {
    const m = modeloDeCabeceraDePersona(
      { personaId: '7', persona: PACIENTE, actual: 'cuenta-corriente' },
      con(),
    );
    expect(etiquetas(m)).toEqual(['Cuenta corriente']);
    expect(
      migasDePersona({ personaId: '7', persona: PACIENTE, actual: 'cuenta-corriente' }, con()),
    ).toEqual([]);
    expect(m.rutaTitulo).toBeNull();
  });

  it('la pantalla actual se ofrece siempre, aunque falte su permiso', () => {
    const pases = modeloDeCabeceraDePersona(
      { personaId: '7', persona: PACIENTE, actual: 'pases' },
      con(PERMISO_PACIENTE_READ),
    );
    expect(etiquetas(pases)).toContain('Pases');
    expect(etiquetas(pases)).not.toContain('Cuenta corriente');
  });

  it('sin la ficha usa el nombre y el documento que trae la pantalla', () => {
    const m = modeloDeCabeceraDePersona(
      {
        personaId: '7',
        persona: null,
        actual: 'historia',
        nombreAlternativo: 'Sintetica, Lucia',
        documentoAlternativo: 'DNI 30111222',
        esPaciente: true,
      },
      con(),
    );
    expect(m.titulo).toBe('Sintetica, Lucia');
    expect(m.datos).toEqual(['DNI 30111222']);
    expect(m.marcas).toEqual([]);
    expect(etiquetas(m)).toEqual(['Historia clínica']);
  });

  it('una persona sin documento dice "Sin documento" y una dada de baja lo marca', () => {
    const persona = {
      ...PACIENTE,
      tipoDocumento: undefined,
      numeroDocumento: undefined,
      estado: 'INACTIVO',
    } as unknown as PersonaResponse;
    const m = modeloDeCabeceraDePersona({ personaId: '7', persona, actual: 'ficha' }, con());
    expect(m.datos).toEqual(['Sin documento']);
    expect(m.marcas[0]).toEqual({ texto: 'Dada de baja', tono: 'revocada' });
  });
});
