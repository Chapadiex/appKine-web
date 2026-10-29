import {
  Component,
  Type,
  ViewContainerRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map, startWith } from 'rxjs';

import { Icono } from '../../shared/components/icono/icono';
import { Miga, MigasStore } from '../../core/services/migas.store';
import { PermissionsStore } from '../../core/services/permissions.store';
import { PlatformRoleStore } from '../../core/services/platform-role.store';
import { RUTA_SOLICITUDES_DE_PLATAFORMA } from '../../features/platform/models/rutas-de-plataforma';
import {
  RUTA_INICIO,
  SECCIONES,
  SECCIONES_DE_CUENTA,
  SECCION_PLATAFORMA,
  Seccion,
  seccionDe,
} from '../navegacion-principal/secciones';
import { RUTA_SELECTOR_CONTEXTO } from '../../core/models/rutas';
import { SessionService } from '../../core/services/session.service';
import { TenantContextStore } from '../../core/services/tenant-context.store';

/**
 * Barra superior del shell: la misma para todos los roles (UX-01, rehecha en el refactor de la
 * cabecera global del 28/10/2026).
 *
 * <p>Es el `header` de la pagina (landmark `banner`) y responde tres preguntas, siempre en el
 * mismo lugar: <b>donde estoy</b> (el titulo de la pantalla, a la izquierda), <b>donde estoy
 * trabajando</b> (la sede, a la derecha) y <b>quien soy</b> (el perfil, en el extremo). Lo que
 * cambia segun el rol no es la barra sino lo que hay adentro: las sedes habilitadas y el rol que
 * muestra el perfil. Lleva ademas el boton que abre la barra lateral en tablet.
 *
 * <p><b>Donde estoy es una ruta de navegacion</b> (29/10/2026): "Padrón / Pérez, Ana /
 * Coberturas del paciente". El ultimo paso es la pantalla y sale del `title` de la ruta ("AKINE -
 * Caja diaria" → "Caja diaria"), que toda pantalla declara para la pestana del navegador. Los
 * pasos anteriores siguen la jerarquia, no el historial: si la pantalla publico los suyos
 * ({@link publicarMigas}, con nombres propios), son esos; si no, la seccion del menu que la
 * contiene. En una seccion del menu hay un solo paso y se muestra como titulo, sin `nav`. En
 * telefono queda solo el paso anterior, como "volver".
 *
 * <p><b>Sin contexto, es la unica salida.</b> Con un token `pre_context` ninguna seccion
 * responde, asi que el unico enlace util es el que resuelve eso; un administrador de plataforma
 * no es miembro de ningun centro y este es su camino a la consola (AKINE-A-7). El perfil, con
 * "Cerrar sesion", esta tambien ahi.
 *
 * <p><b>Sede y perfil llegan despues de la primera pintura.</b> La carga inicial esta al borde de
 * su presupuesto (425 kB) y los dos desplegables suman casi 20 kB: se bajan en un chunk aparte
 * con un `import()` y se montan en sus anclas. No van en `@defer`, que suma su runtime (~7 kB) a
 * la carga inicial. Mientras tanto la barra muestra el nombre de la sede y el lugar del avatar.
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
  private readonly router = inject(Router);
  private readonly migasPublicadas = inject(MigasStore);
  private readonly permisos = inject(PermissionsStore);

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

  protected readonly nombreSede = computed(() => {
    const activo = this.contexto();
    return activo?.consultorioName || activo?.organizationName || '';
  });

  private readonly anclaSede = viewChild('anclaSede', { read: ViewContainerRef });
  private readonly anclaPerfil = viewChild('anclaPerfil', { read: ViewContainerRef });
  private readonly desplegables = signal<{
    readonly sede: Type<unknown>;
    readonly perfil: Type<unknown>;
  } | null>(null);

  /** Ya estan los componentes de verdad: las reservas de lugar se van. */
  protected readonly derechaMontada = computed(() => this.desplegables() !== null);

  private readonly ubicacion = toSignal(
    this.router.events.pipe(
      filter((evento) => evento instanceof NavigationEnd),
      startWith(null),
      map(() => ({
        camino: this.router.url.split(/[?#]/)[0] ?? '',
        titulo: tituloDe(this.router.routerState.snapshot.root),
      })),
    ),
    { initialValue: { camino: '', titulo: '' } },
  );

  /** Los pasos con enlace (de lo general a lo particular) y el nombre de la pantalla actual. */
  protected readonly migas = computed(() => {
    const { camino, titulo } = this.ubicacion();
    const publicadas = this.migasPublicadas.migas();
    const conRuta = publicadas.filter((miga) => miga.ruta);
    const seccion = seccionDe(camino, SECCIONES_DE_LA_BARRA);
    const anteriores: Miga[] =
      conRuta.length > 0 ? conRuta : seccion && this.visible(seccion) ? [seccion] : [];

    const enlaces: { readonly etiqueta: string; readonly ruta: string }[] = [];
    for (const miga of anteriores) {
      const ruta = this.aTexto(miga.ruta!);
      const repetida = enlaces.some((e) => e.ruta === ruta || e.etiqueta === miga.etiqueta);
      if (ruta !== camino && !repetida) {
        enlaces.push({ etiqueta: miga.etiqueta, ruta });
      }
    }
    const final = publicadas.at(-1);
    const actual = final && !final.ruta ? final.etiqueta : titulo;
    return { enlaces, actual };
  });

  constructor() {
    afterNextRender(() => {
      Promise.all([
        import('../selector-de-sede/selector-de-sede'),
        import('../menu-de-perfil/menu-de-perfil'),
      ]).then(
        ([sede, perfil]) =>
          this.desplegables.set({ sede: sede.SelectorDeSede, perfil: perfil.MenuDePerfil }),
        // Sin el chunk (red caida, despliegue nuevo) queda la reserva con el nombre de la sede.
        () => undefined,
      );
    });

    // Las anclas viven dentro de los `@if` de la sesion: si la rama se redibuja, el ancla nueva
    // llega vacia y se vuelve a montar.
    effect(() => {
      const desplegables = this.desplegables();
      const sede = this.anclaSede();
      const perfil = this.anclaPerfil();
      if (desplegables === null) {
        return;
      }
      untracked(() => {
        if (sede !== undefined && sede.length === 0) {
          sede.createComponent(desplegables.sede);
        }
        if (perfil !== undefined && perfil.length === 0) {
          perfil.createComponent(desplegables.perfil);
        }
      });
    });
  }

  protected alternar(): void {
    this.alternarMenu.emit();
  }

  /** Un paso hacia una seccion que la sesion no puede abrir llevaria a "sin permiso": no va. */
  private visible(seccion: Seccion): boolean {
    return seccion.permisos === undefined || this.permisos.tieneAlguno(...seccion.permisos);
  }

  private aTexto(ruta: string | readonly unknown[]): string {
    return typeof ruta === 'string'
      ? ruta
      : this.router.serializeUrl(this.router.createUrlTree([...ruta]));
  }
}

/** Donde puede caer una URL: las secciones del centro, la consola y las de la cuenta propia. */
const SECCIONES_DE_LA_BARRA: readonly Seccion[] = [
  ...SECCIONES,
  SECCION_PLATAFORMA,
  ...SECCIONES_DE_CUENTA,
];

/** El `title` de la ruta mas profunda que lo declara, sin el prefijo de la marca. */
export function tituloDe(raiz: ActivatedRouteSnapshot): string {
  let titulo: string | undefined;
  for (
    let actual: ActivatedRouteSnapshot | null = raiz;
    actual !== null;
    actual = actual.firstChild
  ) {
    titulo = actual.title ?? titulo;
  }
  return (titulo ?? '').replace(/^AKINE\s*-\s*/, '');
}
