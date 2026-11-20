import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { FuncionesIaStore } from '../../../core/services/funciones-ia.store';
import { ManualStore } from '../../../core/services/manual.store';
import { PermissionsStore } from '../../../core/services/permissions.store';
import { SessionService } from '../../../core/services/session.service';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { ManualApi } from '../services/manual-api';
import { PanelDeAyuda } from './panel-de-ayuda';

describe('PanelDeAyuda', () => {
  const contexto = signal<object | null>({ organizationId: 1, consultorioId: 1 });
  const estado = signal<'activa' | 'anonimo'>('activa');
  const api = {
    indice: vi.fn(() => of({ grupos: [{ nombre: 'Economía', fichas: [] }] })),
    deLaRuta: vi.fn(() => of(null)),
    ficha: vi.fn(() => of(null)),
    buscar: vi.fn(() => of([])),
  };

  function crear() {
    TestBed.configureTestingModule({
      imports: [PanelDeAyuda],
      providers: [
        provideRouter([]),
        { provide: ManualApi, useValue: api },
        { provide: TenantContextStore, useValue: { context: contexto } },
        { provide: SessionService, useValue: { estado } },
        { provide: PermissionsStore, useValue: { tiene: () => false } },
        { provide: FuncionesIaStore, useValue: { activa: () => false } },
      ],
    });
    const fixture = TestBed.createComponent(PanelDeAyuda);
    const manual = TestBed.inject(ManualStore);
    manual.abrir();
    fixture.detectChanges();
    // Acceso a lo protegido: es el estado que tiene que olvidarse.
    const panel = fixture.componentInstance as unknown as {
      indice: () => unknown;
      verIndice: () => void;
    };
    return { fixture, manual, panel };
  }

  beforeEach(() => {
    contexto.set({ organizationId: 1, consultorioId: 1 });
    estado.set('activa');
    api.indice.mockClear();
  });

  it('olvida el índice al cambiar de sede y lo vuelve a pedir', () => {
    const { fixture, panel } = crear();
    panel.verIndice();
    expect(panel.indice()).not.toBeNull();

    contexto.set({ organizationId: 1, consultorioId: 2 });
    fixture.detectChanges();

    expect(panel.indice()).toBeNull();
    panel.verIndice();
    expect(api.indice).toHaveBeenCalledTimes(2);
  });

  it('se cierra al cerrar la sesión', () => {
    const { fixture, manual } = crear();

    estado.set('anonimo');
    fixture.detectChanges();

    expect(manual.abierto()).toBe(false);
  });
});
