import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { SugerenciasDeEvolucion } from './sugerencias-de-evolucion';
import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';

const RUTA = '/api/v1/consultorios/3/casos/9/evolucion/sugerencias';
const RUTA_PLAN = '/historia-clinica/personas/4/casos/9/plan';

const sugerencia = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  generacionId: 'g-1',
  hallazgo: 'DOLOR_SIN_MEJORA',
  sesiones: [11, 12],
  texto: 'Revisar la progresión de la carga del ejercicio terapéutico.',
  fundamento: 'El dolor no bajó en cuatro sesiones y el pasaje describe la progresión.',
  citas: [{ libroId: 1, titulo: 'Kinesiología del dolor', paginaDesde: 112, paginaHasta: 113 }],
  respuesta: 'PENDIENTE',
  solicitadaEn: '2026-11-15T13:00:00Z',
  version: 0,
  ...extra,
});

/** M31 fase 2: sugerencias para revisar, ligadas a un hallazgo y a un pasaje de la biblioteca. */
describe('SugerenciasDeEvolucion', () => {
  let httpMock: HttpTestingController;
  let permisos: Set<string>;

  beforeEach(async () => {
    permisos = new Set(['evolucion:sugerir', 'hc:write']);
    await TestBed.configureTestingModule({
      imports: [SugerenciasDeEvolucion],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
        { provide: PermissionsStore, useValue: { tiene: (p: string) => permisos.has(p) } },
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro',
      consultorioId: 3,
      consultorioName: 'Sede',
    });
  });

  afterEach(() => httpMock.verify());

  it('con el historial vacío invita a pedir y no muestra historial', async () => {
    const fixture = await montar({ plan: null });
    const pedido = historial();
    expect(pedido.request.headers.get('X-Justificacion-Acceso')).toBe('Motivo declarado');
    pedido.flush({ content: [] });
    await estabilizar(fixture);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="sugerencias-vacio"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="sugerencias-historial"]')).toBeNull();
    expect(el.querySelector('[data-testid="pedir-sugerencias"]')).not.toBeNull();
  });

  it('pide sugerencias y muestra el hallazgo, el fundamento, la fuente y las advertencias', async () => {
    const fixture = await montar({ plan: null });
    historial().flush({
      content: [sugerencia(1, { generacionId: 'g-0', respuesta: 'ACEPTADA' })],
    });
    await estabilizar(fixture);

    boton(fixture, 'pedir-sugerencias').click();
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('puede tardar hasta un minuto');

    httpMock
      .expectOne((r) => r.method === 'POST' && r.url === RUTA)
      .flush({
        generacionId: 'g-1',
        resultado: 'SUGERENCIAS',
        sugerencias: [sugerencia(2)],
        descartadas: 1,
        advertencias: ['TEXTO_OMITIDO'],
      });
    historial().flush({
      content: [sugerencia(2), sugerencia(1, { generacionId: 'g-0', respuesta: 'ACEPTADA' })],
    });
    await estabilizar(fixture);

    const el = fixture.nativeElement as HTMLElement;
    const items = el.querySelectorAll('.sugerencia');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('Dolor sin mejora');
    expect(items[0].querySelectorAll('a')).toHaveLength(2);
    expect(items[0].querySelector('details summary')?.textContent).toContain('Fundamento');
    expect(items[0].textContent).toContain('«Kinesiología del dolor», págs. 112–113');
    expect(texto(fixture)).toContain('parecía contener instrucciones');
    expect(texto(fixture)).toContain('1 propuesta no pasó');
    expect(el.querySelector('[data-testid="sugerencias-historial"]')?.textContent).toContain(
      'Historial (1 pedido anterior)',
    );
    expect(texto(fixture)).not.toContain('puede tardar');
  });

  it('SIN_MATERIAL lo dice y no muestra sugerencias vacías', async () => {
    const fixture = await montar({ plan: null });
    historial().flush({ content: [] });
    await estabilizar(fixture);

    boton(fixture, 'pedir-sugerencias').click();
    httpMock
      .expectOne((r) => r.method === 'POST' && r.url === RUTA)
      .flush({
        generacionId: 'g-1',
        resultado: 'SIN_MATERIAL',
        sugerencias: [],
        descartadas: 0,
        advertencias: [],
      });
    historial().flush({ content: [] });
    await estabilizar(fixture);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="sugerencias-sin-material"]')?.textContent).toContain(
      'La biblioteca no tiene material suficiente para estos hallazgos.',
    );
    expect(el.querySelector('.sugerencia')).toBeNull();
  });

  it('con un plan activo, aceptar registra ACEPTADA y navega al plan con el motivo', async () => {
    const fixture = await montar({ plan: { estado: 'ACTIVO' } });
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    historial().flush({ content: [sugerencia(1)] });
    await estabilizar(fixture);

    const aceptar = boton(fixture, 'aceptar-sugerencia');
    expect(aceptar.textContent).toContain('Usar en nueva versión del plan');
    aceptar.click();
    const respuesta = httpMock.expectOne(`${RUTA}/1/respuesta`);
    expect(respuesta.request.body).toEqual({ respuesta: 'ACEPTADA', version: 0 });
    respuesta.flush(sugerencia(1, { respuesta: 'ACEPTADA', version: 1 }));
    await estabilizar(fixture);

    expect(navegar).toHaveBeenCalledWith(RUTA_PLAN, {
      state: { motivoModificacion: 'Revisar la progresión de la carga del ejercicio terapéutico.' },
    });
  });

  it('sin plan vivo, "Marcar como útil" registra ACEPTADA y no navega', async () => {
    const fixture = await montar({ plan: { estado: 'FINALIZADO' } });
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    historial().flush({ content: [sugerencia(1)] });
    await estabilizar(fixture);

    const aceptar = boton(fixture, 'aceptar-sugerencia');
    expect(aceptar.textContent).toContain('Marcar como útil');
    aceptar.click();
    httpMock
      .expectOne(`${RUTA}/1/respuesta`)
      .flush(sugerencia(1, { respuesta: 'ACEPTADA', version: 1 }));
    await estabilizar(fixture);

    expect(navegar).not.toHaveBeenCalled();
    expect(texto(fixture)).toContain('Aceptada');
  });

  it('descartar exige un motivo: sin él el botón queda deshabilitado', async () => {
    const fixture = await montar({ plan: null });
    historial().flush({ content: [sugerencia(1)] });
    await estabilizar(fixture);

    boton(fixture, 'descartar-sugerencia').click();
    await estabilizar(fixture);
    const confirmar = boton(fixture, 'confirmar-descarte') as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);

    boton(fixture, 'descarte-otro').click();
    await estabilizar(fixture);
    expect(confirmar.disabled).toBe(true); // "Otro motivo" sin texto no alcanza

    const campo = (fixture.nativeElement as HTMLElement).querySelector(
      '#descarte-texto',
    ) as HTMLTextAreaElement;
    campo.value = 'El paciente ya cambió de ejercicio';
    campo.dispatchEvent(new Event('input'));
    await estabilizar(fixture);
    expect(confirmar.disabled).toBe(false);

    confirmar.click();
    const respuesta = httpMock.expectOne(`${RUTA}/1/respuesta`);
    expect(respuesta.request.body).toEqual({
      respuesta: 'DESCARTADA',
      motivo: 'El paciente ya cambió de ejercicio',
      version: 0,
    });
    respuesta.flush(sugerencia(1, { respuesta: 'DESCARTADA', motivoDescarte: 'Ya' }));
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Descartada');
  });

  it('con la función apagada (404) la sección no se ve', async () => {
    const fixture = await montar({ plan: null });
    historial().flush({ status: 404 }, { status: 404, statusText: 'N' });
    await estabilizar(fixture);

    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="sugerencias-de-evolucion"]',
      ),
    ).toBeNull();
  });

  it('sin evolucion:sugerir no pide el historial ni muestra la sección', async () => {
    permisos.delete('evolucion:sugerir');
    const fixture = await montar({ plan: null });
    httpMock.expectNone(RUTA);
    expect(texto(fixture)).not.toContain('Sugerencias para revisar');
  });

  it('el modelo ocupado muestra el texto del problema y deja reintentar', async () => {
    const fixture = await montar({ plan: null });
    historial().flush({ content: [] });
    await estabilizar(fixture);

    boton(fixture, 'pedir-sugerencias').click();
    httpMock
      .expectOne((r) => r.method === 'POST' && r.url === RUTA)
      .flush(
        {
          type: 'https://akine.app/problems/modelo-ocupado',
          status: 503,
          detail: 'El modelo está atendiendo otro pedido.',
        },
        { status: 503, statusText: 'S' },
      );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('El modelo está atendiendo otro pedido.');

    const reintentar = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
      (b) => b.textContent?.includes('Reintentar'),
    );
    reintentar?.click();
    httpMock
      .expectOne((r) => r.method === 'POST' && r.url === RUTA)
      .flush({
        generacionId: 'g-1',
        resultado: 'SIN_HALLAZGOS_ELEGIBLES',
        sugerencias: [],
      });
    historial().flush({ content: [] });
    await estabilizar(fixture);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="sugerencias-sin-hallazgos"]',
      ),
    ).not.toBeNull();
  });

  it('una sugerencia ya respondida por otra persona avisa y relee el historial', async () => {
    const fixture = await montar({ plan: null });
    historial().flush({
      content: [
        sugerencia(1, {
          citas: [{ titulo: 'Manual', paginaDesde: 5, paginaHasta: 5 }, { paginaDesde: undefined }],
        }),
      ],
    });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('«Manual», pág. 5');
    expect(texto(fixture)).toContain('«Libro sin título»');

    boton(fixture, 'aceptar-sugerencia').click();
    httpMock.expectOne(`${RUTA}/1/respuesta`).flush(
      {
        type: 'https://akine.app/problems/sugerencia-ya-respondida',
        status: 409,
        detail: 'Otra persona ya respondió esta sugerencia.',
      },
      { status: 409, statusText: 'C' },
    );
    historial().flush({ content: [sugerencia(1, { respuesta: 'DESCARTADA' })] });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Otra persona ya respondió esta sugerencia.');
  });

  it('un error al leer el historial lo muestra sin esconder la sección', async () => {
    const fixture = await montar({ plan: null });
    historial().flush({ status: 500 }, { status: 500, statusText: 'E' });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('No pudimos leer las sugerencias');
  });

  function historial() {
    return httpMock.expectOne((r) => r.method === 'GET' && r.url === RUTA);
  }

  function boton(fixture: ComponentFixture<SugerenciasDeEvolucion>, id: string): HTMLElement {
    const el = (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);
    if (!(el instanceof HTMLElement)) throw new Error(`Falta ${id}`);
    return el;
  }

  function texto(fixture: ComponentFixture<SugerenciasDeEvolucion>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  async function montar(inputs: {
    plan: { estado: string } | null;
  }): Promise<ComponentFixture<SugerenciasDeEvolucion>> {
    const fixture = TestBed.createComponent(SugerenciasDeEvolucion);
    fixture.componentRef.setInput('casoId', 9);
    fixture.componentRef.setInput('justificacion', 'Motivo declarado');
    fixture.componentRef.setInput('plan', inputs.plan);
    fixture.componentRef.setInput('rutaPlan', RUTA_PLAN);
    await estabilizar(fixture);
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<SugerenciasDeEvolucion>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
});
