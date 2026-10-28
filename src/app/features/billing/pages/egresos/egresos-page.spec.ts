import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { EgresosPage } from './egresos-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { fijarReloj, soltarReloj } from '../../../../core/testing/reloj';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const CONSULTORIO = 3;
const BASE = `/api/v1/consultorios/${CONSULTORIO}`;
const HOY_DE_LA_SEDE = '2026-10-11';

const EGRESO = {
  id: 41,
  estado: 'CONFIRMADO',
  categoria: 'HONORARIOS_PROFESIONALES',
  concepto: 'Honorarios septiembre',
  beneficiarioNombre: 'Lic. Sintetica',
  tipoBeneficiario: 'COLABORADOR',
  importeTotal: 150000,
  saldoPendiente: 50000,
  moneda: 'ARS',
  registradoEn: '2026-10-05T14:00:00Z',
};

/** El mes en curso segun el servidor (DP-45): la pantalla lo muestra tal cual, sin sumar. */
const RESUMEN = {
  consultorioId: CONSULTORIO,
  desde: '2026-10-01',
  hasta: '2026-10-31',
  porMoneda: [
    {
      moneda: 'ARS',
      cantidad: 3,
      registrado: 420000,
      pagado: 310000,
      pendiente: 110000,
      cantidadBorrador: 2,
      importeBorrador: 75000,
      cantidadAnulados: 1,
    },
  ],
  porCategoria: [],
};

/**
 * Listado y alta de egresos (M22). Cubre lo que decide comportamiento: el periodo por defecto sale
 * del dia de la SEDE, los filtros viajan al servidor, el alta manda el cuerpo del contrato con su
 * clave y lleva al detalle, y el beneficiario que falta frena el alta.
 */
describe('EgresosPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EgresosPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    tenantContext = TestBed.inject(TenantContextStore);
    vi.spyOn(TestBed.inject(DiaDeLaSede), 'hoy').mockReturnValue(HOY_DE_LA_SEDE);
  });

  afterEach(() => {
    soltarReloj();
    httpMock.verify();
  });

  it('arranca en el mes de la sede y lista estado, total y saldo pendiente', async () => {
    const fixture = await montar([EGRESO]);

    const texto = contenido(fixture);
    expect(texto).toContain('Lic. Sintetica');
    expect(texto).toContain('Honorarios profesionales');
    expect(texto).toContain('Confirmado, a pagar');
    expect(texto).toContain('150.000,00');
    expect(texto).toContain('50.000,00');
    expect(campo<HTMLInputElement>(fixture, '#filtro-desde').value).toBe('2026-10-01');
  });

  it('la tira del mes muestra lo registrado, pagado, pendiente y en borrador del servidor', async () => {
    const fixture = await montar([EGRESO]);

    const texto = contenido(fixture).replace(/\s+/g, ' ');
    expect(texto).toContain('Este mes (01/10/2026 al 31/10/2026)');
    expect(texto).toContain('420.000,00');
    expect(texto).toContain('310.000,00');
    expect(texto).toContain('110.000,00');
    expect(texto).toContain('75.000,00');
    expect(texto).toContain('2 sin confirmar · 1 anulados');
  });

  it('sin totales del mes el listado sigue y lo dice', async () => {
    const fixture = await montar([EGRESO], null);

    expect(contenido(fixture)).toContain('No se pudieron leer los totales del mes.');
    expect(contenido(fixture)).toContain('Lic. Sintetica');
  });

  it('buscar por texto manda q al servidor y vuelve a la primera página', async () => {
    const lleno = Array.from({ length: 51 }, (_, i) => ({ ...EGRESO, id: 100 + i }));
    const fixture = await montar(lleno);

    // 51 filas: se muestran 50 y hay pagina siguiente.
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr')).toHaveLength(50);
    boton(fixture, 'Siguiente').click();
    const segunda = httpMock.expectOne((p) => p.url === `${BASE}/egresos`);
    expect(segunda.request.params.get('desplazamiento')).toBe('50');
    expect(segunda.request.params.get('limite')).toBe('51');
    segunda.flush([EGRESO]);
    await estabilizar(fixture);
    expect(contenido(fixture)).toContain('Egresos 51 a 51');
    expect(boton(fixture, 'Siguiente').disabled).toBe(true);

    // El envio queda a la vista: no hay que abrir los filtros avanzados para buscar por texto.
    expect(boton(fixture, 'Buscar').closest('app-filtros')).toBeNull();
    escribir(fixture, '#filtro-q', '  sintetica ');
    enviar(fixture, 0);
    const busqueda = httpMock.expectOne((p) => p.url === `${BASE}/egresos`);
    expect(busqueda.request.params.get('q')).toBe('sintetica');
    expect(busqueda.request.params.get('desplazamiento')).toBe('0');
    busqueda.flush([EGRESO]);
    await estabilizar(fixture);
    expect(boton(fixture, 'Siguiente')).toBeUndefined();
  });

  it('la fecha de registro es la del día de la sede, no la del navegador', async () => {
    // 22:30 del 14/10 en Cordoba: en UTC, o en cualquier zona adelantada, ya es el 15.
    fijarReloj('2026-10-15T01:30:00Z', { zonaDelNavegador: 'Pacific/Kiritimati' });
    vi.spyOn(TestBed.inject(DiaDeLaSede), 'zona').mockReturnValue('America/Argentina/Cordoba');
    const fixture = await montar([{ ...EGRESO, registradoEn: '2026-10-15T01:30:00Z' }]);

    expect(contenido(fixture)).toContain('14/10/2026');
    expect(contenido(fixture)).not.toContain('15/10/2026');
  });

  it('filtrar manda estado, categoría y periodo al servidor', async () => {
    const fixture = await montar([]);
    expect(contenido(fixture)).toContain('No hay egresos con esos filtros');

    elegir(fixture, '#filtro-estado', 'BORRADOR');
    elegir(fixture, '#filtro-categoria', 'ALQUILER');
    escribir(fixture, '#filtro-hasta', '2026-10-31');
    enviar(fixture, 0);

    const busqueda = httpMock.expectOne((p) => p.url === `${BASE}/egresos`);
    expect(busqueda.request.params.get('estado')).toBe('BORRADOR');
    expect(busqueda.request.params.get('categoria')).toBe('ALQUILER');
    expect(busqueda.request.params.get('desde')).toBe('2026-10-01');
    expect(busqueda.request.params.get('hasta')).toBe('2026-10-31');
    busqueda.flush([]);
  });

  it('cargar un egreso de un colaborador manda el contrato con clave y lleva al detalle', async () => {
    const fixture = await montar([]);
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    abrirAlta(fixture);
    elegir(fixture, '#alta-colaborador', '7');
    escribir(fixture, '#alta-concepto', 'Honorarios septiembre');
    escribir(fixture, '#alta-importe', '150000,50');
    escribir(fixture, '#alta-comprobante-tipo', 'Factura C');
    escribir(fixture, '#alta-comprobante-numero', '0001-00000042');
    enviar(fixture, 1);

    const alta = httpMock.expectOne((p) => p.method === 'POST' && p.url === `${BASE}/egresos`);
    const cuerpo = alta.request.body as Record<string, unknown>;
    expect(cuerpo).toMatchObject({
      tipoBeneficiario: 'COLABORADOR',
      beneficiarioMembershipId: 7,
      categoria: 'HONORARIOS_PROFESIONALES',
      concepto: 'Honorarios septiembre',
      importeTotal: 150000.5,
      moneda: 'ARS',
      comprobanteTipo: 'Factura C',
      comprobanteNumero: '0001-00000042',
      comprobanteFecha: HOY_DE_LA_SEDE,
    });
    expect(cuerpo['beneficiarioNombre']).toBeUndefined();
    // Sin elegir servicio el egreso va sin imputar (DP-39).
    expect(cuerpo['ofertaId']).toBeUndefined();
    expect(typeof cuerpo['idempotencyKey']).toBe('string');
    alta.flush({ ...EGRESO, id: 90, estado: 'BORRADOR' });
    await estabilizar(fixture);

    expect(navegar).toHaveBeenCalledWith(['/egresos', 90]);
  });

  it('un externo sin nombre no se envia, y el rechazo del servidor se muestra traducido', async () => {
    const fixture = await montar([]);

    abrirAlta(fixture);
    (fixture.nativeElement as HTMLElement)
      .querySelectorAll<HTMLInputElement>('input[type=radio]')[1]
      .click();
    fixture.detectChanges();
    escribir(fixture, '#alta-concepto', 'Alquiler octubre');
    escribir(fixture, '#alta-importe', '300000');
    escribir(fixture, '#alta-periodo-desde', '2026-10-31');
    escribir(fixture, '#alta-periodo-hasta', '2026-10-01');
    enviar(fixture, 1);
    await estabilizar(fixture);

    httpMock.expectNone((p) => p.method === 'POST');
    expect(contenido(fixture)).toContain('Escribí a quién se le paga.');
    expect(contenido(fixture)).toContain('no puede terminar antes de empezar');

    escribir(fixture, '#alta-nombre', 'Inmobiliaria Sintetica');
    escribir(fixture, '#alta-periodo-desde', '2026-10-01');
    escribir(fixture, '#alta-periodo-hasta', '2026-10-31');
    enviar(fixture, 1);
    httpMock
      .expectOne((p) => p.method === 'POST')
      .flush(
        {
          type: 'https://akine.app/problems/egreso-comprobante-duplicado',
          status: 409,
          detail: 'x',
        },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);

    expect(contenido(fixture)).toContain('ya esta cargado en otro egreso');
  });

  it('el servicio elegido viaja como ofertaId y solo se ofrecen las ofertas activas', async () => {
    const fixture = await montar([]);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    abrirAlta(fixture);
    expect(contenido(fixture)).toContain('Pilates grupal');
    expect(contenido(fixture)).not.toContain('Oferta de baja');

    elegir(fixture, '#alta-colaborador', '7');
    elegir(fixture, '#alta-oferta', '31');
    escribir(fixture, '#alta-concepto', 'Insumos de Pilates');
    escribir(fixture, '#alta-importe', '5000');
    enviar(fixture, 1);
    const alta = httpMock.expectOne((p) => p.method === 'POST');
    expect((alta.request.body as Record<string, unknown>)['ofertaId']).toBe(31);
    alta.flush({ ...EGRESO, id: 91, ofertaId: 31 });
    await estabilizar(fixture);
  });

  it('sin sede en el contexto no pide egresos y manda al selector', async () => {
    const fixture = TestBed.createComponent(EgresosPage);
    fixture.detectChanges();
    await estabilizar(fixture);

    httpMock.expectNone(`${BASE}/egresos`);
    expect(contenido(fixture)).toContain('Elegir contexto');
  });

  it(
    'no tiene violaciones de accesibilidad con egresos listados',
    async () => {
      const fixture = await montar([EGRESO]);
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // ------------------------------------------------------------------------------------

  async function montar(
    egresos: object[],
    resumen: object | null = RESUMEN,
  ): Promise<ComponentFixture<EgresosPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });
    const fixture = TestBed.createComponent(EgresosPage);
    fixture.detectChanges();
    httpMock
      .expectOne((p) => p.url === '/api/v1/organizations/1/memberships')
      .flush({
        content: [
          { id: 7, accountName: 'Lic. Sintetica', estado: 'ACTIVA' },
          { id: 8, accountName: 'Revocada Sintetica', estado: 'REVOCADA' },
        ],
      });
    httpMock
      .expectOne((p) => p.url === `${BASE}/ofertas`)
      .flush([
        { id: 31, nombreComercial: 'Pilates grupal', estado: 'ACTIVO' },
        { id: 32, nombreComercial: 'Oferta de baja', estado: 'INACTIVO' },
      ]);
    const pedidoDeResumen = httpMock.expectOne(`${BASE}/egresos/resumen`);
    if (resumen === null) {
      pedidoDeResumen.flush(
        { type: 'https://akine.app/problems/forbidden', status: 403 },
        { status: 403, statusText: 'Forbidden' },
      );
    } else {
      pedidoDeResumen.flush(resumen);
    }
    const busqueda = httpMock.expectOne((p: HttpRequest<unknown>) => p.url === `${BASE}/egresos`);
    expect(busqueda.request.params.get('desde')).toBe('2026-10-01');
    busqueda.flush(egresos);
    await estabilizar(fixture);
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<EgresosPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function contenido(fixture: ComponentFixture<EgresosPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function campo<T extends HTMLElement>(fixture: ComponentFixture<EgresosPage>, selector: string) {
    return (fixture.nativeElement as HTMLElement).querySelector<T>(selector)!;
  }

  function elegir(fixture: ComponentFixture<EgresosPage>, selector: string, valor: string) {
    const select = campo<HTMLSelectElement>(fixture, selector);
    select.value = valor;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function escribir(fixture: ComponentFixture<EgresosPage>, selector: string, valor: string) {
    const input = campo<HTMLInputElement>(fixture, selector);
    input.value = valor;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function boton(fixture: ComponentFixture<EgresosPage>, texto: string) {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => b.textContent?.trim() === texto)!;
  }

  /** El alta vive en un panel lateral que se abre desde el encabezado (refactor UX/UI). */
  function abrirAlta(fixture: ComponentFixture<EgresosPage>) {
    boton(fixture, 'Registrar egreso').click();
    fixture.detectChanges();
  }

  function enviar(fixture: ComponentFixture<EgresosPage>, indice: number) {
    const forms = (fixture.nativeElement as HTMLElement).querySelectorAll('form');
    forms[indice].dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }
});
