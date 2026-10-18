import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Route,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';

import { contextGuard } from './core/guards/context.guard';
import { RUTA_SIN_PERMISO } from './core/models/rutas';
import { PermissionsStore } from './core/services/permissions.store';
import { SessionService } from './core/services/session.service';
import { routes as rutasDeClases } from './features/activity/activity.routes';
import { routes as rutasDeAsistencia } from './features/activity/asistencia.routes';
import { rutasPasesDePersona, rutasProductos } from './features/activity/pases.routes';
import { routes as rutasClinicas } from './features/clinical/clinical.routes';

/**
 * Guards de las pantallas de F9 por ROL (AKINE-09.02).
 *
 * <p>Los permisos de cada rol son los que el backend asigna por base
 * (`appKine-api` `RolePermissions`), restringidos a los que alguna ruta de F9 pide. Se corre la
 * cadena de guards real de cada ruta —salvo `contextGuard`, que no depende del rol— y se mira a
 * donde empuja: los guards son UX, el backend rechaza igual (y eso lo prueba
 * `e2e/riesgo-permisos-de-f9.spec.ts` contra el servidor).
 *
 * <p>Lo que importa de la tabla son los dos "no": el PROFESIONAL no tiene `producto:read` ni
 * `pase:read` (dato economico, "No por defecto" en la matriz §2), y el ADMINISTRATIVO no tiene
 * `sesion:register`, que es lo unico para lo que sirve el panel de atencion clinica de la clase.
 */
const PERMISOS_POR_ROL = {
  PROFESIONAL: [
    'clase:read',
    'clase:manage',
    'inscripcion:read',
    'inscripcion:manage',
    'asistencia:manage',
    'sesion:register',
  ],
  ADMINISTRATIVO: [
    'clase:read',
    'clase:manage',
    'inscripcion:read',
    'inscripcion:manage',
    'asistencia:manage',
    'producto:read',
    'pase:read',
    'pase:manage',
  ],
} as const;

type Rol = keyof typeof PERMISOS_POR_ROL;

interface RutaDeF9 {
  readonly url: string;
  readonly ruta: Route;
  /** Los roles que entran. Los demas terminan en `/sin-permiso`. */
  readonly entran: readonly Rol[];
}

function hija(rutas: readonly Route[], path: string): Route {
  const ruta = rutas.find((r) => r.path === path);
  if (ruta === undefined) throw new Error(`No existe la ruta '${path}'`);
  return ruta;
}

const AMBOS: readonly Rol[] = ['PROFESIONAL', 'ADMINISTRATIVO'];

const RUTAS: readonly RutaDeF9[] = [
  { url: '/clases', ruta: hija(rutasDeClases, ''), entran: AMBOS },
  { url: '/clases/nueva', ruta: hija(rutasDeClases, 'nueva'), entran: AMBOS },
  { url: '/clases/70', ruta: hija(rutasDeClases, ':claseId'), entran: AMBOS },
  { url: '/asistencia', ruta: hija(rutasDeAsistencia, ''), entran: AMBOS },
  { url: '/asistencia/70', ruta: hija(rutasDeAsistencia, ':claseId'), entran: AMBOS },
  { url: '/productos', ruta: hija(rutasProductos, ''), entran: ['ADMINISTRATIVO'] },
  {
    url: '/pacientes/41/pases',
    ruta: hija(rutasPasesDePersona, ''),
    entran: ['ADMINISTRATIVO'],
  },
  {
    url: '/atencion/clases/70',
    ruta: hija(rutasClinicas, 'clases/:claseId'),
    entran: ['PROFESIONAL'],
  },
];

describe('Guards de las pantallas de F9 por rol', () => {
  let permisos: ReadonlySet<string>;

  beforeEach(() => {
    permisos = new Set();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: SessionService, useValue: { estado: () => 'activa', restaurando: () => false } },
        {
          provide: PermissionsStore,
          useValue: {
            cargados: () => true,
            tieneAlguno: (...pedidos: string[]) => pedidos.some((p) => permisos.has(p)),
          },
        },
      ],
    });
  });

  it('toda ruta de F9 exige sede y al menos un permiso', () => {
    for (const { url, ruta } of RUTAS) {
      const guards = ruta.canActivate ?? [];
      expect(guards[0], `${url}: contextGuard primero`).toBe(contextGuard);
      expect(guards.length, `${url}: sin permissionGuard`).toBeGreaterThan(1);
    }
  });

  for (const rol of Object.keys(PERMISOS_POR_ROL) as Rol[]) {
    it(`${rol}: entra a lo que su rol tiene y lo demas termina en /sin-permiso`, () => {
      permisos = new Set(PERMISOS_POR_ROL[rol]);

      for (const { url, ruta, entran } of RUTAS) {
        const resultado = decidir(ruta, url);
        if (entran.includes(rol)) {
          expect(resultado, `${rol} entra a ${url}`).toBe(true);
        } else {
          expect(resultado, `${rol} no entra a ${url}`).toBeInstanceOf(UrlTree);
          expect((resultado as UrlTree).toString()).toBe(RUTA_SIN_PERMISO);
        }
      }
    });
  }

  /** Corre los guards de permiso de la ruta en orden y devuelve el primero que no deja pasar. */
  function decidir(ruta: Route, url: string): boolean | UrlTree {
    for (const guard of (ruta.canActivate ?? []).slice(1) as CanActivateFn[]) {
      const resultado = TestBed.runInInjectionContext(() =>
        guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
      );
      if (resultado !== true) return resultado as boolean | UrlTree;
    }
    return true;
  }
});
