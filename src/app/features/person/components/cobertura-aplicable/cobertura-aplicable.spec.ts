import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CoberturaAplicable } from './cobertura-aplicable';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const PERSONA = 7;
const OFERTA = 31;
const CONSULTA = `/api/v1/personas/${PERSONA}/cobertura-aplicable`;
const PRACTICAS = `/api/v1/consultorios/3/ofertas/${OFERTA}/practicas`;

/**
 * OSDE aplica con el arancel PROPIO de la oferta; Swiss Medical es vigente pero no tiene convenio.
 * Es el caso que la pantalla existe para explicar: una cobertura vigente puede no aplicar.
 */
const RESPUESTA_COBERTURA = {
  personaId: PERSONA,
  ofertaId: OFERTA,
  fecha: '2026-10-07',
  admiteObraSocial: true,
  condicionSugerida: 'COBERTURA',
  moneda: 'ARS',
  precioParticular: 15000,
  aplicables: [
    {
      coberturaId: 300,
      financiadorNombre: 'OSDE',
      planNombre: '210',
      principal: true,
      practicaId: 55,
      credencialVencida: true,
      credencialVigenciaHasta: '2026-09-30',
      arancel: {
        ofertaId: OFERTA,
        convenioCodigo: 'CONV-OSDE',
        importeTotal: 12000,
        importeFinanciador: 9000,
        coseguro: 3000,
        requiereOrden: true,
      },
    },
  ],
  noAplicables: [
    {
      coberturaId: 301,
      financiadorNombre: 'Swiss Medical',
      planNombre: 'SMG20',
      motivo: 'SIN_CONVENIO_VIGENTE',
      practicas: [
        { practicaId: 55, principal: true, motivo: 'SIN_CONVENIO_VIGENTE' },
        { practicaId: 56, motivo: 'SIN_ARANCEL_VIGENTE' },
      ],
    },
  ],
};

const PRACTICAS_DE_LA_OFERTA = {
  ofertaId: OFERTA,
  practicas: [
    { practicaId: 55, nombre: 'Sesion de kinesiologia', codigo: 'KIN-01', estado: 'ACTIVO' },
    { practicaId: 56, nombre: 'Fonoaudiologia', estado: 'ACTIVO' },
  ],
};

describe('CoberturaAplicable', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CoberturaAplicable],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideApi(''),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
  });

  afterEach(() => httpMock.verify());

  it('sin oferta elegida no pregunta nada', async () => {
    const fixture = await montar(null);
    httpMock.expectNone(() => true);
    expect(texto(fixture)).toContain('Elegi una oferta');
  });

  it('explica la que aplica, con su arancel, y por que no las otras', async () => {
    const fixture = await montar(OFERTA, '2026-10-07');
    httpMock
      .expectOne(`${CONSULTA}?ofertaId=${OFERTA}&fecha=2026-10-07`)
      .flush(RESPUESTA_COBERTURA);
    httpMock.expectOne(PRACTICAS).flush(PRACTICAS_DE_LA_OFERTA);
    await estabilizar(fixture);

    const contenido = texto(fixture);
    expect(contenido).toContain('atender con cobertura');
    expect(contenido).toContain('Sesion de kinesiologia (KIN-01)');
    // El arancel de la oferta manda sobre el general, y la pantalla dice cual salio.
    expect(contenido).toContain('Arancel propio de esta oferta en el convenio CONV-OSDE');
    expect(contenido).toContain('Pide orden medica.');
    expect(contenido).toContain('La credencial esta vencida');
    // Particular siempre esta disponible, aunque una cobertura aplique.
    expect(contenido).toMatch(/Precio particular del dia:\s*\$\s*15\.000,00/);
    // La no aplicable dice por que, tambien por practica.
    expect(contenido).toContain('no tiene convenio vigente con este financiador');
    expect(contenido).toContain('Fonoaudiologia: Hay convenio, pero sin arancel vigente');
  });

  it('sin coberturas sugiere particular, y un error se puede reintentar', async () => {
    const fixture = await montar(OFERTA);
    // Las practicas primero: un error de la consulta cancela la peticion hermana del forkJoin.
    httpMock.expectOne(PRACTICAS).flush(PRACTICAS_DE_LA_OFERTA);
    httpMock
      .expectOne(`${CONSULTA}?ofertaId=${OFERTA}`)
      .flush(
        { type: 'https://akine.app/problems/not-found', status: 404, detail: 'x' },
        { status: 404, statusText: 'Not Found' },
      );
    await estabilizar(fixture);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();

    (fixture.nativeElement as HTMLElement).querySelector('button')?.click();
    fixture.detectChanges();
    httpMock
      .expectOne(`${CONSULTA}?ofertaId=${OFERTA}`)
      .flush({ condicionSugerida: 'PARTICULAR', admiteObraSocial: false, aplicables: [] });
    httpMock.expectOne(PRACTICAS).flush(PRACTICAS_DE_LA_OFERTA);
    await estabilizar(fixture);

    const contenido = texto(fixture);
    expect(contenido).toContain('atender como particular');
    expect(contenido).toContain('la oferta no tiene precio cargado');
    expect(contenido).toContain('Esta oferta no admite obra social');
    expect(contenido).toContain('no tiene coberturas financiadas vigentes');
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar(OFERTA);
      httpMock.expectOne(`${CONSULTA}?ofertaId=${OFERTA}`).flush(RESPUESTA_COBERTURA);
      httpMock.expectOne(PRACTICAS).flush(PRACTICAS_DE_LA_OFERTA);
      await estabilizar(fixture);
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  async function montar(
    ofertaId: number | null,
    fecha = '',
  ): Promise<ComponentFixture<CoberturaAplicable>> {
    const fixture = TestBed.createComponent(CoberturaAplicable);
    fixture.componentRef.setInput('personaId', PERSONA);
    fixture.componentRef.setInput('ofertaId', ofertaId);
    fixture.componentRef.setInput('fecha', fecha);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<CoberturaAplicable>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function texto(fixture: ComponentFixture<CoberturaAplicable>): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }
});
