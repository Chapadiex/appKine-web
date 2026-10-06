import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';

@Component({ template: '', standalone: true })
class RutaVacia {}

import { CasosListadoPage } from './casos-listado-page';
import { CasosApi } from '../../casos-api';
import {
  CasoClinico,
  CasoClinicoEstadoEnum,
} from '../../../../../api/generated/model/caso-clinico';

const HC = 42;

const CASOS: CasoClinico[] = [
  {
    id: 1,
    version: 1,
    estado: CasoClinicoEstadoEnum.ACTIVO,
    numeroCaso: 1,
    diagnosticoPresuntivo: 'Lumbalgia',
  },
  {
    id: 2,
    version: 1,
    estado: CasoClinicoEstadoEnum.CERRADO,
    numeroCaso: 2,
    diagnosticoPresuntivo: 'Cervicalgia',
  },
];

/**
 * Spec del listado de casos de una historia clinica.
 *
 * <p>El listado se pide por `historiaClinicaId` (no por persona). Cubre los cuatro estados de la
 * carga y el filtro de solo activos, que es una segunda consulta al backend, no un filtrado en
 * memoria.
 */
describe('CasosListadoPage', () => {
  let api: ReturnType<typeof mockApi>;

  beforeEach(() => {
    api = mockApi();
    TestBed.configureTestingModule({
      imports: [CasosListadoPage],
      providers: [
        provideRouter([{ path: '**', component: RutaVacia }]),
        { provide: CasosApi, useValue: api },
      ],
    });
  });

  it('mientras la consulta no responde queda cargando y no muestra items', () => {
    api.listar.mockReturnValue(new Subject<CasoClinico[]>());

    const fixture = crear();

    expect(fixture.componentInstance.cargando()).toBe(true);
    expect(fixture.componentInstance.error()).toBeFalsy();
    expect(items(fixture).length).toBe(0);
    expect(api.listar.mock.calls[0][0]).toBe(HC);
  });

  it('con una respuesta vacia deja de cargar y no inventa items', async () => {
    api.listar.mockReturnValue(of([]));

    const fixture = await montar();

    expect(fixture.componentInstance.cargando()).toBe(false);
    expect(fixture.componentInstance.casos()).toEqual([]);
    expect(items(fixture).length).toBe(0);
  });

  it('con items los renderiza, uno por caso', async () => {
    api.listar.mockReturnValue(of(CASOS));

    const fixture = await montar();

    expect(fixture.componentInstance.casos().length).toBe(2);
    expect(items(fixture).length).toBe(2);
    expect(testid(fixture, 'casos-lista')).not.toBeNull();
  });

  it('ante un error lo expone y no se queda cargando para siempre', async () => {
    api.listar.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
    );

    const fixture = await montar();

    expect(fixture.componentInstance.cargando()).toBe(false);
    expect(fixture.componentInstance.error()).toBeTruthy();
    expect(testid(fixture, 'casos-error')).not.toBeNull();
  });

  it('activar "solo activos" vuelve a pedir al backend, ahora con el filtro', async () => {
    api.listar.mockReturnValue(of(CASOS));

    const fixture = await montar();
    const control = testid(fixture, 'casos-solo-activos');
    expect(control).not.toBeNull();

    activar(control as HTMLElement);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(api.listar).toHaveBeenLastCalledWith(HC, true);
  });

  // --- apoyo ---------------------------------------------------------------------------

  function crear(): ComponentFixture<CasosListadoPage> {
    const fixture = TestBed.createComponent(CasosListadoPage);
    fixture.componentRef.setInput('historiaClinicaId', String(HC));
    fixture.detectChanges();
    return fixture;
  }

  async function montar(): Promise<ComponentFixture<CasosListadoPage>> {
    const fixture = crear();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function testid(fixture: ComponentFixture<CasosListadoPage>, id: string): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);
  }

  function items(fixture: ComponentFixture<CasosListadoPage>): HTMLElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="caso-item"]'),
    );
  }

  function activar(host: HTMLElement): void {
    const input =
      host instanceof HTMLInputElement ? host : host.querySelector('input');
    if (input instanceof HTMLInputElement) {
      input.checked = true;
      input.dispatchEvent(new Event('change'));
    } else {
      host.click();
    }
  }
});

function mockApi() {
  return {
    listar: vi.fn<(id: number, soloActivos?: boolean) => Observable<CasoClinico[]>>(),
    abrir: vi.fn(),
    ver: vi.fn(),
    editar: vi.fn(),
    cerrar: vi.fn(),
    reabrir: vi.fn(),
    cambiarEquipo: vi.fn(),
    eventos: vi.fn(),
  };
}
