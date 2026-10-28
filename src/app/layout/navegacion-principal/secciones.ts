import { RUTA_HORARIOS } from '../../features/resource/models/rutas-de-horarios';
import {
  PERMISO_AUDITORIA_READ,
  PERMISO_CAJA_OPERATE,
  PERMISO_CATALOGO_READ,
  PERMISO_CLASE_READ,
  PERMISO_COBRO_REGISTER,
  PERMISO_COLABORADOR_READ,
  PERMISO_CONSULTORIO_MANAGE,
  PERMISO_CONVENIO_READ,
  PERMISO_INSCRIPCION_READ,
  PERMISO_PACIENTE_READ,
  PERMISO_PRODUCTO_READ,
  PERMISO_REPORTE_READ,
  PERMISO_SESION_REGISTER,
  PERMISO_TURNO_READ,
} from '../../core/models/permisos';
import { RUTA_CLASES } from '../../features/activity/models/rutas-de-clases';
import { RUTA_PRODUCTOS } from '../../features/activity/models/rutas-de-pases';
import { NombreDeIcono } from '../../shared/components/icono/icono';

/** Una entrada de la navegacion principal. */
export interface Seccion {
  readonly etiqueta: string;

  readonly ruta: string;

  /**
   * Permisos de los que al menos uno tiene que estar presente para mostrar la entrada. Sin
   * `permisos`, la seccion se ve con solo tener contexto.
   */
  readonly permisos?: readonly string[];
}

/** Un grupo de secciones con su rotulo. Un grupo sin secciones visibles no se dibuja. */
export interface GrupoDeSecciones {
  readonly etiqueta: string;

  /** Icono del grupo en la barra. Un grupo con una sola seccion visible lo presta a su enlace. */
  readonly icono: NombreDeIcono;

  readonly secciones: readonly Seccion[];
}

/**
 * Las secciones de AKINE agrupadas por tarea, en el orden en que se muestran (UX-01, grupos y
 * nombres del canvas "AKINE · Pantallas" del 22/10/2026).
 *
 * <p>El orden sigue el dia de un centro: lo que el mostrador usa cien veces por dia va arriba
 * (Operacion), lo que el administrador configura una vez por mes va abajo (Configuracion). La
 * consola de plataforma no esta aca: no es una seccion del centro y la plantilla la agrega al pie
 * solo para `PLATFORM_ADMIN`.
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
 *   <li><b>Recepcion del dia</b> — `scheduling.routes.ts`: `permissionGuard(PERMISO_TURNO_READ)`.
 *       Entra a la barra por ser la pantalla mas usada del mostrador; sus hermanas (series,
 *       atencion sin turno) son pestanas de la agenda.</li>
 *   <li><b>Calendario de turnos</b> — `scheduling.routes.ts`:
 *       `permissionGuard(PERMISO_TURNO_READ)`, como la recepcion (DP-45).</li>
 *   <li><b>Pacientes</b> — `person.routes.ts`: `permissionGuard(PERMISO_PACIENTE_READ)` en todas
 *       las rutas (DP-22): la lectura de personas exige `paciente:read`, que el staff tiene y el
 *       paciente no. `paciente:manage` gobierna el alta, que es de la pantalla.</li>
 *   <li><b>Clases, Asistencia, Productos de pack</b> — `activity.routes.ts`,
 *       `asistencia.routes.ts`, `pases.routes.ts`: `clase:read`, `inscripcion:read` y
 *       `producto:read` respectivamente.</li>
 *   <li><b>Caja y Egresos</b> — `caja.routes.ts` y `egresos.routes.ts`: `caja:operate`.</li>
 *   <li><b>Presentaciones</b> — `presentaciones.routes.ts`: `cobro:register`.</li>
 *   <li><b>Reportes</b> — `reporting.routes.ts`: `reporte:read` (DP-15).</li>
 *   <li><b>Organizacion</b> — `organization.routes.ts`: la ruta vacia no lleva
 *       `permissionGuard`; sus hijas si, y lo resuelve cada pantalla.</li>
 *   <li><b>Espacios</b> — `resource.routes.ts`: el listado NO lleva `permissionGuard`
 *       (`GET .../espacios` exige solo ser miembro). El alta si, con `consultorio:manage`.</li>
 *   <li><b>Horarios</b> — `horarios.routes.ts`: las <b>cuatro</b> rutas llevan
 *       `permissionGuard(PERMISO_COLABORADOR_READ)`, la ruta vacia incluida.</li>
 *   <li><b>Servicios</b> — `offering.routes.ts`: ninguna lleva `permissionGuard`.</li>
 *   <li><b>Catalogo</b> — `catalog.routes.ts`: las tres rutas llevan
 *       `permissionGuard(PERMISO_CATALOGO_READ)` (DP-36).</li>
 *   <li><b>Contratacion</b> — `contracting.routes.ts`: todas las rutas llevan
 *       `permissionGuard(PERMISO_CONVENIO_READ)` (DP-36).</li>
 * </ul>
 *
 * <p>Las etiquetas son nombres accesibles que los E2E buscan con `getByRole('link', { name })`
 * (`riesgo-permisos-*`): cambiar una es cambiar el E2E en el mismo PR.
 */
export const GRUPOS: readonly GrupoDeSecciones[] = [
  {
    etiqueta: 'Atención',
    icono: 'operacion',
    secciones: [
      { etiqueta: 'Agenda', ruta: '/agenda' },
      {
        etiqueta: 'Calendario de turnos',
        ruta: '/agenda/calendario',
        permisos: [PERMISO_TURNO_READ],
      },
      { etiqueta: 'Recepción del día', ruta: '/agenda/recepcion', permisos: [PERMISO_TURNO_READ] },
      { etiqueta: 'Series de turnos', ruta: '/agenda/series', permisos: [PERMISO_TURNO_READ] },
      {
        etiqueta: 'Atender sin turno',
        ruta: '/atencion/sin-turno',
        permisos: [PERMISO_SESION_REGISTER],
      },
    ],
  },
  {
    etiqueta: 'Pacientes',
    icono: 'pacientes',
    secciones: [{ etiqueta: 'Padrón', ruta: '/pacientes', permisos: [PERMISO_PACIENTE_READ] }],
  },
  {
    etiqueta: 'Actividades',
    icono: 'actividades',
    secciones: [
      { etiqueta: 'Clases', ruta: RUTA_CLASES, permisos: [PERMISO_CLASE_READ] },
      { etiqueta: 'Asistencia', ruta: '/asistencia', permisos: [PERMISO_INSCRIPCION_READ] },
      { etiqueta: 'Productos de pack', ruta: RUTA_PRODUCTOS, permisos: [PERMISO_PRODUCTO_READ] },
    ],
  },
  {
    etiqueta: 'Economía',
    icono: 'economia',
    secciones: [
      { etiqueta: 'Caja diaria', ruta: '/caja', permisos: [PERMISO_CAJA_OPERATE] },
      { etiqueta: 'Egresos', ruta: '/egresos', permisos: [PERMISO_CAJA_OPERATE] },
      { etiqueta: 'Honorarios', ruta: '/egresos/honorarios', permisos: [PERMISO_CAJA_OPERATE] },
      { etiqueta: 'Presentaciones', ruta: '/presentaciones', permisos: [PERMISO_COBRO_REGISTER] },
      { etiqueta: 'Reportes', ruta: '/reportes', permisos: [PERMISO_REPORTE_READ] },
    ],
  },
  {
    etiqueta: 'Servicios y catálogo',
    icono: 'servicios',
    secciones: [
      { etiqueta: 'Catálogo de servicios', ruta: '/servicios/catalogo' },
      { etiqueta: 'Ofertas de la sede', ruta: '/servicios/ofertas' },
      { etiqueta: 'Catálogo clínico', ruta: '/catalogo', permisos: [PERMISO_CATALOGO_READ] },
      {
        etiqueta: 'Pedidos al catálogo',
        ruta: '/catalogo/solicitudes',
        permisos: [PERMISO_CATALOGO_READ],
      },
    ],
  },
  {
    etiqueta: 'Contratación',
    icono: 'contratacion',
    secciones: [
      {
        etiqueta: 'Convenios de la sede',
        ruta: '/contratacion/convenios',
        permisos: [PERMISO_CONVENIO_READ],
      },
      {
        etiqueta: 'Financiadores',
        ruta: '/contratacion/financiadores',
        permisos: [PERMISO_CONVENIO_READ],
      },
      {
        etiqueta: 'Arancel efectivo',
        ruta: '/contratacion/arancel-efectivo',
        permisos: [PERMISO_CONVENIO_READ],
      },
    ],
  },
  {
    etiqueta: 'Espacios y horarios',
    icono: 'horarios',
    secciones: [
      { etiqueta: 'Espacios y boxes', ruta: '/espacios' },
      { etiqueta: 'Espacios en servicio', ruta: '/espacios/disponibilidad' },
      {
        etiqueta: 'Horarios de profesionales',
        ruta: RUTA_HORARIOS,
        permisos: [PERMISO_COLABORADOR_READ],
      },
      {
        etiqueta: 'Calendario de la sede',
        ruta: `${RUTA_HORARIOS}/calendario`,
        permisos: [PERMISO_COLABORADOR_READ],
      },
      {
        etiqueta: 'Cierres y aperturas',
        ruta: `${RUTA_HORARIOS}/excepciones`,
        permisos: [PERMISO_COLABORADOR_READ],
      },
    ],
  },
  {
    etiqueta: 'Configuración',
    icono: 'configuracion',
    secciones: [
      { etiqueta: 'Organización', ruta: '/organizacion' },
      { etiqueta: 'Sedes', ruta: '/organizacion/sedes' },
      {
        etiqueta: 'Colaboradores',
        ruta: '/organizacion/colaboradores',
        permisos: [PERMISO_COLABORADOR_READ],
      },
      { etiqueta: 'Suscripción', ruta: '/organizacion/suscripcion' },
      {
        etiqueta: 'Auditoría',
        ruta: '/organizacion/auditoria',
        permisos: [PERMISO_AUDITORIA_READ],
      },
      {
        etiqueta: 'Política de enmienda',
        ruta: '/atencion/politica-de-enmienda',
        permisos: [PERMISO_CONSULTORIO_MANAGE],
      },
    ],
  },
];

/** Todas las secciones, sin grupo, en el orden de la barra. */
export const SECCIONES: readonly Seccion[] = GRUPOS.flatMap((grupo) => grupo.secciones);

/** La consola de plataforma: no es una seccion del centro y la barra la agrega al pie para `PLATFORM_ADMIN`. */
export const SECCION_PLATAFORMA: Seccion = { etiqueta: 'Plataforma', ruta: '/plataforma' };

/** A donde va quien entra por `/`: la agenda es la unica seccion que todo contexto puede abrir. */
export const RUTA_INICIO = '/agenda';

/**
 * La seccion que corresponde a una URL: la de ruta mas larga que sea prefijo de la URL por
 * segmentos. En `/agenda/recepcion` gana "Recepcion del dia" y no "Agenda"; en
 * `/agenda/ofertas/1/reservar` queda "Agenda". Con `routerLinkActive` por prefijo las dos
 * quedaban marcadas a la vez.
 */
export function seccionDe(url: string, secciones: readonly Seccion[]): Seccion | null {
  const camino = url.split(/[?#]/)[0] ?? '';
  let elegida: Seccion | null = null;
  for (const seccion of secciones) {
    const coincide = camino === seccion.ruta || camino.startsWith(`${seccion.ruta}/`);
    if (coincide && (elegida === null || seccion.ruta.length > elegida.ruta.length)) {
      elegida = seccion;
    }
  }
  return elegida;
}
