import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { EstadoFormulario, traducirYEsperar } from '../../models/auth-errors';
import { RegisterAccountRequest } from '../../../../api/generated/model/register-account-request';
import { RegistroYActivacionService } from '../../../../api/generated/api/registro-y-activacion.service';
import { crearEsperaPorLimite } from '../../../../shared/utils/espera-por-limite';
import { nuevaClaveDeIntento } from '../../../../shared/utils/clave-de-intento';
import { MedidorDeContrasena } from '../../components/medidor-de-contrasena/medidor-de-contrasena';
import { TerminosDelAlta } from '../../components/terminos-del-alta/terminos-del-alta';
import {
  MENSAJE_TERMINOS_CAMBIARON,
  esRechazoDeTerminos,
  leerTerminosVigentes,
} from '../../models/terminos-vigentes';
import { toSignal } from '@angular/core/rxjs-interop';
import { textoRequerido } from '../../../../shared/validators/texto-requerido';
import { Icono } from '../../../../shared/components/icono/icono';

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

/** `409 idempotency-key-conflict`: la clave del intento ya se uso con otros datos. */
const MENSAJE_CLAVE_REUSADA =
  'Ya hay un registro en curso con otros datos. Recarga la página e intenta de nuevo.';

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
 *
 * <p><b>Terminos (DP-45).</b> Si el despliegue los exige, el alta lleva la casilla y manda la
 * version aceptada; si `/terms` no responde, no se envia (ver {@link TerminosVigentes}). Si la
 * version cambio entre leerla y enviar, el 400 lo dice y se releen.
 */
@Component({
  selector: 'app-register-page',
  imports: [Icono, MedidorDeContrasena, ReactiveFormsModule, RouterLink, TerminosDelAlta],
  templateUrl: './register-page.html',
  styleUrls: ['../../auth.css', '../../../../shared/styles/acceso.css'],
})
export class RegisterPage {
  /** Mostrar u ocultar la contraseña mientras se escribe (diseño del canvas). Solo cambia el input. */
  protected readonly verPassword = signal(false);

  private readonly registro = inject(RegistroYActivacionService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly formulario = inject(FormBuilder).nonNullable.group({
    firstName: ['', [textoRequerido]],
    lastName: ['', [textoRequerido]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
    organizationName: ['', [textoRequerido]],
    organizationSlug: [''],
    consultorioName: [''],
    planCode: [''],
  });

  /** Lo escrito en la contraseña, solo para el medidor (es una guia: no valida nada). */
  protected readonly passwordEscrita = toSignal(this.formulario.controls.password.valueChanges, {
    initialValue: '',
  });

  protected readonly estado = signal<EstadoFormulario>({ tipo: 'editando' });
  protected readonly intentos = signal(0);
  protected readonly espera = crearEsperaPorLimite();
  protected readonly terminos = leerTerminosVigentes();

  /** "Tenés que aceptar los términos": despues del primer envio, como los demas errores. */
  protected readonly faltanTerminos = computed(
    () => this.terminos.faltaAceptar() && this.intentos() > 0,
  );

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
    () => this.enviando() || this.hecho() || this.espera.activa() || this.terminos.impidenElAlta(),
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

    if (this.formulario.invalid || this.terminos.faltaAceptar()) {
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
            'a seguir. Revisa también la carpeta de correo no deseado.',
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
      ...this.terminos.campos(),
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
    if (error instanceof AkineHttpError && error.problemType === 'idempotency-key-conflict') {
      // La clave ya quedo atada a otro cuerpo en el backend (contrato 0.91.0). No se reusa: el
      // proximo envio sale con una nueva, y el mensaje no delata nada de la cuenta.
      this.clave = null;
      this.payloadDeLaClave = null;
      this.estado.set({ tipo: 'error', mensaje: MENSAJE_CLAVE_REUSADA, causa: 'otro' });
      return;
    }
    if (esRechazoDeTerminos(error)) {
      // La version cambio desde que se leyo, o el despliegue empezo a exigirlos: se releen y la
      // casilla vuelve a quedar sin marcar. El proximo envio cambia el cuerpo, y con el la clave.
      this.terminos.cargar();
      this.estado.set({ tipo: 'error', mensaje: MENSAJE_TERMINOS_CAMBIARON, causa: 'validacion' });
      return;
    }
    const traducido = traducirYEsperar(error, this.espera);
    this.estado.set({ tipo: 'error', mensaje: traducido.mensaje, causa: traducido.causa });
  }

  private enfocarPrimerInvalido(): void {
    const nombre =
      CAMPOS.find((campo) => this.formulario.controls[campo].invalid) ??
      (this.terminos.faltaAceptar() ? 'terminos' : undefined);
    if (nombre === undefined) {
      return;
    }
    this.host.nativeElement.querySelector<HTMLElement>(`#registro-${nombre}`)?.focus();
  }
}
