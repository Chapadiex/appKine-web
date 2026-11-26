import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { ContratacionStore } from '../../../../core/services/contratacion.store';
import { PedidoDeCambioDePlan } from './pedido-de-cambio-de-plan';

const ORG = 9;
const RUTA = `/api/v1/organizations/${ORG}/subscription/pedido-de-cambio`;

const CATALOGO = [
  { code: 'BASE', name: 'Plan Base', ofrecido: true, limits: [] },
  { code: 'CRECIMIENTO', name: 'Plan Intermedio', ofrecido: true, limits: [] },
];

describe('PedidoDeCambioDePlan', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PedidoDeCambioDePlan],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideApi(''),
        {
          provide: ContratacionStore,
          useValue: {
            contratacion: () => ({
              planCode: 'BASE',
              planNombre: 'Plan Base',
              servicios: ['KINESIOLOGIA'],
              adicionales: [],
            }),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('pide plan y servicios nuevos y muestra el pedido pendiente con su cancelación', async () => {
    const fixture = await montar();
    http.expectOne(RUTA).flush(null, { status: 204, statusText: 'No Content' });
    await estable(fixture);

    boton(fixture, 'Pedir un cambio de plan').click();
    await estable(fixture);
    const plan = fixture.nativeElement.querySelector(
      'input[type="radio"][value="CRECIMIENTO"]',
    ) as HTMLInputElement;
    plan.click();
    const actividades = Array.from(
      fixture.nativeElement.querySelectorAll(
        'input[type="checkbox"]',
      ) as NodeListOf<HTMLInputElement>,
    )[1];
    actividades.click();
    await estable(fixture);
    expect(texto(fixture)).toContain('Pasás de Plan Base a Plan Intermedio');
    expect(texto(fixture)).toContain('Suma Actividades y clases');

    boton(fixture, 'Enviar el pedido').click();
    const pedido = http.expectOne((r) => r.method === 'POST' && r.url === RUTA);
    expect(pedido.request.body).toEqual({
      planCode: 'CRECIMIENTO',
      servicios: ['KINESIOLOGIA', 'ACTIVIDADES'],
      adicionales: [],
    });
    pedido.flush({
      id: 3,
      estado: 'PENDIENTE',
      planCode: 'CRECIMIENTO',
      planNombre: 'Plan Intermedio',
      servicios: ['KINESIOLOGIA', 'ACTIVIDADES'],
      adicionales: [],
      pedidoEn: '2026-11-25T12:00:00Z',
      version: 0,
    });
    await estable(fixture);

    expect(texto(fixture)).toContain('Esperando respuesta');
    expect(boton(fixture, 'Cancelar el pedido')).toBeTruthy();
  });

  it('al bajar avisa qué ajustar y que el servicio que deja queda en solo lectura', async () => {
    const fixture = await montar();
    fixture.componentRef.setInput('catalogo', [
      ...CATALOGO,
      {
        code: 'MINI',
        name: 'Plan Mini',
        ofrecido: true,
        limits: [{ code: 'MAX_CONSULTORIOS', value: 1 }],
      },
    ]);
    fixture.componentRef.setInput('usos', [{ code: 'MAX_CONSULTORIOS', currentUsage: 3 }]);
    http.expectOne(RUTA).flush(null, { status: 204, statusText: 'No Content' });
    await estable(fixture);

    boton(fixture, 'Pedir un cambio de plan').click();
    await estable(fixture);
    (
      fixture.nativeElement.querySelector('input[type="radio"][value="MINI"]') as HTMLInputElement
    ).click();
    (
      fixture.nativeElement.querySelectorAll('input[type="checkbox"]')[0] as HTMLInputElement
    ).click();
    (
      fixture.nativeElement.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement
    ).click();
    await estable(fixture);

    expect(texto(fixture)).toContain('Tenés 3 sedes y el Plan Mini permite 1: cerrá 2 sedes.');
    expect(texto(fixture)).toContain('Kinesiología queda en solo lectura');
  });

  async function montar(): Promise<ComponentFixture<PedidoDeCambioDePlan>> {
    const fixture = TestBed.createComponent(PedidoDeCambioDePlan);
    fixture.componentRef.setInput('orgId', ORG);
    fixture.componentRef.setInput('catalogo', CATALOGO);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  async function estable(fixture: ComponentFixture<PedidoDeCambioDePlan>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function boton(
    fixture: ComponentFixture<PedidoDeCambioDePlan>,
    rotulo: string,
  ): HTMLButtonElement {
    const encontrado = Array.from(
      (fixture.nativeElement as HTMLElement).ownerDocument.querySelectorAll('button'),
    ).find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === rotulo);
    if (!encontrado) throw new Error(`No hay botón "${rotulo}"`);
    return encontrado;
  }

  function texto(fixture: ComponentFixture<PedidoDeCambioDePlan>): string {
    return ((fixture.nativeElement as HTMLElement).ownerDocument.body.textContent ?? '').replace(
      /\s+/g,
      ' ',
    );
  }
});
