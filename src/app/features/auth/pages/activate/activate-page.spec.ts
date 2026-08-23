import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { ActivatePage } from './activate-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const URL_ACTIVAR = '/api/v1/auth/activate';

function rutaCon(parametros: Record<string, string>) {
  return { snapshot: { queryParamMap: convertToParamMap(parametros) } };
}

async function preparar(parametros: Record<string, string>): Promise<HttpTestingController> {
  await TestBed.configureTestingModule({
    imports: [ActivatePage],
    providers: [
      provideHttpClient(withInterceptors([errorInterceptor])),
      provideHttpClientTesting(),
      provideRouter([]),
      provideApi(''),
      { provide: ActivatedRoute, useValue: rutaCon(parametros) },
    ],
  }).compileComponents();

  return TestBed.inject(HttpTestingController);
}

describe('ActivatePage', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('activa con el token de la query y avisa que hay que iniciar sesion', async () => {
    const httpMock = await preparar({ token: 'token-sintetico-1' });
    const fixture = TestBed.createComponent(ActivatePage);
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Activando tu cuenta');

    const pedido = httpMock.expectOne(URL_ACTIVAR);
    expect(pedido.request.body).toEqual({ token: 'token-sintetico-1' });
    pedido.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Tu cuenta quedo activa');
    // Activar NO abre sesion: la salida es el login.
    expect(enlaces(fixture)).toContain('/auth/ingresar');
    httpMock.verify();
  });

  it('ante un 400 invalid-token ofrece pedir un enlace nuevo, no reintentar', async () => {
    const httpMock = await preparar({ token: 'token-vencido' });
    const fixture = TestBed.createComponent(ActivatePage);
    fixture.detectChanges();

    httpMock
      .expectOne(URL_ACTIVAR)
      .flush(
        { type: 'https://akine.app/problems/invalid-token', detail: 'Token invalido' },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('El enlace vencio o ya se uso');
    expect(enlaces(fixture)).toContain('/auth/reenviar-activacion');
    // Reintentar el mismo token no puede funcionar nunca: el boton no existe.
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
    httpMock.verify();
  });

  it('sin token en la query no llama al backend y manda a pedir otro enlace', async () => {
    const httpMock = await preparar({});
    const fixture = TestBed.createComponent(ActivatePage);
    fixture.detectChanges();

    httpMock.expectNone(URL_ACTIVAR);
    expect(texto(fixture)).toContain('El enlace vino incompleto');
    expect(enlaces(fixture)).toContain('/auth/reenviar-activacion');
    httpMock.verify();
  });

  it('ante un fallo de red deja reintentar el mismo token', async () => {
    const httpMock = await preparar({ token: 'token-sintetico-2' });
    const fixture = TestBed.createComponent(ActivatePage);
    fixture.detectChanges();

    httpMock
      .expectOne(URL_ACTIVAR)
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('No se pudo contactar al servidor');

    const reintentar = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(reintentar.disabled).toBe(false);
    reintentar.click();
    fixture.detectChanges();

    httpMock.expectOne(URL_ACTIVAR).flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Tu cuenta quedo activa');
    httpMock.verify();
  });

  it('ante un 429 bloquea el reintento mientras corre la espera', async () => {
    const httpMock = await preparar({ token: 'token-sintetico-3' });
    const fixture = TestBed.createComponent(ActivatePage);
    fixture.detectChanges();

    // El plazo sale del header `Retry-After`, que es lo unico que declara el backend; el
    // cuerpo nunca lo trajo.
    httpMock
      .expectOne(URL_ACTIVAR)
      .flush(
        { type: 'https://akine.app/problems/rate-limited', detail: 'Demasiados intentos' },
        { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '60' } },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    const reintentar = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(reintentar.disabled).toBe(true);
    expect(texto(fixture)).toContain('Volve a intentar en 60 segundos');
    httpMock.verify();
  });

  // --- Accesibilidad ---------------------------------------------------------------

  it(
    'no tiene violaciones de axe con el enlace ya consumido',
    async () => {
      const httpMock = await preparar({ token: 'token-sintetico-5' });
      const fixture = TestBed.createComponent(ActivatePage);
      fixture.detectChanges();

      httpMock.expectOne(URL_ACTIVAR).flush(null, { status: 204, statusText: 'No Content' });
      await fixture.whenStable();
      fixture.detectChanges();

      await esperarSinViolaciones(fixture.nativeElement);
      httpMock.verify();
    },
    TIMEOUT_AXE,
  );

  it(
    'no tiene violaciones de axe cuando el enlace vino sin token',
    async () => {
      await preparar({});
      const fixture = TestBed.createComponent(ActivatePage);
      fixture.detectChanges();

      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );
});

function enlaces(fixture: { nativeElement: HTMLElement }): (string | null)[] {
  return [...fixture.nativeElement.querySelectorAll('a')].map((a: HTMLAnchorElement) =>
    a.getAttribute('href'),
  );
}

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
}
