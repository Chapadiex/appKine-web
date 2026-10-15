import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { rutaMemberships } from '../../../../core/testing/rutas-api';
import {
  CONSULTORIO,
  ORGANIZACION,
  URL_OFERTAS,
  asentar,
  elegirSede,
  escribir,
  proveerDiaDeLaSede,
  textoDe,
} from '../../testing/activity-testing';
import { AltaDeClasePage, sumarMinutos } from './alta-de-clase-page';

const PROGRAMAR = `/api/v1/consultorios/${CONSULTORIO}/clases/ofertas/42`;
const HABILITACIONES = `${URL_OFERTAS}/42/habilitaciones`;

const GRUPAL = {
  id: 42,
  nombreComercial: 'Pilates reformer',
  modalidad: 'GRUPAL',
  capacidad: 12,
  duracionMinutos: 45,
  requiereProfesional: true,
};

describe('AltaDeClasePage', () => {
  let httpMock: HttpTestingController;
  let navegar: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AltaDeClasePage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
        proveerDiaDeLaSede(),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    navegar = vi.fn().mockResolvedValue(true);
    TestBed.inject(Router).navigateByUrl = navegar as unknown as Router['navigateByUrl'];
  });

  afterEach(() => httpMock.verify());

  async function montar(ofertas: unknown[] = [GRUPAL, { id: 43, modalidad: 'INDIVIDUAL' }]) {
    elegirSede();
    const fixture = TestBed.createComponent(AltaDeClasePage);
    fixture.componentRef.setInput('fecha', '2026-10-20');
    fixture.detectChanges();
    httpMock.expectOne((p) => p.url === URL_OFERTAS).flush(ofertas);
    await asentar(fixture);
    return fixture;
  }

  it(
    'ofrece solo las grupales, toma cupo y duracion de la oferta y programa en hora de la sede',
    async () => {
      const fixture = await montar();
      const opciones = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('#clase-oferta option'),
      ).map((o) => o.textContent?.trim());
      expect(opciones).toEqual(['Elegi una oferta', 'Pilates reformer']);

      escribir(fixture, '#clase-oferta', '42');
      httpMock.expectOne(HABILITACIONES).flush({
        restringidaPorProfesional: true,
        profesionales: [
          { membershipId: 55, nombre: 'Lic. Diaz', estado: 'ACTIVO' },
          { membershipId: 56, nombre: 'Baja', estado: 'INACTIVO' },
        ],
      });
      await asentar(fixture);
      const raiz = fixture.nativeElement as HTMLElement;
      expect((raiz.querySelector('#clase-capacidad') as HTMLInputElement).value).toBe('12');
      expect((raiz.querySelector('#clase-fin') as HTMLInputElement).value).toBe('09:45');
      expect(raiz.querySelectorAll('#clase-profesional option')).toHaveLength(2);
      await esperarSinViolaciones(fixture.nativeElement);

      escribir(fixture, '#clase-profesional', '55');
      escribir(fixture, '#clase-titulo', ' Pilates de la tarde ');
      (raiz.querySelector('button[type="submit"]') as HTMLButtonElement).click();
      const pedido = httpMock.expectOne(PROGRAMAR);
      expect(pedido.request.method).toBe('POST');
      const cuerpo = pedido.request.body as Record<string, unknown>;
      expect(cuerpo['inicio']).toBe('2026-10-20T12:00:00.000Z');
      expect(cuerpo['fin']).toBe('2026-10-20T12:45:00.000Z');
      expect(cuerpo['capacidad']).toBe(12);
      expect(cuerpo['profesionalId']).toBe(55);
      expect(cuerpo['titulo']).toBe('Pilates de la tarde');
      expect(typeof cuerpo['idempotencyKey']).toBe('string');
      pedido.flush({ id: 70 });
      await asentar(fixture);
      expect(navegar).toHaveBeenCalledWith('/clases/70');
    },
    TIMEOUT_AXE,
  );

  it('una oferta sin restriccion ofrece los profesionales de la organizacion', async () => {
    const fixture = await montar();
    escribir(fixture, '#clase-oferta', '42');
    httpMock
      .expectOne(HABILITACIONES)
      .flush({ restringidaPorProfesional: false, profesionales: [] });
    httpMock
      .expectOne((p) => p.url === rutaMemberships(ORGANIZACION))
      .flush({
        content: [
          { id: 55, roleCode: 'PROFESIONAL', estado: 'ACTIVA', accountName: 'Lic. Diaz' },
          {
            id: 57,
            roleCode: 'PROFESIONAL',
            estado: 'ACTIVA',
            consultorioId: 99,
            accountName: 'Otra sede',
          },
          { id: 58, roleCode: 'ADMINISTRATIVO', estado: 'ACTIVA', accountName: 'Recepcion' },
        ],
      });
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Lic. Diaz');
    expect(textoDe(fixture)).not.toContain('Otra sede');
    expect(textoDe(fixture)).not.toContain('Recepcion');
  });

  it('el rechazo del servidor se muestra con su causa y la clave se conserva', async () => {
    const fixture = await montar([{ ...GRUPAL, requiereProfesional: false }]);
    escribir(fixture, '#clase-oferta', '42');
    await asentar(fixture);
    const enviar = () =>
      (
        (fixture.nativeElement as HTMLElement).querySelector(
          'button[type="submit"]',
        ) as HTMLButtonElement
      ).click();

    enviar();
    const primero = httpMock.expectOne(PROGRAMAR);
    const clave = (primero.request.body as { idempotencyKey: string }).idempotencyKey;
    expect((primero.request.body as { profesionalId?: number }).profesionalId).toBeUndefined();
    primero.flush(
      {
        type: 'https://akine.app/problems/clase-capacidad-no-admitida',
        status: 409,
        capacidadPedida: 12,
        capacidadMaxima: 6,
      },
      { status: 409, statusText: 'Conflict' },
    );
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Pediste 12 lugares y el limite es 6');

    enviar();
    const segundo = httpMock.expectOne(PROGRAMAR);
    expect((segundo.request.body as { idempotencyKey: string }).idempotencyKey).toBe(clave);
    segundo.flush(
      { type: 'https://akine.app/problems/idempotency-key-conflict', status: 409 },
      { status: 409, statusText: 'Conflict' },
    );
    await asentar(fixture);

    enviar();
    const tercero = httpMock.expectOne(PROGRAMAR);
    expect((tercero.request.body as { idempotencyKey: string }).idempotencyKey).not.toBe(clave);
    tercero.flush(
      { type: 'https://akine.app/problems/recurso-ocupado', status: 409, recurso: 'espacio' },
      { status: 409, statusText: 'Conflict' },
    );
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('El box ya tiene un turno u otra clase');
  });

  it('valida antes de mandar: oferta obligatoria y fin posterior al inicio', async () => {
    const fixture = await montar([]);
    expect(textoDe(fixture)).toContain('no tiene ofertas grupales activas');
    const raiz = fixture.nativeElement as HTMLElement;
    (raiz.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(textoDe(fixture)).toContain('Elegi la oferta de la clase');
    httpMock.expectNone(PROGRAMAR);
  });

  it('rechaza un fin anterior al inicio sin salir a la red', async () => {
    const fixture = await montar([{ ...GRUPAL, requiereProfesional: false, duracionMinutos: 0 }]);
    escribir(fixture, '#clase-oferta', '42');
    escribir(fixture, '#clase-inicio', '10:00');
    escribir(fixture, '#clase-fin', '09:00');
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(textoDe(fixture)).toContain('La hora de fin tiene que ser posterior');
    httpMock.expectNone(PROGRAMAR);
  });

  it('si no se pueden leer las ofertas lo dice', async () => {
    elegirSede();
    const fixture = TestBed.createComponent(AltaDeClasePage);
    fixture.detectChanges();
    httpMock
      .expectOne((p) => p.url === URL_OFERTAS)
      .flush(null, { status: 500, statusText: 'Server Error' });
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('No pudimos completar la operacion');
  });
});

describe('sumarMinutos', () => {
  it('suma sin pasar de las 23:59 y tolera una hora rara', () => {
    expect(sumarMinutos('09:30', 45)).toBe('10:15');
    expect(sumarMinutos('23:30', 90)).toBe('23:59');
    expect(sumarMinutos('xx', 10)).toBe('xx');
  });
});
