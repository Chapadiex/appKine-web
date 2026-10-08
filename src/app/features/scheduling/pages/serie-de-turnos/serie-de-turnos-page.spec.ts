import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { PERMISO_TURNO_MANAGE, PERMISO_TURNO_READ } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';
import { SerieDeTurnosPage } from './serie-de-turnos-page';

const CONSULTORIO = 3;
const SERIE = 7;
const ZONA = 'America/Argentina/Cordoba';
const URL_SERIE = `/api/v1/consultorios/${CONSULTORIO}/series-de-turnos/${SERIE}`;

const T1 = {
  id: 301,
  inicio: '2026-10-12T12:00:00Z',
  estado: 'CONFIRMADO',
  version: 1,
  profesionalId: 9,
};
const T2 = { id: 302, inicio: '2026-10-19T12:00:00Z', estado: 'EN_ESPERA', version: 2 };
const T3 = { id: 303, inicio: '2026-10-26T12:00:00Z', estado: 'RESERVADO', version: 0 };

const LA_SERIE = {
  id: SERIE,
  ofertaId: 42,
  timezone: ZONA,
  diasSemana: [1],
  hora: '09:00:00',
  fechaDesde: '2026-10-12',
  cantidad: 3,
  frecuencia: 'SEMANAL',
  turnos: [T1, T2, T3],
};

const URL_AGENDA = `/api/v1/consultorios/${CONSULTORIO}/ofertas/42/agenda`;

/** Agenda del martes 13/10: un slot completo y uno libre a las 10:00 de Cordoba. */
const AGENDA_MARTES = {
  timezone: ZONA,
  dias: [
    {
      fecha: '2026-10-13',
      slots: [
        {
          desde: '2026-10-13T12:00:00Z',
          hasta: '2026-10-13T12:45:00Z',
          cupoTotal: 1,
          cupoLibre: 0,
        },
        {
          desde: '2026-10-13T13:00:00Z',
          hasta: '2026-10-13T13:45:00Z',
          cupoTotal: 1,
          cupoLibre: 1,
          profesionalId: 9,
        },
      ],
    },
  ],
};

const ALCANCE = {
  serieId: SERIE,
  alcance: 'ESTE_Y_SIGUIENTES',
  turnoId: T1.id,
  afectados: [T1, T3],
  omitidos: [{ motivo: 'EN_ESPERA', turno: T2 }],
};

/**
 * Spec de la serie y su cancelacion con alcance (AKINE E-3, DP-04).
 *
 * <p>Lo esencial es la confirmacion explicita: no se cancela sin previsualizar, la cantidad que
 * viaja es la que se mostro, y si el backend dice que cambio, se vuelve a previsualizar.
 */
describe('SerieDeTurnosPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SerieDeTurnosPage],
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

  it(
    'cancelar este y los siguientes previsualiza, muestra los omitidos y confirma la cantidad',
    async () => {
      const fixture = await montar();

      clickear(fixture, 'Cancelar este y los siguientes');
      const previa = httpMock.expectOne((p) => p.url === `${URL_SERIE}/alcance`);
      expect(previa.request.params.get('alcance')).toBe('ESTE_Y_SIGUIENTES');
      expect(previa.request.params.get('turnoId')).toBe(String(T1.id));
      previa.flush(ALCANCE);
      await asentar(fixture);

      expect(texto(fixture)).toContain('Se cancelarian estos 2 turnos');
      expect(texto(fixture)).toContain('El paciente ya llego');
      await esperarSinViolaciones(fixture.nativeElement);

      escribirMotivo(fixture, 'El paciente termina el tratamiento');
      enviar(fixture);
      const cancelacion = httpMock.expectOne(
        (p) => p.method === 'POST' && p.url === `${URL_SERIE}/cancelacion`,
      );
      expect(cancelacion.request.body).toEqual({
        alcance: 'ESTE_Y_SIGUIENTES',
        turnoId: T1.id,
        motivo: 'El paciente termina el tratamiento',
        cantidadConfirmada: 2,
      });
      cancelacion.flush(ALCANCE);
      httpMock.expectOne(URL_SERIE).flush(LA_SERIE);
      await asentar(fixture);

      expect(texto(fixture)).toContain('Se cancelaron 2 turnos');
    },
    TIMEOUT_AXE,
  );

  it('si la cantidad cambio, ofrece volver a previsualizar', async () => {
    const fixture = await montar();
    clickear(fixture, 'Cancelar toda la serie');
    const previa = httpMock.expectOne((p) => p.url === `${URL_SERIE}/alcance`);
    expect(previa.request.params.get('turnoId')).toBeNull();
    previa.flush({ ...ALCANCE, alcance: 'TODA_LA_SERIE' });
    await asentar(fixture);

    escribirMotivo(fixture, 'Alta medica');
    enviar(fixture);
    httpMock
      .expectOne((p) => p.method === 'POST' && p.url === `${URL_SERIE}/cancelacion`)
      .flush(
        { type: 'https://akine.app/problems/conflict', status: 409, detail: 'Cambio' },
        { status: 409, statusText: 'Conflict' },
      );
    await asentar(fixture);

    expect(texto(fixture)).toContain('No se cancelo nada');
    clickear(fixture, 'Volver a previsualizar');
    httpMock.expectOne((p) => p.url === `${URL_SERIE}/alcance`).flush(ALCANCE);
  });

  it(
    'reprogramar elige pivote, alcance y horario, estima destinos y confirma la cantidad',
    async () => {
      const fixture = await montar();

      clickear(fixture, 'desde el turno del');
      // La agenda se pide filtrada por el profesional del pivote: cada turno conserva el suyo.
      const agendaDelLunes = httpMock.expectOne((p) => p.url === URL_AGENDA);
      expect(agendaDelLunes.request.params.get('desde')).toBe('2026-10-12');
      expect(agendaDelLunes.request.params.get('profesionalId')).toBe('9');
      agendaDelLunes.flush({ timezone: ZONA, dias: [] });
      const soloEste = httpMock.expectOne((p) => p.url === `${URL_SERIE}/alcance`);
      expect(soloEste.request.params.get('alcance')).toBe('ESTE');
      expect(soloEste.request.params.get('turnoId')).toBe(String(T1.id));
      soloEste.flush({ ...ALCANCE, alcance: 'ESTE', afectados: [T1], omitidos: [] });
      await asentar(fixture);

      // Cambiar el alcance vuelve a previsualizar.
      marcar(fixture, '#serie-reprogramar-alcance-ESTE_Y_SIGUIENTES');
      const siguientes = httpMock.expectOne((p) => p.url === `${URL_SERIE}/alcance`);
      expect(siguientes.request.params.get('alcance')).toBe('ESTE_Y_SIGUIENTES');
      siguientes.flush(ALCANCE);
      await asentar(fixture);
      expect(texto(fixture)).toContain('Se moverian estos 2 turnos');
      expect(texto(fixture)).toContain('El paciente ya llego');

      // Sin horario no se manda nada.
      escribirMotivo(fixture, 'El profesional pasa a los martes', '#serie-reprogramar-motivo');
      enviar(fixture);
      expect(texto(fixture)).toContain('Elegi el horario nuevo del turno de partida');

      cambiarDia(fixture, '2026-10-13');
      httpMock.expectOne((p) => p.url === URL_AGENDA).flush(AGENDA_MARTES);
      await asentar(fixture);
      clickear(fixture, '10:00 a 10:45');
      expect(texto(fixture)).toContain('martes, 27 de octubre, 10:00');
      await esperarSinViolaciones(fixture.nativeElement);

      enviar(fixture);
      const mover = httpMock.expectOne(
        (p) => p.method === 'POST' && p.url === `${URL_SERIE}/reprogramacion`,
      );
      expect(mover.request.body).toEqual({
        alcance: 'ESTE_Y_SIGUIENTES',
        turnoId: T1.id,
        inicio: '2026-10-13T13:00:00Z',
        motivo: 'El profesional pasa a los martes',
        cantidadConfirmada: 2,
      });
      mover.flush(
        { type: 'https://akine.app/problems/conflict', status: 409, detail: 'Cambio' },
        { status: 409, statusText: 'Conflict' },
      );
      await asentar(fixture);

      expect(texto(fixture)).toContain('No se movio nada');
      expect(texto(fixture)).not.toContain('Se moverian estos');
      clickear(fixture, 'Volver a previsualizar');
      httpMock.expectOne((p) => p.url === `${URL_SERIE}/alcance`).flush(ALCANCE);
      await asentar(fixture);

      enviar(fixture);
      httpMock
        .expectOne((p) => p.method === 'POST' && p.url === `${URL_SERIE}/reprogramacion`)
        .flush(ALCANCE);
      httpMock.expectOne(URL_SERIE).flush(LA_SERIE);
      await asentar(fixture);
      expect(texto(fixture)).toContain('Se movieron 2 turnos');
    },
    TIMEOUT_AXE,
  );

  it('con solo turno:read no ofrece cancelar', async () => {
    const fixture = await montar([PERMISO_TURNO_READ]);
    expect(texto(fixture)).toContain('Lunes');
    expect(boton(fixture, 'Cancelar')).toBeNull();
    expect(boton(fixture, 'Reprogramar')).toBeNull();
  });

  // ---------------------------------------------------------------------------------------

  async function montar(
    permisos: string[] = [PERMISO_TURNO_READ, PERMISO_TURNO_MANAGE],
  ): Promise<ComponentFixture<SerieDeTurnosPage>> {
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });
    TestBed.inject(PermissionsStore).cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: permisos });

    const fixture = TestBed.createComponent(SerieDeTurnosPage);
    fixture.componentRef.setInput('serieId', String(SERIE));
    fixture.detectChanges();
    httpMock.expectOne(URL_SERIE).flush(LA_SERIE);
    await asentar(fixture);
    return fixture;
  }

  function texto(fixture: ComponentFixture<SerieDeTurnosPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function boton(
    fixture: ComponentFixture<SerieDeTurnosPage>,
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

  function clickear(fixture: ComponentFixture<SerieDeTurnosPage>, textoBoton: string): void {
    const elegido = boton(fixture, textoBoton);
    expect(elegido, `no se encontro el boton "${textoBoton}"`).not.toBeNull();
    elegido?.click();
    fixture.detectChanges();
  }

  function escribirMotivo(
    fixture: ComponentFixture<SerieDeTurnosPage>,
    motivo: string,
    selector = '#serie-cancelar-motivo',
  ): void {
    const campo = (fixture.nativeElement as HTMLElement).querySelector(
      selector,
    ) as HTMLInputElement;
    campo.value = motivo;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function marcar(fixture: ComponentFixture<SerieDeTurnosPage>, selector: string): void {
    const radio = (fixture.nativeElement as HTMLElement).querySelector(
      selector,
    ) as HTMLInputElement;
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function cambiarDia(fixture: ComponentFixture<SerieDeTurnosPage>, fecha: string): void {
    const campo = (fixture.nativeElement as HTMLElement).querySelector(
      '#serie-reprogramar-dia',
    ) as HTMLInputElement;
    campo.value = fecha;
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function enviar(fixture: ComponentFixture<SerieDeTurnosPage>): void {
    (fixture.nativeElement as HTMLElement)
      .querySelector('form')
      ?.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  async function asentar(fixture: ComponentFixture<SerieDeTurnosPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }
});
