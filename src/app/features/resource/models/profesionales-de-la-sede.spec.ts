import {
  MembershipResponse,
  MembershipResponseEstadoEnum,
  MembershipResponseRoleCodeEnum,
} from '../../../api/generated/model/membership-response';
import {
  TOPE_DE_VINCULOS,
  atiendeEn,
  esListaCompleta,
  nombreDeVinculo,
  textoDeProfesionales,
} from './profesionales-de-la-sede';

/** Vinculo minimo, tipado con los enums generados: aca se llama a la funcion sin pasar por HTTP. */
function vinculo(cambios: Partial<MembershipResponse> = {}): MembershipResponse {
  return {
    id: 1,
    roleCode: MembershipResponseRoleCodeEnum.PROFESIONAL,
    estado: MembershipResponseEstadoEnum.ACTIVA,
    consultorioId: SEDE,
    ...cambios,
  };
}

const SEDE = 3;

/**
 * Spec de los profesionales de la sede (M05, AKINE-02.04).
 *
 * <p>Estas tres funciones salieron del archivo de la tarea 14 para que el <b>selector</b> de
 * alcance y el <b>numero</b> del aviso de la apertura de sede no puedan discrepar: si cada
 * pantalla filtrara por su cuenta, el cartel podria advertir sobre una cantidad de gente
 * distinta de la que ofrece el campo de al lado.
 *
 * <p>La extraccion viajo etiquetada como "sin cambio de comportamiento" y <b>no lo era</b>
 * del todo: ver el caso del nombre vacio. Ningun test pinaba ese borde, asi que los tests en
 * verde de la tarea 14 no eran evidencia de equivalencia. Este spec lo pina.
 */
describe('atiendeEn', () => {
  it('un vinculo de alcance organizacion habilita en esta sede', () => {
    // `consultorioId` nulo NO es "sin sede": es toda la organizacion. Tratarlo como faltante
    // dejaria fuera del selector justo a quien atiende en todas las sedes.
    // El generador tipa `consultorioId?: number`, sin null, pero el backend manda null: por eso
    // `atiendeEn` chequea los dos y por eso este caso se arma con un cast explicito.
    const alcanceOrganizacion = {
      ...vinculo(),
      consultorioId: null,
    } as unknown as MembershipResponse;

    expect(atiendeEn(alcanceOrganizacion, SEDE)).toBe(true);
    expect(atiendeEn(vinculo({ consultorioId: undefined }), SEDE)).toBe(true);
  });

  it('deja fuera a quien no es profesional, no esta activo o esta acotado a otra sede', () => {
    expect(atiendeEn(vinculo(), SEDE)).toBe(true);
    expect(
      atiendeEn(vinculo({ roleCode: MembershipResponseRoleCodeEnum.ADMINISTRATIVO }), SEDE),
    ).toBe(false);
    expect(atiendeEn(vinculo({ estado: MembershipResponseEstadoEnum.SUSPENDIDA }), SEDE)).toBe(
      false,
    );
    // Cargarle horario terminaria siempre en 409 profesional-no-vinculado.
    expect(atiendeEn(vinculo({ consultorioId: 99 }), SEDE)).toBe(false);
  });

  it('el tope de vinculos es el que recorta el backend', () => {
    expect(TOPE_DE_VINCULOS).toBe(100);
  });
});

describe('nombreDeVinculo', () => {
  it('prefiere el nombre de la cuenta', () => {
    expect(
      nombreDeVinculo({ id: 1, accountName: 'Ana Kine', accountEmail: 'ana@example.test' }),
    ).toBe('Ana Kine');
  });

  /**
   * El borde que la extraccion cambio, fijado a proposito.
   *
   * <p>La tarea 14 usaba `accountName ?? accountEmail`, que ante un nombre <b>vacio</b> —no
   * nulo: el string vacio— rendereaba una etiqueta en blanco: una opcion invisible en el
   * selector y un aviso que dice "la apertura de " y se corta. Con `||` cae al correo, que es
   * el comportamiento que se quiere. Esto es lo que se pina.
   */
  it('un nombre vacio cae al correo, no a una etiqueta en blanco', () => {
    expect(nombreDeVinculo(vinculo({ accountName: '', accountEmail: 'ana@example.test' }))).toBe(
      'ana@example.test',
    );
    expect(nombreDeVinculo(vinculo({ accountEmail: 'ana@example.test' }))).toBe('ana@example.test');
  });

  it('sin nombre ni correo, y sin vinculo, nunca imprime "undefined"', () => {
    expect(nombreDeVinculo(vinculo())).toBe('el profesional');
    expect(nombreDeVinculo(undefined)).toBe('el profesional');
  });
});

/**
 * El numero del aviso de la apertura de sede.
 *
 * <p>No es cosmetico: "los 1 profesionales de la sede" convierte una advertencia seria en algo
 * que se lee como un error de la aplicacion y se ignora, que es exactamente lo que este aviso
 * no se puede permitir.
 *
 * <p><b>El caso cero solo se redacta cuando la cantidad se midio de verdad.</b> Quien no pudo
 * contar no llama a esta funcion: la pantalla dice que no lo sabe. Ver `cantidadAfectada` en
 * `excepciones-page.ts`.
 */
describe('textoDeProfesionales', () => {
  it('redacta el singular, el plural y el caso de la sede sin profesionales', () => {
    expect(textoDeProfesionales(0)).toBe('ningun profesional vinculado hoy a la sede');
    expect(textoDeProfesionales(1)).toBe('1 profesional');
    expect(textoDeProfesionales(7)).toBe('7 profesionales');
  });
});

/**
 * Detectar que la nomina llego cortada.
 *
 * <p>Es la segunda puerta al mismo error: el aviso de la apertura de sede contando sobre una
 * lista incompleta dice un numero <b>mas chico que el real</b>, que el admin lee y confirma.
 * Una organizacion de 250 vinculos cuyos primeros 100 traen 3 profesionales de esta sede haria
 * que el cartel prometiera 3 afectados sobre un cambio que le cambia el dia a 40.
 */
describe('esListaCompleta', () => {
  const vinculos = (cuantos: number) => Array.from({ length: cuantos }, () => ({}));

  it('una pagina que no llega al tope y agota el total esta completa', () => {
    expect(esListaCompleta({ content: vinculos(12), totalElements: 12 })).toBe(true);
  });

  it('sin totalElements, una pagina corta sigue estando completa', () => {
    // Es lo que responde una organizacion chica: no hay nada que indique un corte.
    expect(esListaCompleta({ content: vinculos(3) })).toBe(true);
  });

  it('una pagina llena se considera incompleta aunque no venga totalElements', () => {
    // Raspar el tope es indistinguible de quedar cortado. Ante la duda, se duda: el precio de
    // equivocarse hacia este lado es un cartel que dice "no sabemos".
    expect(esListaCompleta({ content: vinculos(TOPE_DE_VINCULOS) })).toBe(false);
  });

  it('un total mayor que lo recibido es un corte declarado por el backend', () => {
    expect(esListaCompleta({ content: vinculos(50), totalElements: 250 })).toBe(false);
  });

  it('una respuesta sin content no se toma por completa cuando el total dice otra cosa', () => {
    expect(esListaCompleta({ totalElements: 7 })).toBe(false);
    expect(esListaCompleta({})).toBe(true);
  });
});
