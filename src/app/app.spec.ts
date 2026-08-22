import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { App } from './app';
import { provideApi } from './api/generated/provide-api';

/**
 * Smoke del shell (AKINE-00.01).
 *
 * <p>Verifica el arranque y los tres estados que toda pantalla de AKINE debe manejar:
 * cargando, exito y error. El backend se simula con `HttpTestingController` para que el
 * test no dependa de que haya un servidor levantado.
 */
describe('App', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideApi('')],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('monta el shell', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    httpMock.expectOne('/api/v1/version').flush({
      application: 'akine-api',
      version: '0.0.1-SNAPSHOT',
      contract: '0.1.0',
    });

    expect(fixture.componentInstance).toBeTruthy();
  });

  it('expone un skip link como primer elemento enfocable', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    httpMock.expectOne('/api/v1/version').flush({
      application: 'akine-api',
      version: '0.0.1-SNAPSHOT',
      contract: '0.1.0',
    });

    const html = fixture.nativeElement as HTMLElement;
    const skipLink = html.querySelector<HTMLAnchorElement>('a.skip-link');

    expect(skipLink).toBeTruthy();
    expect(skipLink?.getAttribute('href')).toBe('#contenido');
    expect(html.querySelector('#contenido')).toBeTruthy();
  });

  it('consulta el contrato tecnico de version al arrancar', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const peticion = httpMock.expectOne('/api/v1/version');
    expect(peticion.request.method).toBe('GET');

    peticion.flush({
      application: 'akine-api',
      version: '0.0.1-SNAPSHOT',
      contract: '0.1.0',
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Conectado');
    expect(texto).toContain('akine-api');
  });

  it('muestra un estado de error accionable si el backend no responde', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    httpMock
      .expectOne('/api/v1/version')
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });

    await fixture.whenStable();
    fixture.detectChanges();

    const html = fixture.nativeElement as HTMLElement;
    const texto = html.textContent ?? '';

    expect(texto).toContain('No se pudo contactar al backend');
    // El error se anuncia por lector de pantalla, no solo visualmente.
    expect(html.querySelector('[role="alert"]')).toBeTruthy();
    // Y ofrece una salida, no solo un mensaje.
    expect(html.querySelector('button')).toBeTruthy();
  });
});

/**
 * Guarda de tipo del interceptor de errores: documenta que un fallo de red llega con
 * status 0 y debe distinguirse de un error del servidor.
 */
export function esErrorDeRed(error: HttpErrorResponse): boolean {
  return error.status === 0;
}
