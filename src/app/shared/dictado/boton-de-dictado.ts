import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ViewEncapsulation,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

import { AvisosStore } from '../../core/services/avisos.store';
import { Icono } from '../components/icono/icono';
import { ErrorDictado } from './dictado-errors';
import { DictadoStore, MAXIMO_DE_GRABACION_MS, agregarAlCampo } from './dictado.store';

type Estado = 'reposo' | 'grabando' | 'transcribiendo';

/**
 * El micrófono de un campo de texto. Lo monta la directiva `[appDictado]`; no se usa suelto.
 *
 * <p>Primer toque: graba. Segundo toque (o a los dos minutos): transcribe y agrega el texto al
 * final del campo. Escape descarta la grabación.
 */
@Component({
  selector: 'app-boton-de-dictado',
  imports: [Icono],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Los estilos de la envoltura y del campo viven afuera de este componente: van sin encapsular.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'dictado__boton-host' },
  template: `
    <button
      type="button"
      class="dictado__boton"
      [class.dictado__boton--grabando]="estado() === 'grabando'"
      [attr.aria-label]="etiqueta()"
      [attr.aria-pressed]="estado() === 'grabando'"
      [title]="etiqueta()"
      [disabled]="estado() === 'transcribiendo' || campoDeshabilitado()"
      (click)="alternar()"
      (keydown.escape)="descartar($event)"
    >
      @if (estado() === 'transcribiendo') {
        <span class="dictado__giro" aria-hidden="true"></span>
      } @else {
        <app-icono [nombre]="estado() === 'grabando' ? 'detener' : 'microfono'" />
      }
    </button>
    <span class="visualmente-oculto" aria-live="polite">{{ anuncio() }}</span>
  `,
  styles: `
    .dictado {
      display: block;
      position: relative;
    }
    .dictado > .dictado__campo {
      padding-inline-end: 2.75rem;
    }
    .dictado__boton-host {
      position: absolute;
      inset-inline-end: 0.25rem;
      top: 50%;
      transform: translateY(-50%);
    }
    .dictado--multilinea > .dictado__boton-host {
      top: auto;
      bottom: 0.375rem;
      transform: none;
    }
    .dictado__boton {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.25rem;
      height: 2.25rem;
      padding: 0;
      border: 1px solid transparent;
      border-radius: 999px;
      background: transparent;
      color: var(--color-texto-suave);
      font-size: 1.1rem;
      cursor: pointer;
    }
    .dictado__boton:hover:not(:disabled) {
      background: var(--color-hover);
      color: var(--color-texto);
    }
    .dictado__boton:focus-visible {
      outline: 2px solid var(--color-foco);
      outline-offset: 1px;
    }
    .dictado__boton:disabled {
      cursor: default;
      color: var(--color-deshabilitado);
    }
    .dictado__boton--grabando,
    .dictado__boton--grabando:hover:not(:disabled) {
      background: var(--color-peligro-fondo);
      border-color: var(--color-peligro);
      color: var(--color-peligro-texto);
    }
    .dictado__giro {
      width: 1rem;
      height: 1rem;
      border: 2px solid currentColor;
      border-inline-end-color: transparent;
      border-radius: 50%;
      animation: dictado-giro 0.8s linear infinite;
    }
    @keyframes dictado-giro {
      to {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: no-preference) {
      .dictado__boton--grabando {
        animation: dictado-pulso 1.4s ease-in-out infinite;
      }
    }
    @keyframes dictado-pulso {
      50% {
        box-shadow: 0 0 0 4px var(--color-peligro-fondo);
      }
    }
  `,
})
export class BotonDeDictado {
  /** El campo donde se agrega lo dictado. */
  readonly campo = input.required<HTMLInputElement | HTMLTextAreaElement>();

  private readonly dictado = inject(DictadoStore);
  private readonly avisos = inject(AvisosStore);

  protected readonly transcribiendo = signal(false);
  protected readonly anuncio = signal('');
  private limite: ReturnType<typeof setTimeout> | undefined;

  protected readonly estado = computed<Estado>(() => {
    if (this.transcribiendo()) {
      return 'transcribiendo';
    }
    return this.dictado.grabando(this) ? 'grabando' : 'reposo';
  });

  protected readonly etiqueta = computed(() => {
    const nombre = nombreDelCampo(this.campo());
    switch (this.estado()) {
      case 'grabando':
        return 'Terminar de dictar' + nombre;
      case 'transcribiendo':
        return 'Pasando el dictado a texto';
      default:
        return 'Dictar' + nombre;
    }
  });

  protected campoDeshabilitado(): boolean {
    const campo = this.campo();
    return campo.disabled || campo.readOnly;
  }

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.limite);
      this.dictado.cancelar(this);
    });
  }

  protected async alternar(): Promise<void> {
    if (this.estado() === 'grabando') {
      await this.terminar();
      return;
    }
    try {
      await this.dictado.empezar(this);
      this.anuncio.set('Grabando. Volvé a tocar el micrófono para terminar.');
      this.limite = setTimeout(() => {
        this.terminar().catch(() => undefined);
      }, MAXIMO_DE_GRABACION_MS);
    } catch (error) {
      this.avisar(error as ErrorDictado);
    }
  }

  protected descartar(evento: Event): void {
    if (this.estado() !== 'grabando') {
      return;
    }
    evento.preventDefault();
    evento.stopPropagation();
    clearTimeout(this.limite);
    this.dictado.cancelar(this);
    this.anuncio.set('Dictado descartado.');
  }

  private async terminar(): Promise<void> {
    clearTimeout(this.limite);
    if (!this.dictado.grabando(this)) {
      return;
    }
    this.transcribiendo.set(true);
    this.anuncio.set('Pasando el dictado a texto.');
    try {
      const texto = await this.dictado.transcribir(this);
      if (texto) {
        agregarAlCampo(this.campo(), texto);
        this.anuncio.set('Texto dictado agregado.');
      } else {
        this.anuncio.set('');
        this.avisos.info('No se entendió el dictado', {
          descripcion: 'Probá de nuevo hablando más cerca del micrófono.',
        });
      }
    } catch (error) {
      this.avisar(error as ErrorDictado);
    } finally {
      this.transcribiendo.set(false);
    }
  }

  private avisar(error: ErrorDictado): void {
    this.anuncio.set('');
    this.avisos.error(error.mensaje ?? 'No se pudo dictar.');
  }
}

/** " en «Zona»", con el texto del `<label>` del campo; vacío si no tiene. */
function nombreDelCampo(campo: HTMLElement): string {
  const etiqueta = campo.id
    ? campo.ownerDocument.querySelector(`label[for="${CSS.escape(campo.id)}"]`)
    : null;
  const texto = (
    etiqueta?.firstChild?.textContent ??
    campo.getAttribute('aria-label') ??
    ''
  ).trim();
  return texto ? ` en «${texto}»` : '';
}
