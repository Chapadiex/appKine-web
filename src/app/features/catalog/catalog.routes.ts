import { Routes } from '@angular/router';

import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';
import { permissionGuard } from '../../core/guards/permission.guard';
import { PERMISO_CATALOGO_READ } from '../../core/models/permisos';

/**
 * Rutas de la feature `catalog` (catalogo clinico M06, etapa AKINE-02.05).
 *
 * <p>Se monta bajo `catalogo` desde `app.routes.ts` con `loadChildren`, segun ADR-0004.
 * <b>`authGuard` y `contextGuard` los pone la ruta padre</b> y valen para las cuatro de aca.
 *
 * <p><b>Las tres llevan `permissionGuard(PERMISO_CATALOGO_READ)`</b> (DP-36 / U-08): leer el
 * catalogo, sus vigencias y los pedidos de alta exige `catalogo:read`, que tiene todo el equipo
 * —que es quien consulta que practicas existen al registrar una sesion— y no el `PACIENTE`. Las
 * acciones de cada fila van detras de `*akinePermiso` con `catalogo:manage`. Las dos cosas son
 * UX; la autoridad sigue siendo el backend.
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
    canActivate: [permissionGuard(PERMISO_CATALOGO_READ)],
    loadComponent: () =>
      import('./pages/solicitudes/solicitudes-page').then((m) => m.SolicitudesPage),
    title: 'AKINE - Pedidos al catalogo de la plataforma',
    // Sin `ancho`: la tabla tiene cuatro columnas y una de ellas es prosa larga -la
    // justificacion-. A 1216px el texto queda en renglones de 200 caracteres, que es
    // exactamente lo que el ancho de lectura existe para evitar.
  },
  {
    path: 'nomencladores/:nomencladorId/vigencias',
    canActivate: [permissionGuard(PERMISO_CATALOGO_READ)],
    loadComponent: () => import('./pages/vigencias/vigencias-page').then((m) => m.VigenciasPage),
    title: 'AKINE - Vigencias de un nomenclador',
    // Seis columnas mas la de acciones no entran en los 46rem de lectura: sin esto, "Dar de
    // baja" queda detras del scroll horizontal y para el usuario no existe.
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    path: ':tipo',
    canActivate: [permissionGuard(PERMISO_CATALOGO_READ)],
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
