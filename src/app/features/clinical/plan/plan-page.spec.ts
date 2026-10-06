import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PlanPage } from './plan-page';
import { errorInterceptor } from '../../../core/interceptors/error.interceptor';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { provideApi } from '../../../api/generated/provide-api';

const CASO = 12;
const PLAN = 40;

const LISTA = `/api/v1/casos-clinicos/${CASO}/planes`;
const VER = `/api/v1/planes-tratamiento/${PLAN}`;

const ITEM = {
  id: 1,
  ofertaId: 9,
  ofertaNombre: 'Kinesiologia',
  cantidadPlanificada: 10,
};

function plan(estado: string, version = 2, items: object[] = [ITEM]) {
  return {
    id: PLAN,
    casoClinicoId: CASO,
    numeroPlan: 1,
    estado,
    version,
    versionVigente: {
      id: 7,
      numeroVersion: 1,
      objetivos: 'Recuperar flexion',
      items,
    },
  };
}

/**
 * Spec del plan de tratamiento. Cubre lo que decide comportamiento: que se vea el plan con sus
 * items, que las transiciones manden la version leida, y que los 409 del backend se muestren sin
 * que la pantalla reimplemente la regla (activar sin items, conflicto de version).
 */
describe('PlanPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideApi(''),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    tenantContext = TestBed.inject(TenantContextStore);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('muestra el plan con sus items, versiones y avance', async () => {
    const fixture = await montar(plan('BORRADOR'));

    expect(texto(fixture)).toContain('BORRADOR');
    expect(texto(fixture)).toContain('Kinesiologia');
    expect(texto(fixture)).toContain('Plan en curso.');
    expect(fixture.nativeElement.querySelectorAll('#plan-versiones li').length).toBe(1);
    expect(boton(fixture, '#plan-activar')).not.toBeNull();
  });

  it('sin plan ofrece crearlo y manda el caso de la ruta', async () => {
    const fixture = await montar(null);

    expect(texto(fixture)).toContain('Crear plan');
    escribir(fixture, '#plan-objetivos', 'Marcha sin dolor');
    boton(fixture, '#plan-guardar')!.click();

    const pedido = httpMock.expectOne((r) => r.method === 'POST' && r.url === LISTA);
    expect((pedido.request.body as { objetivos: string }).objetivos).toBe('Marcha sin dolor');
    pedido.flush(plan('BORRADOR', 1, []));
    await recargar(fixture, plan('BORRADOR', 1, []));

    expect(texto(fixture)).toContain('El plan todavia no tiene items.');
  });

  it('activar sin items muestra el 409 del backend tal cual, sin reglas propias', async () => {
    const fixture = await montar(plan('BORRADOR', 2, []));

    boton(fixture, '#plan-activar')!.click();
    const pedido = httpMock.expectOne(`${VER}/activacion`);
    expect((pedido.request.body as { expectedVersion: number }).expectedVersion).toBe(2);
    problema(pedido, 409, 'plan-sin-items', 'No se puede activar un plan sin items.');
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No se puede activar un plan sin items.');
    expect(fixture.nativeElement.querySelector('[data-causa="conflicto"]')).not.toBeNull();
  });

  it('suspender manda motivo y version, y exige el motivo', async () => {
    const fixture = await montar(plan('ACTIVO', 5));

    expect(boton(fixture, '#plan-suspender')!.disabled).toBe(true);
    escribir(fixture, '#plan-motivo', 'Viaje del paciente');
    expect(boton(fixture, '#plan-suspender')!.disabled).toBe(false);
    boton(fixture, '#plan-suspender')!.click();

    const pedido = httpMock.expectOne(`${VER}/suspension`);
    expect(pedido.request.body).toEqual({ expectedVersion: 5, motivo: 'Viaje del paciente' });
    pedido.flush(plan('SUSPENDIDO', 6));
    await recargar(fixture, plan('SUSPENDIDO', 6));

    expect(texto(fixture)).toContain('SUSPENDIDO');
    expect(boton(fixture, '#plan-reanudar')).not.toBeNull();
  });

  it('un conflicto de version avisa y ofrece releer sin perder lo tipeado', async () => {
    const fixture = await montar(plan('ACTIVO', 3));

    escribir(fixture, '#plan-objetivos', 'Objetivo nuevo');
    boton(fixture, '#plan-guardar')!.click();
    problema(
      httpMock.expectOne((r) => r.method === 'PATCH' && r.url === VER),
      409,
      'concurrent-modification',
      'Version vieja.',
    );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Otra pestaña modifico este plan');
    expect(editor(fixture, '#plan-objetivos').value).toBe('Objetivo nuevo');
    expect(boton(fixture, '#plan-releer')).not.toBeNull();
  });

  it('un plan finalizado queda en lectura: sin editor ni transiciones', async () => {
    const fixture = await montar(plan('FINALIZADO', 9));

    expect(fixture.nativeElement.querySelector('#plan-guardar')).toBeNull();
    expect(fixture.nativeElement.querySelector('#plan-finalizar')).toBeNull();
  });

  // -------------------------------------------------------------------------------------

  /** Monta la pantalla y resuelve la carga inicial con `inicial` (null = el caso no tiene plan). */
  async function montar(
    inicial: ReturnType<typeof plan> | null,
  ): Promise<ComponentFixture<PlanPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
    const fixture = TestBed.createComponent(PlanPage);
    fixture.componentRef.setInput('casoId', String(CASO));
    fixture.detectChanges();

    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === LISTA)
      .flush(inicial ? [inicial] : []);
    if (inicial) {
      await resolverPlan(inicial);
    }
    await estabilizar(fixture);
    return fixture;
  }

  /** Tras una escritura exitosa la pantalla relee todo. */
  async function recargar(fixture: ComponentFixture<PlanPage>, nuevo: ReturnType<typeof plan>) {
    await resolverPlan(nuevo);
    await estabilizar(fixture);
  }

  async function resolverPlan(p: ReturnType<typeof plan>): Promise<void> {
    httpMock.expectOne((r) => r.method === 'GET' && r.url === VER).flush(p);
    httpMock
      .expectOne(`${VER}/versiones`)
      .flush([{ id: 7, numeroVersion: 1, objetivos: 'Recuperar flexion' }]);
    httpMock
      .expectOne((r) => r.url === `${VER}/avance`)
      .flush({ planTratamientoId: PLAN, completo: false, items: [] });
  }

  async function estabilizar(fixture: ComponentFixture<PlanPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function problema(pedido: TestRequest, status: number, tipo: string, detail: string): void {
    pedido.flush(
      { type: `https://akine.app/problems/${tipo}`, status, detail },
      { status, statusText: 'Conflict' },
    );
  }

  function texto(fixture: ComponentFixture<PlanPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function boton(fixture: ComponentFixture<PlanPage>, selector: string): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  function editor(fixture: ComponentFixture<PlanPage>, selector: string): HTMLTextAreaElement {
    return fixture.nativeElement.querySelector(selector) as HTMLTextAreaElement;
  }

  function escribir(fixture: ComponentFixture<PlanPage>, selector: string, valor: string): void {
    const campo = editor(fixture, selector);
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }
});
