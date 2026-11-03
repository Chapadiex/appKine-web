import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { DIAS_DE_LA_SEMANA, etiquetaDeDia } from '../../utils/dias-de-la-semana';
import { minutosDeHora, rangoHorario } from '../../utils/horas-de-pared';
import { FranjaSemanal } from '../../utils/franjas-semanales';

/**
 * La semana dibujada: una columna por dia y una barra por franja, para leer el horario de un
 * vistazo en una confirmacion. El texto equivalente va en `aria-label` y en el resumen que la
 * acompaña: el dibujo no dice nada que no este escrito.
 */
@Component({
  selector: 'app-semana-dibujada',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dibujo" role="img" [attr.aria-label]="descripcion()">
      @for (dia of columnas(); track dia.numero) {
        <div class="dibujo__dia">
          <span class="dibujo__nombre" aria-hidden="true">{{ dia.corto }}</span>
          <span class="dibujo__pista">
            @for (barra of dia.barras; track $index) {
              <span
                class="dibujo__barra"
                [style.top.%]="barra.arriba"
                [style.height.%]="barra.alto"
              ></span>
            }
          </span>
        </div>
      }
    </div>
  `,
  styles: `
    .dibujo {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: var(--esp-3);
      max-width: 21rem;
    }
    .dibujo__dia {
      display: flex;
      flex-direction: column;
      gap: var(--esp-2);
    }
    .dibujo__nombre {
      color: var(--color-texto-suave);
      font-size: var(--tipo-2xs);
      text-align: center;
    }
    .dibujo__pista {
      position: relative;
      height: 4.5rem;
      border-radius: var(--radio-sm);
      background: var(--color-superficie-sutil);
    }
    .dibujo__barra {
      position: absolute;
      right: 0.25rem;
      left: 0.25rem;
      border-radius: 0.1875rem;
      background: var(--color-acento);
    }
  `,
})
export class SemanaDibujada {
  readonly franjas = input.required<readonly FranjaSemanal[]>();

  /**
   * Al menos de 7 a 21, ampliada a horas enteras si el horario empieza antes o termina despues:
   * una escala pegada al horario llena cada columna y ya no se ve cuanto del dia abre.
   */
  private readonly escala = computed(() => {
    const minutos = this.franjas().flatMap((franja) =>
      [minutosDeHora(franja.horaDesde), minutosDeHora(franja.horaHasta)].filter(
        (valor): valor is number => valor !== null,
      ),
    );
    const inicio = Math.floor(Math.min(7 * 60, ...minutos) / 60) * 60;
    const fin = Math.ceil(Math.max(21 * 60, ...minutos) / 60) * 60;
    return { inicio, rango: fin - inicio };
  });

  protected readonly columnas = computed(() => {
    const { inicio, rango } = this.escala();
    return DIAS_DE_LA_SEMANA.map((dia) => ({
      numero: dia.numero,
      corto: dia.etiqueta.slice(0, 3),
      barras: this.franjas()
        .filter((franja) => franja.diaSemana === dia.numero)
        .flatMap((franja) => {
          const desde = minutosDeHora(franja.horaDesde);
          const hasta = minutosDeHora(franja.horaHasta);
          return desde === null || hasta === null
            ? []
            : [{ arriba: ((desde - inicio) / rango) * 100, alto: ((hasta - desde) / rango) * 100 }];
        }),
    }));
  });

  protected readonly descripcion = computed(() =>
    DIAS_DE_LA_SEMANA.map((dia) => {
      const propias = this.franjas().filter((franja) => franja.diaSemana === dia.numero);
      return propias.length === 0
        ? `${etiquetaDeDia(dia.numero)} cerrada`
        : `${etiquetaDeDia(dia.numero)} ${propias
            .map((franja) => rangoHorario(franja.horaDesde, franja.horaHasta))
            .join(' y ')}`;
    }).join('; '),
  );
}

/**
 * El horario redactado por dia, juntando los dias seguidos con el mismo horario:
 * "Lunes a viernes: 09:00 a 18:00", "Sabado: 08:00 a 13:00".
 */
export function horarioRedactado(franjas: readonly FranjaSemanal[]): string[] {
  const porDia = DIAS_DE_LA_SEMANA.map((dia) => ({
    numero: dia.numero,
    texto: franjas
      .filter((franja) => franja.diaSemana === dia.numero)
      .map((franja) => rangoHorario(franja.horaDesde, franja.horaHasta))
      .join(' y '),
  })).filter((dia) => dia.texto !== '');

  const grupos: { desde: number; hasta: number; texto: string }[] = [];
  for (const dia of porDia) {
    const ultimo = grupos.at(-1);
    if (ultimo !== undefined && ultimo.texto === dia.texto && ultimo.hasta === dia.numero - 1) {
      ultimo.hasta = dia.numero;
    } else {
      grupos.push({ desde: dia.numero, hasta: dia.numero, texto: dia.texto });
    }
  }

  return grupos.map(({ desde, hasta, texto }) => {
    const nombre =
      desde === hasta
        ? etiquetaDeDia(desde)
        : `${etiquetaDeDia(desde)} ${hasta === desde + 1 ? 'y' : 'a'} ${etiquetaDeDia(hasta).toLowerCase()}`;
    return `${nombre}: ${texto}`;
  });
}
