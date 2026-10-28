import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ReportesPage } from './reportes-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const CONSULTORIO = 3;
const BASE = `/api/v1/consultorios/${CONSULTORIO}/reportes`;

const CATALOGO = {
  reportes: [
    {
      reporte: 'OPERATIVO',
      secciones: [
        { seccion: 'turnos', titulo: 'Turnos', permisoRequerido: 'turno:read', clinica: false },
        { seccion: 'casos', titulo: 'Casos clínicos', permisoRequerido: 'hc:read', clinica: true },
      ],
    },
    { reporte: 'TURNOS', secciones: [] },
  ],
};

/** Lo que manda el servidor (datos sinteticos), con los campos que el contrato 0.66.0 no declara. */
const REPORTE = {
  reporte: 'OPERATIVO',
  consultorioId: CONSULTORIO,
  desde: '2026-09-01',
  hasta: '2026-09-30',
  zona: 'America/Argentina/Cordoba',
  generadoEn: '2026-10-01T12:00:00Z',
  secciones: [
    {
      seccion: 'turnos',
      titulo: 'Turnos',
      indicadores: [
        {
          clave: 'turnos-atendidos',
          etiqueta: 'Turnos atendidos',
          tipo: 'CONTEO',
          valor: 42,
          fuente: 'M12 turno',
          criterioDeFecha: 'inicio del turno, en la zona de la sede',
        },
      ],
      columnas: ['Estado', 'Cantidad'],
      filas: [['ATENDIDO', '42']],
    },
  ],
  omitidas: [{ seccion: 'casos', permisoRequerido: 'hc:read' }],
  advertencias: [
    { seccion: 'turnos', codigo: 'alcance-actividad-propia', detalle: 'Solo lo tuyo' },
    { seccion: 'turnos', codigo: 'otra', detalle: 'Los ausentes cuentan aparte' },
  ],
};

/** Serie temporal (DP-45): dos indicadores de dos secciones, por dia. */
const SERIE = {
  reporte: 'OPERATIVO',
  consultorioId: CONSULTORIO,
  desde: '2026-09-01',
  hasta: '2026-09-03',
  agrupacion: 'DIA',
  series: [
    {
      seccion: 'economia',
      clave: 'cobrado',
      etiqueta: 'Cobrado',
      tipo: 'DINERO',
      moneda: 'ARS',
      fuente: 'M19 cobro',
      criterioDeFecha: 'cobrado_en',
      total: 1500,
      puntos: [
        { desde: '2026-09-01', hasta: '2026-09-01', valor: 1000 },
        { desde: '2026-09-02', hasta: '2026-09-02', valor: 0 },
        { desde: '2026-09-03', hasta: '2026-09-03', valor: 500 },
      ],
    },
    {
      seccion: 'turnos',
      clave: 'turnos-totales',
      etiqueta: 'Turnos',
      tipo: 'CONTEO',
      total: 4,
      puntos: [
        { desde: '2026-09-01', hasta: '2026-09-01', valor: 1 },
        { desde: '2026-09-02', hasta: '2026-09-02', valor: 3 },
        { desde: '2026-09-03', hasta: '2026-09-03', valor: 0 },
      ],
    },
  ],
};

/**
 * Tablero de reportes (M23). Cubre lo que decide comportamiento: que el periodo se valide antes de
 * pedir, que cada indicador diga de donde sale, que lo omitido y el recorte a actividad propia se
 * declaren, y que el CSV se pida como CSV.
 */
describe('ReportesPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReportesPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    tenantContext = TestBed.inject(TenantContextStore);
  });

  afterEach(() => httpMock.verify());

  it('genera el reporte con fuente, criterio, detalle, omitidas y el recorte propio', async () => {
    const fixture = await generado();
    const texto = contenido(fixture);

    expect(texto).toContain('Turnos atendidos');
    expect(texto).toContain('42');
    expect(texto).toContain('M12 turno');
    expect(texto).toContain('inicio del turno, en la zona de la sede');
    expect(texto).toContain('ATENDIDO');
    expect(texto).toContain('Casos clínicos: hace falta leer historia clínica (hc:read)');
    expect(texto).toContain('Ves solo tu propia actividad');
    expect(texto).toContain('Los ausentes cuentan aparte');
    expect(texto).not.toContain('Solo lo tuyo');
    expect(texto).toContain('Del 01/09/2026 al 30/09/2026');
  });

  it('el gráfico de evolución dibuja un indicador por vez con el total del servidor', async () => {
    const fixture = await generado(SERIE);
    const html = fixture.nativeElement as HTMLElement;

    expect(contenido(fixture)).toContain('Evolución por día');
    expect(html.querySelector('.serie-resumen')?.textContent?.replace(/\s+/g, '')).toBe(
      'Cobrado$1.500,00enelperíodo',
    );
    expect(contenido(fixture)).toContain('M19 cobro');
    const lienzo = html.querySelector<HTMLElement>('[role="group"]')!;
    expect(lienzo.getAttribute('aria-label')?.replace(/\s+/g, ' ')).toBe(
      'Barras de Cobrado por día, del 01/09/2026 al 03/09/2026; total $ 1.500,00; ' +
        'la más alta, 01/09/2026: $ 1.000,00.',
    );
    // La misma informacion en tabla, para quien no ve el dibujo.
    const filas = [...html.querySelectorAll('.grafico__datos tbody tr')].map((f) =>
      [...f.querySelectorAll('td')].map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim()),
    );
    expect(filas).toEqual([
      ['01/09/2026', '$ 1.000,00'],
      ['02/09/2026', '$ 0,00'],
      ['03/09/2026', '$ 500,00'],
    ]);

    // Otro indicador: otra serie, no la suma de las dos.
    const selector = html.querySelector<HTMLSelectElement>('#serie-indicador')!;
    selector.value = 'turnos/turnos-totales';
    selector.dispatchEvent(new Event('change'));
    await estabilizar(fixture);
    expect(html.querySelector('.serie-resumen')?.textContent?.replace(/\s+/g, '')).toBe(
      'Turnos4enelperíodo',
    );
    expect(html.querySelectorAll('.grafico__datos tbody tr')).toHaveLength(3);
  });

  it('un período de más de dos meses se pide por semana', async () => {
    const fixture = await montar();
    escribir(fixture, '#reporte-desde', '2026-07-01');
    escribir(fixture, '#reporte-hasta', '2026-09-30');
    enviar(fixture);
    httpMock.expectOne(`${BASE}/OPERATIVO?desde=2026-07-01&hasta=2026-09-30`).flush(REPORTE);
    await estabilizar(fixture);

    const pedido = httpMock.expectOne((p) => p.url === `${BASE}/OPERATIVO/serie`);
    expect(pedido.request.params.get('agrupacion')).toBe('SEMANA');
    pedido.flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await estabilizar(fixture);
    // El reporte queda; el gráfico dice que no pudo.
    expect(contenido(fixture)).toContain('Turnos atendidos');
    expect(contenido(fixture)).toContain('No se pudo armar el gráfico de evolución');
  });

  it(
    'rentabilidad y caja por servicio (DP-39): importes legibles, una columna por medio y la advertencia en su sección',
    async () => {
      const fixture = await montar();
      escribir(fixture, '#reporte-desde', '2026-09-01');
      escribir(fixture, '#reporte-hasta', '2026-09-30');
      enviar(fixture);
      httpMock.expectOne(`${BASE}/OPERATIVO?desde=2026-09-01&hasta=2026-09-30`).flush({
        ...REPORTE,
        reporte: 'SERVICIOS',
        omitidas: [],
        secciones: [
          {
            seccion: 'rentabilidad-por-servicio',
            titulo: 'Rentabilidad por servicio',
            indicadores: [],
            columnas: [
              'Servicio',
              'Naturaleza',
              'Oferta',
              'Ingresos (devengado)',
              'Egresos imputados',
              'Resultado',
            ],
            filas: [
              ['Kinesiologia', 'CLINICA', 'Kinesio', '1500.00', '250.00', '1250.00'],
              ['(sin imputar)', '', '(egresos sin oferta)', '0.00', '1000.00', '-1000.00'],
            ],
          },
          {
            seccion: 'caja-por-servicio',
            titulo: 'Caja por servicio',
            indicadores: [],
            columnas: ['Servicio', 'Naturaleza', 'Oferta', 'EFECTIVO', 'TRANSFERENCIA', 'Total'],
            filas: [['Pilates', 'BIENESTAR', 'Pilates grupal', '33.33', '366.67', '400.00']],
          },
        ],
        advertencias: [
          {
            seccion: 'rentabilidad-por-servicio',
            codigo: 'rentabilidad-sin-costos',
            detalle: 'Ningún egreso del periodo esta imputado a un servicio',
          },
          { codigo: 'general', detalle: 'Aviso de todo el reporte' },
        ],
      });
      await estabilizar(fixture);
      // Un reporte sin series (los de F9) no dibuja grafico.
      responderSerie({ ...SERIE, series: [] });
      await estabilizar(fixture);
      expect(contenido(fixture)).not.toContain('Evolución por');
      const html = fixture.nativeElement as HTMLElement;
      const texto = contenido(fixture);

      expect(texto).toContain('1.500,00');
      expect(texto).toContain('-1.000,00');
      expect(texto).toContain('366,67');
      expect(texto).toContain('TRANSFERENCIA');
      // Lo que no es importe se deja como vino.
      expect(texto).toContain('(egresos sin oferta)');
      expect(html.querySelectorAll('td.importe').length).toBe(9);

      // La advertencia de la seccion va dentro de la seccion; la general, arriba.
      const secciones = [...html.querySelectorAll('section')];
      const rentabilidad = secciones.find((x) =>
        (x.textContent ?? '').includes('Rentabilidad por servicio'),
      )!;
      expect(rentabilidad.textContent).toContain('Ningún egreso del periodo esta imputado');
      expect(texto.match(/Ningún egreso del periodo/g)?.length).toBe(1);
      expect(texto).toContain('Aviso de todo el reporte');
      await esperarSinViolaciones(html);
    },
    TIMEOUT_AXE,
  );

  it('muestra de antemano las secciones del reporte elegido', async () => {
    const fixture = await montar();
    expect(contenido(fixture)).toContain('Este reporte trae');
    expect(contenido(fixture)).toContain('consultarla queda auditada');
  });

  it('no pide nada con el periodo invertido o mas ancho que la ventana', async () => {
    const fixture = await montar();

    escribir(fixture, '#reporte-desde', '2026-09-30');
    escribir(fixture, '#reporte-hasta', '2026-09-01');
    enviar(fixture);
    expect(contenido(fixture)).toContain('El periodo termina antes de empezar');

    escribir(fixture, '#reporte-desde', '2024-01-01');
    escribir(fixture, '#reporte-hasta', '2026-01-01');
    enviar(fixture);
    expect(contenido(fixture)).toContain('como máximo 366');

    httpMock.expectNone((p) => p.url.startsWith(`${BASE}/`));
  });

  it('traduce el rango que rechaza el servidor', async () => {
    const fixture = await montar();
    escribir(fixture, '#reporte-desde', '2026-09-01');
    escribir(fixture, '#reporte-hasta', '2026-09-30');
    enviar(fixture);

    httpMock.expectOne(`${BASE}/OPERATIVO?desde=2026-09-01&hasta=2026-09-30`).flush(
      {
        type: 'https://akine.app/problems/rango-de-reporte-invalido',
        detail: 'El periodo pedido son 400 días y el máximo es 366',
        maximoDias: 366,
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await estabilizar(fixture);

    expect(contenido(fixture)).toContain('El periodo pedido son 400 días y el máximo es 366');
  });

  it('descarga el CSV pidiendolo como text/csv y con el periodo del reporte', async () => {
    const fixture = await generado();
    const crear = vi.fn(() => 'blob:x');
    const revocar = vi.fn();
    Object.assign(URL, { createObjectURL: crear, revokeObjectURL: revocar });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    boton(fixture, 'Descargar CSV').click();
    const pedido = httpMock.expectOne(`${BASE}/OPERATIVO/export?desde=2026-09-01&hasta=2026-09-30`);
    expect(pedido.request.headers.get('Accept')).toBe('text/csv');
    pedido.flush('seccion,clave,valor\n');
    await estabilizar(fixture);

    expect(crear).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revocar).toHaveBeenCalledWith('blob:x');
    // Sin Content-Disposition, el nombre armado aca queda de respaldo.
    expect((click.mock.contexts.at(-1) as HTMLAnchorElement).download).toMatch(/\.csv$/);
    click.mockRestore();
  });

  it('el CSV se guarda con el nombre que decide el servidor en Content-Disposition', async () => {
    const fixture = await generado();
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:y'), revokeObjectURL: vi.fn() });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    boton(fixture, 'Descargar CSV').click();
    httpMock
      .expectOne(`${BASE}/OPERATIVO/export?desde=2026-09-01&hasta=2026-09-30`)
      .flush('seccion,clave,valor\n', {
        headers: {
          'Content-Disposition':
            'attachment; filename="reporte-operativo-2026-09-01_2026-09-30.csv"',
        },
      });
    await estabilizar(fixture);

    expect((click.mock.contexts.at(-1) as HTMLAnchorElement).download).toBe(
      'reporte-operativo-2026-09-01_2026-09-30.csv',
    );
    click.mockRestore();
  });

  it('sin sede en el contexto no pide nada y manda al selector', async () => {
    const fixture = TestBed.createComponent(ReportesPage);
    fixture.detectChanges();
    await estabilizar(fixture);

    httpMock.expectNone(BASE);
    expect(contenido(fixture)).toContain('Elegir contexto');
  });

  it(
    'no tiene violaciones de accesibilidad con un reporte generado y su gráfico',
    async () => {
      const fixture = await generado(SERIE);
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // ------------------------------------------------------------------------------------

  async function montar(): Promise<ComponentFixture<ReportesPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });
    const fixture = TestBed.createComponent(ReportesPage);
    fixture.detectChanges();
    httpMock.expectOne(BASE).flush(CATALOGO);
    await estabilizar(fixture);
    return fixture;
  }

  async function generado(serie: object = { ...SERIE, series: [] }) {
    const fixture = await montar();
    escribir(fixture, '#reporte-desde', '2026-09-01');
    escribir(fixture, '#reporte-hasta', '2026-09-30');
    enviar(fixture);
    httpMock.expectOne(`${BASE}/OPERATIVO?desde=2026-09-01&hasta=2026-09-30`).flush(REPORTE);
    await estabilizar(fixture);
    responderSerie(serie);
    await estabilizar(fixture);
    return fixture;
  }

  /** La serie del grafico se pide despues del reporte, con su periodo; 30 dias van por dia. */
  function responderSerie(serie: object) {
    httpMock
      .expectOne(`${BASE}/OPERATIVO/serie?desde=2026-09-01&hasta=2026-09-30&agrupacion=DIA`)
      .flush(serie);
  }

  async function estabilizar(fixture: ComponentFixture<ReportesPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function contenido(fixture: ComponentFixture<ReportesPage>): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  function escribir(fixture: ComponentFixture<ReportesPage>, selector: string, valor: string) {
    const campo = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(selector)!;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function enviar(fixture: ComponentFixture<ReportesPage>) {
    (fixture.nativeElement as HTMLElement)
      .querySelector('form')!
      .dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  function boton(fixture: ComponentFixture<ReportesPage>, texto: string): HTMLButtonElement {
    const botones = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    return Array.from(botones).find((b) => b.textContent?.includes(texto))!;
  }
});
