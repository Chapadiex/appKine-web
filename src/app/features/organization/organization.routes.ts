import { Routes } from '@angular/router';

/**
 * Rutas de la feature `organization` (M01, etapa AKINE-01.01).
 *
 * <p>Se monta bajo `organizacion` desde `app.routes.ts` con `loadChildren`, segun la
 * convencion de ADR-0004: cada dominio en su propio chunk, para que el bundle inicial no
 * crezca con cada uno de los 29 modulos.
 *
 * <p><b>Sin guards.</b> El login llega en AKINE-01.02 y con el los guards de sesion y de
 * contexto. Agregar aca un guard de contexto obligaria a redirigir a
 * `/seleccionar-contexto`, que sin login no puede resolverse, y dejaria la aplicacion sin
 * ninguna ruta alcanzable. Cada pagina maneja por su cuenta el caso "todavia no hay
 * contexto elegido" como un estado mas, que es lo que ADR-0005 pide igual.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/organization/organization-page').then((m) => m.OrganizationPage),
    title: 'AKINE - Organizacion',
  },
  {
    path: 'suscripcion',
    loadComponent: () =>
      import('./pages/subscription/subscription-page').then((m) => m.SubscriptionPage),
    title: 'AKINE - Suscripcion',
  },
];
