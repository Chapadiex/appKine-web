import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { finalize } from 'rxjs';

import { MiCuentaService } from '../../api/generated/api/mi-cuenta.service';
import { MyProfileResponse } from '../../api/generated/model/my-profile-response';
import { SessionService } from './session.service';
import { TenantContextStore } from './tenant-context.store';

/**
 * Quien ingreso y con que rol (DP-45, `GET /api/v1/me`). Lo lee el pie de la barra lateral.
 *
 * <p><b>El sello es la identidad mas el par organizacion + sede, no `contextEpoch`.</b> El rol
 * vive en la membership, asi que cambiar de sede puede cambiarlo; un login o un logout cambian
 * la cuenta entera. Pero `contextEpoch` avanza tambien en cada refresh del access token (cada
 * diez minutos, mismo contexto): sellar con el haria repetir la consulta y parpadear el nombre
 * sin que nada haya cambiado. Como en {@link PlatformRoleStore}, la respuesta de un sello viejo
 * deja de valer en el mismo tick, sin esperar a ningun `effect`, y la que llega tarde se
 * descarta.
 *
 * <p><b>Es presentacion.</b> No decide nada: los permisos salen de {@link PermissionsStore} y la
 * autoridad es el backend. Si la consulta falla, el pie se queda con el nombre del centro, como
 * antes de DP-45. No se persiste: nombre y correo son datos personales y viven en memoria, igual
 * que el token.
 */
@Injectable({ providedIn: 'root' })
export class PerfilPropioStore {
  private readonly cuenta = inject(MiCuentaService);
  private readonly session = inject(SessionService);
  private readonly tenant = inject(TenantContextStore);

  private readonly sello = computed(
    () =>
      `${this.session.epocaDeIdentidad()}:${this.tenant.organizationId()}:${this.tenant.consultorioId()}`,
  );

  private readonly cache = signal<{
    readonly sello: string;
    readonly perfil: MyProfileResponse;
  } | null>(null);

  /** Sello de la consulta en vuelo: con el mismo sello no sale otra. */
  private enVuelo: string | null = null;

  /** El perfil de la cuenta y el contexto actuales, o `null` mientras no se sabe. */
  readonly perfil: Signal<MyProfileResponse | null> = computed(() => {
    const cache = this.cache();
    return cache !== null && cache.sello === this.sello() ? cache.perfil : null;
  });

  /** Pide el perfil si hace falta. Idempotente: con uno vigente o en vuelo no sale a la red. */
  asegurarCargado(): void {
    const sello = this.sello();
    if (this.session.estado() === 'anonimo' || this.perfil() !== null || this.enVuelo === sello) {
      return;
    }
    this.enVuelo = sello;
    this.cuenta
      .getMe()
      .pipe(
        finalize(() => {
          if (this.enVuelo === sello) {
            this.enVuelo = null;
          }
        }),
      )
      .subscribe({
        next: (perfil) => {
          if (this.sello() === sello) {
            this.cache.set({ sello, perfil });
          }
        },
        // Silencio deliberado: sin perfil el pie muestra el centro, que es lo que mostraba.
        error: () => undefined,
      });
  }
}
