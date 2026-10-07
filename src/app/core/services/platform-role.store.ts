import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, of, shareReplay, tap } from 'rxjs';

import { MiCuentaService } from '../../api/generated/api/mi-cuenta.service';
import { SessionService } from './session.service';

/**
 * "¿La cuenta que mira administra la plataforma?" (AKINE-A-7, RF-M06-005).
 *
 * <p>Se pregunta <b>una vez por sesion</b> a `GET /api/v1/me/platform-role`, que el backend
 * exceptua del filtro de tenant: responde con el token `pre_context`, antes de elegir contexto,
 * que es justo cuando hace falta saberlo —un administrador de plataforma no es miembro de
 * ningun centro y nunca tiene contexto que elegir—.
 *
 * <p><b>La respuesta es de la cuenta, no del contexto.</b> Por eso el cache se sella con
 * `SessionService.epocaDeIdentidad` y no con `contextEpoch`: cambiar de consultorio no cambia
 * quien es uno, pero un logout o un login con otra cuenta si, y en el mismo tick la respuesta
 * anterior deja de valer sin esperar a ningun `effect`.
 *
 * <p><b>Esto es UX, no seguridad.</b> Decide si se muestra la consola; cada endpoint de
 * plataforma vuelve a verificar el rol contra la base en cada request. Si la consulta falla, se
 * responde `false` sin cachear: esconder la consola un rato es reversible, mostrarla a quien no
 * corresponde no aporta nada.
 */
@Injectable({ providedIn: 'root' })
export class PlatformRoleStore {
  private readonly cuenta = inject(MiCuentaService);
  private readonly session = inject(SessionService);

  private readonly cache = signal<{ readonly epoca: number; readonly admin: boolean } | null>(null);

  /** Consulta en vuelo, compartida, con la epoca en la que salio. */
  private enVuelo: { readonly epoca: number; readonly flujo: Observable<boolean> } | null = null;

  private readonly vigente = computed(() => {
    const cache = this.cache();
    return cache !== null && cache.epoca === this.session.epocaDeIdentidad() ? cache : null;
  });

  /** `true` solo con una respuesta vigente que diga que si. Falso mientras no se sabe. */
  readonly esAdminDePlataforma: Signal<boolean> = computed(() => this.vigente()?.admin === true);

  /** `true` si ya hay respuesta para la sesion actual. */
  readonly cargado: Signal<boolean> = computed(() => this.vigente() !== null);

  /**
   * Resuelve el rol, de cache si ya se pregunto en esta sesion.
   *
   * <p>Sin sesion devuelve `false` sin salir a la red: el endpoint responderia 403 y la
   * pregunta no tiene sentido. Una respuesta que llega despues de un cambio de identidad se
   * descarta, igual que en `PermissionsStore`.
   */
  resolver(): Observable<boolean> {
    if (this.session.estado() === 'anonimo') {
      return of(false);
    }

    const vigente = this.vigente();
    if (vigente !== null) {
      return of(vigente.admin);
    }

    const epoca = this.session.epocaDeIdentidad();
    if (this.enVuelo !== null && this.enVuelo.epoca === epoca) {
      return this.enVuelo.flujo;
    }

    const flujo = this.cuenta.getMyPlatformRole().pipe(
      map((respuesta) => respuesta.platformAdmin === true),
      tap((admin) => {
        if (this.session.epocaDeIdentidad() === epoca) {
          this.cache.set({ epoca, admin });
        }
      }),
      catchError(() => of(false)),
      finalize(() => {
        if (this.enVuelo?.epoca === epoca) {
          this.enVuelo = null;
        }
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    this.enVuelo = { epoca, flujo };
    return flujo;
  }

  /** Igual que {@link resolver}, para quien no necesita el resultado: el menu. */
  asegurarCargado(): void {
    if (this.cargado() || this.session.estado() === 'anonimo') {
      return;
    }
    this.resolver().subscribe();
  }
}
