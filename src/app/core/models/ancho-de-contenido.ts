/**
 * Cuanto ancho pide una pantalla al layout raiz.
 *
 * <p>Vive aca por la misma razon que `rutas.ts`: es un <b>acuerdo entre el shell y las
 * features</b>. El `max-width` del contenido esta en el `main` del layout, que es un
 * ancestro de toda pagina, y en CSS ningun descendiente puede ensanchar a su contenedor.
 * Asi que la pantalla lo declara en su ruta y el shell lo aplica. Ni el shell importa de
 * `features/`, ni la feature importa del shell: las dos importan este acuerdo.
 *
 * <p><b>`lectura` es el defecto y no hace falta declararlo.</b> La mayoria de las pantallas
 * son prosa y formularios, donde un renglon largo se lee peor: 46rem son unos 90 caracteres
 * por linea. `amplio` lo piden las pantallas de tabla, que tienen que mostrar seis columnas
 * de datos mas una de acciones sin esconder ninguna detras de un scroll lateral.
 */
export type AnchoDeContenido = 'lectura' | 'amplio';

/** Clave que una ruta usa en su `data` para pedir el ancho de tabla. */
export const DATA_ANCHO = 'ancho';

/** Valor que hay que poner en esa clave. Constante para que un typo no compile. */
export const ANCHO_AMPLIO: AnchoDeContenido = 'amplio';
