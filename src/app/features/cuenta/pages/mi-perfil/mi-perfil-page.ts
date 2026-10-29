import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { MiCuentaService } from '../../../../api/generated/api/mi-cuenta.service';
import { MyProfileResponse } from '../../../../api/generated/model/my-profile-response';
import { RUTA_LOGIN } from '../../../../core/models/rutas';
import { RecuperacionService } from '../../../../api/generated/api/recuperacion.service';
import { SessionService } from '../../../../core/services/session.service';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

type EstadoPerfil =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly perfil: MyProfileResponse }
  | { readonly tipo: 'error' };

type EstadoEnvio = 'inicial' | 'enviando' | 'enviado' | 'limite' | 'error';

/**
 * Mi perfil (refactor de la cabecera global, 28/10/2026): los datos de la cuenta, el rol en la
 * sede activa, el cambio de contraseña y el cierre de las sesiones abiertas.
 *
 * <p><b>Hasta donde llega el contrato.</b> `GET /me` da nombre, apellido, correo y el rol del
 * contexto; no hay operacion para editarlos ni para guardar una foto, asi que se muestran y el
 * avatar son las iniciales. La contrasena se cambia con el mismo enlace por correo que "Olvide
 * mi contrasena" (`POST /auth/password-reset`): no hay cambio autenticado con la actual. Editar
 * datos, foto y contrasena en el lugar es un pedido al backend.
 *
 * <p>La pantalla lee el perfil al crearse. Cambiar de sede la vuelve a crear (`CambioDeSede`),
 * asi que el rol que muestra es siempre el de la sede activa.
 */
@Component({
  selector: 'app-mi-perfil-page',
  imports: [CabeceraDePagina, Ayuda],
  templateUrl: './mi-perfil-page.html',
  styleUrl: './mi-perfil-page.css',
})
export class MiPerfilPage {
  private readonly cuenta = inject(MiCuentaService);
  private readonly recuperacion = inject(RecuperacionService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  protected readonly estado = signal<EstadoPerfil>({ tipo: 'cargando' });
  protected readonly envio = signal<EstadoEnvio>('inicial');
  protected readonly confirmandoCierre = signal(false);
  protected readonly cerrandoSesiones = signal(false);
  protected readonly errorCierre = signal(false);

  protected readonly perfil = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'listo' ? estado.perfil : null;
  });

  protected readonly iniciales = computed(() =>
    [this.perfil()?.firstName, this.perfil()?.lastName]
      .filter((parte): parte is string => !!parte)
      .map((parte) => parte[0]!.toUpperCase())
      .join(''),
  );

  constructor() {
    this.cargar();
  }

  protected cargar(): void {
    this.estado.set({ tipo: 'cargando' });
    this.cuenta.getMe().subscribe({
      next: (perfil) => this.estado.set({ tipo: 'listo', perfil }),
      error: () => this.estado.set({ tipo: 'error' }),
    });
  }

  /** Manda al correo de la cuenta el enlace para elegir una contrasena nueva. */
  protected pedirCambioDeContrasena(): void {
    const email = this.perfil()?.email;
    if (!email || this.envio() === 'enviando') {
      return;
    }
    this.envio.set('enviando');
    this.recuperacion.requestPasswordReset({ passwordResetRequest: { email } }).subscribe({
      next: () => this.envio.set('enviado'),
      error: (error: unknown) =>
        this.envio.set(
          error instanceof AkineHttpError && error.status === 429 ? 'limite' : 'error',
        ),
    });
  }

  /**
   * Revoca los refresh de la cuenta en todos los dispositivos, incluido este, y vuelve al login.
   * Los access token ya emitidos siguen valiendo hasta diez minutos (ADR-0017): el texto no
   * promete un corte instantaneo.
   */
  protected cerrarTodasLasSesiones(): void {
    this.cerrandoSesiones.set(true);
    this.errorCierre.set(false);
    this.session.cerrarTodasLasSesiones().subscribe({
      next: () => this.router.navigateByUrl(RUTA_LOGIN).catch(() => undefined),
      error: () => {
        this.cerrandoSesiones.set(false);
        this.errorCierre.set(true);
      },
    });
  }
}
