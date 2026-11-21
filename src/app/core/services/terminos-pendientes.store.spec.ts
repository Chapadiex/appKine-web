import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { provideApi } from '../../api/generated/provide-api';
import { TerminosPendientesStore } from './terminos-pendientes.store';

describe('TerminosPendientesStore', () => {
  let store: TerminosPendientesStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideApi('')],
    });
    store = TestBed.inject(TerminosPendientesStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lee una vez y después responde con lo leído', async () => {
    const primera = firstValueFrom(store.pendiente());
    http.expectOne('/api/v1/me/terminos').flush({ versionVigente: '2026-11-20', pendiente: true });

    expect(await primera).toBe(true);
    expect(await firstValueFrom(store.pendiente())).toBe(true);
  });

  it('si no puede leer, no bloquea: el backend sigue mandando', async () => {
    const respuesta = firstValueFrom(store.pendiente());
    http.expectOne('/api/v1/me/terminos').flush(null, { status: 500, statusText: 'Error' });

    expect(await respuesta).toBe(false);
  });

  it('aceptar deja de marcarlos pendientes; un 403 posterior los vuelve a marcar', async () => {
    const leida = firstValueFrom(store.pendiente());
    http.expectOne('/api/v1/me/terminos').flush({ versionVigente: '2026-11-20', pendiente: true });
    await leida;

    const aceptada = firstValueFrom(store.aceptar('2026-11-20'));
    const pedido = http.expectOne('/api/v1/me/terminos');
    expect(pedido.request.method).toBe('POST');
    expect(pedido.request.body).toEqual({ versionTerminos: '2026-11-20' });
    pedido.flush(null, { status: 204, statusText: 'No Content' });
    await aceptada;

    expect(store.terminos()?.pendiente).toBe(false);
    store.marcarPendiente();
    expect(store.terminos()?.pendiente).toBe(true);
  });
});
