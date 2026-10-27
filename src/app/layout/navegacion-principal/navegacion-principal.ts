import {
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map, startWith } from 'rxjs';

import { Icono } from '../../shared/components/icono/icono';
import { PermissionsStore } from '../../core/services/permissions.store';
import { PlatformRoleStore } from '../../core/services/platform-role.store';
import { QuienIngreso } from '../quien-ingreso/quien-ingreso';
import { RUTA_LOGIN, RUTA_SELECTOR_CONTEXTO } from '../../core/models/rutas';
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
  // `QuienIngreso` solo se usa dentro de un `@defer`: sale en un chunk aparte (DP-45).
  imports: [RouterLink, Icono, QuienIngreso],
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
  protected readonly rutaSelector = RUTA_SELECTOR_CONTEXTO;
  protected readonly contexto = this.tenant.context;
  protected readonly saliendo = signal(false);
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
      ...grupo,
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

  /** El grupo que contiene la seccion actual: es el que se ve desplegado al llegar. */
  private readonly grupoActual = computed(
    () =>
      this.grupos().find((grupo) => grupo.secciones.some((s) => this.esActual(s)))?.etiqueta ??
      null,
  );

  /**
   * El grupo desplegado. Arranca en el de la seccion actual y vuelve a el en cada navegacion; en
   * el medio, lo decide el usuario. Uno solo a la vez (acordeon): con todos abiertos la barra
   * volvia a ser la lista de diecisiete entradas que este cambio vino a sacar.
   */
  protected readonly grupoAbierto = linkedSignal<string | null>(() => this.grupoActual());

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

  protected contieneActual(grupo: GrupoDeSecciones): boolean {
    return grupo.etiqueta === this.grupoActual();
  }

  /**
   * Sincroniza el acordeon con el `details` que el usuario abrio o cerro. Al abrir uno, el
   * navegador cierra el otro (`name` compartido) y su evento llega despues: por eso un cierre solo
   * limpia si era el grupo abierto.
   */
  protected alAlternar(grupo: GrupoDeSecciones, evento: Event): void {
    const abierto = (evento.target as HTMLDetailsElement).open;
    if (abierto) {
      this.grupoAbierto.set(grupo.etiqueta);
    } else if (this.grupoAbierto() === grupo.etiqueta) {
      this.grupoAbierto.set(null);
    }
  }

  /** Dos letras para el avatar del centro: "Consultorio Centro" → "CC". */
  protected iniciales(nombre: string): string {
    return nombre
      .split(/\s+/)
      .filter((palabra) => palabra.length > 0)
      .slice(0, 2)
      .map((palabra) => palabra[0]!.toUpperCase())
      .join('');
  }

  /** Cierra la sesion y vuelve al login. Un logout que falla en el servidor igual limpia el local. */
  protected cerrarSesion(): void {
    this.saliendo.set(true);
    this.session.logout().subscribe({
      complete: () => {
        this.saliendo.set(false);
        this.cerrar.emit();
        this.router.navigateByUrl(RUTA_LOGIN).catch(() => undefined);
      },
    });
  }

  protected navegar(): void {
    this.cerrar.emit();
  }

  private visible(seccion: Seccion): boolean {
    return seccion.permisos === undefined || this.permisos.tieneAlguno(...seccion.permisos);
  }
}
