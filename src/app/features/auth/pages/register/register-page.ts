import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { EstadoFormulario, traducirYEsperar } from '../../models/auth-errors';
import { RegisterAccountRequest } from '../../../../api/generated/model/register-account-request';
import { RegistroYActivacionService } from '../../../../api/generated/api/registro-y-activacion.service';
import { crearEsperaPorLimite } from '../../models/espera-por-limite';
import { nuevaClaveDeIntento } from '../../models/clave-de-intento';

/** Campos obligatorios, en el orden en que se enfoca el primero invalido. */
const CAMPOS = [
  'firstName',
  'lastName',
  'email',
  'password',
  'organizationName',
  'organizationSlug',
  'consultorioName',
  'planCode',
] as const;

type Campo = (typeof CAMPOS)[number];

/**
 * Alta self-service de cuenta, organizacion y primer consultorio (M02, AKINE-01.02).
 *
 * <p><b>Respuesta uniforme (ADR-0018).</b> El backend responde `202` con el mismo cuerpo
 * exista o no la cuenta: si el email ya estaba registrado no crea nada y encola un correo
 * de "ya tenes cuenta". La pantalla muestra EXACTAMENTE el mismo texto en los dos casos. No
 * hay -ni va a haber- un `409 email-already-registered`: seria el oraculo de existencia que
 * el 401 uniforme del login existe para cerrar.
 *
 * <p><b>Idempotencia.</b> `Idempotency-Key` es obligatorio. La clave se genera una vez y se
 * REUSA en cada reintento del mismo payload: es lo que evita que un corte de red termine en
 * dos cuentas y dos correos. Si el usuario corrige un campo antes de reintentar, se genera
 * una clave nueva, porque la misma clave con otro payload devuelve
 * `409 idempotency-key-conflict`.
 */
@Component({
  selector: 'app-register-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register-page.html',
  styleUrl: '../../auth.css',
})
export class RegisterPage {
  private readonly registro = inject(RegistroYActivacionService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly formulario = inject(FormBuilder).nonNullable.group({
    firstName: ['', [Validators.required]],
    lastName: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
    organizationName: ['', [Validators.required]],
    organizationSlug: [''],
    consultorioName: [''],
    planCode: [''],
  });

  protected readonly estado = signal<EstadoFormulario>({ tipo: 'editando' });
  protected readonly intentos = signal(0);
  protected readonly espera = crearEsperaPorLimite();

  /** Clave de idempotencia del intento en curso, y el payload con el que se emitio. */
  private clave: string | null = null;
  private payloadDeLaClave: string | null = null;

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

  protected readonly bloqueado = computed(
    () => this.enviando() || this.hecho() || this.espera.activa(),
  );

  /** Solo para tests y diagnostico: la clave con la que salio el ultimo envio. */
  get claveDeIntento(): string | null {
    return this.clave;
  }

  protected mostrarError(nombre: Campo): boolean {
    const control = this.formulario.controls[nombre];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected enviar(): void {
    this.intentos.update((valor) => valor + 1);

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      this.enfocarPrimerInvalido();
      return;
    }

    if (this.bloqueado()) {
      return;
    }

    const cuerpo = this.armarCuerpo();
    const idempotencyKey = this.claveParaEstePayload(cuerpo);

    this.estado.set({ tipo: 'enviando' });

    this.registro.registerAccount({ idempotencyKey, registerAccountRequest: cuerpo }).subscribe({
      next: () =>
        this.estado.set({
          tipo: 'ok',
          // Texto unico: no delata si el email ya tenia cuenta.
          mensaje:
            'Si el email esta disponible o ya tenia cuenta, te llega un correo con los pasos ' +
            'a seguir. Revisa tambien la carpeta de correo no deseado.',
        }),
      error: (error: unknown) => this.fallar(error),
    });
  }

  private armarCuerpo(): RegisterAccountRequest {
    const valores = this.formulario.getRawValue();
    const cuerpo: RegisterAccountRequest = {
      email: valores.email.trim(),
      password: valores.password,
      firstName: valores.firstName.trim(),
      lastName: valores.lastName.trim(),
      organizationName: valores.organizationName.trim(),
    };

    // Los opcionales vacios no se mandan: un string vacio no es "sin valor" para el backend.
    const opcionales = {
      organizationSlug: valores.organizationSlug.trim(),
      consultorioName: valores.consultorioName.trim(),
      planCode: valores.planCode.trim(),
    };

    return {
      ...cuerpo,
      ...(opcionales.organizationSlug ? { organizationSlug: opcionales.organizationSlug } : {}),
      ...(opcionales.consultorioName ? { consultorioName: opcionales.consultorioName } : {}),
      ...(opcionales.planCode ? { planCode: opcionales.planCode } : {}),
    };
  }

  /**
   * Reusa la clave si el payload es identico al del envio anterior; si cambio, genera otra.
   *
   * Reusarla con otro payload devolveria `409 idempotency-key-conflict`, y generar una nueva
   * en cada reintento del mismo payload crearia una segunda cuenta.
   */
  private claveParaEstePayload(cuerpo: RegisterAccountRequest): string {
    const firma = JSON.stringify(cuerpo);
    if (this.clave === null || this.payloadDeLaClave !== firma) {
      this.clave = nuevaClaveDeIntento();
      this.payloadDeLaClave = firma;
    }
    return this.clave;
  }

  private fallar(error: unknown): void {
    const traducido = traducirYEsperar(error, this.espera);
    this.estado.set({ tipo: 'error', mensaje: traducido.mensaje, causa: traducido.causa });
  }

  private enfocarPrimerInvalido(): void {
    const nombre = CAMPOS.find((campo) => this.formulario.controls[campo].invalid);
    if (nombre === undefined) {
      return;
    }
    this.host.nativeElement.querySelector<HTMLElement>(`#registro-${nombre}`)?.focus();
  }
}
