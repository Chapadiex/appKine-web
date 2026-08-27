import {
  OfertaResponse,
  OfertaResponseModalidadEnum,
} from '../../../api/generated/model/oferta-response';
import {
  ServicioResponse,
  ServicioResponseNaturalezaEnum,
} from '../../../api/generated/model/servicio-response';

/**
 * Como se nombran en pantalla los enumerados de `offering` (M27, AKINE-02.06).
 *
 * <p><b>Los tipos se derivan del contrato, no se copian</b> (ADR-0002). `NaturalezaDeServicio`
 * es literalmente el tipo del campo de {@link ServicioResponse}: si el backend agrega un quinto
 * valor, las tablas de abajo dejan de estar completas y el compilador lo dice en el
 * `satisfies`. Escribir la union a mano no daria ninguna de las dos cosas.
 *
 * <p><b>Que hace este archivo y que no.</b> Traduce codigos a palabras y explica que significa
 * cada opcion. No decide nada: RN-M06-005 es explicita en que la naturaleza <b>sirve para
 * clasificar y no debe imponer por si sola comportamiento clinico</b>, asi que ninguna pantalla
 * puede ramificar por ella. Lo que decide si hace falta un caso clinico o si se genera registro
 * son los `requiere_*` de la Oferta, que son campos propios.
 */
export type NaturalezaDeServicio = NonNullable<ServicioResponse['naturaleza']>;
export type ModalidadDeServicio = NonNullable<ServicioResponse['modalidadDefault']>;
export type ModalidadDeOferta = NonNullable<OfertaResponse['modalidad']>;

/** Una opcion de un `select`, con su explicacion para el texto de ayuda. */
export interface OpcionEnumerada<T extends string> {
  readonly valor: T;
  readonly etiqueta: string;
  readonly ayuda: string;
}

export const NATURALEZAS = [
  {
    valor: ServicioResponseNaturalezaEnum.CLINICO,
    etiqueta: 'Clinico',
    ayuda: 'Diagnostico o tratamiento de una condicion.',
  },
  {
    valor: ServicioResponseNaturalezaEnum.TERAPEUTICO,
    etiqueta: 'Terapeutico',
    ayuda: 'Intervencion sostenida sobre una condicion ya diagnosticada.',
  },
  {
    valor: ServicioResponseNaturalezaEnum.PREVENTIVO,
    etiqueta: 'Preventivo',
    ayuda: 'Busca evitar que aparezca o reaparezca un problema.',
  },
  {
    valor: ServicioResponseNaturalezaEnum.BIENESTAR,
    etiqueta: 'Bienestar',
    ayuda: 'Actividad de salud general, sin objetivo clinico.',
  },
] as const satisfies readonly OpcionEnumerada<NaturalezaDeServicio>[];

export const MODALIDADES = [
  {
    valor: OfertaResponseModalidadEnum.INDIVIDUAL,
    etiqueta: 'Individual',
    ayuda: 'Una persona por turno.',
  },
  {
    valor: OfertaResponseModalidadEnum.GRUPAL,
    etiqueta: 'Grupal',
    ayuda: 'Varias personas en el mismo turno. Exige capacidad mayor a 1.',
  },
] as const satisfies readonly OpcionEnumerada<ModalidadDeOferta>[];

/** Etiqueta de una naturaleza, o el codigo crudo si el backend manda una que no conocemos. */
export function etiquetaDeNaturaleza(valor: string | undefined): string {
  return NATURALEZAS.find((opcion) => opcion.valor === valor)?.etiqueta ?? valor ?? '-';
}

/** Etiqueta de una modalidad, o el codigo crudo si es una que no conocemos. */
export function etiquetaDeModalidad(valor: string | undefined): string {
  return MODALIDADES.find((opcion) => opcion.valor === valor)?.etiqueta ?? valor ?? '-';
}

/** `Individual`, `Grupal (hasta 8)`. La capacidad solo se nombra donde significa algo. */
export function modalidadConCapacidad(oferta: OfertaResponse): string {
  const modalidad = etiquetaDeModalidad(oferta.modalidad);
  if (oferta.modalidad !== 'GRUPAL') {
    return modalidad;
  }
  return oferta.capacidad === undefined ? modalidad : `${modalidad} (hasta ${oferta.capacidad})`;
}

/**
 * Precio ya redactado, o la aclaracion de que no lo tiene.
 *
 * <p><b>Precio y moneda viajan juntos o no viajan</b> (diseno 3.2): un precio sin moneda no es
 * un precio, y este SaaS va a operar en mas de un pais. Por eso no se muestra un numero pelado
 * si falta la moneda — seria exactamente la ambiguedad que el check de la base evita.
 *
 * <p>Una oferta <b>sin precio no esta mal cargada</b>: la etapa guarda el dato economico pero
 * no lo resuelve, y las reglas reales dependen de convenios y aranceles que M15/M16/M18 todavia
 * no construyeron.
 */
export function precioEnPalabras(oferta: OfertaResponse): string {
  const precio = oferta.precioBase;
  const moneda = oferta.moneda ?? '';
  if (precio === undefined || precio === null || moneda === '') {
    return 'Sin precio cargado';
  }
  return `${moneda} ${precio}`;
}

/** `true` si el servicio esta dado de baja y no admite ofertas nuevas (RF-M27-002). */
export function servicioInactivo(servicio: ServicioResponse): boolean {
  return servicio.estado === 'INACTIVO';
}

/**
 * Como se nombra un servicio en un selector: `Kinesiologia respiratoria (KRES)`.
 *
 * <p>El codigo va al lado del nombre y no en una columna aparte porque en un `select` no hay
 * columnas, y el codigo es lo que el equipo administrativo tiene memorizado.
 */
export function servicioEnUnaLinea(servicio: ServicioResponse): string {
  const codigo = servicio.codigo ?? '';
  return codigo === '' ? (servicio.nombre ?? '') : `${servicio.nombre ?? ''} (${codigo})`;
}
