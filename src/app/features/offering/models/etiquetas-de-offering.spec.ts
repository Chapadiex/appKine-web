import {
  OfertaResponse,
  OfertaResponseModalidadEnum,
} from '../../../api/generated/model/oferta-response';
import {
  ServicioResponse,
  ServicioResponseEstadoEnum,
} from '../../../api/generated/model/servicio-response';
import {
  MODALIDADES,
  NATURALEZAS,
  etiquetaDeModalidad,
  etiquetaDeNaturaleza,
  modalidadConCapacidad,
  precioEnPalabras,
  servicioEnUnaLinea,
  servicioInactivo,
} from './etiquetas-de-offering';

function oferta(campos: Partial<OfertaResponse> = {}): OfertaResponse {
  return { id: 1, nombreComercial: 'Kinesiologia', ...campos } as OfertaResponse;
}

function servicio(campos: Partial<ServicioResponse> = {}): ServicioResponse {
  return { id: 1, nombre: 'Kinesiologia respiratoria', ...campos } as ServicioResponse;
}

/**
 * Spec de la traduccion a palabras de los enumerados de `offering` (M27, AKINE-02.06).
 *
 * <p>Lo que se prueba no es que las etiquetas digan lo que dicen —eso es texto— sino las
 * <b>ramas de respaldo</b>: que un valor desconocido no se muestre como vacio y que un precio
 * a medio cargar no se muestre como un numero pelado.
 */
describe('etiquetaDeNaturaleza y etiquetaDeModalidad', () => {
  it('traducen todos los valores del contrato', () => {
    // Recorre las tablas en vez de listar literales: si el backend agrega un valor y alguien
    // olvida su etiqueta, el `satisfies` del modulo ya no compila y esto lo acompania.
    for (const opcion of NATURALEZAS) {
      expect(etiquetaDeNaturaleza(opcion.valor)).toBe(opcion.etiqueta);
    }
    for (const opcion of MODALIDADES) {
      expect(etiquetaDeModalidad(opcion.valor)).toBe(opcion.etiqueta);
    }
  });

  it('un valor que no conocemos se muestra crudo, no vacio', () => {
    // Preferir el codigo del backend a un guion: si el contrato suma una naturaleza y esta
    // pantalla no se actualizo, es mejor que el usuario vea NUEVA_NATURALEZA a que vea nada.
    expect(etiquetaDeNaturaleza('NUEVA_NATURALEZA')).toBe('NUEVA_NATURALEZA');
    expect(etiquetaDeModalidad('HIBRIDA')).toBe('HIBRIDA');
  });

  it('sin valor muestran un guion', () => {
    expect(etiquetaDeNaturaleza(undefined)).toBe('-');
    expect(etiquetaDeModalidad(undefined)).toBe('-');
  });
});

describe('modalidadConCapacidad', () => {
  it('la capacidad solo se nombra en las grupales, donde significa algo', () => {
    expect(
      modalidadConCapacidad(
        oferta({ modalidad: OfertaResponseModalidadEnum.INDIVIDUAL, capacidad: 1 }),
      ),
    ).toBe('Individual');
    expect(
      modalidadConCapacidad(
        oferta({ modalidad: OfertaResponseModalidadEnum.GRUPAL, capacidad: 8 }),
      ),
    ).toBe('Grupal (hasta 8)');
  });

  it('una grupal sin capacidad no inventa un numero', () => {
    expect(modalidadConCapacidad(oferta({ modalidad: OfertaResponseModalidadEnum.GRUPAL }))).toBe(
      'Grupal',
    );
  });
});

describe('precioEnPalabras', () => {
  it('el precio se muestra con su moneda', () => {
    expect(precioEnPalabras(oferta({ precioBase: 18000, moneda: 'ARS' }))).toBe('ARS 18000');
  });

  it('sin precio no es cero: se dice que no esta cargado', () => {
    expect(precioEnPalabras(oferta({}))).toBe('Sin precio cargado');
    expect(precioEnPalabras(oferta({ precioBase: undefined, moneda: 'ARS' }))).toBe(
      'Sin precio cargado',
    );
  });

  it('un precio sin moneda NO se muestra como numero pelado', () => {
    // Precio y moneda viajan juntos o no viajan: mostrar 18000 sin decir de que moneda es
    // exactamente la ambiguedad que el check de la base existe para evitar.
    expect(precioEnPalabras(oferta({ precioBase: 18000 }))).toBe('Sin precio cargado');
    expect(precioEnPalabras(oferta({ precioBase: 18000, moneda: '' }))).toBe('Sin precio cargado');
  });

  it('un precio en cero SI es un precio y se muestra', () => {
    // Cero declarado es una decision comercial —una prestacion bonificada— y es distinto de
    // "todavia no lo fijamos". Si esta rama se rompiera, las bonificadas dirian "sin precio".
    expect(precioEnPalabras(oferta({ precioBase: 0, moneda: 'ARS' }))).toBe('ARS 0');
  });
});

describe('servicioInactivo', () => {
  it('distingue el servicio que ya no admite ofertas nuevas', () => {
    expect(servicioInactivo(servicio({ estado: ServicioResponseEstadoEnum.INACTIVO }))).toBe(true);
    expect(servicioInactivo(servicio({ estado: ServicioResponseEstadoEnum.ACTIVO }))).toBe(false);
    expect(servicioInactivo(servicio({}))).toBe(false);
  });
});

describe('servicioEnUnaLinea', () => {
  it('el codigo acompania al nombre, que es lo que el equipo tiene memorizado', () => {
    expect(servicioEnUnaLinea(servicio({ codigo: 'KRES' }))).toBe(
      'Kinesiologia respiratoria (KRES)',
    );
  });

  it('sin codigo no deja un parentesis vacio colgando', () => {
    expect(servicioEnUnaLinea(servicio({}))).toBe('Kinesiologia respiratoria');
    expect(servicioEnUnaLinea(servicio({ codigo: '' }))).toBe('Kinesiologia respiratoria');
  });
});
