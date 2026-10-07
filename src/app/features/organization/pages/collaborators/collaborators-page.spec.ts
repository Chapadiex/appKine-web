import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CollaboratorsPage } from './collaborators-page';
import { PERMISO_COLABORADOR_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const ACTIVA = {
  id: 10,
  organizationId: 1,
  consultorioId: 3,
  accountId: 100,
  roleCode: 'PROFESIONAL',
  estado: 'ACTIVA',
  founder: false,
  validFrom: '2026-01-10T09:00:00Z',
  active: true,
};

const REVOCADA = {
  id: 11,
  organizationId: 1,
  accountId: 101,
  roleCode: 'ADMINISTRATIVO',
  estado: 'REVOCADA',
  founder: false,
  validFrom: '2025-06-01T09:00:00Z',
  active: false,
  revokedByAccountId: 1,
  revokedReason: 'Dejo el centro',
};

const PAGINA = { content: [ACTIVA, REVOCADA], page: 0, size: 20, totalElements: 2, totalPages: 1 };

/**
 * Spec de la pantalla de colaboradores (M05, AKINE-01.03).
 *
 * <p>Se cubren las dos reglas que, si se rompen, no dan error visible y arruinan datos: que
 * los revocados sigan en pantalla como revocados en vez de desaparecer, y la traduccion del
 * alcance a `changeScope`. Un formulario que manda siempre `consultorioId` mueve de sede a
 * gente que solo iba a cambiar de rol, y nadie se entera hasta que alguien no ve su agenda.
 *
 * <p>El resto de las mutaciones -suspender, reactivar, revocar, grants- comparte el mismo
 * camino de envio (`ejecutar`), asi que se ejercita una sola vez y no cinco.
 */
describe('CollaboratorsPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CollaboratorsPage],
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

  it('lista incluye los revocados y los distingue por estado, no por ausencia', async () => {
    const fixture = await montar();

    // La fila del revocado sigue en la tabla, con quien lo revoco y por que: la baja es
    // logica porque los historicos que lo referencian tienen que seguir siendo legibles.
    expect(texto(fixture)).toContain('Revocada');
    expect(texto(fixture)).toContain('Dejo el centro');
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('cambiar solo el rol NO manda changeScope ni consultorioId', async () => {
    const fixture = await montar();

    abrirPanel(fixture, 'Cambiar rol o alcance');
    escribir(fixture, '#edicion-reason', 'Ascenso a coordinador');
    elegir(fixture, '#edicion-roleCode', 'CONSULTORIO_ADMIN');
    enviar(fixture, 'form');

    const cuerpo = esperarPatch();

    // El defecto del contrato es no tocar la sede. Mandar `consultorioId` aca -aunque fuera
    // el valor actual- lo convertiria en un cambio de alcance auditado que nadie pidio.
    expect(cuerpo).toEqual({ reason: 'Ascenso a coordinador', roleCode: 'CONSULTORIO_ADMIN' });
  });

  it('ampliar a toda la organizacion manda changeScope sin consultorioId', async () => {
    const fixture = await montar();

    abrirPanel(fixture, 'Cambiar rol o alcance');
    escribir(fixture, '#edicion-reason', 'Pasa a coordinar las dos sedes');
    marcar(fixture, '#edicion-alcance-organizacion');
    enviar(fixture, 'form');

    const cuerpo = esperarPatch();

    // `changeScope: true` sin `consultorioId` es el null del contrato: alcance de toda la
    // organizacion, que es un valor y no la ausencia de uno.
    expect(cuerpo['changeScope']).toBe(true);
    expect('consultorioId' in cuerpo).toBe(false);
  });

  it('cambiar de contexto cierra el panel abierto y relee contra la organizacion nueva', async () => {
    const fixture = await montar();
    abrirPanel(fixture, 'Suspender');
    expect(texto(fixture)).toContain('Suspender a la cuenta 100');

    tenantContext.select({ organizationId: 2, organizationName: 'Caballito', consultorioId: 9 });
    fixture.detectChanges();

    // El pedido sale contra la organizacion nueva, y el formulario a medio llenar -que
    // apuntaba a un membershipId del tenant anterior- ya no esta.
    httpMock.expectOne(esListado(2)).flush({ ...PAGINA, content: [], totalElements: 0 });
    responderSedes(2);

    // Los permisos de la organizacion anterior quedaron invalidados por epoca, asi que la
    // directiva pide los de la nueva. La pantalla no tiene que acordarse de nada.
    httpMock
      .expectOne('/api/v1/me/permissions')
      .flush({ permissions: [PERMISO_COLABORADOR_MANAGE] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).not.toContain('Suspender a la cuenta 100');
    expect(texto(fixture)).toContain('todavia no tiene colaboradores');
  });

  it('suspender sin motivo no sale a la red; con motivo, relee el listado', async () => {
    const fixture = await montar();
    abrirPanel(fixture, 'Suspender');

    enviar(fixture, 'form');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect(texto(fixture)).toContain('El motivo es obligatorio');

    escribir(fixture, '#panel-motivo', 'Licencia medica prolongada');
    enviar(fixture, 'form');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.url === '/api/v1/organizations/1/memberships/10/suspend',
      )
      .flush({ ...ACTIVA, estado: 'SUSPENDIDA' });

    // Se relee en vez de parchear la fila: el backend pudo cambiar mas de lo que se pidio.
    httpMock.expectOne(esListado(1)).flush(PAGINA);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Colaborador suspendido');
  });

  it('un conflicto del backend se muestra con su mensaje y deja el panel abierto', async () => {
    const fixture = await montar();
    abrirPanel(fixture, 'Revocar');
    responderImpacto({ tipo: null, count: 0, desde: null });
    escribir(fixture, '#panel-motivo', 'Fin de contrato');
    enviar(fixture, 'form');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.url === '/api/v1/organizations/1/memberships/10/revoke',
      )
      .flush(
        {
          type: 'https://akine.app/problems/last-admin-required',
          detail: 'No podes revocar al ultimo administrador',
        },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    // El panel sigue abierto con el motivo escrito: cerrarlo obligaria a rehacer todo para
    // leer el mensaje, y el conflicto puede resolverse cambiando de fila, no de motivo.
    expect(texto(fixture)).toContain('No podes revocar al ultimo administrador');
    expect(texto(fixture)).toContain('Revocar el vinculo de la cuenta 100');
  });

  it('revocar muestra antes de confirmar lo que queda pendiente, sin bloquear el envio', async () => {
    const fixture = await montar();
    abrirPanel(fixture, 'Revocar');
    expect(texto(fixture)).toContain('Consultando que queda pendiente');

    responderImpacto({ tipo: 'turnos', count: 4, desde: '2026-10-20T13:00:00Z' });
    await fixture.whenStable();
    fixture.detectChanges();

    // La cantidad y el tipo salen tal cual del backend, y el aviso declara su limite: una sola
    // fuente, nunca la suma de turnos y bloques.
    expect(texto(fixture)).toContain('Quedan 4 turnos a su nombre, el primero el');
    expect(texto(fixture)).toContain('una sola fuente');

    // RN-M05-004: el impacto informa, no impide. La revocacion sale igual.
    escribir(fixture, '#panel-motivo', 'Renuncia');
    enviar(fixture, 'form');
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.url === '/api/v1/organizations/1/memberships/10/revoke',
      )
      .flush({ ...ACTIVA, estado: 'REVOCADA' });
    httpMock.expectOne(esListado(1)).flush(PAGINA);
  });

  it('si la sonda de impacto falla lo dice y deja revocar igual', async () => {
    const fixture = await montar();
    abrirPanel(fixture, 'Revocar');

    httpMock
      .expectOne('/api/v1/organizations/1/memberships/10/desvinculacion-impacto')
      .flush({ type: 'about:blank' }, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('No pudimos consultar que queda pendiente');
    expect(texto(fixture)).toContain('Revocar el vinculo de la cuenta 100');
  });

  it('los permisos adicionales se otorgan y se dan de baja con el motivo en la URL', async () => {
    const fixture = await montar();
    abrirPanel(fixture, 'Permisos adicionales');

    httpMock
      .expectOne('/api/v1/organizations/1/memberships/10/grants')
      .flush([{ id: 5, membershipId: 10, permissionCode: 'auditoria:read', active: true }]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('auditoria:read');

    // Dar de baja tambien exige motivo, y viaja como query param: un DELETE con cuerpo no
    // esta garantizado de punta a punta por proxies y clientes HTTP.
    escribir(fixture, '#grant-reason', 'Ya no audita');
    const baja = [...fixture.nativeElement.querySelectorAll('button')].find((candidato) =>
      (candidato.textContent ?? '').includes('Dar de baja'),
    );
    baja?.click();
    fixture.detectChanges();

    const peticion = httpMock.expectOne(
      (candidata: HttpRequest<unknown>) => candidata.method === 'DELETE',
    );
    expect(peticion.request.urlWithParams).toContain('reason=Ya%20no%20audita');
    peticion.flush(null, { status: 204, statusText: 'No Content' });

    httpMock.expectOne('/api/v1/organizations/1/memberships/10/grants').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('no tiene permisos adicionales');
  });

  it(
    'no tiene violaciones de axe con el panel de suspension abierto',
    async () => {
      const fixture = await montar();
      abrirPanel(fixture, 'Suspender');

      // Se audita el panel y no la pantalla entera: la tabla de acciones completa satura
      // axe sobre jsdom -mas de 20 s, el margen de TIMEOUT_AXE- sin agregar nada, porque lo
      // que hay que verificar es la relacion label/campo/error del formulario, que es donde
      // un `aria-describedby` colgado no se ve en pantalla.
      const panel = (fixture.nativeElement as HTMLElement).querySelector('.fila-panel');
      if (panel === null) {
        throw new Error('No se abrio el panel de suspension');
      }
      await esperarSinViolaciones(panel as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------
  // Estados de error del listado
  //
  // Los dos 403 llegan con el mismo status y necesitan salidas OPUESTAS: uno se arregla
  // eligiendo contexto y el otro pidiendo el permiso. Ofrecer "Reintentar" a quien no tiene
  // contexto lo deja repitiendo un pedido que va a fallar siempre.
  // -------------------------------------------------------------------------------------

  it('un 403 por falta de permiso ofrece reintentar y no manda a elegir contexto', async () => {
    const fixture = await montarCon((pedido) =>
      pedido.flush(
        {
          type: 'https://akine.app/problems/forbidden',
          detail: 'No tenes permiso para ver los colaboradores',
        },
        { status: 403, statusText: 'Forbidden' },
      ),
    );

    expect(texto(fixture)).toContain('No tenes permiso para ver los colaboradores');
    expect(rotulos(fixture)).toContain('Reintentar');
    expect(fixture.nativeElement.querySelector('a[href="/seleccionar-contexto"]')).toBeNull();
  });

  it('un 403 por falta de contexto manda a elegir contexto y no ofrece reintentar', async () => {
    const fixture = await montarCon((pedido) =>
      pedido.flush(
        { type: 'https://akine.app/problems/missing-tenant-context', detail: 'sin contexto' },
        { status: 403, statusText: 'Forbidden' },
      ),
    );

    expect(rotulos(fixture)).not.toContain('Reintentar');
    expect(fixture.nativeElement.querySelector('a[href="/seleccionar-contexto"]')).not.toBeNull();
  });

  // -------------------------------------------------------------------------------------
  // Que acciones ofrece cada fila
  // -------------------------------------------------------------------------------------

  it('una fila revocada no ofrece ninguna accion, y una suspendida ofrece reactivar', async () => {
    const fixture = await montarCon((pedido) =>
      pedido.flush({
        ...PAGINA,
        content: [{ ...ACTIVA, id: 12, accountId: 102, estado: 'SUSPENDIDA' }, REVOCADA],
      }),
    );

    const ofrecidos = rotulos(fixture);
    // Revocar es terminal: ofrecer "Revocar" sobre una fila ya revocada es un 409 asegurado, y
    // "Suspender" sobre una suspendida tambien.
    expect(ofrecidos).toContain('Reactivar');
    expect(ofrecidos).not.toContain('Suspender');
    // La suspendida sigue admitiendo revocar y permisos; la revocada no aporta ninguna.
    expect(ofrecidos.filter((rotulo) => rotulo === 'Revocar').length).toBe(1);
  });

  it('sin colaborador:manage se ve la tabla completa y ningun boton de accion', async () => {
    const fixture = await montarCon((pedido) => pedido.flush(PAGINA), []);

    // Ocultar no autoriza —el backend rechaza igual— pero mostrar acciones que siempre
    // terminan en 403 convierte la pantalla en una trampa.
    expect(texto(fixture)).toContain('Revocada');
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(2);
    expect(rotulos(fixture)).not.toContain('Cambiar rol o alcance');
    expect(rotulos(fixture)).not.toContain('Revocar');
  });

  // -------------------------------------------------------------------------------------
  // Validaciones que bloquean el envio
  // -------------------------------------------------------------------------------------

  it('cambiar de rol sin motivo no sale a la red', async () => {
    const fixture = await montar();

    abrirPanel(fixture, 'Cambiar rol o alcance');
    elegir(fixture, '#edicion-roleCode', 'CONSULTORIO_ADMIN');
    enviar(fixture, 'form');

    // El motivo es lo que responde, seis meses despues, por que esta persona cambio de rol:
    // dejar salir el PATCH sin el gasta un 400 sobre un campo que el usuario tiene delante.
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'PATCH');
    expect(texto(fixture)).toContain('Escribi por que se hace este cambio');
  });

  it('otorgar un permiso adicional sin elegir cual no sale a la red', async () => {
    const fixture = await montar();
    abrirPanel(fixture, 'Permisos adicionales');
    responderGrants([]);
    await fixture.whenStable();
    fixture.detectChanges();

    escribir(fixture, '#grant-reason', 'Necesita auditar');
    enviar(fixture, 'form');

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect(texto(fixture)).toContain('Elegi el permiso que queres otorgar');
  });

  it('dar de baja un permiso sin escribir el motivo no sale a la red y lo avisa', async () => {
    const fixture = await montar();
    abrirPanel(fixture, 'Permisos adicionales');
    responderGrants([{ id: 5, membershipId: 10, permissionCode: 'auditoria:read', active: true }]);
    await fixture.whenStable();
    fixture.detectChanges();

    apretar(fixture, 'Dar de baja');

    // El motivo viaja en la query y el backend lo exige: sin este corte el usuario se come un
    // 400 por un campo que esta viendo vacio en pantalla.
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'DELETE');
    expect(texto(fixture)).toContain('Escribi el motivo antes de dar de baja el permiso');
  });

  // -------------------------------------------------------------------------------------
  // Traduccion del alcance y de la fecha
  // -------------------------------------------------------------------------------------

  it('mover a una sede concreta manda changeScope con el consultorioId como numero', async () => {
    const fixture = await montar();

    abrirPanel(fixture, 'Cambiar rol o alcance');
    escribir(fixture, '#edicion-reason', 'Pasa a la sede Centro');
    marcar(fixture, '#edicion-alcance-sede');
    elegir(fixture, '#edicion-consultorioId', '3');
    enviar(fixture, 'form');

    const cuerpo = esperarPatch();

    // El `select` entrega texto: un `consultorioId: "3"` es un 400 de validacion del contrato.
    expect(cuerpo).toEqual({
      reason: 'Pasa a la sede Centro',
      // El rol viaja porque el formulario arranca en el que ya tiene, y mandar el mismo valor
      // el backend lo acepta sin cambiar nada.
      roleCode: 'PROFESIONAL',
      changeScope: true,
      consultorioId: 3,
    });
  });

  it('un permiso con fecha de vencimiento rige hasta el final de ese dia', async () => {
    const fixture = await montar();
    abrirPanel(fixture, 'Permisos adicionales');
    responderGrants([]);
    await fixture.whenStable();
    fixture.detectChanges();

    elegir(fixture, '#grant-permissionCode', PERMISO_COLABORADOR_MANAGE);
    escribir(fixture, '#grant-reason', 'Cubre licencia');
    escribir(fixture, '#grant-validUntil', '2026-10-31');
    enviar(fixture, 'form');

    const alta = httpMock.expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    // El input `date` entrega 'YYYY-MM-DD'. Mandarlo como medianoche dejaria el permiso vencido
    // un dia antes de lo que el usuario eligio.
    expect((alta.request.body as Record<string, unknown>)['validUntil']).toBe(
      '2026-10-31T23:59:59.000Z',
    );
    alta.flush({ id: 6, membershipId: 10, permissionCode: PERMISO_COLABORADOR_MANAGE });
    responderGrants([]);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  // -------------------------------------------------------------------------------------
  // Errores del backend en las mutaciones
  // -------------------------------------------------------------------------------------

  it('un 429 al suspender dice cuantos segundos esperar y deja el panel abierto', async () => {
    const fixture = await montar();
    abrirPanel(fixture, 'Suspender');
    escribir(fixture, '#panel-motivo', 'Licencia medica');
    enviar(fixture, 'form');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.url === '/api/v1/organizations/1/memberships/10/suspend',
      )
      .flush(
        { type: 'https://akine.app/problems/rate-limited', detail: 'demasiados' },
        { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '30' } },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    // El plazo sale del header: inventarlo manda al usuario a comerse otro 429 auditado.
    expect(texto(fixture)).toContain('Espera 30 segundos');
    expect(texto(fixture)).toContain('Suspender a la cuenta 100');
  });

  it('un 409 al otorgar un permiso se muestra con el mensaje del backend', async () => {
    const fixture = await montar();
    abrirPanel(fixture, 'Permisos adicionales');
    responderGrants([]);
    await fixture.whenStable();
    fixture.detectChanges();

    elegir(fixture, '#grant-permissionCode', PERMISO_COLABORADOR_MANAGE);
    escribir(fixture, '#grant-reason', 'Cubre licencia');
    enviar(fixture, 'form');

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'POST')
      .flush(
        {
          type: 'https://akine.app/problems/conflict',
          detail: 'Ese permiso ya esta vigente sobre el vinculo',
        },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    // Gana el detail del backend: "ya esta vigente" y "no existe el permiso" son dos cosas
    // distintas que el frontend no puede redactar mejor que quien las decidio.
    expect(texto(fixture)).toContain('Ese permiso ya esta vigente sobre el vinculo');
  });

  /** Monta la pantalla con contexto, permisos de gestion y una pagina de dos vinculos. */
  async function montar() {
    return montarCon((pedido) => pedido.flush(PAGINA));
  }

  /** Monta dejando que cada caso decida como responde el listado y que permisos tiene quien mira. */
  async function montarCon(
    responder: (pedido: TestRequest) => void,
    otorgados: readonly string[] = [PERMISO_COLABORADOR_MANAGE],
  ) {
    tenantContext.select({ organizationId: 1, organizationName: 'Belgrano', consultorioId: 3 });

    permisos.cargar().subscribe();
    httpMock.expectOne('/api/v1/me/permissions').flush({ permissions: otorgados });

    const fixture = TestBed.createComponent(CollaboratorsPage);
    fixture.detectChanges();

    responder(httpMock.expectOne(esListado(1)));
    responderSedes(1);
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  function responderImpacto(impacto: object): void {
    httpMock
      .expectOne('/api/v1/organizations/1/memberships/10/desvinculacion-impacto')
      .flush(impacto);
  }

  function responderGrants(grants: object[]): void {
    httpMock.expectOne('/api/v1/organizations/1/memberships/10/grants').flush(grants);
  }

  /** El selector de sede se puebla con una peticion aparte; sin responderla `verify` falla. */
  function responderSedes(orgId: number): void {
    const pendientes = httpMock.match(
      (peticion: HttpRequest<unknown>) =>
        peticion.url === `/api/v1/organizations/${orgId}/consultorios`,
    );
    for (const peticion of pendientes) {
      peticion.flush({ content: [{ id: 3, name: 'Sede Centro', organizationId: orgId }] });
    }
  }

  function esperarPatch(): Record<string, unknown> {
    const peticion = httpMock.expectOne(
      (candidata: HttpRequest<unknown>) => candidata.method === 'PATCH',
    );
    peticion.flush(ACTIVA);
    httpMock.expectOne(esListado(1)).flush(PAGINA);
    return peticion.request.body as Record<string, unknown>;
  }
});

function esListado(orgId: number) {
  return (peticion: HttpRequest<unknown>) =>
    peticion.method === 'GET' && peticion.url === `/api/v1/organizations/${orgId}/memberships`;
}

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
}

/** Los rotulos de todos los botones: sirve para afirmar que una accion NO se ofrece. */
function rotulos(fixture: { nativeElement: HTMLElement }): string[] {
  return [...fixture.nativeElement.querySelectorAll('button')].map((boton) =>
    (boton.textContent ?? '').trim(),
  );
}

/** Aprieta el boton cuyo rotulo coincide exacto; `abrirPanel` usa coincidencia parcial. */
function apretar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, rotulo: string) {
  const boton = [...fixture.nativeElement.querySelectorAll('button')].find(
    (candidato) => (candidato.textContent ?? '').trim() === rotulo,
  );
  if (boton === undefined) {
    throw new Error(`No existe el boton ${rotulo}`);
  }
  boton.click();
  fixture.detectChanges();
}

function abrirPanel(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  etiqueta: string,
) {
  const boton = [...fixture.nativeElement.querySelectorAll('button')].find((candidato) =>
    (candidato.textContent ?? '').includes(etiqueta),
  );
  boton?.click();
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

function elegir(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: string,
) {
  const campo = fixture.nativeElement.querySelector<HTMLSelectElement>(selector);
  if (campo === null) {
    throw new Error(`No existe el select ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

function marcar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string) {
  const radio = fixture.nativeElement.querySelector<HTMLInputElement>(selector);
  if (radio === null) {
    throw new Error(`No existe el radio ${selector}`);
  }
  radio.click();
  fixture.detectChanges();
}

function enviar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string) {
  const formulario = fixture.nativeElement.querySelector<HTMLFormElement>(selector);
  formulario?.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}
