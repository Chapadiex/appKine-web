import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { EstadoFormulario, traducirYEsperar } from '../../models/auth-errors';
import { RegistroYActivacionService } from '../../../../api/generated/api/registro-y-activacion.service';
import { crearEsperaPorLimite } from '../../models/espera-por-limite';

/**
 * Mensaje unico del `202`.
 *
 * <p><b>No tocar para "mejorar la UX".</b> El backend responde lo mismo exista o no la
 * cuenta (ADR-0018). Si la pantalla dijera "ese email no existe", el atacante enumeraria
 * los clientes del SaaS igual y todo el trabajo del backend se tiraria.
 */
export const MENSAJE_UNIFORME_ACTIVACION =
  'Si el email esta registrado y la cuenta todavia no esta activa, te llega un correo con un ' +
  'enlace nuevo. Revisa tambien la carpeta de correo no deseado.';

/** Reenvio del enlace de activacion (M02, AKINE-01.02). */
@Component({
  selector: 'app-resend-activation-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './resend-activation-page.html',
  styleUrl: '../../auth.css',
})
export class ResendActivationPage {
  private readonly registro = inject(RegistroYActivacionService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly formulario = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  protected readonly estado = signal<EstadoFormulario>({ tipo: 'editando' });
  protected readonly intentos = signal(0);
  protected readonly espera = crearEsperaPorLimite();

  protected readonly enviando = computed(() => this.estado().tipo === 'enviando');
  protected readonly hecho = computed(() => this.estado().tipo === 'ok');

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
      this.host.nativeElement.querySelector<HTMLElement>('#reenvio-email')?.focus();
      return;
    }

    if (this.bloqueado()) {
      return;
    }

    const { email } = this.formulario.getRawValue();
    this.estado.set({ tipo: 'enviando' });

    this.registro.resendActivation({ resendActivationRequest: { email: email.trim() } }).subscribe({
      next: () => this.estado.set({ tipo: 'ok', mensaje: MENSAJE_UNIFORME_ACTIVACION }),
      error: (error: unknown) => {
        const traducido = traducirYEsperar(error, this.espera);
        this.estado.set({ tipo: 'error', mensaje: traducido.mensaje, causa: traducido.causa });
      },
    });
  }
}
