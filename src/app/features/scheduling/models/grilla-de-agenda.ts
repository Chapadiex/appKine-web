import { AgendaOperativa } from '../../../api/generated/model/agenda-operativa';
import { TurnoDeCalendario } from '../../../api/generated/model/turno-de-calendario';
import { sumarDias } from './etiquetas-de-agenda';
import { MOTIVOS_DE_BLOQUEO } from './etiquetas-de-turno';
import { diaEnZona } from './semana';

/**
 * El calculo de la grilla de la agenda, sin nada de Angular.
 *
 * <p>Una columna es un profesional, un box o un dia, segun la vista. Lo que cambia entre vistas es como
 * se reparten las mismas cosas; por eso todo sale de {@link armarColumnas}.
 */
export type VistaDeAgenda = 'dia' | 'semana';
export type AgrupacionDeAgenda = 'profesional' | 'box';

/** Cada cuantos minutos se ofrece un horario libre si no hay prestaciones de donde sacarlo. */
export const PASO_DE_CELDA_MIN = 30;

/**
 * Ninguna celda baja de esto, que a la escala de la grilla son los 24 px de un objetivo tactil: una
 * prestacion de cinco minutos no llena la agenda de botones que no se pueden tocar. Sus horarios
 * exactos siguen en la busqueda de disponibilidad.
 */
const PASO_MINIMO_DE_CELDA_MIN = 20;

/**
 * El paso de las celdas sale de lo que el centro presta: la duracion de la prestacion filtrada o, si no
 * hay filtro, la mas corta. Asi una kinesiologia de 45 minutos ofrece horarios cada 45, y no hay un
 * segundo numero que configurar. La hora exacta la valida el backend igual.
 */
export function pasoDeCelda(
  duraciones: readonly (number | undefined)[],
  duracionFiltrada?: number,
): number {
  if (duracionFiltrada !== undefined && duracionFiltrada > 0) {
    return duracionFiltrada;
  }
  const validas = duraciones.filter((d): d is number => d !== undefined && d > 0);
  return validas.length > 0 ? Math.min(...validas) : PASO_DE_CELDA_MIN;
}
const INICIO_POR_DEFECTO_MIN = 8 * 60;
const FIN_POR_DEFECTO_MIN = 20 * 60;
const MINUTOS_DEL_DIA = 24 * 60;

export interface EventoDeGrilla {
  readonly clave: string;
  readonly tipo: 'turno' | 'clase' | 'bloqueo';
  readonly inicioMin: number;
  readonly finMin: number;
  /** El carril dentro del grupo que se pisa, para dibujar lado a lado sin taparse. */
  readonly carril: number;
  readonly carriles: number;
  readonly turno?: TurnoDeCalendario;
  readonly titulo: string;
  readonly detalle: string;
  readonly excepcionId?: number;
  /** De quien es el bloqueo. Vacio si es de toda la sede. */
  readonly profesionalId?: number;
}

export interface CeldaLibre {
  readonly inicioMin: number;
  readonly finMin: number;
  /** Instante de la celda, UTC. */
  readonly inicio: string;
}

export interface ColumnaDeAgenda {
  readonly clave: string;
  readonly titulo: string;
  readonly fecha: string;
  readonly profesionalId?: number;
  readonly espacioId?: number;
  readonly eventos: readonly EventoDeGrilla[];
  readonly celdas: readonly CeldaLibre[];
  readonly franjas: readonly { readonly inicioMin: number; readonly finMin: number }[];
}

const formateadores = new Map<string, Intl.DateTimeFormat>();

function formateador(zona: string): Intl.DateTimeFormat {
  let actual = formateadores.get(zona);
  if (actual === undefined) {
    actual = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: zona === '' ? 'UTC' : zona,
    });
    formateadores.set(zona, actual);
  }
  return actual;
}

/** Minutos desde la medianoche local de la sede. */
export function minutosEnZona(instante: string | undefined, zona: string): number {
  if (!instante) {
    return 0;
  }
  const partes = formateador(zona).formatToParts(new Date(instante));
  const hora = Number(partes.find((p) => p.type === 'hour')?.value ?? 0);
  const minuto = Number(partes.find((p) => p.type === 'minute')?.value ?? 0);
  return hora * 60 + minuto;
}

/**
 * El instante de una hora local de la sede. `Intl` no resuelve la inversa, asi que se ajusta con el
 * desvio medido en ese mismo momento: alcanza para las horas de una agenda, que no caen en el salto de
 * un cambio de hora, y el backend revalida el instante igual.
 */
export function instanteDeHoraLocal(fecha: string, minutos: number, zona: string): string {
  const hh = String(Math.floor(minutos / 60)).padStart(2, '0');
  const mm = String(minutos % 60).padStart(2, '0');
  const supuesto = new Date(`${fecha}T${hh}:${mm}:00Z`);
  const desvioMin = minutosEnZona(supuesto.toISOString(), zona) - minutos;
  // El desvio cruza la medianoche cuando la zona esta lejos de UTC: se normaliza a ±12 horas.
  const ajustado =
    desvioMin > MINUTOS_DEL_DIA / 2
      ? desvioMin - MINUTOS_DEL_DIA
      : desvioMin < -MINUTOS_DEL_DIA / 2
        ? desvioMin + MINUTOS_DEL_DIA
        : desvioMin;
  return new Date(supuesto.getTime() - ajustado * 60_000).toISOString();
}

/** Reparte en carriles lo que se pisa: el primer carril libre, y cada grupo conoce su ancho. */
function conCarriles(
  eventos: readonly Omit<EventoDeGrilla, 'carril' | 'carriles'>[],
): readonly EventoDeGrilla[] {
  const ordenados = [...eventos].sort((a, b) => a.inicioMin - b.inicioMin || b.finMin - a.finMin);
  const resultado: EventoDeGrilla[] = [];
  let grupo: { evento: Omit<EventoDeGrilla, 'carril' | 'carriles'>; carril: number }[] = [];
  let finDelGrupo = -1;

  const cerrarGrupo = (): void => {
    const carriles = Math.max(1, ...grupo.map((g) => g.carril + 1));
    grupo.forEach((g) => resultado.push({ ...g.evento, carril: g.carril, carriles }));
    grupo = [];
  };

  for (const evento of ordenados) {
    if (grupo.length > 0 && evento.inicioMin >= finDelGrupo) {
      cerrarGrupo();
      finDelGrupo = -1;
    }
    const ocupados = new Set(
      grupo.filter((g) => g.evento.finMin > evento.inicioMin).map((g) => g.carril),
    );
    let carril = 0;
    while (ocupados.has(carril)) {
      carril++;
    }
    grupo.push({ evento, carril });
    finDelGrupo = Math.max(finDelGrupo, evento.finMin);
  }
  cerrarGrupo();
  return resultado;
}

interface Entrada {
  readonly agenda: AgendaOperativa;
  readonly vista: VistaDeAgenda;
  readonly agrupacion: AgrupacionDeAgenda;
  readonly fecha: string;
  readonly profesionalFiltrado: number | null;
  /** Filtro de la pantalla sobre los turnos ya leidos. */
  readonly filtroDeTurno: (turno: TurnoDeCalendario) => boolean;
  readonly ahora: Date;
  /** Cada cuantos minutos se ofrece un horario. Sin dato, {@link PASO_DE_CELDA_MIN}. */
  readonly pasoMin?: number;
  /** Quien no tarda lo que dura la prestacion filtrada: sus horarios van a su ritmo. */
  readonly duracionesPropias?: ReadonlyMap<number, number>;
}

function tramoEnElDia(
  desde: string | undefined,
  hasta: string | undefined,
  fecha: string,
  zona: string,
): { inicioMin: number; finMin: number } | null {
  if (!desde || !hasta) {
    return null;
  }
  const diaDesde = diaEnZona(desde, zona);
  const diaHasta = diaEnZona(hasta, zona);
  if (diaDesde > fecha || diaHasta < fecha) {
    return null;
  }
  const inicioMin = diaDesde === fecha ? minutosEnZona(desde, zona) : 0;
  const finMin = diaHasta === fecha ? minutosEnZona(hasta, zona) : MINUTOS_DEL_DIA;
  return finMin > inicioMin ? { inicioMin, finMin } : null;
}

function turnosDe(entrada: Entrada, fecha: string, deLaColumna: (t: TurnoDeCalendario) => boolean) {
  const zona = entrada.agenda.timezone ?? '';
  return (entrada.agenda.turnos ?? [])
    .filter(entrada.filtroDeTurno)
    .filter(deLaColumna)
    .filter((t) => diaEnZona(t.turno?.inicio, zona) === fecha)
    .map((t) => ({
      clave: `t${t.turno?.id}`,
      tipo: 'turno' as const,
      inicioMin: minutosEnZona(t.turno?.inicio, zona),
      finMin: minutosEnZona(t.turno?.fin, zona) || MINUTOS_DEL_DIA,
      turno: t,
      titulo: t.turno?.personaNombre ?? '',
      detalle: t.turno?.ofertaNombre ?? '',
    }));
}

/**
 * Lo que ocupa el horario, sin mirar los filtros de la pantalla: filtrar por estado o por prestacion no
 * libera el lugar, y un turno cancelado que se pidio ver tampoco lo ocupa.
 */
function ocupacionDe(
  entrada: Entrada,
  fecha: string,
  deLaColumna: (t: TurnoDeCalendario) => boolean,
): readonly { readonly inicioMin: number; readonly finMin: number }[] {
  const zona = entrada.agenda.timezone ?? '';
  return (entrada.agenda.turnos ?? [])
    .filter(deLaColumna)
    .filter((t) => t.turno?.operativo?.estadoOperativo !== 'CANCELADO')
    .filter((t) => diaEnZona(t.turno?.inicio, zona) === fecha)
    .map((t) => ({
      inicioMin: minutosEnZona(t.turno?.inicio, zona),
      finMin: minutosEnZona(t.turno?.fin, zona) || MINUTOS_DEL_DIA,
    }));
}

function clasesDe(
  entrada: Entrada,
  fecha: string,
  deLaColumna: (profesionalId?: number, espacioId?: number) => boolean,
) {
  const zona = entrada.agenda.timezone ?? '';
  return (entrada.agenda.clases ?? [])
    .filter((c) => diaEnZona(c.inicio, zona) === fecha)
    .filter((c) => deLaColumna(c.profesionalId, c.espacioId))
    .map((c) => ({
      clave: `c${c.claseId}`,
      tipo: 'clase' as const,
      inicioMin: minutosEnZona(c.inicio, zona),
      finMin: minutosEnZona(c.fin, zona) || MINUTOS_DEL_DIA,
      titulo: c.titulo || c.ofertaNombre || 'Clase',
      detalle: `Clase · ${c.ocupados ?? 0}/${c.capacidad ?? 0}`,
    }));
}

function bloqueosDe(entrada: Entrada, fecha: string, profesionalId: number | null) {
  const zona = entrada.agenda.timezone ?? '';
  return (entrada.agenda.bloqueos ?? [])
    .filter(
      (b) =>
        profesionalId === null ||
        b.membershipId === undefined ||
        b.membershipId === null ||
        b.membershipId === profesionalId,
    )
    .flatMap((b) => {
      const tramo = tramoEnElDia(b.desde, b.hasta, fecha, zona);
      return tramo === null
        ? []
        : [
            {
              clave: `b${b.excepcionId}-${fecha}-${b.membershipId ?? 'sede'}`,
              tipo: 'bloqueo' as const,
              ...tramo,
              titulo: 'Bloqueado',
              detalle: [
                MOTIVOS_DE_BLOQUEO.find((motivo) => motivo.valor === b.motivo)?.etiqueta,
                b.notas,
              ]
                .filter(Boolean)
                .join(' · '),
              excepcionId: b.excepcionId,
              profesionalId: b.membershipId ?? undefined,
            },
          ];
    });
}

function franjasDe(entrada: Entrada, fecha: string, profesionalId: number | null) {
  const zona = entrada.agenda.timezone ?? '';
  const tramos = (entrada.agenda.profesionales ?? [])
    .filter((p) => profesionalId === null || p.membershipId === profesionalId)
    .flatMap((p) => p.franjas ?? [])
    .flatMap((f) => {
      const tramo = tramoEnElDia(f.desde, f.hasta, fecha, zona);
      return tramo === null ? [] : [tramo];
    })
    .sort((a, b) => a.inicioMin - b.inicioMin);
  // Con varios profesionales se unen: la columna muestra cuando atiende alguno.
  const unidos: { inicioMin: number; finMin: number }[] = [];
  for (const tramo of tramos) {
    const ultimo = unidos[unidos.length - 1];
    if (ultimo !== undefined && tramo.inicioMin <= ultimo.finMin) {
      ultimo.finMin = Math.max(ultimo.finMin, tramo.finMin);
    } else {
      unidos.push({ ...tramo });
    }
  }
  return unidos;
}

function celdasLibres(
  entrada: Entrada,
  fecha: string,
  franjas: readonly { inicioMin: number; finMin: number }[],
  ocupados: readonly { inicioMin: number; finMin: number }[],
  profesionalId?: number,
): readonly CeldaLibre[] {
  const zona = entrada.agenda.timezone ?? '';
  const ahora = entrada.ahora.getTime();
  const propia =
    profesionalId === undefined ? undefined : entrada.duracionesPropias?.get(profesionalId);
  const paso = Math.max(propia ?? entrada.pasoMin ?? PASO_DE_CELDA_MIN, PASO_MINIMO_DE_CELDA_MIN);
  const celdas: CeldaLibre[] = [];
  for (const franja of franjas) {
    // Lo que sobra al final de la franja no se ofrece: ahi no entra un turno entero.
    for (let inicio = franja.inicioMin; inicio + paso <= franja.finMin; inicio += paso) {
      const fin = inicio + paso;
      if (ocupados.some((o) => o.inicioMin < fin && inicio < o.finMin)) {
        continue;
      }
      const instante = instanteDeHoraLocal(fecha, inicio, zona);
      if (new Date(instante).getTime() > ahora) {
        celdas.push({ inicioMin: inicio, finMin: fin, inicio: instante });
      }
    }
  }
  return celdas;
}

export function armarColumnas(entrada: Entrada): readonly ColumnaDeAgenda[] {
  const { agenda, vista, agrupacion, fecha, profesionalFiltrado } = entrada;

  if (vista === 'semana') {
    return Array.from({ length: 7 }, (_, i) => sumarDias(fecha, i)).map((dia) => {
      const otros = [
        ...clasesDe(entrada, dia, () => true),
        ...bloqueosDe(entrada, dia, profesionalFiltrado),
      ];
      const eventos = [...turnosDe(entrada, dia, () => true), ...otros];
      const franjas = franjasDe(entrada, dia, profesionalFiltrado);
      return {
        clave: dia,
        titulo: dia,
        fecha: dia,
        profesionalId: profesionalFiltrado ?? undefined,
        eventos: conCarriles(eventos),
        franjas,
        // Sin profesional elegido un horario ocupado por uno puede estar libre para otro: la
        // disponibilidad de ese horario la responde el backend al abrir el formulario.
        celdas: celdasLibres(
          entrada,
          dia,
          franjas,
          profesionalFiltrado === null ? [] : [...ocupacionDe(entrada, dia, () => true), ...otros],
          profesionalFiltrado ?? undefined,
        ),
      };
    });
  }

  if (agrupacion === 'box') {
    const franjas = franjasDe(entrada, fecha, null);
    return (agenda.espacios ?? []).map((espacio) => {
      const delBox = (t: TurnoDeCalendario): boolean => t.turno?.espacioId === espacio.id;
      const clases = clasesDe(entrada, fecha, (_, espacioId) => espacioId === espacio.id);
      const eventos = [...turnosDe(entrada, fecha, delBox), ...clases];
      return {
        clave: `e${espacio.id}`,
        titulo: espacio.nombre ?? '',
        fecha,
        espacioId: espacio.id,
        eventos: conCarriles(eventos),
        franjas,
        celdas: celdasLibres(entrada, fecha, franjas, [
          ...ocupacionDe(entrada, fecha, delBox),
          ...clases,
        ]),
      };
    });
  }

  return (agenda.profesionales ?? []).map((profesional) => {
    const id = profesional.membershipId ?? 0;
    const delProfesional = (t: TurnoDeCalendario): boolean => t.turno?.profesionalId === id;
    const otros = [
      ...clasesDe(entrada, fecha, (profesionalId) => profesionalId === id),
      ...bloqueosDe(entrada, fecha, id),
    ];
    const eventos = [...turnosDe(entrada, fecha, delProfesional), ...otros];
    const franjas = franjasDe(entrada, fecha, id);
    return {
      clave: `p${id}`,
      titulo: profesional.nombre ?? '',
      fecha,
      profesionalId: id,
      eventos: conCarriles(eventos),
      franjas,
      celdas: celdasLibres(
        entrada,
        fecha,
        franjas,
        [...ocupacionDe(entrada, fecha, delProfesional), ...otros],
        id,
      ),
    };
  });
}

/** El rango de horas a dibujar: lo que haya, con un minimo razonable y en horas enteras. */
export function rangoDeHoras(columnas: readonly ColumnaDeAgenda[]): {
  readonly inicioMin: number;
  readonly finMin: number;
} {
  const tramos = columnas.flatMap((c) => [...c.franjas, ...c.eventos]);
  if (tramos.length === 0) {
    return { inicioMin: INICIO_POR_DEFECTO_MIN, finMin: FIN_POR_DEFECTO_MIN };
  }
  const inicio = Math.min(...tramos.map((t) => t.inicioMin));
  const fin = Math.max(...tramos.map((t) => t.finMin));
  return {
    inicioMin: Math.floor(inicio / 60) * 60,
    finMin: Math.min(MINUTOS_DEL_DIA, Math.ceil(fin / 60) * 60),
  };
}
