import {
  DestroyRef,
  Directive,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  input,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';

/** Lo que se puede enfocar adentro de un panel, en orden de documento. */
const ENFOCABLES =
  'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), ' +
  'button:not([disabled]), a[href]';

/**
 * Lleva el foco a lo que acaba de aparecer y, cuando desaparece, lo devuelve a quien lo abrio
 * (WCAG 2.4.3, orden del foco). AKINE-09.02.
 *
 * <pre>
 * &lt;section akineFocoAlMontar aria-labelledby="titulo-resultado"&gt;...&lt;/section&gt;
 * &lt;section akineFocoAlMontar="campo"&gt;&lt;form&gt;...&lt;/form&gt;&lt;/section&gt;
 * </pre>
 *
 * <p><b>Al montarse</b> enfoca el propio elemento —con `tabindex="-1"` si no era enfocable, para
 * que el lector de pantalla lea su rotulo y el Tab siga desde ahi— o, con `"campo"`, el primer
 * control habilitado de adentro. Es lo que necesitan los dos casos que se repiten en las
 * pantallas: el <b>resultado de una accion</b> que reemplaza al boton que la disparo (el foco del
 * boton se perdia con el) y el <b>panel</b> que se abre mas abajo, lejos del control que lo pidio.
 *
 * <p><b>Al desmontarse</b>, si el foco quedo huerfano en el `body`, vuelve al elemento que lo
 * tenia cuando el bloque aparecio, si sigue en la pantalla. Si la pantalla ya lo movio a otro
 * lado, no se le pisa la decision. Es el mismo criterio de `confirmacion-con-motivo`.
 *
 * <p>No sabe de dominio: no mira que bloque es ni por que aparecio.
 */
@Directive({ selector: '[akineFocoAlMontar]' })
export class FocoAlMontar {
  /** `''` enfoca el propio elemento; `'campo'`, el primer control habilitado de adentro. */
  readonly akineFocoAlMontar = input<'' | 'campo'>('');

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const documento = inject(DOCUMENT);
    const injector = inject(Injector);
    const activo = documento.activeElement;
    const disparador = activo instanceof HTMLElement && activo !== documento.body ? activo : null;

    afterNextRender(
      () => {
        const destino =
          this.akineFocoAlMontar() === 'campo'
            ? (host.querySelector<HTMLElement>(ENFOCABLES) ?? host)
            : host;
        if (destino === host && !host.hasAttribute('tabindex')) {
          host.setAttribute('tabindex', '-1');
        }
        destino.focus();
      },
      { injector },
    );

    inject(DestroyRef).onDestroy(() => {
      // Despues del desmontaje: recien ahi se sabe si el foco quedo huerfano.
      setTimeout(() => {
        const huerfano =
          documento.activeElement === null || documento.activeElement === documento.body;
        if (huerfano && disparador?.isConnected) {
          disparador.focus();
        }
      });
    });
  }
}
