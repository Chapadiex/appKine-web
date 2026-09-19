import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { ConsultoriosPage } from './consultorios-page';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

/** Sede activa y ademas la del contexto de trabajo. Tiene razon social y telefono cargados. */
const CENTRO = {
  id: 3,
  organizationId: 1,
  name: 'Sede Centro',
  timezone: 'America/Argentina/Cordoba',
  slotMinutes: 30,
  legalName: 'Kine Centro SRL',
  taxId: '30-11111111-1',
  phone: '351 400 0000',
  active: true,
  estado: 'ACTIVO',
  version: 4,
};

/** Sede dada de baja: tiene que seguir en la tabla, con su motivo y su fecha. */
const NORTE = {
  id: 5,
  organizationId: 1,
  name: 'Sede Norte',
  timezone: 'America/Argentina/Cordoba',
  slotMinutes: 45,
  active: false,
  estado: 'INACTIVO',
  deletedAt: '2026-05-02T12:00:00Z',
  deactivationReason: 'Se mudo el centro a la sede Centro',
  version: 2,
};

const PAGINA = { content: [CENTRO, NORTE], page: 0, size: 20, totalElements: 2, totalPages: 1 };

/** Sede activa que NO es la del contexto de trabajo: darla de baja no expulsa a nadie. */
const SUR = {
  id: 7,
  organizationId: 1,
  name: 'Sede Sur',
  timezone: 'America/Argentina/Cordoba',
  slotMinutes: 30,
  active: true,
  estado: 'ACTIVO',
  version: 1,
};

const PAGINA_SUR = { content: [SUR], page: 0, size: 20, totalElements: 1, totalPages: 1 };

/**
 * Spec de la pantalla de sedes (M01, AKINE-02.01).
 *
 * <p>Se cubren las tres reglas que, si se rompen, <b>no dan error visible</b> y arruinan
 * datos o dejan al usuario en un callejon:
 *
 * <ol>
 *   <li>Que la sede dada de baja siga en pantalla como inactiva, con su motivo, en vez de
 *       desaparecer. La baja es logica justamente para eso.</li>
 *   <li>La semantica del `PATCH`: omitido no se toca, cadena vacia borra. Un formulario que
 *       manda siempre todos los campos borra datos institucionales que nadie pidio borrar, y
 *       responde `200`.</li>
 *   <li>Que dar de baja la sede del contexto activo lleve a elegir otra. Sin eso el usuario
 *       queda con un contexto que ya no admite operaciones y cada accion siguiente falla con
 *       un error que no explica nada.</li>
 * </ol>
 *
 * <p>El resto de los conflictos del backend comparte el mismo camino de traduccion, que ya
 * se ejercita en `consultorio-errors`; no se repite una vez por cada `409`.
 */
describe('ConsultoriosPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConsultoriosPage],
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

  it('muestra la sede dada de baja como inactiva, con su motivo y su fecha', async () => {
    const fixture = await montar();

    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(2);
    expect(texto(fixture)).toContain('Sede Norte');
    expect(texto(fixture)).toContain('Dada de baja');
    expect(texto(fixture)).toContain('Se mudo el centro a la sede Centro');
  });

  it('el PATCH manda solo lo que cambio: lo vaciado como cadena vacia y lo intacto ni aparece', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    // Se cambia el nombre, se BORRA el telefono vaciandolo y no se toca la razon social.
    escribir(fixture, '#editar-name', 'Sede Centro Nueva');
    escribir(fixture, '#editar-phone', '');

    enviar(fixture, 'form');

    const peticion = httpMock.expectOne(
      (candidata: HttpRequest<unknown>) => candidata.method === 'PATCH',
    );
    const cuerpo = peticion.request.body as Record<string, unknown>;

    expect(cuerpo).toEqual({ version: 4, name: 'Sede Centro Nueva', phone: '' });
    // La razon social ni siquiera viaja: mandarla -aunque fuera su valor actual- la pisaria
    // en cada guardado, y con ella cualquier correccion que otra persona hubiera hecho.
    expect('legalName' in cuerpo).toBe(false);
    expect('timezone' in cuerpo).toBe(false);

    peticion.flush({ ...CENTRO, name: 'Sede Centro Nueva', version: 5 });
    responderSedes(1);
    httpMock.expectOne(esListado(1)).flush(PAGINA);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('quedaron guardados');
  });

  it('una version vieja no pisa nada: relee la sede, avisa y deja el panel abierto', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-name', 'Sede Centro Nueva');
    enviar(fixture, 'form');

    httpMock
      .expectOne((candidata: HttpRequest<unknown>) => candidata.method === 'PATCH')
      .flush(
        {
          type: 'https://akine.app/problems/concurrent-modification',
          detail: 'La version enviada quedo vieja',
        },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    // Se relee la sede para tomar la version nueva como base: reintentar en silencio con
    // ella seria justamente pisar el cambio del otro, que es lo que el 409 evita.
    httpMock
      .expectOne('/api/v1/organizations/1/consultorios/3')
      .flush({ ...CENTRO, name: 'Sede Centro Sur', version: 9 });
    httpMock.expectOne(esListado(1)).flush(PAGINA);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Alguien mas edito esta sede');
    // El panel sigue abierto con lo escrito: cerrarlo obligaria a rehacer todo para leer el
    // mensaje, y la decision de insistir o no es del usuario.
    expect(texto(fixture)).toContain('Editar Sede Centro');
    expect(campo(fixture, '#editar-name')).toBe('Sede Centro Nueva');
  });

  it('dar de baja la sede del contexto activo lleva a elegir otra, con el motivo en la URL', async () => {
    const fixture = await montar();
    const router = TestBed.inject(Router);
    const navegar = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    abrir(fixture, 'Dar de baja');

    // Sin motivo no sale a la red: el backend lo exige y gastar un rechazo no aporta nada.
    enviar(fixture, 'form');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect(texto(fixture)).toContain('El motivo es obligatorio');

    escribir(fixture, '#baja-reason', 'Se unifica con la sede Norte');
    enviar(fixture, 'form');

    httpMock
      .expectOne('/api/v1/organizations/1/consultorios/3/deactivate')
      .flush({ ...CENTRO, active: false, estado: 'INACTIVO' });
    await fixture.whenStable();

    expect(navegar).toHaveBeenCalledWith(['/seleccionar-contexto'], {
      queryParams: { motivo: 'sede-inactiva' },
    });
  });

  /**
   * El unico test que ejercita el camino REAL de esta pantalla.
   *
   * <p>Todos los demas —y los de las otras dos pantallas con acciones— siembran el store de
   * permisos a mano antes de montar el componente, asi que la <b>carga</b> nunca se ejercitaba:
   * el defecto era invisible para la suite entera. `/organizacion/sedes` no lleva
   * `permissionGuard` a proposito, porque el `GET` solo exige ser miembro vigente, y hasta
   * AKINE-02.02 ese guard era el unico que pedia los permisos. Resultado: nadie los pedia,
   * `cargados()` quedaba en `false` y `*akinePermiso` escondia el alta y las acciones de cada
   * fila. Un administrador veia la tabla completa y ni un boton.
   *
   * <p>Por eso aca <b>no se siembra nada</b>: se monta con el contexto puesto y se afirma que
   * la pantalla misma sale a pedir los permisos y despues dibuja las acciones.
   */
  it('sin permissionGuard y sin sembrar el store, la pantalla pide los permisos y dibuja las acciones', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    const fixture = TestBed.createComponent(ConsultoriosPage);
    fixture.detectChanges();

    // Nadie llamo a `cargar()`: si esta peticion no existe, la pantalla nunca va a saber que
    // el usuario puede gestionar sedes y las acciones no aparecen jamas.
    httpMock
      .expectOne('/api/v1/me/permissions')
      .flush({ permissions: [PERMISO_CONSULTORIO_MANAGE] });

    httpMock.expectOne(esListado(1)).flush(PAGINA);
    responderSedes(1);
    await fixture.whenStable();
    fixture.detectChanges();

    // Y una sola peticion, no una por cada elemento con la directiva: el alta mas una fila
    // activa mas una inactiva son tres instancias de `*akinePermiso`.
    httpMock.expectNone('/api/v1/me/permissions');

    expect(texto(fixture)).toContain('Abrir una sede nueva');
    expect(botones(fixture)).toContain('Editar');
    expect(botones(fixture)).toContain('Dar de baja');
  });

  it('sin consultorio:manage la tabla se ve entera y no hay ni una accion', async () => {
    // El `GET` no exige el permiso a proposito: quien no administra sedes igual tiene que
    // poder verlas. Lo que no puede es tener botones que el backend le va a rechazar con un
    // 403, y menos el de dar de baja. Si `*akinePermiso` se cayera de la plantilla nadie se
    // enteraria hasta el primer rechazo.
    const fixture = await montarCon(PAGINA, []);

    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(2);
    expect(texto(fixture)).toContain('Sede Centro');
    expect(botones(fixture)).not.toContain('Editar');
    expect(botones(fixture)).not.toContain('Dar de baja');
    expect(texto(fixture)).not.toContain('Abrir una sede nueva');
  });

  it('un error de red ofrece reintentar, y la falta de contexto manda a elegirlo', async () => {
    // Son las dos salidas OPUESTAS del mismo estado de error: sin red lo unico util es volver
    // a pedir, y sin contexto reintentar falla siempre igual porque falta el encabezado de
    // tenant. Ofrecer el boton equivocado deja al usuario dandole a un reintento infinito.
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
    permisos.cargar().subscribe();
    httpMock
      .expectOne('/api/v1/me/permissions')
      .flush({ permissions: [PERMISO_CONSULTORIO_MANAGE] });

    const fixture = TestBed.createComponent(ConsultoriosPage);
    fixture.detectChanges();

    httpMock
      .expectOne(esListado(1))
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    responderSedes(1);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('No se pudo contactar al servidor');
    expect(botones(fixture)).toContain('Reintentar');

    abrir(fixture, 'Reintentar');
    httpMock
      .expectOne(esListado(1))
      .flush(
        { type: 'https://akine.app/problems/missing-tenant-context', detail: 'Sin contexto' },
        { status: 403, statusText: 'Forbidden' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Todavia no elegiste un contexto');
    // Ya no se ofrece reintentar: la salida es cambiar de contexto.
    expect(botones(fixture)).not.toContain('Reintentar');
    expect(fixture.nativeElement.querySelector('a[href="/seleccionar-contexto"]')).not.toBeNull();
  });

  it('el filtro de dadas de baja sin resultados dice eso, y no "no hay sedes"', async () => {
    // Una lista vacia no es un error, y el texto tiene que decir cual de los dos vacios es:
    // "no hay sedes que mostrar" en el filtro de bajas se lee como que la organizacion se
    // quedo sin sedes.
    const fixture = await montar();

    elegir(fixture, '#filtro-estado', 'INACTIVO');
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.url === '/api/v1/organizations/1/consultorios' &&
          peticion.params.get('estado') === 'INACTIVO',
      )
      .flush({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('No hay sedes dadas de baja');
  });

  it('un email mal formado bloquea el PATCH en vez de gastar un rechazo del backend', async () => {
    // El envio tiene que quedar BLOQUEADO: si saliera, el backend responderia 400 y el usuario
    // veria un error generico en vez del campo marcado. Por eso se afirma que no hay peticion,
    // no solo que aparece el texto.
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-email', 'esto-no-es-un-mail');
    enviar(fixture, 'form');

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'PATCH');
    expect(texto(fixture)).toContain('no tiene una forma valida');

    // El nombre vacio tambien bloquea, y por una razon distinta: no es un dato borrable, asi
    // que viajaria como un renombre a cadena vacia y dejaria la sede sin nombre en la tabla.
    escribir(fixture, '#editar-email', '');
    escribir(fixture, '#editar-name', '');
    enviar(fixture, 'form');

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'PATCH');
    expect(texto(fixture)).toContain('La sede necesita un nombre');

    // Y vaciar el email si vale: la cadena vacia es la forma contractual de borrar el dato.
    escribir(fixture, '#editar-name', 'Sede Centro');
    enviar(fixture, 'form');

    const peticion = httpMock.expectOne(
      (candidata: HttpRequest<unknown>) => candidata.method === 'PATCH',
    );
    expect(peticion.request.body).toEqual({ version: 4 });
    peticion.flush(CENTRO);
    responderSedes(1);
    httpMock.expectOne(esListado(1)).flush(PAGINA);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('dar de baja la unica sede activa se explica en el panel y no cambia de contexto', async () => {
    // Un "conflicto" a secas aca no dice nada: el usuario tiene que entender que la
    // organizacion se quedaria sin ningun contexto donde entrar, y que la salida es dar de
    // alta la otra sede primero. Y sobre todo: NO se lo puede llevar al selector, porque la
    // baja no ocurrio.
    const fixture = await montar();
    const router = TestBed.inject(Router);
    const navegar = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    abrir(fixture, 'Dar de baja');
    escribir(fixture, '#baja-reason', 'Se cierra el centro');
    enviar(fixture, 'form');

    httpMock.expectOne('/api/v1/organizations/1/consultorios/3/deactivate').flush(
      {
        type: 'https://akine.app/problems/last-consultorio-required',
        detail: 'Es la ultima sede activa',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('unica sede activa de la organizacion');
    expect(navegar).not.toHaveBeenCalled();
    // El panel sigue abierto: el motivo escrito no se pierde por un rechazo del servidor.
    expect(fixture.nativeElement.querySelector('#baja-reason')).not.toBeNull();
  });

  it('dar de baja una sede que no es la del contexto deja al usuario donde estaba', async () => {
    // El camino contrario al que ya se cubre: si esta rama navegara igual, cualquier baja
    // rutinaria expulsaria al usuario al selector de contexto sin motivo.
    const fixture = await montarCon(PAGINA_SUR);
    const router = TestBed.inject(Router);
    const navegar = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    abrir(fixture, 'Dar de baja');
    escribir(fixture, '#baja-reason', 'Se unifica con la sede Centro');
    enviar(fixture, 'form');

    httpMock
      .expectOne('/api/v1/organizations/1/consultorios/7/deactivate')
      .flush({ ...SUR, active: false, estado: 'INACTIVO' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(navegar).not.toHaveBeenCalled();
    responderSedes(1);
    httpMock.expectOne(esListado(1)).flush(PAGINA_SUR);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Sigue en el listado, con el motivo');
  });

  it('si la navegacion posterior a la baja falla, el fallo no queda en silencio', async () => {
    // La baja SI ocurrio y el contexto quedo inservible: si nadie avisa, el usuario sigue en
    // esta pantalla creyendo que puede operar y cada accion siguiente falla sin explicacion.
    const fixture = await montar();
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockRejectedValue(new Error('ruta rota'));
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    abrir(fixture, 'Dar de baja');
    escribir(fixture, '#baja-reason', 'Se cierra el centro');
    enviar(fixture, 'form');

    httpMock
      .expectOne('/api/v1/organizations/1/consultorios/3/deactivate')
      .flush({ ...CENTRO, active: false, estado: 'INACTIVO' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(consola).toHaveBeenCalled();
    consola.mockRestore();
  });

  it('si la relectura posterior al 409 tambien falla, el mensaje queda y el panel no se cierra', async () => {
    // Caso encadenado: el servidor conflictua y ademas se cae. Si la relectura fallida cerrara
    // el panel o tirara la excepcion, el usuario perderia lo escrito ADEMAS del cambio.
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-name', 'Sede Centro Nueva');
    enviar(fixture, 'form');

    httpMock
      .expectOne((candidata: HttpRequest<unknown>) => candidata.method === 'PATCH')
      .flush(
        {
          type: 'https://akine.app/problems/concurrent-modification',
          detail: 'La version enviada quedo vieja',
        },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    httpMock
      .expectOne('/api/v1/organizations/1/consultorios/3')
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Alguien mas edito esta sede');
    expect(campo(fixture, '#editar-name')).toBe('Sede Centro Nueva');
  });

  /** Monta la pantalla con contexto sobre la sede 3, permiso de gestion y las dos sedes. */
  async function montar() {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock
      .expectOne('/api/v1/me/permissions')
      .flush({ permissions: [PERMISO_CONSULTORIO_MANAGE] });

    const fixture = TestBed.createComponent(ConsultoriosPage);
    fixture.detectChanges();

    httpMock.expectOne(esListado(1)).flush(PAGINA);
    responderSedes(1);
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  /** Igual que {@link montar}, con la pagina y los permisos que el caso necesita. */
  async function montarCon(
    pagina: Record<string, unknown>,
    otorgados: string[] = [PERMISO_CONSULTORIO_MANAGE],
  ) {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne('/api/v1/me/permissions').flush({ permissions: otorgados });

    const fixture = TestBed.createComponent(ConsultoriosPage);
    fixture.detectChanges();

    httpMock.expectOne(esListado(1)).flush(pagina);
    responderSedes(1);
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  /**
   * Responde la carga de `SedesDelContexto`, que sale con `estado=ACTIVO`.
   *
   * <p>Es una peticion aparte de la del listado -la pantalla filtra por estado y ese servicio
   * no- y sin responderla `verify` falla.
   */
  function responderSedes(orgId: number): void {
    const pendientes = httpMock.match(
      (peticion: HttpRequest<unknown>) =>
        peticion.urlWithParams ===
        `/api/v1/organizations/${orgId}/consultorios?estado=ACTIVO&page=0&size=100`,
    );
    for (const peticion of pendientes) {
      peticion.flush({ content: [CENTRO] });
    }
  }

  function esListado(orgId: number) {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'GET' &&
      peticion.url === `/api/v1/organizations/${orgId}/consultorios` &&
      peticion.params.get('size') === '20';
  }
});

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
}

/** Etiquetas de los botones dibujados. Sirve para afirmar que una accion existe de verdad. */
function botones(fixture: { nativeElement: HTMLElement }): string[] {
  return [...fixture.nativeElement.querySelectorAll('button')].map((boton) =>
    (boton.textContent ?? '').trim(),
  );
}

function abrir(fixture: { nativeElement: HTMLElement; detectChanges(): void }, etiqueta: string) {
  const boton = [...fixture.nativeElement.querySelectorAll('button')].find(
    (candidato) => (candidato.textContent ?? '').trim() === etiqueta,
  );
  boton?.click();
  fixture.detectChanges();
}

function elegir(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: string,
) {
  const campo = fixture.nativeElement.querySelector<HTMLSelectElement>(selector);
  if (campo === null) {
    throw new Error(`No existe el selector ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

function escribir(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: string,
) {
  const campo = fixture.nativeElement.querySelector<HTMLInputElement>(selector);
  if (campo === null) {
    throw new Error(`No existe el campo ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function enviar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string) {
  const formulario = fixture.nativeElement.querySelector<HTMLFormElement>(selector);
  formulario?.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}

function campo(fixture: { nativeElement: HTMLElement }, selector: string): string {
  return fixture.nativeElement.querySelector<HTMLInputElement>(selector)?.value ?? '';
}
