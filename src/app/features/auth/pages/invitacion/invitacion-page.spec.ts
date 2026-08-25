import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { InvitacionPage } from './invitacion-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const PREVIEW = '/api/v1/auth/invitations/preview';
const ACCEPT = '/api/v1/auth/invitations/accept';
const DECLINE = '/api/v1/auth/invitations/decline';

const TOKEN = 'token-del-correo';

/** Invitacion a alguien que todavia no tiene cuenta: el caso que justifica la etapa. */
const SIN_CUENTA = {
  organizacionNombre: 'Centro Belgrano',
  consultorioNombre: 'Sede Centro',
  roleCode: 'PROFESIONAL',
  email: 'invitada@ejemplo.test',
  expiraEn: '2026-09-08T12:00:00Z',
  requiereRegistro: true,
};

/**
 * Spec de la pantalla que ve el invitado (RF-M05-002, AKINE-02.03).
 *
 * <p>Cubre lo que, si se rompe, <b>no da ningun error visible</b>:
 *
 * <ol>
 *   <li>Que el formulario de alta aparezca <b>solo cuando hace falta</b>. A quien ya tiene cuenta
 *       pedirle una contrasena nueva es pedirle que la cambie sin querer, y el backend la ignora:
 *       el usuario creeria que la cambio.</li>
 *   <li>Que el enlace vencido no se lea como una falla del sistema. Es el unico error del modulo
 *       con salida propia.</li>
 *   <li>Que rechazar sea un click y no un formulario: a nadie se le exige explicar por que no
 *       quiere entrar a trabajar a un lado.</li>
 * </ol>
 */
describe('InvitacionPage', () => {
  let httpMock: HttpTestingController;

  function montarCon(token: string | null) {
    TestBed.configureTestingModule({
      imports: [InvitacionPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap(token === null ? {} : { token }),
            },
          },
        },
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(InvitacionPage);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => httpMock.verify());

  async function montarLista(
    preview: Record<string, unknown> = SIN_CUENTA,
  ): Promise<ComponentFixture<InvitacionPage>> {
    const fixture = montarCon(TOKEN);

    const consulta = httpMock.expectOne(PREVIEW);
    // El token viaja en el CUERPO y no en la query: en la query queda en los logs de acceso,
    // en el historial del navegador y en el Referer de cualquier recurso externo.
    expect(consulta.request.body).toEqual({ token: TOKEN });
    consulta.flush(preview);

    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('pide nombre y contrasena solo cuando el invitado no tiene cuenta', async () => {
    const conAlta = await montarLista();
    const anfitrion = conAlta.nativeElement as HTMLElement;

    expect(anfitrion.querySelector('#invitacion-nombre')).not.toBeNull();
    expect(anfitrion.querySelector('#invitacion-password')).not.toBeNull();
    expect(anfitrion.textContent).toContain('Centro Belgrano');
    expect(anfitrion.textContent).toContain('Sede Centro');
    // Y explica por que no va a recibir un correo de activacion, que es lo que esperaria
    // cualquiera que se haya registrado antes en AKINE.
    expect(anfitrion.textContent).toContain('ningun correo de activacion');
  });

  it('a quien ya tiene cuenta no le pide nada: pedirle contrasena seria cambiarsela', async () => {
    TestBed.resetTestingModule();
    const fixture = await montarLista({ ...SIN_CUENTA, requiereRegistro: false });
    const anfitrion = fixture.nativeElement as HTMLElement;

    expect(anfitrion.querySelector('#invitacion-nombre')).toBeNull();
    expect(anfitrion.querySelector('#invitacion-password')).toBeNull();
    expect(anfitrion.textContent).toContain('la contrasena de siempre');

    // Y aceptar manda SOLO el token: el backend ignoraria el resto, y mandarlo igual le haria
    // creer al usuario que cambio algo.
    aceptar(fixture);
    const peticion = httpMock.expectOne(ACCEPT);
    expect(peticion.request.body).toEqual({ token: TOKEN });
    peticion.flush({ cuentaId: 1, membershipId: 2, organizationId: 3, cuentaCreada: false });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('con tu cuenta de siempre');
  });

  it('el alta exige nombre y contrasena antes de mandar nada', async () => {
    TestBed.resetTestingModule();
    const fixture = await montarLista();
    const anfitrion = fixture.nativeElement as HTMLElement;

    aceptar(fixture);
    httpMock.expectNone(ACCEPT);
    expect(anfitrion.textContent).toContain('El nombre es obligatorio');

    escribir(anfitrion, '#invitacion-nombre', 'Ana');
    escribir(anfitrion, '#invitacion-password', 'corta');
    fixture.detectChanges();
    aceptar(fixture);
    httpMock.expectNone(ACCEPT);
    expect(anfitrion.textContent).toContain('al menos 10 caracteres');

    escribir(anfitrion, '#invitacion-password', 'kinesiologia-2026');
    fixture.detectChanges();
    aceptar(fixture);

    const peticion = httpMock.expectOne(ACCEPT);
    expect(peticion.request.body).toEqual({
      token: TOKEN,
      nombre: 'Ana',
      password: 'kinesiologia-2026',
    });
    peticion.flush({ cuentaId: 1, membershipId: 2, organizationId: 3, cuentaCreada: true });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('la contrasena que acabas de elegir');
  });

  it('un enlace vencido ofrece reintentar y no se lee como una falla', async () => {
    TestBed.resetTestingModule();
    const fixture = montarCon(TOKEN);

    httpMock
      .expectOne(PREVIEW)
      .flush(
        { type: 'https://akine.app/problems/invitacion-vencida', detail: 'vencio' },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('vencio');
    // La salida concreta: la invitacion sigue en pie y quien invito puede reenviarla.
    expect(anfitrion.textContent).toContain('La invitacion sigue en pie');
    expect(anfitrion.textContent).not.toContain('Ir a iniciar sesion');
  });

  it('rechazar es un click, sin formulario ni motivo', async () => {
    TestBed.resetTestingModule();
    const fixture = await montarLista();
    const anfitrion = fixture.nativeElement as HTMLElement;

    const boton = [...anfitrion.querySelectorAll('button')].find(
      (candidato) => (candidato.textContent ?? '').trim() === 'No, gracias',
    );
    boton?.click();
    fixture.detectChanges();

    const peticion = httpMock.expectOne(DECLINE);
    // Sin motivo: a nadie se le exige explicar por que no quiere entrar a trabajar a un lado.
    expect(peticion.request.body).toEqual({ token: TOKEN });
    peticion.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('Rechazaste la invitacion');
    expect(anfitrion.textContent).toContain('No creamos ninguna cuenta');
  });

  it('un enlace sin token no consulta nada y explica que suele pasar', async () => {
    TestBed.resetTestingModule();
    const fixture = montarCon(null);
    await fixture.whenStable();
    fixture.detectChanges();

    httpMock.expectNone(PREVIEW);
    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('le falta el codigo de la invitacion');
  });

  it(
    'la pantalla no tiene violaciones de accesibilidad',
    async () => {
      TestBed.resetTestingModule();
      const fixture = await montarLista();
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );
});

function aceptar(fixture: { nativeElement: HTMLElement; detectChanges(): void }) {
  const formulario = fixture.nativeElement.querySelector('form');
  formulario?.dispatchEvent(new Event('submit'));
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
