import { WritableSignal, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ContadoresDePlataformaStore } from './contadores-de-plataforma.store';
import { EstadoSesion, SessionService } from './session.service';
import { provideApi } from '../../api/generated/provide-api';

const PANEL = '/api/v1/platform/resumen';
const SOLICITUDES = '/api/v1/catalogo-solicitudes?estado=PENDIENTE';

/**
 * Contadores de las insignias de la consola: una consulta por pedido, nada sin sesion, y un fallo
 * que deja el contador en `null` sin romper el otro.
 */
describe('ContadoresDePlataformaStore', () => {
  let estado: WritableSignal<EstadoSesion>;
  let epoca: WritableSignal<number>;
  let store: ContadoresDePlataformaStore;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    estado = signal<EstadoSesion>('sin-contexto');
    epoca = signal(1);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi(''),
        { provide: SessionService, useValue: { estado, epocaDeIdentidad: epoca } },
      ],
    });
    store = TestBed.inject(ContadoresDePlataformaStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('pide una vez y expone los tres contadores', () => {
    store.asegurarCargados();
    store.asegurarCargados();
    responder({ centros: { activos: 12 }, pedidosPendientes: 3 }, [{}, {}]);

    expect(store.valor('centros-activos')).toBe(12);
    expect(store.valor('pedidos-pendientes')).toBe(3);
    expect(store.valor('solicitudes-pendientes')).toBe(2);

    store.asegurarCargados();
    httpMock.expectNone(PANEL);
  });

  it('refrescar vuelve a pedir', () => {
    store.asegurarCargados();
    responder({ centros: { activos: 1 }, pedidosPendientes: 0 }, []);

    store.refrescar();
    responder({ centros: { activos: 2 }, pedidosPendientes: 5 }, []);

    expect(store.centrosActivos()).toBe(2);
    expect(store.pedidosPendientes()).toBe(5);
  });

  it('sin sesion no sale a la red', () => {
    estado.set('anonimo');
    store.asegurarCargados();
    httpMock.expectNone(PANEL);
    expect(store.cargados()).toBe(false);
  });

  it('un fallo deja ese contador sin dato y no toca el otro', () => {
    store.asegurarCargados();
    httpMock.expectOne(PANEL).flush(null, { status: 500, statusText: 'Error' });
    httpMock.expectOne(SOLICITUDES).flush([{}]);

    expect(store.centrosActivos()).toBeNull();
    expect(store.pedidosPendientes()).toBeNull();
    expect(store.solicitudesPendientes()).toBe(1);
  });

  it('un cambio de identidad invalida los numeros', () => {
    store.asegurarCargados();
    responder({ centros: { activos: 4 }, pedidosPendientes: 1 }, []);

    epoca.set(2);
    expect(store.centrosActivos()).toBeNull();
    expect(store.cargados()).toBe(false);
  });

  function responder(panel: object, solicitudes: object[]): void {
    httpMock.expectOne(PANEL).flush(panel);
    httpMock.expectOne(SOLICITUDES).flush(solicitudes);
  }
});
