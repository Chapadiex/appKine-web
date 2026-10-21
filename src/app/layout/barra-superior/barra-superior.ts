import { Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Icono } from '../../shared/components/icono/icono';
import { PlatformRoleStore } from '../../core/services/platform-role.store';
import { RUTA_SOLICITUDES_DE_PLATAFORMA } from '../../features/platform/models/rutas-de-plataforma';
import { RUTA_INICIO } from '../navegacion-principal/secciones';
import { RUTA_SELECTOR_CONTEXTO } from '../../core/models/rutas';
import { SessionService } from '../../core/services/session.service';
import { TenantContextStore } from '../../core/services/tenant-context.store';

/**
 * Barra superior del shell (UX-01): para quien se trabaja y como cambiarlo.
 *
 * <p>Es el `header` de la pagina (landmark `banner`). Lleva el contexto activo con su enlace
 * "Cambiar", el boton que abre la barra lateral en tablet y, cuando no hay barra lateral, la
 * marca. Lo que no lleva: las secciones (estan en la barra lateral) y el eslogan (no cambia
 * nada de lo que el usuario hace y costaba 330 px en cada pantalla).
 *
 * <p><b>Sin contexto, es la unica salida.</b> Con un token `pre_context` ninguna seccion
 * responde, asi que el unico enlace util es el que resuelve eso. Y un administrador de
 * plataforma no es miembro de ningun centro: este es su unico camino a la consola (AKINE-A-7).
 *
 * <p><b>El contexto se dice una vez.</b> Cuando la sede se llama igual que el centro, repetir el
 * nombre ("Centro Norte · Centro Norte") no agrega informacion.
 */
@Component({
  selector: 'app-barra-superior',
  imports: [RouterLink, Icono],
  templateUrl: './barra-superior.html',
  styleUrl: './barra-superior.css',
})
export class BarraSuperior {
  private readonly session = inject(SessionService);
  private readonly tenant = inject(TenantContextStore);
  private readonly rolDePlataforma = inject(PlatformRoleStore);

  /** Si la barra lateral esta desplegada (tablet). Gobierna `aria-expanded` del boton. */
  readonly menuAbierto = input(false);

  /** El usuario pidio abrir o cerrar la barra lateral. */
  readonly alternarMenu = output<void>();

  protected readonly rutaInicio = RUTA_INICIO;
  protected readonly rutaSelector = RUTA_SELECTOR_CONTEXTO;
  protected readonly rutaPlataforma = RUTA_SOLICITUDES_DE_PLATAFORMA;
  protected readonly esAdminDePlataforma = this.rolDePlataforma.esAdminDePlataforma;

  protected readonly sesionResuelta = computed(() => !this.session.restaurando());

  protected readonly faltaContexto = computed(() => this.session.estado() === 'sin-contexto');

  protected readonly contexto = computed(() =>
    this.session.estado() === 'activa' ? this.tenant.context() : null,
  );

  /** La sede, solo cuando agrega algo al nombre del centro. */
  protected readonly sede = computed(() => {
    const activo = this.contexto();
    if (activo === null || !activo.consultorioName) {
      return null;
    }
    return activo.consultorioName === activo.organizationName ? null : activo.consultorioName;
  });

  protected alternar(): void {
    this.alternarMenu.emit();
  }
}
