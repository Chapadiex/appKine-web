import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Subscription } from 'rxjs';

import { AntecedenteResponse } from '../../../../api/generated/model/antecedente-response';
import { EventoClinicoResponse } from '../../../../api/generated/model/evento-clinico-response';
import { HistoriaClinicaResponse } from '../../../../api/generated/model/historia-clinica-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import {
  TIPOS_DE_ANTECEDENTE,
  etiquetaDeOrigen,
  fechaYHora,
  rotulo,
} from '../../models/etiquetas-de-historia';
import { ErrorHistoria, errorDeCausa, traducirErrorHistoria } from '../../models/historia-errors';
import { HistoriaClinicaApi, Justificacion } from '../../services/historia-clinica-api';
import { DetalleDeEntrada } from './components/detalle-de-entrada';
import { NuevaEntrada } from './components/nueva-entrada';
import { NuevoAdjunto } from './components/nuevo-adjunto';
import { TimelineClinico, claveDe } from './components/timeline-clinico';
import { VisorDeAdjunto } from './components/visor-de-adjunto';

type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'requiere-justificacion' }
  | { readonly tipo: 'sin-historia' }
  | { readonly tipo: 'lista'; readonly historia: HistoriaClinicaResponse }
  | { readonly tipo: 'error'; readonly error: ErrorHistoria };

/**
 * La Historia Clinica de una persona: cabecera, timeline y detalle (D-a, RF-M09-001/003, RF-M25).
 *
 * <h2>El motivo de acceso es de esta visita</h2>
 *
 * <p>DP-03: quien no tiene relacion asistencial con la persona declara un motivo, y cada lectura
 * se audita con el. La pantalla pide primero sin motivo —el backend sabe si hace falta, el cliente
 * no— y solo ante el 403 con `requiereJustificacion` muestra el formulario. El motivo vive en un
 * signal: recargar, cambiar de contexto o volver a entrar lo vuelve a pedir. Recordarlo entre
 * visitas convertiria el control en un formalismo.
 *
 * <h2>Cambiar de contexto vacia la pantalla</h2>
 *
 * <p>La historia es de la organizacion (DP-03). Si el usuario cambia de organizacion o de sede,
 * lo que habia en pantalla es de otro tenant o se leyo con otra relacion asistencial: se descarta
 * todo, motivo incluido, y se vuelve a pedir.
 */
@Component({
  selector: 'app-historia-clinica-page',
  imports: [TimelineClinico, DetalleDeEntrada, VisorDeAdjunto, NuevaEntrada, NuevoAdjunto],
  templateUrl: './historia-clinica-page.html',
  styleUrl: './historia-clinica.css',
})
export class HistoriaClinicaPage {
  private readonly api = inject(HistoriaClinicaApi);
  private readonly tenantContext = inject(TenantContextStore);

  readonly personaId = input.required<string>();

  protected readonly fechaYHora = fechaYHora;
  protected readonly etiquetaDeOrigen = etiquetaDeOrigen;

  protected readonly estado = signal<Estado>({ tipo: 'cargando' });
  protected readonly justificacion = signal<Justificacion>(null);
  protected readonly motivoEscrito = signal('');
  protected readonly intentoJustificar = signal(false);
  protected readonly abriendo = signal(false);
  protected readonly errorAlAbrir = signal<ErrorHistoria | null>(null);

  protected readonly seleccion = signal<EventoClinicoResponse | null>(null);
  protected readonly recargas = signal(0);

  protected readonly historia = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'lista' ? estado.historia : null;
  });

  protected readonly error = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.error : null;
  });

  protected readonly faltaMotivo = computed(() => this.motivoEscrito().trim() === '');
  protected readonly claveElegida = computed(() => {
    const evento = this.seleccion();
    return evento === null ? null : claveDe(evento);
  });

  /** El antecedente elegido, si sigue vigente: la cabecera solo trae los vigentes. */
  protected readonly antecedenteElegido = computed<AntecedenteResponse | null>(() => {
    const evento = this.seleccion();
    if (evento?.origen !== 'ANTECEDENTE_CLINICO') {
      return null;
    }
    return this.historia()?.antecedentes?.find((a) => a.id === evento.referencia) ?? null;
  });

  private pedido: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.pedido?.unsubscribe());

    effect(() => {
      this.personaId();
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.justificacion.set(null);
        this.motivoEscrito.set('');
        this.intentoJustificar.set(false);
        this.seleccion.set(null);
        this.cargar();
      });
    });
  }

  protected rotuloDeAntecedente(antecedente: AntecedenteResponse): string {
    return rotulo(TIPOS_DE_ANTECEDENTE, antecedente.tipo);
  }

  protected justificar(): void {
    this.intentoJustificar.set(true);
    if (this.faltaMotivo()) {
      return;
    }
    this.justificacion.set(this.motivoEscrito().trim());
    this.cargar();
  }

  protected reintentar(): void {
    this.cargar();
  }

  /** PUT idempotente: si otro la abrio en el medio, devuelve esa y no duplica nada. */
  protected abrirHistoria(): void {
    this.abriendo.set(true);
    this.errorAlAbrir.set(null);
    this.pedido?.unsubscribe();
    this.pedido = this.api.abrir(this.idDePersona(), this.justificacion()).subscribe({
      next: (historia) => {
        this.abriendo.set(false);
        this.estado.set({ tipo: 'lista', historia });
      },
      error: (error: unknown) => {
        this.abriendo.set(false);
        const traducido = traducirErrorHistoria(error);
        if (traducido.causa === 'requiere-justificacion') {
          this.estado.set({ tipo: 'requiere-justificacion' });
          return;
        }
        this.errorAlAbrir.set(traducido);
      },
    });
  }

  protected elegir(evento: EventoClinicoResponse): void {
    this.seleccion.set(evento);
  }

  protected cerrarDetalle(): void {
    this.seleccion.set(null);
  }

  /** Algo nuevo en la historia: el timeline se relee desde el principio para mostrarlo. */
  protected huboCambios(): void {
    this.recargas.update((n) => n + 1);
  }

  private cargar(): void {
    if (!Number.isSafeInteger(this.idDePersona()) || this.idDePersona() <= 0) {
      this.estado.set({ tipo: 'error', error: errorDeCausa('no-encontrado') });
      return;
    }
    this.estado.set({ tipo: 'cargando' });
    this.errorAlAbrir.set(null);
    this.pedido?.unsubscribe();
    this.pedido = this.api.ver(this.idDePersona(), this.justificacion()).subscribe({
      next: (historia) => this.estado.set({ tipo: 'lista', historia }),
      error: (error: unknown) => {
        const traducido = traducirErrorHistoria(error, 'historia');
        switch (traducido.causa) {
          case 'requiere-justificacion':
            this.estado.set({ tipo: 'requiere-justificacion' });
            break;
          case 'sin-historia':
            this.estado.set({ tipo: 'sin-historia' });
            break;
          default:
            this.estado.set({ tipo: 'error', error: traducido });
        }
      },
    });
  }

  private idDePersona(): number {
    return Number(this.personaId());
  }
}
