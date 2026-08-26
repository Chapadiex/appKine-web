/**
 * Las URLs de las cuatro pantallas de horarios, en un solo lugar (M05, AKINE-02.04).
 *
 * <p><b>Por que existe este archivo.</b> `/horarios` tiene cuatro pantallas que se enlazan
 * entre si, y hasta esta tarea cada enlace era un literal escrito a mano: `/horarios/efectivo`
 * aparecia en <b>cinco plantillas</b> mas el archivo de rutas, sin nada que atara una cosa con
 * la otra. Renombrar el segmento habria compilado, pasado el lint y dejado los enlaces
 * cayendo en el comodin `**`.
 *
 * <p><b>Este proyecto ya pago esa factura.</b> Entre AKINE-01.02 y AKINE-02.03 el backend
 * emitia enlaces de correo a `/activar` y `/restablecer` mientras el frontend montaba esas
 * pantallas bajo `/auth`: el usuario caia en el 404 del comodin <b>con un token perfectamente
 * valido en la URL</b>, y nadie se entero por meses. La causa fue exactamente esta forma —una
 * ruta escrita a mano en dos lugares, sin nada que las atara—. El precedente de la solucion es
 * `core/models/rutas.ts`, que hace lo mismo para las rutas que `core/` necesita conocer.
 *
 * <p><b>Los segmentos y las URLs salen del mismo string.</b> `horarios.routes.ts` monta los
 * segmentos, `app.routes.ts` monta la raiz y las plantillas enlazan las URLs completas: los
 * tres derivan de las constantes de abajo, asi que un renombre rompe la <b>compilacion</b> y no
 * la navegacion. Lo que ninguna constante puede garantizar es que la ruta este efectivamente
 * montada; de eso se ocupa `horarios.routes.spec.ts`, que resuelve las cuatro URLs contra la
 * configuracion real y verifica que ninguna caiga en el comodin.
 */

/** Segmento raiz de la feature, tal como lo monta `app.routes.ts`. */
export const SEGMENTO_HORARIOS = 'horarios';

/** Segmentos hijos, tal como los monta `horarios.routes.ts`. */
export const SEGMENTO_EXCEPCIONES = 'excepciones';
export const SEGMENTO_CALENDARIO = 'calendario';
export const SEGMENTO_EFECTIVO = 'efectivo';

/** Horario semanal del profesional — la ruta vacia de la feature. */
export const RUTA_HORARIOS = `/${SEGMENTO_HORARIOS}`;

/** Cierres y aperturas. */
export const RUTA_HORARIOS_EXCEPCIONES = `${RUTA_HORARIOS}/${SEGMENTO_EXCEPCIONES}`;

/** Feriados y politica de la sede. */
export const RUTA_HORARIOS_CALENDARIO = `${RUTA_HORARIOS}/${SEGMENTO_CALENDARIO}`;

/** Horario efectivo ya resuelto, dia por dia. */
export const RUTA_HORARIOS_EFECTIVO = `${RUTA_HORARIOS}/${SEGMENTO_EFECTIVO}`;

/**
 * Las cuatro URLs juntas, para que una plantilla las use sin declarar cuatro campos.
 *
 * <p>Las plantillas de Angular no pueden importar: cada pantalla expone `rutas` y escribe
 * `[routerLink]="rutas.efectivo"`. Un nombre de propiedad mal escrito ahi <b>si</b> lo atrapa
 * el compilador de plantillas, que es justamente lo que un literal no permitia.
 */
export const RUTAS_HORARIOS = {
  semanal: RUTA_HORARIOS,
  excepciones: RUTA_HORARIOS_EXCEPCIONES,
  calendario: RUTA_HORARIOS_CALENDARIO,
  efectivo: RUTA_HORARIOS_EFECTIVO,
} as const;
