import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { provideApi } from './api/generated/provide-api';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { environment } from '../environments/environment';
import { routes } from './app.routes';

/**
 * Composicion raiz de la aplicacion (AKINE-00.01).
 *
 * <p>El orden de los interceptores importa: `authInterceptor` corre primero para adjuntar
 * el token, y `errorInterceptor` lo envuelve para traducir la respuesta. Invertirlos haria
 * que el manejo de 401 ocurriera antes de que la peticion siquiera lleve credenciales.
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
  ],
};
