import { DOCUMENT } from '@angular/common';
import {
  Component,
  DestroyRef,
  HostListener,
  Injector,
  ViewContainerRef,
  afterNextRender,
  computed,
  effect,
  inject,
  inputBinding,
  outputBinding,
  signal,
  viewChild,
} from '@angular/core';
import {
  ActivatedRoute,
  ActivatedRouteSnapshot,
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';

import { AnchoDeContenido, DATA_ANCHO } from './core/models/ancho-de-contenido';
import { AvisosStore } from './core/services/avisos.store';
import { FlujoDeTurnosStore } from './core/services/flujo-de-turnos.store';
import { BarraSuperiorDiferida } from './layout/barra-superior/barra-superior-diferida';
import { CambioDeSede } from './layout/selector-de-sede/cambio-de-sede';
import { PermissionsStore } from './core/services/permissions.store';
import { PlatformRoleStore } from './core/services/platform-role.store';
import { PreferenciasStore } from './core/services/preferencias.store';
import { ServicioNoDisponibleStore } from './core/services/servicio-no-disponible.store';
import { SessionService } from './core/services/session.service';
import { TenantContextStore } from './core/services/tenant-context.store';

/**
 * Shell de la aplicacion (AKINE-00.02, rehecho en UX-01).
 *
 * <p>Layout puro: barra lateral, barra superior y `main`. No sabe de pantallas.
 *
 * <p><b>El ancho del contenido lo decide la ruta.</b> Es la unica decision de pantalla que
 * vive aca, y vive aca porque el `main` es del shell. Una ruta que muestra una tabla declara
 * `data: { ancho: 'amplio' }` y el shell le da 76rem; el resto se queda en los 46rem de
 * lectura. Un unico ancho para todo no sirve: con 46rem la tabla de colaboradores desborda
 * y con 76rem los parrafos del login miden 150 caracteres por renglon.
 *
 * <p>Se lee del <b>ultimo</b> `ActivatedRouteSnapshot` de la cadena en cada `NavigationEnd`:
 * la ruta hoja es la que sabe si es una tabla, no el `loadChildren` que la monta.
 *
 * <p><b>El menu de tablet lo gobierna el shell.</b> La barra superior tiene el boton y la
 * barra lateral el panel; el estado es uno solo y vive aca. Se cierra al navegar, con Escape
 * y tocando el fondo. Al abrir, el foco entra al panel; al cerrar con Escape, vuelve al
 * boton: sin eso el teclado queda parado en un panel que ya no esta.
 *
 * <p><b>Las dos barras llegan despues de la primera pintura</b> (07/11/2026), cada una en su chunk:
 * la carga inicial esta al borde de su presupuesto y entre las dos, con el icono, pesan mas de
 * 25 kB. La lateral no se dibuja hasta que la sesion termina de restaurarse, que tarda mas que bajar
 * el chunk; la superior deja en su lugar a {@link BarraSuperiorDiferida}, con el mismo alto y la
 * marca. No van en `@defer`, que suma su runtime (~7 kB) a la carga inicial.
 */
@Component({
  selector: 'app-root',
  imports: [BarraSuperiorDiferida, RouterLink, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly router = inject(Router);
  private readonly raiz = inject(ActivatedRoute);
  private readonly documento = inject(DOCUMENT);
  private readonly servicio = inject(ServicioNoDisponibleStore);
  private readonly session = inject(SessionService);
  private readonly tenant = inject(TenantContextStore);
  private readonly injector = inject(Injector);

  private readonly anclaNavegacion = viewChild.required('navegacion', { read: ViewContainerRef });
  private readonly anclaAvisos = viewChild.required('avisos', { read: ViewContainerRef });
  private readonly anclaFlujo = viewChild.required('flujoDeTurnos', { read: ViewContainerRef });

  constructor() {
    // El tema elegido en Preferencias se aplica al arrancar, antes de la primera pantalla.
    inject(PreferenciasStore);

    // Avisos globales: el contenedor llega en su propio chunk despues de la primera pintura (la
    // carga inicial esta al borde de su presupuesto), y antes de cualquier accion del usuario,
    // asi su region viva ya existe cuando llega el primer aviso.
    const avisos = inject(AvisosStore);
    let destruido = false;
    inject(DestroyRef).onDestroy(() => (destruido = true));
    afterNextRender(() => {
      // La barra lateral: hasta que llega, el shell se dibuja sin su columna (`conBarraLateral`).
      import('./layout/navegacion-principal/navegacion-principal').then(
        (m) => {
          if (!destruido) {
            this.anclaNavegacion().createComponent(m.NavegacionPrincipal, {
              bindings: [
                inputBinding('abierto', this.menuAbierto),
                outputBinding('cerrar', () => this.cerrarMenu()),
              ],
            });
            this.navegacionMontada.set(true);
          }
        },
        // Sin el chunk no hay barra lateral, pero la pantalla sigue.
        () => undefined,
      );
      import('./layout/avisos/avisos').then(
        (m) => {
          if (!destruido) {
            this.anclaAvisos().createComponent(m.Avisos);
          }
        },
        // Sin el chunk (red caida, despliegue nuevo) no hay avisos, pero la pantalla sigue.
        () => undefined,
      );
    });

    // El flujo de turnos llega en su propio chunk la primera vez que alguien lo pide, desde cualquier
    // feature: pedirlo por el store es lo que evita importar `scheduling` desde afuera (ADR-0004).
    const flujo = inject(FlujoDeTurnosStore);
    let flujoMontado = false;
    effect(() => {
      if (flujo.solicitud() === null || flujoMontado) {
        return;
      }
      flujoMontado = true;
      import('./features/scheduling/flujo/flujo-de-turnos').then(
        (m) => {
          if (!destruido) {
            this.anclaFlujo().createComponent(m.FlujoDeTurnos);
          }
        },
        () => {
          flujoMontado = false;
          flujo.cerrar();
          avisos.error('No pudimos abrir el panel de turnos', {
            descripcion: 'Revisá tu conexión y volvé a intentar.',
          });
        },
      );
    });

    // Los permisos y el rol de plataforma deciden que enlaces muestra la barra lateral, y se piden
    // apenas hay contexto. Lo hace ella tambien, pero llega en su chunk y no tiene que demorarlos:
    // los dos stores ignoran el pedido repetido.
    const permisos = inject(PermissionsStore);
    const rolDePlataforma = inject(PlatformRoleStore);
    effect(() => {
      if (
        this.session.estado() === 'activa' &&
        this.tenant.context() !== null &&
        !permisos.cargados()
      ) {
        permisos.asegurarCargados();
      }
    });
    effect(() => {
      if (this.session.estado() !== 'anonimo') {
        rolDePlataforma.asegurarCargado();
      }
    });

    // Al cerrar sesion nada de lo que decian los avisos sigue siendo cierto.
    effect(() => {
      if (this.session.estado() === 'anonimo') {
        avisos.vaciar();
        flujo.cerrar();
      }
    });
  }

  protected readonly avisoDeServicio = this.servicio.aviso;

  protected readonly cambiandoDeSede = inject(CambioDeSede).cambiandoA;

  protected readonly menuAbierto = signal(false);

  /** Ya llego el chunk de la barra lateral. */
  private readonly navegacionMontada = signal(false);

  /**
   * Hay barra lateral cuando hay contexto: es la misma condicion con la que ella se dibuja. Y
   * cuando ya llego: sin ella su columna quedaria vacia y la pagina caeria adentro.
   */
  protected readonly conBarraLateral = computed(
    () =>
      this.navegacionMontada() &&
      !this.session.restaurando() &&
      this.session.estado() === 'activa' &&
      this.tenant.context() !== null,
  );

  protected cerrarAvisoDeServicio(): void {
    this.servicio.descartar();
  }

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((evento) => evento instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** Pantallas de acceso: tarjeta centrada, sin barra superior ni lateral. */
  protected readonly esAcceso = computed(() =>
    /^\/(auth|seleccionar-contexto)(\/|\?|$)/.test(this.url()),
  );

  protected readonly ancho = toSignal(
    this.router.events.pipe(
      filter((evento) => evento instanceof NavigationEnd),
      startWith(null),
      map(() => {
        this.menuAbierto.set(false);
        return anchoDe(this.raiz.snapshot);
      }),
    ),
    { initialValue: 'lectura' as AnchoDeContenido },
  );

  protected saltarAlContenido(evento: Event): void {
    evento.preventDefault();
    this.documento.getElementById('contenido')?.focus();
  }

  protected alternarMenu(): void {
    if (this.menuAbierto()) {
      this.cerrarMenu();
      return;
    }
    this.menuAbierto.set(true);
    // El panel recien se vuelve visible despues del proximo render: enfocar antes no hace nada.
    afterNextRender(
      () => this.documento.querySelector<HTMLElement>('#navegacion-principal a')?.focus(),
      { injector: this.injector },
    );
  }

  protected cerrarMenu(): void {
    this.menuAbierto.set(false);
  }

  @HostListener('document:keydown.escape')
  protected cerrarMenuConEscape(): void {
    if (!this.menuAbierto()) {
      return;
    }
    this.cerrarMenu();
    this.documento
      .querySelector<HTMLElement>('button[aria-controls="navegacion-principal"]')
      ?.focus();
  }
}

function anchoDe(snapshot: ActivatedRouteSnapshot): AnchoDeContenido {
  let actual = snapshot;
  while (actual.firstChild !== null) {
    actual = actual.firstChild;
  }
  return actual.data[DATA_ANCHO] === 'amplio' ? 'amplio' : 'lectura';
}
