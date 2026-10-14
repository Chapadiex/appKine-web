import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';

import { ImportarArancelesPage } from './importar-aranceles-page';
import { PERMISO_CONVENIO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS, rutaConvenios } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const SEDE = 3;
const CONVENIO = 7;
const IMPORTACION = `${rutaConvenios(SEDE)}/${CONVENIO}/aranceles/importacion`;

const EL_CONVENIO = {
  id: CONVENIO,
  consultorioId: SEDE,
  codigo: 'CONV-OSDE-210',
  nombre: 'OSDE 210 kinesiologia',
  moneda: 'ARS',
  vigenciaDesde: '2027-01-01',
  vigenciaHasta: '2027-12-31',
  estado: 'ACTIVO',
  vigente: true,
  version: 2,
};

const PLANILLA = [
  'codigoPractica;importeTotal;importeFinanciador;coseguro;vigenciaDesde',
  'KIN-01;12000;9000;3000;2027-01-01',
  'KIN-02;8000;8000;0;2027-01-01',
].join('\n');

const TODAS_ENTRAN = {
  modo: 'PREVIEW',
  aplicada: false,
  totalFilas: 2,
  filasConAlta: 2,
  filasRechazadas: 0,
  filas: [
    { fila: 1, estado: 'ALTA', practicaId: 55 },
    { fila: 2, estado: 'ALTA', practicaId: 56 },
  ],
};

const SEGUNDA_SOLAPADA = {
  fila: 2,
  estado: 'RECHAZADA',
  practicaId: 56,
  problemType: 'https://akine.app/problems/arancel-solapado',
  arancelExistenteId: 900,
  detalle: 'Se pisa con el vigente.',
};

/**
 * Spec de la importacion masiva de aranceles (RF-M16-007, AKINE-B-7).
 *
 * <p>Los cuatro casos que importan: el preview manda el lote parseado; "Confirmar" solo con todas
 * las filas en ALTA <b>y</b> sobre el mismo texto que se previsualizo; la confirmacion vuelve a la
 * grilla; y el 409 todo-o-nada muestra las filas rechazadas diciendo que no se escribio nada.
 */
describe('ImportarArancelesPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImportarArancelesPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ convenioId: String(CONVENIO) }) } },
        },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    tenantContext = TestBed.inject(TenantContextStore);
    permisos = TestBed.inject(PermissionsStore);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('el formato malo se marca por linea y no deja pedir la vista previa', async () => {
    const fixture = await montar();
    pegar(
      fixture,
      'codigoPractica;importeTotal;importeFinanciador;coseguro;vigenciaDesde\nKIN-01;1,234;1;0;2027-01-01',
    );

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Linea 2:');
    expect(texto).toContain('mas de dos decimales');
    expect(boton(fixture, 'Vista previa').disabled).toBe(true);
  });

  it('la vista previa manda las filas parseadas y, si todas entran, habilita confirmar', async () => {
    const fixture = await montar();
    expect(boton(fixture, 'Vista previa').disabled).toBe(true);
    pegar(fixture, PLANILLA);

    boton(fixture, 'Vista previa').click();
    const preview = httpMock.expectOne(esImportacion());
    expect(preview.request.body).toEqual({
      modo: 'PREVIEW',
      filas: [
        {
          codigoPractica: 'KIN-01',
          importeTotal: 12000,
          importeFinanciador: 9000,
          coseguro: 3000,
          vigenciaDesde: '2027-01-01',
        },
        {
          codigoPractica: 'KIN-02',
          importeTotal: 8000,
          importeFinanciador: 8000,
          coseguro: 0,
          vigenciaDesde: '2027-01-01',
        },
      ],
    });
    preview.flush(TODAS_ENTRAN);
    await estable(fixture);

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Las 2 filas entran');
    expect(texto).toContain('KIN-01 (#55)');
    expect(texto).toContain('ARS 12000.00');
    expect(boton(fixture, 'Confirmar 2 aranceles').disabled).toBe(false);

    // Tocar la planilla despues del preview la deja sin describir: hay que volver a pedirlo.
    pegar(fixture, PLANILLA + '\n');
    expect(boton(fixture, 'Confirmar 2 aranceles').disabled).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('ya no la describe');
  });

  it('una fila rechazada en el preview se explica y bloquea la confirmacion', async () => {
    const fixture = await montar();
    pegar(fixture, PLANILLA);
    boton(fixture, 'Vista previa').click();
    httpMock.expectOne(esImportacion()).flush({
      ...TODAS_ENTRAN,
      filasConAlta: 1,
      filasRechazadas: 1,
      filas: [TODAS_ENTRAN.filas[0], SEGUNDA_SOLAPADA],
    });
    await estable(fixture);

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('1 de 2 filas no entrarian');
    expect(texto).toContain('Se pisa con el arancel #900');
    expect(texto).toContain('Se pisa con el vigente.');
    expect(boton(fixture, 'Confirmar 2 aranceles').disabled).toBe(true);
  });

  it('confirmar manda el mismo lote en modo CONFIRMAR y vuelve a la grilla', async () => {
    const fixture = await montar();
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await previsualizarTodasEntran(fixture);

    boton(fixture, 'Confirmar 2 aranceles').click();
    const confirmacion = httpMock.expectOne(esImportacion());
    expect((confirmacion.request.body as { modo: string }).modo).toBe('CONFIRMAR');
    expect((confirmacion.request.body as { filas: unknown[] }).filas.length).toBe(2);
    confirmacion.flush({ ...TODAS_ENTRAN, modo: 'CONFIRMAR', aplicada: true });
    await estable(fixture);

    expect(navegar).toHaveBeenCalledWith([`/contratacion/convenios/${CONVENIO}/aranceles`], {
      queryParams: { importados: 2 },
    });
  });

  it('el 409 todo-o-nada muestra las filas rechazadas y dice que no se cargo nada', async () => {
    const fixture = await montar();
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigate');
    await previsualizarTodasEntran(fixture);

    boton(fixture, 'Confirmar 2 aranceles').click();
    httpMock.expectOne(esImportacion()).flush(
      {
        type: 'https://akine.app/problems/importacion-aranceles-rechazada',
        status: 409,
        detail: 'Una fila no entra.',
        filas: [TODAS_ENTRAN.filas[0], SEGUNDA_SOLAPADA],
      },
      { status: 409, statusText: 'Conflict' },
    );
    await estable(fixture);

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Confirmacion rechazada');
    expect(texto).toContain('No se cargo ningun arancel: 1 de 2 filas');
    expect(texto).toContain('Se pisa con el arancel #900');
    expect(botonOpcional(fixture, 'Confirmar 2 aranceles')).toBeUndefined();
    expect(navegar).not.toHaveBeenCalled();
  });

  it('otro error de la confirmacion se traduce sin perder el preview', async () => {
    const fixture = await montar();
    await previsualizarTodasEntran(fixture);

    boton(fixture, 'Confirmar 2 aranceles').click();
    httpMock
      .expectOne(esImportacion())
      .flush(
        { type: 'https://akine.app/problems/forbidden', status: 403 },
        { status: 403, statusText: 'Forbidden' },
      );
    await estable(fixture);

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('administrar convenios');
    expect(boton(fixture, 'Confirmar 2 aranceles').disabled).toBe(false);
  });

  it('subir un CSV lo deja en el cuadro de texto', async () => {
    const fixture = await montar();
    const entrada = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '#importacion-archivo',
    );
    const archivo = new File(['\uFEFF' + PLANILLA], 'osde-2027.csv', { type: 'text/csv' });
    Object.defineProperty(entrada, 'files', { value: [archivo] });
    entrada?.dispatchEvent(new Event('change'));
    await new Promise((resolver) => setTimeout(resolver, 0));
    await estable(fixture);

    const area = (fixture.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>(
      '#importacion-texto',
    );
    expect(area?.value).toBe(PLANILLA);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('osde-2027.csv');
    expect(boton(fixture, 'Vista previa').disabled).toBe(false);
  });

  it('un convenio dado de baja no ofrece importar', async () => {
    const fixture = await montar({ ...EL_CONVENIO, estado: 'INACTIVO' });
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'no admite aranceles nuevos',
    );
    expect(botonOpcional(fixture, 'Vista previa')).toBeUndefined();
  });

  it(
    'la pantalla no tiene violaciones de accesibilidad con el resultado a la vista',
    async () => {
      const fixture = await montar();
      pegar(fixture, PLANILLA);
      boton(fixture, 'Vista previa').click();
      httpMock
        .expectOne(esImportacion())
        .flush({ ...TODAS_ENTRAN, filas: [TODAS_ENTRAN.filas[0], SEGUNDA_SOLAPADA] });
      await estable(fixture);
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  async function previsualizarTodasEntran(fixture: ComponentFixture<ImportarArancelesPage>) {
    pegar(fixture, PLANILLA);
    boton(fixture, 'Vista previa').click();
    httpMock.expectOne(esImportacion()).flush(TODAS_ENTRAN);
    await estable(fixture);
  }

  async function montar(
    convenio: Record<string, unknown> = EL_CONVENIO,
  ): Promise<ComponentFixture<ImportarArancelesPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_CONVENIO_MANAGE] });

    const fixture = TestBed.createComponent(ImportarArancelesPage);
    fixture.detectChanges();

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) => peticion.url === `${rutaConvenios(SEDE)}/${CONVENIO}`,
      )
      .flush(convenio);
    await estable(fixture);
    return fixture;
  }
});

function esImportacion() {
  return (peticion: HttpRequest<unknown>) =>
    peticion.method === 'POST' && peticion.url === IMPORTACION;
}

async function estable(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

function pegar(fixture: ComponentFixture<unknown>, texto: string): void {
  const area = (fixture.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>(
    '#importacion-texto',
  );
  if (area === null) {
    throw new Error('No existe el cuadro de la planilla');
  }
  area.value = texto;
  area.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function botonOpcional(
  fixture: ComponentFixture<unknown>,
  etiqueta: string,
): HTMLButtonElement | undefined {
  return [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
    (candidato) => (candidato.textContent ?? '').trim() === etiqueta,
  );
}

function boton(fixture: ComponentFixture<unknown>, etiqueta: string): HTMLButtonElement {
  const encontrado = botonOpcional(fixture, etiqueta);
  if (encontrado === undefined) {
    throw new Error(`No existe el boton ${etiqueta}`);
  }
  return encontrado;
}
