import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { VersionesPage } from './versiones-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const CONSULTORIO = 3;
const SESION = 501;
const VER = `/api/v1/consultorios/${CONSULTORIO}/sesiones/${SESION}`;
const VERSIONES = `${VER}/versiones`;

const CERRADA = {
  id: SESION,
  turnoId: 77,
  numeroSesion: 8,
  cerradaEn: '2026-09-15T12:48:00Z',
  cierre: { asistencia: 'PRESENTE' },
};

const TRATAMIENTO = {
  tratamientoId: 900,
  orden: 1,
  practicaNombre: 'Electroterapia',
  zona: 'rodilla',
  lateralidad: 'DERECHA',
  parametros: [{ clave: 'Intensidad', tipoDato: 'NUMERICO', valorNumerico: 20, unidad: 'mA' }],
};

const V1 = {
  numeroVersion: 1,
  registradaEn: '2026-09-15T12:48:00Z',
  registradaPor: 41,
  notaDeCierre: 'Original.',
  dolorEva: 7,
  tratamientos: [TRATAMIENTO],
  mediciones: [
    {
      definicionId: 11,
      lateralidad: 'DERECHA',
      nombre: 'Flexion',
      valorNumerico: 90,
      unidad: 'grados',
    },
  ],
};
const V2 = {
  numeroVersion: 2,
  registradaEn: '2026-09-16T10:00:00Z',
  registradaPor: 41,
  motivoEnmienda: 'La intensidad era otra',
  notaDeCierre: 'Original.',
  dolorEva: 7,
  tratamientos: [
    { ...TRATAMIENTO, parametros: [{ ...TRATAMIENTO.parametros[0], valorNumerico: 25 }] },
  ],
  mediciones: [],
};

/**
 * Spec del historial de versiones (AKINE-06.06, RF-M24-005).
 *
 * <p>Lo que decide comportamiento: por defecto se compara la ultima contra la anterior, lo que
 * cambio se dice con una palabra, lo que desaparecio (una medicion quitada) se ve, y una sesion
 * sin versiones no es un error.
 */
describe('VersionesPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VersionesPage],
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
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });
  });

  afterEach(() => httpMock.verify());

  it('compara la ultima contra la anterior y nombra lo que cambio', async () => {
    const fixture = await montar();

    const filas = filasDeComparacion(fixture);
    const tratamiento = filas.find((f) => f[0].startsWith('Tratamiento: Electroterapia'));
    expect(tratamiento?.[1]).toContain('Intensidad: 20 mA');
    expect(tratamiento?.[2]).toContain('Intensidad: 25 mA');
    expect(tratamiento?.[3]).toBe('Cambio');

    const medicion = filas.find((f) => f[0].startsWith('Medicion: Flexion'));
    expect(medicion?.[1]).toBe('90 grados');
    expect(medicion?.[2]).toBe('Sin cargar');
    expect(medicion?.[3]).toBe('Cambio');

    expect(filas.find((f) => f[0] === 'Nota de cierre')?.[3]).toBe('Igual');
    expect(texto(fixture)).toContain('Cambiaron 2 campos');
    expect(texto(fixture)).toContain('La intensidad era otra');
  });

  it('elegir la misma version de los dos lados dice que no cambio nada', async () => {
    const fixture = await montar();
    const antes = fixture.nativeElement.querySelector('#version-antes') as HTMLSelectElement;
    antes.value = '2';
    antes.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(texto(fixture)).toContain('Las dos versiones dicen lo mismo');
  });

  it('lista todas las versiones, la mas nueva primero, con su motivo', async () => {
    const fixture = await montar();
    const resumenes = Array.from(
      fixture.nativeElement.querySelectorAll('summary') as NodeListOf<HTMLElement>,
    ).map((s) => s.textContent ?? '');
    expect(resumenes[0]).toContain('Version 2');
    expect(resumenes[1]).toContain('Version 1');
    expect(resumenes[1]).toContain('original');
  });

  it('con una sola version no ofrece comparar', async () => {
    const fixture = await montar([V1]);
    expect(fixture.nativeElement.querySelector('#version-antes')).toBeNull();
    expect(texto(fixture)).toContain('Todas las versiones');
  });

  it('sin versiones lo dice como un estado, no como un error', async () => {
    const fixture = await montar([], { ...CERRADA, numeroSesion: undefined, cierre: undefined });
    expect(texto(fixture)).toContain('todavia no tiene versiones');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('un error de lectura se explica y ofrece reintentar', async () => {
    const fixture = TestBed.createComponent(VersionesPage);
    fixture.componentRef.setInput('sesionId', String(SESION));
    fixture.detectChanges();
    httpMock
      .expectOne((p) => p.url === VER)
      .flush(
        { type: 'https://akine.app/problems/not-found', status: 404 },
        { status: 404, statusText: 'Not Found' },
      );
    // forkJoin cancela la otra lectura al fallar la primera.
    httpMock.match((p) => p.url === VERSIONES);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(texto(fixture)).toContain('No se pudieron leer las versiones');
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------

  async function montar(
    versiones: object[] = [V1, V2],
    sesion: object = CERRADA,
  ): Promise<ComponentFixture<VersionesPage>> {
    const fixture = TestBed.createComponent(VersionesPage);
    fixture.componentRef.setInput('sesionId', String(SESION));
    fixture.detectChanges();
    httpMock.expectOne((p) => p.url === VER).flush(sesion);
    httpMock.expectOne((p) => p.url === VERSIONES).flush(versiones);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function filasDeComparacion(fixture: ComponentFixture<VersionesPage>): string[][] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('tbody tr') as NodeListOf<HTMLTableRowElement>,
    ).map((fila) =>
      Array.from(fila.querySelectorAll('th, td')).map((celda) => (celda.textContent ?? '').trim()),
    );
  }

  function texto(fixture: ComponentFixture<VersionesPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }
});
