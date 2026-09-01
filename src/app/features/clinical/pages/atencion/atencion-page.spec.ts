import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AtencionPage } from './atencion-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const CONSULTORIO = 3;
const TURNO = 77;
const SESION = 501;

const INICIAR = `/api/v1/consultorios/${CONSULTORIO}/sesiones/turnos/${TURNO}`;
const VER = `/api/v1/consultorios/${CONSULTORIO}/sesiones/${SESION}`;
const BORRADOR = `${VER}/borrador`;
const EVALUACION = `${VER}/evaluacion`;
const CIERRE = `${VER}/cierre`;

const ABIERTA = {
  id: SESION,
  turnoId: TURNO,
  consultorioId: CONSULTORIO,
  historiaClinicaId: 88,
  estado: 'BORRADOR',
  iniciadaEn: '2026-09-15T12:02:44Z',
  version: 3,
  previa: { dolorEva: 7, evolucion: 'IGUAL', iniciadaEn: '2026-09-08T12:00:00Z' },
};

const PRIMERA_SESION = { ...ABIERTA, previa: undefined };

/**
 * La misma sesion, ya cerrada.
 *
 * <p><b>`numeroSesion` es lo que la marca como cerrada</b>, no una bandera aparte: el contrato lo
 * declara ausente mientras la sesion siga abierta. Por eso el fixture lo trae y por eso la
 * pantalla lo usa para decidir el modo lectura.
 */
const CERRADA = {
  ...ABIERTA,
  version: 4,
  numeroSesion: 8,
  cerradaEn: '2026-09-15T12:48:00Z',
  cierre: { asistencia: 'AUSENTE' },
};

/**
 * Spec de la atencion clinica (M14, AKINE-06.01 y 06.02).
 *
 * <p>Cubre solo lo que decide comportamiento:
 *
 * <ol>
 *   <li><b>El conflicto de version no pierde lo tipeado.</b> Es el corazon del encargo: dos
 *       pestañas del mismo profesional son el caso normal, y la falla seria silenciosa —texto
 *       clinico perdido sin ningun sintoma—.</li>
 *   <li><b>Los cuatro errores se mapean por `problemType`.</b> Con un rechazo generico,
 *       `sesion-ajena` se leeria como falta de permiso, que es falso.</li>
 *   <li><b>La previa se muestra al lado del dolor</b>, y su ausencia se dice.</li>
 *   <li><b>Ningun campo clinico es obligatorio</b>: se guarda con todo vacio.</li>
 * </ol>
 */
describe('AtencionPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AtencionPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    tenantContext = TestBed.inject(TenantContextStore);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // -------------------------------------------------------------------------------------
  // 1. El conflicto de version
  // -------------------------------------------------------------------------------------

  it('ante un 409 de version NO pierde lo tipeado, y avisa que hubo conflicto', async () => {
    const fixture = await montar();

    escribirNotas(fixture, 'Paciente refiere dolor al flexionar.');
    guardarAhora(fixture);

    const guardado = httpMock.expectOne(esBorrador());
    expect((guardado.request.body as { version: number }).version).toBe(3);
    conflicto(guardado);
    await estabilizar(fixture);

    // Lo tipeado sigue en el textarea. Es lo unico que no puede fallar: el resto de la pantalla
    // se puede rehacer, un parrafo clinico que el profesional ya escribio no.
    expect(notas(fixture).value).toBe('Paciente refiere dolor al flexionar.');
    expect(texto(fixture)).toContain('Otra pestaña guardo antes que vos');
    expect(texto(fixture)).toContain('no perdimos lo que escribiste');
  });

  it('con el conflicto abierto el autosave se frena, y lo que se sigue tipeando no se manda', async () => {
    // El montaje va con relojes reales: `whenStable()` los necesita, y con relojes falsos la
    // apertura de la atencion nunca termina de estabilizarse.
    const fixture = await montar();

    escribirNotas(fixture, 'Primera linea.');
    guardarAhora(fixture);
    conflicto(httpMock.expectOne(esBorrador()));
    fixture.detectChanges();

    vi.useFakeTimers();
    try {
      // Sigue escribiendo mientras mira el cartel. Sin la pausa, cada pulsacion produciria otro
      // 409 y el cartel parpadearia sin que nada avance.
      escribirNotas(fixture, 'Primera linea. Segunda linea.');
      vi.advanceTimersByTime(10_000);

      httpMock.expectNone(esBorrador());
      expect(notas(fixture).value).toBe('Primera linea. Segunda linea.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('sin conflicto el autosave dispara solo, con la version leida', async () => {
    const fixture = await montar();

    vi.useFakeTimers();
    try {
      escribirNotas(fixture, 'Escribiendo y me voy a servir un cafe.');

      // Antes de que termine la espera todavia no salio nada: el autosave no manda por cada tecla.
      vi.advanceTimersByTime(500);
      httpMock.expectNone(esBorrador());

      vi.advanceTimersByTime(2_000);
      const guardado = httpMock.expectOne(esBorrador());
      expect((guardado.request.body as { version: number }).version).toBe(3);
      guardado.flush({ ...ABIERTA, version: 4 });
      fixture.detectChanges();
    } finally {
      vi.useRealTimers();
    }
  });

  it('al releer muestra lo del servidor AL LADO, conserva lo tipeado y guarda con la version nueva', async () => {
    const fixture = await montar();

    escribirNotas(fixture, 'Lo mio.');
    guardarAhora(fixture);
    conflicto(httpMock.expectOne(esBorrador()));
    await estabilizar(fixture);

    apretar(fixture, 'Releer y comparar');
    httpMock
      .expectOne(esVer())
      .flush({ ...ABIERTA, version: 9, borrador: 'Lo de la otra pestaña.' });
    await estabilizar(fixture);

    // Las dos versiones conviven: la pantalla no elige por el profesional.
    expect(notas(fixture).value).toBe('Lo mio.');
    expect(texto(fixture)).toContain('Lo de la otra pestaña.');

    // Y el proximo guardado sale con la version fresca, que es lo que lo destraba.
    guardarAhora(fixture);
    const reintento = httpMock.expectOne(esBorrador());
    expect((reintento.request.body as { version: number }).version).toBe(9);
    expect((reintento.request.body as { contenido: string }).contenido).toBe('Lo mio.');
    reintento.flush({ ...ABIERTA, version: 10, borrador: 'Lo mio.' });
    await estabilizar(fixture);
  });

  it('un guardado exitoso NO pisa lo que se tipeo mientras el request viajaba', async () => {
    const fixture = await montar();

    escribirNotas(fixture, 'Primera.');
    guardarAhora(fixture);
    const enVuelo = httpMock.expectOne(esBorrador());

    // El profesional no deja de escribir porque haya un request en el aire.
    escribirNotas(fixture, 'Primera. Segunda.');
    enVuelo.flush({ ...ABIERTA, version: 4, borrador: 'Primera.' });
    await estabilizar(fixture);

    expect(notas(fixture).value).toBe('Primera. Segunda.');
  });

  // -------------------------------------------------------------------------------------
  // 2. Los cuatro errores
  // -------------------------------------------------------------------------------------

  it('sesion-ajena habla de propiedad y NO de permiso', async () => {
    const fixture = await montar();

    guardarAhora(fixture);
    httpMock
      .expectOne(esBorrador())
      .flush(
        { type: 'https://akine.app/problems/sesion-ajena', status: 409, detail: 'Es de otro.' },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);

    const visible = texto(fixture);
    expect(visible).toContain('otro profesional');
    expect(visible).toContain('No es un problema de permisos');
    // Quien lee esto SI tiene `sesion:register`. Mandarlo a pedir un permiso que ya tiene es la
    // forma mas rapida de que nunca entienda lo que pasa.
    expect(visible).not.toContain('No tenes permiso');
  });

  it('turno-no-atendible muestra el motivo que dio el servidor', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });
    const fixture = TestBed.createComponent(AtencionPage);
    fixture.componentRef.setInput('turnoId', String(TURNO));
    fixture.detectChanges();

    httpMock.expectOne(esIniciar()).flush(
      {
        type: 'https://akine.app/problems/turno-no-atendible',
        status: 409,
        detail: 'Este turno no habilita una atencion.',
        motivo: 'El turno esta cancelado',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('El turno esta cancelado');
  });

  it('validation-error explica la escala y la lateralidad sin zona', async () => {
    const fixture = await montar();

    apretar(fixture, 'Guardar evaluacion');
    httpMock.expectOne(esEvaluacion()).flush(
      {
        type: 'https://akine.app/problems/validation-error',
        status: 400,
        detail: 'dolorLateralidad exige dolorZona.',
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('dolorLateralidad exige dolorZona.');
  });

  // -------------------------------------------------------------------------------------
  // 3. La previa
  // -------------------------------------------------------------------------------------

  it('muestra la evaluacion previa dentro del bloque de dolor', async () => {
    const fixture = await montar();

    const bloqueDeDolor = grupoDeDolor(fixture);
    expect(bloqueDeDolor).toContain('La vez pasada');
    expect(bloqueDeDolor).toContain('dolor 7/10');
    expect(bloqueDeDolor).toContain('evolucion IGUAL');
  });

  it('sin previa dice que es la primera sesion, en vez de dejar el hueco vacio', async () => {
    const fixture = await montar(PRIMERA_SESION);

    expect(grupoDeDolor(fixture)).toContain('Primera sesion evaluada de este paciente');
  });

  // -------------------------------------------------------------------------------------
  // 4. Ningun campo clinico es obligatorio
  // -------------------------------------------------------------------------------------

  it('guarda la evaluacion con todos los campos clinicos vacios', async () => {
    const fixture = await montar();

    apretar(fixture, 'Guardar evaluacion');
    const pedido = httpMock.expectOne(esEvaluacion());
    const cuerpo = pedido.request.body as Record<string, unknown>;

    // Solo la version y el modo. Un `''` en cada campo guardaria una cadena vacia como si fuera
    // un dato cargado, y "no lo cargue" tiene que seguir siendo distinguible.
    expect(cuerpo['version']).toBe(3);
    expect(cuerpo['modo']).toBe('RAPIDA');
    expect(cuerpo['dolorEva']).toBeUndefined();
    expect(cuerpo['dolorZona']).toBeUndefined();
    expect(cuerpo['evolucion']).toBeUndefined();

    pedido.flush({ ...ABIERTA, version: 4 });
    await estabilizar(fixture);
  });

  it('NO_APLICA viaja como valor cargado, que no es lo mismo que dejarlo vacio', async () => {
    const fixture = await montar();

    const lateralidad = fixture.nativeElement.querySelector(
      '#atencion-lateralidad',
    ) as HTMLSelectElement;
    lateralidad.value = 'NO_APLICA';
    lateralidad.dispatchEvent(new Event('change'));
    escribirEn(fixture, '#atencion-zona', 'Lumbar');
    fixture.detectChanges();

    apretar(fixture, 'Guardar evaluacion');
    const pedido = httpMock.expectOne(esEvaluacion());
    expect((pedido.request.body as Record<string, unknown>)['dolorLateralidad']).toBe('NO_APLICA');

    pedido.flush({ ...ABIERTA, version: 4 });
    await estabilizar(fixture);
  });

  it('cambiar a COMPLETA suma campos y NO borra lo que ya se habia cargado', async () => {
    const fixture = await montar();

    escribirEn(fixture, '#atencion-objetivo', 'Reducir dolor en flexion');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#atencion-motivo')).toBeNull();

    apretarRadio(fixture, 'COMPLETA');

    // El modo decide cuanto se muestra, no que hace falta ni que se conserva.
    expect(fixture.nativeElement.querySelector('#atencion-motivo')).not.toBeNull();
    expect(
      (fixture.nativeElement.querySelector('#atencion-objetivo') as HTMLInputElement).value,
    ).toBe('Reducir dolor en flexion');

    apretar(fixture, 'Guardar evaluacion');
    const pedido = httpMock.expectOne(esEvaluacion());
    expect((pedido.request.body as Record<string, unknown>)['modo']).toBe('COMPLETA');
    pedido.flush({ ...ABIERTA, version: 4 });
    await estabilizar(fixture);
  });

  it('volver a apretar el dolor elegido lo deja sin cargar: cargarlo no es irreversible', async () => {
    const fixture = await montar();

    apretar(fixture, '6');
    apretar(fixture, '6');

    apretar(fixture, 'Guardar evaluacion');
    const pedido = httpMock.expectOne(esEvaluacion());
    expect((pedido.request.body as Record<string, unknown>)['dolorEva']).toBeUndefined();
    pedido.flush({ ...ABIERTA, version: 4 });
    await estabilizar(fixture);
  });

  // -------------------------------------------------------------------------------------
  // Cierre de la atencion (AKINE-06.05)
  // -------------------------------------------------------------------------------------

  it('con AUSENTE cierra sin pedir nota: no se inventa el resultado de algo que no ocurrio', async () => {
    const fixture = await montar();

    apretarRadio(fixture, 'AUSENTE');
    apretar(fixture, 'Cerrar la atencion');

    // Sale igual, con el campo de nota ni siquiera renderizado. Si la pantalla lo exigiera, el
    // profesional tendria que escribir algo sobre una sesion que no existio para poder cerrar.
    const pedido = httpMock.expectOne(esCierre());
    const cuerpo = pedido.request.body as Record<string, unknown>;
    expect(cuerpo['asistencia']).toBe('AUSENTE');
    expect(cuerpo['notaDeCierre']).toBeUndefined();
    expect(cuerpo['version']).toBe(3);

    pedido.flush(CERRADA);
    await estabilizar(fixture);
  });

  it('con el paciente presente y sin nota no manda nada, y dice por que', async () => {
    const fixture = await montar();

    apretarRadio(fixture, 'PRESENTE');
    apretar(fixture, 'Cerrar la atencion');

    // La nota es el UNICO campo condicionalmente obligatorio: sin ella no queda registrado que se
    // hizo. Y el rechazo tiene que ser visible: un boton que no hace nada es el defecto que ya
    // dejo inejecutable una accion del padron.
    httpMock.expectNone(esCierre());
    expect(texto(fixture)).toContain('hace falta la nota de cierre');
  });

  it('cerrar no exige tolerancia, indicaciones ni proxima conducta', async () => {
    const fixture = await montar();

    apretarRadio(fixture, 'PRESENTE');
    escribirEn(fixture, '#cierre-nota', 'Terapia manual lumbar, 30 minutos.');
    fixture.detectChanges();
    apretar(fixture, 'Cerrar la atencion');

    const pedido = httpMock.expectOne(esCierre());
    const cuerpo = pedido.request.body as Record<string, unknown>;
    expect(cuerpo['notaDeCierre']).toBe('Terapia manual lumbar, 30 minutos.');
    expect(cuerpo['tolerancia']).toBeUndefined();
    expect(cuerpo['indicaciones']).toBeUndefined();
    expect(cuerpo['proximaConducta']).toBeUndefined();

    pedido.flush(CERRADA);
    await estabilizar(fixture);
  });

  it('despues de cerrar la pantalla queda en LECTURA y muestra el numero de sesion', async () => {
    const fixture = await montar();

    apretarRadio(fixture, 'AUSENTE');
    apretar(fixture, 'Cerrar la atencion');
    httpMock.expectOne(esCierre()).flush(CERRADA);
    await estabilizar(fixture);

    // Nada editable: dejar los campos seria ofrecer un guardado que el backend rechaza siempre
    // con 409 `sesion-cerrada`.
    expect(fixture.nativeElement.querySelector('#atencion-notas')).toBeNull();
    expect(fixture.nativeElement.querySelector('#cierre-nota')).toBeNull();
    expect(rotulosDeBoton(fixture)).not.toContain('Guardar evaluacion');
    expect(rotulosDeBoton(fixture)).not.toContain('Cerrar la atencion');

    // El correlativo por historia clinica es lo que el profesional cuenta.
    expect(texto(fixture)).toContain('Sesion numero 8');
  });

  it('los campos opcionales del cierre viajan si se cargan, y se leen con su rotulo', async () => {
    const fixture = await montar();

    apretarRadio(fixture, 'PRESENTE');
    escribirEn(fixture, '#cierre-nota', 'Terapia manual.');
    elegir(fixture, '#cierre-tolerancia', 'REGULAR');
    elegir(fixture, '#cierre-conducta', 'ALTA');
    fixture.detectChanges();
    apretar(fixture, 'Cerrar la atencion');

    const pedido = httpMock.expectOne(esCierre());
    const cuerpo = pedido.request.body as Record<string, unknown>;
    expect(cuerpo['tolerancia']).toBe('REGULAR');
    expect(cuerpo['proximaConducta']).toBe('ALTA');

    pedido.flush({
      ...CERRADA,
      cierre: {
        asistencia: 'PRESENTE',
        notaDeCierre: 'Terapia manual.',
        tolerancia: 'REGULAR',
        proximaConducta: 'ALTA',
      },
    });
    await estabilizar(fixture);

    // En lectura se muestra el rotulo y no el valor crudo del enum: "ALTA" a secas no dice nada.
    expect(texto(fixture)).toContain('Regular');
    expect(texto(fixture)).toContain('Alta');
  });

  it('una sesion que ya venia cerrada se abre directamente en lectura', async () => {
    const fixture = await montar(CERRADA);

    expect(fixture.nativeElement.querySelector('#atencion-notas')).toBeNull();
    expect(texto(fixture)).toContain('Sesion numero 8');
  });

  it('un 409 sesion-cerrada al guardar relee y pasa a lectura, sin ofrecer reintentar', async () => {
    const fixture = await montar();

    escribirNotas(fixture, 'Sigo escribiendo sin saber que la cerraron.');
    guardarAhora(fixture);

    httpMock.expectOne(esBorrador()).flush(
      {
        type: 'https://akine.app/problems/sesion-cerrada',
        status: 409,
        detail: 'La sesion ya esta cerrada.',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);

    // La relectura es lo que convierte el error en un estado: sin ella la pantalla se quedaria
    // con los campos abiertos y cada guardado volveria a fallar igual.
    httpMock.expectOne(esVer()).flush(CERRADA);
    await estabilizar(fixture);

    expect(fixture.nativeElement.querySelector('#atencion-notas')).toBeNull();
    expect(texto(fixture)).toContain('Sesion numero 8');
    expect(rotulosDeBoton(fixture)).not.toContain('Reintentar');
  });

  // -------------------------------------------------------------------------------------
  // Accesibilidad
  // -------------------------------------------------------------------------------------

  it(
    'la vista de lectura de una sesion cerrada no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar(CERRADA);
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------

  async function montar(sesion: object = ABIERTA): Promise<ComponentFixture<AtencionPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });

    const fixture = TestBed.createComponent(AtencionPage);
    fixture.componentRef.setInput('turnoId', String(TURNO));
    fixture.detectChanges();

    httpMock.expectOne(esIniciar()).flush(sesion);
    await estabilizar(fixture);
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<AtencionPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function conflicto(pedido: TestRequest): void {
    pedido.flush(
      {
        type: 'https://akine.app/problems/concurrent-modification',
        status: 409,
        detail: 'La version quedo vieja.',
      },
      { status: 409, statusText: 'Conflict' },
    );
  }

  function notas(fixture: ComponentFixture<AtencionPage>): HTMLTextAreaElement {
    return fixture.nativeElement.querySelector('#atencion-notas') as HTMLTextAreaElement;
  }

  function escribirNotas(fixture: ComponentFixture<AtencionPage>, texto: string): void {
    escribirEn(fixture, '#atencion-notas', texto);
    fixture.detectChanges();
  }

  function escribirEn(
    fixture: ComponentFixture<AtencionPage>,
    selector: string,
    valor: string,
  ): void {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
  }

  function guardarAhora(fixture: ComponentFixture<AtencionPage>): void {
    apretar(fixture, 'Guardar ahora');
  }

  function apretar(fixture: ComponentFixture<AtencionPage>, rotulo: string): void {
    const boton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => (b.textContent ?? '').trim().startsWith(rotulo));
    if (boton === undefined) {
      throw new Error(`No hay ningun boton rotulado "${rotulo}".`);
    }
    boton.click();
    fixture.detectChanges();
  }

  function apretarRadio(fixture: ComponentFixture<AtencionPage>, valor: string): void {
    const radio = fixture.nativeElement.querySelector(
      `input[type="radio"][value="${valor}"]`,
    ) as HTMLInputElement;
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function texto(fixture: ComponentFixture<AtencionPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  /** El contenido del `fieldset` del dolor. La previa tiene que estar ADENTRO, no en otra parte. */
  function grupoDeDolor(fixture: ComponentFixture<AtencionPage>): string {
    const grupos = Array.from(
      fixture.nativeElement.querySelectorAll('fieldset') as NodeListOf<HTMLFieldSetElement>,
    );
    const dolor = grupos.find((g) =>
      (g.querySelector('legend')?.textContent ?? '').includes('Dolor'),
    );
    if (dolor === undefined) {
      throw new Error('No hay ningun grupo de dolor.');
    }
    return dolor.textContent ?? '';
  }

  function esIniciar() {
    return (p: HttpRequest<unknown>) => p.method === 'POST' && p.url === INICIAR;
  }

  function esVer() {
    return (p: HttpRequest<unknown>) => p.method === 'GET' && p.url === VER;
  }

  function esBorrador() {
    return (p: HttpRequest<unknown>) => p.method === 'PUT' && p.url === BORRADOR;
  }

  function esEvaluacion() {
    return (p: HttpRequest<unknown>) => p.method === 'PUT' && p.url === EVALUACION;
  }

  /** Elige un valor en un `select` y dispara el `change` que la pantalla escucha. */
  function elegir(fixture: ComponentFixture<AtencionPage>, selector: string, valor: string): void {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLSelectElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('change'));
  }

  function esCierre() {
    return (p: HttpRequest<unknown>) => p.method === 'POST' && p.url === CIERRE;
  }

  /** Rotulos de todos los botones renderizados. Sirve para afirmar que uno YA NO esta. */
  function rotulosDeBoton(fixture: ComponentFixture<AtencionPage>): string[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).map((boton) => (boton.textContent ?? '').trim());
  }
});
