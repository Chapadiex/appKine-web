import { Routes } from '@angular/router';

import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';

/**
 * Rutas de la feature `catalog` (catalogo clinico M06, etapa AKINE-02.05).
 *
 * <p>Se monta bajo `catalogo` desde `app.routes.ts` con `loadChildren`, segun ADR-0004.
 * <b>`authGuard` y `contextGuard` los pone la ruta padre</b> y valen para las cuatro de aca.
 *
 * <p><b>Ninguna lleva `permissionGuard`, y no es un olvido.</b> Las tres lecturas del
 * catalogo no evaluan ningun permiso en el backend: se autorizan por pertenencia, porque
 * consultar que practicas existen es lo que necesita cualquiera que registre una sesion.
 * Poner un guard de `consultorio:manage` sobre el listado dejaria sin catalogo a todo el
 * equipo clinico, que es justamente quien lo consulta. Las acciones de cada fila si van
 * detras de `*akinePermiso`, que es UX; la autoridad sigue siendo el backend.
 *
 * <p><b>No hay `:orgId` en ninguna URL.</b> La organizacion es la del contexto de trabajo.
 * Un id en la URL seria un segundo lugar desde donde elegir tenant, y el unico que el token
 * acota es el del contexto.
 *
 * <p><b>Las estaticas van antes que la parametrica.</b> `:tipo` se comeria `solicitudes` y
 * `nomencladores/:id/vigencias` si estuviera primero, y el sintoma seria una pantalla de
 * catalogo pidiendole al backend el tipo `solicitudes`, que no existe.
 */
export const routes: Routes = [
  {
    path: 'solicitudes',
    loadComponent: () =>
      import('./pages/solicitudes/solicitudes-page').then((m) => m.SolicitudesPage),
    title: 'AKINE - Pedidos al catalogo de la plataforma',
    // Sin `ancho`: la tabla tiene cuatro columnas y una de ellas es prosa larga -la
    // justificacion-. A 1216px el texto queda en renglones de 200 caracteres, que es
    // exactamente lo que el ancho de lectura existe para evitar.
  },
  {
    path: 'nomencladores/:nomencladorId/vigencias',
    loadComponent: () => import('./pages/vigencias/vigencias-page').then((m) => m.VigenciasPage),
    title: 'AKINE - Vigencias de un nomenclador',
    // Seis columnas mas la de acciones no entran en los 46rem de lectura: sin esto, "Dar de
    // baja" queda detras del scroll horizontal y para el usuario no existe.
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    path: ':tipo',
    loadComponent: () => import('./pages/catalogos/catalogos-page').then((m) => m.CatalogosPage),
    title: 'AKINE - Catalogo clinico',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    // Entrar a `/catalogo` a secas no es un error: es no haber elegido tipo todavia. Las
    // especialidades son el primero de los tres —las practicas cuelgan de ellas y los
    // nomencladores codifican practicas—, asi que es el unico que se puede mirar sin haber
    // cargado nada antes.
    path: '',
    pathMatch: 'full',
    redirectTo: 'especialidades',
  },
];
