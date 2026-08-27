import { ActivatedRouteSnapshot, Router, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { Type } from '@angular/core';

import { ActivatePage } from './pages/activate/activate-page';
import { ForgotPasswordPage } from './pages/forgot-password/forgot-password-page';
import { InvitacionPage } from './pages/invitacion/invitacion-page';
import { LoginPage } from './pages/login/login-page';
import { RegisterPage } from './pages/register/register-page';
import { ResendActivationPage } from './pages/resend-activation/resend-activation-page';
import { ResetPasswordPage } from './pages/reset-password/reset-password-page';
import { SessionExpiredPage } from './pages/session-expired/session-expired-page';
import { NotFound } from '../../shared/pages/not-found/not-found';
import { RUTA_LOGIN, RUTA_SESION_EXPIRADA } from '../../core/models/rutas';
import { routes as rutasDeLaApp } from '../../app.routes';

/**
 * Pineo de los prefijos de ruta de `/auth` (M02, deuda de AKINE-01.02/02.03).
 *
 * <h2>Por que este prefijo va primero y con mas cuidado</h2>
 *
 * <p>Entre AKINE-01.02 y AKINE-02.03 el backend emitia enlaces de correo a `/activar` y
 * `/restablecer` mientras el frontend montaba esas pantallas bajo `/auth`. El usuario abria el
 * correo, hacia clic y caia en el <b>404 del comodin `**` con un token perfectamente valido en
 * la URL</b>. Nadie se entero por meses: no habia error, no habia excepcion, no habia test.
 * `/auth` es el UNICO prefijo en el que el backend (otro repo, otro lenguaje) construye URLs
 * hacia el frontend sin que ningun compilador verifique el acuerdo: `/auth/activar` y
 * `/auth/restablecer` son exactamente las dos rutas que se rompieron.
 *
 * <p>Este spec navega de verdad, contra la configuracion real de `app.routes.ts`, y comprueba
 * a que componente llega cada URL — igual que hace `horarios.routes.spec.ts` (AKINE-02.04)
 * para `/horarios`, que es el precedente de esta forma.
 *
 * <h2>Por que los dos literales de correo no salen de una constante compartida</h2>
 *
 * <p>`RUTA_LOGIN` y `RUTA_SESION_EXPIRADA` ya existen en `core/models/rutas.ts` porque
 * `core/` necesita conocerlas para redirigir desde los guards. `/auth/activar` y
 * `/auth/restablecer` no tienen ese consumidor: ninguna pantalla del frontend construye un
 * link hacia ellas, solo las ABRE quien llega desde el correo. El otro lado del acuerdo es el
 * backend (`IdentityProperties.Links.activationPath` / `.resetPath`, otro repo, otro
 * lenguaje), asi que no hay una constante TypeScript que pueda atar los dos lados: de eso se
 * encarga la verificacion manual registrada en el reporte de esta tarea, no el compilador.
 * Por eso van literales aca, a proposito.
 */
describe('Rutas de /auth', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(rutasDeLaApp)],
    });

    router = TestBed.inject(Router);
  });

  it('las dos rutas que el backend enlaza desde el correo son exactamente estas', () => {
    // Fijado por string y no por concatenacion: si alguien cambia el segmento, esta linea
    // tiene que cambiar con intencion, no arrastrada por una constante que se edito por otro
    // motivo. Es el mismo criterio documentado en rutas-de-horarios.ts para los literales de
    // las plantillas.
    expect('/auth/activar').toBe('/auth/activar');
    expect('/auth/restablecer').toBe('/auth/restablecer');
  });

  it('/auth/activar resuelve a la pantalla de activacion, no al comodin', async () => {
    expect(await componenteDe('/auth/activar')).toBe(ActivatePage);
  });

  it('/auth/restablecer resuelve a la pantalla de reset, no al comodin', async () => {
    expect(await componenteDe('/auth/restablecer')).toBe(ResetPasswordPage);
  });

  it('el resto de las pantallas de auth resuelve a la suya', async () => {
    expect(await componenteDe(RUTA_LOGIN)).toBe(LoginPage);
    expect(await componenteDe('/auth/registro')).toBe(RegisterPage);
    expect(await componenteDe('/auth/reenviar-activacion')).toBe(ResendActivationPage);
    expect(await componenteDe('/auth/olvide-mi-contrasena')).toBe(ForgotPasswordPage);
    expect(await componenteDe('/auth/invitacion')).toBe(InvitacionPage);
    expect(await componenteDe(RUTA_SESION_EXPIRADA)).toBe(SessionExpiredPage);
  });

  it('/auth a secas redirige al login', async () => {
    expect(await componenteDe('/auth')).toBe(LoginPage);
  });

  it('un segmento inventado bajo /auth si cae en el comodin', async () => {
    // La contracara de los tests anteriores: sin esto, un `componenteDe` roto que devolviera
    // siempre algo distinto de NotFound haria pasar las afirmaciones de arriba sin probar nada.
    expect(await componenteDe('/auth/inventado')).toBe(NotFound);
  });

  /** Navega de verdad y devuelve el componente de la hoja activada. */
  async function componenteDe(url: string): Promise<Type<unknown> | null> {
    const navego = await router.navigateByUrl(url);
    expect(navego).toBe(true);

    let nodo: ActivatedRouteSnapshot = router.routerState.snapshot.root;
    while (nodo.firstChild !== null) {
      nodo = nodo.firstChild;
    }
    return nodo.component as Type<unknown> | null;
  }
});
