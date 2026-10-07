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
        { seccion: 'casos', titulo: 'Casos clinicos', permisoRequerido: 'hc:read', clinica: true },
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
    expect(texto).toContain('Casos clinicos: hace falta leer historia clinica (hc:read)');
    expect(texto).toContain('Ves solo tu propia actividad');
    expect(texto).toContain('Los ausentes cuentan aparte');
    expect(texto).not.toContain('Solo lo tuyo');
    expect(texto).toContain('Del 01/09/2026 al 30/09/2026');
  });

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
    expect(contenido(fixture)).toContain('como maximo 366');

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
        detail: 'El periodo pedido son 400 dias y el maximo es 366',
        maximoDias: 366,
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await estabilizar(fixture);

    expect(contenido(fixture)).toContain('El periodo pedido son 400 dias y el maximo es 366');
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
  });

  it('sin sede en el contexto no pide nada y manda al selector', async () => {
    const fixture = TestBed.createComponent(ReportesPage);
    fixture.detectChanges();
    await estabilizar(fixture);

    httpMock.expectNone(BASE);
    expect(contenido(fixture)).toContain('Elegir contexto');
  });

  it(
    'no tiene violaciones de accesibilidad con un reporte generado',
    async () => {
      const fixture = await generado();
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

  async function generado(): Promise<ComponentFixture<ReportesPage>> {
    const fixture = await montar();
    escribir(fixture, '#reporte-desde', '2026-09-01');
    escribir(fixture, '#reporte-hasta', '2026-09-30');
    enviar(fixture);
    httpMock.expectOne(`${BASE}/OPERATIVO?desde=2026-09-01&hasta=2026-09-30`).flush(REPORTE);
    await estabilizar(fixture);
    return fixture;
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
