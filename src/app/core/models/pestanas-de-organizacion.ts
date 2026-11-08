import { Signal, computed } from '@angular/core';

import { Pestana } from '../../shared/components/pestanas/pestanas';
import { PermissionsStore } from '../services/permissions.store';
import { PERMISO_AUDITORIA_READ, PERMISO_CONSULTORIO_MANAGE } from './permisos';

/** `aria-label` de las pestanas de la organizacion. */
export const ETIQUETA_PESTANAS_DE_ORGANIZACION = 'Secciones de la organización';

const DATOS: Pestana = { etiqueta: 'Datos del centro', ruta: '/organizacion', exacta: true };
const SUSCRIPCION: Pestana = { etiqueta: 'Suscripción', ruta: '/organizacion/suscripcion' };
const AUDITORIA: Pestana = { etiqueta: 'Auditoría', ruta: '/organizacion/auditoria' };
const ENMIENDA: Pestana = {
  etiqueta: 'Política de enmienda',
  ruta: '/atencion/politica-de-enmienda',
};

/**
 * Las pantallas de la organizacion como pestañas hermanas (08/11/2026): los datos del centro, la
 * suscripcion, la auditoria y la politica de enmienda dejan de ser entradas sueltas de la barra
 * lateral. Vive en `core/` porque la politica de enmienda es de `clinical` y las otras tres de
 * `organization`, y ADR-0004 no deja que una feature importe de otra.
 *
 * <p>Cada pestaña lleva el permiso que pedia su entrada en la barra. Ocultarla es UX: el backend
 * rechaza igual.
 */
export function pestanasDeOrganizacion(permisos: PermissionsStore): Signal<readonly Pestana[]> {
  return computed(() => [
    DATOS,
    SUSCRIPCION,
    ...(permisos.tiene(PERMISO_AUDITORIA_READ) ? [AUDITORIA] : []),
    ...(permisos.tiene(PERMISO_CONSULTORIO_MANAGE) ? [ENMIENDA] : []),
  ]);
}
