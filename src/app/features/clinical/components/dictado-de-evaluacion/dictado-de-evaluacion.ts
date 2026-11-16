import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';

import { PropuestaDeEvaluacionDictada } from '../../../../api/generated/model/propuesta-de-evaluacion-dictada';
import { Icono } from '../../../../shared/components/icono/icono';
import { ErrorDictado } from '../../../../shared/dictado/dictado-errors';
import { DictadoStore, MAXIMO_DE_GRABACION_MS } from '../../../../shared/dictado/dictado.store';
import { EVOLUCIONES, LATERALIDADES } from '../../models/etiquetas-de-atencion';

type Paso = 'reposo' | 'grabando' | 'procesando' | 'revision';

/** Un campo propuesto, con la casilla que decide si se aplica. */
interface FilaPropuesta {
  readonly clave: keyof PropuestaDeEvaluacionDictada;
  readonly rotulo: string;
  readonly valor: string;
}

const ROTULOS: Readonly<Record<keyof PropuestaDeEvaluacionDictada, string>> = {
  dolorEva: 'Dolor (EVA)',
  dolorZona: 'Zona',
  dolorLateralidad: 'Lateralidad',
  evolucion: 'Evolución',
  objetivoSesion: 'Objetivo de esta sesión',
  motivoClinico: 'Motivo clínico',
  limitacionFuncional: 'Limitación funcional',
  restante: 'Agregar a las notas',
};

/**
 * Dictar la evaluación de una vez: se graba, el servidor transcribe y propone cómo repartir lo
 * dicho entre los campos, y la persona marca qué aplicar. **No guarda nada**: aplicar completa los
 * campos de la pantalla y después hay que guardar la evaluación como siempre.
 */
@Component({
  selector: 'app-dictado-de-evaluacion',
  imports: [Icono],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dictado.disponible()) {
      <div class="dictado-evaluacion">
        @switch (paso()) {
          @case ('reposo') {
            <button type="button" class="boton boton--secundario boton--chico" (click)="grabar()">
              <app-icono nombre="microfono" /> Dictar evaluación
            </button>
          }
          @case ('grabando') {
            <button type="button" class="boton boton--peligro boton--chico" (click)="terminar()">
              <app-icono nombre="detener" /> Terminar dictado
            </button>
            <button
              type="button"
              class="boton boton--secundario boton--chico"
              (click)="descartar()"
            >
              Descartar
            </button>
            <span class="dictado-evaluacion__estado"
              >Grabando… decí dolor, zona, lado, evolución u objetivo.</span
            >
          }
          @case ('procesando') {
            <span class="dictado-evaluacion__estado" role="status">Procesando el dictado…</span>
          }
          @case ('revision') {
            <div class="dictado-evaluacion__revision" role="group" aria-labelledby="dictado-titulo">
              <p id="dictado-titulo" class="dictado-evaluacion__titulo">
                Revisá lo dictado antes de aplicarlo
              </p>
              <blockquote class="dictado-evaluacion__texto">{{ texto() }}</blockquote>
              @if (filas().length === 0) {
                <p>No se reconoció ningún campo de la evaluación en lo que dictaste.</p>
              } @else {
                <ul class="dictado-evaluacion__filas">
                  @for (fila of filas(); track fila.clave) {
                    <li>
                      <label>
                        <input
                          type="checkbox"
                          [checked]="marcadas().has(fila.clave)"
                          (change)="alternarFila(fila.clave)"
                        />
                        <span class="dictado-evaluacion__rotulo">{{ fila.rotulo }}:</span>
                        {{ fila.valor }}
                      </label>
                    </li>
                  }
                </ul>
              }
              <div class="dictado-evaluacion__acciones">
                <button
                  type="button"
                  class="boton boton--chico"
                  [disabled]="marcadas().size === 0"
                  (click)="aplicarMarcadas()"
                >
                  Aplicar a la evaluación
                </button>
                <button
                  type="button"
                  class="boton boton--secundario boton--chico"
                  (click)="reiniciar()"
                >
                  Descartar
                </button>
              </div>
              <p class="dictado-evaluacion__nota">
                Aplicar completa los campos; la evaluación se guarda con «Guardar evaluación».
              </p>
            </div>
          }
        }
      </div>
    }
  `,
  styles: `
    .dictado-evaluacion {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      margin-block: 0.25rem 0.75rem;
    }
    .dictado-evaluacion__estado {
      color: var(--color-texto-suave);
    }
    .dictado-evaluacion__revision {
      flex: 1 1 100%;
      padding: 0.75rem 1rem;
      border: 1px solid var(--color-borde);
      border-radius: 0.5rem;
      background: var(--color-superficie-sutil);
    }
    .dictado-evaluacion__titulo {
      margin: 0 0 0.5rem;
      font-weight: 500;
      color: var(--color-texto-fuerte);
    }
    .dictado-evaluacion__texto {
      margin: 0 0 0.75rem;
      padding-inline-start: 0.75rem;
      border-inline-start: 3px solid var(--color-borde-control);
      color: var(--color-texto-suave);
      font-style: italic;
    }
    .dictado-evaluacion__filas {
      margin: 0 0 0.75rem;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 0.375rem;
    }
    .dictado-evaluacion__filas label {
      display: flex;
      gap: 0.5rem;
      align-items: baseline;
    }
    .dictado-evaluacion__rotulo {
      font-weight: 500;
      white-space: nowrap;
    }
    .dictado-evaluacion__acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .dictado-evaluacion__nota {
      margin: 0.5rem 0 0;
      font-size: 0.875rem;
      color: var(--color-texto-suave);
    }
  `,
})
export class DictadoDeEvaluacion {
  /** Los campos marcados, para que la pantalla los vuelque en sus señales. */
  readonly aplicar = output<PropuestaDeEvaluacionDictada>();
  /** Un error para mostrar en la pantalla. */
  readonly problema = output<string>();

  protected readonly dictado = inject(DictadoStore);

  private readonly procesando = signal(false);
  protected readonly texto = signal('');
  private readonly propuesta = signal<PropuestaDeEvaluacionDictada | null>(null);
  protected readonly marcadas = signal<ReadonlySet<keyof PropuestaDeEvaluacionDictada>>(new Set());
  private limite: ReturnType<typeof setTimeout> | undefined;

  protected readonly paso = computed<Paso>(() => {
    if (this.procesando()) {
      return 'procesando';
    }
    if (this.propuesta()) {
      return 'revision';
    }
    return this.dictado.grabando(this) ? 'grabando' : 'reposo';
  });

  protected readonly filas = computed<readonly FilaPropuesta[]>(() => {
    const p = this.propuesta();
    if (!p) {
      return [];
    }
    return (Object.keys(ROTULOS) as (keyof PropuestaDeEvaluacionDictada)[])
      .filter((clave) => p[clave] !== undefined && p[clave] !== null && p[clave] !== '')
      .map((clave) => ({ clave, rotulo: ROTULOS[clave], valor: legible(clave, p[clave]!) }));
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.limite);
      this.dictado.cancelar(this);
    });
  }

  protected async grabar(): Promise<void> {
    try {
      await this.dictado.empezar(this);
      this.limite = setTimeout(() => {
        this.terminar().catch(() => undefined);
      }, MAXIMO_DE_GRABACION_MS);
    } catch (error) {
      this.problema.emit((error as ErrorDictado).mensaje);
    }
  }

  protected descartar(): void {
    clearTimeout(this.limite);
    this.dictado.cancelar(this);
  }

  protected async terminar(): Promise<void> {
    clearTimeout(this.limite);
    if (!this.dictado.grabando(this)) {
      return;
    }
    this.procesando.set(true);
    try {
      const texto = await this.dictado.transcribir(this);
      if (!texto) {
        this.problema.emit(
          'No se entendió el dictado. Probá de nuevo hablando más cerca del micrófono.',
        );
        return;
      }
      const propuesta = await this.dictado.proponerEvaluacion(texto);
      this.texto.set(texto);
      this.propuesta.set(propuesta);
      this.marcadas.set(new Set(this.filas().map((f) => f.clave)));
    } catch (error) {
      this.problema.emit((error as ErrorDictado).mensaje);
    } finally {
      this.procesando.set(false);
    }
  }

  protected alternarFila(clave: keyof PropuestaDeEvaluacionDictada): void {
    const nuevas = new Set(this.marcadas());
    if (!nuevas.delete(clave)) {
      nuevas.add(clave);
    }
    this.marcadas.set(nuevas);
  }

  protected aplicarMarcadas(): void {
    const p = this.propuesta();
    if (!p) {
      return;
    }
    const elegida: Record<string, unknown> = {};
    for (const clave of this.marcadas()) {
      elegida[clave] = p[clave];
    }
    this.aplicar.emit(elegida as PropuestaDeEvaluacionDictada);
    this.reiniciar();
  }

  protected reiniciar(): void {
    this.propuesta.set(null);
    this.texto.set('');
    this.marcadas.set(new Set());
  }
}

function legible(clave: keyof PropuestaDeEvaluacionDictada, valor: string | number): string {
  if (clave === 'dolorEva') {
    return `${valor} de 10`;
  }
  if (clave === 'dolorLateralidad') {
    return LATERALIDADES.find((o) => o.valor === valor)?.etiqueta ?? String(valor);
  }
  if (clave === 'evolucion') {
    return EVOLUCIONES.find((o) => o.valor === valor)?.etiqueta ?? String(valor);
  }
  return String(valor);
}
