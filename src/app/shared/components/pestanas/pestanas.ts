import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/** Una pestana: un enlace a una pantalla hermana de la seccion. */
export interface Pestana {
  readonly etiqueta: string;

  readonly ruta: string;

  /**
   * `true` para marcar la pestana solo cuando la URL es exactamente su ruta. Hace falta en la
   * pestana raiz de la seccion (`/agenda`), que si no quedaria marcada en todas sus hermanas.
   */
  readonly exacta?: boolean;
}

/**
 * Navegacion secundaria de una seccion (UX-01): las pantallas hermanas, una al lado de la otra,
 * con la actual marcada.
 *
 * <p><b>Son enlaces, no `role="tab"`.</b> Cada pestana es una ruta con su propia URL, su titulo
 * y su historial: el patron ARIA de tabs es para paneles dentro de una misma pagina, y usarlo
 * aca le diria al lector de pantalla que cambiar de pestana no cambia de pagina, que es falso.
 * Lo que marca la actual es `aria-current="page"`, como en la barra lateral.
 *
 * <p><b>No sabe de dominio.</b> Recibe etiquetas y rutas; quien la usa decide cuales y con que
 * permiso. Por eso vive en `shared/` (AGENT.md 4.1).
 *
 * <p><b>Sin hoja propia.</b> `.pestanas` la aporta `src/design-system.css`.
 */
@Component({
  selector: 'akine-pestanas, app-pestanas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './pestanas.html',
})
export class Pestanas {
  /** Las pestanas, en orden. Con una sola no se renderiza nada: no hay entre que elegir. */
  readonly pestanas = input.required<readonly Pestana[]>();

  /** `aria-label` del `nav`. Ej: "Pantallas de la agenda". */
  readonly etiqueta = input.required<string>();
}
