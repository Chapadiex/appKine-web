import { RUTA_HORARIOS } from '../../features/resource/models/rutas-de-horarios';
import { PERMISO_CAJA_OPERATE, PERMISO_COLABORADOR_READ } from '../../core/models/permisos';
import { PERMISO_COBRO_REGISTER as PERMISO_PRESENTACIONES } from '../../core/models/permisos';
import { PERMISO_REPORTE_READ } from '../../core/models/permisos';
import { PERMISO_PACIENTE_READ } from '../../core/models/permisos';

/** Una entrada de la navegacion principal. */
export interface Seccion {
  /** Texto del enlace. Es el nombre accesible: tiene que decir a donde lleva. */
  readonly etiqueta: string;

  /** URL absoluta, tal como la monta `app.routes.ts`. */
  readonly ruta: string;

  /**
   * Permisos que habilitan la seccion. Con varios alcanza tener <b>alguno</b> (OR).
   *
   * <p>`undefined` significa "la autoriza la pertenencia": el backend deja entrar a
   * cualquier miembro vigente del contexto y no hay permiso que preguntar. <b>No</b>
   * significa "todavia no lo averigue".
   */
  readonly permisos?: readonly string[];
}

/**
 * Las secciones de AKINE, en el orden en que se muestran (AKINE-navegacion).
 *
 * <h2>De donde sale el permiso de cada una</h2>
 *
 * <p>De ningun lado que no sea el archivo de rutas de la propia feature. Para cada seccion se
 * miro que `canActivate` lleva la ruta <b>que este enlace abre</b> —no una hermana ni una
 * hija—, y el permiso es el que ese `permissionGuard` exige. Adivinarlo tiene las dos formas
 * de estar mal: de mas, y el enlace lleva a un `403`; de menos, y la seccion desaparece para
 * quien si podia entrar.
 *
 * <ul>
 *   <li><b>Agenda</b> — `scheduling.routes.ts`: solo `contextGuard`. Consultar la agenda lo
 *       hace cualquiera que atienda; `turno:manage` gobierna el boton de reservar y eso lo
 *       resuelve la pantalla, no este menu.</li>
 *   <li><b>Pacientes</b> — `person.routes.ts`: `permissionGuard(PERMISO_PACIENTE_READ)` en todas
 *       las rutas (DP-22): la lectura de personas exige `paciente:read`, que el staff tiene y el
 *       paciente no. `paciente:manage` gobierna el alta, que es de la pantalla.</li>
 *   <li><b>Espacios</b> — `resource.routes.ts`: el listado NO lleva `permissionGuard`
 *       (`GET .../espacios` exige solo ser miembro). El alta si, con
 *       `consultorio:manage`.</li>
 *   <li><b>Horarios</b> — `horarios.routes.ts`: las <b>cuatro</b> rutas llevan
 *       `permissionGuard(PERMISO_COLABORADOR_READ)`, la ruta vacia incluida, y por eso lleva
 *       `permisos`.</li>
 *   <li><b>Catalogo</b> — `catalog.routes.ts`: ninguna lleva `permissionGuard`; consultar que
 *       practicas existen es lo que necesita cualquiera que registre una sesion.</li>
 *   <li><b>Servicios</b> — `offering.routes.ts`: ninguna lleva `permissionGuard`.</li>
 *   <li><b>Contratacion</b> — `contracting.routes.ts`: ninguna de las cinco lleva
 *       `permissionGuard`. No existe `convenio:read` y las lecturas se autorizan por
 *       pertenencia, asi que poner `convenio:manage` aca le sacaria del menu la consulta de
 *       arancel efectivo justo a recepcion, que es quien necesita saber cuanto cobrar. Las
 *       acciones si van detras de `*akinePermiso` dentro de cada pantalla.</li>
 *   <li><b>Organizacion</b> — `organization.routes.ts`: la ruta vacia no lleva
 *       `permissionGuard`. Las hijas si —`colaborador:read`, `colaborador:manage`,
 *       `consultorio:manage`, `auditoria:read`—, pero este enlace no abre ninguna de ellas.
 *       Esconder la seccion entera por un permiso que solo hace falta tres clicks mas
 *       adelante le sacaria a un profesional la pantalla de su propia organizacion, que si
 *       puede ver.</li>
 *   <li><b>Caja</b> — `caja.routes.ts`: la unica ruta lleva
 *       `permissionGuard(PERMISO_CAJA_OPERATE)`. Todo lo que hay en la pantalla, incluso leer
 *       la jornada, lo autoriza `caja:operate`, asi que sin el no queda nada que mirar.</li>
 * </ul>
 *
 * <p><b>Esconder no es autorizar.</b> Esta lista es exclusivamente UX: evita ofrecer un enlace
 * que iba a terminar en la pantalla de "no tenes permiso". Quien decide es el backend, que
 * rechaza igual a quien llegue por URL directa.
 *
 * <p>Vive en `layout/` y no en `shared/`: sabe que es un Turno y que es un Paciente, que es
 * justamente lo que `shared/` no puede saber (AGENT.md 4).
 */
export const SECCIONES: readonly Seccion[] = [
  { etiqueta: 'Agenda', ruta: '/agenda' },
  { etiqueta: 'Pacientes', ruta: '/pacientes', permisos: [PERMISO_PACIENTE_READ] },
  { etiqueta: 'Espacios', ruta: '/espacios' },
  { etiqueta: 'Horarios', ruta: RUTA_HORARIOS, permisos: [PERMISO_COLABORADOR_READ] },
  { etiqueta: 'Catalogo', ruta: '/catalogo' },
  { etiqueta: 'Servicios', ruta: '/servicios' },
  // Va despues de Servicios y no al lado de Pacientes: primero se define QUE se ofrece y recien
  // despues con quien se acordo cobrarlo. "Contratacion" y no "Convenios" porque la seccion
  // tambien incluye el catalogo de financiadores, que no es un convenio.
  { etiqueta: 'Contratacion', ruta: '/contratacion' },
  // La caja es de la sede y la opera recepcion. Sin `caja:operate` no hay nada que mirar.
  { etiqueta: 'Caja', ruta: '/caja', permisos: [PERMISO_CAJA_OPERATE] },
  // Presentaciones a financiadores (M21). El permiso es `cobro:register`: lo decidio el backend.
  { etiqueta: 'Presentaciones', ruta: '/presentaciones', permisos: [PERMISO_PRESENTACIONES] },
  // Reportes (M23). `reporting.routes.ts` exige `reporte:read`; adentro cada seccion pide el suyo.
  { etiqueta: 'Reportes', ruta: '/reportes', permisos: [PERMISO_REPORTE_READ] },
  { etiqueta: 'Organizacion', ruta: '/organizacion' },
];

/**
 * Seccion a la que apunta la ruta vacia.
 *
 * <p>La usa `app.routes.ts` para redirigir `/` y esta escrita una sola vez para que el dia que
 * la home cambie, el `redirectTo` y esta lista no puedan discrepar.
 */
export const RUTA_INICIO = '/agenda';
