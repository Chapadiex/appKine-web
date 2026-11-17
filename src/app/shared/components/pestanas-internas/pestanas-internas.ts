import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  model,
} from '@angular/core';

/** Una pestaña dentro de una pantalla. `conDatos` marca la que ya tiene algo cargado. */
export interface PestanaInterna {
  readonly id: string;
  readonly etiqueta: string;
  readonly conDatos?: boolean;
}

/**
 * Pestañas dentro de una misma pantalla (modo táctil, 16/11/2026): reparten un formulario largo en
 * partes que entran sin scroll. A diferencia de `app-pestanas`, no navega: cambia `activa` y la
 * página muestra el panel que corresponde, así lo escrito en otra pestaña sigue en memoria.
 *
 * <p>Patrón ARIA de pestañas: `role="tablist"`, cada pestaña `aria-selected` y `aria-controls`
 * apuntando a `panel-{id}`, que la página pone en su `role="tabpanel"`. Flechas y Home/End mueven
 * y activan; Tab entra a la pestaña activa y sale al panel.
 */
@Component({
  selector: 'app-pestanas-internas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pestanas-internas.css',
  host: { role: 'tablist', '[attr.aria-label]': 'etiqueta()', class: 'pestanas-internas' },
  template: `
    @for (pestana of pestanas(); track pestana.id; let i = $index) {
      <button
        type="button"
        role="tab"
        class="pestana-interna"
        [id]="'pestana-' + pestana.id"
        [attr.aria-selected]="pestana.id === activa()"
        [attr.aria-controls]="'panel-' + pestana.id"
        [attr.tabindex]="pestana.id === activa() ? 0 : -1"
        (click)="activa.set(pestana.id)"
        (keydown)="alTeclear($event, i)"
      >
        {{ pestana.etiqueta }}
        @if (pestana.conDatos) {
          <span class="pestana-interna__punto" aria-hidden="true"></span>
          <span class="visualmente-oculto">(con datos)</span>
        }
      </button>
    }
  `,
})
export class PestanasInternas {
  readonly pestanas = input.required<readonly PestanaInterna[]>();
  readonly etiqueta = input.required<string>();
  readonly activa = model.required<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected alTeclear(evento: KeyboardEvent, indice: number): void {
    const total = this.pestanas().length;
    const destinos: Record<string, number> = {
      ArrowRight: (indice + 1) % total,
      ArrowLeft: (indice - 1 + total) % total,
      Home: 0,
      End: total - 1,
    };
    const destino = destinos[evento.key];
    if (destino === undefined) {
      return;
    }
    evento.preventDefault();
    this.activa.set(this.pestanas()[destino].id);
    this.host.nativeElement.querySelectorAll<HTMLButtonElement>('[role="tab"]')[destino]?.focus();
  }
}
