import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { randomUUID } from 'node:crypto';

import { nonce } from '../support/akine';
import { instanteEnZona } from '../support/sembrado-asistencia';
import { JUSTIFICACION, exigirCon } from '../support/sembrado-pantallas-098';
import {
  ApiAkine,
  Centro,
  Obligacion,
  Persona,
  cerrarSesionDelTurno,
  dejarLaCajaCerrada,
  comoProfesional,
  diaDeTrabajo,
  fechaLocal,
  fijarPrecio,
  obligacionesDe,
  practicaGlobal,
  reservarElPrimeroLibre,
  sumarDias,
  turnoDeHoy,
} from '../support/sembrado';

/**
 * Datos de ejemplo de las capturas del manual, sembrados por la API REAL sobre el centro de
 * `agenda-setup` (datos sintéticos). Diseño: appKine-api/docs/diseno/AKINE-manual-de-usuario.md.
 *
 * <p><b>Idempotente.</b> Los ids quedan en {@link ARCHIVO} y la corrida siguiente los reusa si siguen
 * sirviendo: cada dato tiene su chequeo (sigue existiendo, sigue en el estado que la captura necesita,
 * sigue siendo de hoy) y sólo se rehace el que no pasa. Las capturas no confirman nada, así que lo
 * sembrado no cambia de estado al sacarlas.
 *
 * <p>Lo que la captura marca vive en el JSON de `capturas/`; acá sólo el estado previo.
 */
const ARCHIVO = nodePath.join(nodeOs.tmpdir(), 'akine-e2e-datos-manual.json');

/** Desplazamientos desde hoy de los turnos que terminan en una sesión cerrada (no tocan la recepción). */
const DIAS_DEL_MANUAL = { deuda: 150, presentacion: 153, clase: 4, claseEnCurso: 6 } as const;

const PRECIO = 12000;
const FINANCIADOR = 9000;
const COSEGURO = 3000;

interface PersonaGuardada extends Persona {
  readonly nombreCompleto: string;
}

/** Todo lo que la siembra deja escrito. Los campos se completan de a uno. */
interface Cache {
  organizationId?: number;
  practicaId?: number;
  oferta?: { id: number; nombre: string };
  ofertaGrupal?: { id: number; nombre: string };
  ofertaPack?: { id: number; nombre: string };
  productoId?: number;
  ejemplo?: PersonaGuardada;
  sinRelacion?: PersonaGuardada;
  llegada?: PersonaGuardada;
  enCurso?: PersonaGuardada;
  conCobertura?: PersonaGuardada;
  alumnas?: PersonaGuardada[];
  historiaId?: number;
  casoId?: number;
  financiador?: { id: number; nombre: string; planId: number };
  convenioId?: number;
  deudaTurnoId?: number;
  presentacionId?: number;
  egresoId?: number;
  serieId?: number;
  turnoReservado?: { id: number; fecha: string };
  turnoLlegado?: { id: number; fecha: string };
  turnoEnCurso?: { id: number; fecha: string };
  claseInscribir?: number;
  claseHoy?: { id: number; fecha: string };
  claseEnCurso?: number;
}

/** Los marcadores que las capturas pueden usar en `ruta`, selectores, textos y valores. */
export type Marcadores = Readonly<Record<string, string>>;

function leer(): Cache {
  try {
    return JSON.parse(nodeFs.readFileSync(ARCHIVO, 'utf8')) as Cache;
  } catch {
    return {};
  }
}

let enCurso: Promise<Marcadores> | null = null;

/** Una vez por proceso: los tests de la corrida comparten la misma promesa. */
export function asegurarDatosDelManual(centro: Centro): Promise<Marcadores> {
  enCurso ??= sembrar(centro);
  return enCurso;
}

async function sembrar(centro: Centro): Promise<Marcadores> {
  let cache = leer();
  if (cache.organizationId !== centro.organizationId) {
    cache = { organizationId: centro.organizationId };
  }
  const guardar = () => nodeFs.writeFileSync(ARCHIVO, JSON.stringify(cache, null, 2));
  const api = await ApiAkine.como(centro.emailAdmin, { reusarSesion: true });
  const profesional = await comoProfesional(centro);
  const sede = `/api/v1/consultorios/${centro.consultorioId}`;
  const hoy = fechaLocal(centro.timezone);
  const existe = async (ruta: string) => (await api.pedir('GET', ruta)).ok();
  // La oferta no tiene GET propio: se busca en el listado de la sede.
  const ofertaExiste = async (id: number) =>
    (await api.exigir<{ id: number }[]>('GET', `${sede}/ofertas`)).some((o) => o.id === id);
  const leerJson = async <T>(ruta: string, quien = api): Promise<T | null> => {
    const r = await quien.pedir('GET', ruta, undefined, JUSTIFICACION);
    return r.ok() ? ((await r.json()) as T) : null;
  };

  /** Rehace `clave` si falta o si `sirve` dice que ya no. Guarda después de cada alta. */
  async function asegurar<K extends keyof Cache>(
    clave: K,
    sirve: (valor: NonNullable<Cache[K]>) => Promise<boolean>,
    crear: () => Promise<NonNullable<Cache[K]>>,
  ): Promise<NonNullable<Cache[K]>> {
    const actual = cache[clave];
    if (actual !== undefined && actual !== null && (await sirve(actual as NonNullable<Cache[K]>))) {
      return actual as NonNullable<Cache[K]>;
    }
    const nuevo = await crear();
    cache[clave] = nuevo;
    guardar();
    return nuevo;
  }

  const persona = (
    clave: 'ejemplo' | 'sinRelacion' | 'llegada' | 'enCurso' | 'conCobertura',
    nombre: string,
    apellido: string,
  ) =>
    asegurar(
      clave,
      (p) => existe(`/api/v1/personas/${p.id}`),
      () => crearPersona(api, nombre, apellido, true),
    );

  try {
    // --- Catálogo y ofertas -------------------------------------------------------------------
    const practicaId = await asegurar(
      'practicaId',
      async () => true,
      () => practicaGlobal(api, 'KIN_SESION'),
    );
    const oferta = await asegurar(
      'oferta',
      (o) => ofertaExiste(o.id),
      async () => {
        const nombre = 'Kinesiología general';
        const creada = await api.exigir<{ id: number; version: number }>(
          'POST',
          `${sede}/ofertas`,
          {
            servicioId: centro.servicioId,
            nombreComercial: nombre,
            capacidad: 1,
            duracionMinutos: 45,
            requiereProfesional: true,
            requiereEspacio: false,
            admiteObraSocial: true,
            precioBase: PRECIO,
            moneda: 'ARS',
          },
        );
        const { ofertaVersion } = await api.exigir<{ ofertaVersion: number }>(
          'PUT',
          `${sede}/ofertas/${creada.id}/habilitaciones/profesionales`,
          { expectedVersion: creada.version, ids: [centro.profesional.membershipId] },
        );
        await api.exigir('PUT', `${sede}/ofertas/${creada.id}/practicas`, {
          practicaIds: [practicaId],
          practicaPrincipalId: practicaId,
          expectedVersion: ofertaVersion,
        });
        await fijarPrecio(api, centro, { id: creada.id, nombre, version: 0 }, PRECIO);
        return { id: creada.id, nombre };
      },
    );
    const ofertaGrupal = await asegurar(
      'ofertaGrupal',
      (o) => ofertaExiste(o.id),
      () => crearOfertaGrupal(api, centro, 'Pilates grupal', {}),
    );
    const ofertaPack = await asegurar(
      'ofertaPack',
      (o) => ofertaExiste(o.id),
      () => crearOfertaGrupal(api, centro, 'Funcional con pase', { esquemaCobro: 'POR_PACK' }),
    );
    await asegurar(
      'productoId',
      async (id) => {
        const productos = await api.exigir<{ id: number }[]>('GET', `${sede}/productos`);
        return productos.some((p) => p.id === id);
      },
      async () =>
        (
          await api.exigir<{ id: number }>('POST', `${sede}/productos`, {
            ofertaId: ofertaPack.id,
            nombre: 'Pack de 8 clases',
            creditos: 8,
            precio: 32000,
            moneda: 'ARS',
            vigenciaDias: 60,
            vigenciaDesde: hoy,
          })
        ).id,
    );

    // --- Personas -----------------------------------------------------------------------------
    const ejemplo = await persona('ejemplo', 'Lucía', 'Fernández');
    await persona('sinRelacion', 'Carlos', 'Benítez');
    const llegada = await persona('llegada', 'Martín', 'Ruiz');
    const conTurnoEnCurso = await persona('enCurso', 'Elena', 'Suárez');
    const conCobertura = await persona('conCobertura', 'Ramiro', 'Acosta');
    const alumnas = await asegurar(
      'alumnas',
      async (lista) => lista.length === 3 && (await existe(`/api/v1/personas/${lista[0].id}`)),
      async () => [
        await crearPersona(api, 'Sofía', 'Paz', false),
        await crearPersona(api, 'Valentina', 'Ortiz', false),
        await crearPersona(api, 'Julieta', 'Molina', false),
      ],
    );

    // --- Historia clínica y caso de la persona de ejemplo (los abre la profesional) -------------
    const historiaId = await asegurar(
      'historiaId',
      async () => true,
      async () =>
        (
          await exigirCon<{ id: number }>(
            profesional,
            'PUT',
            `/api/v1/historias-clinicas/por-persona/${ejemplo.id}`,
            undefined,
            JUSTIFICACION,
          )
        ).id,
    );
    // Sin equipo a propósito: la profesional del centro queda para "Sumar un profesional".
    await asegurar(
      'casoId',
      async (id) => {
        const caso = await leerJson<{ estado: string; equipo?: unknown[] }>(
          `/api/v1/casos-clinicos/${id}`,
          profesional,
        );
        return caso?.estado === 'ACTIVO' && (caso.equipo ?? []).length === 0;
      },
      async () =>
        (
          await exigirCon<{ id: number }>(
            profesional,
            'POST',
            `/api/v1/historias-clinicas/${historiaId}/casos`,
            {
              ofertaId: oferta.id,
              diagnosticoPresuntivo: 'Lumbalgia mecánica (dato de ejemplo)',
              objetivoTerapeutico: 'Recuperar la movilidad sin dolor',
            },
            JUSTIFICACION,
          )
        ).id,
    );

    // --- Turnos de hoy ------------------------------------------------------------------------
    // El reservado va primero: es la primera fila de la recepción del día.
    const deHoy = (t: { fecha: string }) => Promise.resolve(t.fecha === hoy);
    const ofertaComoTurno = { id: oferta.id, nombre: oferta.nombre, version: 0 };
    // Y todavía no empezado: un turno en curso ya no se cancela y el panel no muestra esa sección.
    await asegurar(
      'turnoReservado',
      async (t) => {
        const turno = await leerJson<{ estado: string; inicio: string }>(`${sede}/turnos/${t.id}`);
        return (
          (await deHoy(t)) &&
          turno?.estado === 'RESERVADO' &&
          Date.parse(turno.inicio) > Date.now() + 30 * 60_000
        );
      },
      async () => ({
        id: (await turnoDeHoy(api, centro, ofertaComoTurno, ejemplo)).id,
        fecha: hoy,
      }),
    );
    await asegurar('turnoLlegado', deHoy, async () => {
      const turno = await turnoDeHoy(api, centro, ofertaComoTurno, llegada);
      await registrarLlegada(api, sede, turno.id);
      return { id: turno.id, fecha: hoy };
    });
    await asegurar('turnoEnCurso', deHoy, async () => {
      const turno = await turnoDeHoy(api, centro, ofertaComoTurno, conTurnoEnCurso);
      await registrarLlegada(api, sede, turno.id);
      await profesional.exigir('POST', `${sede}/sesiones/turnos/${turno.id}`);
      return { id: turno.id, fecha: hoy };
    });

    // --- Serie vigente ------------------------------------------------------------------------
    await asegurar(
      'serieId',
      async (id) => {
        const serie = await leerJson<{ turnos: { inicio: string; estado: string }[] }>(
          `${sede}/series-de-turnos/${id}`,
        );
        return (serie?.turnos ?? []).some(
          (t) => t.estado === 'RESERVADO' && Date.parse(t.inicio) > Date.now() + 86_400_000,
        );
      },
      async () => {
        const { fecha } = await diaDeTrabajo(api, centro, oferta.id, 7);
        const serie = await api.exigir<{ id: number }>('POST', `${sede}/series-de-turnos`, {
          ofertaId: oferta.id,
          personaId: ejemplo.id,
          profesionalId: centro.profesional.membershipId,
          diasSemana: [new Date(`${fecha}T00:00:00Z`).getUTCDay() || 7],
          fechaDesde: fecha,
          hora: '09:45',
          cantidad: 4,
          idempotencyKey: randomUUID(),
        });
        return serie.id;
      },
    );

    // --- Deuda particular de la persona de ejemplo --------------------------------------------
    await asegurar(
      'deudaTurnoId',
      async () =>
        (await obligacionesDe(api, centro, ejemplo.id)).some(
          (o) => o.estado !== 'CANCELADA' && o.saldo > 0,
        ),
      async () => {
        const { slots } = await diaDeTrabajo(api, centro, oferta.id, DIAS_DEL_MANUAL.deuda);
        const turno = await reservarElPrimeroLibre(api, centro, oferta.id, ejemplo.id, slots);
        await cerrarSesionDelTurno(profesional, centro, turno.id);
        return turno.id;
      },
    );

    // --- Financiador, convenio y lote en borrador ---------------------------------------------
    const desde = sumarDias(hoy, -30);
    const financiador = await asegurar(
      'financiador',
      (f) => existe(`/api/v1/financiadores/${f.id}`),
      async () => {
        const sufijo = nonce();
        const nombre = 'Obra Social del Ejemplo';
        const creado = await api.exigir<{ id: number }>('POST', '/api/v1/financiadores', {
          codigo: `OSEJ${sufijo}`.slice(0, 20),
          nombre,
          tipo: 'OBRA_SOCIAL',
        });
        const plan = await api.exigir<{ id: number }>(
          'POST',
          `/api/v1/financiadores/${creado.id}/planes`,
          { codigo: `PLAN${sufijo}`.slice(0, 20), nombre: 'Plan 210', vigenciaDesde: desde },
        );
        return { id: creado.id, nombre, planId: plan.id };
      },
    );
    await asegurar(
      'convenioId',
      (id) => existe(`${sede}/convenios/${id}`),
      async () => {
        const convenio = await api.exigir<{ id: number }>('POST', `${sede}/convenios`, {
          financiadorId: financiador.id,
          planId: financiador.planId,
          codigo: `CVEJ${nonce()}`.slice(0, 20),
          nombre: 'Convenio general 2026',
          modalidad: 'POR_PRESTACION',
          vigenciaDesde: desde,
          moneda: 'ARS',
        });
        await api.exigir('POST', `${sede}/convenios/${convenio.id}/aranceles`, {
          practicaId,
          importeTotal: PRECIO,
          importeFinanciador: FINANCIADOR,
          coseguro: COSEGURO,
          vigenciaDesde: desde,
        });
        return convenio.id;
      },
    );
    await asegurar(
      'presentacionId',
      async (id) =>
        (await leerJson<{ estado: string }>(`${sede}/presentaciones/${id}`))?.estado === 'BORRADOR',
      async () => {
        await api.pedir('POST', `/api/v1/personas/${conCobertura.id}/coberturas`, {
          tipo: 'FINANCIADA',
          planId: financiador.planId,
          numeroAfiliado: `AF-${nonce()}`,
          vigenciaDesde: desde,
          principal: true,
        });
        const { slots } = await diaDeTrabajo(api, centro, oferta.id, DIAS_DEL_MANUAL.presentacion);
        const turno = await reservarElPrimeroLibre(api, centro, oferta.id, conCobertura.id, slots);
        await cerrarSesionDelTurno(profesional, centro, turno.id);
        const elegibles = await api.exigir<Obligacion[]>(
          'GET',
          `${sede}/prestaciones-elegibles?financiadorId=${financiador.id}&desde=${sumarDias(hoy, -1)}&hasta=${sumarDias(hoy, 1)}`,
        );
        const lote = await api.exigir<{ id: number }>('POST', `${sede}/presentaciones`, {
          financiadorId: financiador.id,
          moneda: 'ARS',
          periodoDesde: sumarDias(hoy, -1),
          periodoHasta: sumarDias(hoy, 1),
          obligacionIds: elegibles.filter((o) => o.personaId === conCobertura.id).map((o) => o.id),
        });
        return lote.id;
      },
    );

    // --- Egreso confirmado con saldo ----------------------------------------------------------
    await asegurar(
      'egresoId',
      async (id) => {
        const egreso = await leerJson<{ estado: string; saldo?: number; saldoPendiente?: number }>(
          `${sede}/egresos/${id}`,
        );
        return egreso?.estado === 'CONFIRMADO';
      },
      async () => {
        const numero = parseInt(randomUUID().replace(/-/g, '').slice(0, 7), 16) % 100_000_000;
        const egreso = await api.exigir<{ id: number }>('POST', `${sede}/egresos`, {
          categoria: 'ALQUILER',
          concepto: 'Alquiler del local, noviembre',
          importeTotal: 450000,
          moneda: 'ARS',
          tipoBeneficiario: 'EXTERNO',
          beneficiarioNombre: 'Inmobiliaria del Ejemplo SRL',
          comprobanteTipo: 'Factura C',
          comprobanteNumero: `0001-${String(numero).padStart(8, '0')}`,
          idempotencyKey: randomUUID(),
        });
        await api.exigir('POST', `${sede}/egresos/${egreso.id}/confirmacion`);
        return egreso.id;
      },
    );

    // --- Clases -------------------------------------------------------------------------------
    const estadoDeClase = async (id: number) =>
      (await leerJson<{ estado: string }>(`${sede}/clases/${id}`))?.estado;
    await asegurar(
      'claseInscribir',
      async (id) => (await estadoDeClase(id)) === 'PROGRAMADA',
      () =>
        programarClase(
          api,
          centro,
          ofertaGrupal.id,
          'Pilates de la mañana',
          DIAS_DEL_MANUAL.clase,
          '09:00',
        ),
    );
    await asegurar(
      'claseHoy',
      async (c) => c.fecha === hoy && (await estadoDeClase(c.id)) === 'PROGRAMADA',
      async () => {
        // Más tarde hoy, para poder inscribir (inscribir a una clase que empezó es un 409).
        const id = await programarClase(
          api,
          centro,
          ofertaGrupal.id,
          'Pilates de la noche',
          0,
          '22:00',
        );
        await inscribir(api, sede, id, alumnas.slice(0, 2));
        return { id, fecha: hoy };
      },
    );
    await asegurar(
      'claseEnCurso',
      async (id) => (await estadoDeClase(id)) === 'EN_CURSO',
      async () => {
        const id = await programarClase(
          api,
          centro,
          ofertaGrupal.id,
          'Pilates de la tarde',
          DIAS_DEL_MANUAL.claseEnCurso,
          '18:00',
        );
        await inscribir(api, sede, id, alumnas);
        await api.exigir('POST', `${sede}/clases/${id}/inicio`);
        return id;
      },
    );

    // --- Caja cerrada ---------------------------------------------------------------------------
    // "Registrar movimiento" la abre y queda abierta; "Abrir la caja" la necesita cerrada. Cada
    // corrida arranca con la jornada arqueada por lo que diga el teórico.
    await dejarLaCajaCerrada(api, centro);
  } finally {
    await api.cerrar();
    await profesional.cerrar();
  }

  const c = cache as Required<Cache>;
  return {
    personaId: String(c.ejemplo.id),
    practicaId: String(c.practicaId),
    profesionalId: String(centro.profesional.membershipId),
    personaApellido: c.ejemplo.apellido,
    personaNombreCompleto: c.ejemplo.nombreCompleto,
    personaSinRelacionId: String(c.sinRelacion.id),
    personaLlegadaApellido: c.llegada.apellido,
    casoId: String(c.casoId),
    ofertaId: String(c.oferta.id),
    ofertaNombre: c.oferta.nombre,
    ofertaGrupalId: String(c.ofertaGrupal.id),
    financiadorId: String(c.financiador.id),
    planId: String(c.financiador.planId),
    convenioId: String(c.convenioId),
    presentacionId: String(c.presentacionId),
    egresoId: String(c.egresoId),
    serieId: String(c.serieId),
    turnoId: String(c.turnoReservado.id),
    turnoLlegadoId: String(c.turnoLlegado.id),
    turnoEnCursoId: String(c.turnoEnCurso.id),
    claseId: String(c.claseInscribir),
    claseHoyId: String(c.claseHoy.id),
    claseEnCursoId: String(c.claseEnCurso),
  };
}

async function crearPersona(
  api: ApiAkine,
  nombre: string,
  apellido: string,
  conPerfil: boolean,
): Promise<PersonaGuardada> {
  const creada = await api.exigir<{ id: number }>('POST', '/api/v1/personas', { nombre, apellido });
  if (conPerfil) {
    await api.exigir('POST', `/api/v1/personas/${creada.id}/perfil-paciente`, {});
  }
  return { id: creada.id, nombre, apellido, nombreCompleto: `${apellido}, ${nombre}` };
}

async function crearOfertaGrupal(
  api: ApiAkine,
  centro: Centro,
  nombre: string,
  extra: Record<string, unknown>,
): Promise<{ id: number; nombre: string }> {
  const oferta = await api.exigir<{ id: number }>(
    'POST',
    `/api/v1/consultorios/${centro.consultorioId}/ofertas`,
    {
      servicioId: centro.servicioId,
      nombreComercial: nombre,
      modalidad: 'GRUPAL',
      capacidad: 8,
      duracionMinutos: 60,
      requiereProfesional: false,
      requiereEspacio: false,
      ...extra,
    },
  );
  return { id: oferta.id, nombre };
}

/** Programa la clase el primer día habil desde `dias` (un feriado cierra la sede). */
async function programarClase(
  api: ApiAkine,
  centro: Centro,
  ofertaId: number,
  titulo: string,
  dias: number,
  horaLocal: string,
): Promise<number> {
  let ultimo = '';
  for (let d = dias; d < dias + 5; d++) {
    const fecha = fechaLocal(centro.timezone, d);
    const [h, m] = horaLocal.split(':').map(Number);
    const fin = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const respuesta = await api.pedir(
      'POST',
      `/api/v1/consultorios/${centro.consultorioId}/clases/ofertas/${ofertaId}`,
      {
        titulo,
        capacidad: 6,
        inicio: instanteEnZona(fecha, horaLocal, centro.timezone),
        fin: instanteEnZona(fecha, fin, centro.timezone),
        idempotencyKey: randomUUID(),
      },
    );
    if (respuesta.ok()) {
      return ((await respuesta.json()) as { id: number }).id;
    }
    ultimo = `${fecha}: ${respuesta.status()} ${await respuesta.text()}`;
    if (dias === 0) {
      break;
    }
  }
  throw new Error(`No se pudo programar "${titulo}". Ultimo: ${ultimo}`);
}

async function inscribir(
  api: ApiAkine,
  sede: string,
  claseId: number,
  personas: readonly Persona[],
): Promise<void> {
  for (const persona of personas) {
    await api.exigir('POST', `${sede}/clases/${claseId}/inscripciones`, {
      personaId: persona.id,
      aceptaListaEspera: false,
      idempotencyKey: randomUUID(),
    });
  }
}

/** La llegada del paciente, como la registra la recepción. */
async function registrarLlegada(api: ApiAkine, sede: string, turnoId: number): Promise<void> {
  const respuesta = await api.pedir('POST', `${sede}/turnos/${turnoId}/recepcion`);
  if (!respuesta.ok()) {
    await api.exigir('POST', `${sede}/turnos/${turnoId}/llegada`);
  }
}
