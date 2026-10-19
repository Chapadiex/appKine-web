import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import {
  ORGANIZACION,
  URL_CLASES,
  URL_OFERTAS,
  asentar,
  clickear,
  elegirSede,
  textoDe,
} from '../../testing/activity-testing';
import { InstructoresDeClaseComponent } from './instructores-de-clase';

const ID = 70;
const URL = `${URL_CLASES}/${ID}/instructores`;
const HABILITACIONES = `${URL_OFERTAS}/42/habilitaciones`;
const MEMBERSHIPS = `/api/v1/organizations/${ORGANIZACION}/memberships`;

const CLASE = { id: ID, ofertaId: 42, profesionalId: 55, estado: 'REALIZADA' };

const INSTRUCTORES = {
  claseId: ID,
  principalMembershipId: 55,
  principalNombre: 'Lic. Diaz',
  adicionales: [{ membershipId: 61, nombre: 'Lic. Rios' }],
};

/**
 * Instructores adicionales de una clase (DP-38): lo que importa es que el PUT lleve la lista
 * COMPLETA —destildar es quitar—, que el principal no se ofrezca y que el 409 de honorarios
 * liquidados explique la salida.
 */
describe('InstructoresDeClaseComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InstructoresDeClaseComponent],
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

  async function montar(
    puedeGestionar = true,
    respuesta: object = INSTRUCTORES,
  ): Promise<ComponentFixture<InstructoresDeClaseComponent>> {
    elegirSede();
    const fixture = TestBed.createComponent(InstructoresDeClaseComponent);
    fixture.componentRef.setInput('clase', CLASE);
    fixture.componentRef.setInput('puedeGestionar', puedeGestionar);
    fixture.detectChanges();
    httpMock.expectOne(URL).flush(respuesta);
    await asentar(fixture);
    return fixture;
  }

  function casillas(fixture: ComponentFixture<unknown>): HTMLInputElement[] {
    return [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]',
      ),
    ];
  }

  it(
    'muestra el principal, los adicionales y que el reparto es en partes iguales',
    async () => {
      const fixture = await montar();
      const texto = textoDe(fixture);
      expect(texto).toContain('Lic. Diaz');
      expect(texto).toContain('Lic. Rios');
      expect(texto).toContain('partes iguales entre los 2 instructores');
      expect(texto).toContain('no ocupa agenda');
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  it('sin clase:manage no ofrece cambiarlos', async () => {
    const fixture = await montar(false, { claseId: ID, principalMembershipId: 55 });
    expect(textoDe(fixture)).toContain('Ninguno');
    expect(textoDe(fixture)).not.toContain('Cambiar los instructores');
  });

  it('el reemplazo manda la lista completa y no ofrece al principal', async () => {
    const fixture = await montar();
    clickear(fixture, 'Cambiar los instructores adicionales');
    httpMock.expectOne(HABILITACIONES).flush({
      restringidaPorProfesional: true,
      profesionales: [
        { membershipId: 55, nombre: 'Lic. Diaz', estado: 'ACTIVO' },
        { membershipId: 62, nombre: 'Lic. Sosa', estado: 'ACTIVO' },
        { membershipId: 63, nombre: 'Lic. Baja', estado: 'INACTIVO' },
      ],
    });
    await asentar(fixture);

    const opciones = casillas(fixture);
    // Rios (vigente aunque no figure en las habilitaciones) y Sosa; nunca el principal.
    expect(opciones).toHaveLength(2);
    expect(textoDe(fixture)).not.toContain('Lic. Baja');
    expect(opciones[0].checked).toBe(false);
    const rios = opciones.find((o) => (o.parentElement?.textContent ?? '').includes('Rios'))!;
    const sosa = opciones.find((o) => (o.parentElement?.textContent ?? '').includes('Sosa'))!;
    expect(rios.checked).toBe(true);
    rios.click();
    sosa.click();
    fixture.detectChanges();

    clickear(fixture, 'Guardar los instructores');
    const pedido = httpMock.expectOne((p) => p.method === 'PUT' && p.url === URL);
    expect(pedido.request.body).toEqual({ adicionales: [62] });
    pedido.flush({ ...INSTRUCTORES, adicionales: [{ membershipId: 62, nombre: 'Lic. Sosa' }] });
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('La clase quedo con 2 instructores');
    expect(textoDe(fixture)).toContain('Lic. Sosa');
  });

  it('una clase con honorarios liquidados explica que hay que anular el egreso', async () => {
    const fixture = await montar();
    clickear(fixture, 'Cambiar los instructores adicionales');
    httpMock.expectOne(HABILITACIONES).flush({ restringidaPorProfesional: false });
    httpMock
      .expectOne((p) => p.url === MEMBERSHIPS)
      .flush({
        content: [
          { id: 64, accountName: 'Lic. Mora', estado: 'ACTIVA', roleCode: 'PROFESIONAL' },
          // El adicional no exige rol PROFESIONAL: una administrativa que da la clase tambien entra.
          { id: 66, accountName: 'Admin Sintetica', estado: 'ACTIVA', roleCode: 'ORG_ADMIN' },
          { id: 67, accountName: 'Revocada', estado: 'REVOCADA', roleCode: 'PROFESIONAL' },
          {
            id: 65,
            accountName: 'Otra sede',
            estado: 'ACTIVA',
            roleCode: 'PROFESIONAL',
            consultorioId: 99,
          },
        ],
      });
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Lic. Mora');
    expect(textoDe(fixture)).not.toContain('Otra sede');
    expect(textoDe(fixture)).toContain('Admin Sintetica');
    expect(textoDe(fixture)).not.toContain('Revocada');

    // Destildar a Rios deja la lista vacia: se quitan todos los adicionales.
    casillas(fixture)
      .find((o) => (o.parentElement?.textContent ?? '').includes('Rios'))!
      .click();
    fixture.detectChanges();
    clickear(fixture, 'Guardar los instructores');
    const pedido = httpMock.expectOne((p) => p.method === 'PUT');
    expect(pedido.request.body).toEqual({ adicionales: [] });
    pedido.flush(
      { type: 'https://akine.app/problems/clase-con-honorarios-liquidados', status: 409 },
      { status: 409, statusText: 'Conflict' },
    );
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('anula el egreso de esa liquidacion');

    clickear(fixture, 'Cancelar');
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Cambiar los instructores adicionales');
  });

  it('quitar todos avisa que queda solo el principal', async () => {
    const fixture = await montar();
    clickear(fixture, 'Cambiar los instructores adicionales');
    httpMock.expectOne(HABILITACIONES).flush(null, { status: 403, statusText: 'Forbidden' });
    httpMock.expectOne((p) => p.url === MEMBERSHIPS).flush({ content: [] });
    await asentar(fixture);
    casillas(fixture)[0].click();
    fixture.detectChanges();
    clickear(fixture, 'Guardar los instructores');
    httpMock
      .expectOne((p) => p.method === 'PUT')
      .flush({ claseId: ID, principalMembershipId: 55, adicionales: [] });
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('sin instructores adicionales');
  });

  it('un error de lectura permite reintentar', async () => {
    elegirSede();
    const fixture = TestBed.createComponent(InstructoresDeClaseComponent);
    fixture.componentRef.setInput('clase', CLASE);
    fixture.detectChanges();
    httpMock.expectOne(URL).flush(null, { status: 403, statusText: 'Forbidden' });
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('No tenes permiso');
    clickear(fixture, 'Reintentar');
    httpMock.expectOne(URL).flush({ claseId: ID });
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Sin instructor principal');
  });
});
