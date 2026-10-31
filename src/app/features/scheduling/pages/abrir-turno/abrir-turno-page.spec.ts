import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { FlujoDeTurnosStore } from '../../../../core/services/flujo-de-turnos.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { AbrirTurnoPage } from './abrir-turno-page';

const TURNO = '/api/v1/consultorios/3/turnos/7';
const SEDES = '/api/v1/organizations/1/consultorios';

/** 02:00Z del 15 son las 23:00 del 14 en Cordoba: el dia de la sede no es el dia en UTC. */
const DE_NOCHE = '2030-03-15T02:00:00Z';

/**
 * La direccion de un turno ya no es una pantalla: abre la agenda en su dia y el panel. Lo que se
 * protege es el dia, que es el de la sede aunque su zona llegue tarde, y que un turno que no se puede
 * leer deje ver el error del panel y no una pantalla en blanco.
 */
describe('AbrirTurnoPage', () => {
  let httpMock: HttpTestingController;
  let navegar: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AbrirTurnoPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro',
      consultorioId: 3,
      consultorioName: 'Sede',
    });
  });

  afterEach(() => httpMock.verify());

  it('abre el panel y la agenda en el día del turno, en la zona de la sede', async () => {
    const fixture = await montar('7');

    expect(TestBed.inject(FlujoDeTurnosStore).solicitud()).toEqual({ tipo: 'detalle', turnoId: 7 });
    responderZona('America/Argentina/Cordoba');
    await asentar(fixture);
    expect(navegar).not.toHaveBeenCalled();

    httpMock.expectOne(TURNO).flush({ id: 7, inicio: DE_NOCHE });
    await asentar(fixture);

    expect(navegar).toHaveBeenCalledExactlyOnceWith(['/agenda'], {
      queryParams: { fecha: '2030-03-14' },
      replaceUrl: true,
    });
  });

  it('espera la zona de la sede: sin ella, un turno de la noche abriría el día siguiente', async () => {
    const fixture = await montar('7');

    httpMock.expectOne(TURNO).flush({ id: 7, inicio: DE_NOCHE });
    await asentar(fixture);
    expect(navegar).not.toHaveBeenCalled();

    responderZona('America/Argentina/Cordoba');
    await asentar(fixture);
    expect(navegar).toHaveBeenCalledExactlyOnceWith(['/agenda'], {
      queryParams: { fecha: '2030-03-14' },
      replaceUrl: true,
    });
  });

  it('si el turno no existe o es de otra sede, va igual: el panel dice por qué', async () => {
    const fixture = await montar('7');

    expect(TestBed.inject(FlujoDeTurnosStore).solicitud()).toEqual({ tipo: 'detalle', turnoId: 7 });
    httpMock
      .expectOne(TURNO)
      .flush(
        { type: 'https://akine.app/problems/not-found', status: 404 },
        { status: 404, statusText: 'N' },
      );
    await asentar(fixture);

    expect(navegar).toHaveBeenCalledExactlyOnceWith(['/agenda'], {
      queryParams: {},
      replaceUrl: true,
    });
    responderZona('America/Argentina/Cordoba');
  });

  it('sin poder leer el turno, la fecha de un enlace viejo sirve de respaldo', async () => {
    const fixture = await montar('7', '2030-03-20');

    httpMock.expectOne(TURNO).flush(null, { status: 500, statusText: 'E' });
    await asentar(fixture);

    expect(navegar).toHaveBeenCalledExactlyOnceWith(['/agenda'], {
      queryParams: { fecha: '2030-03-20' },
      replaceUrl: true,
    });
    responderZona('America/Argentina/Cordoba');
  });

  it('una fecha inválida en el enlace no llega a la agenda', async () => {
    const fixture = await montar('7', 'mañana');

    httpMock.expectOne(TURNO).flush(null, { status: 500, statusText: 'E' });
    await asentar(fixture);

    expect(navegar).toHaveBeenCalledExactlyOnceWith(['/agenda'], {
      queryParams: {},
      replaceUrl: true,
    });
    responderZona('America/Argentina/Cordoba');
  });

  it('una dirección que no es de un turno lo avisa y no abre ningún panel', async () => {
    const fixture = await montar('abc');
    await asentar(fixture);

    expect(TestBed.inject(FlujoDeTurnosStore).solicitud()).toBeNull();
    expect(TestBed.inject(AvisosStore).avisos()[0].titulo).toBe(
      'Esa dirección no es la de un turno',
    );
    expect(navegar).toHaveBeenCalledExactlyOnceWith(['/agenda'], {
      queryParams: {},
      replaceUrl: true,
    });
    responderZona('America/Argentina/Cordoba');
  });

  // -------------------------------------------------------------------------------------

  async function montar(
    turnoId: string,
    fecha?: string,
  ): Promise<ComponentFixture<AbrirTurnoPage>> {
    // Lo que hace `contextGuard` antes de activar la ruta: la dispara y no la espera.
    TestBed.inject(DiaDeLaSede).cargar();
    const fixture = TestBed.createComponent(AbrirTurnoPage);
    fixture.componentRef.setInput('turnoId', turnoId);
    fixture.componentRef.setInput('fecha', fecha);
    fixture.detectChanges();
    return fixture;
  }

  function responderZona(zona: string): void {
    httpMock
      .expectOne((r) => r.url === SEDES)
      .flush({ content: [{ id: 3, timezone: zona }], totalElements: 1 });
  }

  async function asentar(fixture: ComponentFixture<AbrirTurnoPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }
});
