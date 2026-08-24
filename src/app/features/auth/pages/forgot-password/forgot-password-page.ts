import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { EstadoFormulario, traducirYEsperar } from '../../models/auth-errors';
import { RecuperacionService } from '../../../../api/generated/api/recuperacion.service';
import { crearEsperaPorLimite } from '../../../../shared/utils/espera-por-limite';

/**
 * Mensaje unico del `202`.
 *
 * <p><b>No tocar para "mejorar la UX".</b> El backend responde lo mismo exista o no la
 * cuenta (ADR-0018). Decir "ese email no esta registrado" convertiria esta pantalla en un
 * verificador de direcciones.
 */
export const MENSAJE_UNIFORME_RESET =
  'Si el email esta registrado, te llega un correo con el enlace para poner una contrasena ' +
  'nueva. Revisa tambien la carpeta de correo no deseado.';

/** Pedido de restablecimiento de contrasena (M02, AKINE-01.02). */
@Component({
  selector: 'app-forgot-password-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './forgot-password-page.html',
  styleUrl: '../../auth.css',
})
export class ForgotPasswordPage {
  private readonly recuperacion = inject(RecuperacionService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly formulario = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  protected readonly estado = signal<EstadoFormulario>({ tipo: 'editando' });
  protected readonly intentos = signal(0);
  protected readonly espera = crearEsperaPorLimite();

  protected readonly enviando = computed(() => this.estado().tipo === 'enviando');

  protected readonly mensajeExito = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'ok' ? estado.mensaje : null;
  });

  protected readonly mensajeError = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.mensaje : null;
  });

  protected readonly bloqueado = computed(() => this.enviando() || this.espera.activa());

  protected mostrarError(): boolean {
    const control = this.formulario.controls.email;
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected enviar(): void {
    this.intentos.update((valor) => valor + 1);

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      this.host.nativeElement.querySelector<HTMLElement>('#olvido-email')?.focus();
      return;
    }

    if (this.bloqueado()) {
      return;
    }

    const { email } = this.formulario.getRawValue();
    this.estado.set({ tipo: 'enviando' });

    this.recuperacion
      .requestPasswordReset({ passwordResetRequest: { email: email.trim() } })
      .subscribe({
        next: () => this.estado.set({ tipo: 'ok', mensaje: MENSAJE_UNIFORME_RESET }),
        error: (error: unknown) => {
          const traducido = traducirYEsperar(error, this.espera);
          this.estado.set({ tipo: 'error', mensaje: traducido.mensaje, causa: traducido.causa });
        },
      });
  }
}
