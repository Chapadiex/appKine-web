import { Routes } from '@angular/router';

import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';

/**
 * Consola de plataforma (AKINE-A-7). Se monta bajo `plataforma` desde `app.routes.ts`, que pone
 * `authGuard` y `platformAdminGuard`: ninguna de estas rutas pide contexto, porque quien las usa
 * no es miembro de ningun centro.
 */
export const routes: Routes = [
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
    path: 'suscripciones',
    loadComponent: () =>
      import('./pages/suscripcion-de-centro/suscripcion-de-centro-page').then(
        (m) => m.SuscripcionDeCentroPage,
      ),
    title: 'AKINE - Suscripción de un centro',
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
  { path: '', pathMatch: 'full', redirectTo: 'solicitudes' },
];
