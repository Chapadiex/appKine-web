import { Routes } from '@angular/router';

import { contextGuard } from '../../core/guards/context.guard';
import { permissionGuard } from '../../core/guards/permission.guard';
import { PERMISO_HC_DECLARAR } from '../../core/models/permisos';

/**
 * Datos que declara el paciente (DP-47). Se monta bajo `pacientes/:personaId/datos-declarados` desde
 * `app.routes.ts`, antes de `pacientes`, igual que la cuenta corriente: la URL cuelga del padron
 * —asi se llega— pero la feature es `clinical`, porque lo declarado vive en la historia.
 *
 * <p>Lleva `permissionGuard(hc:declarar)` a diferencia de la historia: aca el permiso solo alcanza,
 * no hay relacion asistencial que lo complete. El backend decide igual.
 */
export const routes: Routes = [
  {
    path: '',
    canActivate: [contextGuard, permissionGuard(PERMISO_HC_DECLARAR)],
    loadComponent: () =>
      import('./pages/datos-declarados/datos-declarados-page').then((m) => m.DatosDeclaradosPage),
    title: 'AKINE - Datos declarados',
  },
];
