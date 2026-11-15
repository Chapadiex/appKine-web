import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { MedicionesPage } from './mediciones-page';
import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';

const LISTA = '/api/v1/mediciones/definiciones';

const rom = {
  id: 5,
  alcance: 'ORGANIZACION',
  codigo: 'ROM_RODILLA',
  name: 'ROM de rodilla',
  tipo: 'NUMERICO',
  unidad: 'grados',
  minimo: 0,
  maximo: 160,
  mejoraCuando: 'SUBE',
  estado: 'ACTIVO',
  version: 3,
};
const borg = {
  id: 6,
  alcance: 'GLOBAL',
  codigo: 'BORG',
  name: 'Escala de Borg',
  tipo: 'ESCALA',
  unidad: 'puntos',
  estado: 'ACTIVO',
  version: 0,
};
const marcha = {
  id: 7,
  alcance: 'ORGANIZACION',
  codigo: 'MARCHA',
  name: 'Marcha',
  tipo: 'TEXTO',
  estado: 'ACTIVO',
  version: 0,
};

/** M31 (RF-M31-003): el sentido de mejora se ve en la tabla y viaja al guardar. */
describe('MedicionesPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MedicionesPage],
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

  afterEach(() => {
    httpMock
      .match(RUTA_PERMISOS_EFECTIVOS)
      .forEach((r) => r.flush({ permissions: ['consultorio:manage'] }));
    httpMock.verify();
  });

  it('muestra el sentido de mejora, "No aplica" en texto y no ofrece editar lo de la plataforma', async () => {
    const fixture = await montar();
    const el = fixture.nativeElement as HTMLElement;
    const filas = Array.from(el.querySelectorAll('tbody tr')).map((tr) => tr.textContent ?? '');

    expect(filas.find((f) => f.includes('ROM de rodilla'))).toContain('Mejora cuando sube');
    expect(filas.find((f) => f.includes('Marcha'))).toContain('No aplica');
    expect(filas.find((f) => f.includes('Borg'))).toContain('La mantiene AKINE');
  });

  it('el alta manda el sentido de mejora elegido', async () => {
    const fixture = await montar();
    const pagina = fixture.componentInstance as unknown as {
      abrirAlta(): void;
      guardar(): void;
      formulario: { setValue(v: unknown): void };
    };
    pagina.abrirAlta();
    pagina.formulario.setValue({
      codigo: 'EVA',
      name: 'Dolor EVA',
      descripcion: '',
      tipo: 'ESCALA',
      unidad: 'puntos',
      minimo: '0',
      maximo: '10',
      mejoraCuando: 'BAJA',
    });
    pagina.guardar();

    const alta = httpMock.expectOne((r) => r.method === 'POST' && r.url === LISTA);
    expect(alta.request.body).toMatchObject({
      codigo: 'EVA',
      tipo: 'ESCALA',
      mejoraCuando: 'BAJA',
      minimo: 0,
      maximo: 10,
    });
    alta.flush({ ...rom, id: 9, name: 'Dolor EVA' });
    httpMock.expectOne((r) => r.method === 'GET' && r.url === LISTA).flush({ content: [rom] });
  });

  it('dejar "Sin definir" en una medida que lo tenia manda clearMejoraCuando', async () => {
    const fixture = await montar();
    const pagina = fixture.componentInstance as unknown as {
      abrirEdicion(d: unknown): void;
      guardar(): void;
      formulario: { patchValue(v: unknown): void };
    };
    pagina.abrirEdicion(rom);
    pagina.formulario.patchValue({ mejoraCuando: '' });
    pagina.guardar();

    const edicion = httpMock.expectOne((r) => r.method === 'PATCH' && r.url === `${LISTA}/5`);
    expect(edicion.request.body).toMatchObject({ clearMejoraCuando: true, version: 3 });
    expect(edicion.request.body.mejoraCuando).toBeUndefined();
    edicion.flush({ ...rom, mejoraCuando: undefined });
    httpMock.expectOne((r) => r.method === 'GET' && r.url === LISTA).flush({ content: [] });
  });

  async function montar(): Promise<ComponentFixture<MedicionesPage>> {
    const fixture = TestBed.createComponent(MedicionesPage);
    fixture.detectChanges();
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === LISTA)
      .flush({ content: [rom, borg, marcha] });
    httpMock
      .match(RUTA_PERMISOS_EFECTIVOS)
      .forEach((r) => r.flush({ permissions: ['consultorio:manage'] }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }
});
