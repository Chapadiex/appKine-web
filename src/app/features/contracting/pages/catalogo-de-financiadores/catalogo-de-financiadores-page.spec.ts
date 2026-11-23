import { AvisosStore } from '../../../../core/services/avisos.store';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { CatalogoDeFinanciadoresPage } from './catalogo-de-financiadores-page';
import { PERMISO_CONVENIO_MANAGE, PERMISO_CONVENIO_READ } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const CATALOGO = '/api/v1/catalogo-financiadores';

const ENTRADAS = [
  {
    id: 11,
    codigo: 'OSDE',
    nombre: 'OSDE',
    tipo: 'PREPAGA',
    cuit: '30546741253',
    estado: 'ACTIVO',
    planes: [{ id: 1, codigo: '210', nombre: 'Plan 210' }],
  },
  {
    id: 12,
    codigo: 'IOSFA',
    nombre: 'IOSFA',
    tipo: 'OBRA_SOCIAL',
    estado: 'ACTIVO',
    financiadorAdoptadoId: 77,
    actualizacionDisponible: true,
    planes: [],
  },
];

/**
 * Spec de la adopcion desde el catalogo global (DP-43, U-12).
 *
 * <p>Lo que decide comportamiento: una entrada sin copia ofrece agregarla y una con copia enlaza a
 * ella; 201 y 200 navegan igual a la copia; y sin `convenio:manage` no se ofrece adoptar.
 */
describe('CatalogoDeFinanciadoresPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CatalogoDeFinanciadoresPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it(
    'lista el catalogo: marca lo que ya esta en el centro y deja marcar lo que falta',
    async () => {
      const fixture = await montar();
      const texto = textoDe(fixture);

      expect(texto).toContain('OSDE');
      expect(texto).toContain('En el centro');
      expect(texto).not.toContain('Ver la copia del centro');
      // Solo lo que falta se puede marcar; lo adoptado no tiene casilla.
      expect(casilla(fixture, 'Marcar OSDE')).not.toBeNull();
      expect(casilla(fixture, 'Marcar IOSFA')).toBeNull();

      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  it('tocar una fila abre el panel con sus planes', async () => {
    const fixture = await montar();

    filaDe(fixture, 'OSDE').click();
    await asentar(fixture);

    const panel = panelDe(fixture);
    expect(panel?.textContent).toContain('Plan 210');
    expect(panel?.textContent).toContain('Código 210');
    expect(panel?.textContent).toContain('Se agrega con todos sus planes');
  });

  it.each([
    [201, true],
    [200, false],
  ])('agregar desde el panel (%s) se queda en el catalogo y relee', async (status, creado) => {
    const fixture = await montar();
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    filaDe(fixture, 'OSDE').click();
    await asentar(fixture);

    botonEn(panelDe(fixture), 'Agregar al centro')?.click();
    const pedido = httpMock.expectOne(`${CATALOGO}/11/adopcion`);
    expect(pedido.request.method).toBe('POST');
    pedido.flush(
      { creado, financiador: { id: 90, nombre: 'OSDE', catalogoId: 11 }, planes: [] },
      { status, statusText: status === 201 ? 'Created' : 'OK' },
    );
    await asentar(fixture);
    httpMock
      .expectOne((p) => p.url === CATALOGO)
      .flush([{ ...ENTRADAS[0], financiadorAdoptadoId: 90 }, ENTRADAS[1]]);
    await asentar(fixture);

    expect(navegar).not.toHaveBeenCalled();
    expect(panelDe(fixture)?.textContent).toContain('Ya está en el centro');
  });

  it('lo ya agregado lleva desde el panel a sus planes en el centro', async () => {
    const fixture = await montar();
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    filaDe(fixture, 'IOSFA').click();
    await asentar(fixture);

    const panel = panelDe(fixture);
    expect(panel?.textContent).toContain('El catálogo cambió después de agregarlo');
    botonEn(panel, 'Ver sus planes en el centro')?.click();

    expect(navegar).toHaveBeenCalledWith(['/contratacion', 'financiadores', 77, 'planes']);
  });

  it('marcar varios y agregarlos juntos: una adopcion por cada uno y un solo aviso', async () => {
    const otra = { id: 13, codigo: 'APROSS', nombre: 'APROSS', tipo: 'OBRA_SOCIAL', planes: [] };
    const fixture = await montar(undefined, [...ENTRADAS, otra]);

    marcar(fixture, 'Marcar OSDE');
    marcar(fixture, 'Marcar APROSS');
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('2 financiadores marcados');

    boton(fixture, 'Agregar al centro (2)')?.click();
    httpMock.expectOne(`${CATALOGO}/11/adopcion`).flush({ creado: true, financiador: { id: 90 } });
    httpMock.expectOne(`${CATALOGO}/13/adopcion`).flush({ creado: true, financiador: { id: 91 } });
    await asentar(fixture);
    httpMock
      .expectOne((p) => p.url === CATALOGO)
      .flush([
        { ...ENTRADAS[0], financiadorAdoptadoId: 90 },
        ENTRADAS[1],
        { ...otra, financiadorAdoptadoId: 91 },
      ]);
    await asentar(fixture);

    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toBe('2 financiadores agregados al centro');
    expect(textoDe(fixture)).not.toContain('marcados');
  });

  it('una entrada dada de baja mientras tanto explica el 409 y relee', async () => {
    const fixture = await montar();
    filaDe(fixture, 'OSDE').click();
    await asentar(fixture);

    botonEn(panelDe(fixture), 'Agregar al centro')?.click();
    httpMock.expectOne(`${CATALOGO}/11/adopcion`).flush(
      {
        type: 'https://akine.app/problems/financiador-inactivo',
        status: 409,
        detail: 'La entrada del catalogo esta dada de baja.',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await asentar(fixture);
    httpMock.expectOne((p) => p.url === CATALOGO).flush([ENTRADAS[1]]);
    await asentar(fixture);

    // La entrada dejo de listarse: el panel se cierra solo y no queda nada para agregar.
    expect(panelDe(fixture)).toBeNull();
    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.tipo).toBe('error');
    expect(aviso?.titulo).toContain('No pudimos agregar');
    expect(aviso?.descripcion).toBeTruthy();
  });

  it('buscar manda q y tipo', async () => {
    const fixture = await montar();
    const raiz = fixture.nativeElement as HTMLElement;
    const campo = raiz.querySelector('#catalogo-busqueda') as HTMLInputElement;
    campo.value = 'osde';
    campo.dispatchEvent(new Event('input'));
    const tipo = raiz.querySelector('#catalogo-tipo') as HTMLSelectElement;
    tipo.value = 'PREPAGA';
    tipo.dispatchEvent(new Event('change'));
    boton(fixture, 'Buscar')?.click();

    const pedido = httpMock.expectOne((p) => p.url === CATALOGO);
    expect(pedido.request.params.get('q')).toBe('osde');
    expect(pedido.request.params.get('tipo')).toBe('PREPAGA');
    pedido.flush([]);
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Ninguna entrada del catálogo coincide');

    // Vacio con filtros aplicados (UX-14): ofrece limpiarlos y vuelve a pedir el catalogo entero.
    const raizVacia = fixture.nativeElement as HTMLElement;
    expect(raizVacia.querySelector('app-estado-vacio')?.textContent).toContain(
      'No encontramos financiadores en el catálogo',
    );
    boton(fixture, 'Limpiar filtros')?.click();
    const entero = httpMock.expectOne((p) => p.url === CATALOGO);
    expect(entero.request.params.has('q')).toBe(false);
    expect(entero.request.params.has('tipo')).toBe(false);
    entero.flush(ENTRADAS);
    await asentar(fixture);
    expect(raizVacia.querySelector('app-estado-vacio')).toBeNull();
  });

  it('sin entradas y sin filtros dice que el catalogo todavia esta vacio', async () => {
    const fixture = await montar(undefined, []);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('app-estado-vacio')?.textContent,
    ).toContain('El catálogo todavía no tiene financiadores');
    expect(boton(fixture, 'Limpiar filtros')).toBeNull();
  });

  it('sigue el patron de listado: resultados en la toolbar, pie y sin titulo repetido', async () => {
    const fixture = await montar();
    const raiz = fixture.nativeElement as HTMLElement;
    expect(raiz.querySelector('section.tarjeta h2')).toBeNull();
    expect(raiz.querySelector('.filtros-barra__resultados')?.textContent?.trim()).toBe(
      `${ENTRADAS.length} ${ENTRADAS.length === 1 ? 'financiador' : 'financiadores'}`,
    );
    expect(raiz.querySelector('.paginacion-pie__resumen')?.textContent).toBe(
      `Mostrando 1–${ENTRADAS.length} de ${ENTRADAS.length}`,
    );
  });

  it('sin `convenio:manage` no ofrece agregar', async () => {
    const fixture = await montar([PERMISO_CONVENIO_READ]);
    expect(textoDe(fixture)).toContain('Podés mirar el catálogo');
    expect(boton(fixture, 'Agregar al centro')).toBeNull();
  });

  async function montar(
    permisos: string[] = [PERMISO_CONVENIO_READ, PERMISO_CONVENIO_MANAGE],
    entradas: readonly unknown[] = ENTRADAS,
  ): Promise<ComponentFixture<CatalogoDeFinanciadoresPage>> {
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
    TestBed.inject(PermissionsStore).cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: permisos });

    const fixture = TestBed.createComponent(CatalogoDeFinanciadoresPage);
    fixture.detectChanges();
    httpMock.expectOne((p) => p.url === CATALOGO).flush(entradas);
    await asentar(fixture);
    return fixture;
  }

  async function asentar(fixture: ComponentFixture<CatalogoDeFinanciadoresPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function textoDe(fixture: ComponentFixture<CatalogoDeFinanciadoresPage>): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  function boton(
    fixture: ComponentFixture<CatalogoDeFinanciadoresPage>,
    texto: string,
  ): HTMLButtonElement | null {
    return (
      (
        Array.from(
          (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
        ) as HTMLButtonElement[]
      ).find((b) => (b.textContent ?? '').includes(texto)) ?? null
    );
  }

  function filaDe(
    fixture: ComponentFixture<CatalogoDeFinanciadoresPage>,
    nombre: string,
  ): HTMLTableRowElement {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLTableRowElement>('tbody tr'),
    ).find((fila) => fila.querySelector('th')?.textContent?.includes(nombre))!;
  }

  function panelDe(fixture: ComponentFixture<CatalogoDeFinanciadoresPage>): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector('app-panel-lateral');
  }

  function botonEn(raiz: HTMLElement | null, texto: string): HTMLButtonElement | null {
    return (
      Array.from(raiz?.querySelectorAll<HTMLButtonElement>('button') ?? []).find((b) =>
        (b.textContent ?? '').includes(texto),
      ) ?? null
    );
  }

  function casilla(
    fixture: ComponentFixture<CatalogoDeFinanciadoresPage>,
    etiqueta: string,
  ): HTMLInputElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(
      `input[type="checkbox"][aria-label="${etiqueta}"]`,
    );
  }

  function marcar(fixture: ComponentFixture<CatalogoDeFinanciadoresPage>, etiqueta: string): void {
    const input = casilla(fixture, etiqueta)!;
    input.checked = true;
    input.dispatchEvent(new Event('change'));
  }
});
