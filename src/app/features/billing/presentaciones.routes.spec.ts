import { Route } from '@angular/router';

import { PresentacionDetallePage } from './pages/presentacion-detalle/presentacion-detalle-page';
import { PresentacionesPage } from './pages/presentaciones/presentaciones-page';
import { routes } from './presentaciones.routes';
import { routes as rutasDeLaApp } from '../../app.routes';

describe('Rutas de /presentaciones', () => {
  it('estan montadas en la app y cada una resuelve a su pantalla con guards', async () => {
    const montada = rutasDeLaApp.find((r) => r.path === 'presentaciones') as Route;
    expect(await (montada.loadChildren as () => Promise<unknown>)()).toBe(routes);

    const [listado, detalle] = routes;
    expect(await (listado.loadComponent as () => Promise<unknown>)()).toBe(PresentacionesPage);
    expect(detalle.path).toBe(':presentacionId');
    expect(await (detalle.loadComponent as () => Promise<unknown>)()).toBe(PresentacionDetallePage);
    expect(listado.canActivate?.length).toBe(2);
    expect(detalle.canActivate?.length).toBe(2);
  });
});
