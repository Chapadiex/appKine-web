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
    'lista el catalogo: ofrece agregar lo que falta y enlaza a la copia de lo adoptado',
    async () => {
      const fixture = await montar();
      const texto = textoDe(fixture);

      expect(texto).toContain('OSDE');
      expect(texto).toContain('Ya agregado');
      expect(texto).toContain('El catálogo cambio después de agregarlo');
      expect(enlaceA(fixture, '/contratacion/financiadores/77/planes')).not.toBeNull();
      expect(botones(fixture)).toContain('Agregar al centro OSDE');

      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  it.each([
    [201, true],
    [200, false],
  ])('adoptar (%s) navega a la copia del centro', async (status, creado) => {
    const fixture = await montar();
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    boton(fixture, 'Agregar al centro')?.click();
    const pedido = httpMock.expectOne(`${CATALOGO}/11/adopcion`);
    expect(pedido.request.method).toBe('POST');
    pedido.flush(
      { creado, financiador: { id: 90, nombre: 'OSDE', catalogoId: 11 }, planes: [] },
      { status, statusText: status === 201 ? 'Created' : 'OK' },
    );
    await asentar(fixture);

    expect(navegar).toHaveBeenCalledWith(['/contratacion', 'financiadores', 90, 'planes']);
  });

  it('una entrada dada de baja mientras tanto explica el 409 y relee', async () => {
    const fixture = await montar();

    boton(fixture, 'Agregar al centro')?.click();
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

    expect(textoDe(fixture)).not.toContain('Agregar al centro');
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')).not.toBeNull();
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
  });

  it('sin `convenio:manage` no ofrece agregar', async () => {
    const fixture = await montar([PERMISO_CONVENIO_READ]);
    expect(textoDe(fixture)).toContain('Podés mirar el catálogo');
    expect(boton(fixture, 'Agregar al centro')).toBeNull();
  });

  async function montar(
    permisos: string[] = [PERMISO_CONVENIO_READ, PERMISO_CONVENIO_MANAGE],
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
    httpMock.expectOne((p) => p.url === CATALOGO).flush(ENTRADAS);
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

  function botones(fixture: ComponentFixture<CatalogoDeFinanciadoresPage>): string[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).map((b) =>
      (b.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
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

  function enlaceA(
    fixture: ComponentFixture<CatalogoDeFinanciadoresPage>,
    href: string,
  ): HTMLAnchorElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(`a[href="${href}"]`);
  }
});
