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
import { BarraSuperior } from './layout/barra-superior/barra-superior';
import { CambioDeSede } from './layout/selector-de-sede/cambio-de-sede';
import { NavegacionPrincipal } from './layout/navegacion-principal/navegacion-principal';
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
 */
@Component({
  selector: 'app-root',
  imports: [BarraSuperior, NavegacionPrincipal, RouterLink, RouterOutlet],
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

  private readonly anclaAvisos = viewChild.required('avisos', { read: ViewContainerRef });

  constructor() {
    // El tema elegido en Preferencias se aplica al arrancar, antes de la primera pantalla.
    inject(PreferenciasStore);

    // Avisos globales: el contenedor llega en su propio chunk despues de la primera pintura (la
    // carga inicial esta al borde de su presupuesto), y antes de cualquier accion del usuario,
    // asi su region viva ya existe cuando llega el primer aviso.
    let destruido = false;
    inject(DestroyRef).onDestroy(() => (destruido = true));
    afterNextRender(() => {
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

    // Al cerrar sesion nada de lo que decian los avisos sigue siendo cierto.
    const avisos = inject(AvisosStore);
    effect(() => {
      if (this.session.estado() === 'anonimo') {
        avisos.vaciar();
      }
    });
  }

  protected readonly avisoDeServicio = this.servicio.aviso;

  protected readonly cambiandoDeSede = inject(CambioDeSede).cambiandoA;

  protected readonly menuAbierto = signal(false);

  /** Hay barra lateral cuando hay contexto: es la misma condicion con la que ella se dibuja. */
  protected readonly conBarraLateral = computed(
    () =>
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
