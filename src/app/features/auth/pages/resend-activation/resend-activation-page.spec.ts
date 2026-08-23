import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ResendActivationPage } from './resend-activation-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const URL_REENVIO = '/api/v1/auth/activation/resend';

describe('ResendActivationPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResendActivationPage],
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

  it('envia el email y confirma con el mensaje uniforme', async () => {
    const fixture = crear();
    escribir(fixture, 'pendiente@ejemplo.test');
    enviar(fixture);

    const pedido = httpMock.expectOne(URL_REENVIO);
    expect(pedido.request.body).toEqual({ email: 'pendiente@ejemplo.test' });

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
  });

  it('ante un 429 deshabilita el boton y muestra la espera', async () => {
    const fixture = crear();
    escribir(fixture, 'pendiente@ejemplo.test');
    enviar(fixture);

    httpMock
      .expectOne(URL_REENVIO)
      .flush(
        { type: 'https://akine.app/problems/rate-limited', detail: 'Demasiados intentos' },
        { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '60' } },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(boton(fixture).disabled).toBe(true);
    expect(texto(fixture)).toContain('Volve a intentar en 60 segundos');
  });

  it('no sale a la red con un email invalido y enfoca el campo', () => {
    const fixture = crear();
    escribir(fixture, 'no-es-un-email');
    enviar(fixture);
    fixture.detectChanges();

    httpMock.expectNone(URL_REENVIO);
    expect(document.activeElement?.id).toBe('reenvio-email');
    expect(texto(fixture)).toContain('Escribi un email valido');
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
    'no tiene violaciones de axe con el campo en error',
    async () => {
      const fixture = crear();
      escribir(fixture, 'no-es-un-email');
      enviar(fixture);
      fixture.detectChanges();

      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  async function mensaje(email: string): Promise<string> {
    const fixture = crear();
    escribir(fixture, email);
    enviar(fixture);
    httpMock
      .expectOne(URL_REENVIO)
      .flush({ message: 'ok' }, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();
    fixture.detectChanges();
    return texto(fixture);
  }

  function crear() {
    const fixture = TestBed.createComponent(ResendActivationPage);
    fixture.detectChanges();
    return fixture;
  }
});

function escribir(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  valor: string,
): void {
  const campo = fixture.nativeElement.querySelector('#reenvio-email') as HTMLInputElement;
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
