import { Component, inject, signal } from '@angular/core';

import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { NotificacionesService } from '../../../../api/generated/api/notificaciones.service';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';

/**
 * Reintento manual de una notificacion FALLIDA o AGOTADA (RF-M26-005, AKINE A-3).
 *
 * <h2>Por que se pide el numero a mano</h2>
 *
 * <p>El contrato publica {@code retryNotification} y <b>nada mas</b> sobre notificaciones: no hay
 * listado de fallidas, y ninguna respuesta —tampoco la de invitaciones— trae el id de la
 * notificacion que genero. La pantalla no puede ofrecer "Reintentar" en una fila que no conoce,
 * asi que pide el numero que da soporte tecnico y lo dice. Es un hueco de contrato declarado, no
 * una decision de UX: cuando exista el listado, esto pasa a ser un boton por fila.
 *
 * <p>Va en Invitaciones porque es la unica notificacion del tenant que la persona ve nacer, y el
 * permiso es el mismo: {@code colaborador:manage}. La plantilla del padre la esconde sin el
 * permiso; el backend responde 403 igual.
 */
@Component({
  selector: 'app-reintento-de-notificacion',
  templateUrl: './reintento-de-notificacion.html',
  styleUrl: '../../organization.css',
})
export class ReintentoDeNotificacion {
  private readonly notificaciones = inject(NotificacionesService);
  private readonly contexto = inject(TenantContextStore);

  protected readonly numero = signal('');
  protected readonly enviando = signal(false);
  protected readonly exito = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected escribir(evento: Event): void {
    this.numero.set((evento.target as HTMLInputElement).value);
  }

  protected reintentar(evento: Event): void {
    evento.preventDefault();
    this.exito.set(null);
    this.error.set(null);

    const notificationId = Number(this.numero().trim());
    if (!Number.isInteger(notificationId) || notificationId <= 0) {
      this.error.set('Escribi el numero de la notificacion: es un entero positivo.');
      return;
    }
    const orgId = this.contexto.organizationId();
    if (orgId === null) {
      this.error.set(MENSAJE_SIN_CONTEXTO);
      return;
    }

    this.enviando.set(true);
    this.notificaciones.retryNotification({ orgId, notificationId }).subscribe({
      next: () => {
        this.enviando.set(false);
        this.exito.set(
          `La notificacion ${notificationId} volvio a la cola de envio. Se manda en el proximo ` +
            'ciclo; el negocio que la origino no se repite.',
        );
      },
      error: (error: unknown) => {
        this.enviando.set(false);
        this.error.set(traducir(error));
      },
    });
  }
}

const MENSAJE_SIN_CONTEXTO =
  'No hay una organizacion elegida, y la notificacion pertenece a una. Elegi el contexto y volve ' +
  'a intentar.';

function traducir(error: unknown): string {
  if (!(error instanceof AkineHttpError)) {
    return 'No pudimos reintentar la notificacion. Volve a intentar en un momento.';
  }
  if (error.esDeRed) {
    return 'No se pudo contactar al servidor. Revisa tu conexion y volve a intentar.';
  }
  if (error.problemType === 'missing-tenant-context') {
    return MENSAJE_SIN_CONTEXTO;
  }
  if (error.status === 403) {
    return 'No tenes permiso para reintentar notificaciones: hace falta administrar colaboradores.';
  }
  if (error.status === 404) {
    return (
      'No hay ninguna notificacion con ese numero en esta organizacion. Las de activacion de ' +
      'cuenta y recuperacion de contrasena no son de ningun centro y no se reintentan desde aca.'
    );
  }
  if (error.status === 409) {
    const estado = error.extension('estado');
    return typeof estado === 'string'
      ? `Esa notificacion no se puede reintentar: esta ${estado}, y solo se reintentan las FALLIDA o AGOTADA.`
      : 'Esa notificacion no se puede reintentar: solo se reintentan las FALLIDA o AGOTADA.';
  }
  return error.problem === null
    ? 'No pudimos reintentar la notificacion. Volve a intentar en un momento.'
    : error.mensaje;
}
