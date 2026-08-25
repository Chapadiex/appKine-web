import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Controles de paginacion de una lista paginada por el servidor.
 *
 * <p><b>No sabe que se esta paginando.</b> Recibe los dos numeros que definen el estado
 * -pagina actual en base 0 y total de paginas- y emite la pagina pedida. Quien la usa decide
 * que hacer con eso: recargar, cerrar un panel abierto, o las dos cosas. Meter aca cualquier
 * cosa que sepa de sedes, colaboradores o hechos auditados la volveria una pieza de dominio
 * y ya no podria vivir en `shared/` (AGENT.md 4.1).
 *
 * <p><b>Se esconde sola cuando hay una sola pagina.</b> Las tres pantallas que la
 * estrenan la envolvian en el mismo `@if (totalPaginas() > 1)`: si la condicion vive
 * afuera, la cuarta pantalla se la olvida y muestra "Pagina 1 de 1" con los dos botones
 * deshabilitados.
 *
 * <p><b>Sin hoja propia.</b> `.paginacion`, `.boton` y `.ayuda` los aporta
 * `src/design-system.css`, que es global. Un componente de `shared/` con su propia copia del
 * sistema de diseno era el sintoma de que no habia una hoja comun donde apoyarse.
 *
 * <p><b>Accesibilidad.</b> El `nav` lleva un `aria-label` propio de cada listado -puede
 * haber mas de una paginacion en una pantalla y "Paginacion" a secas no las distingue-, y
 * el indicador de posicion es texto real, no un `title`.
 */
@Component({
  selector: 'akine-paginacion, app-paginacion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './paginacion.html',
})
export class Paginacion {
  /** Pagina mostrada, en base 0 -como la pide el backend-. */
  readonly paginaActual = input.required<number>();

  /** Cuantas paginas hay en total. Con 0 o 1 el componente no renderiza nada. */
  readonly totalPaginas = input.required<number>();

  /** `aria-label` del `nav`. Ej: "Paginas de sedes". */
  readonly etiqueta = input.required<string>();

  /** Pagina pedida, ya validada contra los limites. */
  readonly cambioDePagina = output<number>();

  /**
   * Emite solo si la pagina existe.
   *
   * <p>Los botones ya estan deshabilitados en los extremos, pero la guarda se queda: un
   * `disabled` es una decision de la vista y un click sintetico o un teclado en un navegador
   * viejo pueden saltearla, y una pagina fuera de rango es un `400` o una lista vacia que se
   * lee como "no hay nada".
   */
  protected ir(numero: number): void {
    if (numero < 0 || numero >= this.totalPaginas()) {
      return;
    }
    this.cambioDePagina.emit(numero);
  }
}
