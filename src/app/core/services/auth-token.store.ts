import { Injectable, computed, signal } from '@angular/core';

/**
 * Custodia del access token.
 *
 * <p><b>Decision de seguridad (AKINE-00.01).</b> El access token vive UNICAMENTE en memoria.
 * No se escribe en `localStorage` ni en `sessionStorage`.
 *
 * Motivo: AKINE maneja historia clinica. Un XSS —propio o de cualquier dependencia npm—
 * puede leer todo el storage del navegador, y con el token robado se accede a datos de
 * salud de pacientes reales. Un token en memoria muere con la pestana y no es alcanzable
 * desde otro contexto.
 *
 * El costo de esta decision es que al refrescar la pagina el token se pierde. Se resuelve
 * con el refresh token, que viaja en una cookie `httpOnly` + `SameSite` que JavaScript no
 * puede leer: al arrancar, la app pide un access token nuevo contra el endpoint de refresh.
 * Ese endpoint se implementa en F1 (M02).
 *
 * Todo el estado es signal: Angular 21 es zoneless y el change detection lo manejan los
 * signals.
 */
@Injectable({ providedIn: 'root' })
export class AuthTokenStore {
  private readonly accessToken = signal<string | null>(null);

  /** Token vigente, o `null` si no hay sesion activa. */
  readonly token = this.accessToken.asReadonly();

  readonly isAuthenticated = computed(() => this.accessToken() !== null);

  set(token: string): void {
    this.accessToken.set(token);
  }

  /**
   * Borra el token de memoria.
   *
   * No invalida el refresh token: eso es responsabilidad del backend, que es la autoridad
   * de la sesion. El logout completo requiere llamar al endpoint correspondiente.
   */
  clear(): void {
    this.accessToken.set(null);
  }
}
