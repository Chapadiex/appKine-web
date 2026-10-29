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
      // Patron de listado (UX-14): contador en la barra, pie estandar, en la misma tarjeta.
      const raiz = fixture.nativeElement as HTMLElement;
      expect(raiz.querySelector('section.tarjeta app-filtros')).not.toBeNull();
      expect(raiz.querySelector('.filtros-barra__resultados')?.textContent).toContain('1 clase');
      expect(raiz.querySelector('section.tarjeta .paginacion-pie__resumen')?.textContent).toContain(
        'Mostrando 1–1 de 1',
      );
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  it('cambiar la fecha pide ese día; un día sin clases lo dice', async () => {
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
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('app-estado-vacio')?.textContent,
    ).toContain('No hay clases programadas para ese día');
  });

  it('la búsqueda filtra por nombre y, sin coincidencias, ofrece limpiarla', async () => {
    const fixture = await montar();
    await responder(fixture, DIA);
    const raiz = fixture.nativeElement as HTMLElement;
    const busqueda = raiz.querySelector('#clases-dia-busqueda') as HTMLInputElement;
    busqueda.value = 'zumba';
    busqueda.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(raiz.querySelector('app-estado-vacio')?.textContent).toContain('No encontramos clases');
    expect(raiz.querySelector('.filtros-barra__resultados')?.textContent).toContain('0 clases');
    (
      Array.from(raiz.querySelectorAll('app-estado-vacio button')).find((b) =>
        (b.textContent ?? '').includes('Limpiar filtros'),
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(raiz.textContent).toContain('Pilates grupal');
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
    expect(el.textContent).toContain('No tenés permiso');
    (
      el.querySelector(
        'button:not(.ayuda-contextual__boton):not(.ayuda-contextual__cerrar)',
      ) as HTMLButtonElement
    ).click();
    await responder(fixture, DIA);
    expect(el.textContent).toContain('Pilates grupal');
  });
});
