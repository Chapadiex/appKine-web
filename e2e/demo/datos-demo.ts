/**
 * Datos sintéticos del Centro Demo. Ninguno es de una persona real: nombres y apellidos comunes
 * combinados al azar, documentos y teléfonos generados.
 */

/** Generador determinístico (mulberry32): la misma semilla da el mismo centro. */
export function azar(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const NOMBRES = [
  'Lucía',
  'Martín',
  'Sofía',
  'Joaquín',
  'Valentina',
  'Mateo',
  'Camila',
  'Santiago',
  'Julieta',
  'Benjamín',
  'Agustina',
  'Tomás',
  'Florencia',
  'Facundo',
  'Micaela',
  'Nicolás',
  'Carolina',
  'Gonzalo',
  'Paula',
  'Diego',
  'Rocío',
  'Marcelo',
  'Graciela',
  'Héctor',
  'Silvia',
  'Ricardo',
  'Mónica',
  'Jorge',
  'Patricia',
  'Alberto',
  'Natalia',
  'Emiliano',
  'Lorena',
  'Federico',
  'Ana',
  'Hugo',
  'Verónica',
  'Ramiro',
  'Elena',
  'Pablo',
];

export const APELLIDOS = [
  'González',
  'Rodríguez',
  'Fernández',
  'López',
  'Martínez',
  'Pérez',
  'Gómez',
  'Sánchez',
  'Romero',
  'Díaz',
  'Álvarez',
  'Torres',
  'Ruiz',
  'Ramírez',
  'Flores',
  'Acosta',
  'Benítez',
  'Medina',
  'Herrera',
  'Suárez',
  'Aguirre',
  'Giménez',
  'Molina',
  'Castro',
  'Ortiz',
  'Silva',
  'Rojas',
  'Paz',
  'Vera',
  'Ríos',
  'Ledesma',
  'Quiroga',
  'Peralta',
  'Godoy',
  'Bustos',
  'Funes',
  'Cabrera',
  'Ferreyra',
  'Moyano',
  'Luna',
];

/** Diagnóstico de un episodio: oferta, zona del dolor, objetivo y cómo arranca el dolor. */
export interface Diagnostico {
  readonly texto: string;
  readonly zona: string;
  readonly lado: 'IZQUIERDA' | 'DERECHA' | 'BILATERAL' | 'NO_APLICA';
  readonly objetivo: string;
  /** Índice en {@link OFERTAS}. */
  readonly oferta: number;
}

export const DIAGNOSTICOS: readonly Diagnostico[] = [
  {
    texto: 'Lumbalgia mecánica',
    zona: 'Columna lumbar',
    lado: 'NO_APLICA',
    objetivo: 'Disminuir el dolor y recuperar la flexión del tronco',
    oferta: 0,
  },
  {
    texto: 'Cervicalgia con contractura del trapecio',
    zona: 'Columna cervical',
    lado: 'BILATERAL',
    objetivo: 'Recuperar la rotación cervical sin dolor',
    oferta: 0,
  },
  {
    texto: 'Esguince de tobillo grado II',
    zona: 'Tobillo',
    lado: 'DERECHA',
    objetivo: 'Volver a la marcha sin dolor y a la carrera en seis semanas',
    oferta: 1,
  },
  {
    texto: 'Postoperatorio de ligamento cruzado anterior',
    zona: 'Rodilla',
    lado: 'IZQUIERDA',
    objetivo: 'Extensión completa y fuerza del cuádriceps para volver al deporte',
    oferta: 1,
  },
  {
    texto: 'Tendinopatía del manguito rotador',
    zona: 'Hombro',
    lado: 'DERECHA',
    objetivo: 'Elevar el brazo por encima de la cabeza sin dolor',
    oferta: 0,
  },
  {
    texto: 'Epicondilitis lateral',
    zona: 'Codo',
    lado: 'DERECHA',
    objetivo: 'Agarre sin dolor para el trabajo de oficina',
    oferta: 0,
  },
  {
    texto: 'Fascitis plantar',
    zona: 'Pie',
    lado: 'IZQUIERDA',
    objetivo: 'Caminar más de una hora sin dolor al apoyar',
    oferta: 1,
  },
  {
    texto: 'Gonartrosis',
    zona: 'Rodilla',
    lado: 'BILATERAL',
    objetivo: 'Subir escaleras con menos dolor y más estabilidad',
    oferta: 0,
  },
  {
    texto: 'Linfedema de miembro superior',
    zona: 'Brazo',
    lado: 'IZQUIERDA',
    objetivo: 'Reducir el perímetro del brazo y mantenerlo',
    oferta: 2,
  },
  {
    texto: 'Fractura de radio distal consolidada',
    zona: 'Muñeca',
    lado: 'DERECHA',
    objetivo: 'Recuperar la movilidad de la muñeca y la fuerza de prensión',
    oferta: 0,
  },
  {
    texto: 'Edema postquirúrgico de rodilla',
    zona: 'Rodilla',
    lado: 'DERECHA',
    objetivo: 'Reducir el edema y acompañar la recuperación',
    oferta: 2,
  },
  {
    texto: 'Desgarro de isquiotibiales',
    zona: 'Muslo',
    lado: 'IZQUIERDA',
    objetivo: 'Volver al fútbol sin recaída',
    oferta: 1,
  },
];

export const OFERTAS = [
  { nombre: 'Kinesiología general', duracion: 45, precio: 18000 },
  { nombre: 'Rehabilitación deportiva', duracion: 60, precio: 24000 },
  { nombre: 'Drenaje linfático', duracion: 45, precio: 20000 },
] as const;

/** Obras sociales sintéticas y lo que paga cada una por sesión (B del modelo A − B). */
export const FINANCIADORES = [
  { codigo: 'OSDEMO', nombre: 'Obra Social Demo Salud', plan: 'Plan 210', paga: 12000 },
  { codigo: 'PREPDEMO', nombre: 'Prepaga Demo Plus', plan: 'Plan Oro', paga: 15000 },
  { codigo: 'MUTDEMO', nombre: 'Mutual Demo Docentes', plan: 'Plan General', paga: 9000 },
] as const;

export const RESPUESTAS = [
  'Buena respuesta a la terapia manual y al ejercicio activo.',
  'Tolera bien la progresión de la carga.',
  'Refiere alivio después de la sesión anterior.',
  'Menos rigidez matinal; completa la serie de ejercicios.',
  'Sesión con más dolor al inicio que cede con la movilidad.',
];

export const INDICACIONES = [
  'Ejercicios domiciliarios dos veces por día; hielo si hay dolor.',
  'Caminata diaria de 20 minutos y estiramientos indicados.',
  'Continuar con la rutina de fortalecimiento en casa.',
  'Evitar cargar peso con el miembro afectado.',
  'Mantener la prenda de compresión durante el día.',
];

export const NOTAS = [
  'Se trabajó movilidad, fuerza y control motor. Sin eventos adversos.',
  'Terapia manual, ejercicio terapéutico y educación al paciente.',
  'Progresión de ejercicios en carga; buena técnica.',
  'Se reevaluó el rango de movimiento: mejora respecto del inicio.',
  'Sesión completa según el plan.',
];
