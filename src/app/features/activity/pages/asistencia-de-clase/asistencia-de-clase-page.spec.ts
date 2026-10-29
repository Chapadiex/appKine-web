import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AsistenciaDeClasePage } from './asistencia-de-clase-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';
import { AvisosStore } from '../../../../core/services/avisos.store';

const CONSULTORIO = 3;
const CLASE = 7;
const BASE = `/api/v1/consultorios/${CONSULTORIO}/clases/${CLASE}`;

function detalle(estado: string, extra: Record<string, unknown> = {}) {
  return {
    claseId: CLASE,
    titulo: 'Pilates grupal',
    estado,
    inicio: '2026-10-20T13:00:00Z',
    fin: '2026-10-20T14:00:00Z',
    presentes: 1,
    ausentes: 0,
    sinResolver: 2,
    ocupados: 3,
    capacidadEfectiva: 6,
    enEspera: 0,
    page: 0,
    totalPages: 1,
    content: [
      {
        apellido: 'Gomez',
        nombre: 'Ana',
        numeroDocumento: '30111222',
        tipoDocumento: 'DNI',
        inscripcion: { id: 1, estado: 'CONFIRMADA' },
      },
      {
        apellido: 'Lopez',
        nombre: 'Bea',
        inscripcion: { id: 2, estado: 'ASISTIO' },
        asistencia: { id: 20, resultado: 'PRESENTE', correcciones: 1 },
      },
      { apellido: 'Ruiz', nombre: 'Caro', inscripcion: { id: 3, estado: 'CONFIRMADA' } },
      { apellido: 'Paz', nombre: 'Dora', inscripcion: { id: 4, estado: 'LISTA_ESPERA' } },
    ],
    ...extra,
  };
}

/**
 * Asistencia de una clase: el ciclo (iniciar, cerrar), el lote no atomico con fallos por item, la
 * correccion que exige motivo antes de salir a la red y el historial.
 */
describe('AsistenciaDeClasePage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AsistenciaDeClasePage],
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
      organizationName: 'Centro',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede',
    });
  });

  afterEach(() => httpMock.verify());

  const el = (f: ComponentFixture<AsistenciaDeClasePage>) => f.nativeElement as HTMLElement;
  const texto = (f: ComponentFixture<AsistenciaDeClasePage>) => el(f).textContent ?? '';

  async function estabilizar(fixture: ComponentFixture<AsistenciaDeClasePage>) {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function responderDetalle(
    fixture: ComponentFixture<AsistenciaDeClasePage>,
    cuerpo: object,
  ) {
    httpMock.expectOne((p) => p.url === `${BASE}/detalle-operativo`).flush(cuerpo);
    await estabilizar(fixture);
  }

  async function montar(estado: string) {
    const fixture = TestBed.createComponent(AsistenciaDeClasePage);
    fixture.componentRef.setInput('claseId', String(CLASE));
    fixture.detectChanges();
    await responderDetalle(fixture, detalle(estado));
    return fixture;
  }

  function boton(fixture: ComponentFixture<AsistenciaDeClasePage>, rotulo: string) {
    const encontrado = [...el(fixture).querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes(rotulo),
    );
    if (!encontrado) {
      throw new Error(`No hay botón "${rotulo}"`);
    }
    return encontrado as HTMLButtonElement;
  }

  function radio(fixture: ComponentFixture<AsistenciaDeClasePage>, id: number, valor: string) {
    const input = el(fixture).querySelector(
      `input[name="asistencia-${id}"][value="${valor}"]`,
    ) as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it(
    'una clase programada se inicia antes de marcar',
    async () => {
      const fixture = await montar('PROGRAMADA');
      expect(texto(fixture)).toContain('iniciala para empezar');
      expect(el(fixture).querySelector('input[type="radio"]')).toBeNull();
      await esperarSinViolaciones(fixture.nativeElement);

      boton(fixture, 'Iniciar clase').click();
      httpMock.expectOne(`${BASE}/inicio`).flush({ id: CLASE, estado: 'EN_CURSO' });
      await responderDetalle(fixture, detalle('EN_CURSO'));
      expect(texto(fixture)).toContain('En curso');
      // "Iniciar clase" ya no esta: el foco queda en la clase, no en el body (WCAG 2.4.3).
      expect(document.activeElement?.id).toBe('titulo-clase');
      expect(el(fixture).querySelector('input[name="asistencia-1"]')).not.toBeNull();
      // La de lista de espera no se marca.
      expect(el(fixture).querySelector('input[name="asistencia-4"]')).toBeNull();
    },
    TIMEOUT_AXE,
  );

  it(
    'el lote manda solo lo cambiado y muestra los fallos sin deshacer los exitos',
    async () => {
      const fixture = await montar('EN_CURSO');
      boton(fixture, 'Marcar presentes a los sin marcar').click();
      fixture.detectChanges();
      radio(fixture, 3, 'AUSENTE');
      await esperarSinViolaciones(fixture.nativeElement);

      boton(fixture, 'Guardar asistencia').click();
      const pedido = httpMock.expectOne(`${BASE}/asistencias/lote`);
      expect(pedido.request.body).toEqual({
        items: [
          { inscripcionId: 1, resultado: 'PRESENTE' },
          { inscripcionId: 3, resultado: 'AUSENTE' },
        ],
      });
      pedido.flush({
        exitosos: 1,
        fallidos: 1,
        items: [
          { inscripcionId: 1, resultado: { registrada: true } },
          {
            inscripcionId: 3,
            problemType: 'https://akine.app/problems/inscripcion-transicion-no-permitida',
            detalle: 'La inscripción esta cancelada',
          },
        ],
      });
      await responderDetalle(fixture, detalle('EN_CURSO'));

      expect(texto(fixture)).toContain('Se guardaron 1 participante.');
      expect(texto(fixture)).toContain('Ruiz, Caro: La inscripción esta cancelada');
      // El resultado del lote se lleva el foco: el boton que lo disparo queda deshabilitado.
      expect(document.activeElement?.getAttribute('aria-labelledby')).toBe('titulo-resultado-lote');
      expect(
        el(fixture).querySelector('[aria-live="polite"] #titulo-resultado-lote'),
      ).not.toBeNull();
      // La fallida sigue pendiente para reintentar; la exitosa ya no.
      expect(boton(fixture, 'Guardar asistencia').textContent).toContain('(1)');
    },
    TIMEOUT_AXE,
  );

  it('informa el credito consumido y la falta de pase sin tratarla como fallo', async () => {
    const fixture = await montar('EN_CURSO');
    radio(fixture, 1, 'PRESENTE');
    radio(fixture, 3, 'PRESENTE');
    boton(fixture, 'Guardar asistencia').click();
    httpMock.expectOne(`${BASE}/asistencias/lote`).flush({
      exitosos: 2,
      fallidos: 0,
      items: [
        {
          inscripcionId: 1,
          resultado: { registrada: true, consumoDeCredito: { efecto: 'CONSUMIDO', saldo: 7 } },
        },
        {
          inscripcionId: 3,
          resultado: { registrada: true, consumoDeCredito: { efecto: 'SIN_PASE_ELEGIBLE' } },
        },
      ],
    });
    await responderDetalle(fixture, detalle('EN_CURSO'));

    expect(texto(fixture)).toContain('Se guardaron 2 participantes.');
    expect(texto(fixture)).toContain(
      'Gomez, Ana: consumio un credito del pase; le quedan 7 creditos.',
    );
    expect(texto(fixture)).toContain('Ruiz, Caro: no tiene un pase vigente con creditos');
    expect(texto(fixture)).not.toContain('no se pudieron guardar');
  });

  it('una correccion sin motivo no sale a la red; con motivo, si', async () => {
    const fixture = await montar('REALIZADA');
    expect(texto(fixture)).toContain('La clase ya cerro');
    expect(texto(fixture)).toContain('Corregida 1 vez');
    radio(fixture, 2, 'AUSENTE');
    expect(el(fixture).querySelector('#motivo-2')).not.toBeNull();

    boton(fixture, 'Guardar asistencia').click();
    fixture.detectChanges();
    httpMock.expectNone(`${BASE}/asistencias/lote`);
    expect(texto(fixture)).toContain('Escribi por que se corrige.');
    expect(el(fixture).querySelector('#motivo-2')?.getAttribute('aria-invalid')).toBe('true');

    const motivo = el(fixture).querySelector('#motivo-2') as HTMLInputElement;
    motivo.value = 'Se fue a los diez minutos';
    motivo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    boton(fixture, 'Guardar asistencia').click();
    const pedido = httpMock.expectOne(`${BASE}/asistencias/lote`);
    expect(pedido.request.body).toEqual({
      items: [{ inscripcionId: 2, resultado: 'AUSENTE', motivo: 'Se fue a los diez minutos' }],
    });
    pedido.flush({ exitosos: 1, fallidos: 0, items: [{ inscripcionId: 2, resultado: {} }] });
    await responderDetalle(fixture, detalle('REALIZADA'));
    expect(texto(fixture)).toContain('Se guardaron 1 participante.');
  });

  it('a quien no tiene pase:read le llega solo el efecto: no rompe ni muestra undefined (U-46 c)', async () => {
    const fixture = await montar('EN_CURSO');
    radio(fixture, 1, 'PRESENTE');
    boton(fixture, 'Guardar asistencia').click();
    httpMock.expectOne(`${BASE}/asistencias/lote`).flush({
      exitosos: 1,
      fallidos: 0,
      items: [
        {
          inscripcionId: 1,
          resultado: {
            registrada: true,
            consumoDeCredito: { efecto: 'CONSUMIDO' },
            devengoDeClase: { efecto: 'DEVENGADA' },
          },
        },
      ],
    });
    await responderDetalle(fixture, detalle('EN_CURSO'));

    expect(texto(fixture)).toContain('Gomez, Ana: consumio un credito del pase.');
    expect(texto(fixture)).toContain('Gomez, Ana: se genero la deuda de la clase.');
    expect(texto(fixture)).not.toContain('undefined');
    expect(texto(fixture)).not.toContain('0 creditos');
  });

  it('muestra la deuda de la clase por participante; con cobros o sin precio avisa, no falla (U-39)', async () => {
    const fixture = await montar('EN_CURSO');
    radio(fixture, 1, 'PRESENTE');
    radio(fixture, 3, 'PRESENTE');
    boton(fixture, 'Guardar asistencia').click();
    httpMock.expectOne(`${BASE}/asistencias/lote`).flush({
      exitosos: 2,
      fallidos: 0,
      items: [
        {
          inscripcionId: 1,
          resultado: {
            registrada: true,
            devengoDeClase: {
              efecto: 'DEVENGADA',
              obligacionId: 9001,
              importe: 6000,
              moneda: 'ARS',
              estado: 'PENDIENTE',
              saldo: 6000,
            },
          },
        },
        {
          inscripcionId: 3,
          resultado: { registrada: true, devengoDeClase: { efecto: 'SIN_PRECIO' } },
        },
      ],
    });
    await responderDetalle(fixture, detalle('EN_CURSO'));

    const contenido = texto(fixture);
    expect(contenido).toContain('Deudas de la clase');
    expect(contenido).toContain('Gomez, Ana: se genero la deuda de la clase por');
    expect(contenido).toContain('6.000');
    expect(contenido).toContain('Revisar: Ruiz, Caro: la oferta no tiene precio vigente');
    expect(contenido).toContain('Se guardaron 2 participantes.');
    expect(contenido).not.toContain('no se pudieron guardar');
  });

  it('la correccion a ausente con cobros deja la deuda viva y lo avisa (U-39)', async () => {
    const fixture = await montar('REALIZADA');
    radio(fixture, 2, 'AUSENTE');
    const motivo = el(fixture).querySelector('#motivo-2') as HTMLInputElement;
    motivo.value = 'No vino';
    motivo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    boton(fixture, 'Guardar asistencia').click();
    httpMock.expectOne(`${BASE}/asistencias/lote`).flush({
      exitosos: 1,
      fallidos: 0,
      items: [{ inscripcionId: 2, resultado: { devengoDeClase: { efecto: 'CON_COBROS' } } }],
    });
    await responderDetalle(fixture, detalle('REALIZADA'));

    expect(texto(fixture)).toContain('la deuda de la clase ya tiene cobros y sigue vigente');
    expect(texto(fixture)).toContain('Se guardaron 1 participante.');
  });

  it('las observaciones avisan que son operativas y viajan con la marca (U-46 d)', async () => {
    const fixture = await montar('EN_CURSO');
    expect(el(fixture).querySelector('#observaciones-1')).toBeNull();
    radio(fixture, 1, 'PRESENTE');

    const campo = el(fixture).querySelector('#observaciones-1') as HTMLInputElement;
    expect(campo).not.toBeNull();
    const aviso = el(fixture).querySelector(`#${campo.getAttribute('aria-describedby')}`);
    expect(aviso?.textContent).toContain('Operativas: no anotes datos de salud');

    campo.value = '  Llego a los 10 minutos ';
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    boton(fixture, 'Guardar asistencia').click();
    const pedido = httpMock.expectOne(`${BASE}/asistencias/lote`);
    expect(pedido.request.body).toEqual({
      items: [{ inscripcionId: 1, resultado: 'PRESENTE', observaciones: 'Llego a los 10 minutos' }],
    });
    pedido.flush({ exitosos: 1, fallidos: 0, items: [{ inscripcionId: 1, resultado: {} }] });
    await responderDetalle(fixture, detalle('EN_CURSO'));
  });

  it('ofrece la atención clínica de la clase (AKINE-08.05)', async () => {
    const fixture = await montar('REALIZADA');
    expect(el(fixture).querySelector(`a[href="/atencion/clases/${CLASE}"]`)).not.toBeNull();
  });

  it('descartar limpia las marcas pendientes', async () => {
    const fixture = await montar('EN_CURSO');
    radio(fixture, 1, 'PRESENTE_TARDE');
    boton(fixture, 'Descartar cambios').click();
    fixture.detectChanges();
    expect(boton(fixture, 'Guardar asistencia').disabled).toBe(true);
    // "Descartar cambios" desaparecio con las marcas: el foco vuelve a la lista.
    expect(document.activeElement?.id).toBe('titulo-participantes');
  });

  it('muestra el historial de una asistencia', async () => {
    const fixture = await montar('REALIZADA');
    // Un click de verdad enfoca el boton: es a donde vuelve el foco al cerrar el historial.
    boton(fixture, 'Historial').focus();
    boton(fixture, 'Historial').click();
    fixture.detectChanges();
    expect(texto(fixture)).toContain('Cargando el historial');
    httpMock.expectOne(`${BASE}/asistencias/20/historial`).flush([
      { id: 1, tipo: 'REGISTRO', resultadoNuevo: 'AUSENTE', ocurridoEn: '2026-10-20T13:05:00Z' },
      {
        id: 2,
        tipo: 'CORRECCION',
        resultadoAnterior: 'AUSENTE',
        resultadoNuevo: 'PRESENTE',
        motivo: 'Llego tarde',
        ocurridoEn: '2026-10-20T13:30:00Z',
      },
    ]);
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Historial de Lopez, Bea');
    expect(document.activeElement?.getAttribute('aria-labelledby')).toBe('titulo-historial');
    expect(texto(fixture)).toContain('Ausente a Presente');
    expect(texto(fixture)).toContain('motivo: Llego tarde');
    boton(fixture, 'Cerrar historial').click();
    fixture.detectChanges();
    expect(el(fixture).querySelector('#titulo-historial')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement?.textContent).toContain('Historial');
    expect(document.activeElement?.tagName).toBe('BUTTON');
  });

  it('un historial que falla lo dice', async () => {
    const fixture = await montar('REALIZADA');
    boton(fixture, 'Historial').click();
    httpMock
      .expectOne(`${BASE}/asistencias/20/historial`)
      .flush({ type: 'https://akine.app/problems/not-found' }, { status: 404, statusText: 'NF' });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('no existen');
  });

  it('cerrar la clase informa los ausentes que dejo el cierre', async () => {
    const fixture = await montar('EN_CURSO');
    boton(fixture, 'Cerrar clase').click();
    httpMock
      .expectOne(`${BASE}/cierre`)
      .flush({ cerroAhora: true, ausentados: [{ id: 1 }, { id: 2 }], esperaCancelada: 1 });
    await responderDetalle(fixture, detalle('REALIZADA'));
    // UX-12: el resultado va al aviso global; "Cerrar clase" desaparece y el foco va al titulo.
    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toBe('Clase cerrada');
    expect(aviso?.descripcion).toBe(
      'Se marcaron ausentes 2 sin resolver y se cancelaron 1 de la lista de espera.',
    );
    expect(document.activeElement?.id).toBe('titulo-clase');
  });

  it('sin inscripción:manage no ofrece cerrar la clase: el backend la rechazaria (0.120.0)', async () => {
    TestBed.inject(PermissionsStore).cargar().subscribe();
    httpMock
      .expectOne(RUTA_PERMISOS_EFECTIVOS)
      .flush({ permissions: ['clase:manage', 'asistencia:manage', 'inscripcion:read'] });
    const fixture = await montar('EN_CURSO');
    expect(() => boton(fixture, 'Cerrar clase')).toThrow();
    expect(el(fixture).querySelector('input[name="asistencia-1"]')).not.toBeNull();
  });

  it('un 503 del lote avisa cuanto esperar, no guarda nada y conserva lo marcado', async () => {
    const fixture = await montar('EN_CURSO');
    radio(fixture, 1, 'PRESENTE');
    boton(fixture, 'Guardar asistencia').click();
    httpMock
      .expectOne(`${BASE}/asistencias/lote`)
      .flush(
        { type: 'https://akine.app/problems/service-unavailable', status: 503 },
        { status: 503, statusText: 'Service Unavailable', headers: { 'Retry-After': '7' } },
      );
    await responderDetalle(fixture, detalle('EN_CURSO'));
    // Error del lote: arriba de la lista que se esta marcando, no en un aviso que se va.
    const alerta = el(fixture).querySelector('app-alerta');
    expect(alerta?.textContent).toContain('No pudimos guardar la asistencia');
    expect(alerta?.textContent).toContain(
      'Hay muchos registros de asistencia en curso en esta sede. Probá de nuevo en 7 segundos.',
    );
    expect(alerta?.textContent).toContain('No se guardó nada');
    const radioMarcado = el(fixture).querySelector(
      'input[name="asistencia-1"][value="PRESENTE"]',
    ) as HTMLInputElement;
    expect(radioMarcado.checked).toBe(true);
    expect(boton(fixture, 'Guardar asistencia').disabled).toBe(false);
  });

  it('un cierre rechazado muestra el motivo del servidor y relee', async () => {
    const fixture = await montar('EN_CURSO');
    boton(fixture, 'Cerrar clase').click();
    httpMock.expectOne(`${BASE}/cierre`).flush(
      {
        type: 'https://akine.app/problems/clase-transicion-no-permitida',
        detail: 'La clase esta cancelada',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await responderDetalle(fixture, detalle('CANCELADA'));
    // Boton suelto, sin formulario: aviso global de error con el mensaje del servidor.
    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.tipo).toBe('error');
    expect(aviso?.titulo).toBe('No pudimos cerrar la clase');
    expect(aviso?.descripcion).toContain('La clase esta cancelada');
    expect(texto(fixture)).toContain('no tuvo asistentes');
  });

  it('un detalle que falla ofrece reintentar', async () => {
    const fixture = TestBed.createComponent(AsistenciaDeClasePage);
    fixture.componentRef.setInput('claseId', String(CLASE));
    fixture.detectChanges();
    httpMock
      .expectOne((p) => p.url === `${BASE}/detalle-operativo`)
      .error(new ProgressEvent('error'));
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('No se pudo contactar al servidor');
    boton(fixture, 'Reintentar').click();
    await responderDetalle(fixture, detalle('EN_CURSO', { totalPages: 2, totalElements: 150 }));
    // Pie estandar (UX-14): operativa, arranca con 100 por pagina (todos a la vista).
    expect(texto(fixture)).toContain('Mostrando 1–100 de 150');
    expect(
      el(fixture).querySelector('nav[aria-label="Páginas de participantes"] [aria-current="page"]')
        ?.textContent,
    ).toContain('1');
    boton(fixture, 'Página siguiente').click();
    const pagina = httpMock.expectOne((p) => p.url === `${BASE}/detalle-operativo`);
    expect(pagina.request.params.get('page')).toBe('1');
    expect(pagina.request.params.get('size')).toBe('100');
    pagina.flush(detalle('EN_CURSO', { totalPages: 2, page: 1, totalElements: 150 }));
    await estabilizar(fixture);

    // Filas por pagina: va como `size` y vuelve a la primera pagina.
    const filas = el(fixture).querySelector(
      '.paginacion-pie__por-pagina select',
    ) as HTMLSelectElement;
    filas.value = '25';
    filas.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const chica = httpMock.expectOne((p) => p.url === `${BASE}/detalle-operativo`);
    expect(chica.request.params.get('page')).toBe('0');
    expect(chica.request.params.get('size')).toBe('25');
    chica.flush(detalle('EN_CURSO', { totalPages: 6, page: 0, totalElements: 150, size: 25 }));
  });
});
