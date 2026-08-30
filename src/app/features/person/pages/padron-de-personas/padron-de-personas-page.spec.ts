import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { PERMISO_PACIENTE_MANAGE } from '../../../../core/models/permisos';
import { PadronDePersonasPage } from './padron-de-personas-page';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const PERSONAS = '/api/v1/personas';

/** Una persona sin perfil clinico. Es una ficha completa y correcta, no una a medio cargar. */
const SIN_PERFIL = {
  id: 10,
  tipoDocumento: 'DNI',
  numeroDocumento: '30111222',
  apellido: 'Perez',
  nombre: 'Ana Maria',
  telefono: '1155550000',
  esPaciente: false,
  estado: 'ACTIVO',
  version: 0,
};

/** La misma persona, ya con perfil clinico activo. */
const PACIENTE = {
  id: 11,
  tipoDocumento: 'DNI',
  numeroDocumento: '30333444',
  apellido: 'Gomez',
  nombre: 'Luis',
  esPaciente: true,
  perfilPacienteId: 7,
  estado: 'ACTIVO',
  version: 2,
};

/** Sin documento. Es un estado legitimo, no un dato faltante. */
const SIN_DOCUMENTO = {
  id: 12,
  apellido: 'Ruiz',
  nombre: 'Tomas',
  esPaciente: false,
  estado: 'ACTIVO',
  version: 0,
};

const PAGINA = {
  content: [SIN_PERFIL, PACIENTE, SIN_DOCUMENTO],
  page: 0,
  size: 20,
  totalElements: 3,
  totalPages: 1,
};

/**
 * Spec del padron de personas (M07, AKINE-03.01).
 *
 * <p>Cubre lo que el criterio de aceptacion exige y nada mas. Los casos elegidos tienen algo en
 * comun: <b>cuando estan mal, el sintoma no es un error visible</b>.
 *
 * <ol>
 *   <li>El alta no puede crear un paciente. Si algun dia el cuerpo llevara un `esPaciente`, el
 *       backend respondería `201` igual y nadie se enteraria hasta que un cliente de pilates
 *       apareciera en un listado clinico.</li>
 *   <li>El 409 de posible duplicado tiene que <b>mostrar las fichas</b> y ofrecer confirmar. Si se
 *       tratara como un conflicto generico, el operador con dos homonimos queda trabado sin
 *       entender por que.</li>
 *   <li>El 409 de documento repetido <b>no</b> puede ofrecer confirmar. Si lo ofreciera, el
 *       operador lo confirmaria y recibiria el mismo error otra vez, sin salida.</li>
 *   <li>La confirmacion tiene que viajar como `confirmaPosibleDuplicado`. Sin ella el reenvio
 *       vuelve a chocar y el alta es imposible.</li>
 *   <li>Una persona sin documento se muestra como tal. Una celda vacia invita a "completarla"
 *       inventando un numero, que es lo que contamina el padron.</li>
 * </ol>
 */
describe('PadronDePersonasPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PadronDePersonasPage],
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
    httpMock.verify();
  });

  it('distingue una persona de un paciente, y no llama "pendiente" a la que no lo es', async () => {
    const fixture = await montar();
    const filas = fixture.nativeElement.querySelectorAll('tbody tr');
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(filas.length).toBe(3);
    expect((filas[0] as HTMLElement).textContent).toContain('Persona');
    expect((filas[1] as HTMLElement).textContent).toContain('Paciente');

    // El texto de la columna negativa importa tanto como el de la positiva: "Sin perfil" o
    // "Pendiente" empujarian al operador a activarle un perfil clinico para "terminar" la ficha.
    expect(texto).not.toContain('Sin perfil');
    expect(texto).not.toContain('Pendiente');

    // Y la nota de arriba explica la distincion una sola vez, en vez de repetirla por fila.
    expect(texto).toContain('Persona y paciente no son lo mismo');
    expect(texto).toContain('no crea historia clinica');
  });

  it('muestra "Sin documento" y no una celda vacia', async () => {
    const fixture = await montar();
    const filas = fixture.nativeElement.querySelectorAll('tbody tr');

    expect((filas[2] as HTMLElement).textContent).toContain('Sin documento');
  });

  it('el alta NO manda ninguna marca de paciente: crear una persona nunca crea un paciente', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de alta una persona');
    escribir(fixture, '#alta-persona-apellido', 'Suarez');
    escribir(fixture, '#alta-persona-nombre', 'Carla');
    enviar(fixture);

    const alta = httpMock.expectOne(esAlta());
    const cuerpo = alta.request.body as Record<string, unknown>;

    expect(cuerpo['apellido']).toBe('Suarez');
    expect(cuerpo['nombre']).toBe('Carla');
    // RF-M07-010 en un assert: el cuerpo no tiene ninguna forma de pedir un perfil clinico, y no
    // la tiene porque el contrato tampoco la ofrece.
    expect(cuerpo['esPaciente']).toBeUndefined();
    expect(cuerpo['activarPerfil']).toBeUndefined();
    expect(cuerpo['perfilPaciente']).toBeUndefined();
    // Sin documento no viaja ni el tipo ni el numero: el par es indivisible.
    expect(cuerpo['tipoDocumento']).toBeUndefined();
    expect(cuerpo['numeroDocumento']).toBeUndefined();

    alta.flush({ ...SIN_PERFIL, id: 20, apellido: 'Suarez', nombre: 'Carla' });
    httpMock.expectOne(esListado()).flush(PAGINA);
    await fixture.whenStable();
    fixture.detectChanges();

    // El mensaje de exito aclara que todavia no es paciente: es el momento donde el operador
    // podria suponer lo contrario.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Todavia no es paciente');
  });

  it('el 409 de posible duplicado muestra las fichas y ofrece confirmar', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de alta una persona');
    escribir(fixture, '#alta-persona-apellido', 'Perez');
    escribir(fixture, '#alta-persona-nombre', 'Ana Maria');
    enviar(fixture);

    httpMock.expectOne(esAlta()).flush(
      {
        type: 'https://akine.app/problems/persona-posible-duplicado',
        title: 'Posible duplicado',
        status: 409,
        detail: 'El alta coincide con personas ya registradas.',
        candidatos: [10],
      },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    // Las fichas candidatas se resuelven de a una: un "coincide con la persona #10" seria pedirle
    // al operador que memorice numeros.
    httpMock.expectOne(`${PERSONAS}/10`).flush(SIN_PERFIL);
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Ya hay personas parecidas registradas');
    expect(texto).toContain('Perez, Ana Maria');
    expect(texto).toContain('DNI 30111222');
    expect(botonPorTexto(fixture, 'Es otra persona: darla de alta igual')).not.toBeNull();
  });

  it('confirmar el duplicado reenvia el alta con confirmaPosibleDuplicado', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de alta una persona');
    escribir(fixture, '#alta-persona-apellido', 'Perez');
    escribir(fixture, '#alta-persona-nombre', 'Ana Maria');
    enviar(fixture);

    httpMock.expectOne(esAlta()).flush(
      {
        type: 'https://akine.app/problems/persona-posible-duplicado',
        status: 409,
        detail: 'Coincide.',
        candidatos: [10],
      },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    fixture.detectChanges();
    httpMock.expectOne(`${PERSONAS}/10`).flush(SIN_PERFIL);
    await fixture.whenStable();
    fixture.detectChanges();

    botonPorTexto(fixture, 'Es otra persona: darla de alta igual')?.click();
    fixture.detectChanges();

    const reenvio = httpMock.expectOne(esAlta());
    // Sin esta bandera el reenvio vuelve a chocar contra la misma advertencia y el alta se
    // vuelve imposible: es la traduccion por interfaz de "ya hice la busqueda previa".
    expect((reenvio.request.body as Record<string, unknown>)['confirmaPosibleDuplicado']).toBe(
      true,
    );

    reenvio.flush({ ...SIN_PERFIL, id: 21 });
    httpMock.expectOne(esListado()).flush(PAGINA);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('el 409 de documento repetido NO ofrece confirmar: es un invariante duro', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de alta una persona');
    escribir(fixture, '#alta-persona-apellido', 'Perez');
    escribir(fixture, '#alta-persona-nombre', 'Otra');
    escribir(fixture, '#alta-persona-numero-documento', '30111222');
    elegir(fixture, '#alta-persona-tipo-documento', 'DNI');
    enviar(fixture);

    httpMock.expectOne(esAlta()).flush(
      {
        type: 'https://akine.app/problems/persona-documento-taken',
        status: 409,
        detail: 'Ya existe una persona vigente con ese documento.',
        personaExistenteId: 10,
      },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    httpMock.expectOne(`${PERSONAS}/10`).flush(SIN_PERFIL);
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Ese documento ya esta en el padron');
    expect(texto).toContain('Perez, Ana Maria');

    // Ofrecerlo seria un callejon: el operador confirmaria y recibiria el mismo error otra vez.
    expect(botonPorTexto(fixture, 'Es otra persona: darla de alta igual')).toBeNull();
  });

  it('los filtros recargan con su parametro y vuelven a la primera pagina', async () => {
    const fixture = await montar();

    elegir(fixture, '#padron-filtro-perfil', 'CON_PERFIL');
    const filtrada = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.url === PERSONAS && peticion.params.get('perfil') === 'CON_PERFIL',
    );
    // El estado sigue en su defecto: los dos filtros son independientes.
    expect(filtrada.request.params.get('estado')).toBe('ACTIVO');
    expect(filtrada.request.params.get('page')).toBe('0');
    filtrada.flush({ ...PAGINA, content: [PACIENTE], totalElements: 1 });
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Gomez, Luis');
  });

  it('la busqueda manda el texto tal como se tipeo: normalizar es del backend', async () => {
    const fixture = await montar();

    escribirYCambiar(fixture, '#padron-busqueda', '30.111.222');
    const buscada = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.url === PERSONAS && peticion.params.get('q') === '30.111.222',
    );
    // La pantalla NO saca los puntos: las claves normalizadas las calcula el backend, y hacerlo
    // tambien aca daria dos normalizaciones que se despegan la primera vez que una cambie.
    buscada.flush({ ...PAGINA, content: [SIN_PERFIL], totalElements: 1 });
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('la edicion manda expectedVersion para no pisar el cambio ajeno', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#edicion-apellido-10', 'Perez Gomez');
    enviar(fixture);

    const edicion = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PATCH' && peticion.url === `${PERSONAS}/10`,
    );
    const cuerpo = edicion.request.body as Record<string, unknown>;
    expect(cuerpo['apellido']).toBe('Perez Gomez');
    // Sin la version, el backend no puede detectar la edicion concurrente y el ultimo en guardar
    // pisa al anterior en silencio.
    expect(cuerpo['expectedVersion']).toBe(0);

    edicion.flush({ ...SIN_PERFIL, apellido: 'Perez Gomez', version: 1 });
    httpMock.expectOne(esListado()).flush(PAGINA);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('sin contexto de trabajo ofrece elegirlo, no reintentar', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(PadronDePersonasPage);
    fixture.detectChanges();

    httpMock.expectOne(esListado()).flush(
      {
        type: 'https://akine.app/problems/missing-tenant-context',
        status: 403,
        detail: 'Falta contexto.',
      },
      { status: 403, statusText: 'Forbidden' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    // Reintentar no arregla nada acá: lo que falta es elegir contexto. Y la sesion sigue abierta,
    // asi que el mensaje no puede sonar a que se venció.
    expect(texto).toContain('sesion sigue abierta');
    expect(texto).toContain('Elegir contexto de trabajo');
    expect(botonPorTexto(fixture, 'Reintentar')).toBeNull();
  });

  it('un padron vacio no es un error, y lo dice como tal', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_PACIENTE_MANAGE] });

    const fixture = TestBed.createComponent(PadronDePersonasPage);
    fixture.detectChanges();
    httpMock
      .expectOne(esListado())
      .flush({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('No hay personas que coincidan');
    expect(texto).not.toContain('No pudimos completar');
  });

  it('una persona dada de baja no ofrece acciones, y su ficha se sigue viendo', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_PACIENTE_MANAGE] });

    const fixture = TestBed.createComponent(PadronDePersonasPage);
    fixture.detectChanges();
    httpMock.expectOne(esListado()).flush({
      ...PAGINA,
      content: [{ ...SIN_PERFIL, estado: 'INACTIVO' }],
      totalElements: 1,
    });
    await fixture.whenStable();
    fixture.detectChanges();

    // RN-M07-004: el historico sigue resolviendo. Lo que no admite son cambios.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Perez, Ana Maria');
    expect(botonPorTexto(fixture, 'Editar')).toBeNull();
    expect(botonPorTexto(fixture, 'Activar perfil de paciente')).toBeNull();
  });

  it('activar el perfil avisa que no crea historia clinica', async () => {
    const fixture = await montar();

    botonPorTexto(fixture, 'Activar perfil de paciente')?.click();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('NO le crea historia clinica');
    // Y avisa que repetir la accion no rompe nada: del lado del servidor es idempotente.
    expect(texto).toContain('Si ya tenia perfil, la accion no cambia nada');
  });

  it('activa el perfil con el motivo vacio, porque el panel lo declara opcional', async () => {
    const fixture = await montar();

    abrir(fixture, 'Activar perfil de paciente');
    enviar(fixture);

    // El motivo es opcional en el contrato y la pantalla lo rotula asi. Si el envio no sale,
    // el operador queda mirando un panel que no hace nada y RF-M07-008 no se puede ejecutar.
    const peticion = httpMock.expectOne(
      (candidata: HttpRequest<unknown>) =>
        candidata.method === 'POST' && candidata.url === `${PERSONAS}/10/perfil-paciente`,
    );
    expect((peticion.request.body as { motivo?: string }).motivo).toBeUndefined();

    peticion.flush({ ...SIN_PERFIL, esPaciente: true, perfilPacienteId: 9 });
    await fixture.whenStable();
    fixture.detectChanges();
    httpMock.expectOne(esListado()).flush(PAGINA);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('ya es paciente');
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------

  async function montar(): Promise<ComponentFixture<PadronDePersonasPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({
      permissions: [PERMISO_PACIENTE_MANAGE],
    });

    const fixture = TestBed.createComponent(PadronDePersonasPage);
    fixture.detectChanges();

    httpMock.expectOne(esListado()).flush(PAGINA);
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  function esListado() {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'GET' && peticion.url === PERSONAS;
  }

  function esAlta() {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'POST' && peticion.url === PERSONAS;
  }

  function botonPorTexto(
    fixture: ComponentFixture<PadronDePersonasPage>,
    texto: string,
  ): HTMLButtonElement | null {
    const botones = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ) as HTMLButtonElement[];
    return botones.find((boton) => boton.textContent?.trim().includes(texto)) ?? null;
  }

  function abrir(fixture: ComponentFixture<PadronDePersonasPage>, texto: string): void {
    botonPorTexto(fixture, texto)?.click();
    fixture.detectChanges();
  }

  function escribir(
    fixture: ComponentFixture<PadronDePersonasPage>,
    selector: string,
    valor: string,
  ): void {
    const campo = (fixture.nativeElement as HTMLElement).querySelector(
      selector,
    ) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /** Escribe y dispara `change`: el buscador reacciona al cambio, no a cada tecla. */
  function escribirYCambiar(
    fixture: ComponentFixture<PadronDePersonasPage>,
    selector: string,
    valor: string,
  ): void {
    const campo = (fixture.nativeElement as HTMLElement).querySelector(
      selector,
    ) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function elegir(
    fixture: ComponentFixture<PadronDePersonasPage>,
    selector: string,
    valor: string,
  ): void {
    const campo = (fixture.nativeElement as HTMLElement).querySelector(
      selector,
    ) as HTMLSelectElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function enviar(fixture: ComponentFixture<PadronDePersonasPage>): void {
    const formulario = (fixture.nativeElement as HTMLElement).querySelector(
      'form[novalidate]',
    ) as HTMLFormElement;
    formulario.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }
});
