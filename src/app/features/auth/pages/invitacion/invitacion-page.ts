import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { AcceptInvitacionRequest } from '../../../../api/generated/model/accept-invitacion-request';
import { InvitacionPreviewResponse } from '../../../../api/generated/model/invitacion-preview-response';
import { InvitacionesRecibidasService } from '../../../../api/generated/api/invitaciones-recibidas.service';
import {
  CausaInvitacion,
  traducirErrorInvitacion,
} from '../../../organization/models/invitacion-errors';

/** En cual de los cinco estados esta la pantalla. */
type Estado =
  | { readonly tipo: 'sin-token' }
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly causa: CausaInvitacion }
  | { readonly tipo: 'listo'; readonly invitacion: InvitacionPreviewResponse }
  | { readonly tipo: 'aceptada'; readonly cuentaCreada: boolean }
  | { readonly tipo: 'rechazada' };

/**
 * La invitacion, vista por quien la recibio (RF-M05-002, AKINE-02.03).
 *
 * <h2>Por que vive en `features/auth` y no en `organization`</h2>
 *
 * <p>Porque quien la abre <b>no tiene sesion</b>, y muchas veces ni cuenta. Es la misma familia
 * que `activar` y `restablecer`: pantallas publicas cuya autoridad es un token que llego por
 * correo. Ponerla detras de `authGuard` la volveria inalcanzable justo para el caso que
 * justifica la etapa.
 *
 * <h2>El token no se guarda en ningun lado</h2>
 *
 * <p>Se lee de la query, vive en un signal mientras la pantalla esta abierta y se va con ella.
 * Es la misma regla que 01.02 fijo para los otros dos enlaces de correo: persistirlo lo dejaria
 * sobreviviendo a la navegacion, y es una credencial.
 *
 * <h2>Las tres cosas que esta pantalla decide mostrar</h2>
 *
 * <p><b>1. Pide nombre y contrasena solo si hacen falta.</b> El backend dice
 * `requiereRegistro` en el preview, asi que la pantalla ya sabe antes de dibujar el formulario.
 * A quien ya tiene cuenta pedirle una contrasena nueva seria pedirle que la cambie sin querer.
 *
 * <p><b>2. El enlace vencido no es un error del sistema.</b> Es el unico caso donde el backend
 * responde 409 en vez de 404, y la pantalla lo aprovecha: dice que vencio y cual es la salida
 * —pedir un reenvio— en vez de "no encontrado", que manda a reportar una falla.
 *
 * <p><b>3. Aceptar no abre sesion.</b> El contrato no la devuelve, y el javadoc de
 * `AcceptedInvitacionResponse` explica por que. Lo que hace la pantalla es mandar al login
 * diciendo cual de los dos casos es: la contrasena que acaba de elegir, o la de siempre.
 */
@Component({
  selector: 'app-invitacion-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './invitacion-page.html',
  styleUrl: '../../auth.css',
})
export class InvitacionPage {
  private readonly invitaciones = inject(InvitacionesRecibidasService);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly estado = signal<Estado>({ tipo: 'cargando' });
  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly intentos = signal(0);

  /**
   * El token del enlace.
   *
   * <p>Se lee una sola vez al construir y <b>no se persiste</b>: ni en `localStorage` —que la
   * regla de lint prohibe— ni en ningun store. Vive lo que vive la pantalla.
   */
  private readonly token = signal<string | null>(null);

  protected readonly invitacion = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.invitacion : null;
  });

  protected readonly mensajeError = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  /** `true` cuando el enlace vencio: es el unico error con una salida propia. */
  protected readonly vencida = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' && actual.causa === 'vencida';
  });

  /** `true` cuando hay que pedir nombre y contrasena. Lo decide el backend, no la pantalla. */
  protected readonly requiereRegistro = computed(
    () => this.invitacion()?.requiereRegistro === true,
  );

  protected readonly formularioAlta = this.formBuilder.nonNullable.group({
    nombre: [''],
    apellido: [''],
    password: [''],
  });

  constructor() {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (token === null || token.trim() === '') {
      this.estado.set({ tipo: 'sin-token' });
      return;
    }
    this.token.set(token);
    this.consultar();
  }

  /**
   * Lee la invitacion sin consumirla.
   *
   * <p>El backend garantiza que consultar no la resuelve, asi que recargar la pantalla —o que
   * el cliente de correo pre-visite el enlace— no le quita al invitado la posibilidad de
   * aceptar.
   */
  protected consultar(): void {
    const token = this.token();
    if (token === null) {
      return;
    }

    this.estado.set({ tipo: 'cargando' });

    this.invitaciones
      .previewInvitacion({ invitacionTokenRequest: { token } })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          const traducido = traducirErrorInvitacion(respuesta);
          this.estado.set({
            tipo: 'error',
            mensaje: traducido.mensaje,
            causa: traducido.causa,
          });
          return;
        }
        this.estado.set({ tipo: 'listo', invitacion: respuesta });
      });
  }

  protected mostrarErrorDe(campo: 'nombre' | 'password'): boolean {
    const control = this.formularioAlta.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected aceptar(): void {
    const token = this.token();
    if (token === null || this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);

    const cuerpo: AcceptInvitacionRequest = { token };

    if (this.requiereRegistro()) {
      // Los validadores se ponen aca y no en el grupo porque son condicionales: a quien ya
      // tiene cuenta no se le pide nada. Declararlos siempre haria que el formulario de esa
      // persona fuera invalido sin que ningun campo le sea aplicable.
      this.formularioAlta.controls.nombre.setValidators([Validators.required]);
      this.formularioAlta.controls.password.setValidators([
        Validators.required,
        Validators.minLength(10),
      ]);
      this.formularioAlta.controls.nombre.updateValueAndValidity();
      this.formularioAlta.controls.password.updateValueAndValidity();

      if (this.formularioAlta.invalid) {
        this.formularioAlta.markAllAsTouched();
        this.enfocar(
          this.formularioAlta.controls.nombre.invalid
            ? '#invitacion-nombre'
            : '#invitacion-password',
        );
        return;
      }

      const valores = this.formularioAlta.getRawValue();
      cuerpo.nombre = valores.nombre.trim();
      cuerpo.password = valores.password;
      const apellido = valores.apellido.trim();
      if (apellido !== '') {
        cuerpo.apellido = apellido;
      }
    }

    this.enviando.set(true);
    this.errorAccion.set(null);

    this.invitaciones.acceptInvitacion({ acceptInvitacionRequest: cuerpo }).subscribe({
      next: (respuesta) => {
        this.enviando.set(false);
        this.estado.set({ tipo: 'aceptada', cuentaCreada: respuesta.cuentaCreada === true });
      },
      error: (error: unknown) => {
        const traducido = traducirErrorInvitacion(error);
        this.enviando.set(false);
        this.errorAccion.set(traducido.mensaje);
      },
    });
  }

  /**
   * Rechaza la invitacion.
   *
   * <p>Sin motivo: el contrato lo acepta opcional y la pantalla no lo pide. A nadie se le exige
   * explicar por que no quiere entrar a trabajar a un lado, y un campo de texto ahi convierte
   * un "no, gracias" de un click en un formulario.
   */
  protected rechazar(): void {
    const token = this.token();
    if (token === null || this.enviando()) {
      return;
    }

    this.enviando.set(true);
    this.errorAccion.set(null);

    this.invitaciones.declineInvitacion({ declineInvitacionRequest: { token } }).subscribe({
      next: () => {
        this.enviando.set(false);
        this.estado.set({ tipo: 'rechazada' });
      },
      error: (error: unknown) => {
        const traducido = traducirErrorInvitacion(error);
        this.enviando.set(false);
        this.errorAccion.set(traducido.mensaje);
      },
    });
  }

  /** `true` si la aceptacion creo la cuenta en este acto. Cambia el texto del cierre. */
  protected cuentaReciencreada(): boolean {
    const actual = this.estado();
    return actual.tipo === 'aceptada' && actual.cuentaCreada;
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}
