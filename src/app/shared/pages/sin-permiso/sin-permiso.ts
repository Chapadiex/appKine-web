import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TenantContextStore } from '../../../core/services/tenant-context.store';

/**
 * Pantalla de "no tenes permiso para esto" (AKINE-01.03).
 *
 * <p>Es el destino de {@link permissionGuard}, y cierra el `PENDIENTE(01.03)` que dejaba
 * {@link RUTA_SIN_PERMISO} cayendo en el comodin `**`. Un 404 ahi es una mentira util a
 * medias: le dice al usuario que la pagina no existe cuando existe y lo que falta es
 * autorizacion, y no le da ninguna pista de que hacer.
 *
 * <p><b>No pide credenciales.</b> Volver a autenticarse no otorga el permiso que falta —el
 * rol vive en la membership, no en la contrasena— y ademas dejaria al usuario en un bucle:
 * entra, vuelve a la misma URL, vuelve a faltarle el permiso. Lo que se ofrece son las dos
 * salidas reales: cambiar de contexto (los permisos son <b>de un contexto</b>, y puede
 * tenerlo en otra sede u otra organizacion) y volver al inicio.
 *
 * <p><b>Vive en `shared/` y no sabe de dominio</b> (AGENT.md seccion 4): no nombra ningun
 * permiso ni ninguna pantalla concreta. Y no muestra <b>cual</b> permiso falta a proposito:
 * el codigo interno no le dice nada al usuario y describir el mapa de permisos del sistema
 * a quien no lo tiene es informacion que no necesita. Lo unico que se le dice es a quien
 * pedirselo.
 *
 * <p>Muestra el contexto activo porque es la parte accionable del mensaje: "no tenes
 * permiso" es distinto de "no tenes permiso <b>en Centro Kine Norte</b>", y lo segundo es
 * lo que le permite darse cuenta de que estaba parado en la sede equivocada.
 */
@Component({
  selector: 'app-sin-permiso',
  imports: [RouterLink],
  templateUrl: './sin-permiso.html',
  styleUrl: './sin-permiso.css',
})
export class SinPermiso {
  private readonly tenantContext = inject(TenantContextStore);

  /** Nombre del contexto activo, o `null` si no hay ninguno elegido. */
  protected readonly contexto = computed(
    () => this.tenantContext.context()?.organizationName ?? null,
  );
}
