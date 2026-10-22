import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

interface Sugerencia {
  readonly texto: string;
  readonly cumplida: boolean;
}

/**
 * Guia visual para quien elige una contrasena nueva (decidido el 22/10/2026).
 *
 * <p><b>Es una sugerencia y nada mas.</b> No es un validador: no toca los validadores del
 * formulario ni lo que se envia. La politica real la decide el backend y su rechazo se sigue
 * mostrando como siempre. Lo unico que replica de la pantalla es el minimo de 10 caracteres que
 * `invitacion` ya valida; "letras" y "numeros" son consejos genericos, no una regla del sistema.
 *
 * <p><b>Accesibilidad.</b> La barra es decorativa (`aria-hidden`); el texto que cambia mientras
 * se escribe vive en una region `aria-live="polite"`.
 */
@Component({
  selector: 'app-medidor-de-contrasena',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="medidor" [class]="'medidor medidor--nivel-' + cumplidas()">
      <div class="medidor__barra" aria-hidden="true">
        @for (paso of pasos; track paso) {
          <span class="medidor__tramo" [class.medidor__tramo--lleno]="paso <= cumplidas()"></span>
        }
      </div>
      <p class="medidor__resumen" aria-live="polite">{{ resumen() }}</p>
      <ul class="medidor__lista">
        @for (sugerencia of sugerencias(); track sugerencia.texto) {
          <li [class.medidor__item--cumplido]="sugerencia.cumplida">
            <span aria-hidden="true">{{ sugerencia.cumplida ? '✓' : '○' }}</span>
            {{ sugerencia.texto }}
            @if (sugerencia.cumplida) {
              <span class="visualmente-oculto">(cumplido)</span>
            }
          </li>
        }
      </ul>
    </div>
  `,
  styles: `
    .medidor {
      display: flex;
      flex-direction: column;
      gap: var(--esp-3);
      font-size: var(--tipo-sm);
    }

    .medidor__barra {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--esp-2);
    }

    .medidor__tramo {
      height: 4px;
      border-radius: 2px;
      background: var(--color-borde);
    }

    .medidor--nivel-1 .medidor__tramo--lleno {
      background: var(--color-peligro);
    }

    .medidor--nivel-2 .medidor__tramo--lleno {
      background: var(--color-aviso);
    }

    .medidor--nivel-3 .medidor__tramo--lleno {
      background: var(--color-exito);
    }

    .medidor__resumen {
      margin: 0;
      color: var(--color-texto-suave);
    }

    .medidor__lista {
      display: flex;
      flex-wrap: wrap;
      gap: var(--esp-2) var(--esp-5);
      margin: 0;
      padding: 0;
      list-style: none;
      color: var(--color-texto-suave);
    }

    .medidor__item--cumplido {
      color: var(--color-exito-texto);
    }
  `,
})
export class MedidorDeContrasena {
  /** Lo que se esta escribiendo. */
  readonly valor = input<string>('');

  protected readonly pasos = [1, 2, 3] as const;

  protected readonly sugerencias = computed<readonly Sugerencia[]>(() => {
    const valor = this.valor() ?? '';
    return [
      { texto: 'Al menos 10 caracteres', cumplida: valor.length >= 10 },
      { texto: 'Letras', cumplida: /\p{L}/u.test(valor) },
      { texto: 'Números', cumplida: /\d/.test(valor) },
    ];
  });

  protected readonly cumplidas = computed(
    () => this.sugerencias().filter((sugerencia) => sugerencia.cumplida).length,
  );

  protected readonly resumen = computed(() => {
    const faltan = this.sugerencias()
      .filter((sugerencia) => !sugerencia.cumplida)
      .map((sugerencia) => sugerencia.texto.toLowerCase());
    return faltan.length === 0
      ? 'Cumple las sugerencias. El sistema valida la política final al guardar.'
      : `Sugerencias, no reglas del sistema. Te falta: ${faltan.join(', ')}.`;
  });
}
