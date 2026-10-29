import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CasosDeLaHistoria } from './casos-de-la-historia';
import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { VisitaClinica } from '../../services/visita-clinica';
import { AvisosStore } from '../../../../core/services/avisos.store';

const CASOS = '/api/v1/historias-clinicas/88/casos';
const OFERTAS = '/api/v1/consultorios/3/ofertas';
const HABILITACIONES = '/api/v1/consultorios/3/ofertas/14/habilitaciones';

const ACTIVO = {
  id: 9,
  numeroCaso: 1,
  estado: 'ACTIVO',
  ofertaId: 14,
  ofertaConsultorioId: 3,
  ofertaNombre: 'Kinesiologia',
  diagnosticoPresuntivo: 'Lumbalgia',
  equipo: [
    {
      profesionalMembershipId: 31,
      profesionalNombre: 'Lopez, Maria',
      rol: 'RESPONSABLE',
      vigente: true,
    },
  ],
};
// Sin nombre resuelto (oferta dada de baja en otra sede): se ve el id, no un nombre inventado.
const CERRADO = {
  ...ACTIVO,
  id: 8,
  numeroCaso: 2,
  estado: 'CERRADO',
  ofertaNombre: undefined,
  equipo: [],
};

/**
 * Los casos de la historia (D-b): activos y cerrados por separado, con nombres de la sede, y el
 * alta compacta con el aviso de posible duplicado, que se resuelve CONFIRMANDO, no reintentando.
 */
describe('CasosDeLaHistoria', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CasosDeLaHistoria],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', children: [] }]),
        provideApi(''),
        VisitaClinica,
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro',
      consultorioId: 3,
      consultorioName: 'Sede',
    });
    TestBed.inject(VisitaClinica).iniciar(12);
  });

  afterEach(() => httpMock.verify());

  it('lista los activos primero y muestra la oferta y el equipo por nombre', async () => {
    // El servidor los manda con el cerrado primero: la tabla pone los activos arriba igual.
    const fixture = await montar([CERRADO, ACTIVO]);
    const lineas = filas(fixture);
    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toContain('Caso 1 · Kinesiologia');
    expect(lineas[0]).toContain('Lopez, Maria (Responsable)');
    expect(lineas[0]).toContain('Activo');
    expect(lineas[1]).toContain('Caso 2 · Oferta #14');
    expect(lineas[1]).toContain('Cerrado');
    // Los nombres vienen en el caso (0.107.0): no se piden habilitaciones solo para resolverlos.
    httpMock.expectNone(HABILITACIONES);
  });

  it('sigue el patron de listado: toolbar con resultados, orden, pie y busqueda (UX-14)', async () => {
    const fixture = await montar();
    const raiz = fixture.nativeElement as HTMLElement;
    expect(raiz.querySelector('.filtros-barra__resultados')?.textContent).toContain('2 casos');
    expect(raiz.querySelector('.paginacion-pie__resumen')?.textContent).toContain(
      'Mostrando 1–2 de 2',
    );

    // Ordenar por caso, descendente: el 2 arriba aunque este cerrado.
    const caso = raiz.querySelector('th.tabla__columna-ordenable button') as HTMLButtonElement;
    caso.click();
    caso.click();
    fixture.detectChanges();
    expect(raiz.querySelector('th[aria-sort]')?.getAttribute('aria-sort')).toBe('descending');
    expect(filas(fixture)[0]).toContain('Caso 2');

    buscar(fixture, 'oferta #14');
    expect(filas(fixture)).toHaveLength(1);
    expect(raiz.querySelector('.filtros-barra__resultados')?.textContent).toContain('1 caso');
  });

  it('el filtro de estado acota y, sin coincidencias, ofrece limpiar los filtros', async () => {
    const fixture = await montar();
    elegir(fixture, '#filtro-estado-caso', 'CERRADOS');
    expect(filas(fixture)).toHaveLength(1);
    expect(filas(fixture)[0]).toContain('Caso 2');

    buscar(fixture, 'kinesiologia');
    const vacio = (fixture.nativeElement as HTMLElement).querySelector('app-estado-vacio');
    expect(vacio?.textContent).toContain('No encontramos casos');
    (
      Array.from(vacio?.querySelectorAll('button') ?? []).find((b) =>
        b.textContent?.includes('Limpiar filtros'),
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(filas(fixture)).toHaveLength(2);
  });

  it('sin casos lo dice con el estado vacio, no con una tabla vacia', async () => {
    const fixture = await montar([]);
    const vacio = (fixture.nativeElement as HTMLElement).querySelector('app-estado-vacio');
    expect(vacio?.textContent).toContain('Todavía no hay casos clínicos');
    expect((fixture.nativeElement as HTMLElement).querySelector('table')).toBeNull();
  });

  it('pagina de a 10 con el pie estandar', async () => {
    const muchos = Array.from({ length: 12 }, (_, i) => ({
      ...ACTIVO,
      id: 100 + i,
      numeroCaso: i + 1,
    }));
    const fixture = await montar(muchos);
    const raiz = fixture.nativeElement as HTMLElement;
    expect(filas(fixture)).toHaveLength(10);
    expect(raiz.querySelector('.paginacion-pie__resumen')?.textContent).toContain(
      'Mostrando 1–10 de 12',
    );
    (
      Array.from(raiz.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Página siguiente'),
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(filas(fixture)).toHaveLength(2);
  });

  it('el posible duplicado muestra los candidatos y confirmar reenvia con la marca', async () => {
    const fixture = await montar();
    // El alta se abre en un panel lateral desde la fila del titulo, no debajo de la lista.
    expect((fixture.nativeElement as HTMLElement).querySelector('form')).toBeNull();
    (
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Abrir un caso'),
      ) as HTMLButtonElement
    ).click();
    await estabilizar(fixture);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('dialog.panel-lateral form'),
    ).not.toBeNull();
    elegir(fixture, '#caso-oferta', '14');
    httpMock.expectOne(HABILITACIONES).flush({ profesionales: [] });
    escribir(fixture, '#caso-diagnostico', 'Cervicalgia');
    enviar(fixture);

    httpMock
      .expectOne((r) => r.url === CASOS && r.method === 'POST')
      .flush(
        {
          type: 'https://akine.app/problems/caso-clinico-posible-duplicado',
          status: 409,
          candidatos: [9],
        },
        { status: 409, statusText: 'C' },
      );
    await estabilizar(fixture);
    // Coincidencia con lo que ya existe: advertencia arriba del formulario, con las salidas.
    const alerta = (fixture.nativeElement as HTMLElement).querySelector('form app-alerta');
    expect(alerta?.getAttribute('role')).toBe('alert');
    expect(alerta?.textContent).toContain('Ya hay un caso parecido para esta persona');
    expect(alerta?.textContent).toContain('Ver el caso 1');

    const confirmar = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.includes('Abrir igual'));
    confirmar?.click();
    const segundo = httpMock.expectOne((r) => r.url === CASOS && r.method === 'POST');
    expect(segundo.request.body).toEqual({
      ofertaId: 14,
      diagnosticoPresuntivo: 'Cervicalgia',
      confirmaPosibleDuplicado: true,
    });
    segundo.flush({ id: 10, numeroCaso: 3 });
    await estabilizar(fixture);
    // El aviso vive en el shell y sobrevive a la navegacion al caso nuevo (UX-12).
    expect(TestBed.inject(AvisosStore).avisos()[0]).toEqual(
      expect.objectContaining({ titulo: 'Caso abierto', descripcion: 'Caso 3' }),
    );
  });

  async function montar(
    casos: readonly object[] = [ACTIVO, CERRADO],
  ): Promise<ComponentFixture<CasosDeLaHistoria>> {
    const fixture = TestBed.createComponent(CasosDeLaHistoria);
    fixture.componentRef.setInput('historiaClinicaId', 88);
    await estabilizar(fixture);
    httpMock
      .expectOne(OFERTAS + '?estado=TODOS')
      .flush([{ id: 14, nombreComercial: 'Kinesio (listado de la sede)', estado: 'ACTIVO' }]);
    httpMock.expectOne((r) => r.url === CASOS && r.method === 'GET').flush(casos);
    await estabilizar(fixture);
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<CasosDeLaHistoria>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function filas(fixture: ComponentFixture<CasosDeLaHistoria>): string[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr'),
      (fila) => fila.textContent ?? '',
    );
  }

  function buscar(fixture: ComponentFixture<CasosDeLaHistoria>, valor: string): void {
    const campo = (fixture.nativeElement as HTMLElement).querySelector(
      '#busqueda-casos',
    ) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function elegir(fixture: ComponentFixture<CasosDeLaHistoria>, sel: string, valor: string): void {
    const select = (fixture.nativeElement as HTMLElement).querySelector(sel) as HTMLSelectElement;
    select.value = valor;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function escribir(
    fixture: ComponentFixture<CasosDeLaHistoria>,
    sel: string,
    valor: string,
  ): void {
    const campo = (fixture.nativeElement as HTMLElement).querySelector(sel) as HTMLTextAreaElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function enviar(fixture: ComponentFixture<CasosDeLaHistoria>): void {
    const form = (fixture.nativeElement as HTMLElement).querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }
});
