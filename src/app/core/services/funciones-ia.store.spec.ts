import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { provideApi } from '../../api/generated/provide-api';
import {
  FuncionIaResponse,
  FuncionIaResponseFuncionEnum,
} from '../../api/generated/model/funcion-ia-response';
import { FuncionesIaResponse } from '../../api/generated/model/funciones-ia-response';
import { FuncionesIaStore } from './funciones-ia.store';
import { SessionService } from './session.service';
import { TenantContextStore } from './tenant-context.store';

const funcion = (codigo: FuncionIaResponseFuncionEnum, activa: boolean): FuncionIaResponse => ({
  funcion: codigo,
  activa,
  centro: activa,
  despliegue: true,
});

const respuesta = (activas: readonly FuncionIaResponseFuncionEnum[]): FuncionesIaResponse => ({
  organizationId: 1,
  version: 0,
  consentimiento: { exigido: false, aceptado: false },
  funciones: Object.values(FuncionIaResponseFuncionEnum).map((f) =>
    funcion(f, activas.includes(f)),
  ),
});

/**
 * Que funciones de IA ve el centro. Las reglas: mientras no se sabe, nada; si la lectura falla,
 * todo (la autoridad es el backend); y un cambio de contexto descarta lo leido para el anterior.
 */
describe('FuncionesIaStore', () => {
  let store: FuncionesIaStore;
  let tenant: TenantContextStore;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi(''),
        { provide: SessionService, useValue: { estado: signal('activa') } },
      ],
    });
    tenant = TestBed.inject(TenantContextStore);
    store = TestBed.inject(FuncionesIaStore);
    httpMock = TestBed.inject(HttpTestingController);
    tenant.select({ organizationId: 1, organizationName: 'Centro A' });
    TestBed.tick();
  });

  afterEach(() => httpMock.verify());

  it('mientras no carga no hay nada activo, y con la respuesta refleja `activa` de cada una', () => {
    const pedido = httpMock.expectOne('/api/v1/organizations/1/ia');
    expect(store.sabe()).toBe(false);
    expect(store.activa('ASISTENTE')).toBe(false);

    pedido.flush(respuesta([FuncionIaResponseFuncionEnum.ASISTENTE]));

    expect(store.sabe()).toBe(true);
    expect(store.activa('ASISTENTE')).toBe(true);
    expect(store.activa('BIBLIOTECA')).toBe(false);
  });

  it('si la lectura falla deja todo activo', () => {
    httpMock
      .expectOne('/api/v1/organizations/1/ia')
      .flush(null, { status: 500, statusText: 'Error' });

    expect(store.sabe()).toBe(true);
    expect(store.activa('SUGERENCIAS')).toBe(true);
    expect(store.activa('EVOLUCION')).toBe(true);
  });

  it('al cambiar de contexto descarta lo anterior y la respuesta tardia del otro centro', () => {
    const deA = httpMock.expectOne('/api/v1/organizations/1/ia');

    tenant.select({ organizationId: 2, organizationName: 'Centro B' });
    TestBed.tick();
    const deB = httpMock.expectOne('/api/v1/organizations/2/ia');
    deA.flush(respuesta([FuncionIaResponseFuncionEnum.ASISTENTE]));
    expect(store.sabe()).toBe(false);

    deB.flush(respuesta([FuncionIaResponseFuncionEnum.BIBLIOTECA]));
    expect(store.activa('ASISTENTE')).toBe(false);
    expect(store.activa('BIBLIOTECA')).toBe(true);

    // Un nuevo cambio vuelve a "no se sabe" aunque el centro anterior ya estaba leido.
    tenant.select({ organizationId: 1, organizationName: 'Centro A' });
    TestBed.tick();
    expect(store.sabe()).toBe(false);
    expect(store.activa('BIBLIOTECA')).toBe(false);
    httpMock.expectOne('/api/v1/organizations/1/ia').flush(respuesta([]));
  });

  it('adoptar reemplaza lo leido, aunque antes hubiera fallado', () => {
    httpMock
      .expectOne('/api/v1/organizations/1/ia')
      .flush(null, { status: 500, statusText: 'Error' });

    store.adoptar(respuesta([FuncionIaResponseFuncionEnum.EVOLUCION]));

    expect(store.activa('EVOLUCION')).toBe(true);
    expect(store.activa('ASISTENTE')).toBe(false);
    expect(store.funciones()?.funciones).toHaveLength(4);
  });
});
