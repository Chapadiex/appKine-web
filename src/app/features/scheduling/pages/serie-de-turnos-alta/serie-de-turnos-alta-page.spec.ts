import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { PersonaResponse } from '../../../../api/generated/model/persona-response';
import { SerieDeTurnosAltaPage } from './serie-de-turnos-alta-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const CONSULTORIO = 3;
const OFERTA = 42;
const ZONA = 'America/Argentina/Cordoba';
// 2026-10-12 es lunes. 12:00Z es 09:00 en Cordoba.
const FECHA = '2026-10-12';
const INICIO = '2026-10-12T12:00:00Z';

const AGENDA = `/api/v1/consultorios/${CONSULTORIO}/ofertas/${OFERTA}/agenda`;
const HABILITACIONES = `/api/v1/consultorios/${CONSULTORIO}/ofertas/${OFERTA}/habilitaciones`;
const SERIES = `/api/v1/consultorios/${CONSULTORIO}/series-de-turnos`;

const PACIENTE: PersonaResponse = { id: 128, apellido: 'Perez', nombre: 'Ana', version: 0 };

function dia(fecha: string, cupoLibre = 1) {
  return {
    fecha,
    slots: [{ desde: `${fecha}T12:00:00Z`, cupoLibre, cupoTotal: 1, profesionalId: 31 }],
  };
}

function agenda(dias: unknown[]) {
  return { timezone: ZONA, nombreComercial: 'Kinesiologia', duracionMinutos: 45, dias };
}

/**
 * Spec del alta de serie (AKINE E-3).
 *
 * <p>Lo esencial: la previsualizacion marca lo que choca y no deja reservar, el alta manda la regla
 * tal como la pide el contrato, y el 409 de una ocurrencia nombra la fecha y la marca.
 */
describe('SerieDeTurnosAltaPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SerieDeTurnosAltaPage],
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
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });
  });

  afterEach(() => httpMock.verify());

  it('propone el horario de origen y la previsualizacion marca lo que no tiene lugar', async () => {
    const fixture = await montar();
    expect(campo(fixture, '#serie-hora').value).toBe('09:00');
    expect(campo(fixture, '#serie-dia-1').checked).toBe(true);

    await previsualizar(fixture, 3, [dia('2026-10-12'), dia('2026-10-19', 0), dia('2026-10-26')]);

    expect(texto(fixture)).toContain('1 de 3 fechas no tienen lugar');
    expect(boton(fixture, 'Reservar los 3 turnos')?.disabled).toBe(true);
  });

  it('reserva la serie con la regla del contrato y enlaza a la serie creada', async () => {
    const fixture = await montar();
    elegirPersona(fixture);
    await previsualizar(fixture, 3, [dia('2026-10-12'), dia('2026-10-19'), dia('2026-10-26')]);

    boton(fixture, 'Reservar los 3 turnos')?.click();
    const pedido = httpMock.expectOne((p) => p.method === 'POST' && p.url === SERIES);
    const cuerpo = pedido.request.body as Record<string, unknown>;
    expect(cuerpo).toMatchObject({
      ofertaId: OFERTA,
      personaId: PACIENTE.id,
      profesionalId: 31,
      diasSemana: [1],
      fechaDesde: FECHA,
      hora: '09:00:00',
      cantidad: 3,
    });
    expect(cuerpo['fechaHasta']).toBeUndefined();
    expect(cuerpo['idempotencyKey']).toBeTruthy();

    pedido.flush({
      id: 7,
      timezone: ZONA,
      turnos: [{ id: 301, inicio: INICIO, estado: 'RESERVADO' }],
    });
    await asentar(fixture);

    expect(texto(fixture)).toContain('Serie reservada');
    const enlace = (fixture.nativeElement as HTMLElement).querySelector(
      'a[href="/agenda/series/7"]',
    );
    expect(enlace).not.toBeNull();
  });

  it(
    'el 409 de una ocurrencia dice que no se reservo ninguna y marca la fecha',
    async () => {
      const fixture = await montar();
      elegirPersona(fixture);
      await previsualizar(fixture, 2, [dia('2026-10-12'), dia('2026-10-19')]);

      boton(fixture, 'Reservar los 2 turnos')?.click();
      httpMock
        .expectOne((p) => p.method === 'POST' && p.url === SERIES)
        .flush(
          {
            type: 'https://akine.app/problems/slot-completo',
            status: 409,
            detail: 'Sin cupo',
            cupoTotal: 1,
            ocurrenciaInicio: '2026-10-19T12:00:00Z',
          },
          { status: 409, statusText: 'Conflict' },
        );
      await asentar(fixture);

      expect(texto(fixture)).toContain('No se reservo ningun turno');
      expect(texto(fixture)).toContain('Rechazada al reservar');
      expect(boton(fixture, 'Volver a previsualizar')).not.toBeNull();

      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  it('cambiar la regla descarta la previsualizacion', async () => {
    const fixture = await montar();
    await previsualizar(fixture, 1, [dia('2026-10-12')]);
    expect(texto(fixture)).toContain('Reservar los 1 turnos');

    const jueves = campo(fixture, '#serie-dia-4');
    jueves.checked = true;
    jueves.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(texto(fixture)).not.toContain('Reservar los 1 turnos');
  });

  // ---------------------------------------------------------------------------------------

  async function montar(): Promise<ComponentFixture<SerieDeTurnosAltaPage>> {
    const fixture = TestBed.createComponent(SerieDeTurnosAltaPage);
    fixture.componentRef.setInput('ofertaId', String(OFERTA));
    fixture.componentRef.setInput('fecha', FECHA);
    fixture.componentRef.setInput('inicio', INICIO);
    fixture.componentRef.setInput('profesionalId', '31');
    fixture.detectChanges();

    httpMock.expectOne(esAgenda(FECHA)).flush(agenda([dia(FECHA)]));
    httpMock
      .expectOne(HABILITACIONES)
      .flush({ profesionales: [{ membershipId: 31, nombre: 'Lic. Gomez' }] });
    await asentar(fixture);
    return fixture;
  }

  async function previsualizar(
    fixture: ComponentFixture<SerieDeTurnosAltaPage>,
    cantidad: number,
    dias: unknown[],
  ): Promise<void> {
    const campoCantidad = campo(fixture, '#serie-cantidad');
    campoCantidad.value = String(cantidad);
    campoCantidad.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    boton(fixture, 'Previsualizar los turnos')?.click();
    const pedido = httpMock.expectOne(esAgenda(FECHA));
    expect(pedido.request.params.get('profesionalId')).toBe('31');
    pedido.flush(agenda(dias));
    await asentar(fixture);
  }

  function elegirPersona(fixture: ComponentFixture<SerieDeTurnosAltaPage>): void {
    fixture.componentInstance['elegirPersona'](PACIENTE);
    fixture.detectChanges();
  }

  function esAgenda(desde: string): (p: HttpRequest<unknown>) => boolean {
    return (p) => p.method === 'GET' && p.url === AGENDA && p.params.get('desde') === desde;
  }

  function campo(fixture: ComponentFixture<SerieDeTurnosAltaPage>, selector: string) {
    return (fixture.nativeElement as HTMLElement).querySelector(selector) as HTMLInputElement;
  }

  function texto(fixture: ComponentFixture<SerieDeTurnosAltaPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function boton(
    fixture: ComponentFixture<SerieDeTurnosAltaPage>,
    textoBoton: string,
  ): HTMLButtonElement | null {
    return (
      (
        Array.from(
          (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
        ) as HTMLButtonElement[]
      ).find((b) => (b.textContent ?? '').includes(textoBoton)) ?? null
    );
  }

  async function asentar(fixture: ComponentFixture<SerieDeTurnosAltaPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }
});
