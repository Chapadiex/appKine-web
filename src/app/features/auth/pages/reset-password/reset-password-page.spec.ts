import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { ResetPasswordPage } from './reset-password-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const URL_CONFIRMAR = '/api/v1/auth/password-reset/confirm';

async function preparar(parametros: Record<string, string>): Promise<HttpTestingController> {
  await TestBed.configureTestingModule({
    imports: [ResetPasswordPage],
    providers: [
      provideHttpClient(withInterceptors([errorInterceptor])),
      provideHttpClientTesting(),
      provideRouter([]),
      provideApi(''),
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(parametros) } },
      },
    ],
  }).compileComponents();

  return TestBed.inject(HttpTestingController);
}

describe('ResetPasswordPage', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('manda el token de la query con la contrasena nueva y confirma el cierre de sesiones', async () => {
    const httpMock = await preparar({ token: 'token-sintetico-1' });
    const fixture = crear();

    escribir(fixture, '#reset-password', 'contrasena-nueva-de-prueba');
    escribir(fixture, '#reset-repeticion', 'contrasena-nueva-de-prueba');
    enviar(fixture);

    const pedido = httpMock.expectOne(URL_CONFIRMAR);
    expect(pedido.request.body).toEqual({
      token: 'token-sintetico-1',
      password: 'contrasena-nueva-de-prueba',
    });

    pedido.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('se cerraron todas tus sesiones abiertas');
    httpMock.verify();
  });

  it('ante un 400 invalid-token ofrece pedir otro enlace', async () => {
    const httpMock = await preparar({ token: 'token-vencido' });
    const fixture = crear();

    escribir(fixture, '#reset-password', 'contrasena-nueva-de-prueba');
    escribir(fixture, '#reset-repeticion', 'contrasena-nueva-de-prueba');
    enviar(fixture);

    httpMock
      .expectOne(URL_CONFIRMAR)
      .flush(
        { type: 'https://akine.app/problems/invalid-token', detail: 'Token invalido' },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('El enlace vencio o ya se uso');
    expect(enlaces(fixture)).toContain('/auth/olvide-mi-contrasena');
    httpMock.verify();
  });

  it('muestra el detail literal cuando la contrasena no cumple la politica', async () => {
    const httpMock = await preparar({ token: 'token-sintetico-2' });
    const fixture = crear();

    escribir(fixture, '#reset-password', 'corta');
    escribir(fixture, '#reset-repeticion', 'corta');
    enviar(fixture);

    httpMock.expectOne(URL_CONFIRMAR).flush(
      {
        type: 'https://akine.app/problems/validation-error',
        detail: 'La contrasena debe tener al menos 12 caracteres.',
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('La contrasena debe tener al menos 12 caracteres.');
    // Es un error de politica, no de enlace: no se ofrece pedir otro.
    expect(enlaces(fixture)).not.toContain('/auth/olvide-mi-contrasena');
    httpMock.verify();
  });

  it('no sale a la red si las dos contrasenas no coinciden', async () => {
    const httpMock = await preparar({ token: 'token-sintetico-3' });
    const fixture = crear();

    escribir(fixture, '#reset-password', 'contrasena-uno');
    escribir(fixture, '#reset-repeticion', 'contrasena-dos');
    enviar(fixture);
    fixture.detectChanges();

    httpMock.expectNone(URL_CONFIRMAR);
    expect(texto(fixture)).toContain('Las dos contrasenas no coinciden');

    const repeticion = fixture.nativeElement.querySelector('#reset-repeticion') as HTMLInputElement;
    expect(repeticion.getAttribute('aria-invalid')).toBe('true');
    expect(repeticion.getAttribute('aria-describedby')).toBe('reset-repeticion-error');
    httpMock.verify();
  });

  it('sin token en la query no muestra el formulario y manda a pedir otro enlace', async () => {
    const httpMock = await preparar({});
    const fixture = crear();

    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(texto(fixture)).toContain('El enlace vino incompleto');
    expect(enlaces(fixture)).toContain('/auth/olvide-mi-contrasena');
    httpMock.verify();
  });

  it('ante un 429 deshabilita el boton y muestra la espera', async () => {
    const httpMock = await preparar({ token: 'token-sintetico-4' });
    const fixture = crear();

    escribir(fixture, '#reset-password', 'contrasena-nueva-de-prueba');
    escribir(fixture, '#reset-repeticion', 'contrasena-nueva-de-prueba');
    enviar(fixture);

    httpMock
      .expectOne(URL_CONFIRMAR)
      .flush(
        { type: 'https://akine.app/problems/rate-limited', detail: 'Demasiados intentos' },
        { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '60' } },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    const boton = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    expect(texto(fixture)).toContain('Volve a intentar en 60 segundos');
    httpMock.verify();
  });

  // --- Accesibilidad ---------------------------------------------------------------

  it(
    'no tiene violaciones de axe con el formulario en pantalla',
    async () => {
      await preparar({ token: 'token-sintetico-5' });
      await esperarSinViolaciones(crear().nativeElement);
    },
    TIMEOUT_AXE,
  );

  it(
    'no tiene violaciones de axe con el error de contrasenas que no coinciden',
    async () => {
      await preparar({ token: 'token-sintetico-6' });
      const fixture = crear();

      escribir(fixture, '#reset-password', 'contrasena-nueva-de-prueba');
      escribir(fixture, '#reset-repeticion', 'otra-cosa');
      enviar(fixture);
      fixture.detectChanges();

      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  it(
    'no tiene violaciones de axe cuando el enlace vino sin token',
    async () => {
      await preparar({});
      await esperarSinViolaciones(crear().nativeElement);
    },
    TIMEOUT_AXE,
  );

  function crear() {
    const fixture = TestBed.createComponent(ResetPasswordPage);
    fixture.detectChanges();
    return fixture;
  }
});

function escribir(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: string,
): void {
  const campo = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function enviar(fixture: { nativeElement: HTMLElement }): void {
  (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
    new Event('submit'),
  );
}

function enlaces(fixture: { nativeElement: HTMLElement }): (string | null)[] {
  return [...fixture.nativeElement.querySelectorAll('a')].map((a: HTMLAnchorElement) =>
    a.getAttribute('href'),
  );
}

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
}
