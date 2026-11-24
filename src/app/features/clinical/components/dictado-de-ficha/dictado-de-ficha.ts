import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';

import { Icono } from '../../../../shared/components/icono/icono';
import { ErrorDictado } from '../../../../shared/dictado/dictado-errors';
import { DictadoStore, MAXIMO_DE_GRABACION_MS } from '../../../../shared/dictado/dictado.store';
import {
  FichaDictada,
  interpretarDictadoDeFicha,
  nadaReconocido,
} from '../../models/dictado-de-ficha';

type Paso = 'reposo' | 'grabando' | 'procesando';

/**
 * Dictar todos los datos declarados de una vez: se graba recorriendo la pantalla ("ocupación
 * programador, peso 80, tiene diabetes, antecedentes…"), el servidor transcribe y la pantalla
 * reparte lo dicho con reglas. Al terminar se carga todo, sin paso de revisión (pedido del
 * usuario, 23/11/2026): lo que quedó mal se corrige en el campo o se da de baja como siempre.
 */
@Component({
  selector: 'app-dictado-de-ficha',
  imports: [Icono],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dictado-de-ficha.html',
  styleUrl: './dictado-de-ficha.css',
})
export class DictadoDeFicha {
  /** Lo entendido, para que la pantalla lo guarde. */
  readonly cargar = output<FichaDictada>();
  /** Un error para mostrar. */
  readonly problema = output<string>();

  protected readonly dictado = inject(DictadoStore);

  private readonly procesando = signal(false);
  private limite: ReturnType<typeof setTimeout> | undefined;

  protected readonly paso = computed<Paso>(() => {
    if (this.procesando()) {
      return 'procesando';
    }
    return this.dictado.grabando(this) ? 'grabando' : 'reposo';
  });

  /** El estado en palabras: el botón solo muestra un ícono. */
  protected readonly anuncio = computed(() =>
    this.paso() === 'grabando'
      ? 'Grabando el dictado. Tocá el botón para terminar y cargar, o Escape para descartar.'
      : this.paso() === 'procesando'
        ? 'Cargando lo dictado…'
        : '',
  );

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
      const entendido = interpretarDictadoDeFicha(texto);
      if (nadaReconocido(entendido)) {
        this.problema.emit(
          `No reconocí ningún dato en «${texto}». Probá nombrando cada campo: «peso 80», «tiene diabetes»…`,
        );
        return;
      }
      this.cargar.emit(entendido);
    } catch (error) {
      this.problema.emit((error as ErrorDictado).mensaje);
    } finally {
      this.procesando.set(false);
    }
  }
}
