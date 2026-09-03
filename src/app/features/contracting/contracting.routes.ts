import { Routes } from '@angular/router';

import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';
import { contextGuard } from '../../core/guards/context.guard';

/**
 * Rutas de la feature `contracting` (M15 y M16, etapas AKINE-03.03 y AKINE-03.05).
 *
 * <p>Se monta bajo `contratacion` desde `app.routes.ts` con `loadChildren`, segun ADR-0004.
 * <b>`authGuard` lo pone la ruta padre</b> y vale para las cinco: ninguna tiene sentido sin
 * sesion.
 *
 * <h2>`contextGuard` va en las cinco, y en dos de ellas no era obvio</h2>
 *
 * <p>Los convenios y los aranceles son de una <b>sede</b>: su URL empieza en
 * `/consultorios/{cid}` y sin sede no se puede ni armar la peticion. Hasta ahi no hay nada que
 * decidir.
 *
 * <p>El financiador y sus planes son de la <b>organizacion</b>, asi que en teoria alcanzaria con
 * tener una elegida. Se exige el contexto completo igual, por el mismo motivo que el padron de
 * personas: las mutaciones evaluan `convenio:manage` <b>con la sede del contexto</b> —lo declara
 * el registro de cierre de 03.03— y sin sede el backend responde 403 a cada boton. La pantalla
 * quedaria en modo solo-lectura sin poder explicar por que, que es peor que mandar al selector
 * una vez.
 *
 * <p><b>Ninguna lleva `permissionGuard`, y no es un olvido.</b> No existe `convenio:read`: las
 * lecturas se autorizan por pertenencia. Un guard de `convenio:manage` sobre el listado dejaria
 * sin poder consultar los aranceles a recepcion, que es justamente quien necesita saber cuanto
 * cobrar. Las <b>acciones</b> si van detras de `*akinePermiso`, que es UX; la autoridad sigue
 * siendo el backend.
 *
 * <h2>Por que las jerarquias cuelgan de su padre y no son rutas sueltas</h2>
 *
 * <p>`financiadores/:financiadorId/planes` y `convenios/:convenioId/aranceles` siguen el
 * precedente de `ofertas/:ofertaId/habilitaciones`: un plan no existe sin su financiador y un
 * arancel no existe sin su convenio —la vigencia del arancel tiene que estar contenida en la del
 * convenio—, asi que la URL tiene que poder compartirse con el padre puesto. Una pantalla de
 * "planes" suelta obligaria a elegir el financiador de nuevo en cada visita.
 *
 * <p><b>No hay `:orgId` ni `:consultorioId` en ninguna URL.</b> El tenant es el del contexto de
 * trabajo. Un id en la URL seria un segundo lugar desde donde elegir tenant, y el unico que el
 * token acota es el del contexto. Los ids que si estan —financiador, convenio— identifican una
 * fila dentro de ese tenant, que es otra cosa.
 *
 * <p>Las cinco piden <b>ancho amplio</b>: la grilla de aranceles tiene los tres importes, las dos
 * fechas de vigencia, el estado y las acciones, y a 46rem de ancho de lectura "Dar de baja" queda
 * detras del scroll horizontal, que para el usuario es lo mismo que no existir.
 */
export const routes: Routes = [
  {
    path: 'financiadores',
    canActivate: [contextGuard],
    loadComponent: () =>
      import('./pages/financiadores/financiadores-page').then((m) => m.FinanciadoresPage),
    title: 'AKINE - Financiadores',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'financiadores',
  },
];
