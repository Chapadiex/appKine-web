import { Routes } from '@angular/router';

import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';
import { contextGuard } from '../../core/guards/context.guard';

/**
 * Rutas de la feature `offering` (servicios y ofertas M27, etapa AKINE-02.06).
 *
 * <p>Se monta bajo `servicios` desde `app.routes.ts` con `loadChildren`, segun ADR-0004.
 * <b>`authGuard` lo pone la ruta padre</b> y vale para las dos de aca: ninguna de las dos
 * tiene sentido sin sesion.
 *
 * <h2>Por que `contextGuard` va en una sola de las dos, y no en el padre</h2>
 *
 * <p>Es la unica diferencia con la feature `catalog`, que lleva los dos guards arriba, y es
 * deliberada:
 *
 * <ul>
 *   <li><b>Ofertas de la sede</b> no se puede ni armar sin contexto: la peticion empieza en
 *       `/consultorios/{cid}`, y `{cid}` sale del contexto de trabajo. Sin el, la pantalla se
 *       abriria para llenarse de errores. Lleva `contextGuard`.</li>
 *   <li><b>Catalogo de servicios</b> es <b>puramente global</b>: `GET /api/v1/servicios` esta
 *       autorizado por estar autenticado y no mira el tenant (diseno 1 y 5). Exigirle contexto
 *       dejaria afuera justo a quien lo administra —el rol de plataforma, que no
 *       necesariamente tiene una sede elegida— y lo mandaria a un selector de consultorios que
 *       no le sirve para nada. No lleva `contextGuard`.</li>
 * </ul>
 *
 * <p><b>Ninguna lleva `permissionGuard`, y no es un olvido.</b> Las dos lecturas se autorizan
 * sin evaluar permisos: la del catalogo, por estar autenticado; la de ofertas, por pertenencia
 * a la sede. Poner un guard de `consultorio:manage` sobre el listado dejaria sin ver las
 * ofertas a recepcion y al equipo clinico, que son quienes las consultan todo el dia. Las
 * <b>acciones</b> de las ofertas si van detras de `*akinePermiso`, que es UX; la autoridad
 * sigue siendo el backend.
 *
 * <p><b>No hay `:orgId` ni `:consultorioId` en ninguna URL.</b> La sede es la del contexto de
 * trabajo. Un id en la URL seria un segundo lugar desde donde elegir tenant, y el unico que el
 * token acota es el del contexto.
 *
 * <p>Las dos rutas piden <b>ancho amplio</b>: las dos tablas tienen seis columnas de datos mas
 * la de acciones, y a 46rem de ancho de lectura "Dar de baja" queda detras del scroll
 * horizontal, que para el usuario es lo mismo que no existir.
 */
export const routes: Routes = [
  {
    path: 'catalogo',
    loadComponent: () =>
      import('./pages/catalogo-de-servicios/catalogo-de-servicios-page').then(
        (m) => m.CatalogoDeServiciosPage,
      ),
    title: 'AKINE - Catalogo de servicios',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    path: 'ofertas',
    canActivate: [contextGuard],
    loadComponent: () =>
      import('./pages/ofertas-de-la-sede/ofertas-de-la-sede-page').then(
        (m) => m.OfertasDeLaSedePage,
      ),
    title: 'AKINE - Ofertas de la sede',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    // Cuelga de la oferta y no de un `/habilitaciones` suelto: configurar quien presta QUE no
    // tiene sentido sin la oferta delante, y la URL tiene que poder compartirse.
    path: 'ofertas/:ofertaId/habilitaciones',
    canActivate: [contextGuard],
    loadComponent: () =>
      import('./pages/habilitaciones-de-la-oferta/habilitaciones-de-la-oferta-page').then(
        (m) => m.HabilitacionesDeLaOfertaPage,
      ),
    title: 'AKINE - Habilitaciones de la oferta',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    path: 'ofertas/:ofertaId/practicas',
    canActivate: [contextGuard],
    loadComponent: () =>
      import('./pages/practicas-de-la-oferta/practicas-de-la-oferta-page').then(
        (m) => m.PracticasDeLaOfertaPage,
      ),
    title: 'AKINE - Practicas de la oferta',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    // Precios particulares por vigencia (RF-M16-009, AKINE B-3). Cuelga de la oferta por lo mismo
    // que las habilitaciones: no tiene sentido sin la oferta delante.
    path: 'ofertas/:ofertaId/precios',
    canActivate: [contextGuard],
    loadComponent: () =>
      import('./pages/precios-particulares-de-la-oferta/precios-particulares-de-la-oferta-page').then(
        (m) => m.PreciosParticularesDeLaOfertaPage,
      ),
    title: 'AKINE - Precios particulares de la oferta',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    // Entrar a `/servicios` a secas cae en las ofertas, no en el catalogo: el diseno (6) dice
    // que la de ofertas "es la que usa un administrador todos los dias", y el catalogo global
    // es sobre todo una referencia que se consulta cuando hay que dar de alta una oferta.
    path: '',
    pathMatch: 'full',
    redirectTo: 'ofertas',
  },
];
