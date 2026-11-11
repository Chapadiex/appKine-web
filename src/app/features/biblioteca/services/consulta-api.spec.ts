import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { AuthTokenStore } from '../../../core/services/auth-token.store';
import { SessionService } from '../../../core/services/session.service';
import { ConsultaApi, EventoConsulta } from './consulta-api';

function respuestaStream(texto: string): Response {
  const cuerpo = new ReadableStream<Uint8Array>({
    start(controlador) {
      controlador.enqueue(new TextEncoder().encode(texto));
      controlador.close();
    },
  });
  return new Response(cuerpo, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('ConsultaApi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reintentaUnaVezCon401', async () => {
    const refrescar = vi.fn(() => of(undefined));
    TestBed.configureTestingModule({
      providers: [{ provide: SessionService, useValue: { refrescar } }],
    });
    TestBed.inject(AuthTokenStore).set('token-viejo');
    const fetchSimulado = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(
        respuestaStream('event:fin\ndata:{"sinMaterial":true,"camino":"PALABRAS"}\n\n'),
      );
    vi.stubGlobal('fetch', fetchSimulado);

    const eventos: EventoConsulta[] = [];
    await new Promise<void>((resolver, rechazar) =>
      TestBed.inject(ConsultaApi)
        .consultar(1, { pregunta: 'hola' })
        .subscribe({ next: (e) => eventos.push(e), error: rechazar, complete: resolver }),
    );

    expect(refrescar).toHaveBeenCalledTimes(1);
    expect(fetchSimulado).toHaveBeenCalledTimes(2);
    expect(eventos).toEqual([{ tipo: 'fin', sinMaterial: true, camino: 'PALABRAS' }]);
  });
});
