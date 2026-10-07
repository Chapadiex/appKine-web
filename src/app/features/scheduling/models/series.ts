import { Agenda } from '../../../api/generated/model/agenda';
import { AlcanceDeSerieAlcanceEnum } from '../../../api/generated/model/alcance-de-serie';
import { SlotDisponible } from '../../../api/generated/model/slot-disponible';
import { TurnoOmitidoMotivoEnum } from '../../../api/generated/model/turno-omitido';
import { horaEnZona, slotCompleto, sumarDias, textoSinSlots } from './etiquetas-de-agenda';

/**
 * Reglas de pantalla de las series de turnos (M12, AKINE E-3, DP-04).
 *
 * <p>Nada de esto decide nada: la autoridad es el backend, que expande la regla, revalida cada
 * ocurrencia bajo el lock de sede y rechaza todo si una sola no entra. Lo que hay aca es lo que la
 * pantalla necesita para <b>anticipar</b> ese rechazo y no mandar a ciegas una serie de doce
 * turnos que el servidor va a devolver por el sexto.
 */

/** Tope de ocurrencias que acepta el backend (CHECK de `V74` y validacion del servicio). */
export const MAXIMO_OCURRENCIAS = 52;

/** Ancho maximo de la ventana de agenda que acepta el backend (`ventana-demasiado-amplia`). */
export const MAXIMO_DIAS_DE_AGENDA = 62;

/** Dias ISO, en el orden en que se muestran. */
export const DIAS_DE_LA_SEMANA: readonly { readonly iso: number; readonly nombre: string }[] = [
  { iso: 1, nombre: 'Lunes' },
  { iso: 2, nombre: 'Martes' },
  { iso: 3, nombre: 'Miercoles' },
  { iso: 4, nombre: 'Jueves' },
  { iso: 5, nombre: 'Viernes' },
  { iso: 6, nombre: 'Sabado' },
  { iso: 7, nombre: 'Domingo' },
];

/** Una regla semanal tal como la carga la pantalla. Termina por `cantidad` o por `fechaHasta`. */
export interface ReglaSemanal {
  readonly fechaDesde: string;
  readonly diasSemana: readonly number[];
  readonly cantidad?: number;
  readonly fechaHasta?: string;
}

/** Resultado de expandir una regla: las fechas, y si se paso del tope. */
export interface Expansion {
  readonly fechas: readonly string[];
  readonly excedeElTope: boolean;
}

/**
 * Las fechas locales que produce la regla.
 *
 * <p>Es el mismo recorrido que `TurnoSerie.ocurrencias()` del backend: dia por dia desde
 * `fechaDesde`, inclusive `fechaHasta`, cortando al llegar a `cantidad`. Si produce mas de
 * {@link MAXIMO_OCURRENCIAS} se marca `excedeElTope`: el backend lo rechaza con 400 y no tiene
 * sentido previsualizar cientos de fechas por un error de tipeo en la fecha fin.
 */
export function expandirRegla(regla: ReglaSemanal): Expansion {
  const fechas: string[] = [];
  const dias = new Set(regla.diasSemana);
  if (regla.fechaDesde === '' || dias.size === 0) {
    return { fechas, excedeElTope: false };
  }
  const tope = regla.cantidad ?? Number.POSITIVE_INFINITY;
  const hasta = regla.cantidad === undefined ? (regla.fechaHasta ?? '') : '';
  if (regla.cantidad === undefined && hasta === '') {
    return { fechas, excedeElTope: false };
  }

  for (let fecha = regla.fechaDesde; hasta === '' || fecha <= hasta; fecha = sumarDias(fecha, 1)) {
    if (dias.has(diaIso(fecha))) {
      if (fechas.length === MAXIMO_OCURRENCIAS) {
        return { fechas, excedeElTope: true };
      }
      fechas.push(fecha);
      if (fechas.length >= tope) {
        break;
      }
    }
  }
  return { fechas, excedeElTope: false };
}

/** Dia ISO de una fecha local `YYYY-MM-DD`: 1 = lunes ... 7 = domingo. */
export function diaIso(fecha: string): number {
  const dia = new Date(`${fecha}T00:00:00Z`).getUTCDay();
  return dia === 0 ? 7 : dia;
}

/**
 * Ventanas de agenda que cubren de `primera` a `ultima`, cada una de a lo sumo
 * {@link MAXIMO_DIAS_DE_AGENDA} dias. `hasta` es exclusivo, como lo pide el contrato.
 */
export function ventanasDeAgenda(
  primera: string,
  ultima: string,
): readonly { readonly desde: string; readonly hasta: string }[] {
  const ventanas: { desde: string; hasta: string }[] = [];
  const fin = sumarDias(ultima, 1);
  for (let desde = primera; desde < fin; desde = sumarDias(desde, MAXIMO_DIAS_DE_AGENDA)) {
    const tope = sumarDias(desde, MAXIMO_DIAS_DE_AGENDA);
    ventanas.push({ desde, hasta: tope < fin ? tope : fin });
  }
  return ventanas;
}

/** Que se espera de una ocurrencia, segun la agenda leida. */
export type EstadoPrevisto = 'libre' | 'completo' | 'sin-horario';

export interface OcurrenciaPrevista {
  readonly fecha: string;
  readonly estado: EstadoPrevisto;
  /** Por que no entra. Vacio si se espera que entre. */
  readonly detalle: string;
  /** Instante UTC del slot que coincide, si lo hay. */
  readonly instante: string;
}

/**
 * Cruza las fechas de la regla con la agenda leida.
 *
 * <p>Una ocurrencia se espera <b>libre</b> si ese dia hay un slot que empieza a `hora` —en la zona
 * de la sede— con cupo, y del profesional pedido si se pidio uno. Es una lectura: entre esto y el
 * alta pudo entrar otro, y el backend es quien decide.
 */
export function clasificarOcurrencias(
  fechas: readonly string[],
  hora: string,
  agendas: readonly Agenda[],
  profesionalId: number | null,
): readonly OcurrenciaPrevista[] {
  const dias = new Map(
    agendas.flatMap((agenda) =>
      (agenda.dias ?? []).map((dia) => [dia.fecha ?? '', { dia, timezone: agenda.timezone ?? '' }]),
    ),
  );

  return fechas.map((fecha) => {
    const encontrado = dias.get(fecha);
    if (encontrado === undefined) {
      return prevista(fecha, 'sin-horario', 'La agenda no devolvio este dia.');
    }
    const { dia, timezone } = encontrado;
    const coincidentes = (dia.slots ?? []).filter(
      (slot: SlotDisponible) =>
        horaEnZona(slot.desde, timezone) === hora &&
        (profesionalId === null ||
          slot.profesionalId === undefined ||
          slot.profesionalId === profesionalId),
    );
    const libre = coincidentes.find((slot) => !slotCompleto(slot));
    if (libre !== undefined) {
      return { ...prevista(fecha, 'libre', ''), instante: libre.desde ?? '' };
    }
    if (coincidentes.length > 0) {
      return prevista(fecha, 'completo', 'Ese horario ya no tiene cupo.');
    }
    if ((dia.slots ?? []).length === 0) {
      return prevista(fecha, 'sin-horario', textoSinSlots(dia));
    }
    const conQuien = profesionalId === null ? '' : ' con ese profesional';
    return prevista(
      fecha,
      'sin-horario',
      `No hay un horario que empiece a las ${hora}${conQuien}.`,
    );
  });
}

function prevista(fecha: string, estado: EstadoPrevisto, detalle: string): OcurrenciaPrevista {
  return { fecha, estado, detalle, instante: '' };
}

/** `YYYY-MM-DD` de un instante, en la zona de la sede. */
export function fechaEnZona(instante: string | undefined, timezone: string): string {
  if (instante === undefined || instante === '') {
    return '';
  }
  const fecha = new Date(instante);
  if (Number.isNaN(fecha.getTime())) {
    return '';
  }
  try {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: timezone === '' ? 'UTC' : timezone,
    }).format(fecha);
  } catch {
    return fecha.toISOString().slice(0, 10);
  }
}

const TEXTOS_DE_OMITIDO: Readonly<Record<TurnoOmitidoMotivoEnum, string>> = {
  [TurnoOmitidoMotivoEnum.YA_EMPEZO]: 'Ya empezo: el pasado no se toca',
  [TurnoOmitidoMotivoEnum.ESTADO_TERMINAL]: 'Ya estaba cancelado o ausente',
  [TurnoOmitidoMotivoEnum.EN_ESPERA]: 'El paciente ya llego: se resuelve desde la recepcion',
  [TurnoOmitidoMotivoEnum.CON_ATENCION]: 'Tiene una atencion clinica registrada',
};

/** Por que un turno del alcance queda como esta. */
export function textoDeOmitido(motivo: string | undefined): string {
  return TEXTOS_DE_OMITIDO[motivo as TurnoOmitidoMotivoEnum] ?? 'No se toca';
}

const TEXTOS_DE_ALCANCE: Readonly<Record<AlcanceDeSerieAlcanceEnum, string>> = {
  [AlcanceDeSerieAlcanceEnum.ESTE]: 'Solo este turno',
  [AlcanceDeSerieAlcanceEnum.ESTE_Y_SIGUIENTES]: 'Este turno y los siguientes',
  [AlcanceDeSerieAlcanceEnum.TODA_LA_SERIE]: 'Toda la serie',
};

export function textoDeAlcance(alcance: string | undefined): string {
  return TEXTOS_DE_ALCANCE[alcance as AlcanceDeSerieAlcanceEnum] ?? '';
}

/** `Lunes y jueves` para una lista de dias ISO. */
export function textoDeDias(dias: readonly number[] | undefined): string {
  const nombres = DIAS_DE_LA_SEMANA.filter((d) => (dias ?? []).includes(d.iso)).map((d) =>
    d.nombre.toLowerCase(),
  );
  if (nombres.length <= 1) {
    return capitalizar(nombres[0] ?? '');
  }
  return capitalizar(`${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`);
}

function capitalizar(texto: string): string {
  return texto === '' ? '' : texto[0].toUpperCase() + texto.slice(1);
}
