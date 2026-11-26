import { Routes } from '@angular/router';

import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';

/**
 * Consola de plataforma (AKINE-A-7). Se monta bajo `plataforma` desde `app.routes.ts`, que pone
 * `authGuard` y `platformAdminGuard`: ninguna de estas rutas pide contexto, porque quien las usa
 * no es miembro de ningun centro.
 */
export const routes: Routes = [
  {
    // Inicio de la consola (19/11/2026): estado general, lo que necesita atencion y la actividad.
    path: 'inicio',
    loadComponent: () =>
      import('./pages/inicio-de-plataforma/inicio-de-plataforma-page').then(
        (m) => m.InicioDePlataformaPage,
      ),
    title: 'AKINE - Inicio de la plataforma',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    path: 'solicitudes',
    loadComponent: () =>
      import('./pages/solicitudes-catalogo/solicitudes-catalogo-page').then(
        (m) => m.SolicitudesCatalogoPage,
      ),
    title: 'AKINE - Solicitudes de catálogo',
    // Seis columnas con la de acciones: a 46rem "Revisar" queda detras del scroll horizontal.
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    // Pedidos de prueba gratis de la landing (18/11/2026): nueve columnas con las acciones.
    path: 'pedidos-de-prueba',
    loadComponent: () =>
      import('./pages/pedidos-de-prueba/pedidos-de-prueba-page').then((m) => m.PedidosDePruebaPage),
    title: 'AKINE - Pedidos de prueba',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    // Pedidos de cambio de plan de los centros (25/11/2026).
    path: 'cambios-de-plan',
    loadComponent: () =>
      import('./pages/cambios-de-plan/cambios-de-plan-page').then((m) => m.CambiosDePlanPage),
    title: 'AKINE - Cambios de plan',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    // Alta de un centro; con `?solicitud=<id>` aprueba un pedido de prueba.
    path: 'centros/nuevo',
    loadComponent: () =>
      import('./pages/alta-de-centro/alta-de-centro-page').then((m) => m.AltaDeCentroPage),
    title: 'AKINE - Dar de alta un centro',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    path: 'suscripciones',
    loadComponent: () =>
      import('./pages/suscripcion-de-centro/suscripcion-de-centro-page').then(
        (m) => m.SuscripcionDeCentroPage,
      ),
    title: 'AKINE - Centros y suscripciones',
  },
  {
    // DP-43 (U-12): el catalogo global que los centros adoptan por copia.
    path: 'catalogo-financiadores',
    loadComponent: () =>
      import('./pages/catalogo-financiadores/catalogo-financiadores-page').then(
        (m) => m.CatalogoFinanciadoresPage,
      ),
    title: 'AKINE - Catálogo de financiadores',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  { path: '', pathMatch: 'full', redirectTo: 'inicio' },
];
