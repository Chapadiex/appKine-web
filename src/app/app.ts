import { Component, inject } from '@angular/core';
import {
  ActivatedRoute,
  ActivatedRouteSnapshot,
  NavigationEnd,
  Router,
  RouterOutlet,
} from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';

import { AnchoDeContenido, DATA_ANCHO } from './core/models/ancho-de-contenido';
import { NavegacionPrincipal } from './layout/navegacion-principal/navegacion-principal';

/**
 * Layout raiz de AKINE (AKINE-00.02).
 *
 * <p>Solo estructura: skip link, cabecera con la navegacion principal y el landmark `main`
 * donde el router monta cada pagina. <b>No contiene logica de pantalla</b> —eso vive en las
 * paginas de cada feature—.
 *
 * <p>La navegacion es un componente aparte ({@link NavegacionPrincipal}) y no plantilla suelta
 * aca: decide que mostrar leyendo la sesion, el contexto y los permisos efectivos, y meter esa
 * logica en el shell lo convertiria en la pantalla que este comentario dice que no es.
 *
 * <p>Aca viven las garantias de accesibilidad que toda pantalla hereda: el skip link como
 * primer elemento enfocable y los landmarks semanticos (ADR-0005).
 *
 * <p><b>El ancho del contenido lo decide la ruta.</b> Es la unica decision de pantalla que
 * el shell puede tomar, porque el `max-width` vive en un ancestro y ninguna pagina puede
 * ensanchar a su contenedor desde adentro. Una pagina de tabla declara
 * `data: { ancho: 'amplio' }` y el shell le da 76rem; el resto se queda en los 46rem de
 * lectura. Un unico ancho para todo no sirve: con 46rem la tabla de colaboradores desborda
 * 101 px y esconde la columna de acciones detras del scroll horizontal, y con 76rem para
 * todos los parrafos del login pasan a medir 150 caracteres por renglon.
 */
@Component({
  selector: 'app-root',
  imports: [NavegacionPrincipal, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly router = inject(Router);
  private readonly raiz = inject(ActivatedRoute);

  /**
   * Ancho pedido por la ruta activa mas profunda.
   *
   * <p>Se lee de la mas profunda y no de la raiz porque `data` no se hereda hacia abajo por
   * si solo: la pagina concreta -`organizacion/colaboradores`- es la que sabe que necesita
   * ancho, no el `loadChildren` que la monta.
   *
   * <p>`startWith` cubre la primera pantalla: si la app arranca directamente sobre una ruta
   * de tabla, el `NavigationEnd` inicial puede haber ocurrido antes de que este componente
   * se suscriba, y sin esto la tabla se dibujaria angosta hasta la siguiente navegacion.
   */
  protected readonly ancho = toSignal(
    this.router.events.pipe(
      filter((evento) => evento instanceof NavigationEnd),
      startWith(null),
      map(() => anchoDe(this.raiz.snapshot)),
    ),
    { initialValue: 'lectura' as AnchoDeContenido },
  );
}

/** Baja hasta la ruta activa mas profunda y devuelve el ancho que declaro, o el defecto. */
function anchoDe(snapshot: ActivatedRouteSnapshot): AnchoDeContenido {
  let actual = snapshot;
  while (actual.firstChild !== null) {
    actual = actual.firstChild;
  }
  return actual.data[DATA_ANCHO] === 'amplio' ? 'amplio' : 'lectura';
}
