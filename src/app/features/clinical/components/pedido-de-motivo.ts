import { Component, computed, inject, input, signal } from '@angular/core';

import { VisitaClinica } from '../services/visita-clinica';

/**
 * El formulario del motivo de acceso (DP-03). Lo muestra cualquier pantalla de la visita cuando el
 * backend responde 403 con `requiereJustificacion`: la historia, un caso o un plan abiertos por
 * enlace directo.
 *
 * <p>Escribe en {@link VisitaClinica} y nada mas. Cada pantalla relee cuando el motivo cambia, asi
 * que este componente no necesita saber que se estaba pidiendo.
 */
@Component({
  selector: 'app-pedido-de-motivo',
  template: `
    <section class="tarjeta" aria-labelledby="titulo-justificacion">
      <h2 id="titulo-justificacion">Declara el motivo del acceso</h2>
      <p class="ayuda">
        No figura que atiendas a esta persona en esta sede. Para ver {{ que() }} tenes que declarar
        el motivo. El motivo queda registrado junto con cada lectura que hagas en esta visita, y se
        vuelve a pedir la proxima vez que entres.
      </p>

      <form (submit)="$event.preventDefault(); justificar()">
        <div class="campo">
          <label for="motivo-acceso">Motivo del acceso</label>
          <input
            id="motivo-acceso"
            type="text"
            autocomplete="off"
            [value]="escrito()"
            [attr.aria-invalid]="intento() && falta()"
            [attr.aria-describedby]="
              intento() && falta() ? 'motivo-acceso-error' : 'motivo-acceso-ayuda'
            "
            (input)="escrito.set($any($event.target).value)"
          />
          <p id="motivo-acceso-ayuda" class="ayuda">
            Por ejemplo: "interconsulta pedida por el profesional tratante".
          </p>
          @if (intento() && falta()) {
            <p id="motivo-acceso-error" class="campo__error">Sin motivo no se puede seguir.</p>
          }
        </div>
        <div class="acciones">
          <button type="submit" class="boton">{{ accion() }}</button>
        </div>
      </form>
    </section>
  `,
})
export class PedidoDeMotivo {
  private readonly visita = inject(VisitaClinica);

  /** Lo que se esta por ver, en palabras: "su historia clinica", "este caso". */
  readonly que = input('su historia clinica');
  readonly accion = input('Ver la historia clinica');

  protected readonly escrito = signal('');
  protected readonly intento = signal(false);
  protected readonly falta = computed(() => this.escrito().trim() === '');

  protected justificar(): void {
    this.intento.set(true);
    if (!this.falta()) {
      this.visita.declarar(this.escrito());
    }
  }
}
