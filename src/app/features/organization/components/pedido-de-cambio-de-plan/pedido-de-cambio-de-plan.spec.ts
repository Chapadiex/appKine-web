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

  it('describe los topes de cada plan y deja afuera lo que no se ofrece', async () => {
    const fixture = await montar();
    fixture.componentRef.setInput('catalogo', [
      {
        code: 'UNO',
        name: 'Plan Uno',
        limits: [
          { code: 'MAX_CONSULTORIOS', value: 1 },
          { code: 'MAX_PROFESIONALES', value: 6 },
        ],
      },
      { code: 'LIBRE', limits: [{ code: 'MAX_CONSULTORIOS', unlimited: true }] },
      { code: 'NADA', name: 'Plan Nada', limits: [] },
      { code: 'RETIRADO', name: 'Plan Retirado', ofrecido: false },
      { name: 'Sin código' },
    ]);
    http.expectOne(RUTA).flush(null, { status: 204, statusText: 'No Content' });
    await estable(fixture);

    const opciones = valor<{ valor: string; etiqueta: string; descripcion: string }[]>(
      fixture,
      'opcionesDePlan',
    );
    expect(opciones.map((o) => o.valor)).toEqual(['UNO', 'LIBRE', 'NADA']);
    expect(opciones[0].descripcion).toBe('Hasta 1 sede · hasta 6 profesionales');
    expect(opciones[1]).toEqual(
      expect.objectContaining({ etiqueta: 'LIBRE', descripcion: 'Sedes sin tope' }),
    );
    expect(opciones[2].descripcion).toBe('Sin topes declarados');
  });

  it('marca cada servicio como suma, deja, tiene o no, y arma el resumen con la IA', async () => {
    const fixture = await montar();
    http.expectOne(RUTA).flush(null, { status: 204, statusText: 'No Content' });
    await estable(fixture);
    llamar(fixture, 'abrir');
    elegir(fixture, { plan: 'BASE', kinesiologia: false, actividades: true, ia: true });

    const [kine, actividades, ia] = valor<unknown[]>(fixture, 'servicios');
    expect(llamar(fixture, 'estadoDe', kine)).toBe('quita');
    expect(llamar(fixture, 'estadoDe', actividades)).toBe('suma');
    expect(llamar(fixture, 'estadoDe', ia)).toBe('suma');
    expect(valor<string[]>(fixture, 'resumen')).toEqual([
      'Deja Kinesiología',
      'Suma Actividades y clases',
      'Suma la inteligencia artificial',
    ]);
    expect(valor<string[]>(fixture, 'dejados')).toEqual(['Kinesiología']);

    elegir(fixture, { plan: 'BASE', kinesiologia: true, actividades: false, ia: false });
    expect(llamar(fixture, 'estadoDe', kine)).toBe('tiene');
    expect(llamar(fixture, 'estadoDe', actividades)).toBe('no');
    expect(valor<string[]>(fixture, 'resumen')).toEqual([]);
    // Sin cambios no se envía nada.
    llamar(fixture, 'enviar');
    http.expectNone((r) => r.method === 'POST');

    elegir(fixture, { plan: 'BASE', kinesiologia: false, actividades: false, ia: false });
    expect(valor<boolean>(fixture, 'sinServicios')).toBe(true);
    llamar(fixture, 'enviar');
    http.expectNone((r) => r.method === 'POST');
  });

  it('sólo avisa ajustes de topes que el centro supera', async () => {
    const fixture = await montar();
    fixture.componentRef.setInput('catalogo', [
      {
        code: 'CHICO',
        name: 'Plan Chico',
        limits: [
          { code: 'MAX_CONSULTORIOS', unlimited: true },
          { code: 'MAX_PROFESIONALES', value: 2 },
        ],
      },
      { code: 'SIN_VALOR', limits: [{ code: 'MAX_PROFESIONALES' }] },
    ]);
    fixture.componentRef.setInput('usos', [
      { code: 'MAX_CONSULTORIOS', currentUsage: 9 },
      { code: 'MAX_PROFESIONALES', currentUsage: 3 },
    ]);
    http.expectOne(RUTA).flush(null, { status: 204, statusText: 'No Content' });
    await estable(fixture);

    elegir(fixture, { plan: 'CHICO', kinesiologia: true, actividades: false, ia: false });
    expect(valor<string[]>(fixture, 'ajustes')).toEqual([
      'Tenés 3 profesionales y el Plan Chico permite 2: dá de baja a 1 profesional.',
    ]);
    elegir(fixture, { plan: 'SIN_VALOR', kinesiologia: true, actividades: false, ia: false });
    expect(valor<string[]>(fixture, 'ajustes')).toEqual([]);
    elegir(fixture, { plan: 'NO_EXISTE', kinesiologia: true, actividades: false, ia: false });
    expect(valor<string[]>(fixture, 'ajustes')).toEqual([]);
  });

  it('traduce cada error del envío y relee si ya había uno pendiente', async () => {
    const fixture = await montar();
    http.expectOne(RUTA).flush(null, { status: 204, statusText: 'No Content' });
    await estable(fixture);

    const casos: [string | null, number, string][] = [
      ['pedido-sin-cambios', 400, 'Lo que elegiste es lo que ya tenés contratado.'],
      ['concurrent-modification', 409, 'El pedido cambió mientras lo mirabas.'],
      ['pedido-de-plan-pendiente', 409, 'Ya hay un pedido esperando respuesta.'],
      [null, 0, 'No se pudo contactar al servidor.'],
    ];
    for (const [tipo, status, esperado] of casos) {
      elegir(fixture, {
        plan: 'CRECIMIENTO',
        kinesiologia: true,
        actividades: false,
        ia: true,
        comentario: '  Sumamos IA  ',
      });
      llamar(fixture, 'enviar');
      const pedido = http.expectOne((r) => r.method === 'POST' && r.url === RUTA);
      expect(pedido.request.body).toEqual(
        expect.objectContaining({ adicionales: ['IA'], comentario: 'Sumamos IA' }),
      );
      if (status === 0) {
        pedido.error(new ProgressEvent('error'), { status: 0, statusText: '' });
      } else {
        pedido.flush(
          { type: `https://akine.app/problems/${tipo}`, title: 't', status },
          { status, statusText: 'Error' },
        );
      }
      if (tipo === 'pedido-de-plan-pendiente') {
        http
          .expectOne((r) => r.method === 'GET' && r.url === RUTA)
          .flush({
            id: 4,
            estado: 'PENDIENTE',
            planCode: 'CRECIMIENTO',
            version: 1,
          });
      }
      expect(valor<string>(fixture, 'error')).toContain(esperado);
      expect(valor<boolean>(fixture, 'enviando')).toBe(false);
    }
  });

  it('un error sin tipo conocido muestra el mensaje y la lectura fallida deja sin pedido', async () => {
    const fixture = await montar();
    http.expectOne(RUTA).flush('caído', { status: 500, statusText: 'Server Error' });
    await estable(fixture);
    expect(valor<unknown>(fixture, 'pedido')).toBeNull();

    elegir(fixture, { plan: 'CRECIMIENTO', kinesiologia: true, actividades: false, ia: false });
    llamar(fixture, 'enviar');
    http
      .expectOne((r) => r.method === 'POST')
      .flush('caído', { status: 500, statusText: 'Server Error' });
    expect(valor<string>(fixture, 'error')).toBeTruthy();
  });

  it('cancela con la versión del pedido, y si falla avisa y relee', async () => {
    const fixture = await montar();
    // Sin pedido, cancelar no hace nada.
    http.expectOne(RUTA).flush(null, { status: 204, statusText: 'No Content' });
    await estable(fixture);
    llamar(fixture, 'cancelarPedido');
    http.expectNone((r) => r.method === 'POST');

    const pendiente = {
      id: 3,
      estado: 'PENDIENTE',
      planCode: 'CRECIMIENTO',
      servicios: ['KINESIOLOGIA', 'OTRO'],
      adicionales: ['IA'],
      excesos: [{ limitCode: 'MAX_CONSULTORIOS', tope: 1, uso: 2 }],
      version: 5,
    };
    llamarSignal(fixture, 'pedido', pendiente);
    expect(llamar(fixture, 'descripcion', pendiente)).toBe(
      'CRECIMIENTO · Kinesiología, OTRO, inteligencia artificial',
    );
    expect(llamar(fixture, 'ajustesDelPedido', pendiente)).toEqual([
      'Tenés 2 sedes y el CRECIMIENTO permite 1: cerrá 1 sede.',
    ]);
    expect(llamar(fixture, 'ajustesDelPedido', { ...pendiente, excesos: undefined })).toEqual([]);

    llamar(fixture, 'cancelarPedido');
    const cancelar = http.expectOne(`${RUTA}/3/cancelar`);
    expect(cancelar.request.body).toEqual({ version: 5 });
    cancelar.flush({ ...pendiente, estado: 'CANCELADO', version: 6 });
    expect(valor<{ estado: string }>(fixture, 'pedido').estado).toBe('CANCELADO');

    llamarSignal(fixture, 'pedido', pendiente);
    llamar(fixture, 'cancelarPedido');
    http
      .expectOne(`${RUTA}/3/cancelar`)
      .flush(
        { type: 'https://akine.app/problems/concurrent-modification', title: 't', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    http.expectOne((r) => r.method === 'GET' && r.url === RUTA).flush(pendiente);
    expect(valor<string>(fixture, 'error')).toContain('El pedido cambió');

    llamar(fixture, 'cerrar');
    expect(valor<boolean>(fixture, 'panelAbierto')).toBe(false);
  });

  function miembro(fixture: ComponentFixture<PedidoDeCambioDePlan>): Record<string, unknown> {
    return fixture.componentInstance as unknown as Record<string, unknown>;
  }

  function llamar(
    fixture: ComponentFixture<PedidoDeCambioDePlan>,
    metodo: string,
    ...args: unknown[]
  ): unknown {
    const c = miembro(fixture);
    return (c[metodo] as (...a: unknown[]) => unknown).apply(c, args);
  }

  /** Lee un signal o computed protegido del componente. */
  function valor<T>(fixture: ComponentFixture<PedidoDeCambioDePlan>, nombre: string): T {
    const v = miembro(fixture)[nombre];
    return (typeof v === 'function' ? (v as () => T)() : v) as T;
  }

  function llamarSignal(
    fixture: ComponentFixture<PedidoDeCambioDePlan>,
    nombre: string,
    nuevo: unknown,
  ): void {
    (miembro(fixture)[nombre] as { set(v: unknown): void }).set(nuevo);
  }

  function elegir(
    fixture: ComponentFixture<PedidoDeCambioDePlan>,
    v: {
      plan: string;
      kinesiologia: boolean;
      actividades: boolean;
      ia: boolean;
      comentario?: string;
    },
  ): void {
    (miembro(fixture)['formulario'] as { setValue(x: unknown): void }).setValue({
      comentario: '',
      ...v,
    });
  }

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
