import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Observable, catchError, map, of, tap } from 'rxjs';

import { MiCuentaService } from '../../api/generated/api/mi-cuenta.service';
import { MisTerminosResponse } from '../../api/generated/model/mis-terminos-response';
import { SessionService } from './session.service';

/**
 * Si la cuenta autenticada tiene pendiente aceptar la versión vigente de los términos
 * (19/11/2026, `appKine-api/docs/diseno/AKINE-terminos-obligatorios.md`).
 *
 * <p>Mientras estén pendientes, el backend responde 403 `terminos-pendientes` a todo: esto es
 * UX, para mandar a `/auth/aceptar-terminos` antes de pintar una pantalla que va a fallar. Se lee
 * una vez por identidad (`GET /api/v1/me/terminos`) y se olvida al cambiar de cuenta o cerrar
 * sesión. Si la lectura falla no se bloquea nada: el backend sigue mandando.
 */
@Injectable({ providedIn: 'root' })
export class TerminosPendientesStore {
  private readonly api = inject(MiCuentaService);
  private readonly session = inject(SessionService);

  private readonly leidos = signal<MisTerminosResponse | null>(null);

  /** Lo último leído de `/me/terminos`, o `null` si todavía no se leyó para esta cuenta. */
  readonly terminos = this.leidos.asReadonly();

  constructor() {
    effect(() => {
      this.session.epocaDeIdentidad();
      untracked(() => this.leidos.set(null));
    });
  }

  /** `true` si hay que aceptar antes de seguir. Usa lo ya leído o lo pide. */
  pendiente(): Observable<boolean> {
    const leidos = this.leidos();
    if (leidos !== null) {
      return of(leidos.pendiente === true);
    }
    return this.cargar().pipe(
      map((terminos) => terminos.pendiente === true),
      catchError(() => of(false)),
    );
  }

  /** Relee de la API. Lo usa la pantalla de aceptación para mostrar versión y enlace. */
  cargar(): Observable<MisTerminosResponse> {
    return this.api.getMisTerminos().pipe(tap((terminos) => this.leidos.set(terminos)));
  }

  /** El backend acaba de responder 403 `terminos-pendientes`: la versión cambió en el medio. */
  marcarPendiente(): void {
    const leidos = this.leidos();
    this.leidos.set(leidos === null ? null : { ...leidos, pendiente: true });
  }

  aceptar(versionTerminos: string): Observable<void> {
    return this.api.aceptarMisTerminos({ aceptarTerminosRequest: { versionTerminos } }).pipe(
      tap(() => {
        const leidos = this.leidos();
        if (leidos !== null) {
          this.leidos.set({ ...leidos, pendiente: false });
        }
      }),
      map(() => undefined),
    );
  }
}
