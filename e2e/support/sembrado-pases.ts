import { randomUUID } from 'node:crypto';

import { nonce } from './akine';
import { instanteEnZona } from './sembrado-asistencia';
import { ApiAkine, Centro, Persona, crearOferta, crearPersona, fechaLocal } from './sembrado';

/**
 * Sembrado del E2E de pases (F9, M29, AKINE-08.06). Vive aparte de los demas `sembrado-*.ts` para
 * no pisarse con otros PR. Usa el MISMO centro de `agenda-setup`.
 *
 * <p><b>La clase es CERCANA a proposito</b>, al reves de la de asistencia: el pase vale N dias desde
 * hoy y el consumo exige que este vigente el dia de la clase. Y es futura, porque inscribir a una
 * clase que ya empezo es `clase-transicion-no-permitida`.
 */
export const DIAS_PASES = { desde: 4, hasta: 10 } as const;

export interface ClaseDePack {
  readonly ofertaId: number;
  readonly ofertaNombre: string;
  readonly claseId: number;
  readonly titulo: string;
  readonly persona: Persona;
}

/**
 * Oferta GRUPAL con `esquemaCobro = POR_PACK` (la unica que admite productos y hace que la
 * asistencia consuma credito), una clase en los proximos dias y una persona inscripta.
 *
 * <p>Prueba dia por dia dentro de {@link DIAS_PASES}: un feriado nacional cierra la sede y la clase
 * no se puede programar ese dia.
 */
export async function claseDePackConUnaInscripta(
  api: ApiAkine,
  centro: Centro,
): Promise<ClaseDePack> {
  const ofertaNombre = `Pilates pack E2E ${nonce()}`;
  const oferta = await crearOferta(api, centro, {
    nombre: ofertaNombre,
    habilitarProfesional: false,
    extra: {
      modalidad: 'GRUPAL',
      capacidad: 8,
      requiereProfesional: false,
      esquemaCobro: 'POR_PACK',
    },
  });
  const titulo = `Pilates con pase ${nonce()}`;
  const minuto = String(Math.floor(Math.random() * 6) * 10).padStart(2, '0');
  let claseId: number | null = null;
  let ultimo = '';
  for (let dias = DIAS_PASES.desde; dias <= DIAS_PASES.hasta && claseId === null; dias++) {
    const fecha = fechaLocal(centro.timezone, dias);
    const respuesta = await api.pedir(
      'POST',
      `/api/v1/consultorios/${centro.consultorioId}/clases/ofertas/${oferta.id}`,
      {
        titulo,
        capacidad: 6,
        inicio: instanteEnZona(fecha, `09:${minuto}`, centro.timezone),
        fin: instanteEnZona(fecha, `10:${minuto}`, centro.timezone),
        idempotencyKey: randomUUID(),
      },
    );
    if (respuesta.ok()) {
      claseId = ((await respuesta.json()) as { id: number }).id;
    } else {
      ultimo = `${fecha}: ${respuesta.status()} ${await respuesta.text()}`;
    }
  }
  if (claseId === null) {
    throw new Error(`No se pudo programar la clase en ningun dia del bloque. Ultimo: ${ultimo}`);
  }
  const persona = await crearPersona(api, { conPerfil: false, nombre: 'Alumna' });
  await api.exigir(
    'POST',
    `/api/v1/consultorios/${centro.consultorioId}/clases/${claseId}/inscripciones`,
    {
      personaId: persona.id,
      aceptaListaEspera: false,
      idempotencyKey: randomUUID(),
    },
  );
  return { ofertaId: oferta.id, ofertaNombre, claseId, titulo, persona };
}
