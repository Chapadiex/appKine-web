import { Route } from '@angular/router';

import { EgresoDetallePage } from './pages/egreso-detalle/egreso-detalle-page';
import { EgresosPage } from './pages/egresos/egresos-page';
import { routes } from './egresos.routes';
import { routes as rutasDeLaApp } from '../../app.routes';
import { SECCIONES } from '../../layout/navegacion-principal/secciones';

describe('Rutas de /egresos', () => {
  it('estan montadas en la app, con guards, y el menu las pide con caja:operate', async () => {
    const montada = rutasDeLaApp.find((r) => r.path === 'egresos') as Route;
    expect(montada.children).toBe(routes);

    const [listado, detalle] = routes;
    expect(await (listado.loadComponent as () => Promise<unknown>)()).toBe(EgresosPage);
    expect(detalle.path).toBe(':egresoId');
    expect(await (detalle.loadComponent as () => Promise<unknown>)()).toBe(EgresoDetallePage);
    expect(listado.canActivate?.length).toBe(2);
    expect(detalle.canActivate?.length).toBe(2);

    const seccion = SECCIONES.find((s) => s.ruta === '/egresos');
    expect(seccion?.permisos).toEqual(['caja:operate']);
  });
});
