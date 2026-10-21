import { Component, computed, effect, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map, startWith } from 'rxjs';

import { PermissionsStore } from '../../core/services/permissions.store';
import { PlatformRoleStore } from '../../core/services/platform-role.store';
import { RUTA_SOLICITUDES_DE_PLATAFORMA } from '../../features/platform/models/rutas-de-plataforma';
import {
  GRUPOS,
  GrupoDeSecciones,
  RUTA_INICIO,
  SECCION_PLATAFORMA,
  Seccion,
  seccionDe,
} from './secciones';
import { SessionService } from '../../core/services/session.service';
import { TenantContextStore } from '../../core/services/tenant-context.store';

/**
 * Barra lateral de navegacion (UX-01).
 *
 * <p>Lleva la marca y las secciones de {@link GRUPOS}, agrupadas y todas visibles: ningun grupo
 * se pliega, porque lo que se pliega hay que descubrirlo, y porque los E2E de permisos buscan
 * los enlaces por nombre y un enlace plegado no esta en pantalla.
 *
 * <p><b>Que se muestra lo deciden la sesion, el contexto y los permisos.</b> Sin contexto no hay
 * barra: con un token `pre_context` ninguna seccion responde. Cada seccion declara en
 * {@link GRUPOS} el permiso que exige el `permissionGuard` de su ruta, y la barra esconde las que
 * faltan. Un grupo que se queda sin secciones visibles no se dibuja, rotulo incluido.
 *
 * <p><b>La seccion actual se calcula, no se delega a `routerLinkActive`.</b> Ese marca por
 * prefijo y en `/agenda/recepcion` dejaba dos entradas con `aria-current`; {@link seccionDe}
 * elige la de ruta mas larga.
 *
 * <p><b>En tablet es un panel.</b> `abierto` lo decide el shell (el boton de menu vive en la
 * barra superior) y `cerrar` se emite al navegar o al pedirlo con Escape. En escritorio el
 * input no cambia nada: la barra esta siempre a la vista.
 *
 * <p>Pide los permisos y el rol de plataforma apenas puede: es lo que decide que enlaces hay.
 */
@Component({
  selector: 'app-navegacion-principal',
  imports: [RouterLink],
  templateUrl: './navegacion-principal.html',
  styleUrl: './navegacion-principal.css',
})
export class NavegacionPrincipal {
  private readonly session = inject(SessionService);
  private readonly tenant = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);
  private readonly rolDePlataforma = inject(PlatformRoleStore);
  private readonly router = inject(Router);

  /** En tablet, si el panel esta desplegado. En escritorio no tiene efecto. */
  readonly abierto = input(false);

  /** Pide cerrar el panel: se navego a una seccion. */
  readonly cerrar = output<void>();

  protected readonly rutaInicio = RUTA_INICIO;
  protected readonly rutaPlataforma = RUTA_SOLICITUDES_DE_PLATAFORMA;
  protected readonly seccionPlataforma = SECCION_PLATAFORMA;
  protected readonly esAdminDePlataforma = this.rolDePlataforma.esAdminDePlataforma;

  private readonly hayContexto = computed(
    () => this.session.estado() === 'activa' && this.tenant.context() !== null,
  );

  /**
   * La barra espera a que la sesion termine de restaurarse (AKINE-LCP: entre el refresh y los
   * nombres de los contextos, la organizacion tiene un rotulo provisorio). Los permisos, en
   * cambio, se piden apenas hay contexto: es lo que adelanta.
   */
  protected readonly mostrarBarra = computed(
    () => !this.session.restaurando() && this.hayContexto(),
  );

  protected readonly grupos = computed<readonly GrupoDeSecciones[]>(() =>
    GRUPOS.map((grupo) => ({
      etiqueta: grupo.etiqueta,
      secciones: grupo.secciones.filter((seccion) => this.visible(seccion)),
    })).filter((grupo) => grupo.secciones.length > 0),
  );

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((evento) => evento instanceof NavigationEnd),
      startWith(null),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly seccionActual = computed(() =>
    seccionDe(this.url(), [
      ...this.grupos().flatMap((grupo) => grupo.secciones),
      ...(this.esAdminDePlataforma() ? [SECCION_PLATAFORMA] : []),
    ]),
  );

  constructor() {
    effect(() => {
      if (this.hayContexto() && !this.permisos.cargados()) {
        this.permisos.asegurarCargados();
      }
    });

    effect(() => {
      if (this.session.estado() !== 'anonimo') {
        this.rolDePlataforma.asegurarCargado();
      }
    });
  }

  protected esActual(seccion: Seccion): boolean {
    return this.seccionActual()?.ruta === seccion.ruta;
  }

  protected navegar(): void {
    this.cerrar.emit();
  }

  private visible(seccion: Seccion): boolean {
    return seccion.permisos === undefined || this.permisos.tieneAlguno(...seccion.permisos);
  }
}
