import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, afterNextRender, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Alerta } from '../../../../shared/components/alerta/alerta';
import { PieDeLanding } from '../pie-de-landing/pie-de-landing';

/**
 * Marco de las páginas legales de la landing: la misma cabecera mínima y el mismo pie, el título,
 * la fecha del borrador y el aviso de que el texto no está vigente. El contenido lo proyecta cada
 * página.
 */
@Component({
  selector: 'app-pagina-legal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Alerta, PieDeLanding],
  templateUrl: './pagina-legal.html',
  styleUrls: ['../../landing-comun.css', './pagina-legal.css'],
})
export class PaginaLegal {
  readonly titulo = input.required<string>();
  /** Fecha del borrador, tal como se lee: "19 de noviembre de 2026". */
  readonly fecha = input.required<string>();

  constructor() {
    // El router de la app no restaura el desplazamiento: desde el pie de la landing se llegaba al
    // final del texto. Arranca arriba, o en la sección que pida la dirección (#...).
    const documento = inject(DOCUMENT);
    afterNextRender(() => {
      const ancla = documento.location.hash.slice(1);
      if (ancla === '') {
        documento.defaultView?.scrollTo(0, 0);
      } else {
        // La sección recién existe ahora: el navegador no pudo ir a ella al cargar.
        documento.getElementById(decodeURIComponent(ancla))?.scrollIntoView();
      }
    });
  }
}
