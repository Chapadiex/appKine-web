import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ReintentoDeNotificacion } from './reintento-de-notificacion';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const RETRY = '/api/v1/organizations/1/notifications/42/retry';

/** Reintento de notificaciones (RF-M26-005, A-3): sin listado en el contrato, se pide el numero. */
describe('ReintentoDeNotificacion', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReintentoDeNotificacion],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
  });

  afterEach(() => httpMock.verify());

  it('un numero invalido no manda nada', () => {
    const fixture = montar();
    escribirYEnviar(fixture, 'abc');
    httpMock.expectNone(() => true);
    expect(texto(fixture)).toContain('es un entero positivo');
  });

  it('reintenta contra la organizacion del contexto y confirma', async () => {
    const fixture = montar();
    escribirYEnviar(fixture, ' 42 ');
    const pedido = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === RETRY,
    );
    pedido.flush(null, { status: 204, statusText: 'No Content' });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('La notificacion 42 volvio a la cola de envio');
  });

  it('el 409 nombra el estado actual y el 404 explica las de identidad', async () => {
    const fixture = montar();
    escribirYEnviar(fixture, '42');
    httpMock
      .expectOne(RETRY)
      .flush(
        { type: 'https://akine.app/problems/conflict', status: 409, estado: 'ENVIADA' },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('esta ENVIADA');

    escribirYEnviar(fixture, '42');
    httpMock
      .expectOne(RETRY)
      .flush(
        { type: 'https://akine.app/problems/not-found', status: 404 },
        { status: 404, statusText: 'Not Found' },
      );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('recuperacion de contrasena');
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = montar();
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  function montar(): ComponentFixture<ReintentoDeNotificacion> {
    const fixture = TestBed.createComponent(ReintentoDeNotificacion);
    fixture.detectChanges();
    return fixture;
  }
});

function escribirYEnviar(fixture: ComponentFixture<unknown>, valor: string): void {
  const raiz = fixture.nativeElement as HTMLElement;
  const campo = raiz.querySelector('#reintento-notificacion-id') as HTMLInputElement;
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
  raiz.querySelector('form')?.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}

async function estabilizar(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

function texto(fixture: ComponentFixture<unknown>): string {
  return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
}
