import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { CambiosDeAgendaPage } from './cambios-de-agenda-page';
import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { PERMISO_AGENDA_EXCEPCIONES } from '../../../../core/models/permisos';
import { FlujoDeTurnosStore } from '../../../../core/services/flujo-de-turnos.store';
import { PerfilPropioStore } from '../../../../core/services/perfil-propio.store';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { RUTA_PERMISOS_EFECTIVOS, rutaMemberships } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';

const ORG = 1;
const SEDE = 3;
const ANA_ID = 42;
const HISTORIAL = `/api/v1/organizations/${ORG}/agenda/historial`;

const ANA = {
  id: ANA_ID,
  accountName: 'Ana Kine',
  roleCode: 'PROFESIONAL',
  estado: 'ACTIVA',
  consultorioId: null,
};
const BETO = { ...ANA, id: 43, accountName: 'Beto Fisio' };

const MOVIDO = {
  id: 900,
  ocurridoEn: '2026-11-02T13:00:00Z',
  tipo: 'TURNO_REPROGRAMACION',
  entidad: 'TURNO',
  consultorioId: SEDE,
  consultorioNombre: 'Sede Centro',
  actorNombre: 'Rita Recepción',
  actorRol: 'ADMINISTRATIVO',
  motivo: 'Pedido del paciente',
  antes: '10:00',
  despues: '11:00',
  turnoId: 77,
  personaNombre: 'Gomez, Luis',
};

const DE_OTRA_SEDE = {
  ...MOVIDO,
  id: 901,
  tipo: 'HORARIO_ALTA',
  entidad: 'HORARIO',
  consultorioId: 8,
  consultorioNombre: 'Sede Norte',
  turnoId: undefined,
  personaNombre: undefined,
  actorRol: undefined,
};

const CIERRE = {
  id: 910,
  ocurridoEn: '2026-11-01T12:00:00Z',
  tipo: 'CIERRE_DE_SEDE_ALTA',
  entidad: 'CIERRE_DE_SEDE',
  entidadId: 55,
  consultorioId: SEDE,
  consultorioNombre: 'Sede Centro',
  profesionalId: 43,
  actorNombre: 'Olga Admin',
  actorRol: 'ORG_ADMIN',
  cierreDeSede: {
    excepcionId: 55,
    motivo: 'FERIADO',
    fechaDesde: '2026-11-20',
    ultimoDia: '2026-11-21',
    vigente: true,
    conHorarioHabitual: true,
    turnosEnElPeriodo: 3,
    turnosPendientes: 2,
    turnosCancelados: 1,
  },
};

const TRASLADO = {
  ...MOVIDO,
  id: 920,
  tipo: 'TURNO_TRASLADO',
  antes: 'lun 09/11 10:00 · Sede Centro · Ana Kine',
  despues: 'lun 09/11 11:00 · Sede Norte · Beto Fisio',
  cambioDeProfesional: true,
  turnoNuevoId: 78,
  operacionId: 'op-1',
  eventosRelacionados: [
    { id: 921, ocurridoEn: '2026-11-02T13:00:00Z', eventType: 'TURNO_CANCELADO', turnoId: 77 },
    { id: 922, ocurridoEn: '2026-11-02T13:00:00Z', eventType: 'TURNO_RESERVADO', turnoId: 78 },
  ],
};

/**
 * Historial de cambios de la agenda (contrato 0.157.0): quien ve que, que parametros salen y como
 * se lee el 403 de alcance propio.
 */
describe('CambiosDeAgendaPage', () => {
  let httpMock: HttpTestingController;
  let queryParams: Record<string, string> = {};
  let verTurno: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    queryParams = {};
    verTurno = vi.fn();
    await TestBed.configureTestingModule({
      imports: [CambiosDeAgendaPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
        { provide: FlujoDeTurnosStore, useValue: { verTurno } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              get queryParamMap() {
                return convertToParamMap(queryParams);
              },
            },
          },
        },
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('sin profesional elegido no consulta: pide elegir uno', async () => {
    const fixture = await montar({ propio: false });
    profesionales().flush({ content: [ANA, BETO], totalElements: 2 });
    await estabilizar(fixture);

    httpMock.expectNone((r) => r.url === HISTORIAL);
    expect(texto(fixture)).toContain('Elegí un profesional para ver los cambios de su agenda.');
    expect(fixture.nativeElement.querySelector('#cambios-profesional')).not.toBeNull();
  });

  it('al elegir, pide la primera página de 10 y muestra quién, rol, motivo y antes → ahora', async () => {
    const fixture = await montar({ propio: false });
    profesionales().flush({ content: [ANA, BETO], totalElements: 2 });
    await estabilizar(fixture);

    elegir(fixture, '43');
    const pedido = historial();
    expect(pedido.request.params.get('profesionalId')).toBe('43');
    expect(pedido.request.params.get('size')).toBe('10');
    expect(pedido.request.params.get('page')).toBe('0');
    expect(pedido.request.params.has('tipo')).toBe(false);
    expect(pedido.request.params.has('consultorioId')).toBe(false);
    pedido.flush({ content: [MOVIDO, DE_OTRA_SEDE], totalElements: 2, totalPages: 1 });
    await estabilizar(fixture);

    const contenido = texto(fixture);
    expect(contenido).toContain('Se movió un turno de horario');
    expect(contenido).toContain('Gomez, Luis');
    expect(contenido).toContain('10:00 → 11:00');
    expect(contenido).toContain('Rita Recepción');
    expect(contenido).toContain('Administrativo');
    expect(contenido).toContain('Pedido del paciente');
    expect(contenido).toContain('Se agregó un horario');

    // "Ver turno" solo para el turno de la sede activa.
    const botones = [...fixture.nativeElement.querySelectorAll('button')].filter(
      (b) => (b as HTMLElement).textContent?.trim() === 'Ver turno',
    ) as HTMLButtonElement[];
    expect(botones).toHaveLength(1);
    botones[0].click();
    expect(verTurno).toHaveBeenCalledWith(77);
  });

  it('los filtros viajan como tipo, consultorioId, q y orden', async () => {
    queryParams = { membershipId: '43' };
    const fixture = await montar({ propio: false });
    profesionales().flush({ content: [ANA, BETO], totalElements: 2 });
    historial().flush({ content: [MOVIDO], totalElements: 1, totalPages: 1 });
    await estabilizar(fixture);

    const casillas = [
      ...fixture.nativeElement.querySelectorAll('.cambios__grupos input'),
    ] as HTMLInputElement[];
    casillas[1].click();
    const sede = fixture.nativeElement.querySelector('#cambios-sede') as HTMLInputElement;
    sede.click();
    const q = fixture.nativeElement.querySelector('#cambios-q') as HTMLInputElement;
    q.value = ' paciente ';
    q.dispatchEvent(new Event('input'));
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );

    const pedido = historial();
    expect(pedido.request.params.getAll('tipo')).toEqual([
      'EXCEPCION_ALTA',
      'EXCEPCION_EDICION',
      'EXCEPCION_BAJA',
    ]);
    expect(pedido.request.params.get('consultorioId')).toBe(String(SEDE));
    expect(pedido.request.params.get('q')).toBe('paciente');
    pedido.flush({ content: [MOVIDO], totalElements: 1, totalPages: 1 });
    await estabilizar(fixture);

    const cuando = fixture.nativeElement.querySelector('th button') as HTMLButtonElement;
    cuando.click();
    const ordenado = historial();
    expect(decodeURIComponent(ordenado.request.params.get('sort') ?? '')).toBe('ocurridoEn,asc');
    ordenado.flush({ content: [], totalElements: 0, totalPages: 0 });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('No hay cambios para mostrar.');
  });

  it('con alcance propio no hay selector: consulta la agenda propia e ignora el enlace', async () => {
    queryParams = { membershipId: '43' };
    const fixture = await montar({ propio: true });

    const pedido = historial();
    expect(pedido.request.params.get('profesionalId')).toBe(String(ANA_ID));
    pedido.flush({ content: [MOVIDO], totalElements: 1, totalPages: 1 });
    await estabilizar(fixture);

    httpMock.expectNone((r) => r.url === rutaMemberships(ORG));
    expect(fixture.nativeElement.querySelector('#cambios-profesional')).toBeNull();
    expect(texto(fixture)).toContain('Tu agenda');
  });

  it('el 403 de alcance propio dice que solo ve su agenda', async () => {
    const fixture = await montar({ propio: true });

    historial().flush(
      { type: 'https://akine.app/problems/forbidden', status: 403, alcance: 'PROPIO' },
      { status: 403, statusText: 'Forbidden' },
    );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Solo podés ver los cambios de tu propia agenda.');
  });

  it('un cierre de sede muestra período, estado, turnos y la reubicación en la agenda', async () => {
    queryParams = { membershipId: '43' };
    const fixture = await montar({ propio: false });
    profesionales().flush({ content: [ANA, BETO], totalElements: 2 });
    historial().flush({
      content: [CIERRE, { ...CIERRE, id: 911, consultorioId: 8 }],
      totalElements: 2,
      totalPages: 1,
    });
    await estabilizar(fixture);

    const contenido = texto(fixture);
    expect(contenido).toContain('Cierre general de sede');
    expect(contenido).toContain(
      'Del 20 de noviembre de 2026 al 21 de noviembre de 2026 · día completo',
    );
    expect(contenido).toContain('Vigente');
    expect(contenido).toContain('Feriado');
    expect(contenido).toContain('3 turnos en el período · 2 a reubicar · 1 cancelado');

    // Solo el de la sede activa lleva a la agenda: la otra sede no esta en este contexto.
    const enlaces = [...fixture.nativeElement.querySelectorAll('a')].filter(
      (a) => (a as HTMLElement).textContent?.trim() === 'Reubicar turnos',
    ) as HTMLAnchorElement[];
    expect(enlaces).toHaveLength(1);
    const destino = new URL(enlaces[0].href);
    expect(destino.pathname).toBe('/agenda');
    expect(destino.searchParams.get('estado')).toBe('A_REUBICAR');
    expect(destino.searchParams.get('fecha')).toBe('2026-11-20');
    expect(destino.searchParams.get('profesional')).toBe('43');
    expect(destino.searchParams.get('vista')).toBe('semana');
  });

  it('un traslado es una sola fila, con antes → después y el detalle técnico', async () => {
    const fixture = await montar({ propio: true });
    historial().flush({ content: [TRASLADO], totalElements: 1, totalPages: 1 });
    await estabilizar(fixture);

    const filas = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(filas).toHaveLength(1);
    const contenido = texto(fixture);
    expect(contenido).toContain('Turno trasladado');
    expect(contenido).toContain(
      'Sede Centro · Ana Kine → lun 09/11 11:00 · Sede Norte · Beto Fisio',
    );
    expect(contenido).toContain('Cambió de profesional');
    expect(contenido).toContain('Cancelación del turno original');
    expect(contenido).toContain('Reserva del turno en la sede de destino');
  });

  it(
    'la tabla con resultados no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar({ propio: true });
      historial().flush({
        content: [MOVIDO, DE_OTRA_SEDE, CIERRE, TRASLADO],
        totalElements: 4,
        totalPages: 1,
      });
      await estabilizar(fixture);
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  async function montar(opciones: {
    propio: boolean;
  }): Promise<ComponentFixture<CambiosDeAgendaPage>> {
    (TestBed.inject(PerfilPropioStore) as unknown as { membershipId: unknown }).membershipId =
      signal(ANA_ID);
    TestBed.inject(TenantContextStore).select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });
    TestBed.inject(PermissionsStore).cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({
      permissions: [PERMISO_AGENDA_EXCEPCIONES],
      ownScopedPermissions: opciones.propio ? [PERMISO_AGENDA_EXCEPCIONES] : [],
    });
    const fixture = TestBed.createComponent(CambiosDeAgendaPage);
    fixture.detectChanges();
    await estabilizar(fixture);
    return fixture;
  }

  function profesionales() {
    return httpMock.expectOne((r: HttpRequest<unknown>) => r.url === rutaMemberships(ORG));
  }

  function historial() {
    return httpMock.expectOne((r: HttpRequest<unknown>) => r.url === HISTORIAL);
  }
});

function elegir(fixture: ComponentFixture<CambiosDeAgendaPage>, valor: string): void {
  const select = fixture.nativeElement.querySelector('#cambios-profesional') as HTMLSelectElement;
  select.value = valor;
  select.dispatchEvent(new Event('change'));
}

async function estabilizar(fixture: ComponentFixture<CambiosDeAgendaPage>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
}
