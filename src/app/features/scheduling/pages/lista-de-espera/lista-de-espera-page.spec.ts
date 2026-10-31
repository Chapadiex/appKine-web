import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { PERMISO_TURNO_MANAGE } from '../../../../core/models/permisos';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { FlujoDeTurnosStore } from '../../../../core/services/flujo-de-turnos.store';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { fijarReloj, soltarReloj } from '../../../../core/testing/reloj';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { ListaDeEsperaPage } from './lista-de-espera-page';

const SEDE = '/api/v1/consultorios/3';
const ESPERA = `${SEDE}/lista-de-espera`;
const COINCIDENCIAS = `${ESPERA}/coincidencias`;
const BUSQUEDA = `${SEDE}/disponibilidad/busqueda`;
const OFERTAS = `${SEDE}/ofertas`;

const ZONA = 'America/Argentina/Cordoba';
const HOY = '2030-03-04';

const ENTRADA = {
  id: 7,
  estado: 'ACTIVA',
  personaId: 12,
  personaNombre: 'Perez, Ana',
  documento: 'DNI 30111222',
  telefono: '(351) 400-0000',
  ofertaId: 14,
  ofertaNombre: 'Kinesiologia',
  profesionalId: 31,
  profesionalNombre: 'Lopez, Maria',
  fechaDesde: HOY,
  fechaHasta: '2030-03-18',
  dias: [1, 3],
  horaDesde: '14:00:00',
  horaHasta: '18:00:00',
  prioridad: 'NORMAL',
  notas: 'Prefiere por la tarde',
  creadaEn: '2030-03-01T15:00:00Z',
  version: 3,
};

const HORARIO = {
  desde: '2030-03-06T18:00:00Z',
  hasta: '2030-03-06T18:45:00Z',
  profesionalId: 31,
  profesionalNombre: 'Lopez, Maria',
};

const pagina = (content: readonly object[], totalElements = content.length): object => ({
  content,
  totalElements,
});

/**
 * Quienes esperan lugar en la sede. Lo que decide: asignar crea un turno común y si falla la entrada
 * sigue activa, y lo que llega de una cancelación pone arriba solo a quienes les sirve ese horario.
 */
describe('ListaDeEsperaPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ListaDeEsperaPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    fijarReloj(`${HOY}T15:00:00Z`);
  });

  afterEach(() => {
    soltarReloj();
    httpMock.verify();
  });

  describe('la lista', () => {
    it(
      'abre con las activas y dice qué le sirve a cada uno, sin ordenar lo que ordena el servidor',
      async () => {
        const fixture = await montar();
        const pedido = lista();
        expect(pedido.request.params.get('estado')).toBe('ACTIVA');
        expect(pedido.request.params.get('page')).toBe('0');
        expect(pedido.request.params.has('ofertaId')).toBe(false);
        pedido.flush(pagina([ENTRADA]));
        await asentar(fixture);

        const fila = raiz(fixture).querySelector('tbody tr') as HTMLElement;
        expect(fila.textContent).toContain('Perez, Ana');
        expect(fila.textContent).toContain('DNI 30111222');
        expect(fila.textContent).toContain('Lopez, Maria');
        expect(fila.textContent).toContain('04/03 al 18/03');
        expect(fila.textContent).toContain('Lun, Mié · 14:00 a 18:00');
        expect(fila.textContent).toContain('Normal');
        expect(fila.textContent).toContain('Hace 3 días');
        expect(fila.querySelector('a[href="tel:3514000000"]')).not.toBeNull();
        expect(raiz(fixture).querySelector('.filtros-barra__resultados')?.textContent).toBe(
          '1 paciente',
        );

        await esperarSinViolaciones(raiz(fixture));
      },
      TIMEOUT_AXE,
    );

    it('lo que no es de hoy se dice en días, sin horario ni días dice "cualquiera"', async () => {
      const fixture = await montar();
      lista().flush(
        pagina([
          {
            ...ENTRADA,
            id: 8,
            personaNombre: 'De ayer',
            telefono: undefined,
            profesionalNombre: undefined,
            dias: [],
            horaDesde: undefined,
            horaHasta: undefined,
            prioridad: 'URGENTE',
            creadaEn: '2030-03-03T15:00:00Z',
          },
          {
            ...ENTRADA,
            id: 9,
            personaNombre: 'De hoy',
            prioridad: 'ALTA',
            creadaEn: `${HOY}T15:00:00Z`,
          },
        ]),
      );
      await asentar(fixture);

      const [ayer, hoy] = Array.from(raiz(fixture).querySelectorAll('tbody tr'));
      expect(ayer.textContent).toContain('Ayer');
      expect(ayer.textContent).toContain('Sin teléfono');
      expect(ayer.textContent).toContain('Cualquier profesional');
      expect(ayer.textContent).toContain('Cualquier día · cualquier horario');
      expect(ayer.textContent).toContain('Urgente');
      expect(hoy.textContent).toContain('Hoy');
      expect(hoy.textContent).toContain('Alta');
    });

    it('vacía sin filtros invita a anotar; con filtros ofrece limpiarlos', async () => {
      const fixture = await montar();
      lista().flush(pagina([]));
      await asentar(fixture);
      expect(texto(fixture)).toContain('No hay nadie en la lista de espera');

      clicEn(fixture, raiz(fixture).querySelector('app-estado-vacio'), 'Agregar a la lista');
      expect(TestBed.inject(FlujoDeTurnosStore).solicitud()).toEqual({
        tipo: 'espera',
        contexto: { origen: 'LISTA_DE_ESPERA' },
      });

      elegir(fixture, '#espera-filtro-estado', 'DESCARTADA');
      const descartadas = lista();
      expect(descartadas.request.params.get('estado')).toBe('DESCARTADA');
      descartadas.flush(pagina([]));
      await asentar(fixture);
      expect(texto(fixture)).toContain('No encontramos pacientes');

      clicEn(fixture, raiz(fixture), 'Limpiar filtros');
      const limpia = lista();
      expect(limpia.request.params.get('estado')).toBe('ACTIVA');
      limpia.flush(pagina([]));
    });

    it('filtra por prestación y vuelve a la primera página', async () => {
      const fixture = await montar();
      lista().flush(pagina([ENTRADA], 25));
      await asentar(fixture);

      clicEn(fixture, raiz(fixture), 'Página siguiente');
      const segunda = lista();
      expect(segunda.request.params.get('page')).toBe('1');
      segunda.flush(pagina([ENTRADA], 25));
      await asentar(fixture);

      elegir(fixture, '#espera-filtro-oferta', '14');
      const filtrada = lista();
      expect(filtrada.request.params.get('ofertaId')).toBe('14');
      expect(filtrada.request.params.get('page')).toBe('0');
      filtrada.flush(pagina([ENTRADA]));
    });

    it('si se resolvió la última fila de la última página, relee la que queda', async () => {
      const fixture = await montar();
      lista().flush(pagina([ENTRADA], 11));
      await asentar(fixture);
      clicEn(fixture, raiz(fixture), 'Página siguiente');
      lista().flush(pagina([ENTRADA], 11));
      await asentar(fixture);

      TestBed.inject(FlujoDeTurnosStore).notificarCambio();
      await asentar(fixture);
      lista().flush(pagina([], 10));
      await asentar(fixture);

      const anterior = lista();
      expect(anterior.request.params.get('page')).toBe('0');
      anterior.flush(pagina([ENTRADA], 10));
    });

    it('si no se puede leer lo dice y deja reintentar; sin sede ofrece elegirla', async () => {
      const fixture = await montar();
      lista().flush({ status: 500, detail: 'Caído' }, { status: 500, statusText: 'E' });
      await asentar(fixture);
      expect(texto(fixture)).toContain('No pudimos leer la lista de espera');

      clicEn(fixture, raiz(fixture), 'Reintentar');
      lista().flush(
        { type: 'https://akine.app/problems/missing-tenant-context', status: 403 },
        { status: 403, statusText: 'F' },
      );
      await asentar(fixture);
      expect(raiz(fixture).querySelector('a[href="/seleccionar-contexto"]')).not.toBeNull();
    });

    it('lo que hace el flujo se relee sin perder el filtro', async () => {
      const fixture = await montar();
      lista().flush(pagina([ENTRADA]));
      await asentar(fixture);
      elegir(fixture, '#espera-filtro-oferta', '14');
      lista().flush(pagina([ENTRADA]));
      await asentar(fixture);

      TestBed.inject(FlujoDeTurnosStore).notificarCambio();
      await asentar(fixture);

      const relectura = lista();
      expect(relectura.request.params.get('ofertaId')).toBe('14');
      expect(raiz(fixture).querySelector('tbody tr')).not.toBeNull();
      relectura.flush(pagina([ENTRADA]));
    });

    it('otra sede empieza de cero: lo filtrado ya no es de acá', async () => {
      const fixture = await montar();
      lista().flush(pagina([ENTRADA]));
      await asentar(fixture);
      elegir(fixture, '#espera-filtro-oferta', '14');
      lista().flush(pagina([ENTRADA]));
      await asentar(fixture);

      TestBed.inject(TenantContextStore).select({
        organizationId: 1,
        organizationName: 'Centro',
        consultorioId: 8,
        consultorioName: 'Otra',
      });
      await asentar(fixture);

      httpMock.match(RUTA_PERMISOS_EFECTIVOS).forEach((r) => r.flush({ permissions: [] }));
      httpMock.expectOne((r) => r.url === '/api/v1/consultorios/8/ofertas').flush([]);
      const nueva = httpMock.expectOne((r) => r.url === '/api/v1/consultorios/8/lista-de-espera');
      expect(nueva.request.params.has('ofertaId')).toBe(false);
      nueva.flush(pagina([]));
    });

    it('una entrada asignada lleva a su turno y una descartada dice por qué', async () => {
      const fixture = await montar();
      lista().flush(
        pagina([
          { ...ENTRADA, id: 8, estado: 'ASIGNADA', turnoId: 500 },
          { ...ENTRADA, id: 9, estado: 'DESCARTADA', motivoCierre: 'Consiguió en otro lado' },
        ]),
      );
      await asentar(fixture);

      expect(texto(fixture)).toContain('Consiguió en otro lado');
      expect(botones(fixture)).not.toContain('Asignar un turno a Perez, Ana');
      const verTurno = Array.from(raiz(fixture).querySelectorAll('button')).find((b) =>
        (b.textContent ?? '').includes('Ver turno'),
      );
      verTurno?.click();

      expect(TestBed.inject(FlujoDeTurnosStore).solicitud()).toEqual({
        tipo: 'detalle',
        turnoId: 500,
      });
    });

    it('sin turno:manage se mira y nada más', async () => {
      const fixture = await montar({ permisos: [] });
      lista().flush(pagina([ENTRADA]));
      await asentar(fixture);

      expect(texto(fixture)).toContain('Perez, Ana');
      expect(botones(fixture)).not.toContain('Agregar a la lista');
      expect(raiz(fixture).querySelector('app-acciones-de-fila')).toBeNull();
    });
  });

  describe('lo que se liberó', () => {
    it('arriba van los compatibles, con el horario del que se habla', async () => {
      const fixture = await montar({ turno: '500' });
      lista().flush(pagina([ENTRADA]));
      responderCompatibles([{ ...ENTRADA, id: 8, personaNombre: 'Gomez, Luis' }]);
      await asentar(fixture);

      const seccion = raiz(fixture).querySelector('[aria-labelledby="espera-compatibles-titulo"]');
      expect(seccion?.textContent).toContain('Gomez, Luis');
      expect(seccion?.textContent).toContain('Kinesiologia');
      expect(seccion?.textContent).not.toContain('Perez, Ana');
    });

    it('sin nadie compatible lo dice', async () => {
      const fixture = await montar({ turno: '500' });
      lista().flush(pagina([]));
      responderCompatibles([]);
      await asentar(fixture);

      expect(texto(fixture)).toContain('Nadie en la lista espera un horario así');
    });

    it('si no se puede leer el turno, los compatibles se muestran igual', async () => {
      const fixture = await montar({ turno: '500' });
      lista().flush(pagina([]));
      httpMock
        .expectOne((r) => r.url === COINCIDENCIAS)
        .flush([{ ...ENTRADA, id: 8, personaNombre: 'Gomez, Luis' }]);
      httpMock.expectOne(`${SEDE}/turnos/500`).flush('', { status: 404, statusText: 'N' });
      await asentar(fixture);

      expect(texto(fixture)).toContain('Gomez, Luis');
    });

    it('si falla la búsqueda lo dice y deja reintentar', async () => {
      const fixture = await montar({ turno: '500' });
      lista().flush(pagina([]));
      httpMock
        .expectOne((r) => r.url === COINCIDENCIAS)
        .flush({ status: 500, detail: 'Caído' }, { status: 500, statusText: 'E' });
      httpMock.match(`${SEDE}/turnos/500`);
      await asentar(fixture);
      expect(texto(fixture)).toContain('No pudimos buscar quiénes esperan ese horario');

      clicEn(fixture, raiz(fixture).querySelector('section.tarjeta'), 'Reintentar');
      responderCompatibles([]);
    });

    it('"Dejar de mostrar" saca el turno de la URL', async () => {
      const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const fixture = await montar({ turno: '500' });
      lista().flush(pagina([]));
      responderCompatibles([]);
      await asentar(fixture);

      clicEn(fixture, raiz(fixture), 'Dejar de mostrar');

      expect(navegar).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ queryParams: { turno: null } }),
      );
    });

    it('un turno que no es un número se ignora', async () => {
      const fixture = await montar({ turno: 'abc' });
      lista().flush(pagina([]));
      await asentar(fixture);

      httpMock.expectNone((r) => r.url === COINCIDENCIAS);
      expect(raiz(fixture).querySelector('#espera-compatibles-titulo')).toBeNull();
    });
  });

  describe('asignar', () => {
    it('busca lo que le sirve de verdad, y al elegir crea el turno y relee', async () => {
      const fixture = await conFila();
      const flujo = TestBed.inject(FlujoDeTurnosStore);
      const cambios = flujo.cambios();

      asignar(fixture);
      const busqueda = httpMock.expectOne(BUSQUEDA);
      expect(busqueda.request.body).toEqual({
        ofertaId: 14,
        profesionalId: 31,
        desde: HOY,
        // `fechaHasta` es inclusiva y el `hasta` de la búsqueda exclusivo.
        hasta: '2030-03-19',
        horaDesde: '14:00:00',
        horaHasta: '18:00:00',
        dias: [1, 3],
        limite: 12,
      });
      busqueda.flush({ timezone: ZONA, horarios: [HORARIO], truncado: true });
      await asentar(fixture);

      const panel = raiz(fixture).querySelector('dialog') as HTMLElement;
      expect(panel.textContent).toContain('Asignar turno a Perez, Ana');
      expect(panel.textContent).toContain('Prefiere por la tarde');

      clicEn(fixture, panel, 'Ver más horarios');
      const mas = httpMock.expectOne(BUSQUEDA);
      expect(mas.request.body.limite).toBe(24);
      mas.flush({ timezone: ZONA, horarios: [HORARIO] });
      await asentar(fixture);

      (raiz(fixture).querySelector('.horario') as HTMLButtonElement).click();
      const asignacion = httpMock.expectOne(`${ESPERA}/7/asignacion`);
      expect(asignacion.request.body).toEqual({
        inicio: HORARIO.desde,
        profesionalId: 31,
        expectedVersion: 3,
      });
      asignacion.flush({ ...ENTRADA, estado: 'ASIGNADA', turnoId: 500 });
      await asentar(fixture);

      expect(raiz(fixture).querySelector('dialog')).toBeNull();
      expect(flujo.cambios()).toBe(cambios + 1);
      const [aviso] = TestBed.inject(AvisosStore).avisos();
      expect(aviso.titulo).toBe('Turno asignado.');
      expect(aviso.descripcion).toContain('Perez, Ana');
      aviso.accion?.ejecutar();
      expect(flujo.solicitud()).toEqual({ tipo: 'detalle', turnoId: 500 });

      // La notificación la escucha esta misma pantalla.
      lista().flush(pagina([]));
    });

    it('si ya pasó el último día que le servía no busca, y ofrece descartarla', async () => {
      const fixture = await conFila({ ...ENTRADA, fechaHasta: '2030-03-01' });

      asignar(fixture);
      await asentar(fixture);

      httpMock.expectNone(BUSQUEDA);
      expect(texto(fixture)).toContain('Ya pasó el último día que le servía');

      clicEn(fixture, raiz(fixture).querySelector('dialog'), 'Descartar');
      await asentar(fixture);
      expect(texto(fixture)).toContain('Descartar a Perez, Ana');
    });

    it('sin horarios lo dice, con el motivo y hasta dónde se miró', async () => {
      const fixture = await conFila({ ...ENTRADA, fechaHasta: '2031-01-01' });

      asignar(fixture);
      const busqueda = httpMock.expectOne(BUSQUEDA);
      // El motor mira a lo sumo 62 días: se recorta y se dice.
      expect(busqueda.request.body.hasta).toBe('2030-05-05');
      busqueda.flush({ timezone: ZONA, horarios: [], motivosSinHorario: ['SIN_FRANJAS'] });
      await asentar(fixture);

      expect(texto(fixture)).toContain('No hay horarios libres que le sirvan.');
      expect(texto(fixture)).toContain('Se buscó hasta el');
    });

    it('un error al buscar se muestra con reintento', async () => {
      const fixture = await conFila();

      asignar(fixture);
      httpMock
        .expectOne(BUSQUEDA)
        .flush({ status: 500, detail: 'Motor caído' }, { status: 500, statusText: 'E' });
      await asentar(fixture);
      expect(texto(fixture)).toContain('Motor caído');

      clicEn(fixture, raiz(fixture).querySelector('dialog'), 'Reintentar');
      httpMock.expectOne(BUSQUEDA).flush({ timezone: ZONA, horarios: [HORARIO] });
    });

    it('si el horario se ocupó, la persona sigue en la lista y se ofrecen los que quedan', async () => {
      const fixture = await conFila();
      asignar(fixture);
      httpMock.expectOne(BUSQUEDA).flush({ timezone: ZONA, horarios: [HORARIO] });
      await asentar(fixture);

      (raiz(fixture).querySelector('.horario') as HTMLButtonElement).click();
      httpMock
        .expectOne(`${ESPERA}/7/asignacion`)
        .flush(
          { type: 'https://akine.app/problems/recurso-ocupado', status: 409 },
          { status: 409, statusText: 'C' },
        );
      httpMock.expectOne(BUSQUEDA).flush({ timezone: ZONA, horarios: [] });
      await asentar(fixture);

      expect(raiz(fixture).querySelector('dialog')).not.toBeNull();
      expect(texto(fixture)).toContain('Este horario acaba de ser reservado');
    });

    it('otro rechazo se muestra como error, sin volver a buscar', async () => {
      const fixture = await conFila();
      asignar(fixture);
      httpMock.expectOne(BUSQUEDA).flush({ timezone: ZONA, horarios: [HORARIO] });
      await asentar(fixture);

      (raiz(fixture).querySelector('.horario') as HTMLButtonElement).click();
      httpMock
        .expectOne(`${ESPERA}/7/asignacion`)
        .flush({ status: 400, detail: 'Inválido' }, { status: 400, statusText: 'B' });
      await asentar(fixture);

      expect(texto(fixture)).toContain('No pudimos asignar el turno');
      httpMock.expectNone(BUSQUEDA);
    });

    it('si otro puesto ya la resolvió, avisa, cierra y relee: esa versión no sirve más', async () => {
      const fixture = await conFila();
      asignar(fixture);
      httpMock.expectOne(BUSQUEDA).flush({ timezone: ZONA, horarios: [HORARIO] });
      await asentar(fixture);

      (raiz(fixture).querySelector('.horario') as HTMLButtonElement).click();
      httpMock
        .expectOne(`${ESPERA}/7/asignacion`)
        .flush(
          { type: 'https://akine.app/problems/lista-de-espera-cerrada', status: 409 },
          { status: 409, statusText: 'C' },
        );
      await asentar(fixture);

      expect(raiz(fixture).querySelector('dialog')).toBeNull();
      expect(TestBed.inject(AvisosStore).avisos()[0].titulo).toContain(
        'ya no está en la lista de espera',
      );
      lista().flush(pagina([]));
    });

    it('"Cerrar" descarta una respuesta que todavía no llegó', async () => {
      const fixture = await conFila();
      asignar(fixture);
      const busqueda = httpMock.expectOne(BUSQUEDA);
      await asentar(fixture);

      clicEn(fixture, raiz(fixture).querySelector('dialog'), 'Cerrar');
      await asentar(fixture);
      busqueda.flush({ timezone: ZONA, horarios: [HORARIO] });
      await asentar(fixture);

      expect(raiz(fixture).querySelector('dialog')).toBeNull();
    });
  });

  describe('descartar', () => {
    it('manda el motivo y la versión, y relee', async () => {
      const fixture = await conFila();

      descartar(fixture);
      await asentar(fixture);
      const motivo = raiz(fixture).querySelector('#espera-descarte-motivo') as HTMLTextAreaElement;
      motivo.value = 'Consiguió en otro lado';
      motivo.dispatchEvent(new Event('input'));
      enviarDescarte(fixture);

      const pedido = httpMock.expectOne(`${ESPERA}/7/descarte`);
      expect(pedido.request.body).toEqual({
        motivo: 'Consiguió en otro lado',
        expectedVersion: 3,
      });
      pedido.flush({ ...ENTRADA, estado: 'DESCARTADA' });
      await asentar(fixture);

      expect(raiz(fixture).querySelector('dialog')).toBeNull();
      expect(TestBed.inject(AvisosStore).avisos()[0].titulo).toBe(
        'Paciente descartado de la lista de espera.',
      );
      lista().flush(pagina([]));
    });

    it('el motivo es opcional: vacío no viaja', async () => {
      const fixture = await conFila();

      descartar(fixture);
      await asentar(fixture);
      enviarDescarte(fixture);

      const pedido = httpMock.expectOne(`${ESPERA}/7/descarte`);
      expect(pedido.request.body).toEqual({ expectedVersion: 3 });
      pedido.flush({ ...ENTRADA, estado: 'DESCARTADA' });
      lista().flush(pagina([]));
    });

    it('un rechazo se muestra y el panel queda abierto', async () => {
      const fixture = await conFila();

      descartar(fixture);
      await asentar(fixture);
      enviarDescarte(fixture);
      httpMock
        .expectOne(`${ESPERA}/7/descarte`)
        .flush({ status: 400, detail: 'Inválido' }, { status: 400, statusText: 'B' });
      await asentar(fixture);

      expect(texto(fixture)).toContain('No pudimos descartarlo de la lista');
      expect(raiz(fixture).querySelector('dialog')).not.toBeNull();
    });

    it('si cambió en otro puesto, avisa, cierra y relee', async () => {
      const fixture = await conFila();

      descartar(fixture);
      await asentar(fixture);
      enviarDescarte(fixture);
      httpMock.expectOne(`${ESPERA}/7/descarte`).flush(
        {
          type: 'https://akine.app/problems/concurrent-modification',
          status: 409,
          detail: 'Viejo',
        },
        { status: 409, statusText: 'C' },
      );
      await asentar(fixture);

      expect(raiz(fixture).querySelector('dialog')).toBeNull();
      expect(TestBed.inject(AvisosStore).avisos()[0].titulo).toContain('Viejo');
      lista().flush(pagina([]));
    });
  });

  // -------------------------------------------------------------------------------------

  async function montar(
    opciones: { readonly turno?: string; readonly permisos?: readonly string[] } = {},
  ): Promise<ComponentFixture<ListaDeEsperaPage>> {
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro',
      consultorioId: 3,
      consultorioName: 'Sede',
    });
    TestBed.inject(PermissionsStore).cargar().subscribe();
    httpMock
      .expectOne(RUTA_PERMISOS_EFECTIVOS)
      .flush({ permissions: opciones.permisos ?? [PERMISO_TURNO_MANAGE] });

    const fixture = TestBed.createComponent(ListaDeEsperaPage);
    if (opciones.turno !== undefined) {
      fixture.componentRef.setInput('turno', opciones.turno);
    }
    fixture.detectChanges();
    httpMock
      .expectOne((r) => r.url === OFERTAS)
      .flush([{ id: 14, nombreComercial: 'Kinesiologia' }]);
    await asentar(fixture);
    return fixture;
  }

  async function conFila(entrada: object = ENTRADA): Promise<ComponentFixture<ListaDeEsperaPage>> {
    const fixture = await montar();
    lista().flush(pagina([entrada]));
    await asentar(fixture);
    return fixture;
  }

  function lista(): TestRequest {
    return httpMock.expectOne((r) => r.url === ESPERA && r.method === 'GET');
  }

  function responderCompatibles(entradas: readonly object[]): void {
    httpMock.expectOne((r) => r.url === COINCIDENCIAS).flush(entradas as object[]);
    httpMock
      .expectOne(`${SEDE}/turnos/500`)
      .flush({ id: 500, inicio: '2030-03-06T19:00:00Z', ofertaNombre: 'Kinesiologia' });
  }

  function asignar(fixture: ComponentFixture<ListaDeEsperaPage>): void {
    const boton = raiz(fixture).querySelector('button[principal]') as HTMLButtonElement;
    boton.click();
    fixture.detectChanges();
  }

  function descartar(fixture: ComponentFixture<ListaDeEsperaPage>): void {
    const boton = raiz(fixture).querySelector('button.accion--peligro') as HTMLButtonElement;
    boton.click();
    fixture.detectChanges();
  }

  function enviarDescarte(fixture: ComponentFixture<ListaDeEsperaPage>): void {
    (raiz(fixture).querySelector('dialog form') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    fixture.detectChanges();
  }

  function raiz(fixture: ComponentFixture<ListaDeEsperaPage>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function texto(fixture: ComponentFixture<ListaDeEsperaPage>): string {
    return (raiz(fixture).textContent ?? '').replace(/\s+/g, ' ');
  }

  function botones(fixture: ComponentFixture<ListaDeEsperaPage>): readonly string[] {
    return Array.from(raiz(fixture).querySelectorAll('button')).map((b) =>
      (b.textContent ?? '').trim(),
    );
  }

  function clicEn(
    fixture: ComponentFixture<ListaDeEsperaPage>,
    contenedor: Element | null,
    rotulo: string,
  ): void {
    const encontrado = Array.from(contenedor?.querySelectorAll('button') ?? []).find((b) =>
      (b.textContent ?? '').includes(rotulo),
    );
    if (encontrado === undefined) {
      throw new Error(`No está el botón "${rotulo}"`);
    }
    encontrado.click();
    fixture.detectChanges();
  }

  function elegir(
    fixture: ComponentFixture<ListaDeEsperaPage>,
    selector: string,
    valor: string,
  ): void {
    const campo = raiz(fixture).querySelector(selector) as HTMLSelectElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  async function asentar(fixture: ComponentFixture<ListaDeEsperaPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }
});
