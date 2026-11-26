import {
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map, startWith } from 'rxjs';

import { Icono } from '../../shared/components/icono/icono';
import { FuncionesIaStore } from '../../core/services/funciones-ia.store';
import { ContratacionStore } from '../../core/services/contratacion.store';
import { ContadoresDePlataformaStore } from '../../core/services/contadores-de-plataforma.store';
import { MarcaStore } from '../../core/services/marca.store';
import { PermissionsStore } from '../../core/services/permissions.store';
import { RUTA_SELECTOR_CONTEXTO } from '../../core/models/rutas';
import { PlatformRoleStore } from '../../core/services/platform-role.store';
import {
  RUTA_INICIO_DE_PLATAFORMA,
  RUTA_SOLICITUDES_DE_PLATAFORMA,
} from '../../features/platform/models/rutas-de-plataforma';
import {
  GRUPOS,
  GRUPOS_DE_PLATAFORMA,
  GrupoDeSecciones,
  RUTA_INICIO,
  SECCION_PLATAFORMA,
  Seccion,
  seccionDe,
} from './secciones';
import { ManualStore } from '../../core/services/manual.store';
import { PreferenciasStore } from '../../core/services/preferencias.store';
import { PrimerosPasosStore } from '../../core/guards/primeros-pasos.guard';
import { PERMISO_ASISTENTE_USE } from '../../core/models/permisos';
import { SessionService } from '../../core/services/session.service';
import { TenantContextStore } from '../../core/services/tenant-context.store';

/**
 * Barra lateral de navegacion (UX-01).
 *
 * <p>Lleva la marca y las secciones de {@link GRUPOS}, y nada mas: la sede y la cuenta viven en la
 * barra superior desde el refactor de la cabecera global (28/10/2026). Las secciones van agrupadas
 * y todas en el DOM, aun con su grupo plegado: los E2E de permisos buscan los enlaces por nombre.
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
  imports: [RouterLink, Icono],
  templateUrl: './navegacion-principal.html',
  styleUrl: './navegacion-principal.css',
})
export class NavegacionPrincipal {
  private readonly session = inject(SessionService);
  protected readonly manual = inject(ManualStore);
  private readonly tenant = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);
  private readonly funcionesIa = inject(FuncionesIaStore);
  protected readonly preferencias = inject(PreferenciasStore);
  private readonly primerosPasos = inject(PrimerosPasosStore);
  private readonly contratacion = inject(ContratacionStore);
  private readonly rolDePlataforma = inject(PlatformRoleStore);
  private readonly contadores = inject(ContadoresDePlataformaStore);
  private readonly router = inject(Router);

  /** En tablet, si el panel esta desplegado. En escritorio no tiene efecto. */
  readonly abierto = input(false);

  /** Pide cerrar el panel: se navego a una seccion. */
  readonly cerrar = output<void>();

  /** Marca del centro: su logo reemplaza al de AKINE cuando lo cargo. */
  protected readonly logoDelCentro = inject(MarcaStore).logoUrl;
  protected readonly nombreDelCentro = computed(
    () => this.tenant.context()?.organizationName ?? '',
  );

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
  /**
   * Consola de plataforma sin centro elegido (19/11/2026): la barra muestra sus grupos. Antes la
   * consola quedaba sin barra y se recorria con pestañas sueltas.
   */
  protected readonly modoPlataforma = computed(
    () =>
      (!this.hayContexto() || this.enRutaDePlataforma()) &&
      this.session.estado() !== 'anonimo' &&
      this.rolDePlataforma.esAdminDePlataforma(),
  );

  /**
   * Con centro elegido, la consola igual muestra solo sus grupos (19/11/2026): mezclados con
   * Atencion, Servicios o Configuracion del centro parecian accesos de la plataforma. Para entrar
   * a un centro queda un enlace al pie, que lleva al selector.
   */
  private readonly enRutaDePlataforma = computed(
    () => this.url().split(/[?#]/)[0]?.startsWith('/plataforma') === true,
  );
  protected readonly volverAlCentro = computed(() => this.modoPlataforma() && this.hayContexto());
  /** Al selector y no al inicio: quien sale de la consola elige a que centro entra. */
  protected readonly rutaDelCentro = RUTA_SELECTOR_CONTEXTO;

  protected readonly mostrarBarra = computed(
    () => !this.session.restaurando() && (this.hayContexto() || this.modoPlataforma()),
  );

  protected readonly rutaInicio = computed(() =>
    this.modoPlataforma() ? RUTA_INICIO_DE_PLATAFORMA : RUTA_INICIO,
  );

  protected readonly grupos = computed<readonly GrupoDeSecciones[]>(() =>
    (this.modoPlataforma() ? GRUPOS_DE_PLATAFORMA : GRUPOS)
      .map((grupo) => ({
        ...grupo,
        secciones: grupo.secciones.filter((seccion) => this.visible(seccion)),
      }))
      .filter((grupo) => grupo.secciones.length > 0),
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

    // Insignias de la consola: se piden solo en modo plataforma, y se releen en cada navegacion a
    // una pantalla `/plataforma/...` (ahi es donde un pedido o un centro cambia de estado).
    effect(() => {
      if (!this.modoPlataforma()) {
        return;
      }
      const enPlataforma = this.enRutaDePlataforma();
      untracked(() =>
        enPlataforma ? this.contadores.refrescar() : this.contadores.asegurarCargados(),
      );
    });
  }

  /** El numero de la insignia de una seccion, o `null` si no lleva o no hay nada que contar. */
  protected contador(seccion: Seccion): number | null {
    if (seccion.contador === undefined) {
      return null;
    }
    const valor = this.contadores.valor(seccion.contador);
    return valor !== null && valor > 0 ? valor : null;
  }

  /** Lo que la insignia le dice a un lector de pantalla: "12 activos", "3 pendientes". */
  protected textoDelContador(seccion: Seccion, valor: number): string {
    return seccion.contador === 'centros-activos'
      ? `${valor} ${valor === 1 ? 'activo' : 'activos'}`
      : `${valor} ${valor === 1 ? 'pendiente' : 'pendientes'}`;
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

  protected navegar(): void {
    this.cerrar.emit();
  }

  /** Abre el manual en la ficha de la pantalla actual, o lo cierra si ya está abierto; en tablet cierra antes el menú. */
  protected abrirAyuda(): void {
    this.cerrar.emit();
    this.manual.alternar();
  }

  /** Vuelve a mostrar el recorrido guiado del menú. */
  protected verGuiaRapida(): void {
    this.cerrar.emit();
    this.primerosPasos.mostrarGuias();
  }

  protected readonly asistenteDisponible = computed(
    () => this.permisos.tiene(PERMISO_ASISTENTE_USE) && this.funcionesIa.activa('ASISTENTE'),
  );

  /** Muestra u oculta el botón flotante del asistente; la elección queda en este navegador. */
  protected alternarAsistente(): void {
    this.preferencias.mostrarAsistente(!this.preferencias.asistenteVisible());
  }

  private visible(seccion: Seccion): boolean {
    const conPermiso =
      seccion.permisos === undefined || this.permisos.tieneAlguno(...seccion.permisos);
    return (
      conPermiso &&
      (seccion.funcionIa === undefined || this.funcionesIa.activa(seccion.funcionIa)) &&
      (seccion.servicio === undefined ||
        this.contratacion.tiene(seccion.servicio) ||
        this.contratacion.enLectura(seccion.servicio))
    );
  }
}
