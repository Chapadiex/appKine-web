import { ChangeDetectionStrategy, Component, ViewEncapsulation, input } from '@angular/core';

/**
 * Cabecera de pantalla (29/10/2026): el unico patron de encabezado de toda la aplicacion.
 *
 * <p><b>Por que existe.</b> Cada pantalla armaba su cabecera a mano (`.titulo-con-ayuda`,
 * `.encabezado__acciones`, pestañas sueltas debajo) y cada una quedaba distinta: el titulo y el
 * alta cambiaban de lugar al pasar de Agenda a Recepcion, la fila ocupaba de 140 a 180 px y las
 * pestañas, con `overflow-x: auto`, sacaban una barra de desplazamiento vertical a la derecha.
 *
 * <p><b>Regiones</b>, siempre en el mismo orden y a la misma altura:
 *
 * <pre>
 *   [migas /] Titulo (?) [estado]   [contexto: ‹ semana › Hoy]          [accion principal]
 *   Pestaña | Pestaña | Pestaña
 * </pre>
 *
 * - `titulo` (input): el `h1`. Una sola linea; si no entra se corta con "…" y nunca invade la zona
 *   de la accion principal.
 * - `app-migas` (con `enLinea`): de donde viene la pantalla, antes del titulo.
 * - `app-ayuda`: el "?", pegado al titulo.
 * - Lo que no tenga region (marcas de estado, un dato corto): despues del "?".
 * - `[cabeceraContexto]`: controles que cambian lo que se mira (fecha, semana, "Hoy"). En la fila
 *   del titulo mientras entren; si no, bajan a una segunda linea antes que desplazar la pagina.
 * - `[cabeceraAcciones]`: la accion principal (y, si hay, las de la pantalla entera), siempre
 *   pegada al borde derecho. Sin acciones el lugar queda vacio y nada se corre.
 * - `app-pestanas`: las pantallas hermanas, en una segunda fila compacta.
 *
 * <p><b>Nunca desplaza.</b> Crece solo lo que su contenido pide; el scroll es del contenido de la
 * pagina.
 *
 * <p><b>Sin encapsulacion</b>, como `app-ayuda`: los estilos alcanzan a lo proyectado. Viven en su
 * hoja y no en `design-system.css` porque la hoja global entra en la carga inicial.
 *
 * <p><b>No sabe de dominio.</b> Recibe un titulo y proyecta lo demas.
 */
@Component({
  selector: 'app-cabecera-de-pagina',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './cabecera-de-pagina.html',
  styleUrl: './cabecera-de-pagina.css',
  host: { class: 'cabecera-pagina' },
})
export class CabeceraDePagina {
  /** El titulo de la pantalla, que se dibuja como su `h1`. */
  readonly titulo = input.required<string>();
}
