import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { RELECTURA_MS } from '../../models/relectura';
import { BibliotecaPage } from './biblioteca-page';

const LIBROS = '/api/v1/organizations/1/biblioteca/libros';

const LIBRO = { id: 10, titulo: 'Kinesiología deportiva', autores: 'A. Sintética', version: 0 };

/**
 * Lista de la biblioteca (M30). Cubre lo que decide comportamiento: la relectura mientras se
 * procesa y su corte, la biblioteca apagada y el rotulo del reemplazo pendiente.
 */
describe('BibliotecaPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [BibliotecaPage],
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
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
  });

  afterEach(() => {
    httpMock.verify();
    vi.useRealTimers();
  });

  it('relee cada 5 s mientras se procesa y deja de hacerlo cuando ya no queda ninguno', () => {
    const fixture = montar();
    pedido().flush(pagina([{ ...LIBRO, estado: 'PROCESANDO', progreso: 40 }]));
    fixture.detectChanges();
    expect(texto(fixture)).toContain('40 %');

    vi.advanceTimersByTime(RELECTURA_MS);
    pedido().flush(pagina([{ ...LIBRO, estado: 'LISTO' }]));
    fixture.detectChanges();
    expect(texto(fixture)).toContain('Listo');

    vi.advanceTimersByTime(RELECTURA_MS * 2);
    httpMock.expectNone((p) => p.url === LIBROS);
  });

  it('con la biblioteca apagada explica el estado y bloquea subir libro', () => {
    const fixture = montar();
    pedido().flush(
      { type: 'https://akine.app/problems/biblioteca-deshabilitada', status: 409 },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();

    expect(texto(fixture)).toContain('La biblioteca no está habilitada');
    expect(botonConTexto(fixture, 'Subir libro').disabled).toBe(true);

    vi.advanceTimersByTime(RELECTURA_MS * 2);
    httpMock.expectNone((p) => p.url === LIBROS);
  });

  it('una fila de reemplazo pendiente ni su original ofrecen reemplazar ni desactivar', () => {
    const fixture = montar();
    pedido().flush(
      pagina([
        { ...LIBRO, estado: 'LISTO' },
        { id: 11, titulo: 'Archivo nuevo', estado: 'LISTO', reemplazaLibroId: 10, version: 0 },
      ]),
    );
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Reemplazo de «Kinesiología deportiva»');
    const filas = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('tbody tr'),
    );
    expect(filas[0].textContent).not.toContain('Reemplazar archivo');
    expect(filas[0].textContent).not.toContain('Desactivar');
    expect(filas[1].textContent).not.toContain('Reemplazar archivo');
    expect(filas[1].textContent).not.toContain('Desactivar');
  });

  function montar(): ComponentFixture<BibliotecaPage> {
    const fixture = TestBed.createComponent(BibliotecaPage);
    fixture.detectChanges();
    return fixture;
  }

  function pedido() {
    return httpMock.expectOne((p) => p.url === LIBROS);
  }

  function pagina(content: object[]): object {
    return { content, page: 0, size: 10, totalElements: content.length, totalPages: 1 };
  }

  function texto(fixture: ComponentFixture<BibliotecaPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function botonConTexto(fixture: ComponentFixture<BibliotecaPage>, rotulo: string) {
    const boton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => b.textContent?.trim() === rotulo);
    expect(boton).toBeDefined();
    return boton as HTMLButtonElement;
  }
});
