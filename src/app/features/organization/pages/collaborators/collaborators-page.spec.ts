import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
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

  /** Monta la pantalla con contexto, permisos de gestion y una pagina de dos vinculos. */
  async function montar() {
    tenantContext.select({ organizationId: 1, organizationName: 'Belgrano', consultorioId: 3 });

    permisos.cargar().subscribe();
    httpMock
      .expectOne('/api/v1/me/permissions')
      .flush({ permissions: [PERMISO_COLABORADOR_MANAGE] });

    const fixture = TestBed.createComponent(CollaboratorsPage);
    fixture.detectChanges();

    httpMock.expectOne(esListado(1)).flush(PAGINA);
    responderSedes(1);
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
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
