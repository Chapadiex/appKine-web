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
import { PermissionsStore } from '../../../core/services/permissions.store';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../core/testing/axe';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../core/testing/rutas-api';
import { ProgramacionMultiplePanel } from './programacion-multiple-panel';

const SEDE = '/api/v1/consultorios/3';
const OFERTAS = `${SEDE}/ofertas`;
const PROFESIONALES = `${SEDE}/disponibilidad/profesionales`;
const BUSQUEDA = `${SEDE}/disponibilidad/busqueda`;
const CONTEXTO_DE_ANA = `${SEDE}/personas/12/contexto-de-agenda`;
const SERIES = `${SEDE}/series-de-turnos`;
const PREVISUALIZACION = `${SERIES}/previsualizacion`;
const ANA_URL = '/api/v1/personas/12';

const ZONA = 'America/Argentina/Cordoba';
const ANA = { id: 12, nombre: 'Ana', apellido: 'Perez', esPaciente: true };
const KINE = {
  id: 14,
  nombreComercial: 'Kinesiologia',
  duracionMinutos: 45,
  requiereProfesional: true,
};

const DEL_PLAN: ContextoDeTurno = {
  origen: 'PLAN',
  personaId: 12,
  casoId: 9,
  planId: 5,
  ofertaId: 14,
};

const contextoDelPlan = (pendientes: number, frecuenciaSemanal = 2) => ({
  casos: [
    {
      casoId: 9,
      numeroCaso: 1,
      responsableId: 31,
      planes: [
        {
          planId: 5,
          numeroPlan: 1,
          frecuenciaSemanal,
          prestaciones: [
            { ofertaId: 14, planificadas: 10, realizadas: 2, programadas: 3, pendientes },
          ],
        },
      ],
    },
  ],
});

const LIBRE = {
  numero: 1,
  estado: 'DISPONIBLE',
  inicio: '2030-03-04T13:00:00Z',
  fin: '2030-03-04T13:45:00Z',
};
const OCUPADA = {
  numero: 2,
  estado: 'NO_DISPONIBLE',
  inicio: '2030-03-07T13:00:00Z',
  motivo: 'El profesional ya tiene un turno',
  sugerencia: { desde: '2030-03-07T14:00:00Z', profesionalId: 40 },
};
const ALTERNATIVA = {
  desde: '2030-03-08T15:00:00Z',
  hasta: '2030-03-08T15:45:00Z',
  profesionalId: 41,
  profesionalNombre: 'Diaz, Juan',
};

/**
 * Programar varias sesiones. Lo que decide: que no se crea nada antes de confirmar, que se confirma lo
 * que quedó de la propuesta fila por fila, y que el alta es todo o nada.
 */
describe('ProgramacionMultiplePanel', () => {
  let httpMock: HttpTestingController;
  let cerrado: number;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProgramacionMultiplePanel],
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

  it('desde un plan precarga cantidad, días y responsable, y pide la propuesta sin crear nada', async () => {
    const fixture = await delPlan(5);

    expect(texto(fixture)).toContain('Pendientes: 5');
    expect(valor(fixture, '#serie-cantidad')).toBe('5');
    expect(valor(fixture, '#serie-profesional')).toBe('31');
    // Dos por semana se reparten lunes y jueves: es una sugerencia, se edita con un click.
    expect(diasMarcados(fixture)).toEqual(['Lun', 'Jue']);

    clic(fixture, 'Buscar disponibilidad');
    const pedido = httpMock.expectOne(PREVISUALIZACION);
    expect(pedido.request.body).toMatchObject({
      ofertaId: 14,
      personaId: 12,
      profesionalId: 31,
      diasSemana: [1, 4],
      hora: '10:00:00',
      cantidad: 5,
      casoId: 9,
      planId: 5,
      origen: 'PLAN',
    });
    pedido.flush({ timezone: ZONA, pendientesDelPlan: 5, ocurrencias: [LIBRE, OCUPADA] });
    await asentar(fixture);

    httpMock.expectNone(SERIES);
    expect(raiz(fixture).querySelectorAll('tbody tr').length).toBe(2);
    expect(texto(fixture)).toContain('El profesional ya tiene un turno');
    expect(texto(fixture)).toContain('Sugerido:');
    expect(texto(fixture)).toContain('Queda 1 sesión sin horario');
    expect(boton(fixture, 'Confirmar 1 turnos')?.disabled).toBe(true);
  });

  it('dice qué falta antes de pedir la propuesta', async () => {
    const fixture = await montar({ origen: 'AGENDA' });
    responderOfertas();
    await asentar(fixture);

    clic(fixture, 'Buscar disponibilidad');
    await asentar(fixture);
    expect(alerta(fixture)).toContain('Falta elegir el paciente.');

    await elegirPaciente(fixture);
    clic(fixture, 'Buscar disponibilidad');
    await asentar(fixture);
    expect(alerta(fixture)).toContain('Falta elegir la prestación.');

    elegirEn(fixture, '#serie-oferta', '14');
    // Dos profesionales: no hay nada que deducir, hay que elegir.
    httpMock
      .expectOne((r) => r.url === PROFESIONALES)
      .flush([
        { id: 31, nombre: 'Lopez, Maria' },
        { id: 40, nombre: 'Diaz, Juan' },
      ]);
    await asentar(fixture);
    clic(fixture, 'Buscar disponibilidad');
    await asentar(fixture);
    expect(alerta(fixture)).toContain('Falta elegir el profesional');

    elegirEn(fixture, '#serie-profesional', '40');
    await asentar(fixture);
    clic(fixture, 'Buscar disponibilidad');
    await asentar(fixture);
    expect(alerta(fixture)).toContain('Falta elegir al menos un día');

    marcarDia(fixture, 'Mié');
    fijar(fixture, '#serie-cantidad', '0');
    await asentar(fixture);
    clic(fixture, 'Buscar disponibilidad');
    await asentar(fixture);
    expect(alerta(fixture)).toContain('Faltan el horario, la fecha inicial o la cantidad');
    httpMock.expectNone(PREVISUALIZACION);
  });

  it('con una sola persona que presta la oferta no pregunta quién', async () => {
    const fixture = await montar({ origen: 'AGENDA', personaId: 12, ofertaId: 14 });
    httpMock.expectOne((r) => r.url === OFERTAS).flush([KINE]);
    httpMock.expectOne((r) => r.url === PROFESIONALES).flush([{ id: 31, nombre: 'Lopez, Maria' }]);
    httpMock.expectOne(ANA_URL).flush(ANA);
    httpMock.expectOne(CONTEXTO_DE_ANA).flush({ casos: [] });
    await asentar(fixture);

    expect(valor(fixture, '#serie-profesional')).toBe('31');
  });

  it('se confirma lo que quedó: la sugerencia aceptada viaja con su profesional', async () => {
    const fixture = await conPropuesta([LIBRE, OCUPADA]);
    const flujo = TestBed.inject(FlujoDeTurnosStore);
    const cambios = flujo.cambios();
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    clic(fixture, 'Usar el sugerido');
    await asentar(fixture);
    expect(texto(fixture)).toContain('Horario cambiado');

    clic(fixture, 'Confirmar 2 turnos');
    const alta = httpMock.expectOne((r) => r.url === SERIES && r.method === 'POST');
    expect(alta.request.body.ocurrencias).toEqual([
      { inicio: LIBRE.inicio },
      { inicio: OCUPADA.sugerencia.desde, profesionalId: 40 },
    ]);
    expect(alta.request.body.idempotencyKey).toBeTruthy();
    alta.flush({ id: 40 });
    await asentar(fixture);

    expect(cerrado).toBe(1);
    expect(flujo.cambios()).toBe(cambios + 1);
    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso.titulo).toBe('2 turnos creados correctamente.');
    aviso.accion?.ejecutar();
    expect(navegar).toHaveBeenCalledWith(['/agenda', 'series', 40]);
  });

  it('una fila excluida no viaja, y se puede volver a incluir', async () => {
    const fixture = await conPropuesta([LIBRE, OCUPADA]);

    const excluir = () =>
      Array.from(raiz(fixture).querySelectorAll('tbody tr'))[1].querySelector<HTMLButtonElement>(
        '.propuesta__acciones button:last-child',
      );
    excluir()?.click();
    await asentar(fixture);
    expect(texto(fixture)).toContain('Excluida');
    expect(texto(fixture)).not.toContain('sin horario');

    excluir()?.click();
    await asentar(fixture);
    expect(texto(fixture)).toContain('Queda 1 sesión sin horario');

    excluir()?.click();
    await asentar(fixture);
    clic(fixture, 'Confirmar 1 turnos');
    const alta = httpMock.expectOne((r) => r.url === SERIES && r.method === 'POST');
    expect(alta.request.body.ocurrencias).toEqual([{ inicio: LIBRE.inicio }]);
    alta.flush({ id: 40 });
    await asentar(fixture);
    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso.titulo).toBe('Turno creado correctamente.');
  });

  it('un feriado se omite y se lista: no frena el alta (U-22)', async () => {
    const FERIADO = {
      numero: 2,
      estado: 'FERIADO',
      inicio: '2030-03-07T13:00:00Z',
      motivo: 'La sede cierra por feriado.',
    };
    const fixture = await conPropuesta([LIBRE, FERIADO]);

    expect(texto(fixture)).toContain('Feriado: se omite');
    expect(texto(fixture)).not.toContain('sin horario');

    clic(fixture, 'Confirmar 1 turnos');
    const alta = httpMock.expectOne((r) => r.url === SERIES && r.method === 'POST');
    expect(alta.request.body.ocurrencias).toEqual([{ inicio: LIBRE.inicio }]);
    alta.flush({ id: 40 });
    await asentar(fixture);
  });

  it('más sesiones que las que le quedan al plan no se puede confirmar', async () => {
    const fixture = await conPropuesta([LIBRE, { ...LIBRE, numero: 2 }], 1);

    expect(texto(fixture)).toContain('Hay más sesiones que las que quedan en el plan');
    expect(boton(fixture, 'Confirmar 2 turnos')?.disabled).toBe(true);
  });

  it('se puede elegir otro horario para una fila, con el buscador del motor', async () => {
    const fixture = await conPropuesta([LIBRE, OCUPADA]);

    clic(fixture, 'Buscar alternativa', 1);
    const busqueda = httpMock.expectOne(BUSQUEDA);
    expect(busqueda.request.body).toMatchObject({
      ofertaId: 14,
      profesionalId: 31,
      desde: '2030-03-07',
      limite: 12,
    });
    busqueda.flush({ horarios: [] });
    await asentar(fixture);

    fijar(fixture, '#serie-alternativa-fecha', '2030-03-08');
    httpMock.expectOne(BUSQUEDA).flush({ horarios: [ALTERNATIVA] });
    await asentar(fixture);

    (raiz(fixture).querySelector('.horario') as HTMLButtonElement).click();
    await asentar(fixture);
    expect(raiz(fixture).querySelector('#serie-alternativa-fecha')).toBeNull();

    clic(fixture, 'Confirmar 2 turnos');
    const alta = httpMock.expectOne((r) => r.url === SERIES && r.method === 'POST');
    expect(alta.request.body.ocurrencias[1]).toEqual({
      inicio: ALTERNATIVA.desde,
      profesionalId: 41,
    });
    alta.flush({ id: 40 });
  });

  it('si algo cambió mientras se revisaba no crea nada y vuelve a proponer', async () => {
    const fixture = await conPropuesta([LIBRE]);

    clic(fixture, 'Confirmar 1 turnos');
    const alta = httpMock.expectOne((r) => r.url === SERIES && r.method === 'POST');
    const clave = alta.request.body.idempotencyKey;
    alta.flush(
      { type: 'https://akine.app/problems/slot-no-disponible', status: 409 },
      { status: 409, statusText: 'C' },
    );
    httpMock.expectOne(PREVISUALIZACION).flush({ timezone: ZONA, ocurrencias: [LIBRE] });
    await asentar(fixture);

    expect(cerrado).toBe(0);
    expect(texto(fixture)).toContain('No se creó ningún turno');

    // Es otro intento: la clave vieja, con otro contenido, sería un 409 propio.
    clic(fixture, 'Confirmar 1 turnos');
    const reintento = httpMock.expectOne((r) => r.url === SERIES && r.method === 'POST');
    expect(reintento.request.body.idempotencyKey).not.toBe(clave);
    reintento.flush({ id: 40 });
  });

  it('un 500 no dice si la serie se creó: el reintento lleva la MISMA clave', async () => {
    const fixture = await conPropuesta([LIBRE]);

    clic(fixture, 'Confirmar 1 turnos');
    const primera = httpMock.expectOne((r) => r.url === SERIES && r.method === 'POST');
    const clave = primera.request.body.idempotencyKey;
    primera.flush({ status: 500, detail: 'Se cayó' }, { status: 500, statusText: 'E' });
    await asentar(fixture);

    clic(fixture, 'Confirmar 1 turnos');
    const segunda = httpMock.expectOne((r) => r.url === SERIES && r.method === 'POST');
    expect(segunda.request.body.idempotencyKey).toBe(clave);
    segunda.flush({ id: 40 });
  });

  it.each([
    ['#serie-hora', '15:00'],
    ['#serie-desde', '2030-04-01'],
    ['#serie-cantidad', '3'],
  ])(
    'cambiar %s es otra regla: lo revisado ya no es lo que se confirmaría',
    async (selector, nuevo) => {
      const fixture = await conPropuesta([LIBRE]);
      expect(raiz(fixture).querySelector('table')).not.toBeNull();

      fijar(fixture, selector, nuevo);
      await asentar(fixture);

      expect(raiz(fixture).querySelector('table')).toBeNull();
      expect(boton(fixture, 'Confirmar 1 turnos')).toBeUndefined();
    },
  );

  it('otro rechazo del alta se muestra sin volver a proponer', async () => {
    const fixture = await conPropuesta([LIBRE]);

    clic(fixture, 'Confirmar 1 turnos');
    httpMock
      .expectOne((r) => r.url === SERIES && r.method === 'POST')
      .flush(
        {
          type: 'https://akine.app/problems/plan-sin-sesiones',
          status: 409,
          detail: 'Sin sesiones',
        },
        { status: 409, statusText: 'C' },
      );
    await asentar(fixture);

    expect(texto(fixture)).toContain('Sin sesiones');
    httpMock.expectNone(PREVISUALIZACION);
  });

  it('un error al pedir la propuesta se muestra', async () => {
    const fixture = await delPlan(5);

    clic(fixture, 'Buscar disponibilidad');
    httpMock
      .expectOne(PREVISUALIZACION)
      .flush({ status: 500, detail: 'Motor caído' }, { status: 500, statusText: 'E' });
    await asentar(fixture);

    expect(texto(fixture)).toContain('Motor caído');
    expect(raiz(fixture).querySelector('table')).toBeNull();
  });

  it('cambiar la regla descarta la propuesta anterior', async () => {
    const fixture = await conPropuesta([LIBRE]);

    marcarDia(fixture, 'Mar');
    await asentar(fixture);

    expect(raiz(fixture).querySelector('table')).toBeNull();
    expect(diasMarcados(fixture)).toEqual(['Lun', 'Mar', 'Jue']);
  });

  it(
    'con la propuesta a la vista no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await conPropuesta([LIBRE, OCUPADA]);
      await esperarSinViolaciones(raiz(fixture));
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------

  async function montar(
    contexto: ContextoDeTurno,
  ): Promise<ComponentFixture<ProgramacionMultiplePanel>> {
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro',
      consultorioId: 3,
      consultorioName: 'Sede',
    });
    // El buscador de pacientes ofrece el alta detras de un permiso, que pide al dibujarse.
    TestBed.inject(PermissionsStore).cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(ProgramacionMultiplePanel);
    fixture.componentRef.setInput('contexto', contexto);
    fixture.componentInstance.cerrar.subscribe(() => cerrado++);
    fixture.detectChanges();
    return fixture;
  }

  async function delPlan(pendientes: number): Promise<ComponentFixture<ProgramacionMultiplePanel>> {
    const fixture = await montar(DEL_PLAN);
    httpMock.expectOne((r) => r.url === OFERTAS).flush([KINE]);
    httpMock
      .expectOne((r) => r.url === PROFESIONALES)
      .flush([
        { id: 31, nombre: 'Lopez, Maria' },
        { id: 40, nombre: 'Diaz, Juan' },
      ]);
    httpMock.expectOne(ANA_URL).flush(ANA);
    httpMock.expectOne(CONTEXTO_DE_ANA).flush(contextoDelPlan(pendientes));
    await asentar(fixture);
    return fixture;
  }

  async function conPropuesta(
    ocurrencias: readonly object[],
    pendientesDelPlan = 5,
  ): Promise<ComponentFixture<ProgramacionMultiplePanel>> {
    const fixture = await delPlan(pendientesDelPlan);
    clic(fixture, 'Buscar disponibilidad');
    httpMock.expectOne(PREVISUALIZACION).flush({ timezone: ZONA, pendientesDelPlan, ocurrencias });
    await asentar(fixture);
    return fixture;
  }

  async function elegirPaciente(
    fixture: ComponentFixture<ProgramacionMultiplePanel>,
  ): Promise<void> {
    const campo = raiz(fixture).querySelector('#flujo-paciente') as HTMLInputElement;
    campo.value = 'Perez';
    campo.dispatchEvent(new Event('input'));
    await new Promise((listo) => setTimeout(listo, 350));
    httpMock.expectOne((r) => r.url === '/api/v1/personas').flush({ content: [ANA] });
    await asentar(fixture);
    (raiz(fixture).querySelector('.candidato') as HTMLButtonElement).click();
    httpMock.expectOne(CONTEXTO_DE_ANA).flush({ casos: [] });
    await asentar(fixture);
  }

  function responderOfertas(): void {
    httpMock.expectOne((r) => r.url === OFERTAS).flush([KINE]);
  }

  function raiz(fixture: ComponentFixture<ProgramacionMultiplePanel>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function texto(fixture: ComponentFixture<ProgramacionMultiplePanel>): string {
    return (raiz(fixture).textContent ?? '').replace(/\s+/g, ' ');
  }

  function alerta(fixture: ComponentFixture<ProgramacionMultiplePanel>): string {
    return raiz(fixture).querySelector('[role="alert"]')?.textContent ?? '';
  }

  function valor(fixture: ComponentFixture<ProgramacionMultiplePanel>, selector: string): string {
    return (raiz(fixture).querySelector(selector) as HTMLInputElement | HTMLSelectElement).value;
  }

  function diasMarcados(fixture: ComponentFixture<ProgramacionMultiplePanel>): readonly string[] {
    return Array.from(raiz(fixture).querySelectorAll('.dias-semana label'))
      .filter((label) => (label.querySelector('input') as HTMLInputElement).checked)
      .map((label) => (label.textContent ?? '').trim());
  }

  function marcarDia(fixture: ComponentFixture<ProgramacionMultiplePanel>, dia: string): void {
    const etiqueta = Array.from(raiz(fixture).querySelectorAll('.dias-semana label')).find(
      (label) => (label.textContent ?? '').trim() === dia,
    );
    (etiqueta?.querySelector('input') as HTMLInputElement).dispatchEvent(new Event('change'));
  }

  function elegirEn(
    fixture: ComponentFixture<ProgramacionMultiplePanel>,
    selector: string,
    opcion: string,
  ): void {
    fijar(fixture, selector, opcion);
  }

  function fijar(
    fixture: ComponentFixture<ProgramacionMultiplePanel>,
    selector: string,
    nuevo: string,
  ): void {
    const campo = raiz(fixture).querySelector(selector) as HTMLInputElement | HTMLSelectElement;
    campo.value = nuevo;
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function boton(
    fixture: ComponentFixture<ProgramacionMultiplePanel>,
    rotulo: string,
    indice = 0,
  ): HTMLButtonElement | undefined {
    return Array.from(raiz(fixture).querySelectorAll('button')).filter(
      (b) => (b.textContent ?? '').trim() === rotulo,
    )[indice];
  }

  function clic(
    fixture: ComponentFixture<ProgramacionMultiplePanel>,
    rotulo: string,
    indice = 0,
  ): void {
    const encontrado = boton(fixture, rotulo, indice);
    if (encontrado === undefined) {
      throw new Error(`No está el botón "${rotulo}"`);
    }
    encontrado.click();
    fixture.detectChanges();
  }

  async function asentar(fixture: ComponentFixture<ProgramacionMultiplePanel>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }
});
