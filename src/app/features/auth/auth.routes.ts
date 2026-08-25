import { Routes } from '@angular/router';

/**
 * Rutas de la feature `auth` (M02, etapa AKINE-01.02).
 *
 * <p>Se monta bajo `auth` desde `app.routes.ts` con `loadChildren`, segun la convencion de
 * ADR-0004: cada dominio en su propio chunk.
 *
 * <p><b>Sin guards, y no por olvido.</b> Estas son las unicas pantallas que un usuario
 * anonimo tiene que poder abrir. Un `authGuard` aca dejaria la aplicacion sin ninguna ruta
 * alcanzable sin sesion.
 *
 * <p>Los enlaces de correo apuntan a `/auth/activar?token=...` y
 * `/auth/restablecer?token=...`: el token viaja en la query string porque es lo unico que un
 * correo puede abrir. Ninguna de las dos pantallas lo persiste.
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'ingresar',
  },
  {
    path: 'ingresar',
    loadComponent: () => import('./pages/login/login-page').then((m) => m.LoginPage),
    title: 'AKINE - Iniciar sesion',
  },
  {
    path: 'registro',
    loadComponent: () => import('./pages/register/register-page').then((m) => m.RegisterPage),
    title: 'AKINE - Crear una cuenta',
  },
  {
    path: 'activar',
    loadComponent: () => import('./pages/activate/activate-page').then((m) => m.ActivatePage),
    title: 'AKINE - Activar la cuenta',
  },
  {
    path: 'reenviar-activacion',
    loadComponent: () =>
      import('./pages/resend-activation/resend-activation-page').then(
        (m) => m.ResendActivationPage,
      ),
    title: 'AKINE - Reenviar la activacion',
  },
  {
    path: 'olvide-mi-contrasena',
    loadComponent: () =>
      import('./pages/forgot-password/forgot-password-page').then((m) => m.ForgotPasswordPage),
    title: 'AKINE - Recuperar la contrasena',
  },
  {
    path: 'restablecer',
    loadComponent: () =>
      import('./pages/reset-password/reset-password-page').then((m) => m.ResetPasswordPage),
    title: 'AKINE - Poner una contrasena nueva',
  },
  // Invitacion a colaborar (M05, AKINE-02.03). Va con las de auth y no bajo `/organizacion`
  // porque quien la abre NO tiene sesion y muchas veces ni cuenta: lo que lo autoriza es el
  // token del enlace. Pedirle que inicie sesion antes seria pedirle que use una cuenta que
  // todavia no existe.
  {
    path: 'invitacion',
    loadComponent: () => import('./pages/invitacion/invitacion-page').then((m) => m.InvitacionPage),
    title: 'AKINE - Invitacion a colaborar',
  },
  {
    path: 'sesion-expirada',
    loadComponent: () =>
      import('./pages/session-expired/session-expired-page').then((m) => m.SessionExpiredPage),
    title: 'AKINE - Sesion expirada',
  },
];
