import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { NotificacionesPage } from './notificaciones-page';
import { NotificationPageResponse } from '../../../../api/generated/model/notification-page-response';
import { EstadoNotificacion, TipoNotificacion } from '../../models/notificaciones';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const LISTADO = '/api/v1/organizations/1/notifications';
const RETRY = '/api/v1/organizations/1/notifications/42/retry';

const PAGINA: NotificationPageResponse = {
  content: [
    {
      id: 42,
      tipo: TipoNotificacion.INVITACION_COLABORADOR,
      destinatario: 'j***@centro.test',
      estado: EstadoNotificacion.AGOTADA,
      reintentable: true,
      intentos: 5,
      maxIntentos: 5,
      ultimoError: 'Conexion rechazada por el servidor de correo',
      creadaEn: '2026-10-01T12:00:00Z',
      actualizadaEn: '2026-10-01T13:00:00Z',
    },
    {
      id: 41,
      tipo: TipoNotificacion.TURNO_RESERVADO,
      destinatario: 'm***@centro.test',
      estado: EstadoNotificacion.ENVIADA,
      reintentable: false,
      intentos: 1,
      maxIntentos: 5,
    },
  ],
  page: 0,
  size: 20,
  totalElements: 2,
  totalPages: 1,
};

/** Listado de notificaciones con reintento por fila (RF-M26-005). */
describe('NotificacionesPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NotificacionesPage],
      providers: [
        provideRouter([]),
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

  it('al entrar pide FALLIDA y AGOTADA y muestra los textos en español', async () => {
    const fixture = montar();
    const pedido = esperarListado();
    expect(pedido.request.params.getAll('estado')).toEqual(['FALLIDA', 'AGOTADA']);
    expect(pedido.request.params.get('page')).toBe('0');
    pedido.flush(PAGINA);
    await estabilizar(fixture);

    const contenido = texto(fixture);
    expect(contenido).toContain('Invitación a colaborar');
    expect(contenido).toContain('Agotada (sin mas intentos)');
    expect(contenido).toContain('j***@centro.test');
    expect(contenido).toContain('Conexion rechazada');
    // Solo la fila reintentable ofrece el boton.
    expect(botones(fixture)).toHaveLength(1);
  });

  it('cambiar el filtro relee con los estados elegidos y sin estados no consulta', async () => {
    const fixture = montar();
    esperarListado().flush(PAGINA);
    await estabilizar(fixture);

    alternar(fixture, 'ENVIADA');
    expect(esperarListado().request.params.getAll('estado')).toEqual([
      'FALLIDA',
      'AGOTADA',
      'ENVIADA',
    ]);

    alternar(fixture, 'FALLIDA');
    esperarListado().flush(PAGINA);
    alternar(fixture, 'AGOTADA');
    esperarListado().flush(PAGINA);
    alternar(fixture, 'ENVIADA');
    httpMock.expectNone(() => true);
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Elegí al menos un estado');
  });

  it('reintentar confirma y relee el listado', async () => {
    const fixture = montar();
    esperarListado().flush(PAGINA);
    await estabilizar(fixture);

    botones(fixture)[0].click();
    httpMock
      .expectOne((peticion) => peticion.method === 'POST' && peticion.url === RETRY)
      .flush(null, { status: 204, statusText: 'No Content' });
    esperarListado().flush({ ...PAGINA, content: [], totalElements: 0 });
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('La notificación 42');
    expect(texto(fixture)).toContain('volvio a la cola de envio');
  });

  it('el 409 nombra el estado actual en español y relee', async () => {
    const fixture = montar();
    esperarListado().flush(PAGINA);
    await estabilizar(fixture);

    botones(fixture)[0].click();
    httpMock
      .expectOne(RETRY)
      .flush(
        { type: 'https://akine.app/problems/conflict', status: 409, estado: 'ENVIADA' },
        { status: 409, statusText: 'Conflict' },
      );
    esperarListado().flush(PAGINA);
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('ya no admite reintento: ahora esta Enviada');
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = montar();
      esperarListado().flush(PAGINA);
      await estabilizar(fixture);
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  function montar(): ComponentFixture<NotificacionesPage> {
    const fixture = TestBed.createComponent(NotificacionesPage);
    fixture.detectChanges();
    return fixture;
  }

  function esperarListado() {
    return httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'GET' && peticion.url === LISTADO,
    );
  }
});

function alternar(fixture: ComponentFixture<unknown>, estado: string): void {
  const raiz = fixture.nativeElement as HTMLElement;
  const casilla = raiz.querySelector(`#notificaciones-estado-${estado}`) as HTMLInputElement;
  casilla.click();
  fixture.detectChanges();
}

function botones(fixture: ComponentFixture<unknown>): HTMLButtonElement[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('tbody button'),
  );
}

async function estabilizar(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

function texto(fixture: ComponentFixture<unknown>): string {
  return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
}
