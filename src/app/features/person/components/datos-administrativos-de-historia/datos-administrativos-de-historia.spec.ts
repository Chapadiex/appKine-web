import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DatosAdministrativosDeHistoria } from './datos-administrativos-de-historia';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const PERSONA = 12;
const DATOS = `/api/v1/historias-clinicas/por-persona/${PERSONA}/datos-administrativos`;
const OFERTAS = '/api/v1/consultorios/3/ofertas';
const HABILITACIONES = '/api/v1/consultorios/3/ofertas/14/habilitaciones';

const CON_HISTORIA = {
  personaId: PERSONA,
  tieneHistoriaClinica: true,
  historiaClinicaId: 88,
  abiertaEn: '2026-03-02T13:00:00Z',
  casos: [
    {
      id: 301,
      numeroCaso: 2,
      estado: 'ACTIVO',
      ofertaId: 14,
      ofertaConsultorioId: 3,
      abiertoEn: '2026-09-19T11:02:44Z',
      equipo: [
        { id: 1, profesionalMembershipId: 31, rol: 'RESPONSABLE', vigente: true },
        { id: 2, profesionalMembershipId: 32, rol: 'TRATANTE', vigente: true },
        {
          id: 3,
          profesionalMembershipId: 33,
          rol: 'TRATANTE',
          vigente: false,
          hasta: '2026-09-25T10:00:00Z',
        },
      ],
    },
    {
      id: 300,
      numeroCaso: 1,
      estado: 'CERRADO',
      ofertaId: 99,
      ofertaConsultorioId: 8,
      abiertoEn: '2026-03-02T13:00:00Z',
      cerradoEn: '2026-05-10T15:00:00Z',
      equipo: [],
    },
  ],
};

/**
 * Los metadatos de la HC en el 360: si hay historia, sus casos y el equipo vigente, sin nada
 * clinico. Los nombres salen de la sede actual; lo de otra sede se muestra por identificador.
 */
describe('DatosAdministrativosDeHistoria', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DatosAdministrativosDeHistoria],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
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

  it('muestra los casos con oferta, fechas y solo el equipo vigente, con sus nombres', async () => {
    const fixture = await montarConHistoria();
    const texto = contenido(fixture);

    expect(texto).toContain('N.º 2');
    expect(texto).toContain('Activo');
    expect(texto).toContain('Kinesiologia');
    expect(texto).toContain('Lopez, Maria (responsable)');
    expect(texto).toContain('Gomez, Juan (tratante)');
    // Quien salio del equipo no atiende hoy.
    expect(texto).not.toContain('#33');
    // El caso de otra sede se muestra por identificador, sin consultar esa sede.
    expect(texto).toContain('Oferta #99');
    expect(texto).toContain('Sin equipo vigente');
  });

  it('una persona sin historia lo dice, sin pedir nombres', async () => {
    const fixture = crear();
    httpMock.expectOne(DATOS).flush({ personaId: PERSONA, tieneHistoriaClinica: false });
    await estabilizar(fixture);

    expect(contenido(fixture)).toContain('todavia no tiene historia clinica');
  });

  it('si los nombres no se pueden leer, muestra los identificadores', async () => {
    const fixture = crear();
    httpMock.expectOne(DATOS).flush(CON_HISTORIA);
    httpMock.expectOne((p) => p.url === OFERTAS).flush(null, { status: 403, statusText: 'No' });
    httpMock.expectOne(HABILITACIONES).flush(null, { status: 403, statusText: 'No' });
    await estabilizar(fixture);

    const texto = contenido(fixture);
    expect(texto).toContain('Oferta #14');
    expect(texto).toContain('Profesional #31 (responsable)');
  });

  it('un 404 —no es paciente— oculta la seccion entera', async () => {
    const fixture = crear();
    httpMock
      .expectOne(DATOS)
      .flush(
        { type: 'https://akine.app/problems/not-found', status: 404, detail: 'No.' },
        { status: 404, statusText: 'Not Found' },
      );
    await estabilizar(fixture);

    expect((fixture.nativeElement as HTMLElement).querySelector('section')).toBeNull();
  });

  it('otro error se muestra y se puede reintentar', async () => {
    const fixture = crear();
    httpMock.expectOne(DATOS).flush(null, { status: 500, statusText: 'Error' });
    await estabilizar(fixture);

    const boton = (fixture.nativeElement as HTMLElement).querySelector(
      'button',
    ) as HTMLButtonElement;
    boton.click();
    httpMock.expectOne(DATOS).flush({ personaId: PERSONA, tieneHistoriaClinica: false });
    await estabilizar(fixture);

    expect(contenido(fixture)).toContain('todavia no tiene historia clinica');
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montarConHistoria();
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // ------------------------------------------------------------------------------------

  function crear(): ComponentFixture<DatosAdministrativosDeHistoria> {
    const fixture = TestBed.createComponent(DatosAdministrativosDeHistoria);
    fixture.componentRef.setInput('personaId', PERSONA);
    fixture.detectChanges();
    return fixture;
  }

  async function montarConHistoria(): Promise<ComponentFixture<DatosAdministrativosDeHistoria>> {
    const fixture = crear();
    httpMock.expectOne(DATOS).flush(CON_HISTORIA);
    httpMock
      .expectOne((p) => p.url === OFERTAS)
      .flush([{ id: 14, nombreComercial: 'Kinesiologia' }]);
    httpMock.expectOne(HABILITACIONES).flush({
      profesionales: [
        { membershipId: 31, nombre: 'Lopez, Maria' },
        { membershipId: 32, nombre: 'Gomez, Juan' },
      ],
    });
    await estabilizar(fixture);
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<DatosAdministrativosDeHistoria>) {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function contenido(fixture: ComponentFixture<DatosAdministrativosDeHistoria>): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }
});
