import { Route } from '@angular/router';

import { EgresoDetallePage } from './pages/egreso-detalle/egreso-detalle-page';
import { EgresosPage } from './pages/egresos/egresos-page';
import { LiquidacionDeHonorariosPage } from './pages/liquidacion-de-honorarios/liquidacion-de-honorarios-page';
import { LiquidacionDetallePage } from './pages/liquidacion-detalle/liquidacion-detalle-page';
import { routes } from './egresos.routes';
import { routes as rutasDeLaApp } from '../../app.routes';
import { SECCIONES } from '../../layout/navegacion-principal/secciones';

describe('Rutas de /egresos', () => {
  it('estan montadas en la app, con guards, y el menu las pide con caja:operate', async () => {
    const montada = rutasDeLaApp.find((r) => r.path === 'egresos') as Route;
    expect(montada.children).toBe(routes);

    const [listado, honorarios, liquidacion, detalle] = routes;
    expect(await (listado.loadComponent as () => Promise<unknown>)()).toBe(EgresosPage);
    // Las de honorarios van antes de `:egresoId`, que si no las tomaria por un id.
    expect(honorarios.path).toBe('honorarios');
    expect(await (honorarios.loadComponent as () => Promise<unknown>)()).toBe(
      LiquidacionDeHonorariosPage,
    );
    expect(liquidacion.path).toBe('honorarios/liquidaciones/:liquidacionId');
    expect(await (liquidacion.loadComponent as () => Promise<unknown>)()).toBe(
      LiquidacionDetallePage,
    );
    expect(detalle.path).toBe(':egresoId');
    expect(await (detalle.loadComponent as () => Promise<unknown>)()).toBe(EgresoDetallePage);
    for (const ruta of routes) {
      expect(ruta.canActivate?.length).toBe(2);
    }

    const seccion = SECCIONES.find((s) => s.ruta === '/egresos');
    expect(seccion?.permisos).toEqual(['caja:operate']);
  });
});
