import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { SuscripcionDeCentroPage } from './suscripcion-de-centro-page';
import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';

const PLANES = '/api/v1/plans';
const LISTADO = '/api/v1/platform/organizations';
const LECTURA = '/api/v1/platform/organizations/4/subscription';
const CAMBIO = '/api/v1/organizations/4/subscription/plan-changes';

const suscripcion = (version: number, planCode = 'BASICO', status = 'ACTIVA') => ({
  id: 1,
  organizationId: 4,
  planCode,
  planName: planCode === 'BASICO' ? 'Basico' : 'Profesional',
  status,
  version,
});

const centro = (id: number, name: string, status = 'ACTIVA') => ({
  id,
  name,
  slug: name.toLowerCase().replace(/ /g, '-'),
  status,
  planCode: 'BASICO',
  planName: 'Basico',
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

  it('lee la suscripción por la ruta de plataforma y cambia el plan con esa versión', async () => {
    const fixture = await buscar();
    httpMock.expectNone('/api/v1/organizations/4/subscription');
    httpMock.expectOne(LECTURA).flush(suscripcion(7));
    await estabilizar(fixture);
    expect(texto(fixture, '[data-testid="suscripcion-version"]')).toBe('7');

    elegir(fixture, '#suscripcion-plan-nuevo', 'PROFESIONAL');
    enviar(fixture, 1);
    const cambio = httpMock.expectOne(CAMBIO);
    expect(cambio.request.method).toBe('POST');
    expect(cambio.request.body).toEqual({ planCode: 'PROFESIONAL', expectedVersion: 7 });
    cambio.flush({
      applied: true,
      warnings: [{ code: 'MAX_SEDES', currentUsage: 3, limitValue: 2, exceeded: true }],
    });
    httpMock.expectOne(LECTURA).flush(suscripcion(8, 'PROFESIONAL'));
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('El centro paso al plan Profesional.');
    expect(texto(fixture, '[data-testid="suscripcion-excedidos"]')).toContain(
      'MAX_SEDES: 3 en uso, el plan admite 2',
    );
    expect(texto(fixture, '[data-testid="suscripcion-version"]')).toBe('8');
  });

  it('una versión vieja no aplica nada, lo dice y relee la suscripción', async () => {
    const fixture = await buscar();
    httpMock.expectOne(LECTURA).flush(suscripcion(7));
    await estabilizar(fixture);

    elegir(fixture, '#suscripcion-plan-nuevo', 'PROFESIONAL');
    enviar(fixture, 1);
    httpMock
      .expectOne(CAMBIO)
      .flush(
        { type: 'https://akine.app/problems/concurrent-modification', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    httpMock.expectOne(LECTURA).flush(suscripcion(9));
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No se aplico nada');
    expect(texto(fixture, '[data-testid="suscripcion-version"]')).toBe('9');
  });

  it('con la suscripción suspendida no ofrece cambiar el plan', async () => {
    const fixture = await buscar();
    httpMock.expectOne(LECTURA).flush(suscripcion(2, 'BASICO', 'SUSPENDIDA'));
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('el plan solo se cambia con la suscripción activa');
    expect(fixture.nativeElement.querySelector('#suscripcion-plan-nuevo')).toBeNull();
  });

  it('lista los centros al entrar y los elige por nombre, no por número', async () => {
    const fixture = await abrir();
    expect(texto(fixture, 'table')).toContain('Kinesio Norte');
    expect(texto(fixture, 'table')).toContain('kinesio-norte');
    expect(texto(fixture, 'table')).toContain('01/10/2026');
    expect(fixture.nativeElement.querySelector('#suscripcion-organizacion')).toBeNull();

    elegirCentro(fixture, 'Kinesio Norte');
    httpMock.expectOne(LECTURA).flush(suscripcion(7));
    await estabilizar(fixture);
    expect(texto(fixture, '#titulo-suscripcion')).toBe('Kinesio Norte');
  });

  it('busca por texto y estado, y página con el filtro enviado, no con el que se escribe', async () => {
    const fixture = await abrir([KINESIO_NORTE, centro(5, 'Kinesio Sur')], 2, 25);
    expect(texto(fixture, '[data-testid="suscripcion-total-centros"]')).toBe('25 centros');

    escribir(fixture, '  norte ');
    elegir(fixture, '#suscripcion-filtro-estado', 'SUSPENDIDA');
    enviar(fixture, 0);
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
    expect(texto(fixture)).toContain('Ningún centro coincide con la búsqueda');
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
    expect(texto(fixture)).toContain('El centro ya no esta vigente');
  });

  it(
    'con una suscripción cargada no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await buscar();
      httpMock.expectOne(LECTURA).flush(suscripcion(7));
      await estabilizar(fixture);
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  /** Abre la pantalla: el catalogo de planes y la primera pagina del listado, sin filtro. */
  async function abrir(
    centros: unknown[] = [KINESIO_NORTE],
    totalPaginas = 1,
    total = centros.length,
  ): Promise<ComponentFixture<SuscripcionDeCentroPage>> {
    const fixture = TestBed.createComponent(SuscripcionDeCentroPage);
    fixture.detectChanges();
    httpMock.expectOne(PLANES).flush([
      { code: 'BASICO', name: 'Basico' },
      { code: 'PROFESIONAL', name: 'Profesional' },
    ]);
    const listado = httpMock.expectOne((r) => r.url === LISTADO);
    expect(listado.request.params.has('q')).toBe(false);
    expect(listado.request.params.has('status')).toBe(false);
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

  /** Envia el formulario numero `indice` de la pantalla (0: buscar centros, 1: cambiar el plan). */
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
