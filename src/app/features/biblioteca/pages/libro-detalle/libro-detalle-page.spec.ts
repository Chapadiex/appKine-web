import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { RELECTURA_MS } from '../../models/relectura';
import { LibroDetallePage } from './libro-detalle-page';

const LIBRO_URL = '/api/v1/organizations/1/biblioteca/libros/10';

describe('LibroDetallePage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LibroDetallePage],
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

  it('un 404 durante la relectura corta el sondeo y ofrece Volver a la biblioteca', () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(LibroDetallePage);
    fixture.componentRef.setInput('libroId', '10');
    fixture.detectChanges();
    httpMock.expectOne(LIBRO_URL).flush({
      libro: { id: 10, titulo: 'Original', estado: 'PROCESANDO', version: 1 },
      fragmentos: 4,
      fragmentosConVector: 1,
      sospechosos: [],
    });
    fixture.detectChanges();

    vi.advanceTimersByTime(RELECTURA_MS);
    httpMock.expectOne(LIBRO_URL).flush(
      { type: 'https://akine.app/problems/libro-no-encontrado', status: 404 },
      { status: 404, statusText: 'Not Found' },
    );
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Volver a la biblioteca');
    vi.advanceTimersByTime(RELECTURA_MS * 2);
    httpMock.expectNone(LIBRO_URL);
  });

  it('ante un 409 concurrent-modification conserva lo tipeado y ofrece Recargar', () => {
    const fixture = TestBed.createComponent(LibroDetallePage);
    fixture.componentRef.setInput('libroId', '10');
    fixture.detectChanges();
    httpMock.expectOne(LIBRO_URL).flush({
      libro: { id: 10, titulo: 'Original', estado: 'LISTO', version: 3 },
      fragmentos: 4,
      fragmentosConVector: 4,
      sospechosos: [],
    });
    fixture.detectChanges();

    boton(fixture, 'Editar datos').click();
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '#libro-titulo',
    )!;
    input.value = 'Título tipeado';
    input.dispatchEvent(new Event('input'));
    boton(fixture, 'Guardar').click();

    const put = httpMock.expectOne((p) => p.method === 'PUT' && p.url === LIBRO_URL);
    expect(put.request.body.version).toBe(3);
    put.flush(
      { type: 'https://akine.app/problems/concurrent-modification', status: 409 },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector<HTMLInputElement>('#libro-titulo')?.value).toBe('Título tipeado');
    expect(boton(fixture, 'Recargar')).toBeDefined();
  });

  function boton(fixture: ComponentFixture<LibroDetallePage>, rotulo: string): HTMLButtonElement {
    const b = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ).find((x) => x.textContent?.trim() === rotulo);
    expect(b).toBeDefined();
    return b!;
  }
});
