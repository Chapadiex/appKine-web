import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { CausaError, traducirYEsperar } from '../../models/auth-errors';
import { RegistroYActivacionService } from '../../../../api/generated/api/registro-y-activacion.service';
import { crearEsperaPorLimite } from '../../../../shared/utils/espera-por-limite';

/** Estado de la activacion. `sin-token` no es un error del servidor: el enlace vino roto. */
type EstadoActivacion =
  | { readonly tipo: 'sin-token' }
  | { readonly tipo: 'activando' }
  | { readonly tipo: 'ok' }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly causa: CausaError };

/**
 * Confirmacion del enlace de activacion (M02, AKINE-01.02).
 *
 * <p>Toma el token de la query string y lo consume contra `POST /api/v1/auth/activate`.
 * Token inexistente, ya usado, invalidado por uno mas nuevo, vencido o del tipo equivocado
 * responden los cinco el mismo `400 invalid-token`: decir "expirado" le confirmaria a quien
 * prueba valores que acerto uno real. La pantalla ofrece un unico camino de salida para los
 * cinco: pedir un enlace nuevo.
 *
 * <p><b>No se pide contrasena.</b> El contrato acepta `password` opcional, pero solo hace
 * falta cuando la cuenta todavia no tiene credencial (invitaciones, 01.03). En el alta
 * self-service la cuenta ya la tiene y mandarla NO la cambia. Un campo que no hace nada es
 * peor que no tenerlo.
 *
 * <p>Activar <b>no</b> abre sesion: al terminar se manda al login.
 */
@Component({
  selector: 'app-activate-page',
  imports: [RouterLink],
  templateUrl: './activate-page.html',
  styleUrl: '../../auth.css',
})
export class ActivatePage {
  private readonly registro = inject(RegistroYActivacionService);
  private readonly ruta = inject(ActivatedRoute);

  private readonly token = this.ruta.snapshot.queryParamMap.get('token');

  protected readonly estado = signal<EstadoActivacion>({ tipo: 'activando' });
  protected readonly espera = crearEsperaPorLimite();

  protected readonly mensajeError = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.mensaje : null;
  });

  /** `true` cuando el enlace no sirve mas: la salida es pedir uno nuevo, no reintentar. */
  protected readonly enlaceInservible = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' && estado.causa === 'token';
  });

  protected readonly puedeReintentar = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' && estado.causa !== 'token' && !this.espera.activa();
  });

  constructor() {
    this.activar();
  }

  protected activar(): void {
    const token = this.token;
    if (token === null || token.trim() === '') {
      this.estado.set({ tipo: 'sin-token' });
      return;
    }

    this.estado.set({ tipo: 'activando' });

    this.registro.activateAccount({ activateAccountRequest: { token } }).subscribe({
      next: () => this.estado.set({ tipo: 'ok' }),
      error: (error: unknown) => {
        const traducido = traducirYEsperar(error, this.espera, {
          token: 'El enlace vencio o ya se uso. Pedi uno nuevo.',
        });
        this.estado.set({ tipo: 'error', mensaje: traducido.mensaje, causa: traducido.causa });
      },
    });
  }
}
