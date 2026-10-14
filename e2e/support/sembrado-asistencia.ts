import { randomUUID } from 'node:crypto';

import { nonce } from './akine';
import { ApiAkine, Centro, Persona, crearOferta, crearPersona, fechaLocal } from './sembrado';

/**
 * Sembrado del E2E de asistencia de clases (F9, AKINE-08.03).
 *
 * <p>Vive aparte de los demas `sembrado-*.ts` para no pisarse con otros PR que agregan al final.
 * Usa el MISMO centro de `agenda-setup`.
 *
 * <p><b>La clase es FUTURA a proposito.</b> Inscribir a una clase que ya empezo es
 * `clase-transicion-no-permitida` ("ya empezo"), e iniciar la asistencia no tiene restriccion de
 * hora —abrir la lista minutos antes es lo normal—. Asi el test inscribe, inicia y marca sin
 * depender de la hora del reloj.
 */
export const DIAS_ASISTENCIA = { asistencia: 140 } as const;

/** Instante UTC (ISO) de una hora local `HH:MM` del dia `fecha` en la zona `zona`. */
export function instanteEnZona(fecha: string, horaLocal: string, zona: string): string {
  const comoSiFueraUtc = new Date(`${fecha}T${horaLocal}:00Z`);
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(comoSiFueraUtc);
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '00';
  const enZona = Date.parse(
    `${valor('year')}-${valor('month')}-${valor('day')}T${valor('hour')}:${valor('minute')}:00Z`,
  );
  const desfase = enZona - comoSiFueraUtc.getTime();
  return new Date(comoSiFueraUtc.getTime() - desfase).toISOString();
}

export interface ClaseSembrada {
  readonly id: number;
  readonly titulo: string;
  readonly fecha: string;
  readonly inscripciones: readonly { readonly persona: Persona; readonly inscripcionId: number }[];
}

/**
 * Oferta GRUPAL sin profesional ni espacio, una clase en el dia `dias` desde hoy y `personas`
 * inscriptas. Grupal por MODALIDAD: el backend no la deduce del cupo.
 */
export async function claseConInscriptos(
  api: ApiAkine,
  centro: Centro,
  dias: number,
  personas: number,
): Promise<ClaseSembrada> {
  const oferta = await crearOferta(api, centro, {
    nombre: `Pilates E2E ${nonce()}`,
    habilitarProfesional: false,
    extra: { modalidad: 'GRUPAL', capacidad: 8, requiereProfesional: false },
  });
  const fecha = fechaLocal(centro.timezone, dias);
  // Hora con el nonce para que dos corridas sobre la misma base no compartan horario.
  const minuto = String(Math.floor(Math.random() * 6) * 10).padStart(2, '0');
  const titulo = `Pilates grupal ${nonce()}`;
  const clase = await api.exigir<{ id: number }>(
    'POST',
    `/api/v1/consultorios/${centro.consultorioId}/clases/ofertas/${oferta.id}`,
    {
      titulo,
      capacidad: 6,
      inicio: instanteEnZona(fecha, `10:${minuto}`, centro.timezone),
      fin: instanteEnZona(fecha, `11:${minuto}`, centro.timezone),
      idempotencyKey: randomUUID(),
    },
  );
  const inscripciones = [];
  for (let i = 0; i < personas; i++) {
    const persona = await crearPersona(api, { conPerfil: false, nombre: `Alumna${i + 1}` });
    const resultado = await api.exigir<{ inscripcion: { id: number } }>(
      'POST',
      `/api/v1/consultorios/${centro.consultorioId}/clases/${clase.id}/inscripciones`,
      // `aceptaListaEspera` va explicito: el contrato lo declara opcional y el backend responde 400
      // si falta (es un `boolean` primitivo en `InscribirRequest`). Reportado al backend.
      { personaId: persona.id, aceptaListaEspera: false, idempotencyKey: randomUUID() },
    );
    inscripciones.push({ persona, inscripcionId: resultado.inscripcion.id });
  }
  return { id: clase.id, titulo, fecha, inscripciones };
}
