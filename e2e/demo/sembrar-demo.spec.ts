import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { randomUUID } from 'node:crypto';

import { expect, request as fabricaDeRequest, test } from '@playwright/test';

import { PASSWORD, conReintentoPor429 } from '../support/akine';
import {
  API,
  ApiAkine,
  activarPorMailpit,
  fechaLocal,
  practicaGlobal,
  servicioAgendable,
  sumarDias,
} from '../support/sembrado';
import { instanteEnZona } from '../support/sembrado-asistencia';
import { JUSTIFICACION, exigirCon } from '../support/sembrado-pantallas-098';
import { Marcas, ajustarHoras, aplanarModificaciones, correr, marcas, psql } from './correr-fechas';
import {
  APELLIDOS,
  DIAGNOSTICOS,
  FINANCIADORES,
  INDICACIONES,
  NOMBRES,
  NOTAS,
  OFERTAS,
  RESPUESTAS,
  azar,
} from './datos-demo';

/**
 * Centro Demo con meses de historia: pacientes, coberturas, turnos atendidos, ausentes y
 * cancelados, sesiones con evaluación, deudas, cobros, caja diaria, egresos y liquidaciones a
 * obras sociales; más la agenda de hoy y de las próximas semanas.
 *
 * <p>Todo pasa por la API real, con sus reglas. Lo único que no puede hacer la API es fechar en el
 * pasado, y eso lo resuelve `correr-fechas.ts`: cada día pasado se siembra sobre un día futuro y
 * después se corre. Ver su cabecera.
 *
 * <pre>
 *   npx playwright test --project=demo
 * </pre>
 *
 * Variables: `AKINE_DEMO_DIAS` (historia, 90 por defecto), `AKINE_DEMO_PACIENTES` (40),
 * `AKINE_DEMO_SUFIJO` (se agrega a los correos para sembrar un segundo centro), `AKINE_DEMO_DB`
 * (base del backend, `akine_main`). Reanuda donde quedó si se corta: el avance vive en
 * {@link ARCHIVO}. Para empezar de cero, borrarlo.
 */

const SUFIJO = process.env['AKINE_DEMO_SUFIJO'] ?? '';
const ARCHIVO = nodePath.join(__dirname, '.estado', `akine-demo${SUFIJO ? `-${SUFIJO}` : ''}.json`);
const DIAS = Number(process.env['AKINE_DEMO_DIAS'] ?? 90);
const PACIENTES = Number(process.env['AKINE_DEMO_PACIENTES'] ?? 40);
const TERMINOS = process.env['AKINE_DEMO_TERMINOS'] ?? '2026-11-19';
const NOMBRE_DEL_CENTRO = `Centro Demo Kinesio${SUFIJO ? ` ${SUFIJO}` : ''}`;

const correo = (quien: string) => `demo.${quien}${SUFIJO ? `.${SUFIJO}` : ''}@centrodemo.test`;

/** Las dos profesionales: una de mañana y una de tarde. */
const PROFESIONALES = [
  {
    clave: 'kine1',
    nombre: 'Martina',
    apellido: 'Gómez',
    // 1 = lunes … 6 = sábado
    horario: [1, 2, 3, 4, 5]
      .map((d) => ({ d, desde: '08:00', hasta: '14:00' }))
      .concat([{ d: 6, desde: '09:00', hasta: '13:00' }]),
    horas: ['08:00', '08:45', '09:30', '10:15', '11:00', '11:45', '12:30'],
  },
  {
    clave: 'kine2',
    nombre: 'Tomás',
    apellido: 'Herrera',
    horario: [1, 2, 3, 4, 5].map((d) => ({ d, desde: '14:00', hasta: '20:00' })),
    horas: ['14:00', '14:45', '15:30', '16:15', '17:00', '17:45', '18:30'],
  },
] as const;

// ---------------------------------------------------------------------------------------------
// Estado persistido
// ---------------------------------------------------------------------------------------------

interface Paciente {
  id: number;
  nombre: string;
  coberturaId?: number;
  /** Índice en FINANCIADORES. */
  financiador?: number;
}

interface Episodio {
  paciente: number;
  diagnostico: number;
  profesional: number;
  hora: number;
  /** Días de la semana JS (1 = lunes). */
  dias: number[];
  desdePaso: number;
  sesiones: number;
  dolorInicial: number;
  hechas: number;
  casoId?: number;
}

interface Presentado {
  id: number;
  mes: string;
  pagado: boolean;
}

interface Estado {
  organizationId?: number;
  consultorioId?: number;
  timezone?: string;
  profesionales?: { email: string; membershipId: number; nombre: string }[];
  ofertas?: number[];
  financiadores?: { id: number; planId: number }[];
  pacientes?: Paciente[];
  episodios?: Episodio[];
  /** Días hábiles pasados que se simulan, en orden. */
  dias?: string[];
  setupCorrido?: boolean;
  /** Paso en curso y sus marcas: si se corta, el reintento corre también lo que quedó a medias. */
  enCurso?: { paso: number; marcas: Marcas };
  ultimoPaso?: number;
  presentaciones?: Presentado[];
  ausentesPendientes?: number[];
  presente?: boolean;
}

function leerEstado(): Estado {
  try {
    return JSON.parse(nodeFs.readFileSync(ARCHIVO, 'utf8')) as Estado;
  } catch {
    return {};
  }
}

function guardar(e: Estado): void {
  nodeFs.mkdirSync(nodePath.dirname(ARCHIVO), { recursive: true });
  nodeFs.writeFileSync(ARCHIVO, JSON.stringify(e, null, 1), { mode: 0o600 });
}

const log = (texto: string) => console.log(`[demo] ${texto}`);

// ---------------------------------------------------------------------------------------------
// La corrida
// ---------------------------------------------------------------------------------------------

test('sembrar el Centro Demo', async () => {
  test.setTimeout(0);
  const e = leerEstado();
  const r = azar(20261123);

  // --- Cuentas y centro -----------------------------------------------------------------------
  if (e.organizationId === undefined) {
    await altaDeCuentas();
    const admin = await ApiAkine.como(correo('admin'));
    const [ctx] = await admin.exigir<{ organizationId: number; consultorioId: number }[]>(
      'GET',
      '/api/v1/me/contexts',
    );
    const sede = await admin.exigir<{ timezone: string }>(
      'GET',
      `/api/v1/organizations/${ctx.organizationId}/consultorios/${ctx.consultorioId}`,
    );
    Object.assign(e, {
      organizationId: ctx.organizationId,
      consultorioId: ctx.consultorioId,
      timezone: sede.timezone,
    });
    guardar(e);
    await admin.cerrar();
  }
  const org = e.organizationId!;
  const sedeId = e.consultorioId!;
  const tz = e.timezone!;
  const sede = `/api/v1/consultorios/${sedeId}`;
  const hoy = fechaLocal(tz);
  const admin = await ApiAkine.como(correo('admin'), { organizationId: org });

  // --- Lo que no tiene fecha de negocio: se crea "hoy" y se corre al principio de la historia --
  if (!e.setupCorrido) {
    const m = e.enCurso?.paso === -1 ? e.enCurso.marcas : marcas(org);
    e.enCurso = { paso: -1, marcas: m };
    guardar(e);
    await configurarElCentro(admin, e, sede, hoy, r);
    correr({
      organizationId: org,
      marcas: m,
      hoy,
      diasDeHoy: DIAS + 10,
      diasDeLoAgendado: DIAS + 10,
      timezone: tz,
    });
    e.setupCorrido = true;
    e.enCurso = undefined;
    guardar(e);
    log('centro configurado y corrido al inicio de la historia');
  }

  const profesionales: ApiAkine[] = [];
  for (const p of e.profesionales!) {
    profesionales.push(await ApiAkine.como(p.email, { organizationId: org }));
  }

  // --- Los días pasados -------------------------------------------------------------------------
  e.dias ??= await diasHabiles(admin, sede, sumarDias(hoy, -DIAS), sumarDias(hoy, -1));
  e.episodios ??= planificarEpisodios(e, r);
  guardar(e);

  for (let paso = (e.ultimoPaso ?? -1) + 1; paso < e.dias.length; paso++) {
    const objetivo = e.dias[paso];
    const m = e.enCurso?.paso === paso ? e.enCurso.marcas : marcas(org);
    e.enCurso = { paso, marcas: m };
    guardar(e);

    await marcarAusentes(admin, sede, e);
    const dia = await diaDeLosTurnos(admin, sede, e.ofertas![0], objetivo, hoy);
    const rp = azar(paso * 7919 + 13);
    const resumen = await simularDia(admin, profesionales, e, sede, paso, objetivo, dia, rp);
    await gastosDelDia(admin, e, sede, objetivo, paso, rp);
    await liquidaciones(admin, e, sede, objetivo, paso, hoy);
    await cerrarCaja(admin, sede, rp);

    correr({
      organizationId: org,
      marcas: m,
      hoy,
      diasDeHoy: diasEntre(objetivo, hoy),
      diasDeLoAgendado: diasEntre(objetivo, dia),
      timezone: tz,
    });
    ajustarHoras(org, m, objetivo, tz);
    e.ultimoPaso = paso;
    e.enCurso = undefined;
    guardar(e);
    log(`${objetivo} (${paso + 1}/${e.dias.length}): ${resumen}`);
  }
  await marcarAusentes(admin, sede, e);

  // --- Hoy y lo que viene -----------------------------------------------------------------------
  if (!e.presente) {
    await sembrarElPresente(admin, e, sede, hoy, r);
    e.presente = true;
    guardar(e);
  }
  aplanarModificaciones(org);

  for (const p of profesionales) {
    await p.cerrar();
  }
  await admin.cerrar();

  const totales = psql(
    `select (select count(*) from persona where organization_id=${org}) personas,
            (select count(*) from turno where organization_id=${org}) turnos,
            (select count(*) from sesion where organization_id=${org} and estado='CERRADA') sesiones,
            (select count(*) from cobro where organization_id=${org}) cobros,
            (select count(*) from jornada_caja where organization_id=${org}) jornadas,
            (select count(*) from presentacion where organization_id=${org}) presentaciones;`,
  );
  log(`listo. personas|turnos|sesiones|cobros|jornadas|presentaciones = ${totales}`);
  log(`ingresá con ${correo('admin')} (o ${correo('kine1')}, ${correo('kine2')}) y ${PASSWORD}`);
});

// ---------------------------------------------------------------------------------------------
// Cuentas y configuración
// ---------------------------------------------------------------------------------------------

async function altaDeCuentas(): Promise<void> {
  const http = await fabricaDeRequest.newContext({ baseURL: API });
  const cuentas = [
    { quien: 'admin', nombre: 'Laura', apellido: 'Ferreyra', centro: NOMBRE_DEL_CENTRO },
    ...PROFESIONALES.map((p) => ({
      quien: p.clave,
      nombre: p.nombre,
      apellido: p.apellido,
      centro: `Consultorio ${p.nombre} ${p.apellido}${SUFIJO}`,
    })),
  ];
  for (const c of cuentas) {
    const alta = await conReintentoPor429(() =>
      http.post('/api/v1/auth/register', {
        headers: { 'Idempotency-Key': randomUUID() },
        data: {
          email: correo(c.quien),
          firstName: c.nombre,
          lastName: c.apellido,
          organizationName: c.centro,
          password: PASSWORD,
          aceptaTerminos: true,
          versionTerminos: TERMINOS,
        },
      }),
    );
    expect(alta.status(), `alta de ${correo(c.quien)}: ${await alta.text()}`).toBe(202);
    await activarPorMailpit(http, correo(c.quien));
  }
  await http.dispose();
}

async function configurarElCentro(
  admin: ApiAkine,
  e: Estado,
  sede: string,
  hoy: string,
  r: () => number,
): Promise<void> {
  // Profesionales vinculadas, con su horario semanal.
  if (e.profesionales === undefined) {
    const lista = [];
    for (const p of PROFESIONALES) {
      const { membershipId } = await admin.exigir<{ membershipId: number }>(
        'POST',
        '/api/v1/memberships',
        {
          email: correo(p.clave),
          roleCode: 'PROFESIONAL',
          consultorioId: e.consultorioId,
          reason: 'Profesional del Centro Demo',
        },
      );
      for (const h of p.horario) {
        await admin.exigir('POST', `${sede}/profesionales/${membershipId}/disponibilidad`, {
          diaSemana: h.d,
          horaDesde: h.desde,
          horaHasta: h.hasta,
        });
      }
      lista.push({ email: correo(p.clave), membershipId, nombre: `${p.nombre} ${p.apellido}` });
    }
    e.profesionales = lista;
    guardar(e);
  }
  const ids = e.profesionales.map((p) => p.membershipId);

  // Ofertas con precio, las dos profesionales habilitadas y la práctica de kinesiología.
  if (e.ofertas === undefined) {
    const servicioId = await servicioAgendable(admin);
    const practicaId = await practicaGlobal(admin, 'KIN_SESION');
    const ofertas = [];
    for (const o of OFERTAS) {
      const creada = await admin.exigir<{ id: number; version: number }>(
        'POST',
        `${sede}/ofertas`,
        {
          servicioId,
          nombreComercial: o.nombre,
          capacidad: 1,
          duracionMinutos: o.duracion,
          requiereProfesional: true,
          requiereEspacio: false,
          admiteObraSocial: true,
          precioBase: o.precio,
          moneda: 'ARS',
        },
      );
      const { ofertaVersion } = await admin.exigir<{ ofertaVersion: number }>(
        'PUT',
        `${sede}/ofertas/${creada.id}/habilitaciones/profesionales`,
        { expectedVersion: creada.version, ids },
      );
      await admin.exigir('PUT', `${sede}/ofertas/${creada.id}/practicas`, {
        practicaIds: [practicaId],
        practicaPrincipalId: practicaId,
        expectedVersion: ofertaVersion,
      });
      await admin.exigir('POST', `${sede}/ofertas/${creada.id}/precios-particulares`, {
        importe: o.precio,
        moneda: 'ARS',
        vigenciaDesde: hoy,
      });
      ofertas.push(creada.id);
    }
    e.ofertas = ofertas;

    // Obras sociales con su plan, convenio y lo que pagan por sesión.
    const financiadores = [];
    for (const f of FINANCIADORES) {
      const sufijo = SUFIJO.toUpperCase();
      const fin = await admin.exigir<{ id: number }>('POST', '/api/v1/financiadores', {
        codigo: `${f.codigo}${sufijo}`.slice(0, 20),
        nombre: f.nombre,
        tipo: 'OBRA_SOCIAL',
      });
      const plan = await admin.exigir<{ id: number }>(
        'POST',
        `/api/v1/financiadores/${fin.id}/planes`,
        {
          codigo: `P${f.codigo}${sufijo}`.slice(0, 20),
          nombre: f.plan,
          vigenciaDesde: hoy,
        },
      );
      const convenio = await admin.exigir<{ id: number }>('POST', `${sede}/convenios`, {
        financiadorId: fin.id,
        planId: plan.id,
        codigo: `CV${f.codigo}${sufijo}`.slice(0, 20),
        nombre: `Convenio ${f.nombre} 2026`,
        modalidad: 'POR_PRESTACION',
        vigenciaDesde: hoy,
        moneda: 'ARS',
      });
      await admin.exigir('POST', `${sede}/convenios/${convenio.id}/aranceles`, {
        practicaId,
        importeFinanciador: f.paga,
        vigenciaDesde: hoy,
      });
      financiadores.push({ id: fin.id, planId: plan.id });
    }
    e.financiadores = financiadores;
    guardar(e);
  }

  // Pacientes: persona + perfil, y algo más de la mitad con obra social.
  if (e.pacientes === undefined) {
    const pacientes: Paciente[] = [];
    const usados = new Set<string>();
    for (let i = 0; i < PACIENTES; i++) {
      let nombre: string;
      let apellido: string;
      do {
        nombre = NOMBRES[Math.floor(r() * NOMBRES.length)];
        apellido = APELLIDOS[Math.floor(r() * APELLIDOS.length)];
      } while (usados.has(`${nombre} ${apellido}`));
      usados.add(`${nombre} ${apellido}`);
      const nacimiento = `${1950 + Math.floor(r() * 55)}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`;
      const persona = await admin.exigir<{ id: number }>('POST', '/api/v1/personas', {
        nombre,
        apellido,
        tipoDocumento: 'DNI',
        numeroDocumento: String(20_000_000 + Math.floor(r() * 25_000_000)),
        fechaNacimiento: nacimiento,
        telefono: `351${String(4_000_000 + Math.floor(r() * 5_999_999))}`,
        email: `${nombre}.${apellido}`
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .concat(`${i}@correo.test`),
        confirmaPosibleDuplicado: true,
      });
      await admin.exigir('POST', `/api/v1/personas/${persona.id}/perfil-paciente`, {});
      const p: Paciente = { id: persona.id, nombre: `${nombre} ${apellido}` };
      if (r() < 0.58) {
        p.financiador = Math.floor(r() * FINANCIADORES.length);
        const fin = e.financiadores![p.financiador];
        p.coberturaId = (
          await admin.exigir<{ id: number }>('POST', `/api/v1/personas/${persona.id}/coberturas`, {
            tipo: 'FINANCIADA',
            planId: fin.planId,
            numeroAfiliado: String(100_000_000 + Math.floor(r() * 899_999_999)),
            vigenciaDesde: hoy,
            principal: true,
          })
        ).id;
      }
      pacientes.push(p);
    }
    e.pacientes = pacientes;
    guardar(e);
  }
}

/** Días hábiles (lunes a sábado, sin feriados de la sede) entre `desde` y `hasta`. */
async function diasHabiles(
  admin: ApiAkine,
  sede: string,
  desde: string,
  hasta: string,
): Promise<string[]> {
  const feriados = new Set<string>();
  for (let d = desde; d <= hasta; d = sumarDias(d, 60)) {
    const fin = sumarDias(d, 59) < hasta ? sumarDias(d, 59) : hasta;
    const cal = await admin.exigir<{ feriados: { fecha: string }[] }>(
      'GET',
      `${sede}/calendario?desde=${d}&hasta=${fin}`,
    );
    cal.feriados.forEach((f) => feriados.add(f.fecha));
  }
  const dias = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) {
    if (diaSemana(d) !== 7 && !feriados.has(d)) {
      dias.push(d);
    }
  }
  return dias;
}

/** Tratamientos: cada paciente tiene uno o dos episodios de 6 a 16 sesiones, 2 o 3 por semana. */
function planificarEpisodios(e: Estado, r: () => number): Episodio[] {
  const total = e.dias!.length;
  const patrones = [
    [1, 3],
    [2, 4],
    [1, 3, 5],
    [2, 5],
    [1, 4],
    [3, 5],
  ];
  const episodios: Episodio[] = [];
  e.pacientes!.forEach((_, paciente) => {
    const cuantos = r() < 0.35 ? 2 : 1;
    let desde = Math.floor(r() * Math.max(1, total - 20));
    for (let k = 0; k < cuantos && desde < total + 15; k++) {
      const profesional = r() < 0.55 ? 0 : 1;
      const dias = patrones[Math.floor(r() * patrones.length)];
      const sesiones = 6 + Math.floor(r() * 11);
      episodios.push({
        paciente,
        diagnostico: Math.floor(r() * DIAGNOSTICOS.length),
        profesional,
        hora: Math.floor(r() * PROFESIONALES[profesional].horas.length),
        dias,
        desdePaso: desde,
        sesiones,
        dolorInicial: 6 + Math.floor(r() * 4),
        hechas: 0,
      });
      desde += Math.ceil((sesiones / dias.length) * 6) + 5 + Math.floor(r() * 15);
    }
  });
  return episodios;
}

// ---------------------------------------------------------------------------------------------
// Un día
// ---------------------------------------------------------------------------------------------

interface Turno {
  id: number;
  version: number;
}

/** El primer día futuro con el MISMO día de la semana que el objetivo, abierto y con agenda. */
async function diaDeLosTurnos(
  admin: ApiAkine,
  sede: string,
  ofertaId: number,
  objetivo: string,
  hoy: string,
): Promise<string> {
  let d = sumarDias(hoy, 1);
  while (diaSemana(d) !== diaSemana(objetivo)) {
    d = sumarDias(d, 1);
  }
  for (let intento = 0; intento < 6; intento++, d = sumarDias(d, 7)) {
    const agenda = await admin.exigir<{ dias: { slots: unknown[] }[] }>(
      'GET',
      `${sede}/ofertas/${ofertaId}/agenda?desde=${d}&hasta=${sumarDias(d, 1)}`,
    );
    if ((agenda.dias[0]?.slots.length ?? 0) > 0) {
      return d;
    }
  }
  throw new Error(`no hay un ${objetivo} futuro con agenda`);
}

async function simularDia(
  admin: ApiAkine,
  profesionales: ApiAkine[],
  e: Estado,
  sede: string,
  paso: number,
  objetivo: string,
  dia: string,
  r: () => number,
): Promise<string> {
  await asegurarCajaAbierta(admin, sede, 20000 + Math.round(r() * 10) * 1000);
  const tz = e.timezone!;
  const ds = diaSemana(objetivo);
  const delDia = e.episodios!.filter(
    (ep) =>
      ep.desdePaso <= paso &&
      ep.hechas < ep.sesiones &&
      (ep.dias.includes(ds) || (ds === 6 && ep.profesional === 0 && r() < 0.15)),
  );
  // La profesional de la tarde no atiende sábados.
  const atendibles = delDia.filter((ep) => !(ds === 6 && ep.profesional === 1));
  let atendidos = 0;
  let ausentes = 0;
  let cancelados = 0;
  let cobrado = 0;

  for (const ep of atendibles) {
    const paciente = e.pacientes![ep.paciente];
    const profesional = e.profesionales![ep.profesional];
    const ofertaId = e.ofertas![DIAGNOSTICOS[ep.diagnostico].oferta];
    const turno = await reservarCerca(
      admin,
      sede,
      ofertaId,
      profesional.membershipId,
      paciente,
      dia,
      ep,
      tz,
    );
    if (turno === null) {
      continue;
    }
    const suerte = r();
    if (suerte < 0.07) {
      await admin.exigir('POST', `${sede}/turnos/${turno.id}/cancelacion`, {
        expectedVersion: turno.version,
        motivo: r() < 0.5 ? 'El paciente avisó que no puede venir' : 'Reprograma por trabajo',
        origen: 'PACIENTE',
      });
      cancelados++;
      continue;
    }
    if (suerte < 0.15) {
      e.ausentesPendientes = [...(e.ausentesPendientes ?? []), turno.id];
      ausentes++;
      continue;
    }
    await atender(profesionales[ep.profesional], e, sede, turno.id, ep, ofertaId, r);
    atendidos++;
    cobrado += await cobrarLoPendiente(admin, sede, paciente, r);
  }
  guardar(e);
  return `${atendidos} atendidos, ${ausentes} ausentes, ${cancelados} cancelados, $${cobrado} cobrados`;
}

/** Reserva lo más cerca posible de la hora habitual del paciente con su profesional. */
async function reservarCerca(
  admin: ApiAkine,
  sede: string,
  ofertaId: number,
  profesionalId: number,
  paciente: Paciente,
  dia: string,
  ep: Episodio,
  tz: string,
): Promise<Turno | null> {
  const horas = PROFESIONALES[ep.profesional].horas;
  const orden = horas
    .map((h, i) => ({ h, d: Math.abs(i - ep.hora) }))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.h);
  for (const h of orden) {
    const respuesta = await admin.pedir('POST', `${sede}/turnos/ofertas/${ofertaId}`, {
      inicio: instanteEnZona(dia, h, tz),
      personaId: paciente.id,
      profesionalId,
      coberturaId: paciente.coberturaId,
      idempotencyKey: randomUUID(),
    });
    if (respuesta.status() === 201) {
      return (await respuesta.json()) as Turno;
    }
    expect([409, 400, 422], `reserva ${dia} ${h}: ${await respuesta.text()}`).toContain(
      respuesta.status(),
    );
  }
  return null;
}

/** La profesional inicia la sesión, la asocia al caso, carga la evaluación y la cierra. */
async function atender(
  prof: ApiAkine,
  e: Estado,
  sede: string,
  turnoId: number,
  ep: Episodio,
  ofertaId: number,
  r: () => number,
): Promise<void> {
  const dx = DIAGNOSTICOS[ep.diagnostico];
  const paciente = e.pacientes![ep.paciente];
  // Cada episodio es un Caso Clínico propio: las ofertas lo exigen para atender (RF-M10-007).
  if (!ep.casoId) {
    const hc = await exigirCon<{ id: number }>(
      prof,
      'PUT',
      `/api/v1/historias-clinicas/por-persona/${paciente.id}`,
      undefined,
      JUSTIFICACION,
    );
    const caso = await exigirCon<{ id: number }>(
      prof,
      'POST',
      `/api/v1/historias-clinicas/${hc.id}/casos`,
      {
        ofertaId,
        diagnosticoPresuntivo: dx.texto,
        objetivoTerapeutico: dx.objetivo,
        equipo: [
          {
            profesionalMembershipId: e.profesionales![ep.profesional].membershipId,
            rol: 'RESPONSABLE',
          },
        ],
        confirmaPosibleDuplicado: true,
      },
      JUSTIFICACION,
    );
    ep.casoId = caso.id;
  }

  let sesion = await prof.exigir<{ id: number; version: number }>(
    'POST',
    `${sede}/sesiones/turnos/${turnoId}?casoId=${ep.casoId}`,
  );
  const ruta = `${sede}/sesiones/${sesion.id}`;

  const n = ep.hechas;
  const avance = ep.sesiones <= 1 ? 1 : n / (ep.sesiones - 1);
  const ruido = Math.round(r() * 2) - 1;
  const dolor = Math.max(
    0,
    Math.min(10, Math.round(ep.dolorInicial * (1 - 0.75 * avance)) + ruido),
  );
  const evolucion =
    n === 0 ? 'SIN_REFERENCIA' : r() < 0.72 ? 'MEJOR' : r() < 0.8 ? 'IGUAL' : 'PEOR';
  const evaluada = await prof.pedir('PUT', `${ruta}/evaluacion`, {
    version: sesion.version,
    modo: n === 0 ? 'COMPLETA' : 'RAPIDA',
    motivoClinico: dx.texto,
    dolorEva: dolor,
    dolorZona: dx.zona,
    dolorLateralidad: dx.lado,
    evolucion,
    objetivoSesion: dx.objetivo,
  });
  sesion = evaluada.ok()
    ? ((await evaluada.json()) as typeof sesion)
    : await prof.exigir('GET', ruta);

  const ultima = n + 1 >= ep.sesiones;
  await prof.exigir('POST', `${ruta}/cierre`, {
    version: sesion.version,
    asistencia: 'PRESENTE',
    tolerancia: r() < 0.85 ? 'BUENA' : 'REGULAR',
    respuestaTratamiento: elegir(RESPUESTAS, r),
    proximaConducta: ultima ? 'ALTA' : 'CONTINUA',
    indicaciones: elegir(INDICACIONES, r),
    notaDeCierre: ultima ? 'Se otorga el alta: objetivos cumplidos.' : elegir(NOTAS, r),
  });
  ep.hechas++;
}

interface Obligacion {
  id: number;
  saldo: number;
  responsable: string;
  estado: string;
}

/** Cobra lo que el paciente debe (la sesión de hoy y lo atrasado). A veces queda debiendo. */
async function cobrarLoPendiente(
  admin: ApiAkine,
  sede: string,
  p: Paciente,
  r: () => number,
): Promise<number> {
  const deudas = (
    await admin.exigir<Obligacion[]>('GET', `${sede}/obligaciones?personaId=${p.id}`)
  ).filter((o) => o.responsable !== 'FINANCIADOR' && o.saldo > 0 && o.estado !== 'ANULADA');
  if (deudas.length === 0 || r() < 0.12) {
    return 0;
  }
  const total = deudas.reduce((s, o) => s + Number(o.saldo), 0);
  const x = r();
  const medio =
    x < 0.4
      ? 'EFECTIVO'
      : x < 0.7
        ? 'TRANSFERENCIA'
        : x < 0.9
          ? 'TARJETA_DEBITO'
          : 'TARJETA_CREDITO';
  await admin.exigir('POST', `${sede}/cobros`, {
    personaId: p.id,
    total,
    moneda: 'ARS',
    medios: [{ medio, importe: total }],
    imputaciones: deudas.map((o) => ({ obligacionId: o.id, importe: Number(o.saldo) })),
    idempotencyKey: randomUUID(),
  });
  return total;
}

async function marcarAusentes(admin: ApiAkine, sede: string, e: Estado): Promise<void> {
  for (const id of e.ausentesPendientes ?? []) {
    const turno = await admin.exigir<{ version: number; inicio: string; estado: string }>(
      'GET',
      `${sede}/turnos/${id}`,
    );
    if (Date.parse(turno.inicio) < Date.now() && turno.estado !== 'AUSENTE') {
      await admin.exigir('POST', `${sede}/turnos/${id}/ausencia`, {
        expectedVersion: turno.version,
        motivo: 'No vino y no avisó',
      });
    }
  }
  e.ausentesPendientes = [];
  guardar(e);
}

// ---------------------------------------------------------------------------------------------
// Caja, egresos y liquidaciones
// ---------------------------------------------------------------------------------------------

interface Jornada {
  id: number;
  saldoTeorico: number;
}

async function jornadaAbierta(admin: ApiAkine, sede: string): Promise<Jornada | null> {
  const [abierta] = await admin.exigir<Jornada[]>(
    'GET',
    `${sede}/caja/jornadas?estado=ABIERTA&limite=1`,
  );
  return abierta === undefined ? null : admin.exigir('GET', `${sede}/caja/jornadas/${abierta.id}`);
}

async function asegurarCajaAbierta(
  admin: ApiAkine,
  sede: string,
  saldoInicial: number,
): Promise<void> {
  if ((await jornadaAbierta(admin, sede)) === null) {
    await admin.exigir('POST', `${sede}/caja/jornadas`, { moneda: 'ARS', saldoInicial });
  }
}

async function cerrarCaja(admin: ApiAkine, sede: string, r: () => number): Promise<void> {
  const j = await jornadaAbierta(admin, sede);
  if (j === null) {
    return;
  }
  const faltante = r() < 0.06 ? 500 : 0;
  await admin.exigir('POST', `${sede}/caja/jornadas/${j.id}/cierre`, {
    saldoTeoricoEsperado: j.saldoTeorico,
    saldoDeclarado: Number(j.saldoTeorico) - faltante,
    motivoDiferencia: faltante ? 'Faltante de cambio' : undefined,
  });
}

async function egreso(
  admin: ApiAkine,
  sede: string,
  datos: Record<string, unknown>,
  medio: 'TRANSFERENCIA' | 'EFECTIVO',
): Promise<void> {
  const creado = await admin.exigir<{ id: number }>('POST', `${sede}/egresos`, {
    moneda: 'ARS',
    tipoBeneficiario: 'EXTERNO',
    idempotencyKey: randomUUID(),
    ...datos,
  });
  await admin.exigir('POST', `${sede}/egresos/${creado.id}/confirmacion`);
  await admin.exigir('POST', `${sede}/egresos/${creado.id}/pagos`, {
    importe: datos['importeTotal'],
    medio,
    idempotencyKey: randomUUID(),
  });
}

async function gastosDelDia(
  admin: ApiAkine,
  e: Estado,
  sede: string,
  objetivo: string,
  paso: number,
  r: () => number,
): Promise<void> {
  const mes = objetivo.slice(0, 7);
  const nuevoMes = paso === 0 || e.dias![paso - 1].slice(0, 7) !== mes;
  const factura = () => `0001-${String(Math.floor(r() * 99_999_999)).padStart(8, '0')}`;
  if (nuevoMes) {
    await egreso(
      admin,
      sede,
      {
        categoria: 'ALQUILER',
        concepto: `Alquiler del local, ${nombreDelMes(mes)}`,
        importeTotal: 650000,
        beneficiarioNombre: 'Inmobiliaria Demo SRL',
        comprobanteTipo: 'Factura C',
        comprobanteNumero: factura(),
      },
      'TRANSFERENCIA',
    );
    await egreso(
      admin,
      sede,
      {
        categoria: 'SERVICIOS',
        concepto: `Luz e internet, ${nombreDelMes(mes)}`,
        importeTotal: 92000 + Math.round(r() * 20) * 1000,
        beneficiarioNombre: 'Servicios Demo SA',
        comprobanteTipo: 'Factura B',
        comprobanteNumero: factura(),
      },
      'TRANSFERENCIA',
    );
    if (paso > 0) {
      // Honorarios del mes que terminó, por las sesiones que cada profesional cerró.
      const anterior = e.dias![paso - 1].slice(0, 7);
      for (const p of e.profesionales!) {
        const sesiones = Number(
          psql(`select count(*) from sesion where organization_id=${e.organizationId} and estado='CERRADA'
                and profesional_membership_id=${p.membershipId}
                and to_char(cerrada_en at time zone '${e.timezone}', 'YYYY-MM')='${anterior}';`),
        );
        if (sesiones > 0) {
          await egreso(
            admin,
            sede,
            {
              categoria: 'HONORARIOS_PROFESIONALES',
              concepto: `Honorarios de ${nombreDelMes(anterior)}`,
              importeTotal: sesiones * 8000,
              tipoBeneficiario: 'COLABORADOR',
              beneficiarioMembershipId: p.membershipId,
              comprobanteTipo: 'Factura C',
              comprobanteNumero: factura(),
              periodoDesde: `${anterior}-01`,
              periodoHasta: finDeMes(anterior),
            },
            'TRANSFERENCIA',
          );
        }
      }
    }
  }
  if (diaSemana(objetivo) === 5) {
    await egreso(
      admin,
      sede,
      {
        categoria: 'INSUMOS',
        concepto: elegir(
          ['Cremas y geles', 'Vendas y tape', 'Bandas elásticas', 'Papel de camilla'],
          r,
        ),
        importeTotal: 18000 + Math.round(r() * 40) * 1000,
        beneficiarioNombre: 'Ortopedia Demo',
        comprobanteTipo: 'Ticket',
        comprobanteNumero: factura(),
      },
      'TRANSFERENCIA',
    );
  }
  if (r() < 0.12 && (await jornadaAbierta(admin, sede)) !== null) {
    await admin.exigir('POST', `${sede}/caja/movimientos`, {
      tipo: 'EGRESO',
      importe: 3000 + Math.round(r() * 5) * 500,
      concepto: elegir(['Artículos de limpieza', 'Café y azúcar', 'Fotocopias'], r),
      medio: 'EFECTIVO',
      idempotencyKey: randomUUID(),
    });
  }
}

/**
 * Liquidación mensual a cada obra social: al empezar el mes se presenta lo del mes anterior
 * (borrador → presentada, con factura) y pasado el día 18 la obra social paga y se concilia.
 */
async function liquidaciones(
  admin: ApiAkine,
  e: Estado,
  sede: string,
  objetivo: string,
  paso: number,
  hoy: string,
): Promise<void> {
  e.presentaciones ??= [];
  const mes = objetivo.slice(0, 7);
  const nuevoMes = paso > 0 && e.dias![paso - 1].slice(0, 7) !== mes;
  if (nuevoMes) {
    const anterior = e.dias![paso - 1].slice(0, 7);
    for (const f of e.financiadores!) {
      const elegibles = await admin.exigir<{ id: number }[]>(
        'GET',
        `${sede}/prestaciones-elegibles?financiadorId=${f.id}&desde=${anterior}-01&hasta=${finDeMes(anterior)}&limite=500`,
      );
      if (elegibles.length === 0) {
        continue;
      }
      const lote = await admin.exigir<{ id: number }>('POST', `${sede}/presentaciones`, {
        financiadorId: f.id,
        moneda: 'ARS',
        periodoDesde: `${anterior}-01`,
        periodoHasta: finDeMes(anterior),
        obligacionIds: elegibles.map((o) => o.id),
      });
      await admin.exigir('POST', `${sede}/presentaciones/${lote.id}/confirmacion`);
      await admin.exigir('POST', `${sede}/presentaciones/${lote.id}/factura`, {
        numero: `0002-${String(10000 + e.presentaciones.length).padStart(8, '0')}`,
        fecha: hoy,
      });
      e.presentaciones.push({ id: lote.id, mes: anterior, pagado: false });
    }
  }
  if (Number(objetivo.slice(8)) >= 18) {
    for (const p of e.presentaciones.filter((x) => !x.pagado && x.mes < mes)) {
      const lote = await admin.exigir<{
        total?: number;
        importeTotal?: number;
        saldo?: number;
        saldoPendiente?: number;
      }>('GET', `${sede}/presentaciones/${p.id}`);
      const importe = Number(
        lote.saldoPendiente ?? lote.saldo ?? lote.importeTotal ?? lote.total ?? 0,
      );
      if (importe > 0) {
        await admin.exigir('POST', `${sede}/presentaciones/${p.id}/pagos`, {
          fechaPago: hoy,
          importe,
          medio: 'TRANSFERENCIA',
          referencia: `TRF-${p.id}`,
          idempotencyKey: randomUUID(),
        });
      }
      const conciliada = await admin.pedir('POST', `${sede}/presentaciones/${p.id}/conciliacion`);
      if (!conciliada.ok()) {
        log(
          `conciliación ${p.id}: ${conciliada.status()} ${(await conciliada.text()).slice(0, 200)}`,
        );
      }
      p.pagado = true;
    }
  }
  guardar(e);
}

// ---------------------------------------------------------------------------------------------
// Hoy y las próximas semanas
// ---------------------------------------------------------------------------------------------

async function sembrarElPresente(
  admin: ApiAkine,
  e: Estado,
  sede: string,
  hoy: string,
  r: () => number,
): Promise<void> {
  const tz = e.timezone!;
  await asegurarCajaAbierta(admin, sede, 25000);
  // Las próximas tres semanas: los tratamientos que siguen, más pacientes nuevos que arrancan.
  const activos = e.episodios!.filter((ep) => ep.hechas < ep.sesiones);
  let reservados = 0;
  const llegados: number[] = [];
  for (let d = 0; d <= 21; d++) {
    const dia = sumarDias(hoy, d);
    const ds = diaSemana(dia);
    if (ds === 7) {
      continue;
    }
    for (const ep of activos.filter(
      (x) => x.dias.includes(ds) && !(ds === 6 && x.profesional === 1),
    )) {
      const paciente = e.pacientes![ep.paciente];
      const prof = e.profesionales![ep.profesional];
      const ofertaId = e.ofertas![DIAGNOSTICOS[ep.diagnostico].oferta];
      if (d === 0) {
        // Hoy: sólo lo que todavía no empezó.
        const futuras = PROFESIONALES[ep.profesional].horas.filter(
          (h) => Date.parse(instanteEnZona(dia, h, tz)) > Date.now() + 10 * 60_000,
        );
        if (futuras.length === 0) {
          continue;
        }
      }
      const turno = await reservarCerca(
        admin,
        sede,
        ofertaId,
        prof.membershipId,
        paciente,
        dia,
        ep,
        tz,
      );
      if (turno !== null) {
        reservados++;
        if (d === 0 && llegados.length < 2) {
          llegados.push(turno.id);
        }
      }
    }
  }
  // Recepción de hoy: dos pacientes ya llegaron.
  for (const id of llegados) {
    const recepcion = await admin.pedir('POST', `${sede}/turnos/${id}/recepcion`);
    if (!recepcion.ok()) {
      await admin.pedir('POST', `${sede}/turnos/${id}/llegada`);
    }
  }
  // Algunos pacientes con deuda pasan hoy a pagar.
  let pagaron = 0;
  for (const p of e.pacientes!) {
    if (r() < 0.25) {
      pagaron += (await cobrarLoPendiente(admin, sede, p, () => 0.5)) > 0 ? 1 : 0;
    }
  }
  log(
    `presente: ${reservados} turnos reservados de hoy a 3 semanas, ${llegados.length} en recepción, ${pagaron} pagaron deudas hoy`,
  );
}

// ---------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------

/** 1 = lunes … 7 = domingo. */
function diaSemana(fecha: string): number {
  return new Date(`${fecha}T12:00:00Z`).getUTCDay() || 7;
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round(
    (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000,
  );
}

function finDeMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

function nombreDelMes(mes: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${mes}-15T12:00:00Z`));
}

function elegir<T>(lista: readonly T[], r: () => number): T {
  return lista[Math.floor(r() * lista.length)];
}
