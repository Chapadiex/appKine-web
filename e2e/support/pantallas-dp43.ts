import { Page, Route } from '@playwright/test';

import { CONSULTORIO_ID } from './agenda-simulada';

/**
 * API simulada de las pantallas de DP-43 para las auditorias de contraste y de telefono: el
 * catalogo global de financiadores (plataforma y centro), la atencion sin turno y la ventana de
 * enmienda. Se instala DESPUES de la API de contraste o de la de telefono, asi que gana sobre ella
 * en estas rutas y deja pasar todo lo demas (`fallback`).
 *
 * <p>Datos largos a proposito —nombres de obra social y de planes de varias palabras, CUIT, motivo
 * de baja—: lo que desborda un telefono y lo que tensa el contraste son las filas reales.
 */

const PERMISOS_DP43 = [
  'tenant:read',
  'tenant:manage',
  'turno:read',
  'turno:manage',
  'paciente:read',
  'paciente:manage',
  'convenio:read',
  'convenio:manage',
  'consultorio:manage',
  'sesion:register',
  'sesion:amend',
  'colaborador:read',
];

const PLANES = [
  {
    id: 51,
    financiadorCatalogoId: 11,
    codigo: '210',
    nombre: 'Plan 210 Integral Familiar con Odontologia',
    estado: 'ACTIVO',
    vigenciaDesde: '2026-01-01',
    version: 0,
  },
  {
    id: 52,
    financiadorCatalogoId: 11,
    codigo: '110',
    nombre: 'Plan 110 Joven',
    estado: 'INACTIVO',
    vigenciaDesde: '2025-01-01',
    vigenciaHasta: '2025-12-31',
    deactivationReason: 'Discontinuado por el financiador',
    version: 2,
  },
];

const ENTRADAS = [
  {
    id: 11,
    codigo: 'OSDE',
    nombre: 'OSDE Organizacion de Servicios Directos Empresarios',
    tipo: 'PREPAGA',
    cuit: '30546741253',
    estado: 'ACTIVO',
    version: 3,
    planes: PLANES,
  },
  {
    id: 12,
    codigo: 'IOSFA',
    nombre: 'Instituto de Obra Social de las Fuerzas Armadas y de Seguridad',
    tipo: 'OBRA_SOCIAL',
    cuit: '30714345678',
    estado: 'ACTIVO',
    version: 1,
    financiadorAdoptadoId: 77,
    actualizacionDisponible: true,
    planes: [],
  },
];

const OFERTAS = [
  { id: 4, nombreComercial: 'Kinesiologia deportiva con evaluacion funcional', estado: 'ACTIVO' },
  {
    id: 5,
    nombreComercial: 'Rehabilitacion neurologica',
    estado: 'ACTIVO',
    requiereCasoClinico: true,
  },
];

export async function instalarApiDp43(
  page: Page,
  opciones: { readonly plataforma?: boolean } = {},
): Promise<void> {
  await page.route('**/api/v1/**', async (ruta: Route) => {
    const peticion = ruta.request();
    const camino = new URL(peticion.url()).pathname;
    const json = (cuerpo: unknown): Promise<void> =>
      ruta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cuerpo) });

    if (peticion.method() !== 'GET') return ruta.fallback();
    if (camino === '/api/v1/me/platform-role') {
      return json({ platformAdmin: opciones.plataforma === true });
    }
    if (camino === '/api/v1/me/permissions') return json({ permissions: PERMISOS_DP43 });
    if (camino === '/api/v1/platform/catalogo-financiadores') {
      return json(ENTRADAS.map((e) => ({ ...e, financiadorAdoptadoId: undefined })));
    }
    if (camino === '/api/v1/catalogo-financiadores') {
      return json(
        ENTRADAS.map((e) => ({ ...e, planes: e.planes.filter((p) => p.estado === 'ACTIVO') })),
      );
    }
    if (camino === `/api/v1/consultorios/${CONSULTORIO_ID}/ofertas`) return json(OFERTAS);
    if (camino === '/api/v1/politica-de-enmienda') {
      return json({
        ventanaDias: 45,
        porDefecto: false,
        version: 2,
        actualizadaEn: '2026-10-01T13:00:00Z',
      });
    }
    return ruta.fallback();
  });
}
