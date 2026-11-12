import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { rutaMemberships } from '../../../../core/testing/rutas-api';
import {
  CONSULTORIO,
  ORGANIZACION,
  URL_ESPACIOS,
  URL_OFERTAS,
  asentar,
  elegirSede,
  escribir,
  proveerDiaDeLaSede,
  textoDe,
} from '../../testing/activity-testing';
import { AltaDeClasePage, sumarMinutos } from './alta-de-clase-page';
import { AvisosStore } from '../../../../core/services/avisos.store';

const PROGRAMAR = `/api/v1/consultorios/${CONSULTORIO}/clases/ofertas/42`;
const HABILITACIONES = `${URL_OFERTAS}/42/habilitaciones`;

const GRUPAL = {
  id: 42,
  nombreComercial: 'Pilates reformer',
  modalidad: 'GRUPAL',
  capacidad: 12,
  duracionMinutos: 45,
  requiereProfesional: true,
  requiereEspacio: true,
};

describe('AltaDeClasePage', () => {
  let httpMock: HttpTestingController;
  let navegar: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AltaDeClasePage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
        proveerDiaDeLaSede(),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    navegar = vi.fn().mockResolvedValue(true);
    TestBed.inject(Router).navigateByUrl = navegar as unknown as Router['navigateByUrl'];
  });

  afterEach(() => httpMock.verify());

  async function montar(ofertas: unknown[] = [GRUPAL, { id: 43, modalidad: 'INDIVIDUAL' }]) {
    elegirSede();
    const fixture = TestBed.createComponent(AltaDeClasePage);
    fixture.componentRef.setInput('fecha', '2026-10-20');
    fixture.detectChanges();
    httpMock.expectOne((p) => p.url === URL_OFERTAS).flush(ofertas);
    await asentar(fixture);
    return fixture;
  }

  /** Oferta sin restricciones y una sede cuyos espacios no se pueden leer (sin permiso). */
  function responderSinBoxes(): void {
    httpMock.expectOne(HABILITACIONES).flush({});
    httpMock
      .expectOne((p) => p.url === URL_ESPACIOS)
      .flush(null, { status: 403, statusText: 'Forbidden' });
  }

  it(
    'ofrece solo las grupales, toma cupo y duración de la oferta y programa en hora de la sede',
    async () => {
      const fixture = await montar();
      const opciones = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('#clase-oferta option'),
      ).map((o) => o.textContent?.trim());
      expect(opciones).toEqual(['Elegí una oferta', 'Pilates reformer']);

      escribir(fixture, '#clase-oferta', '42');
      httpMock.expectOne(HABILITACIONES).flush({
        restringidaPorProfesional: true,
        profesionales: [
          { membershipId: 55, nombre: 'Lic. Diaz', estado: 'ACTIVO' },
          { membershipId: 56, nombre: 'Baja', estado: 'INACTIVO' },
        ],
        restringidaPorEspacio: true,
        espacios: [
          { espacioId: 9, nombre: 'Sala grande', estado: 'ACTIVO', enServicio: true },
          { espacioId: 10, nombre: 'Box dado de baja', estado: 'ACTIVO', enServicio: false },
          { espacioId: 11, nombre: 'Habilitación vencida', estado: 'INACTIVO' },
        ],
      });
      await asentar(fixture);
      // Restringida por espacio: los boxes salen de las habilitaciones, sin leer los de la sede.
      httpMock.expectNone((p) => p.url === URL_ESPACIOS);
      const raiz = fixture.nativeElement as HTMLElement;
      expect((raiz.querySelector('#clase-capacidad') as HTMLInputElement).value).toBe('12');
      expect((raiz.querySelector('#clase-fin') as HTMLInputElement).value).toBe('09:45');
      expect(raiz.querySelectorAll('#clase-profesional option')).toHaveLength(2);
      const boxes = Array.from(raiz.querySelectorAll('#clase-espacio option')).map((o) =>
        o.textContent?.trim(),
      );
      expect(boxes).toEqual(['Que el sistema elija uno libre', 'Sala grande']);
      await esperarSinViolaciones(fixture.nativeElement);

      escribir(fixture, '#clase-profesional', '55');
      escribir(fixture, '#clase-espacio', '9');
      escribir(fixture, '#clase-titulo', ' Pilates de la tarde ');
      (raiz.querySelector('button[type="submit"]') as HTMLButtonElement).click();
      const pedido = httpMock.expectOne(PROGRAMAR);
      expect(pedido.request.method).toBe('POST');
      const cuerpo = pedido.request.body as Record<string, unknown>;
      expect(cuerpo['inicio']).toBe('2026-10-20T12:00:00.000Z');
      expect(cuerpo['fin']).toBe('2026-10-20T12:45:00.000Z');
      expect(cuerpo['capacidad']).toBe(12);
      expect(cuerpo['profesionalId']).toBe(55);
      expect(cuerpo['espacioId']).toBe(9);
      expect(cuerpo['titulo']).toBe('Pilates de la tarde');
      expect(typeof cuerpo['idempotencyKey']).toBe('string');
      pedido.flush({ id: 70 });
      await asentar(fixture);
      expect(navegar).toHaveBeenCalledWith('/clases/70');
      // Pantalla propia de alta: navega y publica el aviso global (UX-12).
      const [aviso] = TestBed.inject(AvisosStore).avisos();
      expect(aviso?.titulo).toBe('Clase programada');
      expect(aviso?.descripcion).toContain('Pilates reformer');
    },
    TIMEOUT_AXE,
  );

  it('una oferta sin restriccion ofrece los profesionales de la organización', async () => {
    const fixture = await montar();
    escribir(fixture, '#clase-oferta', '42');
    httpMock
      .expectOne(HABILITACIONES)
      .flush({ restringidaPorProfesional: false, profesionales: [] });
    // Sin restriccion de espacio, cualquier box activo de la sede en servicio.
    httpMock
      .expectOne((p) => p.url === URL_ESPACIOS)
      .flush({
        content: [
          { id: 9, name: 'Sala grande', enServicio: true },
          { id: 12, name: 'Box fuera de servicio', enServicio: false },
        ],
      });
    httpMock
      .expectOne((p) => p.url === rutaMemberships(ORGANIZACION))
      .flush({
        content: [
          { id: 55, roleCode: 'PROFESIONAL', estado: 'ACTIVA', accountName: 'Lic. Diaz' },
          {
            id: 57,
            roleCode: 'PROFESIONAL',
            estado: 'ACTIVA',
            consultorioId: 99,
            accountName: 'Otra sede',
          },
          { id: 58, roleCode: 'ADMINISTRATIVO', estado: 'ACTIVA', accountName: 'Recepcion' },
        ],
      });
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Lic. Diaz');
    expect(textoDe(fixture)).not.toContain('Otra sede');
    expect(textoDe(fixture)).not.toContain('Recepcion');
    expect(textoDe(fixture)).toContain('Sala grande');
    expect(textoDe(fixture)).not.toContain('Box fuera de servicio');
  });

  it('todas las semanas: manda días, rango y horario, y deja a la vista las fechas que no salieron', async () => {
    const fixture = await montar([
      { ...GRUPAL, requiereProfesional: false, requiereEspacio: false },
    ]);
    const anfitrion = fixture.nativeElement as HTMLElement;
    (anfitrion.querySelector('input[value="semanal"]') as HTMLInputElement).click();
    escribir(fixture, '#clase-oferta', '42');
    responderSinBoxes();
    await asentar(fixture);
    const enviar = anfitrion.querySelector('button[type="submit"]') as HTMLButtonElement;

    // Sin días ni fecha hasta no sale nada a la red.
    enviar.click();
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Elegí al menos un día.');
    httpMock.expectNone(`${PROGRAMAR}/serie`);

    (anfitrion.querySelector('#clase-dia-4') as HTMLInputElement).click();
    (anfitrion.querySelector('#clase-dia-2') as HTMLInputElement).click();
    escribir(fixture, '#clase-fecha', '2026-12-01');
    escribir(fixture, '#clase-hasta', '2026-12-31');
    await asentar(fixture);
    enviar.click();

    const pedido = httpMock.expectOne(`${PROGRAMAR}/serie`);
    expect(pedido.request.body).toMatchObject({
      desde: '2026-12-01',
      hasta: '2026-12-31',
      diasSemana: [2, 4],
      horaInicio: '09:00',
      horaFin: '09:45',
    });
    pedido.flush({
      programadas: [{ id: 1 }, { id: 2 }],
      omitidas: [
        { fecha: '2026-12-08', motivo: 'FERIADO', detalle: 'Feriado: la sede no atiende' },
      ],
    });
    await asentar(fixture);

    expect(textoDe(fixture)).toContain('1 fecha no se pudo programar');
    expect(textoDe(fixture)).toContain('Feriado (1): martes 08/12/2026');
    expect(textoDe(fixture)).toContain('Feriado');
    expect(navegar).not.toHaveBeenCalled();
  });

  it('un 400 del cupo se marca junto al campo y el cartel sólo dice lo que no se marca', async () => {
    const fixture = await montar([
      { ...GRUPAL, requiereProfesional: false, requiereEspacio: false },
    ]);
    escribir(fixture, '#clase-oferta', '42');
    responderSinBoxes();
    await asentar(fixture);
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement
    ).click();

    httpMock.expectOne(PROGRAMAR).flush(
      {
        type: 'https://akine.app/problems/validation-error',
        status: 400,
        detail: 'La solicitud contiene campos invalidos',
        errors: { capacidad: 'El cupo es demasiado alto', titulo: 'El titulo es muy largo' },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await asentar(fixture);

    expect(textoDe(fixture).split('El cupo es demasiado alto')).toHaveLength(2);
    expect(textoDe(fixture)).toContain('El titulo es muy largo.');
  });

  it('el rechazo del servidor se muestra con su causa y la clave se conserva', async () => {
    const fixture = await montar([
      { ...GRUPAL, requiereProfesional: false, requiereEspacio: false },
    ]);
    escribir(fixture, '#clase-oferta', '42');
    responderSinBoxes();
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Sin box');
    const enviar = () =>
      (
        (fixture.nativeElement as HTMLElement).querySelector(
          'button[type="submit"]',
        ) as HTMLButtonElement
      ).click();

    enviar();
    const primero = httpMock.expectOne(PROGRAMAR);
    const clave = (primero.request.body as { idempotencyKey: string }).idempotencyKey;
    expect((primero.request.body as { profesionalId?: number }).profesionalId).toBeUndefined();
    expect((primero.request.body as { espacioId?: number }).espacioId).toBeUndefined();
    primero.flush(
      {
        type: 'https://akine.app/problems/clase-capacidad-no-admitida',
        status: 409,
        capacidadPedida: 12,
        capacidadMaxima: 6,
      },
      { status: 409, statusText: 'Conflict' },
    );
    await asentar(fixture);
    // Conflicto con el cupo: advertencia pegada al campo que lo produjo, no al pie.
    const raiz = fixture.nativeElement as HTMLElement;
    expect(raiz.querySelector('#clase-conflicto-cupo')?.textContent).toContain(
      'Pediste 12 lugares y el limite es 6',
    );
    expect(raiz.querySelector('#clase-capacidad')?.getAttribute('aria-describedby')).toContain(
      'clase-conflicto-cupo',
    );

    enviar();
    const segundo = httpMock.expectOne(PROGRAMAR);
    expect((segundo.request.body as { idempotencyKey: string }).idempotencyKey).toBe(clave);
    segundo.flush(
      { type: 'https://akine.app/problems/idempotency-key-conflict', status: 409 },
      { status: 409, statusText: 'Conflict' },
    );
    await asentar(fixture);

    enviar();
    const tercero = httpMock.expectOne(PROGRAMAR);
    expect((tercero.request.body as { idempotencyKey: string }).idempotencyKey).not.toBe(clave);
    tercero.flush(
      { type: 'https://akine.app/problems/recurso-ocupado', status: 409, recurso: 'espacio' },
      { status: 409, statusText: 'Conflict' },
    );
    await asentar(fixture);
    expect(raiz.querySelector('#clase-conflicto-horario')?.textContent).toContain(
      'El box ya tiene un turno u otra clase',
    );
  });

  it('valida antes de mandar: oferta obligatoria y fin posterior al inicio', async () => {
    const fixture = await montar([]);
    expect(textoDe(fixture)).toContain('todavía no tiene actividades grupales');
    const raiz = fixture.nativeElement as HTMLElement;
    // Sin ofertas, la pantalla dice dónde se carga cada cosa que falta.
    const destinos = [...raiz.querySelectorAll('.pasos-previos a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(destinos).toEqual(['/espacios', '/servicios/catalogo', '/servicios/ofertas']);
    (raiz.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(textoDe(fixture)).toContain('Elegí la oferta de la clase');
    httpMock.expectNone(PROGRAMAR);
  });

  it('cada campo en error dice que le falta y el foco va al primero (WCAG 3.3.1)', async () => {
    const fixture = await montar([{ ...GRUPAL, requiereProfesional: false }]);
    escribir(fixture, '#clase-oferta', '42');
    responderSinBoxes();
    await asentar(fixture);
    escribir(fixture, '#clase-fecha', '');
    escribir(fixture, '#clase-capacidad', '0');
    const raiz = fixture.nativeElement as HTMLElement;
    (raiz.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await asentar(fixture);

    httpMock.expectNone(PROGRAMAR);
    expect(textoDe(fixture)).toContain('Elegí la fecha de la clase.');
    expect(textoDe(fixture)).toContain('El cupo es de 1 en adelante.');
    expect(raiz.querySelector('#clase-fecha')?.getAttribute('aria-describedby')).toBe(
      'clase-fecha-error',
    );
    expect(raiz.querySelector('#clase-capacidad')?.getAttribute('aria-describedby')).toBe(
      'clase-capacidad-ayuda clase-capacidad-error',
    );
    expect(document.activeElement?.id).toBe('clase-fecha');
  });

  it('rechaza un fin anterior al inicio sin salir a la red', async () => {
    const fixture = await montar([{ ...GRUPAL, requiereProfesional: false, duracionMinutos: 0 }]);
    escribir(fixture, '#clase-oferta', '42');
    responderSinBoxes();
    escribir(fixture, '#clase-inicio', '10:00');
    escribir(fixture, '#clase-fin', '09:00');
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    // Es un dato a corregir: va en el campo de fin, que apunta al mensaje.
    const raiz = fixture.nativeElement as HTMLElement;
    expect(raiz.querySelector('#clase-fin-error.campo__error')?.textContent).toContain(
      'La hora de fin tiene que ser posterior',
    );
    expect(raiz.querySelector('#clase-fin')?.getAttribute('aria-invalid')).toBe('true');
    httpMock.expectNone(PROGRAMAR);
  });

  it('si no se pueden leer las ofertas lo dice', async () => {
    elegirSede();
    const fixture = TestBed.createComponent(AltaDeClasePage);
    fixture.detectChanges();
    httpMock
      .expectOne((p) => p.url === URL_OFERTAS)
      .flush(null, { status: 500, statusText: 'Server Error' });
    await asentar(fixture);
    const alerta = (fixture.nativeElement as HTMLElement).querySelector('app-alerta');
    expect(alerta?.textContent).toContain('No pudimos leer las ofertas grupales');
    expect(alerta?.textContent).toContain('No pudimos completar la operación');
    expect(alerta?.textContent).toContain('Reintentar');
  });
  /** Elige la oferta sin profesional ni box que exigir y deja la pantalla lista para enviar. */
  async function montarSimple(modoSemanal = false) {
    const fixture = await montar([
      { ...GRUPAL, requiereProfesional: false, requiereEspacio: false },
    ]);
    if (modoSemanal) {
      (
        (fixture.nativeElement as HTMLElement).querySelector(
          'input[value="semanal"]',
        ) as HTMLInputElement
      ).click();
    }
    escribir(fixture, '#clase-oferta', '42');
    responderSinBoxes();
    await asentar(fixture);
    return fixture;
  }

  function enviarFormulario(fixture: Awaited<ReturnType<typeof montar>>): void {
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement
    ).click();
  }

  it('sin sede elegida no lee ofertas ni programa, y manda a elegir el contexto', async () => {
    const fixture = TestBed.createComponent(AltaDeClasePage);
    fixture.detectChanges();
    await asentar(fixture);
    httpMock.expectNone((p) => p.url.includes('/ofertas'));

    enviarFormulario(fixture);
    await asentar(fixture);
    const raiz = fixture.nativeElement as HTMLElement;
    expect(textoDe(fixture)).toContain('No pudimos programar la clase');
    expect(raiz.querySelector('a[href="/seleccionar-contexto"]')).not.toBeNull();

    // En modo semanal pasa lo mismo: nada sale a la red sin sede.
    (raiz.querySelector('input[value="semanal"]') as HTMLInputElement).click();
    await asentar(fixture);
    expect(textoDe(fixture)).not.toContain('No pudimos programar la clase');
    enviarFormulario(fixture);
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('No pudimos programar la clase');
    httpMock.expectNone((p) => p.url.includes('/clases'));
  });

  it('una oferta que no admite clases se avisa junto al selector, con el detalle', async () => {
    const fixture = await montarSimple();
    enviarFormulario(fixture);
    httpMock.expectOne(PROGRAMAR).flush(
      {
        type: 'https://akine.app/problems/clase-no-programable',
        status: 409,
        motivo: 'La oferta está fuera de vigencia',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await asentar(fixture);
    const raiz = fixture.nativeElement as HTMLElement;
    const alerta = raiz.querySelector('#clase-conflicto-oferta');
    expect(alerta?.textContent).toContain('Detalle: La oferta está fuera de vigencia');
    expect(raiz.querySelector('#clase-oferta')?.getAttribute('aria-invalid')).toBe('true');
    expect(raiz.querySelector('#clase-oferta')?.getAttribute('aria-describedby')).toContain(
      'clase-conflicto-oferta',
    );
    // No se repite como error general del formulario.
    expect(textoDe(fixture)).not.toContain('No pudimos programar la clase');
  });

  it('un horario no disponible muestra su motivo, y un error sin conflicto va arriba con el suyo', async () => {
    const fixture = await montarSimple();
    enviarFormulario(fixture);
    httpMock.expectOne(PROGRAMAR).flush(
      {
        type: 'https://akine.app/problems/slot-no-disponible',
        status: 409,
        motivo: 'El profesional no atiende los martes',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await asentar(fixture);
    const raiz = fixture.nativeElement as HTMLElement;
    expect(raiz.querySelector('#clase-conflicto-horario')?.textContent).toContain(
      'Detalle: El profesional no atiende los martes',
    );

    enviarFormulario(fixture);
    httpMock.expectOne(PROGRAMAR).flush(
      {
        type: 'https://akine.app/problems/clase-transicion-no-permitida',
        status: 409,
        motivo: 'La clase ya empezó',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await asentar(fixture);
    expect(raiz.querySelector('#clase-conflicto-horario')).toBeNull();
    expect(textoDe(fixture)).toContain('No pudimos programar la clase');
    expect(textoDe(fixture)).toContain('Detalle: La clase ya empezó');
  });

  it('un 400 sobre el box se marca en el selector del box', async () => {
    const fixture = await montarSimple();
    enviarFormulario(fixture);
    httpMock.expectOne(PROGRAMAR).flush(
      {
        type: 'https://akine.app/problems/validation-error',
        status: 400,
        detail: 'La solicitud contiene campos invalidos',
        errors: { espacioId: 'Ese box no existe' },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await asentar(fixture);
    const raiz = fixture.nativeElement as HTMLElement;
    const espacio = raiz.querySelector('#clase-espacio');
    expect(espacio?.getAttribute('aria-invalid')).toBe('true');
    expect(espacio?.getAttribute('aria-describedby')).toBe(
      'clase-espacio-ayuda clase-espacio-error',
    );
    expect(raiz.querySelector('#clase-espacio-error')?.textContent).toContain('Ese box no existe');
  });

  it('sin hora de inicio no se manda, y lo dice en el campo', async () => {
    const fixture = await montarSimple();
    escribir(fixture, '#clase-inicio', '');
    enviarFormulario(fixture);
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Indica a que hora empieza.');
    httpMock.expectNone(PROGRAMAR);
  });

  it('si la clase vuelve sin id, vuelve al listado de clases', async () => {
    const fixture = await montarSimple();
    enviarFormulario(fixture);
    httpMock.expectOne(PROGRAMAR).flush({});
    await asentar(fixture);
    expect(navegar).toHaveBeenCalledWith('/clases');
  });

  it('una serie completa manda profesional, box y título, y vuelve al listado con el resumen', async () => {
    const fixture = await montar();
    const raiz = fixture.nativeElement as HTMLElement;
    (raiz.querySelector('input[value="semanal"]') as HTMLInputElement).click();
    escribir(fixture, '#clase-oferta', '42');
    httpMock.expectOne(HABILITACIONES).flush({
      restringidaPorProfesional: true,
      profesionales: [{ membershipId: 55, nombre: 'Lic. Diaz', estado: 'ACTIVO' }],
      restringidaPorEspacio: true,
      espacios: [{ espacioId: 9, nombre: 'Sala grande', estado: 'ACTIVO', enServicio: true }],
    });
    await asentar(fixture);
    // Elegir y desmarcar un día: sólo viaja el que queda.
    (raiz.querySelector('#clase-dia-1') as HTMLInputElement).click();
    (raiz.querySelector('#clase-dia-3') as HTMLInputElement).click();
    (raiz.querySelector('#clase-dia-1') as HTMLInputElement).click();
    escribir(fixture, '#clase-profesional', '55');
    escribir(fixture, '#clase-espacio', '9');
    escribir(fixture, '#clase-titulo', ' Pilates ');
    escribir(fixture, '#clase-fecha', '2026-12-01');
    escribir(fixture, '#clase-hasta', '2026-12-31');
    await asentar(fixture);
    enviarFormulario(fixture);

    const pedido = httpMock.expectOne(`${PROGRAMAR}/serie`);
    expect(pedido.request.body).toMatchObject({
      diasSemana: [3],
      profesionalId: 55,
      espacioId: 9,
      titulo: 'Pilates',
    });
    pedido.flush({ programadas: [{ id: 1 }] });
    await asentar(fixture);
    expect(navegar).toHaveBeenCalledWith('/clases');
    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toBe('1 clase programada');
    expect(aviso?.descripcion).toBe('Pilates reformer · del 01/12 al 31/12');
  });

  it('una serie sin ninguna clase programada lo dice y no publica aviso; con una, avisa las que faltan', async () => {
    const fixture = await montarSimple(true);
    const raiz = fixture.nativeElement as HTMLElement;
    (raiz.querySelector('#clase-dia-2') as HTMLInputElement).click();
    escribir(fixture, '#clase-fecha', '2026-12-01');
    escribir(fixture, '#clase-hasta', '2026-12-31');
    await asentar(fixture);

    enviarFormulario(fixture);
    // Fechas sin motivo ni detalle: se agrupan juntas igual.
    httpMock.expectOne(`${PROGRAMAR}/serie`).flush({
      omitidas: [{ fecha: '2026-12-01' }, { fecha: '2026-12-08' }],
    });
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('2 fechas no se pudieron programar');
    expect(textoDe(fixture)).toContain('No se programó ninguna clase.');
    expect(raiz.querySelectorAll('.serie-omitidas li')).toHaveLength(1);
    expect(raiz.querySelector('.serie-omitidas li')?.textContent).toContain('(2)');
    expect(TestBed.inject(AvisosStore).avisos()).toHaveLength(0);
    expect(navegar).not.toHaveBeenCalled();

    enviarFormulario(fixture);
    httpMock.expectOne(`${PROGRAMAR}/serie`).flush({
      programadas: [{ id: 1 }],
      omitidas: [{ fecha: '2026-12-08' }, { fecha: '2026-12-15' }],
    });
    await asentar(fixture);
    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toBe('1 clase programada');
    expect(aviso?.descripcion).toBe('2 fechas no se pudieron programar.');
    expect(textoDe(fixture)).toContain('Se programaron 1.');
    expect(navegar).not.toHaveBeenCalled();
  });

  it('si la serie falla, lo dice y el reintento lleva otra clave', async () => {
    const fixture = await montarSimple(true);
    const raiz = fixture.nativeElement as HTMLElement;
    (raiz.querySelector('#clase-dia-2') as HTMLInputElement).click();
    escribir(fixture, '#clase-fecha', '2026-12-01');
    escribir(fixture, '#clase-hasta', '2026-12-31');
    await asentar(fixture);

    enviarFormulario(fixture);
    const primero = httpMock.expectOne(`${PROGRAMAR}/serie`);
    const clave = (primero.request.body as { idempotencyKey: string }).idempotencyKey;
    primero.flush(null, { status: 500, statusText: 'Server Error' });
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('No pudimos programar la clase');

    enviarFormulario(fixture);
    const segundo = httpMock.expectOne(`${PROGRAMAR}/serie`);
    expect((segundo.request.body as { idempotencyKey: string }).idempotencyKey).not.toBe(clave);
    segundo.flush({ programadas: [{ id: 1 }, { id: 2 }] });
    await asentar(fixture);
    expect(TestBed.inject(AvisosStore).avisos()[0]?.titulo).toBe('2 clases programadas');
  });

  it('una oferta sin cupo propio conserva el cupo, y los profesionales sin nombre se nombran por número', async () => {
    const fixture = await montar([{ ...GRUPAL, capacidad: undefined }]);
    escribir(fixture, '#clase-oferta', '42');
    httpMock.expectOne(HABILITACIONES).flush({
      restringidaPorProfesional: true,
      profesionales: [
        { membershipId: 55, nombre: '', estado: 'ACTIVO' },
        { nombre: 'Sin vínculo', estado: 'ACTIVO' },
      ],
    });
    httpMock.expectOne((p) => p.url === URL_ESPACIOS).flush({ content: [] });
    await asentar(fixture);
    const raiz = fixture.nativeElement as HTMLElement;
    expect((raiz.querySelector('#clase-capacidad') as HTMLInputElement).value).toBe('10');
    const nombres = Array.from(raiz.querySelectorAll('#clase-profesional option')).map((o) =>
      o.textContent?.trim(),
    );
    expect(nombres).toEqual(['Elegí un profesional', 'Profesional #55']);
  });

  it('los profesionales de la organización se nombran por correo o por número', async () => {
    const fixture = await montar();
    escribir(fixture, '#clase-oferta', '42');
    httpMock.expectOne(HABILITACIONES).flush({});
    httpMock.expectOne((p) => p.url === URL_ESPACIOS).flush({ content: [] });
    httpMock
      .expectOne((p) => p.url === rutaMemberships(ORGANIZACION))
      .flush({
        content: [
          { id: 55, roleCode: 'PROFESIONAL', estado: 'ACTIVA', accountEmail: 'diaz@ejemplo.test' },
          { id: 56, roleCode: 'PROFESIONAL', estado: 'ACTIVA', consultorioId: CONSULTORIO },
        ],
      });
    await asentar(fixture);
    const nombres = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('#clase-profesional option'),
    ).map((o) => o.textContent?.trim());
    expect(nombres).toEqual(['Elegí un profesional', 'diaz@ejemplo.test', 'Profesional #56']);
  });

  it('las respuestas de una oferta que ya no está elegida se descartan', async () => {
    const fixture = await montar([GRUPAL, { ...GRUPAL, id: 44, nombreComercial: 'Yoga' }]);
    escribir(fixture, '#clase-oferta', '42');
    const dePilates = httpMock.expectOne(HABILITACIONES);
    escribir(fixture, '#clase-oferta', '44');
    dePilates.flush({
      restringidaPorProfesional: true,
      profesionales: [{ membershipId: 55, nombre: 'De Pilates', estado: 'ACTIVO' }],
    });
    // La oferta 44 sigue su propio camino: sus espacios y los profesionales de la organización.
    httpMock.expectOne(`${URL_OFERTAS}/44/habilitaciones`).flush({});
    const espacios = httpMock.expectOne((p) => p.url === URL_ESPACIOS);
    const miembros = httpMock.expectOne((p) => p.url === rutaMemberships(ORGANIZACION));
    // Se vuelve a Pilates antes de que lleguen: lo de Yoga ya no corresponde.
    escribir(fixture, '#clase-oferta', '42');
    espacios.flush({ content: [{ id: 9, name: 'Sala de Yoga', enServicio: true }] });
    miembros.flush({
      content: [{ id: 57, roleCode: 'PROFESIONAL', estado: 'ACTIVA', accountName: 'De Yoga' }],
    });
    httpMock.expectOne(HABILITACIONES).flush({
      restringidaPorProfesional: true,
      profesionales: [],
      restringidaPorEspacio: true,
      espacios: [],
    });
    await asentar(fixture);
    expect(textoDe(fixture)).not.toContain('De Pilates');
    expect(textoDe(fixture)).not.toContain('De Yoga');
    expect(textoDe(fixture)).not.toContain('Sala de Yoga');
  });
});

describe('sumarMinutos', () => {
  it('suma sin pasar de las 23:59 y tolera una hora rara', () => {
    expect(sumarMinutos('09:30', 45)).toBe('10:15');
    expect(sumarMinutos('23:30', 90)).toBe('23:59');
    expect(sumarMinutos('xx', 10)).toBe('xx');
  });
});
