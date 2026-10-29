import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { AtencionSinTurnoPage } from './atencion-sin-turno-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const CONSULTORIO = 3;
const OFERTAS = `/api/v1/consultorios/${CONSULTORIO}/ofertas`;
const SESIONES = `/api/v1/consultorios/${CONSULTORIO}/sesiones`;
const PERSONAS = '/api/v1/personas';
const DATOS_ADMIN = '/api/v1/historias-clinicas/por-persona/9/datos-administrativos';

const OFERTA_LIBRE = { id: 4, nombreComercial: 'Kinesiologia' };
const OFERTA_CON_CASO = { id: 5, nombreComercial: 'Rehabilitacion', requiereCasoClinico: true };
const PACIENTE = { id: 9, apellido: 'Perez', nombre: 'Ana', numeroDocumento: '30111222' };

/**
 * Spec de la atencion sin turno (DP-43, U-24): motivo obligatorio, caso obligatorio solo si la
 * oferta lo exige, la misma `idempotencyKey` en el reintento del mismo pedido y otra si cambia.
 */
describe('AtencionSinTurnoPage', () => {
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AtencionSinTurnoPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });
  });

  afterEach(() => httpMock.verify());

  it(
    'abre la atención con oferta, persona y motivo, y navega a ella',
    async () => {
      const fixture = await montar();
      const navegar = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      await elegirPaciente(fixture, []);
      elegir(fixture, '#sin-turno-oferta', '4');
      escribir(fixture, '#sin-turno-motivo', 'Consulta por dolor agudo');
      await esperarSinViolaciones(fixture.nativeElement);

      apretar(fixture, 'Iniciar atención');
      const pedido = httpMock.expectOne((p) => p.method === 'POST' && p.url === SESIONES);
      const cuerpo = pedido.request.body as Record<string, unknown>;
      expect(cuerpo).toMatchObject({
        personaId: 9,
        ofertaId: 4,
        motivo: 'Consulta por dolor agudo',
      });
      expect(cuerpo['casoId']).toBeUndefined();
      expect(cuerpo['idempotencyKey']).toBeTruthy();
      pedido.flush({ id: 700, motivoSinTurno: 'Consulta por dolor agudo' });
      await estabilizar(fixture);

      expect(navegar).toHaveBeenCalledWith(['/atencion', 'sesiones', 700]);
    },
    TIMEOUT_AXE,
  );

  it('sin motivo no manda nada y dice por que', async () => {
    const fixture = await montar();
    await elegirPaciente(fixture, []);
    elegir(fixture, '#sin-turno-oferta', '4');
    apretar(fixture, 'Iniciar atención');
    // Validacion en el campo (UX-12): debajo del motivo, que queda marcado.
    const raiz = fixture.nativeElement as HTMLElement;
    expect(raiz.querySelector('#sin-turno-motivo-error')?.textContent).toContain('es obligatorio');
    expect(raiz.querySelector('#sin-turno-motivo')?.getAttribute('aria-invalid')).toBe('true');
    httpMock.expectNone((p) => p.method === 'POST');
  });

  it('una oferta que exige caso no deja seguir sin caso, y manda el elegido', async () => {
    const fixture = await montar();
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await elegirPaciente(fixture, [{ id: 31, numeroCaso: 1, estado: 'ACTIVO' }]);
    elegir(fixture, '#sin-turno-oferta', '5');
    escribir(fixture, '#sin-turno-motivo', 'Control');
    expect(texto(fixture)).toContain('obligatorio para esta oferta');

    apretar(fixture, 'Iniciar atención');
    expect(texto(fixture)).toContain('exige un caso clínico');
    httpMock.expectNone((p) => p.method === 'POST');

    elegir(fixture, '#sin-turno-caso', '31');
    apretar(fixture, 'Iniciar atención');
    const pedido = httpMock.expectOne((p) => p.method === 'POST' && p.url === SESIONES);
    expect((pedido.request.body as Record<string, unknown>)['casoId']).toBe(31);
    pedido.flush({ id: 701 });
    await estabilizar(fixture);
  });

  it('sin casos activos y con caso obligatorio enlaza a la historia', async () => {
    const fixture = await montar();
    await elegirPaciente(fixture, []);
    elegir(fixture, '#sin-turno-oferta', '5');
    expect(
      fixture.nativeElement.querySelector('a[href="/historia-clinica/personas/9"]'),
    ).not.toBeNull();
  });

  it('el reintento del mismo pedido lleva la misma clave; cambiar un dato, otra', async () => {
    const fixture = await montar();
    await elegirPaciente(fixture, []);
    elegir(fixture, '#sin-turno-oferta', '4');
    escribir(fixture, '#sin-turno-motivo', 'Urgencia');

    apretar(fixture, 'Iniciar atención');
    const primero = httpMock.expectOne((p) => p.method === 'POST');
    const clave = (primero.request.body as Record<string, unknown>)['idempotencyKey'];
    primero.error(new ProgressEvent('error'));
    await estabilizar(fixture);

    apretar(fixture, 'Iniciar atención');
    const segundo = httpMock.expectOne((p) => p.method === 'POST');
    expect((segundo.request.body as Record<string, unknown>)['idempotencyKey']).toBe(clave);
    segundo.flush(
      {
        type: 'https://akine.app/problems/profesional-no-habilitado-en-oferta',
        status: 409,
      },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);
    // El rechazo del servidor, arriba del formulario de la atencion.
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('app-alerta')?.textContent,
    ).toContain('No pudimos iniciar la atención');
    expect(texto(fixture)).toContain('no esta habilitado para prestar esta oferta');

    escribir(fixture, '#sin-turno-motivo', 'Urgencia, otra');
    apretar(fixture, 'Iniciar atención');
    const tercero = httpMock.expectOne((p) => p.method === 'POST');
    expect((tercero.request.body as Record<string, unknown>)['idempotencyKey']).not.toBe(clave);
    tercero.flush(
      { type: 'https://akine.app/problems/idempotency-key-conflict', status: 409 },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('ya se habia mandado con otros datos');
  });

  it('la búsqueda sin resultados lo dice', async () => {
    const fixture = await montar();
    escribir(fixture, '#sin-turno-persona', 'zzz');
    enviarBusqueda(fixture);
    httpMock.expectOne((p) => p.url === PERSONAS).flush({ content: [] });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Nadie del padrón coincide');
  });

  async function montar(): Promise<ComponentFixture<AtencionSinTurnoPage>> {
    const fixture = TestBed.createComponent(AtencionSinTurnoPage);
    fixture.detectChanges();
    const ofertas = httpMock.expectOne((p) => p.url === OFERTAS);
    expect(ofertas.request.params.get('estado')).toBe('ACTIVO');
    ofertas.flush([OFERTA_LIBRE, OFERTA_CON_CASO]);
    await estabilizar(fixture);
    return fixture;
  }

  async function elegirPaciente(
    fixture: ComponentFixture<AtencionSinTurnoPage>,
    casos: object[],
  ): Promise<void> {
    escribir(fixture, '#sin-turno-persona', 'perez');
    enviarBusqueda(fixture);
    const busqueda = httpMock.expectOne((p) => p.url === PERSONAS);
    expect(busqueda.request.params.get('q')).toBe('perez');
    busqueda.flush({ content: [PACIENTE] });
    await estabilizar(fixture);
    apretar(fixture, 'Perez, Ana');
    httpMock
      .expectOne((p) => p.url === DATOS_ADMIN)
      .flush({ personaId: 9, tieneHistoriaClinica: true, casos });
    await estabilizar(fixture);
  }

  async function estabilizar(fixture: ComponentFixture<AtencionSinTurnoPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function enviarBusqueda(fixture: ComponentFixture<AtencionSinTurnoPage>): void {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    fixture.detectChanges();
  }

  function escribir(
    fixture: ComponentFixture<AtencionSinTurnoPage>,
    selector: string,
    valor: string,
  ): void {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function elegir(
    fixture: ComponentFixture<AtencionSinTurnoPage>,
    selector: string,
    valor: string,
  ): void {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLSelectElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function apretar(fixture: ComponentFixture<AtencionSinTurnoPage>, rotulo: string): void {
    const boton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => (b.textContent ?? '').trim().startsWith(rotulo));
    if (boton === undefined) {
      throw new Error(`No hay ningún botón rotulado "${rotulo}".`);
    }
    boton.click();
    fixture.detectChanges();
  }

  function texto(fixture: ComponentFixture<AtencionSinTurnoPage>): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }
});
