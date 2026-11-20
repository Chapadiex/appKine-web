import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

import { ContratacionStore } from '../../../../core/services/contratacion.store';
import { Icono, type NombreDeIcono } from '../../../../shared/components/icono/icono';

interface PasoDeLaCarga {
  readonly icono: NombreDeIcono;
  readonly titulo: string;
  readonly texto: string;
}

const PASOS: readonly PasoDeLaCarga[] = [
  { icono: 'edificio', titulo: 'Tu sede', texto: 'Nombre, contacto y duración del turno.' },
  { icono: 'sede', titulo: 'Dónde está', texto: 'La dirección que ven los pacientes.' },
  { icono: 'horarios', titulo: 'Cuándo atiende', texto: 'Con el horario la agenda da turnos.' },
];

/**
 * Bienvenida del primer ingreso de un centro (20/11/2026): un cartel modal al abrir la
 * configuración inicial. Agradece, dice si el centro está en la prueba gratis o con un plan
 * contratado, cuenta qué se va a cargar ahora y adónde ir después.
 *
 * <p>Modal nativo (`showModal`): el foco queda adentro y Escape cierra igual que "Empezar". Quien
 * la muestra la saca del DOM al recibir `empezar`.
 */
@Component({
  selector: 'app-bienvenida-inicial',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icono],
  template: `
    <dialog
      #dialogo
      class="bienvenida"
      aria-labelledby="bienvenida-titulo"
      aria-describedby="bienvenida-texto"
      (cancel)="alCancelar($event)"
    >
      <div class="bienvenida__cabecera">
        <span class="bienvenida__logo" aria-hidden="true">A</span>
        @if (diasDePrueba(); as dias) {
          <span class="bienvenida__plan bienvenida__plan--prueba">
            <app-icono nombre="calendario" />
            Prueba gratis · {{ dias === 1 ? 'queda 1 día' : 'quedan ' + dias + ' días' }}
          </span>
        } @else if (planNombre(); as plan) {
          <span class="bienvenida__plan bienvenida__plan--activo">
            <app-icono nombre="exito" />
            {{ plan }} activo
          </span>
        }
      </div>

      <h2 id="bienvenida-titulo" class="bienvenida__titulo">¡Te damos la bienvenida a AKINE!</h2>
      <p id="bienvenida-texto" class="bienvenida__texto">
        Gracias por elegirnos para <b>{{ nombreCentro() }}</b>. Antes de empezar vamos a hacer una
        primera carga de tu centro; son unos minutos y todo se puede cambiar después.
      </p>

      <ol class="bienvenida__pasos">
        @for (paso of pasos; track paso.titulo; let i = $index) {
          <li>
            <span class="bienvenida__numero" aria-hidden="true">{{ i + 1 }}</span>
            <app-icono [nombre]="paso.icono" />
            <span>
              <b>{{ paso.titulo }}</b>
              <span class="bienvenida__detalle">{{ paso.texto }}</span>
            </span>
          </li>
        }
      </ol>

      <p class="bienvenida__despues">
        Después vas a poder sumar a tu equipo en <b>Colaboradores</b>, cargar pacientes en el
        <b>Padrón</b> y dar turnos desde la <b>Agenda</b>. Si te perdés, tocá <b>Ayuda</b> o apretá
        <kbd>F1</kbd> en cualquier pantalla.
      </p>

      <div class="bienvenida__acciones">
        <button type="button" class="boton" (click)="empezar.emit()">Empezar la carga</button>
      </div>
    </dialog>
  `,
  styles: `
    .bienvenida {
      width: min(34rem, calc(100vw - 2rem));
      max-height: calc(100dvh - 2rem);
      padding: var(--esp-8);
      border: var(--borde-fino) solid var(--color-borde);
      border-radius: var(--radio-lg);
      background: var(--color-superficie);
      color: var(--color-texto);
      box-shadow: var(--sombra-flotante);
    }

    .bienvenida::backdrop {
      background: rgb(15 23 42 / 0.45);
    }

    .bienvenida__cabecera {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--esp-4);
      margin-bottom: var(--esp-6);
    }

    .bienvenida__logo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.5rem;
      height: 2.5rem;
      border-radius: var(--radio-md);
      background: var(--color-accion-fondo);
      color: var(--color-accion-texto);
      font-size: var(--tipo-lg);
      font-weight: var(--peso-fuerte);
    }

    .bienvenida__plan {
      display: inline-flex;
      align-items: center;
      gap: var(--esp-2);
      padding: var(--esp-1) var(--esp-4);
      border: var(--borde-fino) solid;
      border-radius: 999px;
      font-size: var(--tipo-xs);
      font-weight: var(--peso-medio);
    }

    .bienvenida__plan--prueba {
      border-color: var(--color-aviso);
      background: var(--color-aviso-fondo);
      color: var(--color-aviso-texto);
    }

    .bienvenida__plan--activo {
      border-color: var(--color-exito);
      background: var(--color-exito-fondo);
      color: var(--color-exito-texto);
    }

    .bienvenida__titulo {
      margin: 0 0 var(--esp-4);
      font-size: var(--tipo-xl);
    }

    .bienvenida__texto,
    .bienvenida__despues {
      margin: 0;
      color: var(--color-texto-suave);
    }

    .bienvenida__pasos {
      display: flex;
      flex-direction: column;
      gap: var(--esp-4);
      margin: var(--esp-6) 0;
      padding: var(--esp-5);
      border-radius: var(--radio-md);
      background: var(--color-superficie-sutil);
      list-style: none;
    }

    .bienvenida__pasos li {
      display: flex;
      align-items: center;
      gap: var(--esp-4);
    }

    .bienvenida__pasos li app-icono {
      color: var(--color-acento);
    }

    .bienvenida__numero {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 1.5rem;
      height: 1.5rem;
      border-radius: 50%;
      background: var(--color-accion-fondo);
      color: var(--color-accion-texto);
      font-size: var(--tipo-xs);
      font-weight: var(--peso-fuerte);
    }

    .bienvenida__detalle {
      display: block;
      color: var(--color-texto-suave);
      font-size: var(--tipo-xs);
    }

    .bienvenida__acciones {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--esp-7);
    }
  `,
})
export class BienvenidaInicial {
  /** El nombre del centro, para el agradecimiento. */
  readonly nombreCentro = input.required<string>();

  /** "Empezar la carga" o Escape: quien la muestra la saca del DOM. */
  readonly empezar = output<void>();

  private readonly contratacion = inject(ContratacionStore);
  private readonly dialogo = viewChild.required<ElementRef<HTMLDialogElement>>('dialogo');

  protected readonly pasos = PASOS;
  protected readonly diasDePrueba = this.contratacion.diasDePrueba;
  protected readonly planNombre = computed(() => this.contratacion.contratacion()?.planNombre);

  constructor() {
    afterNextRender(() => {
      const dialogo = this.dialogo().nativeElement;
      // jsdom no implementa `showModal`: ahí queda abierto como diálogo no modal.
      if (typeof dialogo.showModal === 'function' && !dialogo.open) {
        dialogo.showModal();
      } else {
        dialogo.setAttribute('open', '');
      }
      dialogo.querySelector<HTMLElement>('.bienvenida__acciones .boton')?.focus();
    });
  }

  protected alCancelar(evento: Event): void {
    evento.preventDefault();
    this.empezar.emit();
  }
}
