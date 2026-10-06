import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';

@Component({ template: '', standalone: true })
class RutaVacia {}

import { CasoDetallePage } from './caso-detalle-page';
import { CasosApi } from '../../casos-api';
import {
  CasoClinico,
  CasoClinicoEstadoEnum,
} from '../../../../../api/generated/model/caso-clinico';
import { CasoEvento } from '../../../../../api/generated/model/caso-evento';

const CASO_ID = 10;

const ACTIVO: CasoClinico = {
  id: CASO_ID,
  version: 2,
  estado: CasoClinicoEstadoEnum.ACTIVO,
  numeroCaso: 5,
  diagnosticoPresuntivo: 'Lumbalgia',
  objetivoTerapeutico: 'Reducir dolor',
  abiertoEn: '2026-09-01T10:00:00Z',
};

const CERRADO: CasoClinico = {
  ...ACTIVO,
  version: 3,
  estado: CasoClinicoEstadoEnum.CERRADO,
  cerradoEn: '2026-09-10T10:00:00Z',
  motivoCierre: 'Alta por mejoria',
};

const EVENTOS = [{ id: 1 } as CasoEvento];

function problema(status: number, slug?: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    statusText: String(status),
    error: slug ? { type: `https://akine.app/problems/${slug}`, status, detail: 'detalle' } : {},
  });
}

/**
 * Spec del detalle de un caso clinico.
 *
 * <p>El detalle carga el caso y sus eventos, y desde el ofrece las acciones de ciclo de vida:
 * cerrar con motivo, reabrir, editar y cambiar el equipo. La edicion con version vieja es el
 * punto delicado: ante un 409 de concurrencia hay que releer el caso, no reintentar a ciegas.
 */
describe('CasoDetallePage', () => {
  let api: ReturnType<typeof mockApi>;

  beforeEach(() => {
    api = mockApi();
    api.ver.mockReturnValue(of(ACTIVO));
    api.eventos.mockReturnValue(of(EVENTOS));
    api.cerrar.mockReturnValue(of(CERRADO));
    api.reabrir.mockReturnValue(of(ACTIVO));
    api.editar.mockReturnValue(of(ACTIVO));
    api.cambiarEquipo.mockReturnValue(of(ACTIVO));
    TestBed.configureTestingModule({
      imports: [CasoDetallePage],
      providers: [
        provideRouter([{ path: '**', component: RutaVacia }]),
        { provide: CasosApi, useValue: api },
      ],
    });
  });

  it('carga el caso y sus eventos a partir del id de la ruta', async () => {
    const fixture = await montar();

    expect(api.ver.mock.calls[0][0]).toBe(CASO_ID);
    expect(api.eventos.mock.calls[0][0]).toBe(CASO_ID);
    expect(fixture.componentInstance.caso()?.id).toBe(CASO_ID);
    expect(fixture.componentInstance.eventos().length).toBe(1);
    expect(fixture.componentInstance.cargando()).toBe(false);
    expect(testid(fixture, 'caso-detalle')).not.toBeNull();
    expect(testid(fixture, 'caso-eventos')).not.toBeNull();
  });

  it('ante un error de carga no se queda cargando ni muestra un caso fantasma', async () => {
    api.ver.mockReturnValue(throwError(() => problema(404, 'caso-clinico-no-encontrado')));
    const fixture = TestBed.createComponent(CasoDetallePage);
    fixture.componentRef.setInput('casoId', String(CASO_ID));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.cargando()).toBe(false);
    expect(fixture.componentInstance.caso()).toBeFalsy();
  });

  it('cerrar un caso activo manda el motivo que se escribio', async () => {
    const fixture = await montar();

    apretar(fixture, 'caso-cerrar');
    escribir(fixture, 'caso-motivo', 'Alta por mejoria');
    confirmarSiHay(fixture);

    expect(api.cerrar).toHaveBeenCalled();
    expect(api.cerrar.mock.calls[0][0]).toBe(CASO_ID);
    expect(JSON.stringify(api.cerrar.mock.calls[0][1])).toContain('Alta por mejoria');
  });

  it('un caso cerrado se puede reabrir, y ofrece reabrir en vez de cerrar', async () => {
    const fixture = await montar(CERRADO);

    expect(testid(fixture, 'caso-reabrir')).not.toBeNull();

    apretar(fixture, 'caso-reabrir');
    escribir(fixture, 'caso-motivo', 'Reaparecio el dolor');
    confirmarSiHay(fixture);

    expect(api.reabrir).toHaveBeenCalled();
    expect(api.reabrir.mock.calls[0][0]).toBe(CASO_ID);
  });

  it('editar llega a la fachada contra el caso que se esta viendo', async () => {
    const fixture = await montar();

    apretar(fixture, 'caso-editar');
    completar(fixture);
    confirmarSiHay(fixture);

    expect(api.editar).toHaveBeenCalled();
    expect(api.editar.mock.calls[0][0]).toBe(CASO_ID);
    expect(api.editar.mock.calls[0][1]).toBeDefined();
  });

  it('ante un editar con version vieja no se traga el conflicto', async () => {
    api.editar.mockReturnValue(throwError(() => problema(409, 'concurrent-modification')));
    const fixture = await montar();

    apretar(fixture, 'caso-editar');
    completar(fixture);
    confirmarSiHay(fixture);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.editar).toHaveBeenCalled();
    // El caso que se ve sigue siendo el leido: el 409 no dejo la pantalla con datos a medio aplicar.
    expect(fixture.componentInstance.caso()?.version).toBe(2);
  });

  it('cambiar el equipo del caso llega al backend con el id del caso', async () => {
    const fixture = await montar();

    apretar(fixture, 'caso-equipo-guardar');
    confirmarSiHay(fixture);

    expect(api.cambiarEquipo).toHaveBeenCalled();
    expect(api.cambiarEquipo.mock.calls[0][0]).toBe(CASO_ID);
  });

  // --- apoyo ---------------------------------------------------------------------------

  async function montar(caso: CasoClinico = ACTIVO): Promise<ComponentFixture<CasoDetallePage>> {
    api.ver.mockReturnValue(of(caso));
    const fixture = TestBed.createComponent(CasoDetallePage);
    fixture.componentRef.setInput('casoId', String(CASO_ID));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function testid(fixture: ComponentFixture<CasoDetallePage>, id: string): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);
  }

  function apretar(fixture: ComponentFixture<CasoDetallePage>, id: string): void {
    const el = testid(fixture, id);
    if (el === null) {
      throw new Error(`No existe el elemento con data-testid="${id}".`);
    }
    el.click();
    fixture.detectChanges();
  }

  /** Aprieta el boton de confirmacion si la accion lo abrio como segundo paso. */
  function confirmarSiHay(fixture: ComponentFixture<CasoDetallePage>): void {
    const confirmar = testid(fixture, 'caso-confirmar');
    if (confirmar !== null) {
      confirmar.click();
      fixture.detectChanges();
    }
  }

  function escribir(fixture: ComponentFixture<CasoDetallePage>, id: string, valor: string): void {
    const el = testid(fixture, id);
    const campo =
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        ? el
        : (el?.querySelector('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null);
    if (campo !== null && campo !== undefined) {
      campo.value = valor;
      campo.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }
  }

  function completar(fixture: ComponentFixture<CasoDetallePage>): void {
    (fixture.nativeElement as HTMLElement)
      .querySelectorAll('input, textarea')
      .forEach((campo) => {
        const c = campo as HTMLInputElement | HTMLTextAreaElement;
        if (c instanceof HTMLInputElement && (c.type === 'checkbox' || c.type === 'radio')) {
          return;
        }
        c.value = 'Texto actualizado';
        c.dispatchEvent(new Event('input'));
      });
    fixture.detectChanges();
  }
});

function mockApi() {
  return {
    listar: vi.fn(),
    abrir: vi.fn(),
    ver: vi.fn<(id: number) => Observable<CasoClinico>>(),
    editar: vi.fn<(id: number, body: unknown) => Observable<CasoClinico>>(),
    cerrar: vi.fn<(id: number, body: unknown) => Observable<CasoClinico>>(),
    reabrir: vi.fn<(id: number, body: unknown) => Observable<CasoClinico>>(),
    cambiarEquipo: vi.fn<(id: number, body: unknown) => Observable<CasoClinico>>(),
    eventos: vi.fn<(id: number) => Observable<CasoEvento[]>>(),
  };
}
