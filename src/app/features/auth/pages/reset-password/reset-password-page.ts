import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { EstadoFormulario, traducirYEsperar } from '../../models/auth-errors';
import { RecuperacionService } from '../../../../api/generated/api/recuperacion.service';
import { crearEsperaPorLimite } from '../../models/espera-por-limite';

/** Verifica que las dos contrasenas coincidan. Errores de tipeo, no de politica. */
function contrasenasIguales(grupo: AbstractControl): ValidationErrors | null {
  const password = grupo.get('password')?.value;
  const repeticion = grupo.get('repeticion')?.value;
  return password === repeticion ? null : { noCoinciden: true };
}

/**
 * Confirmacion del restablecimiento de contrasena (M02, AKINE-01.02).
 *
 * <p>Token de la query + contrasena nueva. Token inexistente, usado, invalidado, vencido o
 * de una cuenta bloqueada entre el pedido y la confirmacion responden los cinco el mismo
 * `400 invalid-token`, y la pantalla les da a los cinco la misma salida: pedir otro enlace.
 *
 * <p>La politica de contrasena es lo unico que se muestra literal del backend: es el unico
 * mensaje especifico y accionable de todo el flujo.
 */
@Component({
  selector: 'app-reset-password-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './reset-password-page.html',
  styleUrl: '../../auth.css',
})
export class ResetPasswordPage {
  private readonly recuperacion = inject(RecuperacionService);
  private readonly ruta = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly token = this.ruta.snapshot.queryParamMap.get('token');

  protected readonly formulario = inject(FormBuilder).nonNullable.group(
    {
      password: ['', [Validators.required]],
      repeticion: ['', [Validators.required]],
    },
    { validators: contrasenasIguales },
  );

  protected readonly estado = signal<EstadoFormulario>({ tipo: 'editando' });
  protected readonly intentos = signal(0);
  protected readonly espera = crearEsperaPorLimite();

  protected readonly sinToken = this.token === null || this.token.trim() === '';

  protected readonly enviando = computed(() => this.estado().tipo === 'enviando');
  protected readonly hecho = computed(() => this.estado().tipo === 'ok');

  protected readonly mensajeError = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.mensaje : null;
  });

  protected readonly mensajeExito = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'ok' ? estado.mensaje : null;
  });

  /** `true` cuando el enlace ya no sirve: la salida es pedir otro, no reintentar. */
  protected readonly enlaceInservible = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' && estado.causa === 'token';
  });

  protected readonly bloqueado = computed(
    () => this.enviando() || this.hecho() || this.espera.activa(),
  );

  protected mostrarError(nombre: 'password' | 'repeticion'): boolean {
    const control = this.formulario.controls[nombre];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected mostrarNoCoinciden(): boolean {
    return (
      this.formulario.hasError('noCoinciden') &&
      this.formulario.controls.repeticion.value !== '' &&
      (this.formulario.controls.repeticion.touched || this.intentos() > 0)
    );
  }

  protected enviar(): void {
    this.intentos.update((valor) => valor + 1);

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      this.enfocarPrimerInvalido();
      return;
    }

    if (this.bloqueado() || this.token === null) {
      return;
    }

    const { password } = this.formulario.getRawValue();
    this.estado.set({ tipo: 'enviando' });

    this.recuperacion
      .confirmPasswordReset({ passwordResetConfirmRequest: { token: this.token, password } })
      .subscribe({
        next: () =>
          this.estado.set({
            tipo: 'ok',
            mensaje:
              'Tu contrasena quedo actualizada y se cerraron todas tus sesiones abiertas. ' +
              'Entra de nuevo con la contrasena nueva.',
          }),
        error: (error: unknown) => {
          const traducido = traducirYEsperar(error, this.espera, {
            token: 'El enlace vencio o ya se uso. Pedi uno nuevo.',
          });
          this.estado.set({ tipo: 'error', mensaje: traducido.mensaje, causa: traducido.causa });
        },
      });
  }

  private enfocarPrimerInvalido(): void {
    const nombre = (['password', 'repeticion'] as const).find(
      (campo) => this.formulario.controls[campo].invalid,
    );
    const destino = nombre ?? 'repeticion';
    this.host.nativeElement.querySelector<HTMLElement>(`#reset-${destino}`)?.focus();
  }
}
