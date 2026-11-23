import { randomUUID } from 'node:crypto';

import { ApiAkine, servicioAgendable } from '../support/sembrado';
import { instanteEnZona } from '../support/sembrado-asistencia';
import { APELLIDOS, NOMBRES } from './datos-demo';

/**
 * Clases grupales y pases del Centro Demo (F9): Pilates con pack de clases, Funcional con abono
 * mensual y Yoga que se paga por clase.
 *
 * <p>Cada día simulado tiene dos momentos. Antes de correr las fechas se venden los pases que hacen
 * falta, se programa la clase en el día futuro y se inscribe a la gente. Después de correrlas, con la
 * clase ya en el día objetivo, se la inicia, se toma asistencia y se la cierra: el consumo del pase se
 * valida contra el día de la clase (`ConsumoDePaseService`), y para entonces el pase ya está fechado
 * en el pasado. Ese segundo momento se corre aparte con el mismo día objetivo.
 */

/** Las clases fijas de la semana. `dias`: 1 = lunes. */
export const GRUPALES = [
  {
    clave: 'pilates',
    nombre: 'Pilates',
    esquema: 'POR_PACK',
    capacidad: 8,
    duracion: 60,
    horarios: [
      { dias: [1, 3, 5], desde: '09:00', hasta: '10:00', titulo: 'Pilates de la mañana' },
      { dias: [2, 4], desde: '19:00', hasta: '20:00', titulo: 'Pilates de la tarde' },
    ],
  },
  {
    clave: 'funcional',
    nombre: 'Entrenamiento funcional',
    esquema: 'POR_ABONO',
    capacidad: 10,
    duracion: 60,
    horarios: [{ dias: [2, 4], desde: '08:00', hasta: '09:00', titulo: 'Funcional temprano' }],
  },
  {
    clave: 'yoga',
    nombre: 'Yoga terapéutico',
    esquema: 'POR_CLASE',
    capacidad: 8,
    duracion: 75,
    precio: 9000,
    horarios: [{ dias: [6], desde: '10:00', hasta: '11:15', titulo: 'Yoga del sábado' }],
  },
] as const;

const PACK = {
  nombre: 'Pack de 8 clases de Pilates',
  creditos: 8,
  precio: 56000,
  vigenciaDias: 60,
};
// En un abono, `creditos` son las asistencias por período y `vigenciaDias` el largo máximo del período.
const ABONO = {
  nombre: 'Abono mensual de Funcional',
  precio: 38000,
  creditos: 12,
  vigenciaDias: 31,
};

export interface Alumno {
  id: number;
  /** Índices de horarios de Pilates (0 mañana, 1 tarde), o vacío si no hace Pilates. */
  pilates: number[];
  funcional: boolean;
  yoga: boolean;
  creditos: number;
  /** Meses `YYYY-MM` con abono de Funcional vendido. */
  abonos: string[];
}

export interface EstadoClases {
  ofertas: Record<string, number>;
  packId: number;
  abonoId: number;
  alumnos: Alumno[];
  /** Clases programadas en el paso en curso, para dictarlas después de correr las fechas. */
  pendientes?: { id: number; clave: string }[];
}

type Azar = () => number;

/** Ofertas grupales, productos y alumnos. Se corre como parte del alta del centro. */
export async function configurarClases(
  admin: ApiAkine,
  sede: string,
  hoy: string,
  r: Azar,
): Promise<EstadoClases> {
  const servicioId = await servicioAgendable(admin);
  const ofertas: Record<string, number> = {};
  // Reanudable: lo que ya existe se reusa por nombre.
  const existentes = await admin.exigir<{ id: number; nombreComercial: string }[]>(
    'GET',
    `${sede}/ofertas`,
  );
  const productos = await admin.exigir<{ id: number; nombre: string }[]>(
    'GET',
    `${sede}/productos`,
  );
  for (const g of GRUPALES) {
    const ya = existentes.find((o) => o.nombreComercial === g.nombre);
    if (ya) {
      ofertas[g.clave] = ya.id;
      continue;
    }
    const o = await admin.exigir<{ id: number }>('POST', `${sede}/ofertas`, {
      servicioId,
      nombreComercial: g.nombre,
      modalidad: 'GRUPAL',
      capacidad: g.capacidad,
      duracionMinutos: g.duracion,
      requiereProfesional: false,
      requiereEspacio: false,
      requiereCasoClinico: false,
      esquemaCobro: g.esquema,
      ...('precio' in g ? { precioBase: g.precio, moneda: 'ARS' } : {}),
    });
    if ('precio' in g) {
      await admin.exigir('POST', `${sede}/ofertas/${o.id}/precios-particulares`, {
        importe: g.precio,
        moneda: 'ARS',
        vigenciaDesde: hoy,
      });
    }
    ofertas[g.clave] = o.id;
  }
  const pack =
    productos.find((p) => p.nombre === PACK.nombre) ??
    (await admin.exigir<{ id: number }>('POST', `${sede}/productos`, {
      ofertaId: ofertas['pilates'],
      nombre: PACK.nombre,
      tipo: 'PACK',
      creditos: PACK.creditos,
      precio: PACK.precio,
      moneda: 'ARS',
      vigenciaDias: PACK.vigenciaDias,
      vigenciaDesde: hoy,
    }));
  const abono =
    productos.find((p) => p.nombre === ABONO.nombre) ??
    (await admin.exigir<{ id: number }>('POST', `${sede}/productos`, {
      ofertaId: ofertas['funcional'],
      nombre: ABONO.nombre,
      tipo: 'ABONO',
      creditos: ABONO.creditos,
      vigenciaDias: ABONO.vigenciaDias,
      precio: ABONO.precio,
      moneda: 'ARS',
      vigenciaDesde: hoy,
    }));

  // Alumnos: personas del padrón, no pacientes. Cada uno hace una o dos actividades.
  const alumnos: Alumno[] = [];
  for (let i = 0; i < 18; i++) {
    const nombre = NOMBRES[(i * 7 + 3) % NOMBRES.length];
    const apellido = APELLIDOS[(i * 11 + 5) % APELLIDOS.length];
    const persona = await admin.exigir<{ id: number }>('POST', '/api/v1/personas', {
      nombre,
      apellido,
      tipoDocumento: 'DNI',
      numeroDocumento: String(25_000_000 + Math.floor(r() * 20_000_000)),
      telefono: `351${String(5_000_000 + Math.floor(r() * 4_999_999))}`,
      confirmaPosibleDuplicado: true,
    });
    const x = r();
    alumnos.push({
      id: persona.id,
      pilates: x < 0.6 ? [i % 2] : [],
      funcional: x >= 0.4 && x < 0.85,
      yoga: x >= 0.75 || r() < 0.25,
      creditos: 0,
      abonos: [],
    });
  }
  return { ofertas, packId: pack.id, abonoId: abono.id, alumnos };
}

/** Quién va a cada clase del día de la semana `ds`, por horario. */
function clasesDelDia(c: EstadoClases, ds: number) {
  const lista: {
    clave: string;
    titulo: string;
    desde: string;
    hasta: string;
    capacidad: number;
    alumnos: Alumno[];
  }[] = [];
  for (const g of GRUPALES) {
    g.horarios.forEach((h, i) => {
      if (!(h.dias as readonly number[]).includes(ds)) {
        return;
      }
      const alumnos = c.alumnos.filter((a) =>
        g.clave === 'pilates'
          ? a.pilates.includes(i)
          : g.clave === 'funcional'
            ? a.funcional
            : a.yoga,
      );
      lista.push({
        clave: g.clave,
        titulo: h.titulo,
        desde: h.desde,
        hasta: h.hasta,
        capacidad: g.capacidad,
        alumnos,
      });
    });
  }
  return lista;
}

/**
 * Antes de correr las fechas: vende los pases que faltan (y los cobra), programa las clases del día
 * en `dia` e inscribe. `medio` es EFECTIVO sólo si hay caja abierta.
 */
export async function prepararClases(
  admin: ApiAkine,
  c: EstadoClases,
  sede: string,
  objetivo: string,
  dia: string,
  tz: string,
  medio: () => string,
  r: Azar,
): Promise<string> {
  const ds = new Date(`${objetivo}T12:00:00Z`).getUTCDay() || 7;
  const mes = objetivo.slice(0, 7);
  const clases = clasesDelDia(c, ds);
  let vendidos = 0;
  c.pendientes = [];
  for (const clase of clases) {
    const creada = await admin.exigir<{ id: number }>(
      'POST',
      `${sede}/clases/ofertas/${c.ofertas[clase.clave]}`,
      {
        titulo: clase.titulo,
        capacidad: clase.capacidad,
        inicio: instanteEnZona(dia, clase.desde, tz),
        fin: instanteEnZona(dia, clase.hasta, tz),
        idempotencyKey: randomUUID(),
      },
    );
    for (const a of clase.alumnos) {
      // Alguno falta sin inscribirse: no todos van a todas.
      if (r() < 0.08) {
        continue;
      }
      if (clase.clave === 'pilates' && a.creditos <= 0) {
        await vender(admin, sede, a.id, { productoId: c.packId }, PACK.precio, medio());
        a.creditos += PACK.creditos;
        vendidos++;
      }
      if (clase.clave === 'funcional' && !a.abonos.includes(mes)) {
        await vender(
          admin,
          sede,
          a.id,
          { productoId: c.abonoId, periodoDesde: `${mes}-01`, periodoHasta: finDeMes(mes) },
          ABONO.precio,
          medio(),
        );
        a.abonos.push(mes);
        vendidos++;
      }
      await admin.exigir('POST', `${sede}/clases/${creada.id}/inscripciones`, {
        personaId: a.id,
        aceptaListaEspera: false,
        idempotencyKey: randomUUID(),
      });
      if (clase.clave === 'pilates') {
        a.creditos--;
      }
    }
    c.pendientes.push({ id: creada.id, clave: clase.clave });
  }
  return `${clases.length} clases, ${vendidos} pases vendidos`;
}

/** Después de correr las fechas: la clase empieza, se toma asistencia, se cierra y se cobra Yoga. */
export async function dictarClases(
  admin: ApiAkine,
  c: EstadoClases,
  sede: string,
  r: Azar,
): Promise<void> {
  for (const { id: claseId, clave } of c.pendientes ?? []) {
    await admin.exigir('POST', `${sede}/clases/${claseId}/inicio`);
    const participantes = (
      await admin.exigir<{ inscripcion?: { id?: number; personaId?: number; estado?: string } }[]>(
        'GET',
        `${sede}/clases/${claseId}/inscripciones`,
      )
    )
      .map((p) => p.inscripcion)
      .filter((i) => i?.id !== undefined && i.estado !== 'CANCELADA' && i.estado !== 'EN_ESPERA');
    const items = participantes.map((i) => {
      const x = r();
      return {
        inscripcionId: i!.id!,
        resultado: x < 0.86 ? 'PRESENTE' : x < 0.92 ? 'PRESENTE_TARDE' : 'AUSENTE',
      };
    });
    if (items.length > 0) {
      await admin.exigir('POST', `${sede}/clases/${claseId}/asistencias/lote`, { items });
    }
    await admin.exigir('POST', `${sede}/clases/${claseId}/cierre`);
    // Yoga se paga por clase: la deuda nace con la asistencia y se cobra en el momento.
    if (clave === 'yoga') {
      for (const p of participantes) {
        await cobrarDeudas(admin, sede, p!.personaId!, 'TRANSFERENCIA');
      }
    }
  }
  c.pendientes = [];
}

/** Las clases de las próximas tres semanas, programadas y con inscriptos. */
export async function presenteDeClases(
  admin: ApiAkine,
  c: EstadoClases,
  sede: string,
  hoy: string,
  tz: string,
  medio: () => string,
  r: Azar,
): Promise<number> {
  let programadas = 0;
  for (let d = 0; d <= 21; d++) {
    const dia = sumar(hoy, d);
    const ds = new Date(`${dia}T12:00:00Z`).getUTCDay() || 7;
    for (const clase of clasesDelDia(c, ds)) {
      if (Date.parse(instanteEnZona(dia, clase.desde, tz)) < Date.now() + 15 * 60_000) {
        continue;
      }
      const respuesta = await admin.pedir(
        'POST',
        `${sede}/clases/ofertas/${c.ofertas[clase.clave]}`,
        {
          titulo: clase.titulo,
          capacidad: clase.capacidad,
          inicio: instanteEnZona(dia, clase.desde, tz),
          fin: instanteEnZona(dia, clase.hasta, tz),
          idempotencyKey: randomUUID(),
        },
      );
      // Un feriado cierra la sede: esa clase no se programa.
      if (!respuesta.ok()) {
        continue;
      }
      const { id } = (await respuesta.json()) as { id: number };
      programadas++;
      for (const a of clase.alumnos) {
        if (r() < 0.15) {
          continue;
        }
        const mes = dia.slice(0, 7);
        if (clase.clave === 'pilates' && a.creditos <= 0) {
          await vender(admin, sede, a.id, { productoId: c.packId }, PACK.precio, medio());
          a.creditos += PACK.creditos;
        }
        if (clase.clave === 'funcional' && !a.abonos.includes(mes)) {
          await vender(
            admin,
            sede,
            a.id,
            { productoId: c.abonoId, periodoDesde: `${mes}-01`, periodoHasta: finDeMes(mes) },
            ABONO.precio,
            medio(),
          );
          a.abonos.push(mes);
        }
        await admin.exigir('POST', `${sede}/clases/${id}/inscripciones`, {
          personaId: a.id,
          aceptaListaEspera: true,
          idempotencyKey: randomUUID(),
        });
        if (clase.clave === 'pilates') {
          a.creditos--;
        }
      }
    }
  }
  return programadas;
}

async function vender(
  admin: ApiAkine,
  sede: string,
  personaId: number,
  datos: Record<string, unknown>,
  precio: number,
  medio: string,
): Promise<void> {
  const venta = await admin.exigir<{ deuda?: { obligacionId?: number; id?: number } }>(
    'POST',
    `${sede}/pases`,
    { personaId, idempotencyKey: randomUUID(), ...datos },
  );
  const obligacionId = venta.deuda?.obligacionId ?? venta.deuda?.id;
  if (obligacionId !== undefined) {
    await admin.exigir('POST', `${sede}/cobros`, {
      personaId,
      total: precio,
      moneda: 'ARS',
      medios: [{ medio, importe: precio }],
      imputaciones: [{ obligacionId, importe: precio }],
      idempotencyKey: randomUUID(),
    });
  } else {
    await cobrarDeudas(admin, sede, personaId, medio);
  }
}

async function cobrarDeudas(
  admin: ApiAkine,
  sede: string,
  personaId: number,
  medio: string,
): Promise<void> {
  const deudas = (
    await admin.exigir<{ id: number; saldo: number; responsable: string; estado: string }[]>(
      'GET',
      `${sede}/obligaciones?personaId=${personaId}`,
    )
  ).filter((o) => o.responsable !== 'FINANCIADOR' && Number(o.saldo) > 0 && o.estado !== 'ANULADA');
  if (deudas.length === 0) {
    return;
  }
  const total = deudas.reduce((s, o) => s + Number(o.saldo), 0);
  await admin.exigir('POST', `${sede}/cobros`, {
    personaId,
    total,
    moneda: 'ARS',
    medios: [{ medio, importe: total }],
    imputaciones: deudas.map((o) => ({ obligacionId: o.id, importe: Number(o.saldo) })),
    idempotencyKey: randomUUID(),
  });
}

function finDeMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

function sumar(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
