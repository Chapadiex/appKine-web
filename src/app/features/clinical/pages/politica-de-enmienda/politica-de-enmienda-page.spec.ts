import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { PoliticaDeEnmiendaPage } from './politica-de-enmienda-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const POLITICA = '/api/v1/politica-de-enmienda';

/** Spec de la ventana de enmienda (DP-43, U-25). */
describe('PoliticaDeEnmiendaPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PoliticaDeEnmiendaPage],
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

  afterEach(() => httpMock.verify());

  it(
    'la politica por defecto se fija con version nula',
    async () => {
      const fixture = await montar({ ventanaDias: 30, porDefecto: true });
      expect(texto(fixture)).toContain('30 dias');
      expect(texto(fixture)).toContain('valor por defecto');
      await esperarSinViolaciones(fixture.nativeElement);

      escribir(fixture, '60');
      enviar(fixture);
      const pedido = httpMock.expectOne((p) => p.method === 'PUT' && p.url === POLITICA);
      expect(pedido.request.body).toEqual({ ventanaDias: 60 });
      pedido.flush({ ventanaDias: 60, porDefecto: false, version: 0 });
      await estabilizar(fixture);
      expect(texto(fixture)).toContain('durante 60 dias');
    },
    TIMEOUT_AXE,
  );

  it('achicar la ventana avisa que alcanza a las cerradas y manda la version', async () => {
    const fixture = await montar({ ventanaDias: 60, porDefecto: false, version: 2 });
    escribir(fixture, '10');
    expect(texto(fixture)).toContain('alcanza a las sesiones ya cerradas');
    enviar(fixture);
    const pedido = httpMock.expectOne((p) => p.method === 'PUT');
    expect(pedido.request.body).toEqual({ ventanaDias: 10, version: 2 });
    pedido.flush(
      { type: 'https://akine.app/problems/concurrent-modification', status: 409 },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);
    httpMock.expectOne((p) => p.method === 'GET').flush({ ventanaDias: 45, version: 3 });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('45 dias');
  });

  it('fuera de rango no deja guardar', async () => {
    const fixture = await montar({ ventanaDias: 30, porDefecto: true });
    escribir(fixture, '4000');
    expect(texto(fixture)).toContain('Indica un numero entero');
    enviar(fixture);
    httpMock.expectNone((p) => p.method === 'PUT');
  });

  it('el 403 explica que es del administrador de la organizacion', async () => {
    const fixture = TestBed.createComponent(PoliticaDeEnmiendaPage);
    fixture.detectChanges();
    httpMock
      .expectOne(POLITICA)
      .flush(
        { type: 'https://akine.app/problems/forbidden', status: 403 },
        { status: 403, statusText: 'Forbidden' },
      );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('quien administra la organizacion');
    (
      Array.from(
        fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
      ).find((b) => (b.textContent ?? '').includes('Reintentar')) as HTMLButtonElement
    ).click();
    httpMock.expectOne(POLITICA).flush({ ventanaDias: 30, porDefecto: true });
  });

  async function montar(politica: object): Promise<ComponentFixture<PoliticaDeEnmiendaPage>> {
    const fixture = TestBed.createComponent(PoliticaDeEnmiendaPage);
    fixture.detectChanges();
    httpMock.expectOne((p) => p.method === 'GET' && p.url === POLITICA).flush(politica);
    await estabilizar(fixture);
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<PoliticaDeEnmiendaPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function escribir(fixture: ComponentFixture<PoliticaDeEnmiendaPage>, valor: string): void {
    const campo = fixture.nativeElement.querySelector('#politica-dias') as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function enviar(fixture: ComponentFixture<PoliticaDeEnmiendaPage>): void {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    fixture.detectChanges();
  }

  function texto(fixture: ComponentFixture<PoliticaDeEnmiendaPage>): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }
});
