import { Location } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { PERMISO_CONSULTORIO_MANAGE, PERMISO_TURNO_MANAGE } from '../../../../core/models/permisos';
import { FlujoDeTurnosStore } from '../../../../core/services/flujo-de-turnos.store';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { fijarReloj, soltarReloj } from '../../../../core/testing/reloj';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { AgendaPage } from './agenda-page';

const SEDE = '/api/v1/consultorios/3';
const OPERATIVA = `${SEDE}/agenda/operativa`;
const PROFESIONALES = `${SEDE}/disponibilidad/profesionales`;
const OFERTAS = `${SEDE}/ofertas`;

const ZONA = 'America/Argentina/Cordoba';
const FECHA = '2030-03-06'; // miercoles
const LUNES = '2030-03-04';

const local = (hora: string, fecha = FECHA): string => {
  const [hh, mm] = hora.split(':').map(Number);
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia, hh + 3, mm)).toISOString();
};

const ANA = {
  membershipId: 31,
  nombre: 'Lopez, Maria',
  franjas: [{ desde: local('09:00'), hasta: local('11:00') }],
};

const TURNO = {
  profesionalNombre: 'Lopez, Maria',
  turno: {
    id: 700,
    inicio: local('09:30'),
    fin: local('10:00'),
    personaNombre: 'Perez, Ana',
    ofertaNombre: 'Kinesiologia',
    profesionalId: 31,
    espacioId: 7,
    operativo: {
      estadoOperativo: 'CONFIRMADO',
      numeroCaso: 2,
      sesionNumero: 3,
      sesionesPlanificadas: 10,
      espacioNombre: 'Box 1',
    },
  },
};

const AGENDA = {
  timezone: ZONA,
  profesionales: [ANA],
  espacios: [{ id: 7, nombre: 'Box 1' }],
  turnos: [TURNO],
};

/**
 * La agenda operativa. El cálculo de la grilla tiene su spec: acá va lo que hace la pantalla con él,
 * sobre todo que después de tocar un turno relea en el lugar, sin perder fecha ni filtros.
 */
describe('AgendaPage', () => {
  let httpMock: HttpTestingController;
  let angosta: boolean;

  beforeEach(async () => {
    angosta = false;
    vi.stubGlobal('matchMedia', () => ({
      matches: angosta,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    await TestBed.configureTestingModule({
      imports: [AgendaPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    fijarReloj(`${LUNES}T10:00:00Z`);
  });

  afterEach(() => {
    soltarReloj();
    vi.unstubAllGlobals();
    // Con prestacion filtrada se piden sus duraciones propias: sin respuesta, la celda usa la de la oferta.
    httpMock.match((r) => r.url.endsWith('/habilitaciones'));
    httpMock.verify();
  });

  describe('lectura', () => {
    it('pide el día y dibuja la columna del profesional, sus turnos y sus horarios libres', async () => {
      const fixture = await montar();

      const pedido = leida();
      expect(pedido.request.params.get('desde')).toBe(FECHA);
      expect(pedido.request.params.get('hasta')).toBe('2030-03-07');
      expect(pedido.request.params.get('incluirCancelados')).toBe('false');
      expect(pedido.request.params.has('profesionalId')).toBe(false);
      pedido.flush(AGENDA);
      await asentar(fixture);

      expect(raiz(fixture).querySelector('.grilla__titulo')?.textContent).toContain('Lopez, Maria');
      const turno = raiz(fixture).querySelector('button.turno');
      expect(turno?.textContent).toContain('Perez, Ana');
      expect(turno?.textContent).toContain('Confirmado');
      expect(turno?.textContent).toContain('Caso 2 · Sesión 3/10');
      expect(turno?.textContent).toContain('Box 1');
      // El estado se dice con texto y con el nombre accesible: el color nunca es la única señal.
      expect(turno?.textContent).toContain('Confirmado');
      expect(turno?.classList).toContain('turno--confirmado');
      // 09:00, 10:00 y 10:30: el turno de 09:30 ocupa ese horario.
      expect(celdas(fixture).map((c) => c.textContent)).toEqual([
        expect.stringContaining('09:00'),
        expect.stringContaining('10:00'),
        expect.stringContaining('10:30'),
      ]);
    });

    it(
      'con la grilla a la vista no tiene violaciones de accesibilidad',
      async () => {
        const fixture = await montar();
        leida().flush(AGENDA);
        await asentar(fixture);

        await esperarSinViolaciones(raiz(fixture));
      },
      TIMEOUT_AXE,
    );

    it('un sobreturno se marca, y las clases y los bloqueos también se dibujan', async () => {
      const fixture = await montar();
      leida().flush({
        ...AGENDA,
        turnos: [
          {
            ...TURNO,
            turno: {
              ...TURNO.turno,
              operativo: {
                estadoOperativo: 'EN_ATENCION',
                sobreturno: true,
                profesionalNombre: 'Lopez, Maria',
              },
            },
          },
        ],
        clases: [
          {
            claseId: 5,
            profesionalId: 31,
            inicio: local('10:00'),
            fin: local('11:00'),
            ofertaNombre: 'Pilates',
            ocupados: 3,
            capacidad: 8,
          },
        ],
        bloqueos: [
          {
            excepcionId: 8,
            membershipId: 31,
            desde: local('09:00'),
            hasta: local('09:30'),
            notas: 'Reunión',
          },
        ],
      });
      await asentar(fixture);

      const turno = raiz(fixture).querySelector('button.turno');
      expect(turno?.classList).toContain('turno--en-atencion');
      expect(turno?.classList).toContain('turno--sobreturno');
      expect(turno?.textContent).toContain('Sobreturno');
      expect(raiz(fixture).querySelector('.evento--clase')?.textContent).toContain('Clase · 3/8');
      expect(raiz(fixture).querySelector('.evento--bloqueo')?.textContent).toContain('Reunión');
    });

    it('si falla lo dice y deja reintentar; sin sede ofrece elegirla', async () => {
      const fixture = await montar();
      leida().flush({ status: 500, detail: 'Caído' }, { status: 500, statusText: 'E' });
      await asentar(fixture);

      expect(texto(fixture)).toContain('No pudimos leer la agenda');
      expect(texto(fixture)).toContain('Caído');

      clic(fixture, 'Reintentar');
      leida().flush(
        { type: 'https://akine.app/problems/missing-tenant-context', status: 403 },
        { status: 403, statusText: 'F' },
      );
      await asentar(fixture);

      expect(raiz(fixture).querySelector('a[href="/seleccionar-contexto"]')).not.toBeNull();
    });

    it('la lectura vieja se cancela: gana la última pedida', async () => {
      const fixture = await montar();
      const vieja = leida();

      clic(fixture, 'Siguiente');

      expect(vieja.cancelled).toBe(true);
      expect(leida().request.params.get('desde')).toBe('2030-03-07');
    });
  });

  describe('estados vacíos', () => {
    it('sin horarios ni turnos lo dice y deja dar un turno igual', async () => {
      const fixture = await montar();
      leida().flush({
        timezone: ZONA,
        profesionales: [{ membershipId: 31, nombre: 'Lopez, Maria' }],
      });
      await asentar(fixture);

      expect(texto(fixture)).toContain('No hay turnos para este período');
      expect(texto(fixture)).toContain('Tampoco hay horarios de atención cargados');

      clic(fixture, 'Crear turno');
      expect(TestBed.inject(FlujoDeTurnosStore).solicitud()).toMatchObject({
        tipo: 'nuevo',
        contexto: { origen: 'AGENDA', fecha: FECHA },
      });
    });

    it('con horarios y sin turnos muestra la grilla y avisa abajo', async () => {
      const fixture = await montar();
      leida().flush({ ...AGENDA, turnos: [] });
      await asentar(fixture);

      expect(raiz(fixture).querySelector('.grilla')).not.toBeNull();
      expect(raiz(fixture).querySelector('.agenda-vacia')?.textContent).toContain(
        'No hay turnos para este día',
      );
    });

    it('una sede sin boxes lo dice, en vez de hablar de horarios', async () => {
      const fixture = await montar({ por: 'box' });
      leida().flush({ timezone: ZONA, profesionales: [ANA], espacios: [] });
      await asentar(fixture);

      expect(texto(fixture)).toContain('Esta sede no tiene boxes en servicio');
      expect(texto(fixture)).not.toContain('Tampoco hay horarios');
    });

    it('una sede sin profesionales lo dice', async () => {
      const fixture = await montar();
      leida().flush({ timezone: ZONA, profesionales: [], espacios: [] });
      await asentar(fixture);

      expect(texto(fixture)).toContain('Esta sede no tiene profesionales');
    });
  });

  describe('dar un turno', () => {
    it('la celda abre el flujo con lo que ya sabe: fecha, hora y profesional', async () => {
      const fixture = await montar();
      leida().flush(AGENDA);
      await asentar(fixture);

      celdas(fixture)[0].click();

      expect(TestBed.inject(FlujoDeTurnosStore).solicitud()).toEqual({
        tipo: 'nuevo',
        contexto: {
          origen: 'AGENDA',
          fecha: FECHA,
          inicio: local('09:00'),
          profesionalId: 31,
          espacioId: undefined,
          ofertaId: undefined,
        },
      });
    });

    it('en la vista por box la celda sabe el box, y la prestación filtrada viaja', async () => {
      const fixture = await montar({ por: 'box', oferta: '14' });
      const pedido = leida();
      // Se dibuja filtrada, pero se lee entera: lo ocupado por otra prestacion no se ve libre.
      expect(pedido.request.params.get('ofertaId')).toBeNull();
      pedido.flush({ ...AGENDA, turnos: [] });
      await asentar(fixture);

      celdas(fixture)[0].click();

      expect(TestBed.inject(FlujoDeTurnosStore).solicitud()).toMatchObject({
        tipo: 'nuevo',
        contexto: { espacioId: 7, profesionalId: undefined, ofertaId: 14 },
      });
    });

    it('"Nuevo turno" lleva la fecha y los filtros, sin hora', async () => {
      const fixture = await montar({ profesional: '31', oferta: '14' });
      leida().flush(AGENDA);
      await asentar(fixture);

      clic(fixture, 'Nuevo turno');

      expect(TestBed.inject(FlujoDeTurnosStore).solicitud()).toEqual({
        tipo: 'nuevo',
        contexto: { origen: 'AGENDA', fecha: FECHA, profesionalId: 31, ofertaId: 14 },
      });
    });

    it('el clic en un turno abre su detalle', async () => {
      const fixture = await montar();
      leida().flush(AGENDA);
      await asentar(fixture);

      (raiz(fixture).querySelector('button.turno') as HTMLButtonElement).click();

      expect(TestBed.inject(FlujoDeTurnosStore).solicitud()).toEqual({
        tipo: 'detalle',
        turnoId: 700,
      });
    });

    it('"Bloquear agenda" abre el flujo con la fecha y el profesional filtrado', async () => {
      const fixture = await montar({ profesional: '31' });
      leida().flush(AGENDA);
      await asentar(fixture);

      clic(fixture, 'Bloquear agenda');

      expect(TestBed.inject(FlujoDeTurnosStore).solicitud()).toEqual({
        tipo: 'bloqueo',
        contexto: { origen: 'AGENDA', fecha: FECHA, profesionalId: 31 },
      });
    });

    it('sin permisos de operar se mira y nada más: ni celdas, ni alta, ni bloqueo', async () => {
      const fixture = await montar({}, []);
      leida().flush(AGENDA);
      await asentar(fixture);

      expect(celdas(fixture)).toEqual([]);
      expect(botones(fixture)).not.toContain('Nuevo turno');
      expect(botones(fixture)).not.toContain('Bloquear agenda');
      expect(raiz(fixture).querySelector('button.turno')).not.toBeNull();
    });
  });

  describe('no pierde el lugar', () => {
    it('lo que hace el flujo se relee con los mismos filtros y sin vaciar la grilla', async () => {
      const fixture = await montar();
      leida().flush(AGENDA);
      await asentar(fixture);
      elegir(fixture, '#agenda-profesional', '31');
      leida().flush(AGENDA);
      await asentar(fixture);
      elegir(fixture, '#agenda-estado', 'CONFIRMADO');
      await asentar(fixture);
      const grilla = raiz(fixture).querySelector('.grilla') as HTMLElement;
      grilla.scrollTop = 123;

      TestBed.inject(FlujoDeTurnosStore).notificarCambio();
      await asentar(fixture);

      // Mientras llega la respuesta la grilla sigue a la vista: es la misma, no se volvió a crear.
      const relectura = leida();
      expect(relectura.request.params.get('desde')).toBe(FECHA);
      expect(relectura.request.params.get('profesionalId')).toBe('31');
      expect(raiz(fixture).querySelector('.grilla')).toBe(grilla);
      expect(raiz(fixture).querySelector('button.turno')).not.toBeNull();
      expect(texto(fixture)).toContain('Actualizando');

      relectura.flush({
        ...AGENDA,
        turnos: [TURNO, { ...TURNO, turno: { ...TURNO.turno, id: 701 } }],
      });
      await asentar(fixture);

      expect(raiz(fixture).querySelector('.grilla')).toBe(grilla);
      expect(grilla.scrollTop).toBe(123);
      expect((raiz(fixture).querySelector('#agenda-profesional') as HTMLSelectElement).value).toBe(
        '31',
      );
      expect((raiz(fixture).querySelector('#agenda-estado') as HTMLSelectElement).value).toBe(
        'CONFIRMADO',
      );
      expect((raiz(fixture).querySelector('#agenda-fecha') as HTMLInputElement).value).toBe(FECHA);
      expect(raiz(fixture).querySelectorAll('button.turno').length).toBe(2);
    });

    it('la URL guarda fecha, vista y filtros, para que un enlace abra lo mismo', async () => {
      const location = vi.spyOn(TestBed.inject(Location), 'replaceState');
      const fixture = await montar();
      leida().flush(AGENDA);
      await asentar(fixture);

      elegir(fixture, '#agenda-profesional', '31');
      leida().flush(AGENDA);
      await asentar(fixture);
      expect(location).toHaveBeenLastCalledWith('/agenda', `fecha=${FECHA}&profesional=31`);

      elegir(fixture, '#agenda-oferta', '14');
      await asentar(fixture);
      expect(location).toHaveBeenLastCalledWith(
        '/agenda',
        `fecha=${FECHA}&profesional=31&oferta=14`,
      );

      clic(fixture, 'Boxes');
      await asentar(fixture);
      expect(location).toHaveBeenLastCalledWith(
        '/agenda',
        `fecha=${FECHA}&por=box&profesional=31&oferta=14`,
      );
    });

    it('un enlace con vista, agrupación y filtros abre eso mismo', async () => {
      await montar({ vista: 'semana', fecha: FECHA, profesional: '31' });

      const pedido = leida();
      expect(pedido.request.params.get('desde')).toBe(LUNES);
      expect(pedido.request.params.get('hasta')).toBe('2030-03-11');
      expect(pedido.request.params.get('profesionalId')).toBe('31');
      pedido.flush(AGENDA);
    });

    it('sin fecha en la URL abre el día de la SEDE, aunque el navegador ya esté en el siguiente', async () => {
      // 00:25 UTC del 5 son las 21:25 del 4 en Cordoba: el dia de la sede es el 4.
      soltarReloj();
      fijarReloj('2030-03-05T00:25:00Z', { navegadorEnUtc: true });
      const fixture = await montar({ fecha: '' });

      const provisoria = leida();
      expect(provisoria.request.params.get('desde')).toBe('2030-03-05');
      provisoria.flush({ ...AGENDA, turnos: [] });

      const deLaSede = leida();
      expect(deLaSede.request.params.get('desde')).toBe('2030-03-04');
      deLaSede.flush({ ...AGENDA, turnos: [] });
      await asentar(fixture);

      expect((raiz(fixture).querySelector('#agenda-fecha') as HTMLInputElement).value).toBe(
        '2030-03-04',
      );
    });

    it('elegir un día antes de que llegue la primera respuesta se respeta', async () => {
      soltarReloj();
      fijarReloj('2030-03-05T00:25:00Z', { navegadorEnUtc: true });
      const fixture = await montar({ fecha: '' });
      leida();

      elegir(fixture, '#agenda-fecha', '2030-04-01');
      leida().flush({ ...AGENDA, turnos: [] });
      await asentar(fixture);

      expect((raiz(fixture).querySelector('#agenda-fecha') as HTMLInputElement).value).toBe(
        '2030-04-01',
      );
    });

    it('una fecha inválida en la URL cae en hoy', async () => {
      const fixture = await montar({ fecha: 'no-es-una-fecha' });

      expect(leida().request.params.get('desde')).toBe(LUNES);
      fixture.destroy();
    });
  });

  describe('filtros', () => {
    it('cada filtro activo se ve como chip y se quita desde ahí', async () => {
      const fixture = await montar();
      leida().flush(AGENDA);
      await asentar(fixture);

      elegir(fixture, '#agenda-profesional', '31');
      leida().flush(AGENDA);
      await asentar(fixture);
      elegir(fixture, '#agenda-oferta', '14');
      await asentar(fixture);
      elegir(fixture, '#agenda-estado', 'CONFIRMADO');
      await asentar(fixture);

      const chips = () =>
        Array.from(raiz(fixture).querySelectorAll<HTMLButtonElement>('.agenda-chip'));
      expect(chips().map((c) => (c.textContent ?? '').trim())).toEqual([
        expect.stringContaining('Profesional: Lopez, Maria'),
        expect.stringContaining('Prestación: Kinesiologia'),
        expect.stringContaining('Estado: Confirmado'),
      ]);

      chips()[2].click();
      await asentar(fixture);
      chips()[1].click();
      await asentar(fixture);
      chips()[0].click();
      const sinFiltros = leida();
      expect(sinFiltros.request.params.has('profesionalId')).toBe(false);
      sinFiltros.flush(AGENDA);
      await asentar(fixture);
      expect(chips()).toEqual([]);
    });

    it('el filtro de estado no vuelve a pedir, salvo Cancelado que hay que leerlo', async () => {
      const fixture = await montar();
      leida().flush(AGENDA);
      await asentar(fixture);

      const location = vi.spyOn(TestBed.inject(Location), 'replaceState');
      elegir(fixture, '#agenda-estado', 'AUSENTE');
      await asentar(fixture);
      httpMock.expectNone((r) => r.url === OPERATIVA);
      expect(location).toHaveBeenLastCalledWith('/agenda', `fecha=${FECHA}&estado=AUSENTE`);
      // Filtra lo que ya está: el único turno está confirmado.
      expect(raiz(fixture).querySelector('button.turno')).toBeNull();

      elegir(fixture, '#agenda-estado', 'CANCELADO');
      const conCancelados = leida();
      expect(conCancelados.request.params.get('incluirCancelados')).toBe('true');
      conCancelados.flush(AGENDA);
      await asentar(fixture);

      elegir(fixture, '#agenda-estado', '');
      const sinCancelados = leida();
      expect(sinCancelados.request.params.get('incluirCancelados')).toBe('false');
      sinCancelados.flush(AGENDA);
    });
  });

  describe('moverse', () => {
    it('anterior, siguiente, hoy y una fecha elegida piden ese día', async () => {
      const fixture = await montar();
      leida().flush(AGENDA);
      await asentar(fixture);

      clic(fixture, 'Anterior');
      const anterior = leida();
      expect(anterior.request.params.get('desde')).toBe('2030-03-05');
      anterior.flush(AGENDA);
      await asentar(fixture);

      clic(fixture, 'Hoy');
      const hoy = leida();
      expect(hoy.request.params.get('desde')).toBe(LUNES);
      hoy.flush(AGENDA);
      await asentar(fixture);

      elegir(fixture, '#agenda-fecha', '2030-04-01');
      const elegida = leida();
      expect(elegida.request.params.get('desde')).toBe('2030-04-01');
      elegida.flush(AGENDA);
      await asentar(fixture);

      // Sin fecha válida no se pide nada.
      elegir(fixture, '#agenda-fecha', '');
      httpMock.expectNone((r) => r.url === OPERATIVA);
    });

    it('la semana son siete días desde el lunes, y se mueve de a siete', async () => {
      const fixture = await montar();
      leida().flush(AGENDA);
      await asentar(fixture);

      clic(fixture, 'Semana');
      const semana = leida();
      expect(semana.request.params.get('desde')).toBe(LUNES);
      expect(semana.request.params.get('hasta')).toBe('2030-03-11');
      semana.flush(AGENDA);
      await asentar(fixture);

      expect(raiz(fixture).querySelectorAll('.grilla__titulo').length).toBe(7);
      expect(raiz(fixture).querySelector('.grilla--semana')).not.toBeNull();
      expect(raiz(fixture).querySelector('.grilla__titulo--hoy')?.textContent).toContain('Hoy');
      // En la semana la agrupación no aplica: no se ofrece.
      expect(botones(fixture)).not.toContain('Boxes');

      clic(fixture, 'Siguiente');
      const siguiente = leida();
      expect(siguiente.request.params.get('desde')).toBe('2030-03-11');
      siguiente.flush(AGENDA);
      await asentar(fixture);

      clic(fixture, 'Día');
      leida().flush(AGENDA);
    });

    it('viendo hoy dibuja la línea de la hora', async () => {
      soltarReloj();
      fijarReloj(`${FECHA}T13:00:00Z`);
      const fixture = await montar();
      leida().flush(AGENDA);
      await asentar(fixture);

      expect(raiz(fixture).querySelector('.grilla__ahora')).not.toBeNull();
    });

    it('otro día no la dibuja', async () => {
      const fixture = await montar();
      leida().flush(AGENDA);
      await asentar(fixture);

      expect(raiz(fixture).querySelector('.grilla__ahora')).toBeNull();
    });
  });

  describe('en un celular', () => {
    beforeEach(() => {
      angosta = true;
    });

    it('es una lista del día, y cada turno abre su detalle', async () => {
      const fixture = await montar();
      leida().flush(AGENDA);
      await asentar(fixture);

      expect(raiz(fixture).querySelector('.grilla')).toBeNull();
      const turno = raiz(fixture).querySelector<HTMLButtonElement>('.agenda-lista__turno');
      expect(turno?.textContent).toContain('Perez, Ana');
      expect(turno?.textContent).toContain('Lopez, Maria');
      turno?.click();

      expect(TestBed.inject(FlujoDeTurnosStore).solicitud()).toEqual({
        tipo: 'detalle',
        turnoId: 700,
      });
    });

    it('sin turnos lo dice y ofrece crear uno', async () => {
      const fixture = await montar();
      leida().flush({ ...AGENDA, turnos: [] });
      await asentar(fixture);

      expect(texto(fixture)).toContain('No hay turnos para este día');
      expect(botones(fixture)).toContain('Crear turno');
    });
  });

  it('cambiar de sede vuelve a leer', async () => {
    const fixture = await montar();
    leida().flush(AGENDA);
    await asentar(fixture);

    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro',
      consultorioId: 8,
      consultorioName: 'Otra sede',
    });
    await asentar(fixture);

    httpMock
      .match((r) => r.url.startsWith('/api/v1/me/permissions'))
      .forEach((r) => r.flush({ permissions: [] }));
    httpMock
      .expectOne((r) => r.url === '/api/v1/consultorios/8/disponibilidad/profesionales')
      .flush([]);
    httpMock.expectOne((r) => r.url === '/api/v1/consultorios/8/ofertas').flush([]);
    httpMock.expectOne((r) => r.url === '/api/v1/consultorios/8/agenda/operativa').flush(AGENDA);
  });

  // -------------------------------------------------------------------------------------

  /** Monta la pantalla con la query dada y deja respondidos los catálogos. */
  async function montar(
    query: Readonly<Record<string, string>> = {},
    permisos: readonly string[] = [PERMISO_TURNO_MANAGE, PERMISO_CONSULTORIO_MANAGE],
  ): Promise<ComponentFixture<AgendaPage>> {
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro',
      consultorioId: 3,
      consultorioName: 'Sede',
    });
    TestBed.inject(PermissionsStore).cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: permisos });

    const fixture = TestBed.createComponent(AgendaPage);
    fixture.componentRef.setInput('fecha', FECHA);
    for (const [clave, valor] of Object.entries(query)) {
      fixture.componentRef.setInput(clave, valor);
    }
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === PROFESIONALES).flush([{ id: 31, nombre: 'Lopez, Maria' }]);
    httpMock
      .expectOne((r) => r.url === OFERTAS)
      .flush([{ id: 14, nombreComercial: 'Kinesiologia' }]);
    await asentar(fixture);
    return fixture;
  }

  function leida(): TestRequest {
    return httpMock.expectOne((r) => r.url === OPERATIVA);
  }

  function raiz(fixture: ComponentFixture<AgendaPage>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function texto(fixture: ComponentFixture<AgendaPage>): string {
    return (raiz(fixture).textContent ?? '').replace(/\s+/g, ' ');
  }

  function celdas(fixture: ComponentFixture<AgendaPage>): HTMLButtonElement[] {
    return Array.from(raiz(fixture).querySelectorAll<HTMLButtonElement>('.grilla__celda'));
  }

  function botones(fixture: ComponentFixture<AgendaPage>): readonly string[] {
    return Array.from(raiz(fixture).querySelectorAll('button')).map((b) =>
      (b.textContent ?? '').trim(),
    );
  }

  /** Por el texto exacto, o por el oculto de los botones de ícono ("‹Anterior"). */
  function clic(fixture: ComponentFixture<AgendaPage>, rotulo: string): void {
    const encontrado = Array.from(raiz(fixture).querySelectorAll('button')).find((b) => {
      const contenido = (b.textContent ?? '').trim();
      return contenido === rotulo || contenido.endsWith(rotulo);
    });
    if (encontrado === undefined) {
      throw new Error(`No está el botón "${rotulo}". Hay: ${botones(fixture).join(' | ')}`);
    }
    encontrado.click();
    fixture.detectChanges();
  }

  function elegir(fixture: ComponentFixture<AgendaPage>, selector: string, valor: string): void {
    const campo = raiz(fixture).querySelector(selector) as HTMLSelectElement | HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  async function asentar(fixture: ComponentFixture<AgendaPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }
});
