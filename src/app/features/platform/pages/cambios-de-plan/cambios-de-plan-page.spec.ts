import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { CambiosDePlanPage } from './cambios-de-plan-page';
import { provideApi } from '../../../../api/generated/provide-api';
import { PedidoDeCambioDePlanResponse } from '../../../../api/generated/model/pedido-de-cambio-de-plan-response';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { ContadoresDePlataformaStore } from '../../../../core/services/contadores-de-plataforma.store';

const LISTADO = '/api/v1/platform/pedidos-de-cambio-de-plan';

const pedido = (
  id: number,
  estado = 'PENDIENTE',
  extra: Record<string, unknown> = {},
): PedidoDeCambioDePlanResponse =>
  ({
    id,
    organizationId: 10 + id,
    organizationNombre: `Centro Sintético ${id}`,
    planCode: 'CRECIMIENTO',
    planNombre: 'Plan Intermedio',
    servicios: ['KINESIOLOGIA', 'ACTIVIDADES'],
    adicionales: ['IA'],
    planCodeAnterior: 'BASE',
    planNombreAnterior: 'Plan Base',
    serviciosAnteriores: ['KINESIOLOGIA'],
    adicionalesAnteriores: [],
    comentario: 'Sumamos yoga',
    estado,
    pedidoEn: '2026-11-26T12:00:00Z',
    version: 2,
    excesos: [],
    ...extra,
  }) as unknown as PedidoDeCambioDePlanResponse;

const pagina = (content: unknown[], pendientes: number = content.length) => ({
  content,
  page: 0,
  size: 10,
  totalPages: 1,
  totalElements: content.length,
  pendientes,
});

/** Lo que se le pide a la pagina protegida desde el test, sin tocar su API publica. */
type Pagina = Record<string, unknown>;

/**
 * La bandeja de cambios de plan: que entre en los pendientes, que aprobar y rechazar manden la
 * version leida, y que un 409 diga por qué y relea la bandeja.
 */
describe('CambiosDePlanPage', () => {
  let httpMock: HttpTestingController;
  const refrescar = vi.fn();

  beforeEach(async () => {
    refrescar.mockReset();
    await TestBed.configureTestingModule({
      imports: [CambiosDePlanPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
        { provide: ContadoresDePlataformaStore, useValue: { refrescar, valor: () => null } },
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('entra en los pendientes con el contador y lo pedido contra lo que tiene', async () => {
    const fixture = TestBed.createComponent(CambiosDePlanPage);
    fixture.detectChanges();
    const listado = httpMock.expectOne((r) => r.url === LISTADO);
    expect(listado.request.params.get('estado')).toBe('PENDIENTE');
    expect(listado.request.params.get('page')).toBe('0');
    listado.flush(pagina([pedido(1), pedido(2)], 5));
    await estabilizar(fixture);

    const p = pag(fixture);
    expect((p['pendientes'] as () => number)()).toBe(5);
    expect(texto(fixture)).toContain('Centro Sintético 1');
    expect(llamar(p, 'textoPendientes', 1)).toBe('1 pendiente');
    expect(llamar(p, 'textoPendientes', 5)).toBe('5 pendientes');
    expect(llamar(p, 'contratacion', 'Plan Base', ['KINESIOLOGIA'], [])).not.toContain('IA');
    expect(llamar(p, 'contratacion', undefined, undefined, ['IA'])).toContain('Sin plan');
    expect(llamar(p, 'contratacion', 'Plan Base', ['KINESIOLOGIA'], ['IA'])).toContain('con IA');
  });

  it('marca cada estado y cae a "Sin dato" con uno desconocido', async () => {
    const p = pag(await abrir([]));
    expect(llamar(p, 'marca', 'PENDIENTE')).toEqual(
      expect.objectContaining({ texto: 'Pendiente' }),
    );
    expect(llamar(p, 'marca', 'APROBADO')).toEqual(expect.objectContaining({ texto: 'Aprobado' }));
    expect(llamar(p, 'marca', 'RECHAZADO')).toEqual(
      expect.objectContaining({ texto: 'Rechazado' }),
    );
    expect(llamar(p, 'marca', 'CANCELADO')).toEqual(
      expect.objectContaining({ texto: 'Cancelado por el centro' }),
    );
    expect(llamar(p, 'marca', undefined)).toEqual(expect.objectContaining({ texto: 'Sin dato' }));
    expect(llamar(p, 'fecha', undefined)).toBe('Sin fecha');
    expect(llamar(p, 'fecha', '2026-11-26T12:00:00Z')).not.toBe('Sin fecha');
  });

  it('arma el texto de lo que el centro tiene que ajustar', async () => {
    const p = pag(await abrir([]));
    const conExcesos = pedido(1, 'PENDIENTE', {
      excesos: [
        { limitCode: 'MAX_CONSULTORIOS', tope: 1, uso: 3 },
        { limitCode: 'MAX_PROFESIONALES', tope: 2, uso: 3 },
      ],
    });
    expect(llamar(p, 'ajustes', conExcesos)).toEqual([
      'Tenés 3 sedes y el Plan Intermedio permite 1: cerrá 2 sedes.',
      'Tenés 3 profesionales y el Plan Intermedio permite 2: dá de baja a 1 profesional.',
    ]);
    expect(llamar(p, 'ajustes', pedido(2, 'PENDIENTE', { excesos: undefined }))).toEqual([]);
  });

  it('busca por texto y estado, limpia, pagina y cambia el tamaño', async () => {
    const fixture = await abrir([pedido(1)]);
    const p = pag(fixture);

    (p['busqueda'] as { set(v: string): void }).set('  norte ');
    (p['filtroDeEstado'] as { set(v: string): void }).set('');
    llamar(p, 'buscar');
    let req = httpMock.expectOne((r) => r.url === LISTADO);
    expect(req.request.params.get('q')).toBe('norte');
    expect(req.request.params.has('estado')).toBe(false);
    req.flush(pagina([]));
    expect((p['hayFiltros'] as () => boolean)()).toBe(true);
    expect((p['filtrosAvanzadosActivos'] as () => number)()).toBe(1);

    llamar(p, 'limpiarFiltros');
    req = httpMock.expectOne((r) => r.url === LISTADO);
    expect(req.request.params.get('estado')).toBe('PENDIENTE');
    expect(req.request.params.has('q')).toBe(false);
    req.flush({ ...pagina([]), pendientes: undefined });
    expect((p['pendientes'] as () => number | null)()).toBeNull();

    llamar(p, 'irAPagina', 2);
    req = httpMock.expectOne((r) => r.url === LISTADO);
    expect(req.request.params.get('page')).toBe('2');
    req.flush({ content: undefined, totalElements: undefined, totalPages: undefined });
    expect((p['paginaDePedidos'] as () => { pagina: number; total: number })()).toEqual(
      expect.objectContaining({ pagina: 2, total: 0 }),
    );

    llamar(p, 'cambiarPorPagina', 25);
    req = httpMock.expectOne((r) => r.url === LISTADO);
    expect(req.request.params.get('size')).toBe('25');
    req.flush('caído', { status: 500, statusText: 'Server Error' });
    expect((p['errorDeListado'] as () => unknown)()).not.toBeNull();
    expect((p['paginaDePedidos'] as () => unknown)()).toBeNull();
  });

  it('aprueba con la versión leída, avisa, refresca contadores y relee', async () => {
    const fixture = await abrir([pedido(1)]);
    const p = pag(fixture);
    llamar(p, 'ver', pedido(1));
    llamar(p, 'aprobar');
    // Mientras va, un segundo clic no manda nada.
    llamar(p, 'aprobar');

    const aprobar = httpMock.expectOne(`${LISTADO}/1/aprobar`);
    expect(aprobar.request.body).toEqual({ version: 2 });
    aprobar.flush(pedido(1, 'APROBADO'));
    httpMock.expectOne((r) => r.url === LISTADO).flush(pagina([]));
    await estabilizar(fixture);

    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toBe('Pedido respondido');
    expect(aviso?.descripcion).toContain('Centro Sintético 1');
    expect(refrescar).toHaveBeenCalledOnce();
    expect((p['seleccionado'] as () => unknown)()).toBeNull();
  });

  it('sin pedido abierto, aprobar y rechazar no hacen nada', async () => {
    const p = pag(await abrir([]));
    llamar(p, 'aprobar');
    llamar(p, 'rechazar', 'motivo');
    llamar(p, 'ver', pedido(1, 'PENDIENTE', { version: undefined }));
    llamar(p, 'aprobar');
    httpMock.expectNone((r) => r.url.includes('/aprobar') || r.url.includes('/rechazar'));
  });

  it('rechaza con motivo y versión; sin nombre de centro usa "el centro"', async () => {
    const fixture = await abrir([]);
    const p = pag(fixture);
    llamar(p, 'ver', pedido(3, 'PENDIENTE', { organizationNombre: undefined }));
    llamar(p, 'rechazar', 'Falta el pago');

    const rechazo = httpMock.expectOne(`${LISTADO}/3/rechazar`);
    expect(rechazo.request.body).toEqual({ motivo: 'Falta el pago', version: 2 });
    rechazo.flush(pedido(3, 'RECHAZADO'));
    httpMock.expectOne((r) => r.url === LISTADO).flush(pagina([]));
    await estabilizar(fixture);

    expect(TestBed.inject(AvisosStore).avisos()[0]?.descripcion).toContain('el centro');
  });

  it('aprobar con el centro pasado de topes lo explica y relee manteniendo el pedido abierto', async () => {
    const fixture = await abrir([pedido(1)]);
    const p = pag(fixture);
    llamar(p, 'ver', pedido(1));
    llamar(p, 'aprobar');

    httpMock.expectOne(`${LISTADO}/1/aprobar`).flush(
      {
        type: 'https://akine.app/problems/pedido-excede-limites',
        title: 'Supera topes',
        status: 409,
        excesos: [{ limitCode: 'MAX_CONSULTORIOS', tope: 1, uso: 3 }],
      },
      { status: 409, statusText: 'Conflict' },
    );
    const actualizado = pedido(1, 'PENDIENTE', {
      excesos: [{ limitCode: 'MAX_CONSULTORIOS', tope: 1, uso: 3 }],
    });
    httpMock.expectOne((r) => r.url === LISTADO).flush(pagina([actualizado]));
    await estabilizar(fixture);

    expect((p['errorAccion'] as () => string)()).toContain('más sedes o profesionales');
    expect((p['seleccionado'] as () => PedidoDeCambioDePlanResponse)().excesos).toHaveLength(1);
    expect((p['enviando'] as () => boolean)()).toBe(false);
  });

  it('si otra persona lo respondió antes, lo dice, cierra el rechazo y relee', async () => {
    const fixture = await abrir([pedido(1)]);
    const p = pag(fixture);
    llamar(p, 'ver', pedido(1));
    (p['rechazando'] as { set(v: boolean): void }).set(true);
    llamar(p, 'rechazar', 'Duplicado');

    httpMock.expectOne(`${LISTADO}/1/rechazar`).flush(
      {
        type: 'https://akine.app/problems/concurrent-modification',
        title: 'Conflicto',
        status: 409,
      },
      { status: 409, statusText: 'Conflict' },
    );
    // El pedido abierto ya no está en la página: se conserva el que se tenía.
    httpMock.expectOne((r) => r.url === LISTADO).flush(pagina([pedido(2)]));
    await estabilizar(fixture);

    expect((p['errorAccion'] as () => string | null)()).toBeTruthy();
    expect((p['rechazando'] as () => boolean)()).toBe(false);
    expect((p['seleccionado'] as () => PedidoDeCambioDePlanResponse)().id).toBe(1);
  });

  it('un error de validación se muestra sin releer la bandeja', async () => {
    const fixture = await abrir([pedido(1)]);
    const p = pag(fixture);
    llamar(p, 'ver', pedido(1));
    llamar(p, 'rechazar', 'x');

    httpMock.expectOne(`${LISTADO}/1/rechazar`).flush(
      {
        type: 'https://akine.app/problems/validation-error',
        title: 'Inválido',
        status: 400,
        detail: 'Indicá el motivo del rechazo',
      },
      { status: 400, statusText: 'Bad Request' },
    );
    httpMock.expectNone((r) => r.url === LISTADO);
    expect((p['errorAccion'] as () => string | null)()).toBeTruthy();

    llamar(p, 'cerrar');
    expect((p['seleccionado'] as () => unknown)()).toBeNull();
    expect((p['errorAccion'] as () => unknown)()).toBeNull();
  });

  async function abrir(pedidos: unknown[]): Promise<ComponentFixture<CambiosDePlanPage>> {
    const fixture = TestBed.createComponent(CambiosDePlanPage);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === LISTADO).flush(pagina(pedidos));
    await estabilizar(fixture);
    return fixture;
  }

  function pag(fixture: ComponentFixture<CambiosDePlanPage>): Pagina {
    return fixture.componentInstance as unknown as Pagina;
  }

  function llamar(p: Pagina, metodo: string, ...args: unknown[]): unknown {
    return (p[metodo] as (...a: unknown[]) => unknown).apply(p, args);
  }

  async function estabilizar(fixture: ComponentFixture<CambiosDePlanPage>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function texto(fixture: ComponentFixture<CambiosDePlanPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }
});
