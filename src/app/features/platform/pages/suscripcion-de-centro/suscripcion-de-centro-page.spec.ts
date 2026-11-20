import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { SuscripcionDeCentroPage } from './suscripcion-de-centro-page';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';

const PLANES = '/api/v1/plans';
const LISTADO = '/api/v1/platform/organizations';
const LECTURA = '/api/v1/platform/organizations/4/contratacion';

const contratacion = (version: number, estado = 'ACTIVA', extra: Record<string, unknown> = {}) => ({
  planCode: 'BASE',
  planNombre: 'Plan Básico',
  maxSedes: 1,
  servicios: ['KINESIOLOGIA'],
  adicionales: [],
  estado,
  soloLectura: false,
  version,
  ...extra,
});

const centro = (id: number, name: string, status = 'ACTIVA') => ({
  id,
  name,
  slug: name.toLowerCase().replace(/ /g, '-'),
  status,
  planCode: 'BASE',
  planName: 'Plan Básico',
  createdAt: '2026-10-01T15:00:00Z',
});

const pagina = (content: unknown[], page = 0, totalPages = 1, totalElements = content.length) => ({
  content,
  page,
  size: 20,
  totalPages,
  totalElements,
});

const KINESIO_NORTE = centro(4, 'Kinesio Norte');

/**
 * La suscripcion de un centro desde la consola (D3, `appKine-api` #133). Lo que importa: que la
 * version del cambio de plan salga de la lectura de plataforma —no del GET del tenant, que sin
 * soporte es 403— y que una version vieja relea en vez de dejar al operador sin salida.
 */
describe('SuscripcionDeCentroPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SuscripcionDeCentroPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('lee la contratación de plataforma y la cambia con esa versión, solo con planes ofrecidos', async () => {
    const fixture = await buscar();
    httpMock.expectNone('/api/v1/organizations/4/subscription');
    httpMock.expectOne(LECTURA).flush(contratacion(7));
    await estabilizar(fixture);
    expect(texto(fixture, '[data-testid="suscripcion-version"]')).toBe('7');
    expect(texto(fixture, '[data-testid="suscripcion-estado"]')).toBe('Activa');
    const opciones = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('#suscripcion-plan-nuevo option'),
    ].map((o) => (o as HTMLOptionElement).value);
    expect(opciones).toEqual(['BASE', 'CRECIMIENTO']);

    elegir(fixture, '#suscripcion-plan-nuevo', 'CRECIMIENTO');
    marcarServicio(fixture, 1);
    enviar(fixture, 1);
    const cambio = httpMock.expectOne(LECTURA);
    expect(cambio.request.method).toBe('PUT');
    expect(cambio.request.body).toEqual({
      planCode: 'CRECIMIENTO',
      servicios: ['KINESIOLOGIA', 'ACTIVIDADES'],
      adicionales: [],
      contratar: false,
      version: 7,
    });
    cambio.flush(
      contratacion(8, 'ACTIVA', {
        planCode: 'CRECIMIENTO',
        planNombre: 'Plan Intermedio',
        servicios: ['ACTIVIDADES', 'KINESIOLOGIA'],
      }),
    );
    httpMock.expectOne((r) => r.url === LISTADO).flush(pagina([KINESIO_NORTE]));
    await estabilizar(fixture);

    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toBe('Contratación guardada');
    expect(texto(fixture, '[data-testid="suscripcion-version"]')).toBe('8');
  });

  it('en prueba muestra los días que quedan y pasa a contrato con contratar: true', async () => {
    const fixture = await buscar();
    const enDiez = new Date(Date.now() + 9.5 * 24 * 60 * 60 * 1000).toISOString();
    httpMock.expectOne(LECTURA).flush(contratacion(2, 'PRUEBA', { pruebaHasta: enDiez }));
    await estabilizar(fixture);
    expect(texto(fixture, '[data-testid="suscripcion-estado"]')).toBe('En prueba');
    expect(texto(fixture, '[data-testid="suscripcion-prueba"]')).toContain('Quedan 10 días');

    (
      fixture.nativeElement.querySelector('[data-testid="pasar-a-contrato"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const cambio = httpMock.expectOne(LECTURA);
    expect(cambio.request.body).toEqual(
      expect.objectContaining({ planCode: 'BASE', contratar: true, version: 2 }),
    );
    cambio.flush(contratacion(3));
    httpMock.expectOne((r) => r.url === LISTADO).flush(pagina([KINESIO_NORTE]));
    await estabilizar(fixture);
    expect(TestBed.inject(AvisosStore).avisos()[0]?.titulo).toBe('Pasó a contrato');
  });

  it('una prueba vencida se rotula aparte y sigue pudiendo pasar a contrato', async () => {
    const fixture = await buscar();
    httpMock
      .expectOne(LECTURA)
      .flush(contratacion(2, 'PRUEBA', { pruebaHasta: '2026-01-01T00:00:00Z', soloLectura: true }));
    await estabilizar(fixture);
    expect(texto(fixture, '[data-testid="suscripcion-estado"]')).toBe('Prueba vencida');
    expect(texto(fixture, '[data-testid="suscripcion-prueba"]')).toContain('solo lectura');
    expect(fixture.nativeElement.querySelector('[data-testid="pasar-a-contrato"]')).not.toBeNull();
  });

  it('una versión vieja no aplica nada, lo dice y relee la contratación', async () => {
    const fixture = await buscar();
    httpMock.expectOne(LECTURA).flush(contratacion(7));
    await estabilizar(fixture);

    elegir(fixture, '#suscripcion-plan-nuevo', 'CRECIMIENTO');
    enviar(fixture, 1);
    httpMock
      .expectOne((r) => r.url === LECTURA && r.method === 'PUT')
      .flush(
        { type: 'https://akine.app/problems/concurrent-modification', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    httpMock.expectOne((r) => r.url === LECTURA && r.method === 'GET').flush(contratacion(9));
    await estabilizar(fixture);

    // Con el panel abierto, el rechazo va arriba del formulario.
    expect(texto(fixture, 'form app-alerta')).toContain('No se aplicó nada');
    expect(texto(fixture, '[data-testid="suscripcion-version"]')).toBe('9');
  });

  it('con la suscripción suspendida no ofrece cambiar la contratación', async () => {
    const fixture = await buscar();
    httpMock.expectOne(LECTURA).flush(contratacion(2, 'SUSPENDIDA', { soloLectura: true }));
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('la contratación solo se cambia con la suscripción activa');
    expect(fixture.nativeElement.querySelector('#suscripcion-plan-nuevo')).toBeNull();
  });

  it('lista los centros al entrar y los elige por nombre, no por número', async () => {
    const fixture = await abrir();
    expect(texto(fixture, 'table')).toContain('Kinesio Norte');
    expect(texto(fixture, 'table')).toContain('kinesio-norte');
    expect(texto(fixture, 'table')).toContain('01/10/2026');
    expect(fixture.nativeElement.querySelector('#suscripcion-organizacion')).toBeNull();
    // Insignia del plan y la IA: sin IA, la celda solo lo dice al lector.
    expect(texto(fixture, 'tbody .marca-plan__sigla')).toBe('PB');
    expect(fixture.nativeElement.querySelector('tbody .marca-plan').dataset.globo).toBe(
      'Plan Básico',
    );
    expect(fixture.nativeElement.querySelector('tbody .marca-plan--base')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('tbody .marca-ia')).toBeNull();
    expect(texto(fixture, 'tbody')).toContain('Sin IA');

    elegirCentro(fixture, 'Kinesio Norte');
    httpMock.expectOne(LECTURA).flush(contratacion(7));
    await estabilizar(fixture);
    expect(texto(fixture, '.panel-lateral__titulo')).toBe('Kinesio Norte');
  });

  it('busca por texto con Enter y por estado al cambiarlo, y página con el filtro enviado', async () => {
    const fixture = await abrir(
      [
        KINESIO_NORTE,
        { ...centro(5, 'Kinesio Sur'), planCode: 'RED', planName: 'Plan Plus', ia: true },
      ],
      2,
      25,
    );
    // El total en la barra, el estado a la vista (sin embudo ni boton de buscar) y el pie estandar.
    expect(texto(fixture, '.barra-centros__total')).toBe('25 centros');
    expect(texto(fixture, '.paginacion-pie__resumen')).toBe('Mostrando 1–10 de 25');
    expect(fixture.nativeElement.querySelector('app-filtros')).toBeNull();
    expect(texto(fixture, 'form')).not.toContain('Buscar centros');
    expect(
      (fixture.nativeElement.querySelector('#suscripcion-filtro-estado') as HTMLSelectElement)
        .value,
    ).toBe('ACTIVA');
    expect(texto(fixture, 'tbody tr:nth-child(2) .marca-plan__sigla')).toBe('PP');
    expect(texto(fixture, 'tbody tr:nth-child(2) .marca-ia')).toBe('IA');

    escribir(fixture, '  norte ');
    enviar(fixture, 0);
    const porTexto = httpMock.expectOne((r) => r.url === LISTADO);
    expect(porTexto.request.params.get('q')).toBe('norte');
    expect(porTexto.request.params.get('status')).toBe('ACTIVA');
    porTexto.flush(pagina([KINESIO_NORTE], 0, 1, 1));
    await estabilizar(fixture);

    elegir(fixture, '#suscripcion-filtro-estado', 'SUSPENDIDA');
    const busqueda = httpMock.expectOne((r) => r.url === LISTADO);
    expect(busqueda.request.params.get('q')).toBe('norte');
    expect(busqueda.request.params.get('status')).toBe('SUSPENDIDA');
    expect(busqueda.request.params.get('page')).toBe('0');
    busqueda.flush(pagina([KINESIO_NORTE], 0, 2, 21));
    await estabilizar(fixture);

    escribir(fixture, 'otra cosa');
    const siguiente = fixture.nativeElement.querySelector(
      'nav[aria-label="Páginas de centros"] button:last-of-type',
    ) as HTMLButtonElement;
    siguiente.click();
    const pagina2 = httpMock.expectOne((r) => r.url === LISTADO);
    expect(pagina2.request.params.get('q')).toBe('norte');
    expect(pagina2.request.params.get('page')).toBe('1');
    pagina2.flush(pagina([], 1, 2, 21));
    await estabilizar(fixture);
    expect(texto(fixture, 'app-estado-vacio')).toContain('Ningún centro coincide con la búsqueda');

    // "Limpiar filtros" del vacio: sin texto ni estado, desde la primera pagina.
    const limpiar = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        'app-estado-vacio button',
      ),
    ].find((boton) => boton.textContent?.includes('Limpiar filtros'))!;
    limpiar.click();
    const limpio = httpMock.expectOne((r) => r.url === LISTADO);
    expect(limpio.request.params.has('q')).toBe(false);
    expect(limpio.request.params.has('status')).toBe(false);
    expect(limpio.request.params.get('page')).toBe('0');
    expect(limpio.request.params.get('size')).toBe('10');
    limpio.flush(pagina([KINESIO_NORTE], 0, 1, 1));
    await estabilizar(fixture);
  });

  it('si el listado falla lo dice y deja reintentar', async () => {
    const fixture = TestBed.createComponent(SuscripcionDeCentroPage);
    fixture.detectChanges();
    httpMock.expectOne(PLANES).flush([]);
    httpMock
      .expectOne((r) => r.url === LISTADO)
      .flush(
        { type: 'https://akine.app/problems/forbidden', status: 403 },
        { status: 403, statusText: 'Forbidden' },
      );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Tu cuenta ya no administra la plataforma');

    const reintentar = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent?.trim() === 'Reintentar');
    reintentar?.click();
    httpMock.expectOne((r) => r.url === LISTADO).flush(pagina([KINESIO_NORTE]));
    await estabilizar(fixture);
    expect(texto(fixture, 'table')).toContain('Kinesio Norte');
  });

  it('un centro que ya no esta vigente se explica', async () => {
    const fixture = await buscar();
    httpMock
      .expectOne(LECTURA)
      .flush(
        { type: 'https://akine.app/problems/not-found', status: 404 },
        { status: 404, statusText: 'Not Found' },
      );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('El centro ya no está vigente');
  });

  it(
    'con una suscripción cargada no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await buscar();
      httpMock.expectOne(LECTURA).flush(contratacion(7));
      await estabilizar(fixture);
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  /** Abre la pantalla: el catalogo de planes y la primera pagina del listado, en ACTIVA. */
  async function abrir(
    centros: unknown[] = [KINESIO_NORTE],
    totalPaginas = 1,
    total = centros.length,
  ): Promise<ComponentFixture<SuscripcionDeCentroPage>> {
    const fixture = TestBed.createComponent(SuscripcionDeCentroPage);
    fixture.detectChanges();
    httpMock.expectOne(PLANES).flush([
      { code: 'RETIRADO', name: 'Retirado', ofrecido: false },
      { code: 'BASE', name: 'Plan Básico', ofrecido: true },
      { code: 'CRECIMIENTO', name: 'Plan Intermedio', ofrecido: true },
    ]);
    const listado = httpMock.expectOne((r) => r.url === LISTADO);
    expect(listado.request.params.has('q')).toBe(false);
    expect(listado.request.params.get('status')).toBe('ACTIVA');
    listado.flush(pagina(centros, 0, totalPaginas, total));
    await estabilizar(fixture);
    return fixture;
  }

  /** Abre la pantalla y elige Kinesio Norte (organizacion 4) del listado. */
  async function buscar(): Promise<ComponentFixture<SuscripcionDeCentroPage>> {
    const fixture = await abrir();
    elegirCentro(fixture, 'Kinesio Norte');
    return fixture;
  }

  function elegirCentro(fixture: ComponentFixture<SuscripcionDeCentroPage>, nombre: string): void {
    const boton = fixture.nativeElement.querySelector(
      `button[aria-label="Ver la suscripción de ${nombre}"]`,
    ) as HTMLButtonElement;
    boton.click();
    fixture.detectChanges();
  }

  async function estabilizar(fixture: ComponentFixture<SuscripcionDeCentroPage>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function escribir(fixture: ComponentFixture<SuscripcionDeCentroPage>, valor: string): void {
    const campo = fixture.nativeElement.querySelector('#suscripcion-busqueda') as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function elegir(
    fixture: ComponentFixture<SuscripcionDeCentroPage>,
    selector: string,
    valor: string,
  ): void {
    const select = fixture.nativeElement.querySelector(selector) as HTMLSelectElement;
    select.value = valor;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  /** Tilda o destilda el servicio numero `indice` del panel (0: Kinesiologia, 1: Actividades). */
  function marcarServicio(
    fixture: ComponentFixture<SuscripcionDeCentroPage>,
    indice: number,
  ): void {
    const casillas = fixture.nativeElement.querySelectorAll('app-panel-lateral fieldset input');
    (casillas[indice] as HTMLInputElement).click();
    fixture.detectChanges();
  }

  /** Envia el formulario numero `indice` de la pantalla (0: buscar centros, 1: la contratacion). */
  function enviar(fixture: ComponentFixture<SuscripcionDeCentroPage>, indice: number): void {
    const formularios = fixture.nativeElement.querySelectorAll('form');
    (formularios[indice] as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  function texto(fixture: ComponentFixture<SuscripcionDeCentroPage>, selector?: string): string {
    const raiz = fixture.nativeElement as HTMLElement;
    const elemento = selector ? raiz.querySelector(selector) : raiz;
    return elemento?.textContent?.trim() ?? '';
  }
});
