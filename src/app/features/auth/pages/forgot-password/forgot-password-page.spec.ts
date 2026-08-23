import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ForgotPasswordPage } from './forgot-password-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const URL_RESET = '/api/v1/auth/password-reset';

describe('ForgotPasswordPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ForgotPasswordPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('pide el enlace y confirma con el mensaje uniforme', async () => {
    const fixture = crear();
    escribir(fixture, 'kine@ejemplo.test');
    enviar(fixture);

    const pedido = httpMock.expectOne(URL_RESET);
    expect(pedido.request.body).toEqual({ email: 'kine@ejemplo.test' });

    pedido.flush({ message: 'ok' }, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Si el email esta registrado');
  });

  it('muestra EXACTAMENTE el mismo texto para un email registrado y uno que no lo esta', async () => {
    const registrado = await mensaje('existente@ejemplo.test');
    const inexistente = await mensaje('no-existe@ejemplo.test');

    expect(registrado).toBe(inexistente);
    expect(registrado).not.toContain('no esta registrado');
    expect(registrado).not.toContain('no existe');
  });

  it('ante un 429 deshabilita el boton y muestra la espera declarada por el backend', async () => {
    const fixture = crear();
    escribir(fixture, 'kine@ejemplo.test');
    enviar(fixture);

    // El plazo viaja en el header `Retry-After`, no en el cuerpo: el contrato nunca declaro
    // un `retryAfterSeconds` y el backend expone el header por CORS para que se pueda leer.
    httpMock
      .expectOne(URL_RESET)
      .flush(
        { type: 'https://akine.app/problems/rate-limited', detail: 'Demasiados intentos' },
        { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '30' } },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(boton(fixture).disabled).toBe(true);
    expect(texto(fixture)).toContain('Volve a intentar en 30 segundos');
  });

  it('no sale a la red sin email y enfoca el campo vacio', () => {
    const fixture = crear();
    enviar(fixture);
    fixture.detectChanges();

    httpMock.expectNone(URL_RESET);
    expect(document.activeElement?.id).toBe('olvido-email');
  });

  // --- Accesibilidad ---------------------------------------------------------------

  it(
    'no tiene violaciones de axe en reposo',
    async () => {
      await esperarSinViolaciones(crear().nativeElement);
    },
    TIMEOUT_AXE,
  );

  it(
    'no tiene violaciones de axe con el aviso de exito ya visible',
    async () => {
      const fixture = crear();
      escribir(fixture, 'kine@ejemplo.test');
      enviar(fixture);
      httpMock
        .expectOne(URL_RESET)
        .flush({ message: 'ok' }, { status: 202, statusText: 'Accepted' });
      await fixture.whenStable();
      fixture.detectChanges();

      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  async function mensaje(email: string): Promise<string> {
    const fixture = crear();
    escribir(fixture, email);
    enviar(fixture);
    httpMock.expectOne(URL_RESET).flush({ message: 'ok' }, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();
    fixture.detectChanges();
    return texto(fixture);
  }

  function crear() {
    const fixture = TestBed.createComponent(ForgotPasswordPage);
    fixture.detectChanges();
    return fixture;
  }
});

function escribir(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  valor: string,
): void {
  const campo = fixture.nativeElement.querySelector('#olvido-email') as HTMLInputElement;
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function enviar(fixture: { nativeElement: HTMLElement }): void {
  (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
    new Event('submit'),
  );
}

function boton(fixture: { nativeElement: HTMLElement }): HTMLButtonElement {
  return fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
}

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
}
