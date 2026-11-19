import { Signal, computed } from '@angular/core';

import {
  PERMISO_CAJA_OPERATE,
  PERMISO_COBRO_REGISTER,
  PERMISO_REPORTE_READ,
} from '../../../core/models/permisos';
import { PermissionsStore } from '../../../core/services/permissions.store';
import { Pestana } from '../../../shared/components/pestanas/pestanas';

/** `aria-label` de las pestanas del grupo Economia. */
export const ETIQUETA_PESTANAS_DE_ECONOMIA = 'Pantallas de economía';

/**
 * Las pantallas hermanas del grupo Economia de la barra lateral: caja, egresos, honorarios,
 * presentaciones y reportes, con las mismas etiquetas y el mismo permiso que su entrada en la
 * barra. Ocultar una pestana es UX: el `permissionGuard` de cada ruta y el backend rechazan igual.
 *
 * <p><b>Hay una copia en `features/billing/models/`</b>: ADR-0004 no deja que una feature importe
 * de otra. Si cambia una, cambia la otra.
 */
export function pestanasDeEconomia(permisos: PermissionsStore): Signal<readonly Pestana[]> {
  return computed(() => {
    const caja = permisos.tiene(PERMISO_CAJA_OPERATE);
    return [
      ...(caja
        ? [
            { etiqueta: 'Caja diaria', ruta: '/caja' },
            // `exacta`: si no, Egresos quedaria marcada tambien en Honorarios.
            { etiqueta: 'Egresos', ruta: '/egresos', exacta: true },
            { etiqueta: 'Honorarios', ruta: '/egresos/honorarios' },
          ]
        : []),
      ...(permisos.tiene(PERMISO_COBRO_REGISTER)
        ? [{ etiqueta: 'Presentaciones', ruta: '/presentaciones' }]
        : []),
      ...(permisos.tiene(PERMISO_REPORTE_READ)
        ? [{ etiqueta: 'Reportes', ruta: '/reportes' }]
        : []),
    ];
  });
}
