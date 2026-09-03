import { Routes } from '@angular/router';

import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';
import { contextGuard } from '../../core/guards/context.guard';

/**
 * Rutas de la feature `person` (padron de personas M07, etapa AKINE-03.01).
 *
 * <p>Se monta bajo `pacientes` desde `app.routes.ts` con `loadChildren`, segun ADR-0004.
 * <b>`authGuard` lo pone la ruta padre.</b>
 *
 * <h2>Por que la URL dice `pacientes` si la pantalla es de personas</h2>
 *
 * <p>Es la unica concesion de la etapa al vocabulario del usuario, y es deliberada: quien busca
 * esta pantalla en el menu la busca como "pacientes", que es como se llama en cualquier centro.
 * Lo que <b>no</b> se concede es el modelo: adentro la pantalla distingue Persona de Paciente en
 * todo momento, y el alta nunca crea un perfil clinico. La URL es una etiqueta; la regla vive en
 * el backend.
 *
 * <h2>`contextGuard` va aca y no es opcional</h2>
 *
 * <p>El padron es de la <b>organizacion</b>, asi que en teoria alcanzaria con tener una elegida.
 * Se exige el contexto completo igual, porque las dos acciones que la pantalla ofrece —dar de
 * alta y editar— evaluan `paciente:manage` <b>con la sede del contexto</b>: sin sede el backend
 * responde 403 y la pantalla quedaria en modo solo-lectura sin poder explicar por que. Es
 * preferible mandar al selector una vez que dejar al recepcionista mirando botones que fallan.
 *
 * <p><b>No lleva `permissionGuard`, y no es un olvido.</b> La lectura del padron se autoriza por
 * pertenencia, sin evaluar ningun permiso: poner un guard de `paciente:manage` sobre la pantalla
 * dejaria sin poder consultarla a quien solo necesita mirar. Las <b>acciones</b> si van detras de
 * `*akinePermiso`, que es UX; la autoridad sigue siendo el backend.
 *
 * <p><b>No hay `:orgId` en ninguna URL.</b> La organizacion es la del contexto de trabajo. Un id
 * en la URL seria un segundo lugar desde donde elegir tenant, y el unico que el token acota es el
 * del contexto.
 *
 * <p>Pide <b>ancho amplio</b>: la tabla tiene cinco columnas de datos mas la de acciones, y a
 * 46rem "Activar perfil de paciente" queda detras del scroll horizontal, que para el usuario es
 * lo mismo que no existir.
 */
export const routes: Routes = [
  {
    path: '',
    canActivate: [contextGuard],
    loadComponent: () =>
      import('./pages/padron-de-personas/padron-de-personas-page').then(
        (m) => m.PadronDePersonasPage,
      ),
    title: 'AKINE - Padron de personas',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },

  // Ficha 360 de una persona (RF-M07-004, AKINE-03.02).
  //
  // `:personaId` y no un id en un query param: es un recurso, y una ficha tiene que poder
  // compartirse por URL. Las tres pantallas de abajo cuelgan de esta por lo mismo.
  //
  // OJO CON EL ORDEN. `app.routes.ts` declara `pacientes/:personaId/cuenta-corriente` ANTES que
  // `pacientes`, porque `loadChildren` se queda con todo `pacientes/**`. Las rutas hermanas de aca
  // -documentos, coberturas, autorizaciones- no tienen ese problema aunque esten declaradas
  // DESPUES: `:personaId` consume un solo segmento y no declara hijos, asi que ante
  // `pacientes/7/documentos` queda un segmento sin consumir, el match falla y el router sigue
  // probando. Es el backtracking del matcher, no la suerte del orden.
  {
    path: ':personaId',
    canActivate: [contextGuard],
    loadComponent: () =>
      import('./pages/ficha-de-persona/ficha-de-persona-page').then((m) => m.FichaDePersonaPage),
    title: 'AKINE - Ficha de la persona',
  },

  // Documentacion administrativa (M25, AKINE-03.02).
  //
  // Pantalla propia y no una seccion de la ficha: subir, reclasificar y dar de baja documentos es
  // un trabajo con su propio formulario, sus propios filtros y su propia paginacion. Meterlo
  // adentro del 360 haria que la pantalla que se abre para mirar sea la misma en la que se carga,
  // y la ficha dejaria de poder leerse de un vistazo.
  //
  // Ancho amplio: la tabla tiene seis columnas de datos mas la de acciones.
  {
    path: ':personaId/documentos',
    canActivate: [contextGuard],
    loadComponent: () =>
      import('./pages/documentos-de-persona/documentos-de-persona-page').then(
        (m) => m.DocumentosDePersonaPage,
      ),
    title: 'AKINE - Documentos de la persona',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },

  // Coberturas del paciente (M08, AKINE-03.04).
  //
  // Cuelga de la ficha y no es una seccion del menu, por lo mismo que la cuenta corriente: sin una
  // persona elegida no hay ninguna consulta que hacer, y una entrada de menu tendria que abrir un
  // buscador de personas adentro -o sea, el padron otra vez, duplicado-.
  //
  // Ancho amplio: la tabla tiene seis columnas de datos mas la de acciones, y a 46rem la vigencia
  // queda detras del scroll horizontal. Es justamente el dato con el que se decide si la cobertura
  // aplica hoy.
  {
    path: ':personaId/coberturas',
    canActivate: [contextGuard],
    loadComponent: () =>
      import('./pages/coberturas-del-paciente/coberturas-del-paciente-page').then(
        (m) => m.CoberturasDelPacientePage,
      ),
    title: 'AKINE - Coberturas del paciente',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
];
