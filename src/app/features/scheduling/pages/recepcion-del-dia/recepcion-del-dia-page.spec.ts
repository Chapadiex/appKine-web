import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { RecepcionDelDiaPage } from './recepcion-del-dia-page';
import {
  PERMISO_COBRO_REGISTER,
  PERMISO_TURNO_MANAGE,
  PERMISO_TURNO_READ,
} from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';
import { fijarReloj, soltarReloj } from '../../../../core/testing/reloj';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { FlujoDeTurnosStore } from '../../../../core/services/flujo-de-turnos.store';

const CONSULTORIO = 3;
const OFERTA = 42;
const FECHA = '2026-09-15';

const TURNOS = `/api/v1/consultorios/${CONSULTORIO}/turnos`;
const AGENDA = `/api/v1/consultorios/${CONSULTORIO}/ofertas/${OFERTA}/agenda`;
const recepcion = (turnoId: number, paso = '') =>
  `${TURNOS}/${turnoId}/recepcion${paso === '' ? '' : `/${paso}`}`;

/**
 * Cuatro filas sinteticas: una por llegar, una en la sala de espera, una cancelada y una que llego
 * y todavia no se valido. Sin ningun dato clinico, porque la respuesta tampoco lo trae.
 *
 * <p>Ninguna lleva `EN_ESPERA` en el estado del TURNO: desde 0.63.0 el servidor no lo emite y la
 * espera es de la recepcion (DP-16).
 */
const DEL_DIA = [
  {
    id: 301,
    estado: 'CONFIRMADO',
    inicio: '2026-09-15T12:00:00Z',
    fin: '2026-09-15T12:45:00Z',
    personaNombre: 'Ramirez, Ana',
    documento: 'DNI 27888999',
    ofertaId: OFERTA,
    ofertaNombre: 'Kinesiologia deportiva',
    version: 2,
  },
  {
    id: 302,
    estado: 'RESERVADO',
    inicio: '2026-09-15T13:00:00Z',
    fin: '2026-09-15T13:45:00Z',
    llegadaEn: '2026-09-15T12:51:00Z',
    recepcion: {
      id: 902,
      turnoId: 302,
      estado: 'EN_ESPERA',
      llegadaEn: '2026-09-15T12:51:00Z',
      modalidad: 'COBERTURA',
      version: 4,
    },
    personaNombre: 'Sosa, Bruno',
    documento: 'DNI 30111222',
    ofertaId: OFERTA,
    ofertaNombre: 'Kinesiologia deportiva',
    version: 6,
  },
  {
    id: 303,
    estado: 'CANCELADO',
    inicio: '2026-09-15T14:00:00Z',
    fin: '2026-09-15T14:45:00Z',
    motivoCancelacion: 'El profesional pidio el día',
    personaNombre: 'Vega, Carla',
    documento: 'DNI 33444555',
    ofertaId: OFERTA,
    ofertaNombre: 'Kinesiologia deportiva',
    version: 3,
  },
  {
    id: 304,
    estado: 'RESERVADO',
    inicio: '2026-09-15T15:00:00Z',
    fin: '2026-09-15T15:45:00Z',
    llegadaEn: '2026-09-15T14:55:00Z',
    recepcion: {
      id: 904,
      turnoId: 304,
      estado: 'LLEGO',
      llegadaEn: '2026-09-15T14:55:00Z',
      version: 1,
    },
    personaNombre: 'Ibarra, Dario',
    documento: 'DNI 35666777',
    ofertaId: OFERTA,
    ofertaNombre: 'Kinesiologia deportiva',
    version: 4,
  },
];

const ZONA = 'America/Argentina/Cordoba';

/**
 * Spec de la recepcion del dia (M13, AKINE-05.04 y E-4).
 *
 * <p>Cubre lo que decide comportamiento:
 *
 * <ol>
 *   <li><b>Los cancelados se muestran, con su motivo y sin acciones.</b></li>
 *   <li><b>Las horas salen en la zona de la SEDE.</b></li>
 *   <li><b>El check-in va a la Recepcion, no al turno</b>, y registrar dos veces no es error.</li>
 *   <li><b>Una validacion observada no es un error</b> y deja seguir (RN-M13-003).</li>
 *   <li><b>Particular exige motivo</b> (RF-M13-005).</li>
 *   <li><b>Anular lo ya anulado se explica</b> y la fila se corrige sola.</li>
 *   <li><b>Llamar no dice que lo esten atendiendo</b>: eso es la Sesion (DP-05).</li>
 * </ol>
 */
describe('RecepcionDelDiaPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecepcionDelDiaPage],
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

  afterEach(() => {
    soltarReloj();
    // Tambien prueba que nada pega contra los `/llegada` deprecados: seria un pedido sin atender.
    httpMock.verify();
  });

  it('lista el día con el paciente resuelto y las horas en la zona de la SEDE', async () => {
    const fixture = await montar();
    const texto = textoDe(fixture);

    expect(texto).toContain('Ramirez, Ana');
    expect(texto).toContain('DNI 27888999');
    expect(texto).toContain('Kinesiologia deportiva');
    // 12:00Z son las 09:00 en Cordoba. Con la zona del navegador este numero cambia y nada falla.
    expect(texto).toContain('09:00 a 09:45');
    expect(texto).toContain('America/Argentina/Cordoba');
    // La hora de llegada es la de la recepcion, tambien en la zona de la sede: 12:51Z -> 09:51.
    expect(texto).toContain('09:51');
    expect(texto).toContain('Todavía no llegó');
    // La espera se cuenta por la recepcion, no por el estado del turno.
    expect(texto).toContain('1 en espera');
    expect(texto).toContain('aguarda ser llamado');
  });

  it('"Nuevo turno" abre el flujo sobre esta pantalla, con el dia que se esta mirando', async () => {
    const fixture = await montar();

    const boton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button.boton'),
    ).find((b) => (b.textContent ?? '').includes('Nuevo turno'));
    boton?.click();

    expect(TestBed.inject(FlujoDeTurnosStore).solicitud()).toEqual({
      tipo: 'nuevo',
      contexto: { origen: 'AGENDA', fecha: FECHA },
    });
  });

  it('sin turno:manage no ofrece "Nuevo turno", ni en la cabecera ni con el dia vacio', async () => {
    const fixture = await montar({ permisos: [PERMISO_TURNO_READ], turnos: [] });

    expect(textoDe(fixture)).toContain('No hay turnos este día');
    expect(textoDe(fixture)).not.toContain('Nuevo turno');
  });

  it('lo que reserva el flujo aparece en la lista: se relee sin que nadie lo pida', async () => {
    const fixture = await montar();

    TestBed.inject(FlujoDeTurnosStore).notificarCambio();
    fixture.detectChanges();
    const relectura = httpMock.expectOne(esDelDia());
    expect(relectura.request.params.get('fecha')).toBe(FECHA);
    relectura.flush({ fecha: FECHA, timezone: ZONA, turnos: DEL_DIA });
    await asentar(fixture);
  });

  it('la fila deja a la vista solo la transición siguiente y el resto va al menú', async () => {
    const fixture = await montar();

    // En la sala de espera: Llamar (principal), Particular, retiro, anular, ver el turno.
    const menu = fila(fixture, 'Sosa, Bruno').querySelector('.acciones-de-fila__panel');
    expect(menu).not.toBeNull();
    expect(fila(fixture, 'Sosa, Bruno').querySelector('button[principal]')?.textContent).toContain(
      'Llamar',
    );
    expect((menu as HTMLElement).hidden).toBe(true);
    // El cancelado solo tiene "Ver el turno": no lleva menu, el boton queda a la vista.
    expect(fila(fixture, 'Vega, Carla').querySelector('.acciones-de-fila__panel')).toBeNull();
    expect(fila(fixture, 'Vega, Carla').querySelector('button.boton')?.textContent).toContain(
      'Ver el turno',
    );
  });

  describe('"Ver el turno" abre el panel sobre esta pantalla', () => {
    it('sin salir de la recepción, y el botón dice de quién es el turno', async () => {
      const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const fixture = await montar();
      const flujo = TestBed.inject(FlujoDeTurnosStore);

      // Con menu: Sosa tiene otras acciones. Sin menu: Vega esta cancelada.
      for (const [nombre, id] of [
        ['Sosa, Bruno', 302],
        ['Vega, Carla', 303],
      ] as const) {
        const boton = botonDeLaFila(fixture, nombre, 'Ver el turno');
        expect(boton?.textContent?.replace(/\s+/g, ' ')).toContain(`Ver el turno de ${nombre}`);
        boton?.click();
        expect(flujo.solicitud()).toEqual({ tipo: 'detalle', turnoId: id });
      }
      expect(navegar).not.toHaveBeenCalled();
    });

    it('el foco queda en el "⋯" de la fila, para que el panel lo devuelva a un botón visible', async () => {
      const fixture = await montar();
      const raiz = fixture.nativeElement as HTMLElement;
      document.body.appendChild(raiz);

      botonDeLaFila(fixture, 'Sosa, Bruno', 'Ver el turno')?.click();

      expect(document.activeElement).toBe(
        fila(fixture, 'Sosa, Bruno').querySelector('.acciones-de-fila__boton'),
      );
      raiz.remove();
    });
  });

  describe('lo que hace el panel se relee en el lugar', () => {
    const MUCHOS = Array.from({ length: 60 }, (_, i) => ({
      ...DEL_DIA[0],
      id: 400 + i,
      personaNombre: `Paciente ${100 + i}`,
    }));

    /** Lleva a la segunda pagina, que es donde perderla se nota. */
    async function enLaSegundaPagina(): Promise<ComponentFixture<RecepcionDelDiaPage>> {
      const fixture = await montar({ turnos: MUCHOS });
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
          '.paginacion__paso',
        ),
      )
        .find((b) => (b.textContent ?? '').includes('Página siguiente'))
        ?.click();
      await asentar(fixture);
      expect(textoDe(fixture)).toContain('Mostrando 26–50 de 60');
      return fixture;
    }

    it('conserva la página, y la tabla no se vacía mientras se lee', async () => {
      const fixture = await enLaSegundaPagina();

      TestBed.inject(FlujoDeTurnosStore).notificarCambio();
      await asentar(fixture);
      expect(textoDe(fixture)).not.toContain('Leyendo los turnos');
      expect(fila(fixture, 'Paciente 130')).toBeDefined();

      httpMock
        .expectOne(esDelDia())
        .flush({ fecha: FECHA, timezone: ZONA, turnos: MUCHOS.map((t) => ({ ...t })) });
      await asentar(fixture);

      expect(textoDe(fixture)).toContain('Mostrando 26–50 de 60');
    });

    it('conserva los filtros', async () => {
      const fixture = await montar();
      const raiz = fixture.nativeElement as HTMLElement;
      const buscador = raiz.querySelector('input[type="search"]') as HTMLInputElement;
      buscador.value = 'Vega';
      buscador.dispatchEvent(new Event('input'));
      await asentar(fixture);
      expect(textoDe(fixture)).not.toContain('Sosa, Bruno');

      TestBed.inject(FlujoDeTurnosStore).notificarCambio();
      await asentar(fixture);
      httpMock.expectOne(esDelDia()).flush({ fecha: FECHA, timezone: ZONA, turnos: DEL_DIA });
      await asentar(fixture);

      expect(buscador.value).toBe('Vega');
      expect(textoDe(fixture)).not.toContain('Sosa, Bruno');
      expect(textoDe(fixture)).toContain('Vega, Carla');
    });

    it('una transición de la fila tampoco manda a la primera página', async () => {
      const fixture = await enLaSegundaPagina();

      clickearEnLaFila(fixture, 'Paciente 130', 'Registrar la llegada');
      httpMock
        .expectOne((p) => p.url === recepcion(430))
        .flush({ id: 1, turnoId: 430, estado: 'LLEGO', version: 0 });
      httpMock.expectOne(`${TURNOS}/430`).flush({ ...MUCHOS[30], version: 3 });
      await asentar(fixture);

      expect(textoDe(fixture)).toContain('Mostrando 26–50 de 60');
    });

    it('si la respuesta es de un día que se dejó de mirar, se descarta', async () => {
      const fixture = await montar();

      TestBed.inject(FlujoDeTurnosStore).notificarCambio();
      await asentar(fixture);
      const vieja = httpMock.expectOne(esDelDia());

      const campo = (fixture.nativeElement as HTMLElement).querySelector(
        '#recepcion-fecha',
      ) as HTMLInputElement;
      campo.value = '2026-09-16';
      campo.dispatchEvent(new Event('change'));
      await asentar(fixture);
      httpMock
        .expectOne((p) => p.method === 'GET' && p.params.get('fecha') === '2026-09-16')
        .flush({ fecha: '2026-09-16', timezone: ZONA, turnos: [DEL_DIA[2]] });
      await asentar(fixture);

      vieja.flush({ fecha: FECHA, timezone: ZONA, turnos: DEL_DIA });
      await asentar(fixture);

      expect(textoDe(fixture)).toContain('Vega, Carla');
      expect(textoDe(fixture)).not.toContain('Sosa, Bruno');
    });

    it('si no se puede releer, lo que había sigue ahí y el aviso ofrece volver a leer', async () => {
      const fixture = await montar();

      TestBed.inject(FlujoDeTurnosStore).notificarCambio();
      await asentar(fixture);
      httpMock.expectOne(esDelDia()).flush(null, { status: 500, statusText: 'E' });
      await asentar(fixture);

      expect(textoDe(fixture)).toContain('Sosa, Bruno');
      const [aviso] = TestBed.inject(AvisosStore).avisos();
      expect(aviso.titulo).toBe('No pudimos actualizar los turnos del día');
      expect(aviso.accion?.etiqueta).toBe('Releer el día');

      aviso.accion?.ejecutar();
      httpMock.expectOne(esDelDia()).flush({ fecha: FECHA, timezone: ZONA, turnos: DEL_DIA });
      await asentar(fixture);
    });
  });

  it('el motivo se pide en un panel lateral fuera de la tabla, con la fila marcada', async () => {
    const fixture = await montar();

    clickearEnLaFila(fixture, 'Sosa, Bruno', 'Atender como Particular');
    fixture.detectChanges();

    const raiz = fixture.nativeElement as HTMLElement;
    const panel = raiz.querySelector('dialog.panel-lateral');
    expect(panel).not.toBeNull();
    expect(panel?.closest('table')).toBeNull();
    expect(panel?.querySelector('.panel-lateral__titulo')?.textContent).toContain(
      'Atender como Particular a Sosa, Bruno',
    );
    expect(fila(fixture, 'Sosa, Bruno').classList).toContain('fila--seleccionada');

    // Cancelar lo cierra y la fila deja de estar marcada.
    (
      Array.from(panel?.querySelectorAll('button') ?? []).find(
        (b) => (b.textContent ?? '').trim() === 'Cancelar',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(raiz.querySelector('dialog.panel-lateral')).toBeNull();
    expect(fila(fixture, 'Sosa, Bruno').classList).not.toContain('fila--seleccionada');
  });

  it('los filtros rápidos cuentan por estado de la recepción y se combinan con la búsqueda', async () => {
    const fixture = await montar();
    const raiz = fixture.nativeElement as HTMLElement;
    const opcion = (nombre: string) =>
      Array.from(raiz.querySelectorAll<HTMLButtonElement>('.filtros-rapidos__opcion')).find((b) =>
        (b.textContent ?? '').includes(nombre),
      ) as HTMLButtonElement;

    expect(opcion('Todos').textContent).toContain('4');
    expect(opcion('Sin llegar').textContent).toContain('2');
    expect(opcion('En mostrador').textContent).toContain('1');
    expect(opcion('En espera').textContent).toContain('1');

    opcion('En espera').click();
    fixture.detectChanges();
    expect(opcion('En espera').getAttribute('aria-pressed')).toBe('true');
    expect(textoDe(fixture)).toContain('Sosa, Bruno');
    expect(textoDe(fixture)).not.toContain('Ramirez, Ana');

    // Combinado con la busqueda: nadie en espera se llama Ramirez.
    const buscador = raiz.querySelector<HTMLInputElement>(
      '#recepcion-busqueda',
    ) as HTMLInputElement;
    buscador.value = 'Ramirez';
    buscador.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(textoDe(fixture)).toContain('Ningún turno del día coincide');
  });

  it('toolbar del listado (UX-14): búsqueda, estado y "Filtros" en una fila, con el contador', async () => {
    const fixture = await montar();
    const raiz = fixture.nativeElement as HTMLElement;

    const fila = raiz.querySelector('.tarjeta .filtros-barra__fila') as HTMLElement;
    expect(fila.querySelector('#recepcion-busqueda')).not.toBeNull();
    expect(fila.querySelector('app-filtros-rapidos')).not.toBeNull();
    expect(fila.querySelector('.filtros-barra__boton')?.textContent).toContain('Filtros');
    expect(fila.querySelector('.filtros-barra__resultados')?.textContent).toBe('4 turnos');
    expect(raiz.querySelector('.paginacion-pie__resumen')?.textContent).toBe('Mostrando 1–4 de 4');
    // El dia y "Actualizar" son de la cabecera, no de la toolbar de la tabla.
    expect(raiz.querySelector('.cabecera-pagina__contexto #recepcion-fecha')).not.toBeNull();

    // La prestacion es un filtro avanzado: cuenta en el boton y achica la lista.
    const prestacion = raiz.querySelector('#recepcion-prestacion') as HTMLSelectElement;
    expect(Array.from(prestacion.options).map((o) => o.text.trim())).toEqual([
      'Todas',
      'Kinesiologia deportiva',
    ]);
    prestacion.value = 'Kinesiologia deportiva';
    prestacion.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(raiz.querySelector('.filtros-barra__contador')?.textContent).toContain('1');
    expect(raiz.querySelector('.filtros-barra__resultados')?.textContent).toBe('4 turnos');
  });

  it('pagina de a 25 y el vacío filtrado ofrece limpiar los filtros', async () => {
    const muchos = Array.from({ length: 27 }, (_, i) => ({
      ...DEL_DIA[0],
      id: 400 + i,
      personaNombre: `Paciente ${String(i + 1).padStart(2, '0')}`,
    }));
    const fixture = await montar({ turnos: muchos });
    const raiz = fixture.nativeElement as HTMLElement;

    expect(raiz.querySelectorAll('tbody tr').length).toBe(25);
    expect(raiz.querySelector('.filtros-barra__resultados')?.textContent).toBe('27 turnos');
    expect(raiz.querySelector('.paginacion-pie__resumen')?.textContent).toBe(
      'Mostrando 1–25 de 27',
    );
    (
      Array.from(raiz.querySelectorAll<HTMLButtonElement>('.paginacion__paso')).find((b) =>
        (b.textContent ?? '').includes('Página siguiente'),
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(raiz.querySelectorAll('tbody tr').length).toBe(2);

    const buscador = raiz.querySelector('#recepcion-busqueda') as HTMLInputElement;
    buscador.value = 'Nadie';
    buscador.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const vacio = raiz.querySelector('app-estado-vacio') as HTMLElement;
    expect(vacio.textContent).toContain('No encontramos turnos');
    expect(raiz.querySelector('table')).toBeNull();

    (
      Array.from(vacio.querySelectorAll('button')).find((b) =>
        (b.textContent ?? '').includes('Limpiar filtros'),
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(raiz.querySelector('.filtros-barra__resultados')?.textContent).toBe('27 turnos');
    expect(buscador.value).toBe('');
  });

  it('muestra los cancelados con su motivo y SIN acciones', async () => {
    const fixture = await montar();

    expect(textoDe(fixture)).toContain('Vega, Carla');
    expect(textoDe(fixture)).toContain('El profesional pidio el día');
    expect(botonesDeLaFila(fixture, 'Vega, Carla')).toEqual([]);
  });

  it('registrar la llegada abre la RECEPCION con un POST sin cuerpo y relee el turno', async () => {
    const fixture = await montar();

    clickearEnLaFila(fixture, 'Ramirez, Ana', 'Registrar la llegada');

    const pedido = httpMock.expectOne(recepcion(301));
    expect(pedido.request.method).toBe('POST');
    // Sin cuerpo: la hora la pone el servidor, que es lo que la hace la hora REAL de llegada.
    expect(pedido.request.body).toBeNull();
    pedido.flush({
      id: 901,
      turnoId: 301,
      estado: 'LLEGO',
      llegadaEn: '2026-09-15T11:40:00Z',
      version: 0,
    });
    await asentar(fixture);

    // El check-in avanza la version del TURNO aunque no cambie su estado: la fila se relee.
    httpMock.expectOne(`${TURNOS}/301`).flush({
      ...DEL_DIA[0],
      llegadaEn: '2026-09-15T11:40:00Z',
      recepcion: { id: 901, estado: 'LLEGO', llegadaEn: '2026-09-15T11:40:00Z', version: 0 },
      version: 3,
    });
    await asentar(fixture);

    // UX-12: el resultado es un aviso global, no un mensaje en el cuerpo de la pantalla.
    expect(avisos()).toEqual([
      expect.objectContaining({ tipo: 'exito', titulo: 'Llegada registrada' }),
    ]);
    const texto = textoDe(fixture);
    expect(texto).not.toContain('atendiendo');
    // 11:40Z -> 08:40 en Cordoba.
    expect(texto).toContain('08:40');
    expect(botonesDeLaFila(fixture, 'Ramirez, Ana')).toEqual([
      'Validar cobertura',
      'Atender como Particular',
      'Se retiro sin ser atendido',
      'Anular la llegada',
    ]);
  });

  it('registrar dos veces NO es un error: el check-in es idempotente', async () => {
    const fixture = await montar();

    const boton = botonDeLaFila(fixture, 'Ramirez, Ana', 'Registrar la llegada');
    boton?.click();
    boton?.click();

    const respuesta = { id: 901, estado: 'LLEGO', llegadaEn: '2026-09-15T11:40:00Z', version: 0 };
    httpMock.match(recepcion(301)).forEach((p) => p.flush(respuesta));
    await asentar(fixture);
    httpMock
      .match(`${TURNOS}/301`)
      .forEach((p) => p.flush({ ...DEL_DIA[0], recepcion: respuesta }));
    await asentar(fixture);

    expect(avisos().map((a) => a.titulo)).toContain('Llegada registrada');
    expect(avisos().some((a) => a.tipo === 'error')).toBe(false);
  });

  it('una validacion OBSERVADA no es un error: muestra la observación y deja seguir', async () => {
    const fixture = await montar();

    clickearEnLaFila(fixture, 'Ibarra, Dario', 'Validar cobertura');

    const pedido = httpMock.expectOne(recepcion(304, 'validacion'));
    expect(pedido.request.method).toBe('POST');
    // La version es la de la RECEPCION (1), no la del turno (4).
    expect(pedido.request.body).toEqual({ expectedVersion: 1 });
    pedido.flush({
      ...DEL_DIA[3].recepcion,
      estado: 'OBSERVADA',
      observacion: 'SIN_COBERTURA_APLICABLE: no tiene cobertura para esta práctica',
      version: 2,
    });
    await asentar(fixture);

    // Observada no es un error: advertencia, y la observacion queda a la vista en la fila.
    const [aviso] = avisos();
    expect(aviso?.tipo).toBe('advertencia');
    expect(aviso?.descripcion).toContain('quedo observada');
    expect(textoDe(fixture)).toContain('SIN_COBERTURA_APLICABLE');
    expect(botonesDeLaFila(fixture, 'Ibarra, Dario')).toEqual([
      'Validar cobertura',
      'Pasar a espera',
      'Atender como Particular',
      'Anular la llegada',
    ]);
  });

  it('Particular exige motivo: vacío no manda nada, con motivo manda la versión de la recepción', async () => {
    const fixture = await montar();

    clickearEnLaFila(fixture, 'Ibarra, Dario', 'Atender como Particular');
    const raiz = fixture.nativeElement as HTMLElement;
    const confirmar = (): void => {
      (
        raiz.querySelector('dialog.panel-lateral form button[type="submit"]') as HTMLButtonElement
      ).click();
      fixture.detectChanges();
    };

    confirmar();
    expect(textoDe(fixture)).toContain('es obligatorio');
    httpMock.expectNone(recepcion(304, 'particular'));

    const campo = raiz.querySelector('#recepcion-motivo-particular') as HTMLInputElement;
    campo.value = 'No trajo la orden y prefiere abonar';
    campo.dispatchEvent(new Event('input'));
    confirmar();

    const pedido = httpMock.expectOne(recepcion(304, 'particular'));
    expect(pedido.request.body).toEqual({
      expectedVersion: 1,
      motivo: 'No trajo la orden y prefiere abonar',
    });
    pedido.flush({
      ...DEL_DIA[3].recepcion,
      estado: 'VALIDADA',
      modalidad: 'PARTICULAR',
      version: 2,
    });
    await asentar(fixture);

    // El panel se cierra recien con la respuesta, y el resultado va al aviso global.
    expect(avisos().map((a) => a.titulo)).toEqual(['Se atiende como Particular']);
    expect(raiz.querySelector('dialog.panel-lateral')).toBeNull();
    expect(botonesDeLaFila(fixture, 'Ibarra, Dario')).toEqual([
      'Pasar a espera',
      'Anular la llegada',
    ]);
  });

  it('llamar a quien espera no dice que lo esten atendiendo', async () => {
    const fixture = await montar();

    clickearEnLaFila(fixture, 'Sosa, Bruno', 'Llamar');

    const pedido = httpMock.expectOne(recepcion(302, 'llamado'));
    expect(pedido.request.body).toEqual({ expectedVersion: 4 });
    pedido.flush({ ...DEL_DIA[1].recepcion, estado: 'LLAMADA', version: 5 });
    await asentar(fixture);

    expect(avisos()[0]?.descripcion).toContain('Llamar no registra la atención');
    const texto = textoDe(fixture);
    expect(texto).toContain('la atención es otro registro');
    expect(texto).toContain('0 en espera');
    expect(botonesDeLaFila(fixture, 'Sosa, Bruno')).toEqual(['Anular la llegada']);
  });

  it('la relectura en silencio que vuelve después de una acción no pisa la fila', async () => {
    const fixture = await montar();

    // Volver a la pestaña dispara la relectura; antes de que responda, la mesa llama.
    document.dispatchEvent(new Event('visibilitychange'));
    const relectura = httpMock.expectOne(esDelDia());
    clickearEnLaFila(fixture, 'Sosa, Bruno', 'Llamar');
    httpMock
      .expectOne(recepcion(302, 'llamado'))
      .flush({ ...DEL_DIA[1].recepcion, estado: 'LLAMADA', version: 5 });
    await asentar(fixture);

    // La foto vieja todavía trae al paciente en espera: se descarta.
    relectura.flush({ fecha: FECHA, timezone: ZONA, turnos: DEL_DIA });
    await asentar(fixture);

    expect(textoDe(fixture)).toContain('0 en espera');
    expect(botonesDeLaFila(fixture, 'Sosa, Bruno')).toEqual(['Anular la llegada']);
  });

  it('la relectura en silencio no saca de la página que se está mirando', async () => {
    const muchos = Array.from({ length: 27 }, (_, i) => ({
      ...DEL_DIA[0],
      id: 400 + i,
      personaNombre: `Paciente ${String(i + 1).padStart(2, '0')}`,
    }));
    const fixture = await montar({ turnos: muchos });
    const raiz = fixture.nativeElement as HTMLElement;
    (
      Array.from(raiz.querySelectorAll<HTMLButtonElement>('.paginacion__paso')).find((b) =>
        (b.textContent ?? '').includes('Página siguiente'),
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(raiz.querySelectorAll('tbody tr').length).toBe(2);

    document.dispatchEvent(new Event('visibilitychange'));
    httpMock.expectOne(esDelDia()).flush({ fecha: FECHA, timezone: ZONA, turnos: muchos });
    await asentar(fixture);

    expect(raiz.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('el error de una acción de la fila es un aviso global con Reintentar', async () => {
    const fixture = await montar();

    clickearEnLaFila(fixture, 'Sosa, Bruno', 'Llamar');
    httpMock.expectOne(recepcion(302, 'llamado')).error(new ProgressEvent('error'));
    await asentar(fixture);

    const [aviso] = avisos();
    expect(aviso?.tipo).toBe('error');
    expect(aviso?.titulo).toBe('No pudimos llamar al paciente');
    expect(aviso?.accion?.etiqueta).toBe('Reintentar');

    // Reintentar manda el mismo pedido otra vez.
    TestBed.inject(AvisosStore).ejecutar(aviso?.id ?? 0);
    httpMock.expectOne(recepcion(302, 'llamado'));
  });

  it('si no se puede leer el día, la alerta va en el lugar de la lista con Reintentar', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });
    permisos.cargar().subscribe();
    httpMock
      .expectOne(RUTA_PERMISOS_EFECTIVOS)
      .flush({ permissions: [PERMISO_TURNO_READ, PERMISO_TURNO_MANAGE] });
    const fixture = TestBed.createComponent(RecepcionDelDiaPage);
    fixture.componentRef.setInput('fecha', FECHA);
    fixture.detectChanges();
    httpMock.expectOne(esDelDia()).error(new ProgressEvent('error'));
    await asentar(fixture);

    const alerta = (fixture.nativeElement as HTMLElement).querySelector('app-alerta');
    expect(alerta?.textContent).toContain('No pudimos leer los turnos del día');
    // Sin la lista, "no hay turnos" mentiria.
    expect(textoDe(fixture)).not.toContain('no tiene ningún turno agendado');

    (
      Array.from(alerta?.querySelectorAll('button') ?? []).find((b) =>
        (b.textContent ?? '').includes('Reintentar'),
      ) as HTMLButtonElement
    ).click();
    httpMock.expectOne(esDelDia()).flush({ fecha: FECHA, timezone: ZONA, turnos: DEL_DIA });
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Ramirez, Ana');
  });

  it('Particular se ofrece desde la sala de espera (U-21) y la recepción sigue EN_ESPERA', async () => {
    const fixture = await montar();

    expect(botonesDeLaFila(fixture, 'Sosa, Bruno')).toEqual([
      'Llamar',
      'Atender como Particular',
      'Se retiro sin ser atendido',
      'Anular la llegada',
    ]);
    clickearEnLaFila(fixture, 'Sosa, Bruno', 'Atender como Particular');
    const raiz = fixture.nativeElement as HTMLElement;
    const campo = raiz.querySelector('#recepcion-motivo-particular') as HTMLInputElement;
    campo.value = 'Prefiere abonar';
    campo.dispatchEvent(new Event('input'));
    (
      raiz.querySelector('dialog.panel-lateral form button[type="submit"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    const pedido = httpMock.expectOne(recepcion(302, 'particular'));
    expect(pedido.request.body).toEqual({ expectedVersion: 4, motivo: 'Prefiere abonar' });
    pedido.flush({ ...DEL_DIA[1].recepcion, modalidad: 'PARTICULAR', version: 5 });
    await asentar(fixture);

    expect(textoDe(fixture)).toContain('1 en espera');
    // Ya es Particular: repetirlo pisaria el motivo que consta (409), asi que no se ofrece.
    expect(botonesDeLaFila(fixture, 'Sosa, Bruno')).toEqual([
      'Llamar',
      'Se retiro sin ser atendido',
      'Anular la llegada',
    ]);
  });

  it('"se retiro sin ser atendido" exige motivo y deja la fila RETIRADO, sin check-in', async () => {
    const fixture = await montar();

    clickearEnLaFila(fixture, 'Sosa, Bruno', 'Se retiro sin ser atendido');
    const raiz = fixture.nativeElement as HTMLElement;
    const confirmar = (): void => {
      (
        raiz.querySelector('dialog.panel-lateral form button[type="submit"]') as HTMLButtonElement
      ).click();
      fixture.detectChanges();
    };
    confirmar();
    expect(textoDe(fixture)).toContain('Escribi por que se retiro');
    httpMock.expectNone(recepcion(302, 'retiro'));

    const campo = raiz.querySelector('#recepcion-motivo-retiro') as HTMLInputElement;
    campo.value = 'Se canso de esperar';
    campo.dispatchEvent(new Event('input'));
    confirmar();

    const pedido = httpMock.expectOne(recepcion(302, 'retiro'));
    expect(pedido.request.method).toBe('POST');
    expect(pedido.request.body).toEqual({ expectedVersion: 4, motivo: 'Se canso de esperar' });
    pedido.flush({
      ...DEL_DIA[1].recepcion,
      estado: 'RETIRADO',
      cerradaEn: '2026-09-15T13:20:00Z',
      motivoCierre: 'Se canso de esperar',
      version: 5,
    });
    await asentar(fixture);

    const texto = textoDe(fixture);
    expect(avisos()[0]?.titulo).toBe('Retiro registrado');
    expect(avisos()[0]?.descripcion).toContain('se retiro sin ser atendido');
    expect(texto).toContain('Se retiró');
    expect(texto).toContain('Motivo del retiro: Se canso de esperar');
    expect(texto).toContain('0 en espera');
    // La llegada vale: no se ofrece otro check-in, ni anular, ni nada sobre la recepcion.
    expect(botonesDeLaFila(fixture, 'Sosa, Bruno')).toEqual([]);
  });

  it('una recepción RETIRADO leida del servidor no ofrece registrar la llegada', async () => {
    const fixture = await montar({
      turnos: [
        {
          ...DEL_DIA[1],
          recepcion: { ...DEL_DIA[1].recepcion, estado: 'RETIRADO', motivoCierre: 'Urgencia' },
        },
      ],
    });

    expect(botonesDeLaFila(fixture, 'Sosa, Bruno')).toEqual([]);
    expect(textoDe(fixture)).toContain('Motivo del retiro: Urgencia');
  });

  it('pasar a espera manda la versión de la recepción', async () => {
    const fixture = await montar({
      turnos: [{ ...DEL_DIA[3], recepcion: { ...DEL_DIA[3].recepcion, estado: 'VALIDADA' } }],
    });

    clickearEnLaFila(fixture, 'Ibarra, Dario', 'Pasar a espera');

    const pedido = httpMock.expectOne(recepcion(304, 'espera'));
    expect(pedido.request.body).toEqual({ expectedVersion: 1 });
    pedido.flush({ ...DEL_DIA[3].recepcion, estado: 'EN_ESPERA', version: 2 });
    await asentar(fixture);

    expect(avisos().map((a) => a.titulo)).toEqual(['Pasó a la sala de espera']);
    expect(botonesDeLaFila(fixture, 'Ibarra, Dario')).toEqual([
      'Llamar',
      'Atender como Particular',
      'Se retiro sin ser atendido',
      'Anular la llegada',
    ]);
  });

  it('anular deja la fila sin recepción y vuelve a ofrecer el check-in', async () => {
    const fixture = await montar();

    clickearEnLaFila(fixture, 'Ibarra, Dario', 'Anular la llegada');
    // El motivo es opcional: se confirma vacio.
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        'dialog.panel-lateral form button[type="submit"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    const pedido = httpMock.expectOne(recepcion(304, 'anulacion'));
    expect(pedido.request.body).toEqual({ expectedVersion: 1 });
    pedido.flush({ ...DEL_DIA[3].recepcion, estado: 'ANULADA', version: 2 });
    await asentar(fixture);
    // Sin recepcion vigente, el prepago "antes del check-in" lo recalcula el servidor (E-8).
    httpMock
      .expectOne(`${TURNOS}/304`)
      .flush({ ...DEL_DIA[3], recepcion: undefined, llegadaEn: undefined, version: 5 });
    await asentar(fixture);

    expect(avisos().map((a) => a.titulo)).toEqual(['Llegada anulada']);
    expect(botonesDeLaFila(fixture, 'Ibarra, Dario')).toEqual(['Registrar la llegada']);
  });

  it('anular lo ya anulado se explica, y la fila se corrige sola', async () => {
    const fixture = await montar();

    clickearEnLaFila(fixture, 'Sosa, Bruno', 'Anular la llegada');
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        'dialog.panel-lateral form button[type="submit"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    httpMock.expectOne(recepcion(302, 'anulacion')).flush(
      {
        type: 'https://akine.app/problems/recepcion-transicion-no-permitida',
        status: 409,
        detail: 'Rechazado.',
        motivo: 'no hay recepción abierta: no hay ninguna llegada que anular',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await asentar(fixture);

    // El error de una operacion del panel queda ARRIBA del panel abierto (UX-12), no en un aviso
    // global que quedaria inerte detras del dialogo modal.
    const alerta = (fixture.nativeElement as HTMLElement).querySelector(
      'dialog.panel-lateral app-alerta',
    );
    expect(alerta?.textContent).toContain('No pudimos anular la llegada');
    expect(alerta?.textContent).toContain('idempotente');
    expect(alerta?.textContent).toContain('no hay ninguna llegada que anular');
    expect(avisos()).toEqual([]);

    // Relee ESA fila sola, no el dia entero.
    httpMock.expectNone(esDelDia());
    httpMock.expectOne(`${TURNOS}/302`).flush({
      ...DEL_DIA[1],
      llegadaEn: undefined,
      recepcion: undefined,
      version: 7,
    });
    await asentar(fixture);

    expect(botonesDeLaFila(fixture, 'Sosa, Bruno')).toEqual(['Registrar la llegada']);
  });

  it('sin `turno:manage` la pantalla es de lectura y no esconde que lo es', async () => {
    const fixture = await montar({ permisos: [PERMISO_TURNO_READ] });

    expect(textoDe(fixture)).toContain('Solo podés mirar la lista');
    expect(botonesDeLaFila(fixture, 'Ramirez, Ana')).toEqual([]);
    expect(botonesDeLaFila(fixture, 'Sosa, Bruno')).toEqual([]);
    // La lista se sigue viendo: leer quien viene hoy es `turno:read`.
    expect(textoDe(fixture)).toContain('Ramirez, Ana');
  });

  it('un día sin turnos no pide la zona ni deja la pantalla en blanco', async () => {
    const fixture = await montar({ turnos: [] });

    expect(textoDe(fixture)).toContain('no tiene ningún turno agendado');
    // "Todavia no hay" y no "no hay con estos filtros": el vacio del dia no ofrece limpiar.
    const vacio = (fixture.nativeElement as HTMLElement).querySelector('app-estado-vacio');
    expect(vacio?.textContent).toContain('No hay turnos este día');
    expect(vacio?.textContent).not.toContain('Limpiar filtros');
    // Sin turnos no hay oferta de donde sacar la zona, y no se inventa una peticion.
    httpMock.expectNone(esAgenda());
  });

  /**
   * Encontrado por el E2E contra el backend real (AKINE E-2). El unico enlace a esta pantalla
   * —"Ver la recepcion del dia", desde la agenda— no lleva `?fecha=`, y `withComponentInputBinding`
   * no deja el input en su default cuando falta el parametro: lo pone en `undefined`. La pantalla
   * llamaba al cliente generado con `fecha` indefinida, que lanza antes de salir a la red, y
   * quedaba en blanco: sin lista, sin error y con el campo de fecha vacio.
   */
  it('sin `?fecha=` en la URL abre el día de hoy, que es lo que pasa al entrar desde la agenda', async () => {
    // Mediodia en UTC y en Cordoba: el dia del navegador y el de la sede coinciden.
    fijarReloj('2026-09-15T15:00:00Z', { navegadorEnUtc: true });
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_TURNO_READ] });

    const fixture = TestBed.createComponent(RecepcionDelDiaPage);
    // Lo que hace el router con un query param ausente.
    fixture.componentRef.setInput('fecha', undefined);
    fixture.detectChanges();

    const pedido = httpMock.expectOne(esDelDia());
    expect(pedido.request.params.get('fecha')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    pedido.flush({ fecha: pedido.request.params.get('fecha'), timezone: ZONA, turnos: [] });
    await asentar(fixture);

    expect(textoDe(fixture)).toContain('no tiene ningún turno agendado');
  });

  /**
   * Lo que tumbo el E2E del PR #42: a las 21:25 de Cordoba un navegador en UTC ya esta en el dia
   * siguiente. "Hoy" es el de la sede: la primera respuesta trae su zona, el dia se corrige y se
   * vuelve a pedir, y la respuesta del dia equivocado se descarta.
   */
  it('sin `?fecha=` abre el día de la SEDE aunque el navegador ya este en el día siguiente', async () => {
    fijarReloj('2026-10-10T00:25:00Z', { navegadorEnUtc: true });
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_TURNO_READ] });

    const fixture = TestBed.createComponent(RecepcionDelDiaPage);
    fixture.componentRef.setInput('fecha', undefined);
    fixture.detectChanges();

    const provisorio = httpMock.expectOne(esDelDia());
    expect(provisorio.request.params.get('fecha')).toBe('2026-10-10');
    provisorio.flush({ fecha: '2026-10-10', timezone: ZONA, turnos: [] });

    const deLaSede = httpMock.expectOne(esDelDia());
    expect(deLaSede.request.params.get('fecha')).toBe('2026-10-09');
    deLaSede.flush({ fecha: '2026-10-09', timezone: ZONA, turnos: [DEL_DIA[0]] });
    await asentar(fixture);

    expect(textoDe(fixture)).toContain('Ramirez, Ana');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[type="date"]')
        ?.value,
    ).toBe('2026-10-09');
  });

  it('un día que vino en la URL no se corrige aunque no sea hoy en la sede', async () => {
    fijarReloj('2026-10-10T00:25:00Z', { navegadorEnUtc: true });
    // `montar` abre FECHA desde la URL y espera UN solo pedido: `verify` del afterEach falla si
    // la pantalla pidiera otro dia.
    const fixture = await montar();

    expect(textoDe(fixture)).toContain('Ramirez, Ana');
  });

  it('cambiar la fecha vuelve a pedir ESE día', async () => {
    const fixture = await montar();

    const campo = (fixture.nativeElement as HTMLElement).querySelector(
      'input[type="date"]',
    ) as HTMLInputElement;
    campo.value = '2026-09-16';
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const pedido = httpMock.expectOne(esDelDia());
    expect(pedido.request.params.get('fecha')).toBe('2026-09-16');
    pedido.flush([]);
    await asentar(fixture);

    expect(textoDe(fixture)).toContain('no tiene ningún turno agendado');
  });

  it('si no se puede saber la zona de la sede lo dice, en vez de usar la del navegador', async () => {
    const fixture = await montar({ zona: 'falla' });

    // El contrato no publica el `timezone` en la respuesta del dia. Rotular UTC es lo unico
    // honesto: la zona del navegador correria las horas del mostrador sin que nada falle.
    expect(textoDe(fixture)).toContain('no se pudo averiguar la zona horaria');
  });

  describe('prepago (E-6 y E-8)', () => {
    const PREPAGO_PENDIENTE = { estado: 'PENDIENTE', importeSugerido: 15000, moneda: 'ARS' };
    const PREPAGO_REGISTRADO = { estado: 'REGISTRADO', cobroId: 9, importe: 15000, moneda: 'ARS' };
    // Con recepcion vigente el servidor manda el mismo prepago en el turno y en la recepcion.
    const PENDIENTE = {
      ...DEL_DIA[3],
      personaId: 501,
      prepago: PREPAGO_PENDIENTE,
      recepcion: { ...DEL_DIA[3].recepcion, estado: 'VALIDADA', prepago: PREPAGO_PENDIENTE },
    };

    it('quien solo cobra ve "Registrar prepago" como la acción de la fila, fuera del menú', async () => {
      const fixture = await montar({
        permisos: [PERMISO_TURNO_READ, PERMISO_COBRO_REGISTER],
        turnos: [PENDIENTE],
      });

      const principal = fila(fixture, 'Ibarra, Dario').querySelector('a[principal]');
      expect(principal?.textContent).toContain('Registrar prepago');
      expect(principal?.closest('.acciones-de-fila__panel')).toBeNull();
      // "Ver el turno" queda en el menú.
      const menu = fila(fixture, 'Ibarra, Dario').querySelector('.acciones-de-fila__panel');
      expect(menu?.textContent).toContain('Ver el turno');
    });

    it('PENDIENTE avisa con el sugerido, no bloquea y lleva al cobro con el turno', async () => {
      const fixture = await montar({
        permisos: [PERMISO_TURNO_READ, PERMISO_TURNO_MANAGE, PERMISO_COBRO_REGISTER],
        turnos: [PENDIENTE],
      });

      const texto = fila(fixture, 'Ibarra, Dario').textContent ?? '';
      expect(texto).toContain('Prepago pendiente');
      expect(texto).not.toContain('si se atiende como particular');
      expect(texto).toMatch(/sugerido \$\s?15\.000,00/);
      // Avisa y no bloquea: pasar a espera sigue disponible.
      expect(botonesDeLaFila(fixture, 'Ibarra, Dario')).toContain('Pasar a espera');

      const enlace = Array.from(fila(fixture, 'Ibarra, Dario').querySelectorAll('a')).find((a) =>
        (a.textContent ?? '').includes('Registrar prepago'),
      ) as HTMLAnchorElement;
      expect(enlace.getAttribute('href')).toBe(
        `/pacientes/501/cuenta-corriente/cobrar?turnoId=304&fecha=${FECHA}` +
          '&importeSugerido=15000&monedaSugerida=ARS',
      );
    });

    it('pasar a espera con el prepago pendiente se permite y lo dice', async () => {
      const fixture = await montar({ turnos: [PENDIENTE] });

      // Sin `cobro:register` no se ofrece cobrar, pero el aviso sigue a la vista.
      expect(textoDe(fixture)).not.toContain('Registrar prepago');
      clickearEnLaFila(fixture, 'Ibarra, Dario', 'Pasar a espera');
      httpMock
        .expectOne(recepcion(304, 'espera'))
        .flush({ ...PENDIENTE.recepcion, estado: 'EN_ESPERA', version: 2 });
      await asentar(fixture);

      expect(avisos()[0]?.descripcion).toContain('Paso sin el prepago que exige la prestación');
    });

    it('REGISTRADO muestra el anticipo y no ofrece cobrar de nuevo', async () => {
      const fixture = await montar({
        permisos: [PERMISO_TURNO_READ, PERMISO_TURNO_MANAGE, PERMISO_COBRO_REGISTER],
        turnos: [
          {
            ...PENDIENTE,
            prepago: PREPAGO_REGISTRADO,
            recepcion: { ...PENDIENTE.recepcion, prepago: PREPAGO_REGISTRADO },
          },
        ],
      });

      expect(textoDe(fixture)).toContain('Prepago registrado por');
      expect(textoDe(fixture)).not.toContain('Registrar prepago');
    });

    it('antes del check-in avisa "si se atiende como particular" y ofrece cobrar igual', async () => {
      const fixture = await montar({
        permisos: [PERMISO_TURNO_READ, PERMISO_TURNO_MANAGE, PERMISO_COBRO_REGISTER],
        turnos: [{ ...DEL_DIA[0], personaId: 500, prepago: PREPAGO_PENDIENTE }],
      });

      const texto = fila(fixture, 'Ramirez, Ana').textContent ?? '';
      expect(texto).toContain('Sin recepción');
      expect(texto).toContain('Prepago pendiente si se atiende como particular');
      expect(botonesDeLaFila(fixture, 'Ramirez, Ana')).toContain('Registrar la llegada');
      const enlace = Array.from(fila(fixture, 'Ramirez, Ana').querySelectorAll('a')).find((a) =>
        (a.textContent ?? '').includes('Registrar prepago'),
      ) as HTMLAnchorElement;
      expect(enlace.getAttribute('href')).toBe(
        `/pacientes/500/cuenta-corriente/cobrar?turnoId=301&fecha=${FECHA}` +
          '&importeSugerido=15000&monedaSugerida=ARS',
      );
    });

    it('un turno cancelado con anticipo lo muestra para reintegrar, sin ofrecer cobrar', async () => {
      const fixture = await montar({
        permisos: [PERMISO_TURNO_READ, PERMISO_TURNO_MANAGE, PERMISO_COBRO_REGISTER],
        turnos: [{ ...DEL_DIA[2], personaId: 502, prepago: PREPAGO_REGISTRADO }],
      });

      const texto = fila(fixture, 'Vega, Carla').textContent ?? '';
      expect(texto).toContain('para un turno que no se va a atender');
      expect(texto).toContain('reintegrarlo');
      expect(texto).not.toContain('Registrar prepago');
    });

    it('al validar con cobertura la fila toma el prepago de la recepción devuelta', async () => {
      const fixture = await montar({
        permisos: [PERMISO_TURNO_READ, PERMISO_TURNO_MANAGE, PERMISO_COBRO_REGISTER],
        turnos: [{ ...PENDIENTE, recepcion: { ...PENDIENTE.recepcion, estado: 'LLEGO' } }],
      });

      clickearEnLaFila(fixture, 'Ibarra, Dario', 'Validar cobertura');
      httpMock.expectOne(recepcion(304, 'validacion')).flush({
        ...PENDIENTE.recepcion,
        estado: 'VALIDADA',
        modalidad: 'COBERTURA',
        prepago: { estado: 'NO_EXIGIDO' },
        version: 2,
      });
      await asentar(fixture);

      expect(fila(fixture, 'Ibarra, Dario').textContent).not.toContain('Prepago pendiente');
      expect(textoDe(fixture)).not.toContain('Registrar prepago');
    });
  });

  it(
    'no tiene violaciones de accesibilidad detectables',
    async () => {
      const fixture = await montar();
      // Ojo: `color-contrast` vuelve siempre `incomplete` bajo jsdom, que no calcula layout.
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------

  function avisos(): ReturnType<AvisosStore['avisos']> {
    return TestBed.inject(AvisosStore).avisos();
  }

  function textoDe(fixture: ComponentFixture<RecepcionDelDiaPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function esDelDia(): (p: HttpRequest<unknown>) => boolean {
    return (p) => p.method === 'GET' && p.url === TURNOS;
  }

  function esAgenda(): (p: HttpRequest<unknown>) => boolean {
    return (p) => p.method === 'GET' && p.url === AGENDA;
  }

  /** La fila de la tabla que contiene ese nombre. */
  function fila(fixture: ComponentFixture<RecepcionDelDiaPage>, nombre: string): HTMLElement {
    const encontrada = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr'),
    ).find((f) => (f.textContent ?? '').includes(nombre));
    expect(encontrada, `no se encontro la fila de "${nombre}"`).toBeDefined();
    return encontrada as HTMLElement;
  }

  function botonesDeLaFila(
    fixture: ComponentFixture<RecepcionDelDiaPage>,
    nombre: string,
  ): string[] {
    // Las transiciones de la recepcion: el "⋯" no es una accion, y "Ver el turno" esta en todas.
    return Array.from(fila(fixture, nombre).querySelectorAll('button'))
      .map((b) => (b.textContent ?? '').trim())
      .filter((texto) => !texto.startsWith('Más acciones de') && !texto.startsWith('Ver el turno'));
  }

  function botonDeLaFila(
    fixture: ComponentFixture<RecepcionDelDiaPage>,
    nombre: string,
    texto: string,
  ): HTMLButtonElement | null {
    return (
      (Array.from(fila(fixture, nombre).querySelectorAll('button')) as HTMLButtonElement[]).find(
        (b) => (b.textContent ?? '').includes(texto),
      ) ?? null
    );
  }

  function clickearEnLaFila(
    fixture: ComponentFixture<RecepcionDelDiaPage>,
    nombre: string,
    texto: string,
  ): void {
    const boton = botonDeLaFila(fixture, nombre, texto);
    expect(boton, `no se encontro el botón "${texto}" en la fila de "${nombre}"`).not.toBeNull();
    boton?.click();
    fixture.detectChanges();
  }

  async function asentar(fixture: ComponentFixture<RecepcionDelDiaPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function montar(
    opciones: {
      permisos?: string[];
      turnos?: unknown[];
      zona?: 'ok' | 'falla';
    } = {},
  ): Promise<ComponentFixture<RecepcionDelDiaPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({
      permissions: opciones.permisos ?? [PERMISO_TURNO_READ, PERMISO_TURNO_MANAGE],
    });

    const fixture = TestBed.createComponent(RecepcionDelDiaPage);
    fixture.componentRef.setInput('fecha', FECHA);
    fixture.detectChanges();

    const turnos = opciones.turnos ?? DEL_DIA;
    const delDia = httpMock.expectOne(esDelDia());
    expect(delDia.request.params.get('fecha')).toBe(FECHA);
    // Desde 0.24.0 la respuesta es un objeto y la zona viaja en el cuerpo: ya no hay una
    // segunda lectura de agenda de la que deducirla. `zona: 'falla'` simula que el backend la
    // manda vacia, que es lo unico que hoy puede dejar a la pantalla sin ella.
    delDia.flush({
      fecha: FECHA,
      timezone: opciones.zona === 'falla' ? '' : ZONA,
      turnos,
    });
    await asentar(fixture);

    return fixture;
  }
});
