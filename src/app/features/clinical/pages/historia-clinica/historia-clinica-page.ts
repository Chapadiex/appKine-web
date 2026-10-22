import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { AntecedenteResponse } from '../../../../api/generated/model/antecedente-response';
import { EventoClinicoResponse } from '../../../../api/generated/model/evento-clinico-response';
import { HistoriaClinicaResponse } from '../../../../api/generated/model/historia-clinica-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { CasosDeLaHistoria } from '../../casos/components/casos-de-la-historia';
import { PedidoDeMotivo } from '../../components/pedido-de-motivo';
import {
  TIPOS_DE_ANTECEDENTE,
  etiquetaDeOrigen,
  fechaYHora,
  rotulo,
} from '../../models/etiquetas-de-historia';
import { ErrorHistoria, errorDeCausa, traducirErrorHistoria } from '../../models/historia-errors';
import { HistoriaClinicaApi } from '../../services/historia-clinica-api';
import { VisitaClinica } from '../../services/visita-clinica';
import { DetalleDeEntrada } from './components/detalle-de-entrada';
import { NuevaEntrada } from './components/nueva-entrada';
import { NuevoAdjunto } from './components/nuevo-adjunto';
import { TimelineClinico, claveDe } from './components/timeline-clinico';
import { VisorDeAdjunto } from './components/visor-de-adjunto';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';

type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'requiere-justificacion' }
  | { readonly tipo: 'sin-historia' }
  | { readonly tipo: 'lista'; readonly historia: HistoriaClinicaResponse }
  | { readonly tipo: 'error'; readonly error: ErrorHistoria };

/**
 * La Historia Clinica de una persona: cabecera, casos, timeline y detalle (D-a, D-b,
 * RF-M09-001/003, RF-M25).
 *
 * <h2>El motivo de acceso es de esta visita</h2>
 *
 * <p>DP-03: quien no tiene relacion asistencial con la persona declara un motivo, y cada lectura
 * se audita con el. La pantalla pide primero sin motivo —el backend sabe si hace falta, el cliente
 * no— y solo ante el 403 con `requiereJustificacion` muestra el formulario. El motivo vive en
 * {@link VisitaClinica}, que comparten la historia, sus casos y sus planes: ir y volver entre ellos
 * es la misma visita. Recargar, cambiar de contexto o volver a entrar desde la ficha lo vuelve a
 * pedir. Recordarlo entre visitas convertiria el control en un formalismo.
 *
 * <h2>Cambiar de contexto vacia la pantalla</h2>
 *
 * <p>La historia es de la organizacion (DP-03). Si el usuario cambia de organizacion o de sede,
 * lo que habia en pantalla es de otro tenant o se leyo con otra relacion asistencial: se descarta
 * todo, motivo incluido, y se vuelve a pedir.
 */
@Component({
  selector: 'app-historia-clinica-page',
  imports: [
    Ayuda,
    RouterLink,
    TimelineClinico,
    DetalleDeEntrada,
    VisorDeAdjunto,
    NuevaEntrada,
    NuevoAdjunto,
    PedidoDeMotivo,
    CasosDeLaHistoria,
  ],
  templateUrl: './historia-clinica-page.html',
  styleUrl: './historia-clinica.css',
})
export class HistoriaClinicaPage {
  private readonly api = inject(HistoriaClinicaApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly visita = inject(VisitaClinica);

  protected readonly fechaYHora = fechaYHora;
  protected readonly etiquetaDeOrigen = etiquetaDeOrigen;

  protected readonly estado = signal<Estado>({ tipo: 'cargando' });
  protected readonly justificacion = this.visita.motivo;
  protected readonly abriendo = signal(false);
  protected readonly errorAlAbrir = signal<ErrorHistoria | null>(null);

  protected readonly seleccion = signal<EventoClinicoResponse | null>(null);
  protected readonly recargas = signal(0);

  /** La ficha administrativa de la misma persona (D-e): el camino de ida y vuelta es uno solo. */
  protected readonly rutaFicha = this.visita.rutaFicha;

  protected readonly historia = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'lista' ? estado.historia : null;
  });

  protected readonly error = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.error : null;
  });

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

    // Otra persona, otro contexto o un motivo recien declarado: se relee todo desde cero.
    effect(() => {
      this.visita.personaId();
      this.visita.motivo();
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.seleccion.set(null);
        this.cargar();
      });
    });
  }

  protected rotuloDeAntecedente(antecedente: AntecedenteResponse): string {
    return rotulo(TIPOS_DE_ANTECEDENTE, antecedente.tipo);
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
    if (this.visita.personaId() === null) {
      return; // El marco todavia no leyo la URL: se sigue en "cargando".
    }
    const personaId = this.idDePersona();
    if (!Number.isSafeInteger(personaId) || personaId <= 0) {
      this.estado.set({ tipo: 'error', error: errorDeCausa('no-encontrado') });
      return;
    }
    this.estado.set({ tipo: 'cargando' });
    this.errorAlAbrir.set(null);
    this.pedido?.unsubscribe();
    this.pedido = this.api.ver(personaId, this.justificacion()).subscribe({
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
    return this.visita.personaId() ?? Number.NaN;
  }
}
