import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { AltaDeCentroPage } from './alta-de-centro-page';
import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { AvisosStore } from '../../../../core/services/avisos.store';

const PLANES = '/api/v1/plans';
const ALTA = '/api/v1/platform/organizations';
const PEDIDO = '/api/v1/platform/solicitudes-de-prueba/7';

const limite = (value: number | null) => [
  value === null
    ? { code: 'MAX_CONSULTORIOS', unlimited: true }
    : { code: 'MAX_CONSULTORIOS', value, unlimited: false },
];

const CATALOGO = [
  { code: 'BASICO', name: 'Basico', ofrecido: false, limits: limite(1) },
  { code: 'BASE', name: 'Base', ofrecido: true, limits: limite(1) },
  { code: 'CRECIMIENTO', name: 'Crecimiento', ofrecido: true, limits: limite(3) },
  { code: 'RED', name: 'Red', ofrecido: true, limits: limite(null) },
];

const PEDIDO_PENDIENTE = {
  id: 7,
  nombre: 'Ana',
  apellido: 'Prueba',
  email: 'duenia@centro.test',
  nombreCentro: 'Centro Sintético',
  kinesiologia: false,
  actividades: true,
  interesaIa: true,
  sedes: 'MAS_DE_TRES',
  estado: 'PENDIENTE',
  version: 0,
};

/**
 * El alta de un centro: que mande el cuerpo del contrato con los planes ofrecidos, y que con un
 * pedido de prueba prellene lo pedido, sugiera el plan por las sedes y mande `solicitudId`.
 */
describe('AltaDeCentroPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AltaDeCentroPage],
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

  it('ofrece solo los planes ofrecidos y manda el alta en prueba sin pedido', async () => {
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = await abrir();
    const planes = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('.opcion-en-tarjeta'),
    ].map((p) =>
      [...p.querySelectorAll('.opcion-en-tarjeta__textos > span')].map((t) =>
        t.textContent?.trim(),
      ),
    );
    expect(planes).toEqual([
      ['Base', 'Hasta 1 sede'],
      ['Crecimiento', 'Hasta 3 sedes'],
      ['Red', 'Sin tope de sedes'],
    ]);

    escribir(fixture, '#alta-nombre-centro', '  Centro Nuevo ');
    escribir(fixture, '#alta-email', 'duenio@centro.test');
    enviar(fixture);

    const alta = httpMock.expectOne(ALTA);
    expect(alta.request.method).toBe('POST');
    expect(alta.request.body).toEqual({
      nombreCentro: 'Centro Nuevo',
      zonaHoraria: 'America/Argentina/Cordoba',
      emailDuenio: 'duenio@centro.test',
      planCode: 'BASE',
      servicios: ['KINESIOLOGIA'],
      adicionales: [],
      prueba: true,
    });
    alta.flush({ organizationId: 9, emailDuenio: 'duenio@centro.test' });
    await estabilizar(fixture);

    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toBe('Centro creado');
    expect(aviso?.descripcion).toBe('Invitamos a duenio@centro.test como administrador.');
    expect(navegar).toHaveBeenCalledWith(['/plataforma/suscripciones'], {
      queryParams: { org: 9, nombre: 'Centro Nuevo' },
    });
  });

  it('con un pedido prellena lo pedido, sugiere el plan por las sedes y lo aprueba', async () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = await abrir('7');

    expect(valor(fixture, '#alta-nombre-centro')).toBe('Centro Sintético');
    expect(valor(fixture, '#alta-email')).toBe('duenia@centro.test');
    enviar(fixture);

    const alta = httpMock.expectOne(ALTA);
    expect(alta.request.body).toEqual({
      nombreCentro: 'Centro Sintético',
      zonaHoraria: 'America/Argentina/Cordoba',
      emailDuenio: 'duenia@centro.test',
      planCode: 'RED',
      servicios: ['ACTIVIDADES'],
      adicionales: ['IA'],
      prueba: true,
      solicitudId: 7,
    });
    alta.flush({ organizationId: 10, emailDuenio: 'duenia@centro.test' });
    await estabilizar(fixture);
  });

  it('si otra persona ya resolvió el pedido no crea nada y lo dice', async () => {
    const fixture = await abrir('7');
    enviar(fixture);
    httpMock
      .expectOne(ALTA)
      .flush(
        { type: 'https://akine.app/problems/concurrent-modification', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);
    expect(texto(fixture, 'form app-alerta')).toContain('Otra persona ya resolvió ese pedido');
  });

  it('no manda nada sin servicios y marca el campo', async () => {
    const fixture = await abrir();
    escribir(fixture, '#alta-nombre-centro', 'Centro');
    escribir(fixture, '#alta-email', 'duenio@centro.test');
    const kinesiologia = fixture.nativeElement.querySelector(
      'fieldset input[type="checkbox"]',
    ) as HTMLInputElement;
    kinesiologia.click();
    enviar(fixture);
    httpMock.expectNone(ALTA);
    expect(texto(fixture, '#alta-servicios-error')).toBe('Elegí al menos un servicio.');
  });

  async function abrir(solicitud?: string): Promise<ComponentFixture<AltaDeCentroPage>> {
    const fixture = TestBed.createComponent(AltaDeCentroPage);
    if (solicitud) fixture.componentRef.setInput('solicitud', solicitud);
    fixture.detectChanges();
    httpMock.expectOne(PLANES).flush(CATALOGO);
    if (solicitud) httpMock.expectOne(PEDIDO).flush(PEDIDO_PENDIENTE);
    await estabilizar(fixture);
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<AltaDeCentroPage>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function escribir(fixture: ComponentFixture<AltaDeCentroPage>, selector: string, v: string) {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    campo.value = v;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function valor(fixture: ComponentFixture<AltaDeCentroPage>, selector: string): string {
    return (fixture.nativeElement.querySelector(selector) as HTMLInputElement).value;
  }

  function enviar(fixture: ComponentFixture<AltaDeCentroPage>): void {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    fixture.detectChanges();
  }

  function texto(fixture: ComponentFixture<AltaDeCentroPage>, selector: string): string {
    return (
      (fixture.nativeElement as HTMLElement).querySelector(selector)?.textContent?.trim() ?? ''
    );
  }
});
