import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { Estado } from './estado';
import { provideApi } from '../../../../api/generated/provide-api';

const RESPUESTA_VERSION = {
  application: 'akine-api',
  version: '0.0.1-SNAPSHOT',
  contract: '0.1.0',
};

/**
 * Spec de la pagina de estado (AKINE-00.01, reubicada en AKINE-00.02).
 *
 * <p>Cubre los tres estados obligatorios de ADR-0005. El backend se simula con
 * `HttpTestingController`: el test no depende de que haya un servidor levantado.
 */
describe('Estado', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Estado],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideApi('')],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('consulta el contrato tecnico de version al arrancar', async () => {
    const fixture = TestBed.createComponent(Estado);
    fixture.detectChanges();

    const peticion = httpMock.expectOne('/api/v1/version');
    expect(peticion.request.method).toBe('GET');

    peticion.flush(RESPUESTA_VERSION);
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Conectado');
    expect(texto).toContain('akine-api');
    expect(texto).toContain('0.1.0');
  });

  it('muestra el estado de carga antes de la respuesta', () => {
    const fixture = TestBed.createComponent(Estado);
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Comprobando conexion');

    httpMock.expectOne('/api/v1/version').flush(RESPUESTA_VERSION);
  });

  it('muestra un estado de error accionable si el backend no responde', async () => {
    const fixture = TestBed.createComponent(Estado);
    fixture.detectChanges();

    httpMock
      .expectOne('/api/v1/version')
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });

    await fixture.whenStable();
    fixture.detectChanges();

    const html = fixture.nativeElement as HTMLElement;

    expect(html.textContent).toContain('No se pudo contactar al backend');
    // Se anuncia por lector de pantalla, no solo visualmente.
    expect(html.querySelector('[role="alert"]')).toBeTruthy();
    // Y ofrece una salida, no solo un mensaje.
    expect(html.querySelector('button')).toBeTruthy();
  });

  it('el boton de reintento vuelve a consultar el backend', async () => {
    const fixture = TestBed.createComponent(Estado);
    fixture.detectChanges();

    httpMock
      .expectOne('/api/v1/version')
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    const boton = (fixture.nativeElement as HTMLElement).querySelector('button');
    boton?.click();
    fixture.detectChanges();

    httpMock.expectOne('/api/v1/version').flush(RESPUESTA_VERSION);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Conectado');
  });
});
