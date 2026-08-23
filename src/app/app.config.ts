import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { provideApi } from './api/generated/provide-api';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { SessionService } from './core/services/session.service';
import { environment } from '../environments/environment';
import { routes } from './app.routes';

/**
 * Composicion raiz de la aplicacion (AKINE-00.01, ampliada en AKINE-01.02).
 *
 * <p>El orden de los interceptores importa: `authInterceptor` corre primero para adjuntar
 * el token, y `errorInterceptor` queda por dentro traduciendo la respuesta. Invertirlos
 * haria que el manejo del error ocurriera antes de que la peticion siquiera lleve
 * credenciales, y dejaria el reintento post-refresh fuera de la traduccion.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),

    // Angular 21 es zoneless por defecto; se declara explicito para que quede a la vista
    // que el change detection depende de signals y no de zone.js.
    provideZonelessChangeDetection(),

    provideRouter(routes, withComponentInputBinding()),

    provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),

    // Base del cliente generado. Vacia en dev: el proxy resuelve /api contra el backend
    // local, asi que nunca hay una URL de localhost horneada en el bundle.
    provideApi(environment.apiBaseUrl),

    // Recupera la sesion antes de que el router active la primera ruta.
    //
    // El access token vive en memoria y muere con la pestania, asi que toda recarga
    // arranca "anonima" hasta que la cookie httpOnly se canjea por un token nuevo.
    // Devolver el Observable hace que Angular ESPERE: sin esa espera, los guards correrian
    // con la sesion todavia sin resolver y toda recarga de una pantalla interna
    // parpadearia al login antes de volver sola.
    //
    // `restaurarSesion()` no falla nunca -devuelve `false` cuando no hay cookie, que es el
    // caso normal de un visitante-, asi que el arranque no puede quedar colgado por esto.
    provideAppInitializer(() => inject(SessionService).restaurarSesion()),
  ],
};
