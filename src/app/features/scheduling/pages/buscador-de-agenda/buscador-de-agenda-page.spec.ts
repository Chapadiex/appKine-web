import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { BuscadorDeAgendaPage } from './buscador-de-agenda-page';
import { PERMISO_TURNO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const CONSULTORIO = 3;
const OFERTA = 42;
const OFERTAS = `/api/v1/consultorios/${CONSULTORIO}/ofertas`;
const AGENDA = `${OFERTAS}/${OFERTA}/agenda`;
const HABILITACIONES = `${OFERTAS}/${OFERTA}/habilitaciones`;

const AGENDA_CON_TRES_DIAS = {
  consultorioId: CONSULTORIO,
  ofertaId: OFERTA,
  nombreComercial: 'Kinesiologia deportiva',
  duracionMinutos: 45,
  timezone: 'America/Argentina/Cordoba',
  dias: [
    {
      fecha: '2026-09-15',
      slots: [
        {
          desde: '2026-09-15T12:00:00Z',
          hasta: '2026-09-15T12:45:00Z',
          cupoLibre: 1,
          cupoTotal: 1,
        },
        // Completo: viaja con cero y tiene que verse igual.
        {
          desde: '2026-09-15T12:45:00Z',
          hasta: '2026-09-15T13:30:00Z',
          cupoLibre: 0,
          cupoTotal: 1,
        },
      ],
    },
    // Dia vacio con motivo. NO se saltea.
    { fecha: '2026-09-16', motivoSinSlots: 'FERIADO', slots: [] },
    { fecha: '2026-09-17', motivoSinSlots: 'SIN_HORARIO', slots: [] },
  ],
};

/**
 * Spec del buscador de agenda (M12, AKINE-05.01).
 *
 * <p>Tres afirmaciones, las tres de comportamiento y ninguna de "renderiza un titulo":
 *
 * <ol>
 *   <li><b>El dia sin turnos muestra su motivo.</b> Si se saltea, el operador ve un salto de
 *       fechas indistinguible de un error del sistema.</li>
 *   <li><b>El slot completo se muestra marcado.</b> Si se esconde, queda un hueco en la grilla
 *       que el usuario lee como "no atiende a esa hora": otra afirmacion, y falsa.</li>
 *   <li><b>La ventana demasiado amplia se recorta sola y se reintenta.</b> Si no, el usuario que
 *       pidio tres meses recibe un cartel en vez de una agenda.</li>
 * </ol>
 */
describe('BuscadorDeAgendaPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BuscadorDeAgendaPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    tenantContext = TestBed.inject(TenantContextStore);
    permisos = TestBed.inject(PermissionsStore);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('ningun dia de la ventana se omite: el dia sin turnos muestra su motivo', async () => {
    const fixture = await montarConAgenda();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    const dias = (fixture.nativeElement as HTMLElement).querySelectorAll('.dia');

    // Los tres dias estan, incluidos los dos que no tienen ningun turno.
    expect(dias.length).toBe(3);
    expect(texto).toContain('Feriado');
    expect(texto).toContain('horario cargado');
    // Y el motivo dice que hacer, no solo que no hay: sin eso el operador no sabe si tiene que
    // configurar algo o probar otro dia.
    expect(texto).toContain('Horarios');
  });

  it('el slot completo se muestra marcado y no como un hueco', async () => {
    const fixture = await montarConAgenda();
    const raiz = fixture.nativeElement as HTMLElement;

    // Los dos slots del primer dia estan dibujados: el libre y el lleno.
    expect(raiz.querySelectorAll('.slot').length).toBe(2);
    expect(raiz.querySelector('.slot--completo')?.textContent).toContain('Completo');
    // El lleno NO es accionable, pero sigue diciendo su horario en la zona de la sede.
    expect(raiz.querySelector('.slot--completo')?.textContent).toContain('09:45');
    expect(raiz.querySelectorAll('button.slot--libre').length).toBe(1);
  });

  it('rotula la zona horaria de la sede en vez de asumir la del navegador', async () => {
    const fixture = await montarConAgenda();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'America/Argentina/Cordoba',
    );
  });

  it('la ventana demasiado amplia se recorta sola y se vuelve a pedir', async () => {
    const fixture = await montar();

    elegirOferta(fixture);
    httpMock.expectOne(esHabilitaciones()).flush({ profesionales: [] });

    const primera = httpMock.expectOne(esAgenda());
    const desde = primera.request.params.get('desde') ?? '';
    primera.flush(
      {
        type: 'https://akine.app/problems/ventana-demasiado-amplia',
        status: 400,
        detail: 'La ventana consultada es demasiado amplia.',
        maxDays: 62,
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    // La pantalla NO muestra un error: recorta y reintenta con la ventana que si entra.
    const segunda = httpMock.expectOne(esAgenda());
    expect(segunda.request.params.get('desde')).toBe(desde);
    expect(segunda.request.params.get('hasta')).toBe(sumar62(desde));

    segunda.flush(AGENDA_CON_TRES_DIAS);
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Lo recortamos');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.dia').length).toBe(3);
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montarConAgenda();
      // Ojo: `color-contrast` vuelve siempre `incomplete` bajo jsdom, que no calcula layout.
      // Esto verifica labels, roles y estructura, no contraste.
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------

  function sumar62(desde: string): string {
    const dia = new Date(`${desde}T00:00:00Z`);
    dia.setUTCDate(dia.getUTCDate() + 62);
    return dia.toISOString().slice(0, 10);
  }

  function esAgenda() {
    return (peticion: HttpRequest<unknown>) => peticion.method === 'GET' && peticion.url === AGENDA;
  }

  function esHabilitaciones() {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'GET' && peticion.url === HABILITACIONES;
  }

  function elegirOferta(fixture: ComponentFixture<BuscadorDeAgendaPage>): void {
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      '#agenda-oferta',
    ) as HTMLSelectElement;
    select.value = String(OFERTA);
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  async function montar(): Promise<ComponentFixture<BuscadorDeAgendaPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_TURNO_MANAGE] });

    const fixture = TestBed.createComponent(BuscadorDeAgendaPage);
    fixture.detectChanges();

    httpMock
      .expectOne((p: HttpRequest<unknown>) => p.method === 'GET' && p.url === OFERTAS)
      .flush([{ id: OFERTA, nombreComercial: 'Kinesiologia deportiva', estado: 'ACTIVO' }]);
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  async function montarConAgenda(): Promise<ComponentFixture<BuscadorDeAgendaPage>> {
    const fixture = await montar();

    elegirOferta(fixture);
    httpMock.expectOne(esHabilitaciones()).flush({ profesionales: [] });
    httpMock.expectOne(esAgenda()).flush(AGENDA_CON_TRES_DIAS);
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }
});
