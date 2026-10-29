import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { PreciosParticularesDeLaOfertaPage } from './precios-particulares-de-la-oferta-page';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS, rutaOfertas } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const SEDE = 3;
const OFERTA = 31;
const PRECIOS = `${rutaOfertas(SEDE)}/${OFERTA}/precios-particulares`;

const PILATES = {
  id: OFERTA,
  nombreComercial: 'Pilates terapeutico',
  precioBase: 10000,
  moneda: 'ARS',
  estado: 'ACTIVO',
};

const VIGENTE = {
  id: 500,
  ofertaId: OFERTA,
  importe: 12000,
  moneda: 'ARS',
  vigenciaDesde: '2026-01-01',
  estado: 'ACTIVO',
  vigente: true,
  version: 4,
};

const DADO_DE_BAJA = {
  ...VIGENTE,
  id: 501,
  importe: 11000,
  vigenciaDesde: '2025-01-01',
  vigenciaHasta: '2025-12-31',
  estado: 'INACTIVO',
  vigente: false,
  deactivationReason: 'Carga duplicada',
};

/**
 * Precios particulares por vigencia (RF-M16-009, AKINE B-3).
 *
 * <p>Lo que importa probar es lo que la pantalla NO deja hacer: el importe no se edita —lo unico
 * que viaja en el PUT es el fin y la version— y un solapamiento se explica con la salida concreta.
 */
describe('PreciosParticularesDeLaOfertaPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PreciosParticularesDeLaOfertaPage],
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

  it('lista los precios con su situación y el precio de lista de la oferta', async () => {
    const fixture = await montar();
    const contenido = texto(fixture);

    expect(contenido).toContain('Pilates terapeutico');
    expect(contenido).toContain('ARS 10000');
    expect(contenido).toContain('Rige hoy');
    expect(contenido).toContain('Dado de baja');
    expect(contenido).toContain('Carga duplicada');
    // La fila dada de baja no ofrece acciones: solo la activa tiene "Cambiar fin".
    expect(botones(fixture, 'Cambiar fin')).toHaveLength(1);
  });

  it('el alta manda importe, moneda y vigencia, y el solapamiento explica como subir un precio', async () => {
    const fixture = await montar();
    botones(fixture, 'Cargar un precio')[0].click();
    fixture.detectChanges();

    escribir(fixture, '#alta-precio-importe', '13500');
    escribir(fixture, '#alta-precio-desde', '2026-11-01');
    enviar(fixture);

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === PRECIOS,
    );
    // La moneda se propone desde el precio de lista de la oferta.
    expect(alta.request.body).toEqual({
      importe: 13500,
      moneda: 'ARS',
      vigenciaDesde: '2026-11-01',
    });
    alta.flush(
      { type: 'https://akine.app/problems/precio-particular-solapado', status: 409, detail: 'x' },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('cerrale la vigencia al actual el día anterior');
    // UX-12: el choque va pegado a las fechas que lo producen, no como error general.
    const host = fixture.nativeElement as HTMLElement;
    const alerta = host.querySelector('#alta-precio-solapado');
    expect(alerta?.getAttribute('role')).toBe('alert');
    expect(alerta?.textContent).toContain('cerrale la vigencia al actual el día anterior');
    expect(host.querySelector('#alta-precio-desde')?.getAttribute('aria-describedby')).toBe(
      'alta-precio-solapado',
    );
    expect(host.querySelector('#alta-precio-hasta')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('sin precio de lista la moneda es obligatoria y viaja la que se escribe', async () => {
    // El backend rechaza con 400 un precio sin moneda cuando la oferta no tiene de donde
    // heredarla: antes la pantalla no tenia el campo y esa oferta no admitia ningun precio
    // (encontrado por el E2E de servicios contra el backend real).
    const fixture = await montar({ id: OFERTA, nombreComercial: 'Drenaje', estado: 'ACTIVO' });
    botones(fixture, 'Cargar un precio')[0].click();
    fixture.detectChanges();

    escribir(fixture, '#alta-precio-importe', '9000');
    escribir(fixture, '#alta-precio-desde', '2026-11-01');
    enviar(fixture);
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect(texto(fixture)).toContain('La moneda es obligatoria');

    escribir(fixture, '#alta-precio-moneda', 'usd');
    enviar(fixture);
    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === PRECIOS,
    );
    expect(alta.request.body).toEqual({
      importe: 9000,
      moneda: 'USD',
      vigenciaDesde: '2026-11-01',
    });
    alta.flush({ id: 900, importe: 9000, moneda: 'USD', vigenciaDesde: '2026-11-01' });
    responderCarga({ id: OFERTA, nombreComercial: 'Drenaje', estado: 'ACTIVO' });
    await estabilizar(fixture);
    expect(
      TestBed.inject(AvisosStore)
        .avisos()
        .map((aviso) => aviso.titulo),
    ).toEqual(['Precio cargado']);
  });

  it('el alta con el importe vacío no manda nada', async () => {
    const fixture = await montar();
    botones(fixture, 'Cargar un precio')[0].click();
    fixture.detectChanges();
    enviar(fixture);

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect(texto(fixture)).toContain('El importe es obligatorio');
  });

  it('cambiar el fin manda solo el fin y la versión; vacío reabre la vigencia', async () => {
    const fixture = await montar();
    botones(fixture, 'Cambiar fin')[0].click();
    fixture.detectChanges();

    escribir(fixture, '#fin-precio-hasta', '2026-10-31');
    enviar(fixture, 'app-panel-lateral form');
    const cierre = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PUT' && peticion.url === `${PRECIOS}/500`,
    );
    // Ni el importe ni el inicio: no son editables.
    expect(cierre.request.body).toEqual({ expectedVersion: 4, vigenciaHasta: '2026-10-31' });
    cierre.flush({ ...VIGENTE, vigenciaHasta: '2026-10-31', version: 5 });
    responderCarga(PILATES);
    await estabilizar(fixture);

    botones(fixture, 'Cambiar fin')[0].click();
    fixture.detectChanges();
    escribir(fixture, '#fin-precio-hasta', '');
    enviar(fixture, 'app-panel-lateral form');
    const reapertura = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'PUT',
    );
    expect(reapertura.request.body).toEqual({ expectedVersion: 4 });
    reapertura.flush(VIGENTE);
    responderCarga(PILATES);
    await estabilizar(fixture);
    expect(
      TestBed.inject(AvisosStore)
        .avisos()
        .map((aviso) => aviso.titulo),
    ).toEqual(['Precio vigente hasta el 31 de octubre de 2026', 'Precio sin fin previsto']);
  });

  it('la baja manda el motivo', async () => {
    const fixture = await montar();
    botones(fixture, 'Dar de baja')[0].click();
    fixture.detectChanges();

    escribir(fixture, '#baja-precio-motivo', 'Mal cargado');
    enviar(fixture, 'app-panel-lateral form');
    const baja = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'DELETE' && peticion.url === `${PRECIOS}/500`,
    );
    expect(baja.request.body).toEqual({ reason: 'Mal cargado' });
    baja.flush(null, { status: 204, statusText: 'No Content' });
    responderCarga(PILATES);
    await estabilizar(fixture);
    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toBe('Precio dado de baja');
    expect(aviso?.descripcion).toContain('vuelve a regir el precio de lista');
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  async function montar(
    oferta: Record<string, unknown> = PILATES,
  ): Promise<ComponentFixture<PreciosParticularesDeLaOfertaPage>> {
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });
    TestBed.inject(PermissionsStore).cargar().subscribe();
    httpMock
      .expectOne(RUTA_PERMISOS_EFECTIVOS)
      .flush({ permissions: [PERMISO_CONSULTORIO_MANAGE] });

    const fixture = TestBed.createComponent(PreciosParticularesDeLaOfertaPage);
    fixture.detectChanges();
    responderCarga(oferta);
    await estabilizar(fixture);
    return fixture;
  }

  function responderCarga(oferta: Record<string, unknown>): void {
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) => peticion.method === 'GET' && peticion.url === PRECIOS,
      )
      .flush([DADO_DE_BAJA, VIGENTE]);
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
