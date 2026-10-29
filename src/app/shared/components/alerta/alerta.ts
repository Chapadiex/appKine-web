import { ChangeDetectionStrategy, Component, ViewEncapsulation, input } from '@angular/core';

import { Icono } from '../icono/icono';

export type TipoDeAlerta = 'error' | 'advertencia' | 'info' | 'exito';

/**
 * Alerta en el lugar (refactor UX/UI del 28/10/2026): un problema o una coincidencia que el usuario
 * tiene que ver <b>mientras corrige</b>, y que por eso no puede ser un aviso que se va solo.
 *
 * <ul>
 *   <li><b>Error general de un formulario</b> ("No pudimos guardar la persona"): arriba del
 *       formulario, nunca al pie, donde lo tapa la barra de acciones.</li>
 *   <li><b>Coincidencia con algo que ya existe</b> ("Esta persona ya está registrada" + Ver
 *       persona): pegada a los campos que la produjeron.</li>
 *   <li><b>Bloqueo de una pantalla</b> (no se pudo leer, falta contexto).</li>
 * </ul>
 *
 * <p>El resultado de una operacion que salio bien NO va aca: es un aviso global (`AvisosStore`).
 *
 * <p>Severidad con icono y texto, no solo con color. Un error o una advertencia es
 * `role="alert"`: se anuncia al aparecer. El contenido (descripcion, enlaces, botones) se
 * proyecta. No sabe de dominio.
 */
@Component({
  selector: 'app-alerta',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [Icono],
  styleUrl: './alerta.css',
  host: {
    '[class]': '"alerta alerta--" + tipo()',
    '[attr.role]': 'tipo() === "error" || tipo() === "advertencia" ? "alert" : "status"',
  },
  template: `
    <app-icono class="alerta__icono" [nombre]="tipo()" />
    <div class="alerta__cuerpo">
      @if (titulo(); as texto) {
        <p class="alerta__titulo">{{ texto }}</p>
      }
      <ng-content />
    </div>
  `,
})
export class Alerta {
  readonly tipo = input<TipoDeAlerta>('error');

  /** Una frase con lo que pasó: "No pudimos guardar la persona". */
  readonly titulo = input<string | null>(null);
}
