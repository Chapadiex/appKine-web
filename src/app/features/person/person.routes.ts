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
];
