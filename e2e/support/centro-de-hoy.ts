import { test as agenda } from './agenda-real';
import { Centro, altaDeCentro } from './sembrado';

/**
 * Centro PROPIO para los specs que necesitan un turno de HOY (recepcion y prepago): la recepcion
 * solo opera turnos del dia de la sede.
 *
 * <h2>El defecto de la medianoche</h2>
 *
 * <p>Esos specs reservaban, sobre el centro compartido de `agenda-setup` —sede en Cordoba—, el
 * primer horario todavia futuro del dia. Entre las 23:30 y las 24:00 de Cordoba no queda ninguno:
 * el motor devuelve el dia vacio con `motivoSinSlots: PASADO` y el sembrado moria en `el <fecha>
 * tiene slots (motivo: PASADO)`. Y un poco antes, con dos o tres horarios futuros, alcanzaba con que
 * el CI reintentara o que dos workers compitieran para quedarse sin ninguno. La falla dependia de la
 * HORA a la que corria el CI, no del producto.
 *
 * <h2>El arreglo: la sede vive donde ahora es media mañana</h2>
 *
 * <p>"Hoy" en AKINE es el dia de la SEDE, en la zona de la sede (`Consultorio.timezone`), y esa zona
 * se edita (`PATCH /organizations/{orgId}/consultorios/{id}`). Este centro se da de alta con la sede
 * en la zona donde el reloj marca, al cargar el spec, la hora mas cercana a las 10:00
 * ({@link zonaDeMediaManana}): quedan unas trece horas de turnos futuros hoy y diez desde la
 * medianoche, sea la hora que sea en Cordoba. Sin esperas, sin reintentos y sin tocar el reloj del
 * servidor, que no se puede: el motor de slots y la recepcion leen el reloj real del backend.
 *
 * <p>La disponibilidad (00:00 a 23:45) y la apertura de los feriados se cargan DESPUES de cambiar
 * la zona, asi que son las de la hora local nueva. El feriado sigue siendo el nacional: la fecha de
 * hoy en la zona de la sede puede caer en uno, y `altaDeCentro` lo abre igual que antes.
 *
 * <p>El navegador corre en una zona cuyo dia es OTRO que el de esta sede
 * ({@link ZONA_DEL_NAVEGADOR_DE_HOY}), por la misma razon que el resto de la suite
 * (`playwright.config.ts`): un `new Date()` que se cuele en la recepcion falla siempre.
 */

/**
 * Una zona IANA por desfase entero, de UTC-11 a UTC+14. Se elige por la hora que marca AHORA, asi
 * que el horario de verano de alguna no cambia nada.
 */
const ZONAS = [
  'Pacific/Pago_Pago',
  'Pacific/Honolulu',
  'Pacific/Gambier',
  'Pacific/Pitcairn',
  'America/Phoenix',
  'America/Guatemala',
  'America/Bogota',
  'America/La_Paz',
  'America/Argentina/Cordoba',
  'Atlantic/South_Georgia',
  'Atlantic/Cape_Verde',
  'Africa/Abidjan',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Africa/Nairobi',
  'Asia/Dubai',
  'Asia/Tashkent',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Brisbane',
  'Pacific/Noumea',
  'Pacific/Tarawa',
  'Pacific/Tongatapu',
  'Pacific/Kiritimati',
] as const;

/** Minutos desde la medianoche local de `zona` en el instante `ahora`. */
function minutosDelDia(zona: string, ahora: Date): number {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: zona,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ahora);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? '0');
  return valor('hour') * 60 + valor('minute');
}

function fechaEn(zona: string, ahora: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona, dateStyle: 'short' }).format(ahora);
}

/** La zona donde `ahora` es la hora mas cercana a las 10:00. */
export function zonaDeMediaManana(ahora = new Date()): string {
  const distancia = (zona: string) => Math.abs(minutosDelDia(zona, ahora) - 10 * 60);
  return [...ZONAS].sort((a, b) => distancia(a) - distancia(b))[0];
}

/**
 * Una zona cuyo dia es otro que el de `sede` en `ahora`, la mas alejada de la medianoche: con la
 * sede a media mañana siempre hay una (la diferencia entre UTC-11 y UTC+14 es de 25 horas).
 */
export function zonaConOtroDia(sede: string, ahora = new Date()): string {
  const hoyEnLaSede = fechaEn(sede, ahora);
  const lejosDeLaMedianoche = (zona: string) => {
    const minutos = minutosDelDia(zona, ahora);
    return Math.min(minutos, 24 * 60 - minutos);
  };
  const candidatas = ZONAS.filter((zona) => fechaEn(zona, ahora) !== hoyEnLaSede);
  return candidatas.sort((a, b) => lejosDeLaMedianoche(b) - lejosDeLaMedianoche(a))[0];
}

/** Zona de la sede de los specs de hoy, fijada al cargar el spec. */
export const ZONA_DE_HOY = process.env['AKINE_E2E_ZONA_DE_HOY'] ?? zonaDeMediaManana();

/** Zona del navegador de esos specs: otro dia que el de la sede. */
export const ZONA_DEL_NAVEGADOR_DE_HOY =
  process.env['AKINE_E2E_TIMEZONE'] ?? zonaConOtroDia(ZONA_DE_HOY);

/**
 * El `test` de `agenda-real` con el fixture `centro` cambiado por un centro de hoy, uno por WORKER:
 * los specs que lo usan siguen pidiendo `{ page, api, centro }` como antes, y `api` ingresa como la
 * administradora de este centro. Son dos altas por worker (administradora y profesional), dentro
 * del cupo de `esperarCupoDeRegistro`.
 */
export const test = agenda.extend<object, { centro: Centro }>({
  centro: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, usar) => {
      await usar(await altaDeCentro('hoy', 'Hoy', { timezone: ZONA_DE_HOY }));
    },
    { scope: 'worker', timeout: 300_000 },
  ],
});
