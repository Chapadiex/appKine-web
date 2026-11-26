import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideApi } from '../../api/generated/provide-api';
import { errorInterceptor } from '../../core/interceptors/error.interceptor';
import { TenantContextStore } from '../../core/services/tenant-context.store';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../core/testing/axe';
import { VinculoDeTelegram } from './vinculo-de-telegram';

const URL = '/api/v1/consultorios/7/telegram/vinculo';

describe('VinculoDeTelegram', () => {
  let fixture: ComponentFixture<VinculoDeTelegram>;
  let httpMock: HttpTestingController;

  const html = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const boton = (texto: string): HTMLButtonElement =>
    Array.from(html().querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      b.textContent?.includes(texto),
    )!;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VinculoDeTelegram],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro A',
      consultorioId: 7,
    });
    fixture = TestBed.createComponent(VinculoDeTelegram);
    await fixture.whenStable();
  });

  afterEach(() => httpMock.verify());

  it(
    'pide un codigo, lo muestra listo para mandar y pasa a vinculado sola',
    async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      try {
        httpMock.expectOne(URL).flush({ vinculado: false, botUsuario: 'kine_bot' });
        await fixture.whenStable();
        boton('Vincular mi Telegram').click();

        httpMock.expectOne({ method: 'POST', url: URL }).flush({
          vinculado: false,
          botUsuario: 'kine_bot',
          codigo: '482913',
          codigoVenceEn: '2026-11-26T13:15:00Z',
        });
        await fixture.whenStable();
        expect(html().textContent).toContain('/vincular 482913');
        await esperarSinViolaciones(html());

        vi.advanceTimersByTime(4000);
        httpMock.expectOne({ method: 'GET', url: URL }).flush({
          vinculado: true,
          botUsuario: 'kine_bot',
          telegramNombre: 'Juan',
          consultorioId: 7,
        });
        await fixture.whenStable();
        expect(html().textContent).toContain('Vinculado');
      } finally {
        vi.useRealTimers();
      }
    },
    TIMEOUT_AXE,
  );

  it('vinculado ofrece desvincular', async () => {
    httpMock.expectOne(URL).flush({ vinculado: true, botUsuario: 'kine_bot', consultorioId: 7 });
    await fixture.whenStable();
    boton('Desvincular').click();
    httpMock.expectOne({ method: 'DELETE', url: URL }).flush(null);
    await fixture.whenStable();
    expect(boton('Vincular mi Telegram')).toBeTruthy();
  });

  it('sin bot del centro no aparece', async () => {
    httpMock.expectOne(URL).flush({ vinculado: false });
    await fixture.whenStable();
    expect(html().querySelector('section')).toBeNull();
  });

  it('con Telegram apagado no aparece', async () => {
    httpMock
      .expectOne(URL)
      .flush(
        { type: 'https://akine.app/problems/telegram-deshabilitado', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    expect(html().querySelector('section')).toBeNull();
  });

  it('un error al pedir el codigo se muestra', async () => {
    httpMock.expectOne(URL).flush({ vinculado: false, botUsuario: 'kine_bot' });
    await fixture.whenStable();
    boton('Vincular mi Telegram').click();
    httpMock.expectOne({ method: 'POST', url: URL }).flush(
      {
        type: 'https://akine.app/problems/telegram-sin-bot',
        status: 409,
        detail: 'El centro no tiene un bot de Telegram conectado.',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    expect(html().textContent).toContain('No pudimos completar la operación');
  });
});
