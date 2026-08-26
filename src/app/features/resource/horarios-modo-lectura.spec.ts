import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Type } from '@angular/core';
import { provideRouter } from '@angular/router';

import { CalendarioSedePage } from './pages/calendario/calendario-sede-page';
import { ExcepcionesPage } from './pages/excepciones/excepciones-page';
import { HorarioSemanalPage } from './pages/horarios/horario-semanal-page';
import { PERMISO_COLABORADOR_READ, PERMISO_CONSULTORIO_MANAGE } from '../../core/models/permisos';
import { PermissionsStore } from '../../core/services/permissions.store';
import {
  RUTA_PERMISOS_EFECTIVOS,
  rutaBloquesDisponibilidad,
  rutaCalendarioSede,
  rutaExcepciones,
  rutaMemberships,
} from '../../core/testing/rutas-api';
import { TenantContextStore } from '../../core/services/tenant-context.store';
import { errorInterceptor } from '../../core/interceptors/error.interceptor';
import { provideApi } from '../../api/generated/provide-api';

const ORG = 1;
const SEDE = 3;
const PROFESIONAL = 42;

const BLOQUES = rutaBloquesDisponibilidad(SEDE, PROFESIONAL);
const EXCEPCIONES = rutaExcepciones(SEDE);
const CALENDARIO = rutaCalendarioSede(SEDE);

/** Solo lectura: el rol `PROFESIONAL` de la matriz de permisos. */
const SOLO_LECTURA = [PERMISO_COLABORADOR_READ];
const GESTION = [PERMISO_COLABORADOR_READ, PERMISO_CONSULTORIO_MANAGE];

const ANA = {
  id: PROFESIONAL,
  accountName: 'Ana Kine',
  accountEmail: 'ana@example.test',
  roleCode: 'PROFESIONAL',
  estado: 'ACTIVA',
  consultorioId: null,
};

const PAGINA_DE_VINCULOS = {
  content: [ANA],
  page: 0,
  size: 100,
  totalElements: 1,
  totalPages: 1,
};

const LUNES_MANANA = {
  id: 100,
  consultorioId: SEDE,
  membershipId: PROFESIONAL,
  diaSemana: 1,
  horaDesde: '09:00',
  horaHasta: '12:00',
  vigenciaDesde: '2026-01-05',
  estado: 'ACTIVO',
  version: 1,
  turnosAfectados: 0,
};

const CIERRE_DE_SEDE = {
  id: 500,
  consultorioId: SEDE,
  organizationId: ORG,
  membershipId: null,
  tipo: 'CIERRE',
  motivo: 'BLOQUEO',
  fechaDesde: '2026-09-01',
  fechaHasta: '2026-09-03',
  horaDesde: null,
  horaHasta: null,
  notes: 'Obra en el pasillo',
  estado: 'ACTIVO',
  version: 1,
};

const POLITICA = {
  consultorioId: SEDE,
  pais: 'AR',
  cierraPorFeriado: true,
  existePersistida: true,
  feriados: [
    { id: 9, fecha: '2026-09-10', nombre: 'Dia del maestro', pais: 'AR', tipo: 'INAMOVIBLE' },
  ],
  version: 4,
};

/**
 * Modo lectura de las cuatro pantallas de horarios (M05, AKINE-02.04).
 *
 * <p>Un `PROFESIONAL` tiene `colaborador:read` y no tiene `consultorio:manage`. Lo que este
 * spec prueba no es que la pantalla "se vea": es que <b>las acciones no esten y los datos
 * si</b>. Las dos mitades importan por igual y se rompen en direcciones opuestas:
 *
 * <ul>
 *   <li>Ofrecer un boton que va a volver <b>403</b> convierte un permiso faltante en un error
 *       tecnico que el usuario no puede interpretar.</li>
 *   <li>Esconder los datos junto con los botones deja al profesional sin poder mirar su propia
 *       semana, que es exactamente lo que `colaborador:read` le concede.</li>
 * </ul>
 *
 * <p>Hay ademas un tercer estado que no es ninguno de los dos: <b>permisos desconocidos</b>. Ahi
 * no se ofrece nada —igual que en modo lectura— pero tampoco se afirma que falte permiso,
 * porque todavia no se sabe.
 *
 * <p>El horario efectivo (`/horarios/efectivo`) no aparece aca a proposito: <b>no ofrece ninguna
 * accion a nadie</b>, ni siquiera con `consultorio:manage`, asi que no tiene modo lectura que
 * probar. Su spec ya cubre que la lectura funcione con `colaborador:read`.
 */
describe('Modo lectura de las pantallas de horarios', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    tenantContext = TestBed.inject(TenantContextStore);
    permisos = TestBed.inject(PermissionsStore);
  });

  afterEach(() => httpMock.verify());

  it('el horario semanal muestra la semana entera y no ofrece ninguna accion', async () => {
    const fixture = await montarSemanal(SOLO_LECTURA);
    const contenido = texto(fixture);

    // El DATO sigue estando: el profesional tiene que poder mirar su semana.
    expect(contenido).toContain('Ana Kine');
    expect(contenido).toContain('09:00');
    expect(contenido).toContain('12:00');

    // Y ninguna de las tres acciones se ofrece.
    expect(boton(fixture, 'Agregar un bloque')).toBeUndefined();
    expect(boton(fixture, 'Editar')).toBeUndefined();
    expect(boton(fixture, 'Dar de baja')).toBeUndefined();

    // El cartel nombra el permiso que falta. Sin el, una pantalla sin un solo boton se lee
    // como una pantalla que no termino de cargar.
    expect(contenido).toContain('Modo lectura');
    expect(contenido).toContain('consultorio:manage');
  });

  it('con consultorio:manage el horario semanal si ofrece las acciones', async () => {
    const fixture = await montarSemanal(GESTION);

    expect(boton(fixture, 'Agregar un bloque')).toBeDefined();
    expect(boton(fixture, 'Editar')).toBeDefined();
    expect(boton(fixture, 'Dar de baja')).toBeDefined();
    expect(texto(fixture)).not.toContain('Modo lectura');
  });

  it('los cierres y aperturas se listan enteros y sin acciones', async () => {
    const fixture = await montarExcepciones(SOLO_LECTURA);
    const contenido = texto(fixture);

    // Un profesional necesita ver que su sede cierra: el cierre, su alcance y su motivo siguen.
    expect(contenido).toContain('Obra en el pasillo');
    expect(contenido).toContain('Toda la sede');

    expect(boton(fixture, 'Cargar un cierre o una apertura')).toBeUndefined();
    expect(boton(fixture, 'Dar de baja')).toBeUndefined();
    expect(contenido).toContain('Modo lectura');
  });

  it('con consultorio:manage los cierres y aperturas si ofrecen las acciones', async () => {
    const fixture = await montarExcepciones(GESTION);

    expect(boton(fixture, 'Cargar un cierre o una apertura')).toBeDefined();
    expect(boton(fixture, 'Dar de baja')).toBeDefined();
    expect(texto(fixture)).not.toContain('Modo lectura');
  });

  it('la politica de feriados se sigue viendo, pero la casilla queda deshabilitada', async () => {
    const fixture = await montarCalendario(SOLO_LECTURA);
    const contenido = texto(fixture);

    // La politica y los feriados son el dato de la pantalla: se ven igual.
    expect(contenido).toContain('AR');
    expect(contenido).toContain('Dia del maestro');

    // La casilla NO se oculta —muestra la politica vigente— pero no se puede tocar. Viva y sin
    // boton al lado, dejaria al profesional viendo "La sede pasa a atender los feriados" y
    // "Hay un cambio sin guardar": dos afirmaciones falsas que no tendria como deshacer.
    const control = casilla(fixture);
    expect(control.checked).toBe(true);
    expect(control.disabled).toBe(true);

    expect(boton(fixture, 'Guardar la politica')).toBeUndefined();
    expect(contenido).toContain('Modo lectura');
  });

  it('en modo lectura ni el submit del formulario guarda la politica', async () => {
    const fixture = await montarCalendario(SOLO_LECTURA);

    // Un formulario tambien se envia con Enter, y ese `submit` no pasa por ningun boton: si el
    // modo lectura dependiera de ocultar el boton, esto saldria a la red y volveria 403.
    enviar(fixture, '#form-politica');

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'PUT');
  });

  it('con consultorio:manage la casilla esta viva y el guardado se ofrece', async () => {
    const fixture = await montarCalendario(GESTION);

    expect(casilla(fixture).disabled).toBe(false);
    expect(boton(fixture, 'Guardar la politica')).toBeDefined();
    expect(texto(fixture)).not.toContain('Modo lectura');
  });

  it('mientras los permisos no cargaron no se ofrece nada y tampoco se afirma que falten', async () => {
    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    const fixture = TestBed.createComponent(CalendarioSedePage);
    fixture.detectChanges();

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === CALENDARIO)
      .flush(POLITICA);
    await estabilizar(fixture);

    // Los permisos estan viajando: la directiva los pidio sola al quedar oculta.
    const pendientes = httpMock.match(RUTA_PERMISOS_EFECTIVOS);
    expect(pendientes.length).toBeGreaterThan(0);

    // Falla cerrado: nada que se pueda clickear ni marcar...
    expect(boton(fixture, 'Guardar la politica')).toBeUndefined();
    expect(casilla(fixture).disabled).toBe(true);
    // ...y sin embargo NO se le dice a un administrador que le falta un permiso que quizas
    // tiene. "Todavia no se" y "no tiene" no son el mismo estado.
    expect(texto(fixture)).not.toContain('Modo lectura');

    pendientes.forEach((peticion) => peticion.flush({ permissions: SOLO_LECTURA }));
    await estabilizar(fixture);

    // Recien ahora, con la respuesta en mano, la pantalla explica que falta.
    expect(texto(fixture)).toContain('Modo lectura');
  });

  async function montarSemanal(
    permisosOtorgados: readonly string[],
  ): Promise<ComponentFixture<HorarioSemanalPage>> {
    const fixture = crear(HorarioSemanalPage, permisosOtorgados);

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaMemberships(ORG))
      .flush(PAGINA_DE_VINCULOS);
    await estabilizar(fixture);

    seleccionar(fixture, '#selector-profesional', String(PROFESIONAL));
    httpMock.expectOne(BLOQUES).flush([LUNES_MANANA]);
    await estabilizar(fixture);

    return fixture;
  }

  async function montarExcepciones(
    permisosOtorgados: readonly string[],
  ): Promise<ComponentFixture<ExcepcionesPage>> {
    const fixture = crear(ExcepcionesPage, permisosOtorgados);

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaMemberships(ORG))
      .flush(PAGINA_DE_VINCULOS);
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'GET' && peticion.url === EXCEPCIONES,
      )
      .flush([CIERRE_DE_SEDE]);
    await estabilizar(fixture);

    return fixture;
  }

  async function montarCalendario(
    permisosOtorgados: readonly string[],
  ): Promise<ComponentFixture<CalendarioSedePage>> {
    const fixture = crear(CalendarioSedePage, permisosOtorgados);

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'GET' && peticion.url === CALENDARIO,
      )
      .flush(POLITICA);
    await estabilizar(fixture);

    return fixture;
  }

  function crear<T>(pantalla: Type<T>, permisosOtorgados: readonly string[]): ComponentFixture<T> {
    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [...permisosOtorgados] });

    const fixture = TestBed.createComponent(pantalla);
    fixture.detectChanges();
    return fixture;
  }
});

async function estabilizar(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
}

/** Devuelve el boton o `undefined`. Que no exista es justamente lo que estos tests afirman. */
function boton(
  fixture: { nativeElement: HTMLElement },
  etiqueta: string,
): HTMLButtonElement | undefined {
  return [...fixture.nativeElement.querySelectorAll('button')].find(
    (candidato) => (candidato.textContent ?? '').trim() === etiqueta,
  );
}

function casilla(fixture: { nativeElement: HTMLElement }): HTMLInputElement {
  const control = fixture.nativeElement.querySelector<HTMLInputElement>('#calendario-cierra');
  if (control === null) {
    throw new Error('No existe la casilla de la politica');
  }
  return control;
}

function seleccionar(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: string,
) {
  const desplegable = fixture.nativeElement.querySelector<HTMLSelectElement>(selector);
  if (desplegable === null) {
    throw new Error(`No existe el desplegable ${selector}`);
  }
  desplegable.value = valor;
  desplegable.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

/** Falla cerrado: un helper que no encuentra el formulario haria pasar cualquier `expectNone`. */
function enviar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string) {
  const formulario = fixture.nativeElement.querySelector<HTMLFormElement>(selector);
  if (formulario === null) {
    throw new Error(`No existe el formulario ${selector}`);
  }
  formulario.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}
