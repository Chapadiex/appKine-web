import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TelegramDelCentro } from './telegram-del-centro';

const URL = '/api/v1/organizations/1/telegram';
const TOKEN = '1234567890:AAHtokenSinteticoSoloParaTests_0123456';

describe('TelegramDelCentro', () => {
  let fixture: ComponentFixture<TelegramDelCentro>;
  let httpMock: HttpTestingController;

  const html = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const estado = (status: number) => ({ status, statusText: 'x' });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TelegramDelCentro],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(TenantContextStore).select({ organizationId: 1, organizationName: 'Centro A' });
    fixture = TestBed.createComponent(TelegramDelCentro);
    await fixture.whenStable();
  });

  afterEach(() => httpMock.verify());

  it(
    'sin bot muestra la guia de @BotFather y conecta con el token pegado',
    async () => {
      httpMock.expectOne(URL).flush({ conectado: false });
      await fixture.whenStable();
      expect(html().textContent).toContain('/newbot');
      expect(html().textContent).toContain('Sin bot');

      const input = html().querySelector<HTMLInputElement>('#telegram-token')!;
      input.value = ` ${TOKEN} `;
      input.dispatchEvent(new Event('input'));
      html().querySelector<HTMLButtonElement>('button[type="submit"]')!.click();

      const put = httpMock.expectOne({ method: 'PUT', url: URL });
      expect(put.request.body).toEqual({ token: TOKEN });
      put.flush({ conectado: true, usuario: 'kine_bot' });
      await fixture.whenStable();

      expect(html().textContent).toContain('@kine_bot');
      expect(html().textContent).toContain('Conectado');
      await esperarSinViolaciones(html());
    },
    TIMEOUT_AXE,
  );

  it('el token vacio no sale a la red', async () => {
    httpMock.expectOne(URL).flush({ conectado: false });
    await fixture.whenStable();
    html().querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();
    httpMock.expectNone({ method: 'PUT', url: URL });
    expect(html().textContent).toContain('Pegá el token');
  });

  it('un token que Telegram rechaza muestra el motivo del servidor', async () => {
    httpMock.expectOne(URL).flush({ conectado: false });
    await fixture.whenStable();
    const input = html().querySelector<HTMLInputElement>('#telegram-token')!;
    input.value = TOKEN;
    input.dispatchEvent(new Event('input'));
    html().querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    httpMock.expectOne({ method: 'PUT', url: URL }).flush(
      {
        type: 'https://akine.app/problems/validation-error',
        title: 'Token de Telegram invalido',
        status: 400,
        detail: 'Telegram no reconoce ese token.',
      },
      estado(400),
    );
    await fixture.whenStable();
    expect(html().textContent).toContain('Telegram no reconoce ese token.');
  });

  it('con bot conectado ofrece desconectar', async () => {
    httpMock
      .expectOne(URL)
      .flush({ conectado: true, usuario: 'kine_bot', ultimoError: 'getUpdates: 409 Conflict' });
    await fixture.whenStable();
    expect(html().textContent).toContain('getUpdates: 409 Conflict');

    const botones = Array.from(html().querySelectorAll<HTMLButtonElement>('button'));
    botones.find((b) => b.textContent?.includes('Desconectar'))!.click();
    httpMock.expectOne({ method: 'DELETE', url: URL }).flush(null);
    await fixture.whenStable();
    expect(html().textContent).toContain('Sin bot');
  });

  it('con el servidor sin Telegram lo dice y no ofrece el formulario', async () => {
    httpMock.expectOne(URL).flush(
      {
        type: 'https://akine.app/problems/telegram-deshabilitado',
        title: 'Telegram deshabilitado',
        status: 409,
      },
      estado(409),
    );
    await fixture.whenStable();
    expect(html().textContent).toContain('No disponible en el servidor');
    expect(html().querySelector('#telegram-token')).toBeNull();
  });

  it('sin permiso no se muestra', async () => {
    httpMock
      .expectOne(URL)
      .flush({ type: 'https://akine.app/problems/forbidden', status: 403 }, estado(403));
    await fixture.whenStable();
    expect(html().querySelector('section')).toBeNull();
  });
});
