import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { provideApi } from '../../../api/generated/provide-api';
import { errorInterceptor } from '../../../core/interceptors/error.interceptor';
import { ContextoDeTurno } from '../../../core/models/contexto-de-turno';
import { AvisosStore } from '../../../core/services/avisos.store';
import { FlujoDeTurnosStore } from '../../../core/services/flujo-de-turnos.store';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../core/testing/axe';
import { BloqueoDeAgendaPanel } from './bloqueo-de-agenda-panel';

const SEDE = '/api/v1/consultorios/3';
const PROFESIONALES = `${SEDE}/disponibilidad/profesionales`;
const EXCEPCIONES = `${SEDE}/excepciones`;
const IMPACTO = `${EXCEPCIONES}/impacto-de-alta`;

const FECHA = '2030-03-04';
const LOPEZ = { id: 31, nombre: 'Lopez, Maria' };
const DIAZ = { id: 40, nombre: 'Diaz, Juan' };

const IMPACTO_CON_TURNOS = {
  turnosAfectados: 2,
  evaluadoHasta: '2030-06-01',
  primerTurnoAfectado: '2030-03-05T12:00:00Z',
  turnos: [
    { turnoId: 700, inicio: '2030-03-05T12:00:00Z', fin: '2030-03-05T12:45:00Z', membershipId: 31 },
    { turnoId: 701, inicio: '2030-03-05T13:00:00Z', fin: '2030-03-05T13:45:00Z', membershipId: 40 },
  ],
};

/**
 * Bloquear la agenda sin dejar turnos en conflicto en silencio. Lo que decide: "toda la sede" hay que
 * elegirlo, nada se guarda antes de mostrar qué afecta, y crearlo igualmente es una decisión explícita.
 */
describe('BloqueoDeAgendaPanel', () => {
  let httpMock: HttpTestingController;
  let cerrado: number;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BloqueoDeAgendaPanel],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    cerrado = 0;
  });

  afterEach(() => httpMock.verify());

  it('"toda la sede" no viene elegida: hay que decidirla', async () => {
    const fixture = await montar();

    expect(valor(fixture, '#bloqueo-profesional')).toBe('');
    expect(raiz(fixture).querySelector('#bloqueo-faltante')?.textContent).toContain(
      'Falta elegir a quién afecta.',
    );
    expect(boton(fixture, 'Revisar')?.disabled).toBe(true);
  });

  it('sin turnos afectados guarda directo; hasta es exclusiva y sede entera omite al profesional', async () => {
    const fixture = await montar();
    const flujo = TestBed.inject(FlujoDeTurnosStore);
    const cambios = flujo.cambios();

    fijar(fixture, '#bloqueo-profesional', 'SEDE');
    fijar(fixture, '#bloqueo-tipo', 'LICENCIA');
    escribir(fixture, '#bloqueo-notas', '  Mudanza  ');
    await asentar(fixture);

    clic(fixture, 'Revisar');
    const consulta = httpMock.expectOne(IMPACTO);
    const esperado = {
      tipo: 'CIERRE',
      motivo: 'LICENCIA',
      fechaDesde: FECHA,
      // El contrato la quiere exclusiva y en pantalla es inclusiva.
      fechaHasta: '2030-03-05',
      notes: 'Mudanza',
    };
    expect(consulta.request.body).toEqual(esperado);
    consulta.flush({ turnosAfectados: 0, turnos: [] });

    const alta = httpMock.expectOne((r) => r.url === EXCEPCIONES && r.method === 'POST');
    expect(alta.request.body).toEqual(esperado);
    alta.flush({ id: 1 });
    await asentar(fixture);

    expect(cerrado).toBe(1);
    expect(flujo.cambios()).toBe(cambios + 1);
    expect(TestBed.inject(AvisosStore).avisos()[0].titulo).toBe('Agenda bloqueada.');
  });

  it('con un profesional y un horario manda esos datos', async () => {
    const fixture = await montar({ origen: 'AGENDA', fecha: FECHA, profesionalId: 31 });

    expect(valor(fixture, '#bloqueo-profesional')).toBe('31');
    fijar(fixture, '#bloqueo-tipo', 'CAPACITACION');
    fijar(fixture, '#bloqueo-hora-desde', '14:00');
    fijar(fixture, '#bloqueo-hora-hasta', '16:00');
    await asentar(fixture);

    clic(fixture, 'Revisar');
    const consulta = httpMock.expectOne(IMPACTO);
    expect(consulta.request.body).toMatchObject({
      membershipId: 31,
      horaDesde: '14:00',
      horaHasta: '16:00',
    });
    consulta.flush({ turnosAfectados: 0 });
    httpMock.expectOne((r) => r.url === EXCEPCIONES && r.method === 'POST').flush({ id: 1 });
  });

  describe('dice qué falta', () => {
    it.each([
      ['#bloqueo-hasta', '2030-03-01', 'La fecha hasta no puede ser anterior'],
      ['#bloqueo-desde', '', 'Faltan las fechas.'],
      ['#bloqueo-hora-desde', '14:00', 'lleva hora desde y hora hasta'],
    ])('%s = "%s"', async (selector, nuevo, mensaje) => {
      const fixture = await montar();
      fijar(fixture, '#bloqueo-profesional', 'SEDE');
      fijar(fixture, selector, nuevo);
      await asentar(fixture);

      expect(raiz(fixture).querySelector('#bloqueo-faltante')?.textContent).toContain(mensaje);
    });

    it('la hora hasta posterior, y el tipo', async () => {
      const fixture = await montar();
      fijar(fixture, '#bloqueo-profesional', 'SEDE');
      fijar(fixture, '#bloqueo-hora-desde', '16:00');
      fijar(fixture, '#bloqueo-hora-hasta', '14:00');
      await asentar(fixture);
      expect(raiz(fixture).querySelector('#bloqueo-faltante')?.textContent).toContain('posterior');

      fijar(fixture, '#bloqueo-hora-desde', '');
      fijar(fixture, '#bloqueo-hora-hasta', '');
      await asentar(fixture);
      expect(raiz(fixture).querySelector('#bloqueo-faltante')?.textContent).toContain(
        'Falta elegir el tipo.',
      );
    });

    it('mover "desde" después de "hasta" arrastra a "hasta"', async () => {
      const fixture = await montar();

      fijar(fixture, '#bloqueo-desde', '2030-03-10');
      await asentar(fixture);

      expect(valor(fixture, '#bloqueo-hasta')).toBe('2030-03-10');
    });
  });

  describe('con turnos afectados', () => {
    it('muestra cuáles, sin guardar nada, y crear igualmente es una decisión explícita', async () => {
      const fixture = await revisado();

      httpMock.expectNone((r) => r.url === EXCEPCIONES && r.method === 'POST');
      expect(texto(fixture)).toContain('Este bloqueo afecta 2 turnos.');
      expect(texto(fixture)).toContain('Todavía no se guardó nada');
      expect(texto(fixture)).toContain('Toda la sede');
      expect(texto(fixture)).toContain('Licencia');
      // Con la sede entera los turnos son de varios: sin el nombre no se distinguen.
      expect(texto(fixture)).toContain('Lopez, Maria');
      expect(texto(fixture)).toContain('Diaz, Juan');

      clic(fixture, 'Crear bloqueo igualmente');
      const alta = httpMock.expectOne((r) => r.url === EXCEPCIONES && r.method === 'POST');
      expect(alta.request.body.confirmaTurnosAfectados).toBe(true);
      alta.flush({ id: 1 });
      await asentar(fixture);
      expect(cerrado).toBe(1);
    });

    it('en singular cuando es uno, y avisa si la lista está recortada o la revisión no llegó', async () => {
      const fixture = await revisado({
        turnosAfectados: 60,
        evaluadoHasta: '2030-03-05',
        turnos: IMPACTO_CON_TURNOS.turnos,
      });
      expect(texto(fixture)).toContain('Este bloqueo afecta 60 turnos.');
      expect(texto(fixture)).toContain('Se muestran los primeros 2.');

      clic(fixture, 'Cancelar');
      await asentar(fixture);
      fijar(fixture, '#bloqueo-hasta', '2030-12-31');
      await asentar(fixture);
      clic(fixture, 'Revisar');
      httpMock.expectOne(IMPACTO).flush({
        turnosAfectados: 1,
        evaluadoHasta: '2030-06-01',
        turnos: [IMPACTO_CON_TURNOS.turnos[0]],
      });
      await asentar(fixture);

      expect(texto(fixture)).toContain('Este bloqueo afecta 1 turno.');
      expect(texto(fixture)).toContain('Se revisó hasta el');
    });

    it('"Cancelar" vuelve al formulario con lo cargado y no guarda nada', async () => {
      const fixture = await revisado();

      clic(fixture, 'Cancelar');
      await asentar(fixture);

      expect(cerrado).toBe(0);
      expect(valor(fixture, '#bloqueo-profesional')).toBe('SEDE');
      expect(valor(fixture, '#bloqueo-tipo')).toBe('LICENCIA');
      httpMock.expectNone((r) => r.url === EXCEPCIONES && r.method === 'POST');
    });

    it('"Reprogramar turnos" lleva a la agenda en el día del primero afectado, sin guardar', async () => {
      const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const fixture = await revisado();

      clic(fixture, 'Reprogramar turnos');

      expect(navegar).toHaveBeenCalledWith(['/agenda'], {
        queryParams: { fecha: '2030-03-05', profesional: undefined },
      });
      expect(cerrado).toBe(1);
      httpMock.expectNone((r) => r.url === EXCEPCIONES && r.method === 'POST');
    });

    it('con un profesional la agenda abre filtrada por él', async () => {
      const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const fixture = await montar({ origen: 'AGENDA', fecha: FECHA, profesionalId: 31 });
      fijar(fixture, '#bloqueo-tipo', 'LICENCIA');
      await asentar(fixture);
      clic(fixture, 'Revisar');
      httpMock.expectOne(IMPACTO).flush({ turnosAfectados: 1, turnos: [] });
      await asentar(fixture);

      clic(fixture, 'Reprogramar turnos');

      expect(navegar).toHaveBeenCalledWith(['/agenda'], {
        queryParams: { fecha: FECHA, profesional: '31' },
      });
    });

    it('"Ver turno" abre el detalle de ese turno', async () => {
      const fixture = await revisado();

      clicQueContiene(fixture, 'Ver turno');

      expect(TestBed.inject(FlujoDeTurnosStore).solicitud()).toEqual({
        tipo: 'detalle',
        turnoId: 700,
      });
    });

    it('si entró un turno entre la consulta y el alta muestra la lista al día', async () => {
      const fixture = await montar();
      fijar(fixture, '#bloqueo-profesional', 'SEDE');
      fijar(fixture, '#bloqueo-tipo', 'LICENCIA');
      await asentar(fixture);

      clic(fixture, 'Revisar');
      httpMock.expectOne(IMPACTO).flush({ turnosAfectados: 0 });
      httpMock
        .expectOne((r) => r.url === EXCEPCIONES && r.method === 'POST')
        .flush(
          {
            type: 'https://akine.app/problems/bloqueo-con-turnos-afectados',
            status: 409,
            turnosAfectados: 2,
          },
          { status: 409, statusText: 'C' },
        );
      httpMock.expectOne(IMPACTO).flush(IMPACTO_CON_TURNOS);
      await asentar(fixture);

      expect(cerrado).toBe(0);
      expect(texto(fixture)).toContain('Este bloqueo afecta 2 turnos.');
      expect(raiz(fixture).querySelectorAll('.flujo__historial li').length).toBe(2);
    });

    it('si la relectura falla muestra la cuenta sola antes que guardar sin avisar', async () => {
      const fixture = await montar();
      fijar(fixture, '#bloqueo-profesional', 'SEDE');
      fijar(fixture, '#bloqueo-tipo', 'LICENCIA');
      await asentar(fixture);

      clic(fixture, 'Revisar');
      httpMock.expectOne(IMPACTO).flush({ turnosAfectados: 0 });
      httpMock
        .expectOne((r) => r.url === EXCEPCIONES && r.method === 'POST')
        .flush(
          {
            type: 'https://akine.app/problems/bloqueo-con-turnos-afectados',
            status: 409,
            turnosAfectados: 3,
          },
          { status: 409, statusText: 'C' },
        );
      httpMock.expectOne(IMPACTO).flush('', { status: 500, statusText: 'E' });
      await asentar(fixture);

      expect(texto(fixture)).toContain('Este bloqueo afecta 3 turnos.');
      expect(cerrado).toBe(0);
    });
  });

  describe('errores', () => {
    it('sin permiso lo dice en términos de administrar la sede', async () => {
      const fixture = await montar();
      fijar(fixture, '#bloqueo-profesional', 'SEDE');
      fijar(fixture, '#bloqueo-tipo', 'LICENCIA');
      await asentar(fixture);

      clic(fixture, 'Revisar');
      httpMock
        .expectOne(IMPACTO)
        .flush(
          { type: 'https://akine.app/problems/forbidden', status: 403 },
          { status: 403, statusText: 'F' },
        );
      await asentar(fixture);

      expect(texto(fixture)).toContain('No pudimos bloquear la agenda');
      expect(texto(fixture)).toContain('hace falta poder administrar la sede');
    });

    it('otro rechazo del alta se muestra y no cierra', async () => {
      const fixture = await revisado();

      clic(fixture, 'Crear bloqueo igualmente');
      httpMock
        .expectOne((r) => r.url === EXCEPCIONES && r.method === 'POST')
        .flush({ status: 400, detail: 'Fechas inválidas' }, { status: 400, statusText: 'B' });
      await asentar(fixture);

      expect(texto(fixture)).toContain('Fechas inválidas');
      expect(cerrado).toBe(0);
    });

    it('un profesional del contexto que ya no está en la sede no queda elegido sin que se vea', async () => {
      const fixture = await montar({ origen: 'AGENDA', fecha: FECHA, profesionalId: 99 });

      expect(valor(fixture, '#bloqueo-profesional')).toBe('');
    });

    it('si no se pueden leer los profesionales no bloquea a ciegas: suelta el id y deja reintentar', async () => {
      TestBed.inject(TenantContextStore).select({
        organizationId: 1,
        organizationName: 'Centro',
        consultorioId: 3,
        consultorioName: 'Sede',
      });
      const fixture = TestBed.createComponent(BloqueoDeAgendaPanel);
      fixture.componentRef.setInput('contexto', {
        origen: 'AGENDA',
        fecha: FECHA,
        profesionalId: 31,
      } satisfies ContextoDeTurno);
      fixture.detectChanges();
      httpMock
        .expectOne((r) => r.url === PROFESIONALES)
        .flush({ status: 500, detail: 'Caído' }, { status: 500, statusText: 'E' });
      await asentar(fixture);

      expect(valor(fixture, '#bloqueo-profesional')).toBe('');
      expect(raiz(fixture).querySelector('[role="alert"]')?.textContent).toContain('Caído');

      clic(fixture, 'Reintentar');
      httpMock.expectOne((r) => r.url === PROFESIONALES).flush([LOPEZ]);
      await asentar(fixture);
      expect(raiz(fixture).querySelector('[role="alert"]')).toBeNull();
    });
  });

  it('"Cancelar" del formulario cierra el panel', async () => {
    const fixture = await montar();

    clic(fixture, 'Cancelar');

    expect(cerrado).toBe(1);
  });

  it(
    'con los turnos afectados a la vista no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await revisado();
      await esperarSinViolaciones(raiz(fixture));
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------

  async function montar(
    contexto: ContextoDeTurno = { origen: 'AGENDA', fecha: FECHA },
  ): Promise<ComponentFixture<BloqueoDeAgendaPanel>> {
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro',
      consultorioId: 3,
      consultorioName: 'Sede',
    });
    const fixture = TestBed.createComponent(BloqueoDeAgendaPanel);
    fixture.componentRef.setInput('contexto', contexto);
    fixture.componentInstance.cerrar.subscribe(() => cerrado++);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === PROFESIONALES).flush([LOPEZ, DIAZ]);
    await asentar(fixture);
    return fixture;
  }

  /** Sede entera, licencia, y la consulta de impacto ya respondida. */
  async function revisado(
    impacto: object = IMPACTO_CON_TURNOS,
  ): Promise<ComponentFixture<BloqueoDeAgendaPanel>> {
    const fixture = await montar();
    fijar(fixture, '#bloqueo-profesional', 'SEDE');
    fijar(fixture, '#bloqueo-tipo', 'LICENCIA');
    await asentar(fixture);
    clic(fixture, 'Revisar');
    httpMock.expectOne(IMPACTO).flush(impacto);
    await asentar(fixture);
    return fixture;
  }

  function raiz(fixture: ComponentFixture<BloqueoDeAgendaPanel>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function texto(fixture: ComponentFixture<BloqueoDeAgendaPanel>): string {
    return (raiz(fixture).textContent ?? '').replace(/\s+/g, ' ');
  }

  function valor(fixture: ComponentFixture<BloqueoDeAgendaPanel>, selector: string): string {
    return (raiz(fixture).querySelector(selector) as HTMLInputElement | HTMLSelectElement).value;
  }

  function fijar(
    fixture: ComponentFixture<BloqueoDeAgendaPanel>,
    selector: string,
    nuevo: string,
  ): void {
    const campo = raiz(fixture).querySelector(selector) as HTMLInputElement | HTMLSelectElement;
    campo.value = nuevo;
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function escribir(
    fixture: ComponentFixture<BloqueoDeAgendaPanel>,
    selector: string,
    nuevo: string,
  ): void {
    const campo = raiz(fixture).querySelector(selector) as HTMLTextAreaElement;
    campo.value = nuevo;
    campo.dispatchEvent(new Event('input'));
  }

  function boton(
    fixture: ComponentFixture<BloqueoDeAgendaPanel>,
    rotulo: string,
  ): HTMLButtonElement | undefined {
    return Array.from(raiz(fixture).querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === rotulo,
    );
  }

  function clic(fixture: ComponentFixture<BloqueoDeAgendaPanel>, rotulo: string): void {
    const encontrado = boton(fixture, rotulo);
    if (encontrado === undefined) {
      throw new Error(`No está el botón "${rotulo}"`);
    }
    encontrado.click();
    fixture.detectChanges();
  }

  function clicQueContiene(fixture: ComponentFixture<BloqueoDeAgendaPanel>, parte: string): void {
    const encontrado = Array.from(raiz(fixture).querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes(parte),
    );
    if (encontrado === undefined) {
      throw new Error(`No hay botón que contenga "${parte}"`);
    }
    encontrado.click();
    fixture.detectChanges();
  }

  async function asentar(fixture: ComponentFixture<BloqueoDeAgendaPanel>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }
});
