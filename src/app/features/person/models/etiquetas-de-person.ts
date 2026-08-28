import { PersonaResponse } from '../../../api/generated/model/persona-response';

/**
 * Como se redacta en pantalla lo que el contrato entrega en crudo (M07, AKINE-03.01).
 *
 * <p>Vive aparte de la pantalla para que las decisiones de redaccion se puedan leer y probar sin
 * montar un componente. Mismo criterio que `etiquetas-de-offering.ts`.
 */

/** Tipos de documento del contrato, en el orden en que se ofrecen. */
export const TIPOS_DE_DOCUMENTO = ['DNI', 'LC', 'LE', 'CI', 'PASAPORTE', 'OTRO'] as const;

export type TipoDeDocumento = (typeof TIPOS_DE_DOCUMENTO)[number];

const ETIQUETAS_DE_DOCUMENTO: Record<string, string> = {
  DNI: 'DNI',
  LC: 'Libreta civica',
  LE: 'Libreta de enrolamiento',
  CI: 'Cedula de identidad',
  PASAPORTE: 'Pasaporte',
  OTRO: 'Otro documento',
};

export function etiquetaDeTipoDocumento(tipo: string | undefined): string {
  return tipo === undefined ? '' : (ETIQUETAS_DE_DOCUMENTO[tipo] ?? tipo);
}

/**
 * El documento en una linea, o el motivo de que no haya.
 *
 * <p><b>"Sin documento" NO es un dato faltante</b>, y por eso se escribe asi y no con un guion o
 * una celda vacia. Una persona sin DNI es un caso legitimo y previsto —un menor, alguien recien
 * llegado, una urgencia—: mostrarlo como un hueco invita al operador a "completarlo" inventando
 * un numero, que es exactamente lo que contamina el padron.
 */
export function documentoEnUnaLinea(persona: PersonaResponse): string {
  if (persona.tipoDocumento === undefined || persona.numeroDocumento === undefined) {
    return 'Sin documento';
  }
  return `${etiquetaDeTipoDocumento(persona.tipoDocumento)} ${persona.numeroDocumento}`;
}

/** Apellido y nombre, en el orden en que se busca a alguien en un mostrador. */
export function nombreCompleto(persona: PersonaResponse): string {
  return `${persona.apellido}, ${persona.nombre}`;
}

/**
 * Que dice la columna de perfil clinico.
 *
 * <p><b>El texto de la columna negativa importa tanto como el de la positiva.</b> Dice "Persona"
 * y no "Sin perfil" ni "Pendiente": alguien que viene a una clase de pilates es una ficha
 * completa y correcta (RN-M07-006), no una a medio cargar. Un "pendiente" empujaria al operador a
 * activarle un perfil clinico para "terminarla", que es justo lo que RF-M07-010 existe para
 * evitar.
 */
export function etiquetaDePerfil(persona: PersonaResponse): string {
  return persona.esPaciente === true ? 'Paciente' : 'Persona';
}

/**
 * Explicacion larga del perfil, para el detalle de la ficha.
 *
 * <p>Dice explicitamente que ser paciente no implica tener historia clinica: la HC es de otro
 * modulo y de otra fase, y la pantalla no puede dar a entender que ya existe.
 */
export function perfilEnPalabras(persona: PersonaResponse): string {
  return persona.esPaciente === true
    ? 'Tiene perfil clinico activo en esta organizacion. Eso la habilita como paciente; la ' +
        'historia clinica es otra cosa y se maneja en el modulo clinico.'
    : 'Todavia no es paciente. Puede reservar y participar de actividades no clinicas sin ' +
        'ningun perfil clinico.';
}

/** `true` cuando la ficha esta dada de baja y no admite cambios. */
export function personaInactiva(persona: PersonaResponse): boolean {
  return persona.estado === 'INACTIVO';
}
