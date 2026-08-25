import { CatalogoConceptoResponse } from '../../../api/generated/model/catalogo-concepto-response';

/**
 * Los tres tipos del catalogo clinico, tal como viajan <b>en la ruta</b> (M06, AKINE-02.05).
 *
 * <p>El contrato usa dos vocabularios para lo mismo y no es un descuido: el <b>slug</b>
 * -`especialidades`- es el segmento de la URL, y el <b>tipo</b> -`ESPECIALIDAD`- es lo que
 * viaja en el cuerpo de la respuesta. Traducirlos en un solo lugar evita que cada pantalla
 * arme el suyo y que uno de los dos se escriba mal: un slug mal escrito no falla en el
 * cliente generado -es un string mas- y termina en un `404` del backend.
 */
export type TipoDeCatalogo = 'especialidades' | 'practicas' | 'nomencladores';

/** Como se llama cada tipo cuando hay que nombrarlo en pantalla. */
export interface DatosDeTipo {
  readonly slug: TipoDeCatalogo;
  /** Nombre en singular, para botones y titulos de panel. */
  readonly singular: string;
  /** Nombre en plural, para titulos de listado y pestañas. */
  readonly plural: string;
  /** Que es, en una linea, para el usuario que nunca vio el modulo. */
  readonly descripcion: string;
  /** `true` cuando el alta exige elegir una especialidad. Hoy, solo las practicas. */
  readonly exigeEspecialidad: boolean;
}

export const TIPOS_DE_CATALOGO: readonly DatosDeTipo[] = [
  {
    slug: 'especialidades',
    singular: 'especialidad',
    plural: 'Especialidades',
    descripcion:
      'La disciplina bajo la que se atiende: kinesiologia, fonoaudiologia, nutricion. Es de lo ' +
      'que cuelgan las practicas.',
    exigeEspecialidad: false,
  },
  {
    slug: 'practicas',
    singular: 'practica',
    plural: 'Practicas',
    descripcion:
      'Lo que efectivamente se hace en una sesion. Cada practica pertenece a una especialidad y ' +
      'es lo que los nomencladores codifican.',
    exigeEspecialidad: true,
  },
  {
    slug: 'nomencladores',
    singular: 'nomenclador',
    plural: 'Nomencladores',
    descripcion:
      'El listado de codigos con el que se le factura a un financiador. Sus codigos no viven en ' +
      'el nomenclador: viven en sus vigencias, que son las que cambian con el tiempo.',
    exigeEspecialidad: false,
  },
];

/** `true` si el segmento de la URL es uno de los tres tipos. */
export function esTipoDeCatalogo(valor: string | null | undefined): valor is TipoDeCatalogo {
  return TIPOS_DE_CATALOGO.some((tipo) => tipo.slug === valor);
}

/** Datos del tipo, o `null` si el segmento no es ninguno de los tres. */
export function datosDeTipo(valor: string | null | undefined): DatosDeTipo | null {
  return TIPOS_DE_CATALOGO.find((tipo) => tipo.slug === valor) ?? null;
}

/**
 * De quien es el concepto, ya redactado.
 *
 * <p>Es la distincion que esta feature no puede aplanar (ADR-0021): un concepto
 * <b>global</b> lo mantiene la plataforma y lo ven todos los centros; uno
 * <b>propio</b> es de este centro y no lo ve nadie mas. Sin decirlo en la fila, quien
 * intenta editar "Kinesiologia" recibe un `403` sin ninguna pista de por que, cuando el
 * motivo -no es tuyo- es perfectamente explicable de antemano.
 */
export function etiquetaDeAlcance(concepto: CatalogoConceptoResponse): string {
  return concepto.alcance === 'GLOBAL' ? 'De la plataforma' : 'De este centro';
}

/** `true` si el concepto lo mantiene la plataforma y este centro no puede tocarlo. */
export function esGlobal(concepto: CatalogoConceptoResponse): boolean {
  return concepto.alcance === 'GLOBAL';
}
