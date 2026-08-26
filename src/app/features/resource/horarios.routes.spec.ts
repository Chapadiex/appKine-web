import { ActivatedRouteSnapshot, Router, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { Type } from '@angular/core';

import { CalendarioSedePage } from './pages/calendario/calendario-sede-page';
import { ExcepcionesPage } from './pages/excepciones/excepciones-page';
import { HorarioEfectivoPage } from './pages/efectivo/horario-efectivo-page';
import { HorarioSemanalPage } from './pages/horarios/horario-semanal-page';
import { NotFound } from '../../shared/pages/not-found/not-found';
import { PermissionsStore } from '../../core/services/permissions.store';
import { SessionService } from '../../core/services/session.service';
import {
  RUTAS_HORARIOS,
  RUTA_HORARIOS,
  RUTA_HORARIOS_CALENDARIO,
  RUTA_HORARIOS_EFECTIVO,
  RUTA_HORARIOS_EXCEPCIONES,
} from './models/rutas-de-horarios';
import { routes as rutasDeLaApp } from '../../app.routes';

/**
 * Pineo de los prefijos de ruta de `/horarios` (M05, AKINE-02.04).
 *
 * <h2>Por que existe este spec</h2>
 *
 * <p>Entre AKINE-01.02 y AKINE-02.03 el backend emitia enlaces de correo a `/activar` y
 * `/restablecer` mientras el frontend montaba esas pantallas bajo `/auth`. El usuario abria el
 * correo, hacia clic y caia en el <b>404 del comodin `**` con un token perfectamente valido en
 * la URL</b>. Nadie se entero por meses: no habia error, no habia excepcion, no habia test.
 *
 * <p>La causa fue una forma exacta, y `/horarios` la tenia repetida: rutas escritas a mano en
 * dos lugares —el archivo de rutas y las plantillas— sin nada que las atara. `/horarios/efectivo`
 * llego a estar escrito literal en <b>cinco plantillas</b> mas el archivo de rutas.
 *
 * <h2>Que verifica, y que NO verifica una constante</h2>
 *
 * <p>Las constantes de `models/rutas-de-horarios.ts` garantizan que los dos lados digan lo
 * mismo, y que un renombre rompa la compilacion. Lo que <b>no</b> pueden garantizar es que la
 * ruta este montada: renombrar la constante y el `path` a la vez compila perfecto y deja las
 * cuatro pantallas en el 404. Por eso este spec navega de verdad, contra la configuracion real
 * de `app.routes.ts`, y comprueba a que componente llega cada URL.
 *
 * <p>Ademas fija los <b>strings literales</b>. Son parte del contrato con el usuario —un enlace
 * guardado en favoritos, una URL pegada en un chat— y cambiarlos es una decision, no un
 * refactor: si alguien los cambia, este test se lo dice.
 *
 * <h2>Los guards, doblados</h2>
 *
 * <p>`SessionService` y `PermissionsStore` se reemplazan por dobles que dicen que si. No es una
 * concesion: lo que se prueba aca es el <b>mapeo URL → componente</b>. Que los guards funcionen
 * ya lo prueban `auth.guard.spec.ts` y `permission.guard.spec.ts`, y dejarlos vivos convertiria
 * a este spec en uno que falla por sesion y no por ruta.
 */
describe('Rutas de /horarios', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(rutasDeLaApp),
        { provide: SessionService, useValue: { estado: () => 'activa' } },
        {
          provide: PermissionsStore,
          useValue: { cargados: () => true, tieneAlguno: () => true, tiene: () => true },
        },
      ],
    });

    router = TestBed.inject(Router);
  });

  it('las cuatro URLs son las que estan escritas, y salen de la misma raiz', () => {
    expect(RUTA_HORARIOS).toBe('/horarios');
    expect(RUTA_HORARIOS_EXCEPCIONES).toBe('/horarios/excepciones');
    expect(RUTA_HORARIOS_CALENDARIO).toBe('/horarios/calendario');
    expect(RUTA_HORARIOS_EFECTIVO).toBe('/horarios/efectivo');

    // El objeto que consumen las plantillas es el mismo juego de strings: si divergiera, los
    // enlaces cruzados apuntarian a un lado y las rutas montarian otro.
    expect(RUTAS_HORARIOS).toEqual({
      semanal: RUTA_HORARIOS,
      excepciones: RUTA_HORARIOS_EXCEPCIONES,
      calendario: RUTA_HORARIOS_CALENDARIO,
      efectivo: RUTA_HORARIOS_EFECTIVO,
    });
  });

  it('cada una de las cuatro resuelve a su pantalla', async () => {
    expect(await componenteDe(RUTA_HORARIOS)).toBe(HorarioSemanalPage);
    expect(await componenteDe(RUTA_HORARIOS_EXCEPCIONES)).toBe(ExcepcionesPage);
    expect(await componenteDe(RUTA_HORARIOS_CALENDARIO)).toBe(CalendarioSedePage);
    expect(await componenteDe(RUTA_HORARIOS_EFECTIVO)).toBe(HorarioEfectivoPage);
  });

  it('ninguna de las cuatro cae en el comodin', async () => {
    for (const url of Object.values(RUTAS_HORARIOS)) {
      expect(await componenteDe(url)).not.toBe(NotFound);
    }
  });

  it('un segmento inventado bajo /horarios si cae en el comodin', async () => {
    // La contracara del test anterior: sin esto, un `componenteDe` roto que devolviera siempre
    // algo distinto de NotFound haria pasar la afirmacion de arriba sin probar nada.
    expect(await componenteDe('/horarios/inventado')).toBe(NotFound);
  });

  /** Navega de verdad y devuelve el componente de la hoja activada. */
  async function componenteDe(url: string): Promise<Type<unknown> | null> {
    const navego = await router.navigateByUrl(url);
    expect(navego).toBe(true);

    let nodo: ActivatedRouteSnapshot = router.routerState.snapshot.root;
    while (nodo.firstChild !== null) {
      nodo = nodo.firstChild;
    }
    return nodo.component as Type<unknown> | null;
  }
});
