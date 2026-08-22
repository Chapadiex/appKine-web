import { TestBed } from '@angular/core/testing';

import { TenantContextStore } from './tenant-context.store';

const ORG_A = {
  organizationId: 1,
  organizationName: 'Centro Kine A',
  consultorioId: 10,
  consultorioName: 'Sede Centro',
};

const ORG_B = {
  organizationId: 2,
  organizationName: 'Centro Kine B',
};

/**
 * Verifica el contexto multi-tenant (ADR-0004).
 *
 * <p>Lo critico aca es `contextEpoch`: es la senal que usan las features para descartar su
 * estado al cambiar de organizacion. Si no se incrementa, los datos de la Organizacion A
 * quedan visibles bajo la B, que es el bug de aislamiento mas grave del frontend.
 */
describe('TenantContextStore', () => {
  let store: TenantContextStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(TenantContextStore);
  });

  it('arranca sin contexto', () => {
    expect(store.context()).toBeNull();
    expect(store.hasContext()).toBe(false);
    expect(store.organizationId()).toBeNull();
    expect(store.consultorioId()).toBeNull();
  });

  it('expone la organizacion y el consultorio seleccionados', () => {
    store.select(ORG_A);

    expect(store.hasContext()).toBe(true);
    expect(store.organizationId()).toBe(1);
    expect(store.consultorioId()).toBe(10);
    expect(store.context()?.organizationName).toBe('Centro Kine A');
  });

  it('un contexto sin consultorio deja consultorioId en null', () => {
    store.select(ORG_B);

    expect(store.organizationId()).toBe(2);
    expect(store.consultorioId()).toBeNull();
  });

  it('cambiar de organizacion incrementa contextEpoch', () => {
    const inicial = store.contextEpoch();

    store.select(ORG_A);
    const trasPrimera = store.contextEpoch();
    expect(trasPrimera).toBeGreaterThan(inicial);

    store.select(ORG_B);
    // Sin este incremento, una feature que cachea datos de la Org A no sabria que
    // debe descartarlos, y los mostraria bajo la Org B.
    expect(store.contextEpoch()).toBeGreaterThan(trasPrimera);
  });

  it('limpiar tambien incrementa contextEpoch', () => {
    store.select(ORG_A);
    const antes = store.contextEpoch();

    store.clear();

    // El logout debe invalidar cachés igual que un cambio de contexto: por eso la senal
    // es un contador y no el propio contexto.
    expect(store.contextEpoch()).toBeGreaterThan(antes);
    expect(store.hasContext()).toBe(false);
  });

  it('reseleccionar el mismo contexto igual incrementa la epoca', () => {
    store.select(ORG_A);
    const antes = store.contextEpoch();

    store.select(ORG_A);

    // Reseleccionar ocurre tras renovar el token acotado al contexto: invalidar de mas es
    // barato, quedarse con datos viejos no.
    expect(store.contextEpoch()).toBeGreaterThan(antes);
  });
});
