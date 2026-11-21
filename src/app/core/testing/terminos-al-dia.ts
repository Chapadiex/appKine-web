import { Provider } from '@angular/core';
import { of } from 'rxjs';

import { TerminosPendientesStore } from '../services/terminos-pendientes.store';

/**
 * Términos ya aceptados, para los specs que recorren rutas con `authGuard` y una sesión simulada:
 * el guard consulta los términos pendientes, y sin esto el store real lee una sesión que el spec
 * no armó.
 */
export const TERMINOS_AL_DIA: Provider = {
  provide: TerminosPendientesStore,
  useValue: { terminos: () => ({ pendiente: false }), pendiente: () => of(false) },
};
