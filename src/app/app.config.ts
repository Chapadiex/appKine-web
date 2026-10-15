import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { provideApi } from './api/generated/provide-api';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { PrecargaDeModulos } from './core/services/precarga-de-modulos';
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

    provideHttpClient(withXhr(), withInterceptors([authInterceptor, errorInterceptor])),

    // Base del cliente generado. Vacia en dev: el proxy resuelve /api contra el backend
    // local, asi que nunca hay una URL de localhost horneada en el bundle.
    provideApi(environment.apiBaseUrl),

    // Arranca la recuperacion de la sesion, SIN esperarla.
    //
    // El access token vive en memoria y muere con la pestania, asi que toda recarga
    // arranca "anonima" hasta que la cookie httpOnly se canjea por un token nuevo. Hasta
    // AKINE-LCP este inicializador devolvia el Observable y Angular ESPERABA: el router no
    // empezaba a bajar la pantalla hasta que volvieran el refresh y los contextos, dos idas
    // y vueltas en serie que en un movil 4G eran ~400 ms de LCP. Ahora la restauracion corre
    // en paralelo y la espera la hacen los guards (`trasRestaurarSesion`), que ademas
    // precargan el componente de destino mientras tanto: ninguna ruta protegida decide con
    // la sesion a medio resolver, asi que una recarga sigue sin parpadear al login.
    provideAppInitializer(() => inject(SessionService).iniciarRestauracion()),

    // Cada pantalla que el router empieza a bajar arrastra sus dependencias compartidas en la
    // misma ida y vuelta, no en la siguiente (AKINE-LCP). Ver PrecargaDeModulos.
    provideAppInitializer(() => inject(PrecargaDeModulos).escucharRouter()),
  ],
};
