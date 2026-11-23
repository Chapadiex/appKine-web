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
  /** Lo breve para la tarjeta de opción del formulario de servicio; el detalle es `ayuda`. */
  readonly resumen: string;
}

export const NATURALEZAS = [
  {
    valor: ServicioResponseNaturalezaEnum.CLINICO,
    etiqueta: 'Clínico',
    ayuda: 'Diagnóstico o tratamiento de una condición.',
    resumen: 'Diagnóstico o tratamiento.',
  },
  {
    valor: ServicioResponseNaturalezaEnum.TERAPEUTICO,
    etiqueta: 'Terapéutico',
    ayuda: 'Intervención sostenida sobre una condición ya diagnosticada.',
    resumen: 'Tratamiento sostenido.',
  },
  {
    valor: ServicioResponseNaturalezaEnum.PREVENTIVO,
    etiqueta: 'Preventivo',
    ayuda: 'Busca evitar que aparezca o reaparezca un problema.',
    resumen: 'Evita que aparezca un problema.',
  },
  {
    valor: ServicioResponseNaturalezaEnum.BIENESTAR,
    etiqueta: 'Bienestar',
    ayuda: 'Actividad de salud general, sin objetivo clínico.',
    resumen: 'Salud general, sin fin clínico.',
  },
] as const satisfies readonly OpcionEnumerada<NaturalezaDeServicio>[];

export const MODALIDADES = [
  {
    valor: OfertaResponseModalidadEnum.INDIVIDUAL,
    etiqueta: 'Individual',
    ayuda: 'Una persona por turno.',
    resumen: 'Una persona por turno.',
  },
  {
    valor: OfertaResponseModalidadEnum.GRUPAL,
    etiqueta: 'Grupal',
    ayuda: 'Varias personas en el mismo turno. Exige capacidad mayor a 1.',
    resumen: 'Varias personas por turno.',
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
 * <p>Solo el nombre: el codigo es un dato interno que el usuario no necesita para elegir. Para
 * orientarse, el alta agrupa los servicios por categoria ({@link serviciosPorCategoria}).
 */
export function servicioEnUnaLinea(servicio: ServicioResponse): string {
  return servicio.nombre ?? servicio.codigo ?? '';
}

/**
 * Los esquemas de cobro con nombre y explicacion en palabras (21/11/2026): el selector mostraba el
 * valor del enum (`POR_PACK`) y nadie sabia que hacia cada uno. `''` es "sin esquema": cada
 * atencion se cobra al cerrarla, como cualquier sesion.
 */
export const ESQUEMAS_DE_COBRO: readonly {
  readonly valor: string;
  readonly etiqueta: string;
  readonly ayuda: string;
}[] = [
  {
    valor: '',
    etiqueta: 'Sin esquema especial',
    ayuda: 'Cada atención se cobra al cerrarla, como cualquier sesión.',
  },
  {
    valor: 'POR_SESION',
    etiqueta: 'Por sesión',
    ayuda: 'Cada sesión atendida genera su cobro.',
  },
  {
    valor: 'POR_CLASE',
    etiqueta: 'Por clase asistida',
    ayuda:
      'Genera una deuda por cada clase a la que la persona asiste (presente o con demora); la ' +
      'ausencia no genera deuda.',
  },
  {
    valor: 'POR_PACK',
    etiqueta: 'Pack de sesiones',
    ayuda:
      'La persona compra un pack de varias sesiones y cada asistencia descuenta una. Los packs ' +
      'se arman en Productos.',
  },
  {
    valor: 'POR_ABONO',
    etiqueta: 'Abono por período',
    ayuda: 'La persona paga un abono con un tope de asistencias por período. Se arma en Productos.',
  },
];

/** La explicacion del esquema elegido, para la linea de ayuda debajo del selector. */
export function ayudaDeEsquema(valor: string): string {
  return ESQUEMAS_DE_COBRO.find((esquema) => esquema.valor === valor)?.ayuda ?? '';
}

/** Rotulo del grupo de los servicios sin categoria: los propios creados desde cero. */
export const SIN_CATEGORIA = 'Otros servicios';

/** La categoria del catalogo con la que se agrupa un servicio en los selectores. */
export function categoriaDe(servicio: ServicioResponse): string {
  const categoria = servicio.categoria?.trim() ?? '';
  return categoria === '' ? SIN_CATEGORIA : categoria;
}

/** Categorias presentes, en orden alfabetico, con "Otros servicios" al final. */
export function categoriasDe(servicios: readonly ServicioResponse[]): readonly string[] {
  const nombres = [...new Set(servicios.map(categoriaDe))];
  return nombres.sort((a, b) =>
    a === SIN_CATEGORIA ? 1 : b === SIN_CATEGORIA ? -1 : a.localeCompare(b, 'es'),
  );
}

/**
 * Servicios agrupados por categoria para un `select` con `optgroup`: con el catalogo precargado
 * (V38) son cientos, y una lista plana no se puede recorrer. Dentro de cada grupo se respeta el
 * orden en que llegaron (el servidor ordena por nombre).
 */
export function serviciosPorCategoria(
  servicios: readonly ServicioResponse[],
): readonly { readonly categoria: string; readonly servicios: readonly ServicioResponse[] }[] {
  return categoriasDe(servicios).map((categoria) => ({
    categoria,
    servicios: servicios.filter((servicio) => categoriaDe(servicio) === categoria),
  }));
}
