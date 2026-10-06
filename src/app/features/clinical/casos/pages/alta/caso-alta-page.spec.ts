import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';

@Component({ template: '', standalone: true })
class RutaVacia {}

import { CasoAltaPage } from './caso-alta-page';
import { CasosApi } from '../../casos-api';
import {
  CasoClinico,
  CasoClinicoEstadoEnum,
} from '../../../../../api/generated/model/caso-clinico';

const HC = 42;
const ABIERTO: CasoClinico = {
  id: 7,
  version: 1,
  estado: CasoClinicoEstadoEnum.ACTIVO,
  numeroCaso: 3,
};

function problema(status: number, slug: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    statusText: String(status),
    error: { type: `https://akine.app/problems/${slug}`, status, detail: 'detalle' },
  });
}

/**
 * Spec del alta de un caso clinico.
 *
 * <p>Dos cosas que no pueden fallar: no mandar un alta invalida, y el camino del posible
 * duplicado, que no es un error sino una pregunta: el backend avisa y el profesional reenvia
 * confirmando. Un reenvio que no marque la confirmacion vuelve a chocar con el mismo 409.
 */
describe('CasoAltaPage', () => {
  let api: ReturnType<typeof mockApi>;

  beforeEach(() => {
    api = mockApi();
    api.abrir.mockReturnValue(of(ABIERTO));
    TestBed.configureTestingModule({
      imports: [CasoAltaPage],
      providers: [
        provideRouter([{ path: '**', component: RutaVacia }]),
        { provide: CasosApi, useValue: api },
      ],
    });
  });

  it('un formulario vacio no se manda: el alta invalida no llega al backend', () => {
    const fixture = montar();

    apretar(fixture, 'caso-guardar');

    expect(api.abrir).not.toHaveBeenCalled();
  });

  it('un formulario completo abre el caso contra la historia clinica de la ruta', () => {
    const fixture = montar();

    completar(fixture);
    apretar(fixture, 'caso-guardar');

    expect(api.abrir).toHaveBeenCalled();
    expect(api.abrir.mock.calls[0][0]).toBe(HC);
  });

  // BLOQUEADO (spec): la pantalla clasifica el 409 via `traducirErrorCaso`, que con el error
  // mockeado en la fachada devuelve 'otro' (muestra el cartel generico, no el aviso de duplicado).
  // La forma de error que reconoce la produce el `errorInterceptor` HTTP, fuera del alcance
  // "mockear CasosApi, sin HTTP". Pendiente de que el padre defina esa forma o habilite el pipeline.
  it.skip('ante un posible duplicado no cierra: avisa y ofrece confirmar', async () => {
    api.abrir.mockReturnValue(throwError(() => problema(409, 'caso-clinico-posible-duplicado')));
    const fixture = montar();

    completar(fixture);
    apretar(fixture, 'caso-guardar');
    await asentar(fixture);

    expect(testid(fixture, 'caso-duplicado-aviso')).not.toBeNull();
    expect(testid(fixture, 'caso-confirmar-duplicado')).not.toBeNull();
  });

  it.skip('confirmar el duplicado reenvia, ahora marcando la confirmacion', async () => {
    api.abrir.mockReturnValue(throwError(() => problema(409, 'caso-clinico-posible-duplicado')));
    const fixture = montar();

    completar(fixture);
    apretar(fixture, 'caso-guardar');
    await asentar(fixture);
    expect(testid(fixture, 'caso-confirmar-duplicado')).not.toBeNull();

    api.abrir.mockReturnValue(of(ABIERTO));
    apretar(fixture, 'caso-confirmar-duplicado');
    await asentar(fixture);

    expect(api.abrir.mock.calls.length).toBeGreaterThanOrEqual(2);
    const ultimo = api.abrir.mock.calls[api.abrir.mock.calls.length - 1][1] as Record<
      string,
      unknown
    >;
    expect(ultimo['confirmaPosibleDuplicado']).toBe(true);
  });

  // --- apoyo ---------------------------------------------------------------------------

  function montar(): ComponentFixture<CasoAltaPage> {
    const fixture = TestBed.createComponent(CasoAltaPage);
    fixture.componentRef.setInput('historiaClinicaId', String(HC));
    fixture.detectChanges();
    return fixture;
  }

  async function asentar(fixture: ComponentFixture<CasoAltaPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function testid(fixture: ComponentFixture<CasoAltaPage>, id: string): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);
  }

  function apretar(fixture: ComponentFixture<CasoAltaPage>, id: string): void {
    const el = testid(fixture, id);
    if (el === null) {
      throw new Error(`No existe el elemento con data-testid="${id}".`);
    }
    el.click();
    fixture.detectChanges();
  }

  /** Llena todo lo llenable del formulario, para que el alta sea valida sin conocer cada campo. */
  function completar(fixture: ComponentFixture<CasoAltaPage>): void {
    const root = fixture.nativeElement as HTMLElement;
    root.querySelectorAll('input').forEach((input) => {
      if (input.type === 'checkbox' || input.type === 'radio') {
        input.checked = true;
        input.dispatchEvent(new Event('change'));
        return;
      }
      input.value = input.type === 'number' ? '1' : input.type === 'date' ? '2026-01-01' : 'Texto';
      input.dispatchEvent(new Event('input'));
    });
    root.querySelectorAll('textarea').forEach((area) => {
      area.value = 'Texto de prueba';
      area.dispatchEvent(new Event('input'));
    });
    root.querySelectorAll('select').forEach((select) => {
      const opcion = Array.from(select.options).find((o) => o.value !== '');
      if (opcion !== undefined) {
        select.value = opcion.value;
        select.dispatchEvent(new Event('change'));
      }
    });
    fixture.detectChanges();
  }
});

function mockApi() {
  return {
    listar: vi.fn(),
    abrir: vi.fn<(id: number, body: unknown) => Observable<CasoClinico>>(),
    ver: vi.fn(),
    editar: vi.fn(),
    cerrar: vi.fn(),
    reabrir: vi.fn(),
    cambiarEquipo: vi.fn(),
    eventos: vi.fn(),
  };
}
