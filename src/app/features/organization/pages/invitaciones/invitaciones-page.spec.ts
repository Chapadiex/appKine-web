import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { InvitacionesPage } from './invitaciones-page';
import { PERMISO_COLABORADOR_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const LISTADO = '/api/v1/organizations/1/colaborador-invitaciones';

/** Pendiente comun: el enlace todavia sirve. */
const PENDIENTE = {
  id: 7,
  organizationId: 1,
  consultorioId: 3,
  email: 'invitada@ejemplo.test',
  roleCode: 'PROFESIONAL',
  estado: 'PENDIENTE',
  vencida: false,
  expiraEn: '2099-01-01T00:00:00Z',
  invitadaPorAccountId: 9,
  version: 0,
  createdAt: '2026-08-20T12:00:00Z',
};

/**
 * El caso que da nombre a la mitad de la pantalla: PENDIENTE y con el enlace vencido.
 *
 * <p>La invitacion no cambio de estado —expirar no es una decision de nadie— y sin embargo su
 * enlace ya no sirve. Si la fila no lo dice, el administrador la ve igual que una pendiente
 * comun y no entiende por que la persona "no puede entrar".
 */
const VENCIDA = {
  ...PENDIENTE,
  id: 8,
  email: 'vencida@ejemplo.test',
  vencida: true,
  expiraEn: '2026-08-01T00:00:00Z',
};

/**
 * Spec de la pantalla de invitaciones del administrador (M05, AKINE-02.03).
 *
 * <p>Cubre las tres cosas que, si se rompen, <b>no dan ningun error visible</b>:
 *
 * <ol>
 *   <li>Que una invitacion vencida se distinga de una pendiente comun y diga cual es la salida.
 *       Las dos figuran PENDIENTE en el contrato.</li>
 *   <li>Que la pantalla avise, <b>antes</b> de invitar, que emitir no ocupa lugar del plan y
 *       aceptar si. El 409 al aceptar llega despues y sin contexto.</li>
 *   <li>Que el token no aparezca nunca. Tenerlo en pantalla equivale a poder aceptar la
 *       invitacion de otra persona.</li>
 * </ol>
 */
describe('InvitacionesPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InvitacionesPage],
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

  it('una invitacion vencida se distingue de una pendiente y dice que hay que reenviarla', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    expect(anfitrion.querySelectorAll('tbody tr').length).toBe(2);
    expect(anfitrion.textContent).toContain('Pendiente, con el enlace vencido');
    expect(anfitrion.textContent).toContain('Reenviala para mandarle uno nuevo');
    // Y la que no vencio dice hasta cuando sirve, en vez de callarse.
    expect(anfitrion.textContent).toContain('El enlace vence el');

    // El token no aparece por ningun lado: el contrato no lo devuelve, y la pantalla tampoco lo
    // inventa. Tenerlo en pantalla equivale a poder aceptar la invitacion de otro.
    expect(anfitrion.textContent).not.toContain('token');
  });

  it('avisa antes de invitar que emitir no ocupa lugar del plan y aceptar si', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    // Va arriba, no escondido: sin esto alguien invita a cinco personas contando lugares que no
    // reservo, y el 409 llega meses despues.
    expect(anfitrion.textContent).toContain('invitar no ocupa un lugar de tu plan y aceptar si');
    // Y ofrece el camino mas corto para quien ya tiene cuenta.
    expect(anfitrion.querySelector('a[href="/organizacion/colaboradores/nuevo"]')).not.toBeNull();
  });

  it('el alta manda el alcance de la sede activa y vuelve al filtro de pendientes', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    abrir(fixture, 'Invitar a alguien');
    escribir(anfitrion, '#invitacion-email', 'nueva@ejemplo.test');
    fixture.detectChanges();
    enviar(fixture);

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === LISTADO,
    );
    // La sede sale del contexto y no de un campo: un id de sede elegido por el cliente seria un
    // segundo lugar desde donde decidir el alcance.
    expect(alta.request.body).toEqual({
      email: 'nueva@ejemplo.test',
      roleCode: 'PROFESIONAL',
      consultorioId: 3,
    });

    alta.flush({ ...PENDIENTE, id: 9 });
    httpMock.expectOne(esListado()).flush([PENDIENTE, VENCIDA]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('el vinculo se crea cuando acepta, no ahora');
  });

  it('el duplicado aterriza en el campo del email y no al pie', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    abrir(fixture, 'Invitar a alguien');
    escribir(anfitrion, '#invitacion-email', 'invitada@ejemplo.test');
    fixture.detectChanges();
    enviar(fixture);

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === LISTADO,
      )
      .flush(
        {
          type: 'https://akine.app/problems/invitacion-pendiente-duplicada',
          detail: 'ya hay una',
        },
        { status: 409, statusText: 'Conflict' },
      );
    fixture.detectChanges();

    expect(anfitrion.querySelector('#invitacion-email')?.getAttribute('aria-invalid')).toBe('true');
    // Y el mensaje dice cual es la salida: reenviar la que ya esta, no emitir otra.
    expect(anfitrion.textContent).toContain('Reenviar');
  });

  it('reenviar avisa que el enlace anterior dejo de servir', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    abrir(fixture, 'Reenviar');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'POST' && peticion.url === `${LISTADO}/7/resend`,
      )
      .flush(PENDIENTE);
    httpMock.expectOne(esListado()).flush([PENDIENTE, VENCIDA]);
    await fixture.whenStable();
    fixture.detectChanges();

    // Es un efecto que el usuario no pidio y que importa: si el invitado tenia el correo viejo
    // abierto, ese enlace ya no funciona.
    expect(anfitrion.textContent).toContain('El anterior dejo de servir');
  });

  it('cancelar exige motivo y libera el email', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    abrir(fixture, 'Cancelar');
    escribir(anfitrion, '#cancelar-invitacion-motivo', 'Se cubrio el puesto');
    fixture.detectChanges();

    const confirmar = [...anfitrion.querySelectorAll('button')].find(
      (boton) => (boton.textContent ?? '').trim() === 'Cancelar la invitacion',
    );
    confirmar?.click();
    fixture.detectChanges();

    const cancelacion = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'POST' && peticion.url === `${LISTADO}/7/cancel`,
    );
    expect(cancelacion.request.body).toEqual({ reason: 'Se cubrio el puesto' });
    cancelacion.flush({ ...PENDIENTE, estado: 'CANCELADA' });
    httpMock.expectOne(esListado()).flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('Podes volver a invitar a esa persona');
  });

  it(
    'la pantalla no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  async function montar(): Promise<ComponentFixture<InvitacionesPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({
      permissions: [PERMISO_COLABORADOR_MANAGE],
    });

    const fixture = TestBed.createComponent(InvitacionesPage);
    fixture.detectChanges();

    httpMock.expectOne(esListado()).flush([PENDIENTE, VENCIDA]);
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  function esListado() {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'GET' && peticion.url === LISTADO;
  }
});

function abrir(fixture: { nativeElement: HTMLElement; detectChanges(): void }, etiqueta: string) {
  const boton = [...fixture.nativeElement.querySelectorAll('button')].find(
    (candidato) => (candidato.textContent ?? '').trim() === etiqueta,
  );
  if (boton === undefined) {
    throw new Error(`No existe el boton ${etiqueta}`);
  }
  boton.click();
  fixture.detectChanges();
}

function escribir(anfitrion: HTMLElement, selector: string, valor: string) {
  const campo = anfitrion.querySelector(selector) as HTMLInputElement | null;
  if (campo === null) {
    throw new Error(`No existe el campo ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
}

function enviar(fixture: { nativeElement: HTMLElement; detectChanges(): void }) {
  const formulario = fixture.nativeElement.querySelector('form');
  formulario?.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}
