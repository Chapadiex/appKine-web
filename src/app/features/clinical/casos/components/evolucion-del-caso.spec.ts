import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { EvolucionDelCaso } from './evolucion-del-caso';
import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';

const RUTA = '/api/v1/consultorios/3/casos/9/evolucion';

const base = {
  casoId: 9,
  numeroCaso: 1,
  estadoCaso: 'ACTIVO',
  sesionesAnalizadas: 6,
  sesionesPresentes: 6,
  desde: '2026-09-01',
  hasta: '2026-11-10',
  advertencias: ['1 sesión del período no tiene caso asignado y no entra en el análisis.'],
  indicadores: {
    dolor: {
      puntos: [{ sesionId: 1, fecha: '2026-09-01', valor: 7 }],
      primero: 7,
      ultimo: 6,
      diferencia: -1,
    },
    mediciones: [],
    adherencia: {
      citas: 9,
      inasistencias: 3,
      ausentesEnTurno: 2,
      canceladosPorPaciente: 1,
      ausentesEnSesion: 0,
      porcentaje: 33,
    },
    frecuencia: { semanas: 4, realPorSemana: 1, planificadaPorSemana: 3 },
    tratamientos: [],
  },
};

/** M31: la seccion muestra lo que calcula el servidor y se esconde cuando la funcion esta apagada. */
describe('EvolucionDelCaso', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EvolucionDelCaso],
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
      consultorioId: 3,
      consultorioName: 'Sede',
    });
  });

  afterEach(() => httpMock.verify());

  it('con pocas sesiones muestra el aviso y no la lista de alertas', async () => {
    const fixture = await montar('Motivo declarado');
    const pedido = httpMock.expectOne(RUTA);
    expect(pedido.request.headers.get('X-Justificacion-Acceso')).toBe('Motivo declarado');
    pedido.flush({
      ...base,
      hallazgos: [
        {
          codigo: 'DATOS_INSUFICIENTES',
          severidad: 'INFO',
          texto: 'Hay 2 sesiones con asistencia.',
          sesiones: [],
          turnos: [],
        },
      ],
    });
    await estabilizar(fixture);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="evolucion-insuficiente"]')?.textContent).toContain(
      'Hay 2 sesiones',
    );
    expect(el.querySelector('[data-testid="evolucion-alertas"]')).toBeNull();
  });

  it('lista las alertas con su severidad en texto y enlaza las sesiones', async () => {
    const fixture = await montar(null);
    httpMock.expectOne(RUTA).flush({
      ...base,
      hallazgos: [
        {
          codigo: 'BAJA_ADHERENCIA',
          severidad: 'ATENCION',
          texto: 'Faltó a 3 de las últimas 6 citas (50 %).',
          sesiones: [],
          turnos: [7, 8],
        },
        {
          codigo: 'DOLOR_SIN_MEJORA',
          severidad: 'ATENCION',
          texto: 'El dolor pasó de 7 a 6.',
          sesiones: [11, 12],
          turnos: [],
        },
      ],
    });
    await estabilizar(fixture);

    const el = fixture.nativeElement as HTMLElement;
    const alertas = el.querySelectorAll('.evolucion__alerta');
    expect(alertas).toHaveLength(2);
    expect(alertas[0].textContent).toContain('Atención');
    expect(alertas[1].querySelectorAll('a')).toHaveLength(2);
    expect(el.textContent).toContain('3 inasistencias en 9 citas');
    expect(el.textContent).toContain('no tiene caso asignado');
  });

  it('con la función apagada (404) no muestra la sección', async () => {
    const fixture = await montar(null);
    httpMock.expectOne(RUTA).flush({ status: 404 }, { status: 404, statusText: 'N' });
    await estabilizar(fixture);

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="evolucion-del-caso"]'),
    ).toBeNull();
  });

  it('un 403 muestra el error sin ofrecer reintentar', async () => {
    const fixture = await montar(null);
    httpMock
      .expectOne(RUTA)
      .flush(
        { type: 'https://akine.app/problems/forbidden', status: 403 },
        { status: 403, statusText: 'F' },
      );
    await estabilizar(fixture);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('No pudimos calcular la evolución');
    expect(el.textContent).not.toContain('Reintentar');
  });

  it('arma las series con valores faltantes, el plan suspendido y los tratamientos', async () => {
    const fixture = await montar(null);
    httpMock.expectOne(RUTA).flush({
      ...base,
      sesionesAnalizadas: 1,
      hallazgos: [],
      plan: { estado: 'SUSPENDIDO', versionVigente: 2, completo: true, items: [] },
      indicadores: {
        ...base.indicadores,
        dolor: { puntos: [] },
        frecuencia: { semanas: 4, realPorSemana: 0.5 },
        mediciones: [
          {
            definicionId: 5,
            codigo: 'ROM',
            lateralidad: 'IZQUIERDA',
            unidad: 'grados',
            unidadesDifieren: false,
            serie: { puntos: [{ sesionId: 1 }], primero: 90, ultimo: 100, diferencia: 10 },
          },
          { definicionId: 6, lateralidad: 'NO_APLICA', unidadesDifieren: true },
        ],
        tratamientos: [{ practica: 'Fisioterapia', sesiones: 1, ultima: '2026-11-01' }],
      },
    });
    await estabilizar(fixture);

    const el = fixture.nativeElement as HTMLElement;
    const filas = el.querySelectorAll('tbody tr');
    expect(filas).toHaveLength(2);
    expect(filas[0].textContent).toContain('ROM');
    expect(filas[0].textContent).toContain('+10');
    expect(filas[1].textContent).toContain('Medida');
    expect(filas[1].textContent).toContain('—');
    expect(el.textContent).toContain('1 sesión analizada');
    expect(el.textContent).toContain('Suspendido');
    expect(el.textContent).toContain('completo');
    expect(el.textContent).toContain('Fisioterapia: 1 sesión');
  });

  it('sin sede elegida no pide nada y no muestra la sección', async () => {
    TestBed.inject(TenantContextStore).clear();
    const fixture = await montar(null);
    httpMock.expectNone(RUTA);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="evolucion-del-caso"]'),
    ).toBeNull();
  });

  async function montar(justificacion: string | null): Promise<ComponentFixture<EvolucionDelCaso>> {
    const fixture = TestBed.createComponent(EvolucionDelCaso);
    fixture.componentRef.setInput('casoId', 9);
    fixture.componentRef.setInput('justificacion', justificacion);
    await estabilizar(fixture);
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<EvolucionDelCaso>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
});
