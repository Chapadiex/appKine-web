import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { provideApi } from '../../../api/generated/provide-api';
import { errorInterceptor } from '../../../core/interceptors/error.interceptor';
import { ContextoDeTurno } from '../../../core/models/contexto-de-turno';
import { PERMISO_PACIENTE_MANAGE, PERMISO_TURNO_SOBRETURNO } from '../../../core/models/permisos';
import { AvisosStore } from '../../../core/services/avisos.store';
import { FlujoDeTurnosStore } from '../../../core/services/flujo-de-turnos.store';
import { PermissionsStore } from '../../../core/services/permissions.store';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../core/testing/axe';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../core/testing/rutas-api';
import { NuevoTurnoPanel } from './nuevo-turno-panel';

const SEDE = '/api/v1/consultorios/3';
const OFERTAS = `${SEDE}/ofertas`;
const PROFESIONALES = `${SEDE}/disponibilidad/profesionales`;
const BUSQUEDA = `${SEDE}/disponibilidad/busqueda`;
const VALIDACION = `${SEDE}/disponibilidad/validacion`;
const CONTEXTO_DE_ANA = `${SEDE}/personas/12/contexto-de-agenda`;
const RESERVA = `${SEDE}/turnos/ofertas/14`;
const ANA_URL = '/api/v1/personas/12';
const COBERTURAS = `${ANA_URL}/coberturas`;

const ZONA = 'America/Argentina/Cordoba';
const ANA = { id: 12, nombre: 'Ana', apellido: 'Perez', esPaciente: true };
const KINE = {
  id: 14,
  nombreComercial: 'Kinesiologia',
  duracionMinutos: 45,
  requiereProfesional: true,
};
const PILATES = {
  id: 15,
  nombreComercial: 'Pilates',
  duracionMinutos: 60,
  requiereProfesional: true,
};

/** Lejos en el futuro: el panel no compara con el reloj, pero que ningun rotulo dependa de hoy. */
const LAS_9 = '2030-03-04T12:00:00Z';
const LAS_10 = '2030-03-04T13:00:00Z';
const HORARIO_9 = {
  desde: LAS_9,
  hasta: '2030-03-04T12:45:00Z',
  profesionalId: 31,
  profesionalNombre: 'Lopez, Maria',
  espacioNombre: 'Box 1',
};
const HORARIO_10 = { ...HORARIO_9, desde: LAS_10, hasta: '2030-03-04T13:45:00Z' };

const plan = (planId: number, pendientes: number, ofertaId = 14) => ({
  planId,
  numeroPlan: planId,
  prestaciones: [
    { ofertaId, planificadas: 10, realizadas: 10 - pendientes, programadas: 0, pendientes },
  ],
});

const conUnPlan = (pendientes: number) => ({
  casos: [
    {
      casoId: 9,
      numeroCaso: 1,
      ofertaNombre: 'Kinesiologia',
      responsableId: 31,
      planes: [plan(5, pendientes)],
    },
  ],
});

/**
 * El formulario único de turnos. El E2E recorre el camino feliz contra el backend; acá va lo que decide
 * qué se pregunta y qué pasa cuando el horario se fue, que es la razón de ser de este panel.
 */
describe('NuevoTurnoPanel', () => {
  let httpMock: HttpTestingController;
  let cerrado: number;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NuevoTurnoPanel],
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

  describe('qué pregunta según de dónde se entró', () => {
    it('desde un plan no pregunta paciente ni prestación, y busca con el responsable del caso', async () => {
      const fixture = await montar({
        origen: 'PLAN',
        personaId: 12,
        casoId: 9,
        planId: 5,
        ofertaId: 14,
      });
      responderOfertas();
      responderPersona(conUnPlan(3));
      const busquedas = responderHorarios([HORARIO_9]);
      await asentar(fixture);

      expect(raiz(fixture).querySelector('#flujo-paciente')).toBeNull();
      expect(raiz(fixture).querySelector('#flujo-oferta')).toBeNull();
      expect(boton(fixture, 'Cambiar')).toBeUndefined();
      expect(texto(fixture)).toContain('Perez, Ana');
      expect(texto(fixture)).toContain('Kinesiologia · 45 min');
      expect(texto(fixture)).toContain('Pendientes: 3');
      expect(select(fixture, '#flujo-contexto').value).toBe('plan:5');
      // El responsable del caso sale de la lectura del contexto: "cualquiera" sigue a un click.
      expect(busquedas.at(-1)?.request.body.profesionalId).toBe(31);
    });

    it('sin paciente muestra el buscador y dice qué falta', async () => {
      const fixture = await montar({ origen: 'AGENDA' });
      responderOfertas();
      await asentar(fixture);

      expect(raiz(fixture).querySelector('#flujo-paciente')).not.toBeNull();
      expect(raiz(fixture).querySelector('#flujo-oferta')).not.toBeNull();
      expect(raiz(fixture).querySelector('#flujo-faltante')?.textContent).toContain(
        'Falta elegir el paciente.',
      );
      expect(confirmar(fixture).disabled).toBe(true);
    });

    it('desde una celda de la agenda valida ese horario y no pregunta fecha, hora ni profesional', async () => {
      const fixture = await montar({
        origen: 'AGENDA',
        personaId: 12,
        ofertaId: 14,
        profesionalId: 31,
        inicio: LAS_9,
      });
      responderOfertas([KINE, PILATES], [{ id: 31, nombre: 'Lopez, Maria' }]);
      const validacion = httpMock.expectOne(VALIDACION);
      expect(validacion.request.body).toMatchObject({
        ofertaId: 14,
        inicio: LAS_9,
        profesionalId: 31,
      });
      validacion.flush({ estado: 'DISPONIBLE', fin: '2030-03-04T12:45:00Z' });
      responderPersona();
      responderRevalidacion({ estado: 'DISPONIBLE', fin: '2030-03-04T12:45:00Z' });
      await asentar(fixture);

      expect(httpMock.match(BUSQUEDA)).toEqual([]);
      expect(raiz(fixture).querySelector('#flujo-profesional')).toBeNull();
      expect(raiz(fixture).querySelector('#flujo-desde')).toBeNull();
      expect(texto(fixture)).toContain('Lopez, Maria');
      expect(confirmar(fixture).disabled).toBe(false);
    });

    it('con un horario y un solo profesional libre lo asigna; con varios lo pregunta', async () => {
      const fixture = await montar({
        origen: 'AGENDA',
        personaId: 12,
        ofertaId: 14,
        inicio: LAS_9,
      });
      responderOfertas();
      httpMock
        .expectOne(VALIDACION)
        .flush({ estado: 'DISPONIBLE', profesionales: [{ id: 31, nombre: 'Lopez, Maria' }] });
      responderPersona();
      // Vuelve a validar al conocer a la persona: ahora hay dos libres y el anterior sigue elegido.
      responderRevalidacion({
        estado: 'DISPONIBLE',
        profesionales: [
          { id: 31, nombre: 'Lopez, Maria' },
          { id: 40, nombre: 'Diaz, Juan' },
        ],
      });
      await asentar(fixture);

      expect(texto(fixture)).toContain('Lopez, Maria');
      const libre = select(fixture, '#flujo-profesional-libre');
      elegir(fixture, libre, '40');
      await asentar(fixture);

      confirmar(fixture).click();
      const reserva = httpMock.expectOne(RESERVA);
      expect(reserva.request.body.profesionalId).toBe(40);
      reserva.flush({ id: 500 });
    });
  });

  describe('el plan decide lo que se puede reservar', () => {
    it('un plan sin sesiones pendientes bloquea y avisa, sin ofrecer horarios', async () => {
      const fixture = await montar({
        origen: 'PLAN',
        personaId: 12,
        casoId: 9,
        planId: 5,
        ofertaId: 14,
      });
      responderOfertas();
      responderPersona(conUnPlan(0));
      responderHorarios([HORARIO_9]);
      await asentar(fixture);

      expect(texto(fixture)).toContain('No se pueden programar más turnos para esta prestación');
      expect(raiz(fixture).querySelector('.horario')).toBeNull();
      expect(confirmar(fixture).disabled).toBe(true);
      expect(raiz(fixture).querySelector('#flujo-faltante')?.textContent).toContain(
        'no tiene sesiones pendientes',
      );
    });

    it('no elige solo un plan agotado, pero se puede elegir para ver por qué', async () => {
      const fixture = await montar({ origen: 'PACIENTE', personaId: 12 });
      responderOfertas();
      responderPersona(conUnPlan(0));
      await asentar(fixture);

      const contexto = select(fixture, '#flujo-contexto');
      expect(contexto.value).toBe('');
      expect(texto(fixture)).not.toContain('No se pueden programar más turnos');

      elegir(fixture, contexto, 'plan:5');
      responderProfesionales();
      responderHorarios([]);
      await asentar(fixture);

      expect(texto(fixture)).toContain('No se pueden programar más turnos');
    });

    it('elige solo el único plan con sesiones, y con esa prestación queda fija', async () => {
      const fixture = await montar({ origen: 'PACIENTE', personaId: 12 });
      responderOfertas();
      responderPersona(conUnPlan(3));
      const [busqueda] = responderHorarios([HORARIO_9]);
      await asentar(fixture);

      expect(select(fixture, '#flujo-contexto').value).toBe('plan:5');
      expect(raiz(fixture).querySelector('#flujo-oferta')).toBeNull();
      expect(busqueda.request.body.ofertaId).toBe(14);
    });

    it('la reserva lleva el caso y el plan elegidos, y el origen del punto de entrada', async () => {
      const fixture = await montar({ origen: 'PACIENTE', personaId: 12 });
      responderOfertas();
      responderPersona(conUnPlan(3));
      responderHorarios([HORARIO_9]);
      await asentar(fixture);

      await elegirPrimerHorario(fixture);
      confirmar(fixture).click();

      const reserva = httpMock.expectOne(RESERVA);
      expect(reserva.request.body).toMatchObject({
        inicio: LAS_9,
        personaId: 12,
        profesionalId: 31,
        casoId: 9,
        planId: 5,
        origen: 'PACIENTE',
      });
      expect(reserva.request.body.idempotencyKey).toBeTruthy();
      reserva.flush({ id: 500 });
    });
  });

  describe('cuando el horario se fue', () => {
    it('el 409 ofrece alternativas reales y el reintento usa una clave nueva', async () => {
      const fixture = await listoParaConfirmar();

      confirmar(fixture).click();
      const primera = httpMock.expectOne(RESERVA);
      const claveVieja = primera.request.body.idempotencyKey;
      primera.flush(
        {
          type: 'https://akine.app/problems/recurso-ocupado',
          status: 409,
          recurso: 'profesional',
          turnoEnConflictoId: 99,
        },
        { status: 409, statusText: 'C' },
      );
      // Lee las tres cosas que necesita para explicar: si sigue libre, quién está y qué más hay.
      httpMock.expectOne(VALIDACION).flush({
        estado: 'NO_DISPONIBLE',
        motivo: 'Ya hay un turno en ese horario',
        alternativas: [HORARIO_10],
        turnoEnConflictoId: 99,
      });
      httpMock.expectOne(`${SEDE}/turnos/99`).flush({ id: 99, personaNombre: 'Gomez, Luis' });
      responderHorarios([HORARIO_10]);
      await asentar(fixture);

      expect(texto(fixture)).toContain('Este horario acaba de ser reservado');
      expect(texto(fixture)).toContain('Opciones disponibles');
      expect(texto(fixture)).toContain('Agregar a lista de espera');

      const alternativa = Array.from(
        raiz(fixture).querySelectorAll<HTMLButtonElement>('.horario'),
      ).find((h) => (h.textContent ?? '').includes('10:00'));
      alternativa?.click();
      responderCoberturas();
      httpMock.expectOne(VALIDACION).flush({ estado: 'DISPONIBLE' });
      await asentar(fixture);

      expect(texto(fixture)).not.toContain('Este horario acaba de ser reservado');
      confirmar(fixture).click();
      const segunda = httpMock.expectOne(RESERVA);
      expect(segunda.request.body.inicio).toBe(LAS_10);
      expect(segunda.request.body.idempotencyKey).not.toBe(claveVieja);
      segunda.flush({ id: 501 });
    });

    it('un 500 no dice si el turno se creó: el reintento lleva la MISMA clave', async () => {
      const fixture = await listoParaConfirmar();

      confirmar(fixture).click();
      const primera = httpMock.expectOne(RESERVA);
      const clave = primera.request.body.idempotencyKey;
      primera.flush({ status: 500, detail: 'Se cayó' }, { status: 500, statusText: 'E' });
      await asentar(fixture);

      confirmar(fixture).click();
      const segunda = httpMock.expectOne(RESERVA);
      // Es lo que hace que el backend devuelva el turno ya creado en vez de crear otro.
      expect(segunda.request.body.idempotencyKey).toBe(clave);
      segunda.flush({ id: 500 });
    });

    it('una respuesta que no llegó tampoco quema la clave', async () => {
      const fixture = await listoParaConfirmar();

      confirmar(fixture).click();
      const primera = httpMock.expectOne(RESERVA);
      const clave = primera.request.body.idempotencyKey;
      primera.error(new ProgressEvent('error'));
      await asentar(fixture);

      confirmar(fixture).click();
      const segunda = httpMock.expectOne(RESERVA);
      expect(segunda.request.body.idempotencyKey).toBe(clave);
      segunda.flush({ id: 500 });
    });

    it('la clave reusada con otro pedido reintenta con una clave NUEVA', async () => {
      const fixture = await listoParaConfirmar();

      confirmar(fixture).click();
      const primera = httpMock.expectOne(RESERVA);
      const clave = primera.request.body.idempotencyKey;
      primera.flush(
        { type: 'https://akine.app/problems/idempotency-key-conflict', status: 409 },
        { status: 409, statusText: 'C' },
      );
      await asentar(fixture);

      confirmar(fixture).click();
      const segunda = httpMock.expectOne(RESERVA);
      expect(segunda.request.body.idempotencyKey).not.toBe(clave);
      segunda.flush({ id: 500 });
    });

    it('elegir otro profesional cambia el pedido: la clave de antes no se reusa', async () => {
      const fixture = await montar({
        origen: 'AGENDA',
        personaId: 12,
        ofertaId: 14,
        inicio: LAS_9,
      });
      responderOfertas();
      const libres = {
        estado: 'DISPONIBLE',
        profesionales: [
          { id: 31, nombre: 'Lopez, Maria' },
          { id: 40, nombre: 'Diaz, Juan' },
        ],
      };
      httpMock.expectOne(VALIDACION).flush(libres);
      responderPersona();
      responderRevalidacion(libres);
      await asentar(fixture);
      elegir(fixture, select(fixture, '#flujo-profesional-libre'), '31');
      await asentar(fixture);

      confirmar(fixture).click();
      const primera = httpMock.expectOne(RESERVA);
      const clave = primera.request.body.idempotencyKey;
      primera.flush({ status: 500, detail: 'Se cayó' }, { status: 500, statusText: 'E' });
      await asentar(fixture);

      elegir(fixture, select(fixture, '#flujo-profesional-libre'), '40');
      await asentar(fixture);
      confirmar(fixture).click();
      const segunda = httpMock.expectOne(RESERVA);
      expect(segunda.request.body.profesionalId).toBe(40);
      expect(segunda.request.body.idempotencyKey).not.toBe(clave);
      segunda.flush({ id: 500 });
    });

    it('otro rechazo no se disfraza de conflicto de lugar', async () => {
      const fixture = await listoParaConfirmar();

      confirmar(fixture).click();
      httpMock.expectOne(RESERVA).flush(
        {
          type: 'https://akine.app/problems/plan-sin-sesiones',
          status: 409,
          detail: 'Sin sesiones',
        },
        { status: 409, statusText: 'C' },
      );
      await asentar(fixture);

      expect(texto(fixture)).toContain('No pudimos crear el turno');
      expect(texto(fixture)).toContain('Sin sesiones');
      expect(texto(fixture)).not.toContain('Este horario acaba de ser reservado');
    });

    it('el sobreturno exige motivo y lo manda; muestra con quién se cruza', async () => {
      const fixture = await horarioOcupado();

      boton(fixture, 'Crear sobreturno')?.click();
      httpMock.expectOne(`${SEDE}/turnos/99`).flush({ id: 99, personaNombre: 'Gomez, Luis' });
      await asentar(fixture);
      expect(texto(fixture)).toContain('con Gomez, Luis');
      expect(confirmar(fixture).disabled).toBe(true);

      boton(fixture, 'Crear sobreturno')?.click();
      await asentar(fixture);
      expect(
        raiz(fixture).querySelector('[aria-labelledby="flujo-sobreturno-titulo"] [role="alert"]')
          ?.textContent,
      ).toContain('El motivo es obligatorio');
      httpMock.expectNone(RESERVA);

      const motivo = raiz(fixture).querySelector('#flujo-sobreturno-motivo') as HTMLTextAreaElement;
      motivo.value = '  Urgencia  ';
      motivo.dispatchEvent(new Event('input'));
      await asentar(fixture);

      boton(fixture, 'Crear sobreturno')?.click();
      const reserva = httpMock.expectOne(RESERVA);
      expect(reserva.request.body.sobreturnoMotivo).toBe('Urgencia');
      reserva.flush({ id: 500 });
      await asentar(fixture);
      expect(cerrado).toBe(1);
    });

    it('sin el permiso de sobreturno no lo ofrece', async () => {
      const fixture = await horarioOcupado([]);

      expect(boton(fixture, 'Crear sobreturno')).toBeUndefined();
      expect(boton(fixture, 'Agregar a lista de espera')).toBeDefined();
    });

    it('el aviso dice con qué choca y Volver cierra el sobreturno', async () => {
      const fixture = await horarioOcupado();

      expect(texto(fixture)).toContain('Se cruza con un turno de');
      boton(fixture, 'Crear sobreturno')?.click();
      httpMock.expectOne(`${SEDE}/turnos/99`).flush('', { status: 404, statusText: 'N' });
      await asentar(fixture);
      expect(texto(fixture)).toContain('Ese horario ya está ocupado.');

      boton(fixture, 'Volver')?.click();
      await asentar(fixture);
      expect(raiz(fixture).querySelector('#flujo-sobreturno-motivo')).toBeNull();
    });
  });

  describe('al confirmar', () => {
    it('avisa con las dos salidas, notifica el cambio y cierra', async () => {
      const fixture = await listoParaConfirmar();
      const flujo = TestBed.inject(FlujoDeTurnosStore);
      const cambios = flujo.cambios();

      confirmar(fixture).click();
      httpMock.expectOne(RESERVA).flush({ id: 500 });
      await asentar(fixture);

      expect(cerrado).toBe(1);
      expect(flujo.cambios()).toBe(cambios + 1);
      const [aviso] = TestBed.inject(AvisosStore).avisos();
      expect(aviso.titulo).toBe('Turno creado correctamente.');
      expect(aviso.descripcion).toContain('Perez, Ana');

      aviso.accion?.ejecutar();
      expect(flujo.solicitud()).toEqual({ tipo: 'detalle', turnoId: 500 });

      aviso.otraAccion?.ejecutar();
      expect(flujo.solicitud()).toMatchObject({
        tipo: 'nuevo',
        contexto: { origen: 'PACIENTE', personaId: 12, inicio: undefined, fecha: undefined },
      });
    });

    it('la cobertura y el box elegidos viajan en la reserva', async () => {
      const fixture = await montar({ origen: 'PACIENTE', personaId: 12, ofertaId: 14 });
      responderOfertas([{ ...KINE, requiereEspacio: true }, PILATES]);
      responderHorarios([HORARIO_9]);
      responderPersona();
      responderHorarios([HORARIO_9]);
      await asentar(fixture);

      (raiz(fixture).querySelector('.horario') as HTMLButtonElement).click();
      httpMock
        .expectOne((r) => r.url === COBERTURAS)
        .flush([
          {
            id: 70,
            tipo: 'OBRA_SOCIAL',
            vigente: true,
            financiadorNombre: 'OSDE',
            planNombre: '210',
          },
          { id: 71, tipo: 'PARTICULAR', vigente: true },
        ]);
      httpMock.expectOne(VALIDACION).flush({
        estado: 'DISPONIBLE_CON_AVISO',
        avisos: ['Fuera del horario habitual'],
        espaciosLibres: [
          { id: 7, nombre: 'Box 1' },
          { id: 8, nombre: 'Box 2' },
        ],
      });
      await asentar(fixture);

      expect(texto(fixture)).toContain('Fuera del horario habitual');
      expect(texto(fixture)).toContain('Asignado automáticamente');
      // Particular no se elige: es la ausencia de plan financiado.
      const cobertura = select(fixture, '#flujo-cobertura');
      expect(Array.from(cobertura.options).map((o) => o.textContent?.trim())).toEqual([
        'No elegir ahora',
        'OSDE — 210',
      ]);
      elegir(fixture, cobertura, '70');

      boton(fixture, 'Cambiar', 'flujo__resumen')?.click();
      await asentar(fixture);
      elegir(fixture, select(fixture, '#flujo-box'), '8');
      await asentar(fixture);

      confirmar(fixture).click();
      const reserva = httpMock.expectOne(RESERVA);
      expect(reserva.request.body).toMatchObject({ coberturaId: 70, espacioId: 8 });
      reserva.flush({ id: 500 });
    });

    it('quien no es paciente se activa desde el mismo panel', async () => {
      const fixture = await montar({ origen: 'PACIENTE', personaId: 12, ofertaId: 14 });
      responderOfertas();
      responderHorarios([]);
      responderPersona({ casos: [] }, { ...ANA, esPaciente: false });
      responderHorarios([]);
      await asentar(fixture);
      expect(texto(fixture)).toContain('Esta persona todavía no es paciente');

      boton(fixture, 'Activar como paciente')?.click();
      httpMock.expectOne(`${ANA_URL}/perfil-paciente`).flush(ANA);
      await asentar(fixture);

      expect(texto(fixture)).not.toContain('Esta persona todavía no es paciente');
    });
  });

  describe('buscando horarios', () => {
    it('filtra por fecha y franja, y sin horarios ofrece las salidas', async () => {
      const fixture = await conPrestacion([HORARIO_9]);

      const franja = select(fixture, '#flujo-franja');
      elegir(fixture, franja, 'manana');
      const [manana] = responderHorarios([]);
      expect(manana.request.body.horaHasta).toBe('13:00:00');
      await asentar(fixture);

      expect(texto(fixture)).toContain('No encontramos disponibilidad con estos criterios');
      boton(fixture, 'Ampliar búsqueda')?.click();
      const [ampliada] = responderHorarios([HORARIO_9]);
      expect(ampliada.request.body.horaHasta).toBeUndefined();
      await asentar(fixture);

      elegir(fixture, select(fixture, '#flujo-franja'), 'tarde');
      const [tarde] = responderHorarios([]);
      expect(tarde.request.body.horaDesde).toBe('13:00:00');
      await asentar(fixture);

      const flujo = TestBed.inject(FlujoDeTurnosStore);
      boton(fixture, 'Agregar a lista de espera')?.click();
      expect(flujo.solicitud()).toMatchObject({
        tipo: 'espera',
        contexto: { personaId: 12, ofertaId: 14 },
      });
    });

    it('con dos búsquedas en vuelo gana la última pedida, no la última en llegar', async () => {
      const fixture = await conPrestacion([HORARIO_9]);

      elegir(fixture, select(fixture, '#flujo-franja'), 'manana');
      const vieja = httpMock.expectOne(BUSQUEDA);
      elegir(fixture, select(fixture, '#flujo-franja'), 'tarde');
      expect(vieja.cancelled).toBe(true);

      responderHorarios([HORARIO_10]);
      await asentar(fixture);

      expect(raiz(fixture).querySelector('.horario')?.textContent).toContain('10:00');
    });

    it('la lista de profesionales de la prestación anterior no pisa a la de la elegida', async () => {
      const fixture = await montar({ origen: 'AGENDA' });
      responderOfertas();
      await asentar(fixture);

      elegir(fixture, select(fixture, '#flujo-oferta'), '14');
      const vieja = httpMock.expectOne((r) => r.url === PROFESIONALES);
      responderHorarios([]);
      elegir(fixture, select(fixture, '#flujo-oferta'), '15');
      expect(vieja.cancelled).toBe(true);
      responderProfesionales();
      responderHorarios([]);
      await asentar(fixture);

      expect(Array.from(select(fixture, '#flujo-profesional').options).map((o) => o.value)).toEqual(
        ['', '31'],
      );
    });

    it('"Ver más" amplía el límite y "Primer disponible" elige el primero', async () => {
      const fixture = await conPrestacion([HORARIO_9, HORARIO_10], true);

      boton(fixture, 'Ver más horarios')?.click();
      const [mas] = responderHorarios([HORARIO_9, HORARIO_10], true);
      expect(mas.request.body.limite).toBe(24);
      await asentar(fixture);

      boton(fixture, 'Primer disponible')?.click();
      responderCoberturas();
      httpMock.expectOne(VALIDACION).flush({ estado: 'DISPONIBLE' });
      await asentar(fixture);
      expect(raiz(fixture).querySelector('.horario[aria-pressed="true"]')?.textContent).toContain(
        '09:00',
      );
    });

    it('un error de búsqueda se muestra con reintento', async () => {
      const fixture = await montar({ origen: 'AGENDA' });
      responderOfertas();
      await asentar(fixture);
      elegir(fixture, select(fixture, '#flujo-oferta'), '14');
      responderProfesionales();
      httpMock
        .expectOne(BUSQUEDA)
        .flush({ status: 500, detail: 'Motor caído' }, { status: 500, statusText: 'E' });
      await asentar(fixture);

      expect(texto(fixture)).toContain('No pudimos buscar horarios');
      expect(texto(fixture)).toContain('Motor caído');

      boton(fixture, 'Reintentar')?.click();
      responderHorarios([HORARIO_9]);
      await asentar(fixture);
      expect(raiz(fixture).querySelector('.horario')).not.toBeNull();
    });

    it('"Ver agenda completa" lleva a la agenda con lo elegido y cierra; "Programar varias" pasa el contexto', async () => {
      const fixture = await conPrestacion([HORARIO_9]);
      const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      boton(fixture, 'Programar varias sesiones')?.click();
      expect(TestBed.inject(FlujoDeTurnosStore).solicitud()).toMatchObject({
        tipo: 'multiple',
        contexto: { personaId: 12, ofertaId: 14 },
      });

      boton(fixture, 'Ver agenda completa')?.click();
      expect(navegar).toHaveBeenCalledWith(['/agenda'], expect.anything());
      expect(cerrado).toBe(1);
    });

    it('cambiar de profesional vuelve a buscar con ese profesional', async () => {
      const fixture = await conPrestacion([HORARIO_9]);

      elegir(fixture, select(fixture, '#flujo-profesional'), '31');
      const [busqueda] = responderHorarios([HORARIO_9]);
      expect(busqueda.request.body.profesionalId).toBe(31);
    });

    it('cambiar de paciente vuelve al buscador', async () => {
      const fixture = await montar({ origen: 'AGENDA', ofertaId: 14 });
      responderOfertas();
      responderHorarios([HORARIO_9]);
      await asentar(fixture);

      const campo = raiz(fixture).querySelector('#flujo-paciente') as HTMLInputElement;
      campo.value = 'Perez';
      campo.dispatchEvent(new Event('input'));
      await new Promise((listo) => setTimeout(listo, 350));
      httpMock.expectOne((r) => r.url === '/api/v1/personas').flush({ content: [ANA] });
      await asentar(fixture);
      (raiz(fixture).querySelector('.candidato') as HTMLButtonElement).click();
      httpMock.expectOne(CONTEXTO_DE_ANA).flush({ casos: [] });
      responderProfesionales();
      responderHorarios([HORARIO_9]);
      await asentar(fixture);
      expect(texto(fixture)).toContain('Perez, Ana');

      boton(fixture, 'Cambiar')?.click();
      await asentar(fixture);
      expect(raiz(fixture).querySelector('#flujo-paciente')).not.toBeNull();
    });
  });

  it(
    'con horarios y resumen a la vista no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await listoParaConfirmar();
      await esperarSinViolaciones(raiz(fixture));
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------

  async function montar(
    contexto: ContextoDeTurno,
    permisos: readonly string[] = [PERMISO_TURNO_SOBRETURNO, PERMISO_PACIENTE_MANAGE],
  ): Promise<ComponentFixture<NuevoTurnoPanel>> {
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro',
      consultorioId: 3,
      consultorioName: 'Sede',
    });
    TestBed.inject(PermissionsStore).cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: permisos });

    const fixture = TestBed.createComponent(NuevoTurnoPanel);
    fixture.componentRef.setInput('contexto', contexto);
    fixture.componentInstance.cerrar.subscribe(() => cerrado++);
    fixture.detectChanges();
    return fixture;
  }

  /** Paciente y prestación dados, y la lista de horarios a la vista. */
  async function conPrestacion(
    horarios: readonly object[],
    truncado = false,
  ): Promise<ComponentFixture<NuevoTurnoPanel>> {
    const fixture = await montar({ origen: 'PACIENTE', personaId: 12, ofertaId: 14 });
    responderOfertas();
    responderHorarios(horarios, truncado);
    responderPersona();
    responderHorarios(horarios, truncado);
    await asentar(fixture);
    return fixture;
  }

  async function listoParaConfirmar(): Promise<ComponentFixture<NuevoTurnoPanel>> {
    const fixture = await conPrestacion([HORARIO_9, HORARIO_10]);
    await elegirPrimerHorario(fixture);
    return fixture;
  }

  async function elegirPrimerHorario(fixture: ComponentFixture<NuevoTurnoPanel>): Promise<void> {
    (raiz(fixture).querySelector('.horario') as HTMLButtonElement).click();
    responderCoberturas();
    httpMock.expectOne(VALIDACION).flush({ estado: 'DISPONIBLE' });
    await asentar(fixture);
  }

  /** Una celda de la agenda que ya se ocupó: el motor lo dice antes de confirmar. */
  async function horarioOcupado(
    permisos: readonly string[] = [PERMISO_TURNO_SOBRETURNO],
  ): Promise<ComponentFixture<NuevoTurnoPanel>> {
    const fixture = await montar(
      { origen: 'AGENDA', personaId: 12, ofertaId: 14, profesionalId: 31, inicio: LAS_9 },
      permisos,
    );
    const ocupado = {
      estado: 'NO_DISPONIBLE',
      motivo: 'El profesional ya tiene un turno',
      conflictoInicio: LAS_9,
      conflictoFin: '2030-03-04T12:45:00Z',
      turnoEnConflictoId: 99,
    };
    responderOfertas();
    httpMock.expectOne(VALIDACION).flush(ocupado);
    responderPersona();
    responderRevalidacion(ocupado);
    await asentar(fixture);
    return fixture;
  }

  function responderOfertas(
    ofertas: readonly object[] = [KINE, PILATES],
    profesionales: readonly object[] = [{ id: 31, nombre: 'Lopez, Maria' }],
  ): void {
    httpMock.expectOne((r) => r.url === OFERTAS).flush(ofertas as object[]);
    // Con la prestacion ya elegida, llegar las ofertas dispara la lista de quien la presta.
    httpMock
      .match((r) => r.url === PROFESIONALES)
      .forEach((r) => r.flush(profesionales as object[]));
  }

  function responderProfesionales(): void {
    httpMock
      .match((r) => r.url === PROFESIONALES)
      .forEach((r) => r.flush([{ id: 31, nombre: 'Lopez, Maria' }]));
  }

  /**
   * La lectura de la persona y lo que dispara: su contexto, sus coberturas si ya hay horario y, si con
   * eso la prestacion queda elegida, quienes la prestan.
   */
  function responderPersona(contexto: object = { casos: [] }, persona: object = ANA): void {
    httpMock.expectOne(ANA_URL).flush(persona);
    httpMock.expectOne(CONTEXTO_DE_ANA).flush(contexto);
    httpMock.match((r) => r.url === COBERTURAS).forEach((r) => r.flush([]));
    responderProfesionales();
  }

  function responderHorarios(
    horarios: readonly object[],
    truncado = false,
  ): readonly TestRequest[] {
    const pedidos = httpMock.match(BUSQUEDA);
    expect(pedidos.length, 'tenia que haber una busqueda de horarios').toBeGreaterThan(0);
    pedidos.forEach((r) => {
      if (!r.cancelled) {
        r.flush({ timezone: ZONA, horarios, truncado });
      }
    });
    return pedidos;
  }

  /** Conocer a la persona vuelve a validar, porque la validacion la toma en cuenta. */
  function responderRevalidacion(validacion: object): void {
    httpMock
      .match(VALIDACION)
      .filter((r) => !r.cancelled)
      .forEach((r) => r.flush(validacion));
  }

  function responderCoberturas(): void {
    httpMock.expectOne((r) => r.url === COBERTURAS).flush([]);
  }

  function raiz(fixture: ComponentFixture<NuevoTurnoPanel>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function texto(fixture: ComponentFixture<NuevoTurnoPanel>): string {
    return (raiz(fixture).textContent ?? '').replace(/\s+/g, ' ');
  }

  function boton(
    fixture: ComponentFixture<NuevoTurnoPanel>,
    rotulo: string,
    dentroDe?: string,
  ): HTMLButtonElement | undefined {
    const contenedor =
      dentroDe === undefined ? raiz(fixture) : raiz(fixture).querySelector(`.${dentroDe}`);
    return Array.from(contenedor?.querySelectorAll('button') ?? []).find(
      (b) => (b.textContent ?? '').trim() === rotulo,
    );
  }

  function confirmar(fixture: ComponentFixture<NuevoTurnoPanel>): HTMLButtonElement {
    const encontrado = boton(fixture, 'Confirmar turno');
    if (encontrado === undefined) {
      throw new Error('No está el botón "Confirmar turno"');
    }
    return encontrado;
  }

  function select(fixture: ComponentFixture<NuevoTurnoPanel>, selector: string): HTMLSelectElement {
    const encontrado = raiz(fixture).querySelector<HTMLSelectElement>(selector);
    if (encontrado === null) {
      throw new Error(`No está el selector ${selector}`);
    }
    return encontrado;
  }

  function elegir(
    fixture: ComponentFixture<NuevoTurnoPanel>,
    campo: HTMLSelectElement,
    valor: string,
  ): void {
    campo.value = valor;
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  async function asentar(fixture: ComponentFixture<NuevoTurnoPanel>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }
});
