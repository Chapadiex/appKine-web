import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { SubirLibro } from './subir-libro';

describe('SubirLibro', () => {
  it('no envia sin la declaracion de derechos y con ella sube con la query', async () => {
    await TestBed.configureTestingModule({
      imports: [SubirLibro],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();
    const httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
    const fixture = TestBed.createComponent(SubirLibro);
    fixture.componentRef.setInput('modo', 'subir');
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const entrada = el.querySelector<HTMLInputElement>('#subir-libro-archivo')!;
    const archivo = new File(['%PDF-1.4 sintetico'], 'libro.pdf', { type: 'application/pdf' });
    Object.defineProperty(entrada, 'files', {
      value: { 0: archivo, length: 1, item: () => archivo },
    });
    entrada.dispatchEvent(new Event('change'));
    const titulo = el.querySelector<HTMLInputElement>('#subir-libro-titulo')!;
    titulo.value = 'Kinesiología deportiva';
    titulo.dispatchEvent(new Event('input'));

    const enviar = () => el.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    enviar();
    fixture.detectChanges();
    await fixture.whenStable();
    httpMock.expectNone(() => true);
    expect(el.textContent).toContain('Tenés que declarar que el centro tiene derecho');

    el.querySelector<HTMLInputElement>('#subir-libro-declaracion')!.click();
    fixture.detectChanges();
    enviar();
    const peticion = httpMock.expectOne(
      (r) => r.method === 'POST' && r.url === '/api/v1/organizations/1/biblioteca/libros',
    );
    expect(peticion.request.params.get('declaracionDerechos')).toBe('true');
    expect(peticion.request.body instanceof FormData).toBe(true);
  });
});
