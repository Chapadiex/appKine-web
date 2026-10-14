import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ClasesDelDiaPage } from './clases-del-dia-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const CONSULTORIO = 3;
const AGENDA = `/api/v1/consultorios/${CONSULTORIO}/agenda`;

const DIA = {
  fecha: '2026-10-20',
  timezone: 'America/Argentina/Cordoba',
  eventos: [
    {
      tipo: 'TURNO',
      eventoId: 99,
      inicio: '2026-10-20T12:00:00Z',
      fin: '2026-10-20T12:45:00Z',
      titulo: 'Turno de kinesio',
    },
    {
      tipo: 'CLASE',
      eventoId: 7,
      inicio: '2026-10-20T13:00:00Z',
      fin: '2026-10-20T14:00:00Z',
      titulo: 'Pilates grupal',
      estado: 'EN_CURSO',
      capacidad: 6,
      ocupados: 4,
    },
  ],
};

/** Clases del dia: filtra las clases de la agenda unificada y pide el dia elegido. */
describe('ClasesDelDiaPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClasesDelDiaPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede',
    });
  });

  afterEach(() => httpMock.verify());

  async function montar(): Promise<ComponentFixture<ClasesDelDiaPage>> {
    const fixture = TestBed.createComponent(ClasesDelDiaPage);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  async function responder(fixture: ComponentFixture<ClasesDelDiaPage>, cuerpo: object) {
    httpMock.expectOne((p) => p.url === AGENDA).flush(cuerpo);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it(
    'lista solo las clases, en la hora de la sede, con su enlace',
    async () => {
      const fixture = await montar();
      await responder(fixture, DIA);
      const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(texto).toContain('Pilates grupal');
      expect(texto).toContain('10:00 a 11:00');
      expect(texto).toContain('En curso');
      expect(texto).toContain('4 de 6');
      expect(texto).not.toContain('Turno de kinesio');
      const enlace = (fixture.nativeElement as HTMLElement).querySelector(
        'a[href="/asistencia/7"]',
      );
      expect(enlace).not.toBeNull();
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  it('cambiar la fecha pide ese dia; un dia sin clases lo dice', async () => {
    const fixture = await montar();
    await responder(fixture, DIA);

    const input = (fixture.nativeElement as HTMLElement).querySelector(
      '#clases-fecha',
    ) as HTMLInputElement;
    input.value = '2026-10-21';
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const pedido = httpMock.expectOne((p) => p.url === AGENDA);
    expect(pedido.request.params.get('fecha')).toBe('2026-10-21');
    pedido.flush({ ...DIA, eventos: [DIA.eventos[0]] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No hay clases');
  });

  it('un error se muestra con reintento', async () => {
    const fixture = await montar();
    httpMock
      .expectOne((p) => p.url === AGENDA)
      .flush(
        { type: 'https://akine.app/problems/forbidden', status: 403 },
        { status: 403, statusText: 'Forbidden' },
      );
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('No tenes permiso');
    (el.querySelector('button') as HTMLButtonElement).click();
    await responder(fixture, DIA);
    expect(el.textContent).toContain('Pilates grupal');
  });
});
