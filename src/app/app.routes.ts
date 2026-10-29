import { Routes } from '@angular/router';

import { RUTA_INICIO } from './layout/navegacion-principal/secciones';
import { SEGMENTO_DE_TRANSITO, transitoGuard } from './layout/selector-de-sede/cambio-de-sede';
import { SEGMENTO_HORARIOS } from './features/resource/models/rutas-de-horarios';
import { authGuard } from './core/guards/auth.guard';
import { contextGuard } from './core/guards/context.guard';
import { platformAdminGuard } from './core/guards/platform-admin.guard';
import { SEGMENTO_PLATAFORMA } from './features/platform/models/rutas-de-plataforma';
import { routes as rutasPlatform } from './features/platform/platform.routes';
import { routes as rutasAuth } from './features/auth/auth.routes';
import { routes as rutasOrganization } from './features/organization/organization.routes';
import { routes as rutasResource } from './features/resource/resource.routes';
import { routes as rutasHorarios } from './features/resource/horarios.routes';
import { routes as rutasCatalog } from './features/catalog/catalog.routes';
import { routes as rutasOffering } from './features/offering/offering.routes';
import { routes as rutasContracting } from './features/contracting/contracting.routes';
import { routes as rutasBilling } from './features/billing/billing.routes';
import { routes as rutasPerson } from './features/person/person.routes';
import { routes as rutasScheduling } from './features/scheduling/scheduling.routes';
import { routes as rutasCaja } from './features/billing/caja.routes';
import { routes as rutasPresentaciones } from './features/billing/presentaciones.routes';
import { routes as rutasEgresos } from './features/billing/egresos.routes';
import { routes as rutasReporting } from './features/reporting/reporting.routes';
import { routes as rutasActivity } from './features/activity/activity.routes';
import { SEGMENTO_CLASES } from './features/activity/models/rutas-de-clases';
import { routes as rutasAsistencia } from './features/activity/asistencia.routes';
import { rutasPasesDePersona, rutasProductos } from './features/activity/pases.routes';
import { routes as rutasCuenta } from './features/cuenta/cuenta.routes';
import { SEGMENTO_CUENTA } from './features/cuenta/models/rutas-de-cuenta';
import {
  PATRON_PASES_DE_PERSONA,
  SEGMENTO_PRODUCTOS,
} from './features/activity/models/rutas-de-pases';

/**
 * Rutas raiz de AKINE (estructura fijada en AKINE-00.02).
 *
 * <p><b>Convencion para las features de M01-M29:</b> cada dominio tiene su propio archivo de
 * rutas y cada PANTALLA se carga perezosa con `loadComponent` (ADR-0004). El archivo de rutas
 * se monta con `children`, no con `loadChildren`:
 *
 * <pre>
 * import { routes as rutasPerson } from './features/person/person.routes';
 * {
 *   path: 'pacientes',
 *   children: rutasPerson,
 *   canActivate: [authGuard, contextGuard],
 * }
 * </pre>
 *
 * <p><b>Por que `children` (AKINE-LCP).</b> Con `loadChildren` la primera carga de cualquier
 * pantalla interna bajaba en serie el chunk de la configuracion, el de sus imports y recien
 * despues el de la pantalla: una ida y vuelta mas antes de pintar, ~200 ms con la latencia de
 * un movil 4G (G-10). Las configuraciones son tablas de rutas —strings, guards y
 * `loadComponent`—, y todas juntas pesan unos pocos KB comprimidos en el bundle inicial; lo
 * que pesa, el codigo de cada pantalla, sigue siendo perezoso. Un archivo de rutas NUNCA
 * importa un componente de forma estatica: lo arrastraria al bundle inicial.
 *
 * <p>`clinical` sigue con `loadChildren`: queda fuera del alcance de ese cambio.
 *
 * <p>Los guards son UX: evitan una navegacion que va a fallar. La autoridad de permisos es
 * el backend, que rechaza igual si se llega por URL directa.
 */
export const routes: Routes = [
  // La raiz manda a la Agenda, que es la pantalla del dia.
  //
  // Hasta esta tarea `''` montaba el baseline tecnico —version del backend y del contrato—,
  // que es una pantalla de diagnostico y no un inicio: quien abria AKINE aterrizaba en un
  // informe de conectividad y desde ahi no habia enlace a ningun lado.
  //
  // Se redirige en vez de construir un tablero: un inicio de verdad -turnos de hoy, pendientes-
  // es una pantalla con datos propios y endpoints propios, y esta tarea es de navegacion. La
  // agenda ya es esa pantalla para recepcion, que es quien mas abre el producto.
  //
  // Los guards del destino resuelven los dos casos borde sin que esta ruta sepa nada: un
  // anonimo cae en el login y una sesion sin contexto, en el selector.
  {
    path: '',
    pathMatch: 'full',
    redirectTo: RUTA_INICIO,
  },

  // El baseline tecnico no se borra, se muda a su propia URL. Sigue siendo la unica pantalla
  // que prueba de punta a punta que el cliente generado, el proxy y el backend se hablan, y el
  // smoke E2E la usa para eso.
  {
    path: 'estado',
    loadComponent: () => import('./features/platform/pages/estado/estado').then((m) => m.Estado),
    title: 'AKINE - Estado del sistema',
  },

  // Consola de plataforma (AKINE-A-7): la bandeja de solicitudes al catalogo comun.
  //
  // `authGuard` sin `contextGuard`: quien la usa administra la plataforma, no es miembro de
  // ningun centro y opera con el token `pre_context`. `platformAdminGuard` es UX: el backend
  // verifica el rol en cada request.
  {
    path: SEGMENTO_PLATAFORMA,
    canActivate: [authGuard, platformAdminGuard],
    children: rutasPlatform,
  },

  // Feature `auth` (M02). Lazy loaded segun ADR-0004.
  //
  // Sin `canActivate`: son las unicas pantallas que un usuario anonimo tiene que poder
  // abrir. Los enlaces de los correos entran por `auth/activar` y `auth/restablecer`.
  {
    path: 'auth',
    children: rutasAuth,
  },

  // Seleccion del contexto de trabajo (M01). Va suelta y no bajo `organizacion` porque
  // logicamente precede a tener una: es la pantalla con la que se averigua cual.
  //
  // Lleva `authGuard` pero NO `contextGuard`: es justamente la pantalla donde se elige el
  // contexto, y exigirle tener uno la volveria inalcanzable.
  {
    path: 'seleccionar-contexto',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/organization/pages/context-selector/context-selector-page').then(
        (m) => m.ContextSelectorPage,
      ),
    title: 'AKINE - Elegir contexto',
  },

  // Cuenta propia: Mi perfil y Preferencias, desde el menu del perfil de la barra superior
  // (refactor de la cabecera global, 28/10/2026). `contextGuard` lo ponen las rutas hijas.
  {
    path: SEGMENTO_CUENTA,
    canActivate: [authGuard],
    children: rutasCuenta,
  },

  // Feature `organization` (M01). Lazy loaded segun ADR-0004.
  //
  // Los dos guards, en este orden: sin sesion no tiene sentido preguntar por el contexto.
  // Son UX y no seguridad —el backend rechaza igual si se llega por URL directa—, pero sin
  // ellos estas pantallas se abren vacias y muestran un 403 en vez de mandar a resolverlo.
  {
    path: 'organizacion',
    canActivate: [authGuard, contextGuard],
    children: rutasOrganization,
  },

  // Feature `resource` (M04, espacios y boxes). Lazy loaded segun ADR-0004.
  //
  // Va suelta y no bajo `organizacion` porque no es una pantalla de la Organizacion: los
  // espacios son de la SEDE del contexto de trabajo activo, y su publico -recepcion y
  // profesionales, que consultan en que box atienden- no es el que administra el tenant.
  //
  // Los dos guards, en este orden: sin sesion no tiene sentido preguntar por el contexto. Sin
  // contexto no hay sede, y sin sede no hay espacios que listar.
  {
    path: 'espacios',
    canActivate: [authGuard, contextGuard],
    children: rutasResource,
  },

  // Horarios de profesional (M05, AKINE-02.04). Lazy loaded segun ADR-0004.
  //
  // Raiz propia y NO bajo `espacios`: los espacios son recursos fisicos y esto es cuando
  // trabaja una persona. Ademas `/espacios/disponibilidad` ya existe y responde otra cosa —si
  // un box esta en servicio—, asi que colgar el horario del profesional del mismo prefijo
  // garantizaba que alguien terminara en la pantalla equivocada.
  //
  // Los dos guards, en este orden y por el mismo motivo que en espacios: sin sesion no tiene
  // sentido preguntar por el contexto, y sin sede no hay horario que consultar.
  //
  // El segmento sale de `features/resource/models/rutas-de-horarios.ts`, que es el mismo lugar
  // del que salen los `routerLink` de las cuatro pantallas y los segmentos hijos. Importar una
  // constante de strings no rompe el lazy loading: no arrastra ningun componente.
  {
    path: SEGMENTO_HORARIOS,
    canActivate: [authGuard, contextGuard],
    children: rutasHorarios,
  },

  // Catalogo clinico: especialidades, practicas, nomencladores y los pedidos al catalogo comun
  // (M06, AKINE-02.05).
  //
  // Los mismos dos guards, en el mismo orden, y por el mismo motivo que espacios: el listado
  // mezcla los conceptos de la plataforma con los del centro, y cual es "el centro" sale del
  // contexto de trabajo. Sin el, la peticion no se puede ni armar.
  //
  // Sin `permissionGuard`: consultar que practicas existen es lo que necesita cualquiera que
  // registre una sesion, no solo quien administra. Las acciones si van detras de permiso.
  {
    path: 'catalogo',
    canActivate: [authGuard, contextGuard],
    children: rutasCatalog,
  },

  // Servicios del catalogo global y ofertas de la sede (M27, AKINE-02.06).
  //
  // Raiz propia y NO bajo `catalogo`: el catalogo clinico es vocabulario de lo que se HACE
  // durante una atencion —especialidades, practicas, nomencladores—, y esto es vocabulario
  // COMERCIAL: lo que el centro le ofrece a una persona. Es la separacion que RN-M06-004 hace
  // explicita y la que la regla maestra 14 protege; colgarlas del mismo prefijo garantizaba
  // que alguien terminara en la pantalla equivocada.
  //
  // Aca va solo `authGuard`. `contextGuard` lo pone la ruta hija de ofertas, que es la unica
  // que necesita una sede: el catalogo de servicios es global y su lectura se autoriza con
  // estar autenticado, asi que exigirle contexto dejaria afuera al rol de plataforma, que es
  // justamente quien lo administra. El detalle esta en `offering.routes.ts`.
  {
    path: 'servicios',
    canActivate: [authGuard],
    children: rutasOffering,
  },

  // Financiadores, planes, convenios y aranceles (M15 y M16, AKINE-03.03 y 03.05).
  //
  // Raiz propia y NO bajo `servicios`: la oferta dice como esta sede presta un servicio y a que
  // precio de lista, y esto dice cuanto paga un financiador por una practica bajo un convenio.
  // Son las dos mitades del dato economico y no la misma: RN-M16-001 pone el convenio en la
  // SEDE y el financiador en la ORGANIZACION, mientras que la oferta es siempre de la sede.
  // Colgarlas del mismo prefijo garantizaba que alguien terminara en la pantalla equivocada.
  //
  // Tampoco bajo `pacientes`: la Cobertura del paciente y el Convenio del consultorio son cosas
  // distintas —AGENT.md 7.6 lo declara como regla maestra— y esta feature es la del convenio.
  //
  // Aca va solo `authGuard`. `contextGuard` lo ponen las cinco rutas hijas; el detalle de por
  // que tambien lo llevan las de financiadores, que son de la organizacion, esta en
  // `contracting.routes.ts`.
  {
    path: 'contratacion',
    canActivate: [authGuard],
    children: rutasContracting,
  },

  // Padron de personas (M07, AKINE-03.01).
  //
  // La URL dice `pacientes` porque es como se llama esta pantalla en cualquier centro, y es la
  // unica concesion al vocabulario: adentro, Persona y Paciente se distinguen en todo momento y
  // el alta nunca crea un perfil clinico. El detalle esta en `person.routes.ts`.
  //
  // `contextGuard` lo pone la ruta hija: el padron es de la ORGANIZACION, pero sus dos acciones
  // evaluan el permiso con la sede del contexto, asi que sin sede la pantalla quedaria en
  // solo-lectura sin poder explicar por que.
  // Cuenta corriente de un paciente (M18, AKINE-07.01).
  //
  // VA ANTES QUE `pacientes` A PROPOSITO. Angular resuelve por orden, y `pacientes` con
  // `loadChildren` se queda con todo `pacientes/**`: declarada despues, esta ruta seria
  // inalcanzable y el usuario caeria en el 404 del comodin de `person`.
  //
  // La URL cuelga del padron porque asi es como se llega -primero se busca a la persona, despues
  // se mira que debe-, pero la FEATURE es propia: la deuda no es un dato del padron y `person` no
  // puede importar de `billing` (AGENT.md 4.4). Declararla aca es lo que deja convivir las dos
  // cosas. El detalle esta en `billing.routes.ts`.
  //
  // `contextGuard` lo pone la ruta hija: la consulta se arma con una sede, aunque la deuda que
  // devuelve sea de toda la ORGANIZACION.
  {
    path: 'pacientes/:personaId/cuenta-corriente',
    canActivate: [authGuard],
    children: rutasBilling,
  },

  // Pases de una persona (F9, M29, AKINE-08.06). Cuelga del padron por lo mismo que la cuenta
  // corriente —se llega buscando a la persona— y por lo mismo va ANTES que `pacientes`. La
  // feature es `activity`, no `person`: un pase es un saldo de creditos, no un dato del padron.
  {
    path: PATRON_PASES_DE_PERSONA,
    canActivate: [authGuard],
    children: rutasPasesDePersona,
  },

  {
    path: 'pacientes',
    canActivate: [authGuard],
    children: rutasPerson,
  },

  // Agenda de turnos y reserva (M12, AKINE-05.01 y 05.02).
  //
  // Raiz propia y no bajo `servicios/ofertas`: la oferta es lo que el centro ofrece y la agenda es
  // cuando se puede prestar. Su publico tampoco es el mismo -recepcion agenda todo el dia, y no
  // administra el catalogo comercial-, y colgarlas del mismo prefijo garantizaba que alguien
  // terminara en la pantalla equivocada.
  //
  // `contextGuard` lo ponen las rutas hijas: la agenda es de una SEDE, y sin ella no hay ni URL
  // que armar. El detalle esta en `scheduling.routes.ts`.
  {
    path: 'agenda',
    canActivate: [authGuard],
    children: rutasScheduling,
  },

  // Atencion clinica (M14, AKINE-06.01 y 06.02).
  //
  // Raiz propia y NO bajo `agenda`: Turno es reserva y Sesion es atencion realizada, que es la
  // regla maestra 4 y la separacion que DP-05 hace explicita. Colgarla de `agenda` sugeriria que
  // son dos vistas de la misma cosa, que es justamente la confusion que produce pantallas
  // incorrectas. Su publico tampoco es el mismo: la agenda la abre recepcion todo el dia y esto
  // lo escribe el profesional que atiende.
  //
  // La URL identifica al TURNO -`atencion/turnos/:turnoId`- porque iniciar es idempotente. El
  // detalle esta en `clinical.routes.ts`.
  //
  // `contextGuard` lo pone la ruta hija: la atencion es de una SEDE.
  {
    path: 'atencion',
    canActivate: [authGuard],
    loadChildren: () => import('./features/clinical/clinical.routes').then((m) => m.routes),
  },

  // Caja diaria de la sede (M20, AKINE-07.03).
  //
  // Raiz propia y no bajo `pacientes/.../cuenta-corriente`: la caja es de la SEDE, no de una
  // persona, y Obligacion, Cobro y Caja son tres vistas distintas (regla maestra 5). Misma
  // feature `billing`, otro archivo de rutas. `contextGuard` y `permissionGuard` los pone la ruta
  // hija; el detalle esta en `caja.routes.ts`.
  {
    path: 'caja',
    canActivate: [authGuard],
    children: rutasCaja,
  },

  // Historia Clinica (M09/M25, D-a).
  //
  // Raiz propia y NO bajo `atencion`: la historia es de la persona en la organizacion y la
  // atencion es una sesion de una sede. HC != Sesion es la regla maestra 1. La URL lleva la
  // persona porque la historia se pide por persona, y una persona sin historia tiene que tener
  // donde mostrarse. El detalle esta en `historia-clinica.routes.ts`.
  {
    path: 'historia-clinica',
    canActivate: [authGuard],
    loadChildren: () => import('./features/clinical/historia-clinica.routes').then((m) => m.routes),
  },

  // Pantalla de permiso insuficiente (AKINE-01.03). Es el destino de `permissionGuard`.
  //
  // Sin guards, y no por descuido: quien llega aca YA paso por `authGuard` y `contextGuard`
  // en la ruta que se le nego, asi que tiene sesion y contexto. Ponerle un `authGuard` seria
  // ademas peligroso el dia que algo redirija aca sin sesion: el usuario rebotaria al login,
  // volveria a la URL original y giraria en el mismo bucle que esta pantalla existe para
  // cortar. La constante que la nombra vive en `core/models/rutas.ts` (RUTA_SIN_PERMISO).
  // Presentaciones a financiadores (M21, AKINE-07.04 + F-7). Rutas propias dentro de `billing`.
  {
    path: 'presentaciones',
    canActivate: [authGuard],
    children: rutasPresentaciones,
  },

  // Egresos y pagos de la sede (M22, AKINE-07.05 + F-5). Rutas propias dentro de `billing`;
  // `contextGuard` y `permissionGuard(caja:operate)` los pone `egresos.routes.ts`.
  {
    path: 'egresos',
    canActivate: [authGuard],
    children: rutasEgresos,
  },

  // Reportes de la sede (M23, AKINE-07.06 y G-8). `contextGuard` y `permissionGuard(reporte:read)`
  // los pone `reporting.routes.ts`, como en caja y presentaciones.
  {
    path: 'reportes',
    canActivate: [authGuard],
    children: rutasReporting,
  },

  // Clases grupales e inscripciones (M28, segunda entrega, AKINE-08.01 y 08.02).
  //
  // Raiz propia y NO bajo `agenda`: una clase es un evento grupal unico, no N turnos
  // (CA-M28-001-06), con su propia maquina de estados y sus propios permisos (`clase:*`,
  // `inscripcion:*`). La agenda del dia si las muestra, como proyeccion de lectura, y enlaza aca.
  // `contextGuard` y `permissionGuard` los ponen las rutas hijas: `activity.routes.ts`.
  {
    path: SEGMENTO_CLASES,
    canActivate: [authGuard],
    children: rutasActivity,
  },

  // Asistencia a clases (F9, M28/M13, AKINE-08.03). `contextGuard` y el permiso los pone
  // `asistencia.routes.ts`: la clase es de la sede.
  {
    path: 'asistencia',
    canActivate: [authGuard],
    children: rutasAsistencia,
  },

  // Catalogo de productos de pack (F9, M29, AKINE-08.06). `contextGuard` y `producto:read` los
  // pone `pases.routes.ts`: el producto es de la sede.
  {
    path: SEGMENTO_PRODUCTOS,
    canActivate: [authGuard],
    children: rutasProductos,
  },

  // Paso intermedio del cambio de sede: sin componente ni titulo, para que la seccion de destino
  // se active de nuevo con todos sus guards (ver `layout/selector-de-sede/cambio-de-sede.ts`).
  {
    path: SEGMENTO_DE_TRANSITO,
    canActivate: [transitoGuard],
    children: [],
  },

  {
    path: 'sin-permiso',
    loadComponent: () => import('./shared/pages/sin-permiso/sin-permiso').then((m) => m.SinPermiso),
    title: 'AKINE - Sin permiso',
  },

  // Comodin al final: cualquier ruta desconocida cae aca.
  {
    path: '**',
    loadComponent: () => import('./shared/pages/not-found/not-found').then((m) => m.NotFound),
    title: 'AKINE - Página no encontrada',
  },
];
