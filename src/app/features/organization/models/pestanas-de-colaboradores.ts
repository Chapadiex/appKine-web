import { Pestana } from '../../../shared/components/pestanas/pestanas';

/** `aria-label` de las pestañas de la sección de colaboradores. */
export const ETIQUETA_PESTANAS_DE_COLABORADORES = 'Pantallas de colaboradores';

/**
 * Las tres pantallas hermanas de la gestión del equipo, una al lado de la otra (canvas de
 * Organización). Invitaciones y Notificaciones exigen `colaborador:manage`: quien solo puede leer
 * el listado no ve las pestañas (la pantalla las envuelve en `*akinePermiso`).
 */
export const PESTANAS_DE_COLABORADORES: readonly Pestana[] = [
  { etiqueta: 'Colaboradores', ruta: '/organizacion/colaboradores', exacta: true },
  { etiqueta: 'Invitaciones', ruta: '/organizacion/colaboradores/invitaciones' },
  { etiqueta: 'Notificaciones', ruta: '/organizacion/colaboradores/notificaciones' },
];
