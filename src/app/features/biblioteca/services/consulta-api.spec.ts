import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { AuthTokenStore } from '../../../core/services/auth-token.store';
import { SessionService } from '../../../core/services/session.service';
import { traducirErrorBiblioteca } from '../models/biblioteca-errors';
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

  it('streamSinFinEsError', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: SessionService, useValue: { refrescar: vi.fn() } }],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respuestaStream('event:texto\ndata:{"texto":"Ho"}\n\n')),
    );

    const error = await new Promise<unknown>((resolver) =>
      TestBed.inject(ConsultaApi)
        .consultar(1, { pregunta: 'hola' })
        .subscribe({ error: resolver, complete: () => resolver(null) }),
    );

    expect(error).toBeInstanceOf(AkineHttpError);
    expect((error as AkineHttpError).esDeRed).toBe(true);
    expect(traducirErrorBiblioteca(error).causa).toBe('red');
  });

  it('abortarNoEmiteError', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: SessionService, useValue: { refrescar: vi.fn() } }],
    });
    const rechazos: unknown[] = [];
    const alRechazar = (e: PromiseRejectionEvent) => rechazos.push(e.reason);
    globalThis.addEventListener('unhandledrejection', alRechazar);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolver, rechazar) =>
            init.signal?.addEventListener('abort', () =>
              rechazar(new DOMException('abortado', 'AbortError')),
            ),
          ),
      ),
    );
    const errores: unknown[] = [];
    const suscripcion = TestBed.inject(ConsultaApi)
      .consultar(1, { pregunta: 'hola' })
      .subscribe({ error: (e) => errores.push(e) });

    suscripcion.unsubscribe();
    await new Promise((resolver) => setTimeout(resolver, 20));

    globalThis.removeEventListener('unhandledrejection', alRechazar);
    expect(errores).toEqual([]);
    expect(rechazos).toEqual([]);
  });

  it('un fallo de refrescar se propaga tal cual', async () => {
    const falla = new Error('sesion perdida');
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionService, useValue: { refrescar: () => throwError(() => falla) } },
      ],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));

    const error = await new Promise<unknown>((resolver) =>
      TestBed.inject(ConsultaApi).consultar(1, { pregunta: 'hola' }).subscribe({ error: resolver }),
    );

    expect(error).toBe(falla);
  });
});
