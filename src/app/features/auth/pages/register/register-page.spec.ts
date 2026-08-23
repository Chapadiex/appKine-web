import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { RegisterPage } from './register-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const URL_REGISTRO = '/api/v1/auth/register';

describe('RegisterPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RegisterPage],
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

  it('manda solo los campos obligatorios cuando los opcionales quedan vacios', async () => {
    const fixture = crear();
    completarMinimo(fixture);
    enviar(fixture);

    const pedido = httpMock.expectOne(URL_REGISTRO);
    expect(pedido.request.body).toEqual({
      email: 'fundador@ejemplo.test',
      password: 'contrasena-de-prueba',
      firstName: 'Ana',
      lastName: 'Diaz',
      organizationName: 'Centro Kinesico Ejemplo',
    });

    pedido.flush({ message: 'Solicitud aceptada' }, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('te llega un correo');
  });

  it('incluye los opcionales cuando se completan', () => {
    const fixture = crear();
    completarMinimo(fixture);
    escribir(fixture, '#registro-organizationSlug', 'centro-ejemplo');
    escribir(fixture, '#registro-consultorioName', 'Sede Central');
    escribir(fixture, '#registro-planCode', 'BASICO');
    enviar(fixture);

    const pedido = httpMock.expectOne(URL_REGISTRO);
    expect(pedido.request.body.organizationSlug).toBe('centro-ejemplo');
    expect(pedido.request.body.consultorioName).toBe('Sede Central');
    expect(pedido.request.body.planCode).toBe('BASICO');

    pedido.flush({ message: 'ok' }, { status: 202, statusText: 'Accepted' });
  });

  it('manda el header Idempotency-Key obligatorio', () => {
    const fixture = crear();
    completarMinimo(fixture);
    enviar(fixture);

    const pedido = httpMock.expectOne(URL_REGISTRO);
    expect(pedido.request.headers.get('Idempotency-Key')).toBeTruthy();

    pedido.flush({ message: 'ok' }, { status: 202, statusText: 'Accepted' });
  });

  it('REUSA la misma Idempotency-Key al reintentar tras un error de red', async () => {
    const fixture = crear();
    completarMinimo(fixture);

    enviar(fixture);
    const primero = httpMock.expectOne(URL_REGISTRO);
    const clave = primero.request.headers.get('Idempotency-Key');
    primero.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    enviar(fixture);
    const segundo = httpMock.expectOne(URL_REGISTRO);

    // Sin esto, un corte de red termina en dos cuentas y dos correos de activacion.
    expect(segundo.request.headers.get('Idempotency-Key')).toBe(clave);

    segundo.flush({ message: 'ok' }, { status: 202, statusText: 'Accepted' });
  });

  it('genera una clave nueva si el usuario corrige un campo antes de reintentar', async () => {
    const fixture = crear();
    completarMinimo(fixture);

    enviar(fixture);
    const primero = httpMock.expectOne(URL_REGISTRO);
    const clave = primero.request.headers.get('Idempotency-Key');
    primero.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    escribir(fixture, '#registro-email', 'otro@ejemplo.test');
    enviar(fixture);
    const segundo = httpMock.expectOne(URL_REGISTRO);

    // La misma clave con otro payload devolveria 409 idempotency-key-conflict.
    expect(segundo.request.headers.get('Idempotency-Key')).not.toBe(clave);

    segundo.flush({ message: 'ok' }, { status: 202, statusText: 'Accepted' });
  });

  it('muestra EXACTAMENTE el mismo texto exista o no la cuenta', async () => {
    // El backend responde 202 con el mismo cuerpo en los dos casos (ADR-0018). Si la
    // pantalla los distinguiera, el atacante enumeraria clientes igual.
    const conCuentaNueva = await mensajeDeExito({ message: 'Solicitud aceptada' });
    const conCuentaExistente = await mensajeDeExito({ message: 'Solicitud aceptada' });

    expect(conCuentaNueva).toBe(conCuentaExistente);
    expect(conCuentaNueva).not.toContain('ya existe');
    expect(conCuentaNueva).not.toContain('disponible.');
  });

  it('muestra el detail literal del backend cuando la contrasena no cumple la politica', async () => {
    const fixture = crear();
    completarMinimo(fixture);
    enviar(fixture);

    httpMock.expectOne(URL_REGISTRO).flush(
      {
        type: 'https://akine.app/problems/validation-error',
        detail: 'La contrasena debe tener al menos 12 caracteres y un numero.',
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain(
      'La contrasena debe tener al menos 12 caracteres y un numero.',
    );
  });

  it('ante un 429 deshabilita el boton y muestra la cuenta regresiva', async () => {
    const fixture = crear();
    completarMinimo(fixture);
    enviar(fixture);

    httpMock
      .expectOne(URL_REGISTRO)
      .flush(
        { type: 'https://akine.app/problems/rate-limited', detail: 'Demasiados intentos' },
        { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '60' } },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(boton(fixture).disabled).toBe(true);
    expect(texto(fixture)).toContain('Volve a intentar en 60 segundos');
  });

  it('ante un 429 sin Retry-After avisa del limite pero no inventa una cuenta regresiva', async () => {
    const fixture = crear();
    completarMinimo(fixture);
    enviar(fixture);

    httpMock
      .expectOne(URL_REGISTRO)
      .flush(
        { type: 'https://akine.app/problems/rate-limited', detail: 'Demasiados intentos' },
        { status: 429, statusText: 'Too Many Requests' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Demasiados intentos');
    expect(texto(fixture)).not.toContain('Volve a intentar en');
  });

  it('no llama al backend con el formulario incompleto y enfoca el primer campo con error', () => {
    const fixture = crear();
    enviar(fixture);
    fixture.detectChanges();

    httpMock.expectNone(URL_REGISTRO);
    expect(document.activeElement?.id).toBe('registro-firstName');
  });

  it('rechaza un email mal escrito antes de salir a la red', () => {
    const fixture = crear();
    completarMinimo(fixture);
    escribir(fixture, '#registro-email', 'no-es-un-email');
    enviar(fixture);
    fixture.detectChanges();

    httpMock.expectNone(URL_REGISTRO);
    expect(texto(fixture)).toContain('Escribi un email valido');
  });

  async function mensajeDeExito(cuerpo: { message: string }): Promise<string> {
    const fixture = crear();
    completarMinimo(fixture);
    enviar(fixture);
    httpMock.expectOne(URL_REGISTRO).flush(cuerpo, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();
    fixture.detectChanges();
    return texto(fixture);
  }

  // --- Accesibilidad ---------------------------------------------------------------

  it(
    'no tiene violaciones de axe en reposo',
    async () => {
      await esperarSinViolaciones(crear().nativeElement);
    },
    TIMEOUT_AXE,
  );

  it(
    'no tiene violaciones de axe con los ocho campos en error',
    async () => {
      // El formulario mas largo de identidad, con `fieldset`/`legend` y campos opcionales
      // marcados dentro del propio `label`: es donde una etiqueta mal asociada pasa inadvertida.
      const fixture = crear();
      enviar(fixture);
      fixture.detectChanges();

      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  function crear() {
    const fixture = TestBed.createComponent(RegisterPage);
    fixture.detectChanges();
    return fixture;
  }
});

function completarMinimo(fixture: { nativeElement: HTMLElement; detectChanges(): void }): void {
  escribir(fixture, '#registro-firstName', 'Ana');
  escribir(fixture, '#registro-lastName', 'Diaz');
  escribir(fixture, '#registro-email', 'fundador@ejemplo.test');
  escribir(fixture, '#registro-password', 'contrasena-de-prueba');
  escribir(fixture, '#registro-organizationName', 'Centro Kinesico Ejemplo');
}

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

function boton(fixture: { nativeElement: HTMLElement }): HTMLButtonElement {
  return fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
}

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
}
