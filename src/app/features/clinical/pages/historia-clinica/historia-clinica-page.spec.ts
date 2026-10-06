import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { HistoriaClinicaPage } from './historia-clinica-page';
import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';

const PERSONA = 12;
const HC = 88;
const HISTORIA_POR_PERSONA = `/api/v1/historias-clinicas/por-persona/${PERSONA}`;
const TIMELINE = `/api/v1/historias-clinicas/${HC}/timeline`;
const CASOS = `/api/v1/historias-clinicas/${HC}/casos`;
const HEADER = 'X-Justificacion-Acceso';

const HISTORIA = {
  id: HC,
  personaId: PERSONA,
  personaNombreCompleto: 'Prueba, Lucia',
  personaDocumento: 'DNI 30111222',
  abiertaEn: '2026-09-01T12:00:00Z',
  resumen: 'Lumbalgia cronica.',
  antecedentes: [{ id: 5, tipo: 'ALERGIA', descripcion: 'Penicilina', vigente: true }],
  version: 2,
};

const PAGINA = {
  eventos: [
    {
      ocurrioEn: '2026-09-10T15:00:00Z',
      origen: 'ENTRADA_CLINICA',
      referencia: 41,
      tipo: 'EVOLUCION',
      titulo: 'Entrada clinica',
    },
  ],
};

const SIN_RELACION = {
  type: 'https://akine.app/problems/forbidden',
  status: 403,
  detail: 'Hace falta declarar el motivo del acceso.',
  requiereJustificacion: true,
};

/**
 * La pantalla de la Historia Clinica (D-a). Lo que se prueba es lo que no se ve en el E2E feliz:
 * que el motivo viaje en CADA pedido de la visita y no solo en el primero, y que un pedido sin
 * motivo no salga cuando el campo esta vacio.
 */
describe('HistoriaClinicaPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HistoriaClinicaPage],
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

  it('sin relacion asistencial pide motivo, y despues lo manda en cada pedido de la visita', async () => {
    const fixture = await montar();

    const primero = httpMock.expectOne((r) => r.url === HISTORIA_POR_PERSONA);
    expect(primero.request.headers.has(HEADER)).toBe(false);
    primero.flush(SIN_RELACION, { status: 403, statusText: 'Forbidden' });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Declara el motivo del acceso');

    // Vacio no sale nada.
    enviarMotivo(fixture, '   ');
    await estabilizar(fixture);
    httpMock.expectNone((r) => r.url === HISTORIA_POR_PERSONA);
    expect(texto(fixture)).toContain('Sin motivo no se puede abrir la historia.');

    enviarMotivo(fixture, 'Interconsulta');
    const conMotivo = httpMock.expectOne((r) => r.url === HISTORIA_POR_PERSONA);
    expect(conMotivo.request.headers.get(HEADER)).toBe('Interconsulta');
    conMotivo.flush(HISTORIA);
    await estabilizar(fixture);

    // El timeline y los casos del filtro tambien llevan el motivo: cada lectura se audita.
    const timeline = httpMock.expectOne((r: HttpRequest<unknown>) => r.url === TIMELINE);
    const casos = httpMock.expectOne((r: HttpRequest<unknown>) => r.url === CASOS);
    expect(timeline.request.headers.get(HEADER)).toBe('Interconsulta');
    expect(casos.request.headers.get(HEADER)).toBe('Interconsulta');
    timeline.flush(PAGINA);
    casos.flush([]);
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Prueba, Lucia');
    expect(texto(fixture)).toContain('Con motivo declarado');
    expect(texto(fixture)).toContain('Penicilina');
  });

  it('una persona sin historia ofrece abrirla, y abrirla muestra la historia', async () => {
    const fixture = await montar();
    httpMock
      .expectOne((r) => r.url === HISTORIA_POR_PERSONA && r.method === 'GET')
      .flush(
        { type: 'https://akine.app/problems/not-found', status: 404 },
        { status: 404, statusText: 'NF' },
      );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Todavia no tiene historia clinica');

    boton(fixture, 'Abrir la historia clinica').click();
    httpMock.expectOne((r) => r.url === HISTORIA_POR_PERSONA && r.method === 'PUT').flush(HISTORIA);
    await estabilizar(fixture);
    httpMock.expectOne((r) => r.url === TIMELINE).flush({ eventos: [] });
    httpMock.expectOne((r) => r.url === CASOS).flush([]);
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Prueba, Lucia');
    expect(texto(fixture)).toContain('Todavia no hay hechos clinicos registrados');
  });

  it('sin permiso no ofrece reintentar: no es algo que se resuelva insistiendo', async () => {
    const fixture = await montar();
    httpMock
      .expectOne((r) => r.url === HISTORIA_POR_PERSONA)
      .flush(
        { type: 'https://akine.app/problems/forbidden', status: 403 },
        { status: 403, statusText: 'F' },
      );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No tenes permiso para ver historias clinicas');
    expect(botonOpcional(fixture, 'Reintentar')).toBeNull();
  });

  it(
    'con la historia cargada no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      httpMock.expectOne((r) => r.url === HISTORIA_POR_PERSONA).flush(HISTORIA);
      await estabilizar(fixture);
      httpMock.expectOne((r) => r.url === TIMELINE).flush(PAGINA);
      httpMock.expectOne((r) => r.url === CASOS).flush([]);
      await estabilizar(fixture);

      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  async function montar(): Promise<ComponentFixture<HistoriaClinicaPage>> {
    const fixture = TestBed.createComponent(HistoriaClinicaPage);
    fixture.componentRef.setInput('personaId', String(PERSONA));
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<HistoriaClinicaPage>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function texto(fixture: ComponentFixture<HistoriaClinicaPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function botonOpcional(
    fixture: ComponentFixture<HistoriaClinicaPage>,
    rotulo: string,
  ): HTMLButtonElement | null {
    const botones = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    return Array.from(botones).find((b) => b.textContent?.trim() === rotulo) ?? null;
  }

  function boton(
    fixture: ComponentFixture<HistoriaClinicaPage>,
    rotulo: string,
  ): HTMLButtonElement {
    const encontrado = botonOpcional(fixture, rotulo);
    if (encontrado === null) {
      throw new Error(`No hay boton "${rotulo}"`);
    }
    return encontrado;
  }

  function enviarMotivo(fixture: ComponentFixture<HistoriaClinicaPage>, motivo: string): void {
    const raiz = fixture.nativeElement as HTMLElement;
    const campo = raiz.querySelector('#motivo-acceso') as HTMLInputElement;
    campo.value = motivo;
    campo.dispatchEvent(new Event('input'));
    boton(fixture, 'Ver la historia clinica').click();
    fixture.detectChanges();
  }
});
