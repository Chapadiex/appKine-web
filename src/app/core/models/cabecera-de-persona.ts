import { PersonaResponse } from '../../api/generated/model/persona-response';
import type { ModeloDeCabeceraDeFicha } from '../../shared/components/cabecera-de-ficha/cabecera-de-ficha';
import type { Pestana } from '../../shared/components/pestanas/pestanas';
import {
  PERMISO_COBRO_REGISTER,
  PERMISO_HC_READ,
  PERMISO_PACIENTE_READ,
  PERMISO_PASE_READ,
} from './permisos';

/**
 * La banda de la persona y las pestanas del "hub" de la ficha (UX-01), en un solo lugar.
 *
 * <p>La usan cuatro features -person, billing, activity y clinical- que no pueden importarse
 * entre si (ADR-0004). Antes cada una tenia su copia del componente, y las copias ya diferian en
 * que pestana ofrecian siempre. La regla sube a `core/models` como pide la ADR para lo comun con
 * dominio; el dibujo es `shared/components/cabecera-de-ficha`, que no sabe que es una persona.
 *
 * <p><b>No muestra nada clinico.</b> "Historia clínica" es un enlace a la pantalla del modulo
 * clinico, que pide el motivo y audita; se ofrece a un paciente y a quien tiene `hc:read`.
 * Los permisos son UX: el backend decide igual.
 */

/** La pantalla del hub en la que esta el usuario. Esa pestana se ofrece siempre. */
export type PantallaDePersona =
  | 'ficha'
  | 'historia'
  | 'documentos'
  | 'coberturas'
  | 'autorizaciones'
  | 'cuenta-corriente'
  | 'pases';

export interface DatosDeCabeceraDePersona {
  readonly personaId: string;

  /** La ficha, si la pantalla ya la cargo. La banda no pide nada propio. */
  readonly persona: PersonaResponse | null;

  readonly actual: PantallaDePersona;

  /** Nombre y documento cuando la pantalla no tiene la ficha (la historia clinica los trae). */
  readonly nombreAlternativo?: string | null;

  readonly documentoAlternativo?: string | null;

  /** Si la pantalla sabe que es paciente sin tener la ficha. */
  readonly esPaciente?: boolean | null;
}

/** Las pantallas del padron: se llega con `paciente:read`, asi que en ellas se ofrece siempre. */
const PANTALLAS_DEL_PADRON: readonly PantallaDePersona[] = [
  'ficha',
  'documentos',
  'coberturas',
  'autorizaciones',
];

const ETIQUETAS_DE_DOCUMENTO: Readonly<Record<string, string>> = {
  DNI: 'DNI',
  LC: 'Libreta cívica',
  LE: 'Libreta de enrolamiento',
  CI: 'Cédula de identidad',
  PASAPORTE: 'Pasaporte',
  OTRO: 'Otro documento',
};

/**
 * El documento en una linea. "Sin documento" no es un dato faltante: una persona sin DNI es un
 * caso previsto, y un hueco invita a inventar un numero.
 */
export function documentoDePersona(persona: PersonaResponse): string {
  if (persona.tipoDocumento === undefined || persona.numeroDocumento === undefined) {
    return 'Sin documento';
  }
  const tipo = ETIQUETAS_DE_DOCUMENTO[persona.tipoDocumento] ?? persona.tipoDocumento;
  return `${tipo} ${persona.numeroDocumento}`;
}

/** Apellido y nombre, en el orden en que se busca a alguien en un mostrador. */
export function nombreDePersona(persona: PersonaResponse): string {
  return `${persona.apellido}, ${persona.nombre}`;
}

/** Arma lo que dibuja la banda. `tiene` es la consulta de permisos de la sesion. */
export function modeloDeCabeceraDePersona(
  datos: DatosDeCabeceraDePersona,
  tiene: (permiso: string) => boolean,
): ModeloDeCabeceraDeFicha {
  const { personaId, persona, actual } = datos;
  const rutaFicha = `/pacientes/${personaId}`;
  // Sin `paciente:read` las pantallas del padron responden "sin permiso": no se ofrecen.
  const padron = PANTALLAS_DEL_PADRON.includes(actual) || tiene(PERMISO_PACIENTE_READ);
  const paciente = datos.esPaciente ?? persona?.esPaciente === true;

  const pestanas: Pestana[] = [];
  if (padron) {
    pestanas.push({ etiqueta: 'Ficha', ruta: rutaFicha, exacta: true });
  }
  if (paciente && (actual === 'historia' || tiene(PERMISO_HC_READ))) {
    pestanas.push({
      etiqueta: 'Historia clínica',
      ruta: `/historia-clinica/personas/${personaId}`,
    });
  }
  if (padron) {
    pestanas.push(
      { etiqueta: 'Documentos', ruta: `${rutaFicha}/documentos` },
      { etiqueta: 'Coberturas', ruta: `${rutaFicha}/coberturas` },
      { etiqueta: 'Órdenes y autorizaciones', ruta: `${rutaFicha}/autorizaciones` },
    );
  }
  if (actual === 'cuenta-corriente' || tiene(PERMISO_COBRO_REGISTER)) {
    pestanas.push({ etiqueta: 'Cuenta corriente', ruta: `${rutaFicha}/cuenta-corriente` });
  }
  if (actual === 'pases' || tiene(PERMISO_PASE_READ)) {
    pestanas.push({ etiqueta: 'Pases', ruta: `${rutaFicha}/pases` });
  }

  const documento = persona ? documentoDePersona(persona) : (datos.documentoAlternativo ?? null);
  const inactiva = persona?.estado === 'INACTIVO';
  return {
    migas: padron ? [{ etiqueta: 'Padrón', ruta: '/pacientes' }] : [],
    titulo: persona ? nombreDePersona(persona) : datos.nombreAlternativo || 'Ficha de la persona',
    rutaTitulo: padron ? rutaFicha : null,
    datos: documento ? [documento] : [],
    marcas: persona
      ? [
          { texto: inactiva ? 'Dada de baja' : 'Activa', tono: inactiva ? 'revocada' : 'activa' },
          { texto: persona.esPaciente ? 'Paciente' : 'Persona', tono: 'neutra' },
        ]
      : [],
    pestanas,
    etiquetaPestanas: 'Secciones de la persona',
  };
}
