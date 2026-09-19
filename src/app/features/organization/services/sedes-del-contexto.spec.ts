import { provideHttpClient, HttpRequest } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ConsultorioResponse } from '../../../api/generated/model/consultorio-response';
import { SedesDelContexto } from './sedes-del-contexto';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { provideApi } from '../../../api/generated/provide-api';

const ORG_A = { organizationId: 1, organizationName: 'Centro Kine A', consultorioId: 10 };
const ORG_B = { organizationId: 2, organizationName: 'Centro Kine B', consultorioId: 20 };

const SEDE_10 = { id: 10, nombre: 'Sede Centro' } as ConsultorioResponse;
const SEDE_11 = { id: 11, nombre: 'Sede Norte' } as ConsultorioResponse;

/**
 * Spec de las sedes del contexto activo (M03, AKINE-02.02).
 *
 * <p>El archivo no tenia ninguna, y lo que queda sin probar en un cache indexado por epoca no
 * son detalles: son las dos formas conocidas de <b>filtrar datos de un tenant a otro</b>. La
 * primera es que el cache siga vigente despues de cambiar de organizacion; la segunda es que
 * una respuesta lenta de la organizacion anterior aterrice sobre la nueva. Las dos dibujan
 * sedes ajenas en el selector, y ninguna levanta un error.
 *
 * <p>Lo otro que se cubre es que el error se trague en silencio a proposito: el selector es un
 * accesorio de dos formularios que tienen su propio manejo de errores.
 */
describe('SedesDelContexto', () => {
  let sedes: SedesDelContexto;
  let tenant: TenantContextStore;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideApi('')],
    });

    sedes = TestBed.inject(SedesDelContexto);
    tenant = TestBed.inject(TenantContextStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  /** El pedido pendiente de sedes de `orgId`, que el servicio emite por su cuenta. */
  function pedido(orgId: number) {
    return httpMock.expectOne((peticion: HttpRequest<unknown>) =>
      peticion.url.endsWith(`/organizations/${orgId}/consultorios`),
    );
  }

  // -------------------------------------------------------------------------------------
  // 1. Lo que pasa antes de que haya algo que ofrecer
  // -------------------------------------------------------------------------------------

  it('arranca vacio y sin haber cargado', () => {
    expect(sedes.cargadas()).toBe(false);
    expect(sedes.sedes()).toEqual([]);
  });

  it('sin organizacion activa no sale ninguna peticion', () => {
    sedes.asegurarCargadas();

    // Sin `orgId` la URL no se puede ni construir: pedirla igual daria un 404 que el usuario
    // no puede diagnosticar.
    httpMock.expectNone(() => true);
    expect(sedes.cargadas()).toBe(false);
  });

  it('una lista vacia igual cuenta como cargada', () => {
    tenant.select(ORG_A);
    sedes.asegurarCargadas();
    pedido(1).flush({ content: [] });

    // "No tiene sedes" y "todavia no cargaron" son estados distintos: confundirlos hace que el
    // aviso de sede dada de baja aparezca por una peticion en vuelo.
    expect(sedes.cargadas()).toBe(true);
    expect(sedes.sedes()).toEqual([]);
  });

  it('una respuesta sin el campo content no rompe: se trata como lista vacia', () => {
    tenant.select(ORG_A);
    sedes.asegurarCargadas();
    pedido(1).flush({});

    expect(sedes.cargadas()).toBe(true);
    expect(sedes.sedes()).toEqual([]);
  });

  it('pide las sedes ACTIVAS de forma explicita', () => {
    tenant.select(ORG_A);
    sedes.asegurarCargadas();

    // De este filtro depende `sedeDelContextoInactiva`. Si el backend cambiara su default, el
    // signal pasaria a no ser nunca `true` y nadie se enteraria.
    const peticion = pedido(1);
    expect(peticion.request.params.get('estado')).toBe('ACTIVO');
    peticion.flush({ content: [SEDE_10] });
  });

  it('no vuelve a pedir lo que ya esta cargado para este contexto', () => {
    tenant.select(ORG_A);
    sedes.asegurarCargadas();
    pedido(1).flush({ content: [SEDE_10] });

    sedes.asegurarCargadas();
    httpMock.expectNone(() => true);
  });

  // -------------------------------------------------------------------------------------
  // 2. Aislamiento entre tenants: las dos formas de filtrar sedes ajenas
  // -------------------------------------------------------------------------------------

  it('cambiar de organizacion invalida el cache en el mismo tick, no cuando llegue la respuesta', () => {
    tenant.select(ORG_A);
    sedes.asegurarCargadas();
    pedido(1).flush({ content: [SEDE_10, SEDE_11] });
    expect(sedes.sedes()).toHaveLength(2);

    tenant.select(ORG_B);

    // Si el cache siguiera vigente un solo render, el selector ofreceria sedes de la
    // organizacion A estando parado en la B.
    expect(sedes.cargadas()).toBe(false);
    expect(sedes.sedes()).toEqual([]);

    sedes.asegurarCargadas();
    pedido(2).flush({ content: [] });
  });

  it('una respuesta que llega despues del cambio de contexto se descarta', () => {
    tenant.select(ORG_A);
    sedes.asegurarCargadas();
    const lenta = pedido(1);

    // El usuario cambia de organizacion mientras la peticion de la anterior sigue en vuelo.
    tenant.select(ORG_B);
    lenta.flush({ content: [SEDE_10, SEDE_11] });

    // Guardarla dejaria sedes de A cacheadas bajo la epoca de B: exactamente la fuga que el
    // indice por epoca existe para evitar.
    expect(sedes.cargadas()).toBe(false);
    expect(sedes.sedes()).toEqual([]);
  });

  it('el logout deja el cache sin vigencia', () => {
    tenant.select(ORG_A);
    sedes.asegurarCargadas();
    pedido(1).flush({ content: [SEDE_10] });

    tenant.clear();

    expect(sedes.cargadas()).toBe(false);
    expect(sedes.sedes()).toEqual([]);
  });

  it('invalidar obliga a volver a pedirlas dentro del mismo contexto', () => {
    tenant.select(ORG_A);
    sedes.asegurarCargadas();
    pedido(1).flush({ content: [SEDE_10] });

    // Lo usan las pantallas que dan de alta o de baja una sede: sin esto el selector sigue
    // ofreciendo una sede que ya no existe hasta el proximo cambio de contexto.
    sedes.invalidar();
    expect(sedes.cargadas()).toBe(false);

    sedes.asegurarCargadas();
    pedido(1).flush({ content: [SEDE_10, SEDE_11] });
    expect(sedes.sedes()).toHaveLength(2);
  });

  // -------------------------------------------------------------------------------------
  // 3. El error se traga a proposito
  // -------------------------------------------------------------------------------------

  it('un error no propaga ni deja el servicio como cargado', () => {
    tenant.select(ORG_A);
    sedes.asegurarCargadas();

    // Si esto propagara, el formulario entero mostraria un cartel rojo por una peticion
    // secundaria, en vez de seguir usable con la opcion "toda la organizacion".
    expect(() =>
      pedido(1).flush(
        { type: 'https://akine.app/problems/forbidden' },
        { status: 403, statusText: 'F' },
      ),
    ).not.toThrow();

    expect(sedes.cargadas()).toBe(false);
    expect(sedes.sedes()).toEqual([]);
  });

  it('despues de un error, volver a pedirlas sale de nuevo', () => {
    tenant.select(ORG_A);
    sedes.asegurarCargadas();
    pedido(1).flush({}, { status: 500, statusText: 'X' });

    sedes.asegurarCargadas();
    pedido(1).flush({ content: [SEDE_10] });
    expect(sedes.sedes()).toHaveLength(1);
  });

  // -------------------------------------------------------------------------------------
  // 4. La sede del contexto que dejo de estar vigente
  // -------------------------------------------------------------------------------------

  it('no afirma que la sede se dio de baja mientras la lista no cargo', () => {
    tenant.select(ORG_A);

    // Un cartel de "tu sede se dio de baja" disparado por una peticion en vuelo es peor que
    // no mostrar nada.
    expect(sedes.sedeDelContextoInactiva()).toBe(false);
  });

  it('detecta que la sede del contexto ya no esta entre las activas', () => {
    tenant.select(ORG_A);
    sedes.asegurarCargadas();
    pedido(1).flush({ content: [SEDE_11] });

    // La sede 10 es la del contexto y la lista pide solo ACTIVO: si no aparece, se dio de baja
    // o la cuenta perdio el acceso. En los dos casos ese contexto ya no sirve para trabajar.
    expect(sedes.sedeDelContextoInactiva()).toBe(true);
  });

  it('con la sede del contexto presente no hay nada que avisar', () => {
    tenant.select(ORG_A);
    sedes.asegurarCargadas();
    pedido(1).flush({ content: [SEDE_10, SEDE_11] });

    expect(sedes.sedeDelContextoInactiva()).toBe(false);
  });

  it('un contexto de organizacion entera, sin sede, no dispara el aviso', () => {
    tenant.select({ organizationId: 1, organizationName: 'Centro Kine A' });
    sedes.asegurarCargadas();
    pedido(1).flush({ content: [SEDE_11] });

    // Sin `consultorioId` no hay sede que pueda estar dada de baja.
    expect(sedes.sedeDelContextoInactiva()).toBe(false);
  });
});
