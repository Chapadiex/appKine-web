import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { HonorariosPorClaseDeLaOfertaPage } from './honorarios-por-clase-de-la-oferta-page';
import { rutaOfertas } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const SEDE = 3;
const OFERTA = 31;
const HONORARIOS = `${rutaOfertas(SEDE)}/${OFERTA}/honorarios-por-clase`;

const PILATES = {
  id: OFERTA,
  nombreComercial: 'Pilates grupal',
  modalidad: 'GRUPAL',
  precioBase: 10000,
  moneda: 'ARS',
  estado: 'ACTIVO',
};

const VIGENTE = {
  id: 700,
  ofertaId: OFERTA,
  importePorParticipante: 1500,
  moneda: 'ARS',
  vigenciaDesde: '2026-01-01',
  estado: 'ACTIVO',
  vigente: true,
  version: 2,
};

const DADA_DE_BAJA = {
  ...VIGENTE,
  id: 701,
  importePorParticipante: 1200,
  vigenciaDesde: '2025-01-01',
  vigenciaHasta: '2025-12-31',
  estado: 'INACTIVO',
  vigente: false,
  deactivationReason: 'Tarifa mal cargada',
};

const FUTURA = {
  ...VIGENTE,
  id: 702,
  importePorParticipante: 1800,
  vigenciaDesde: '2099-01-01',
  vigente: false,
};

/**
 * Honorarios por clase de una oferta (DP-38, RF-M22-006, contrato 0.134.0).
 *
 * <p>Mismo patron que los precios particulares: lo que importa es que el importe no se edita —en el
 * PUT viajan solo el fin y la version— y que un solapamiento explica la salida concreta.
 */
describe('HonorariosPorClaseDeLaOfertaPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HonorariosPorClaseDeLaOfertaPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ ofertaId: String(OFERTA) }) } },
        },
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('lista las tarifas con su situación y solo la activa ofrece acciones', async () => {
    const fixture = await montar();
    const contenido = texto(fixture);
    expect(contenido).toContain('Pilates grupal');
    expect(contenido).toContain('ARS 1500');
    expect(contenido).toContain('Rige hoy');
    expect(contenido).toContain('Todavía no rige');
    expect(contenido).toContain('Dada de baja');
    expect(contenido).toContain('Tarifa mal cargada');
    expect(botones(fixture, 'Cambiar fin')).toHaveLength(2);
    // Pie estandar (UX-14).
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.paginacion-pie')?.textContent,
    ).toContain('Mostrando 1–3 de 3');
  });

  it('el alta manda importe, moneda propuesta y vigencia; el solapamiento explica la salida', async () => {
    const fixture = await montar();
    botones(fixture, 'Cargar una tarifa')[0].click();
    fixture.detectChanges();

    escribir(fixture, '#alta-honorario-importe', '1750');
    escribir(fixture, '#alta-honorario-desde', '2026-11-01');
    escribir(fixture, '#alta-honorario-hasta', '2026-12-31');
    enviar(fixture);

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === HONORARIOS,
    );
    expect(alta.request.body).toEqual({
      importePorParticipante: 1750,
      moneda: 'ARS',
      vigenciaDesde: '2026-11-01',
      vigenciaHasta: '2026-12-31',
    });
    alta.flush(
      { type: 'https://akine.app/problems/honorario-de-clase-solapado', status: 409, detail: 'x' },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('cerrale la vigencia a la actual el día anterior');
    // UX-12: el choque va pegado a las fechas que lo producen.
    const alerta = (fixture.nativeElement as HTMLElement).querySelector('#alta-honorario-solapado');
    expect(alerta?.textContent).toContain('cerrale la vigencia a la actual el día anterior');
  });

  it('sin precio de lista propone ARS, la moneda vacía no se manda, y el alta relee la grilla', async () => {
    const fixture = await montar({ id: OFERTA, nombreComercial: 'Yoga', estado: 'ACTIVO' });
    botones(fixture, 'Cargar una tarifa')[0].click();
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
        '#alta-honorario-moneda',
      )!.value,
    ).toBe('ARS');
    escribir(fixture, '#alta-honorario-importe', '900');
    escribir(fixture, '#alta-honorario-desde', '2026-11-01');
    escribir(fixture, '#alta-honorario-moneda', '');
    enviar(fixture);
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect(texto(fixture)).toContain('La moneda es obligatoria');
    escribir(fixture, '#alta-honorario-moneda', 'usd');
    enviar(fixture);
    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === HONORARIOS,
    );
    expect(alta.request.body).toEqual({
      importePorParticipante: 900,
      moneda: 'USD',
      vigenciaDesde: '2026-11-01',
    });
    alta.flush({ ...VIGENTE, id: 900 });
    responderCarga({ id: OFERTA, nombreComercial: 'Yoga', estado: 'ACTIVO' });
    await estabilizar(fixture);
    expect(
      TestBed.inject(AvisosStore)
        .avisos()
        .map((aviso) => aviso.titulo),
    ).toEqual(['Tarifa cargada']);
  });

  it('el importe vacío o cero no manda nada', async () => {
    const fixture = await montar();
    botones(fixture, 'Cargar una tarifa')[0].click();
    fixture.detectChanges();
    enviar(fixture);
    expect(texto(fixture)).toContain('Un importe mayor que cero.');

    escribir(fixture, '#alta-honorario-importe', '0');
    enviar(fixture);
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect(texto(fixture)).toContain('Un importe mayor que cero.');

    botones(fixture, 'Cancelar')[0].click();
    fixture.detectChanges();
    expect(texto(fixture)).not.toContain('Nueva tarifa de honorario');
  });

  it('cambiar el fin manda solo el fin y la versión; vacío reabre', async () => {
    const fixture = await montar();
    botones(fixture, 'Cambiar fin')[1].click();
    fixture.detectChanges();

    escribir(fixture, '#fin-honorario-hasta', '2026-10-31');
    enviar(fixture, 'app-panel-lateral form');
    const cierre = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PUT' && peticion.url === `${HONORARIOS}/700`,
    );
    expect(cierre.request.body).toEqual({ expectedVersion: 2, vigenciaHasta: '2026-10-31' });
    cierre.flush({ ...VIGENTE, vigenciaHasta: '2026-10-31', version: 3 });
    responderCarga(PILATES);
    await estabilizar(fixture);
    expect(TestBed.inject(AvisosStore).avisos()[0]?.titulo).toBe(
      'Tarifa vigente hasta el 31 de octubre de 2026',
    );

    botones(fixture, 'Cambiar fin')[1].click();
    fixture.detectChanges();
    escribir(fixture, '#fin-honorario-hasta', '');
    enviar(fixture, 'app-panel-lateral form');
    const reapertura = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'PUT',
    );
    expect(reapertura.request.body).toEqual({ expectedVersion: 2 });
    reapertura.flush(VIGENTE);
    responderCarga(PILATES);
    await estabilizar(fixture);
    expect(TestBed.inject(AvisosStore).avisos()[1]?.titulo).toBe('Tarifa sin fin previsto');
  });

  it('un 409 de versión relee la grilla y deja el panel abierto', async () => {
    const fixture = await montar();
    botones(fixture, 'Cambiar fin')[1].click();
    fixture.detectChanges();
    escribir(fixture, '#fin-honorario-hasta', '2026-10-31');
    enviar(fixture, 'app-panel-lateral form');
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'PUT')
      .flush(
        { type: 'https://akine.app/problems/concurrent-modification', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'GET' && peticion.url === HONORARIOS,
      )
      .flush([{ ...VIGENTE, version: 9 }]);
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Alguien mas modifico esto');

    enviar(fixture, 'app-panel-lateral form');
    const reintento = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'PUT',
    );
    expect(reintento.request.body).toEqual({ expectedVersion: 9, vigenciaHasta: '2026-10-31' });
    reintento.flush(VIGENTE);
    responderCarga(PILATES);
    await estabilizar(fixture);
  });

  it('la baja manda el motivo; una tarifa ya inactiva ofrece recargar', async () => {
    const fixture = await montar();
    botones(fixture, 'Dar de baja')[1].click();
    fixture.detectChanges();

    escribir(fixture, '#baja-honorario-motivo', 'Mal cargada');
    enviar(fixture, 'app-panel-lateral form');
    const baja = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'DELETE' && peticion.url === `${HONORARIOS}/700`,
    );
    expect(baja.request.body).toEqual({ reason: 'Mal cargada' });
    baja.flush(
      { type: 'https://akine.app/problems/honorario-de-clase-inactivo', status: 409 },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Esa tarifa ya esta dada de baja');
    botones(fixture, 'Recargar la grilla')[0].click();
    responderCarga(PILATES);
    await estabilizar(fixture);

    botones(fixture, 'Dar de baja')[1].click();
    fixture.detectChanges();
    escribir(fixture, '#baja-honorario-motivo', 'Mal cargada');
    enviar(fixture, 'app-panel-lateral form');
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'DELETE')
      .flush(null, { status: 204, statusText: 'No Content' });
    responderCarga(PILATES);
    await estabilizar(fixture);
    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toBe('Tarifa dada de baja');
    expect(aviso?.descripcion).toContain('no entran en ninguna liquidación hasta que cargues otra');
  });

  it('sin consultorio:manage muestra el 403 del backend con reintento', async () => {
    seleccionarSede();
    const fixture = TestBed.createComponent(HonorariosPorClaseDeLaOfertaPage);
    fixture.detectChanges();
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'GET' && peticion.url === HONORARIOS,
      )
      .flush({ status: 403, title: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });
    httpMock.expectOne((p: HttpRequest<unknown>) => p.url === rutaOfertas(SEDE)).flush([PILATES]);
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('hace falta administrarla');
    expect(botones(fixture, 'Reintentar')).toHaveLength(1);
  });

  it('sin oferta en el listado y sin tarifas lo dice', async () => {
    seleccionarSede();
    const fixture = TestBed.createComponent(HonorariosPorClaseDeLaOfertaPage);
    fixture.detectChanges();
    httpMock.expectOne(HONORARIOS).flush([]);
    httpMock.expectOne((p: HttpRequest<unknown>) => p.url === rutaOfertas(SEDE)).flush([]);
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('sus clases no entran en ninguna liquidación');
    const vacio = (fixture.nativeElement as HTMLElement).querySelector('app-estado-vacio');
    expect(vacio?.textContent).toContain('Cargar la primera tarifa');
    expect(texto(fixture)).toContain('de esta oferta por cada participante');
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  function seleccionarSede(): void {
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });
  }

  async function montar(
    oferta: Record<string, unknown> = PILATES,
  ): Promise<ComponentFixture<HonorariosPorClaseDeLaOfertaPage>> {
    seleccionarSede();
    const fixture = TestBed.createComponent(HonorariosPorClaseDeLaOfertaPage);
    fixture.detectChanges();
    responderCarga(oferta);
    await estabilizar(fixture);
    return fixture;
  }

  function responderCarga(oferta: Record<string, unknown>): void {
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'GET' && peticion.url === HONORARIOS,
      )
      .flush([DADA_DE_BAJA, VIGENTE, FUTURA]);
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaOfertas(SEDE))
      .flush([oferta]);
  }
});

async function estabilizar(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

function texto(fixture: ComponentFixture<unknown>): string {
  return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
}

function botones(fixture: ComponentFixture<unknown>, etiqueta: string): HTMLButtonElement[] {
  return [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].filter(
    (boton) => (boton.textContent ?? '').trim() === etiqueta,
  );
}

function escribir(fixture: ComponentFixture<unknown>, selector: string, valor: string): void {
  const campo = (fixture.nativeElement as HTMLElement).querySelector(selector) as
    HTMLInputElement | HTMLTextAreaElement | null;
  if (campo === null) {
    throw new Error(`No existe el campo ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function enviar(fixture: ComponentFixture<unknown>, selector = 'form[novalidate]'): void {
  const formulario = (fixture.nativeElement as HTMLElement).querySelector(selector);
  if (formulario === null) {
    throw new Error(`No existe el formulario ${selector}`);
  }
  formulario.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}
