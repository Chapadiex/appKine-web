import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Observable } from 'rxjs';

import { TelegramService } from '../../../../api/generated/api/telegram.service';
import { VinculoDeTelegram } from '../../../../api/generated/model/vinculo-de-telegram';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Icono } from '../../../../shared/components/icono/icono';

const ESPERA_DEL_CODIGO_MS = 4000;

/**
 * "Telegram" en el asistente de datos (contrato 0.197.0): vincular la cuenta propia con el bot del
 * centro para cargar contando lo que se hizo, por audio o mensaje.
 *
 * <p>Una franja compacta arriba de la charla. No se muestra si el despliegue no tiene Telegram (409
 * `telegram-deshabilitado`), si el centro no conecto un bot, o sin `asistente:acciones` (403): en
 * los tres casos no hay nada que la persona pueda hacer desde aca.
 */
@Component({
  selector: 'app-mi-telegram',
  imports: [Alerta, Icono],
  templateUrl: './mi-telegram.html',
  styleUrl: './mi-telegram.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MiTelegram {
  private readonly api = inject(TelegramService);
  private readonly tenant = inject(TenantContextStore);
  private readonly avisos = inject(AvisosStore);

  protected readonly vinculo = signal<VinculoDeTelegram | null>(null);
  protected readonly ocupado = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly visible = computed(() => !!this.vinculo()?.botUsuario);
  protected readonly enlaceDelBot = computed(() => {
    const v = this.vinculo();
    return v?.botUsuario ? `https://t.me/${v.botUsuario}` : '';
  });
  /** "/vincular 482913", listo para copiar. */
  protected readonly comando = computed(() => {
    const codigo = this.vinculo()?.codigo;
    return codigo ? `/vincular ${codigo}` : '';
  });

  constructor() {
    effect(() => {
      this.tenant.contextEpoch();
      untracked(() => {
        this.vinculo.set(null);
        this.error.set(null);
        this.cargar();
      });
    });
    // Con un codigo a la espera, se relee cada pocos segundos: la persona lo manda desde el
    // telefono y la franja pasa a "Vinculado" sola.
    effect((alLimpiar) => {
      if (!this.comando()) {
        return;
      }
      const reloj = setInterval(() => this.cargar(), ESPERA_DEL_CODIGO_MS);
      alLimpiar(() => clearInterval(reloj));
    });
  }

  private cargar(): void {
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null) {
      return;
    }
    this.delContextoActual(this.api.getMiVinculoDeTelegram({ consultorioId })).subscribe({
      next: (vinculo) => {
        const antes = this.vinculo();
        this.vinculo.set(vinculo);
        if (antes?.codigo && vinculo.vinculado) {
          this.avisos.exito('Listo: tu Telegram quedó vinculado');
        }
      },
      // Apagado, sin permiso o sin red: la franja no aparece. El asistente sigue andando igual.
      error: () => this.vinculo.set(null),
    });
  }

  protected pedirCodigo(): void {
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null || this.ocupado()) {
      return;
    }
    this.ocupado.set(true);
    this.error.set(null);
    this.delContextoActual(this.api.generarCodigoDeTelegram({ consultorioId })).subscribe({
      next: (vinculo) => {
        this.vinculo.set(vinculo);
        this.ocupado.set(false);
      },
      error: (error: unknown) => {
        this.ocupado.set(false);
        this.error.set(mensajeDe(error));
      },
    });
  }

  protected desvincular(): void {
    const consultorioId = this.tenant.consultorioId();
    const actual = this.vinculo();
    if (consultorioId === null || actual === null || this.ocupado()) {
      return;
    }
    this.ocupado.set(true);
    this.error.set(null);
    this.delContextoActual(this.api.desvincularMiTelegram({ consultorioId })).subscribe({
      next: () => {
        this.vinculo.set({ vinculado: false, botUsuario: actual.botUsuario });
        this.ocupado.set(false);
        this.avisos.exito('Tu Telegram quedó desvinculado');
      },
      error: (error: unknown) => {
        this.ocupado.set(false);
        this.error.set(mensajeDe(error));
      },
    });
  }

  protected copiar(): void {
    const texto = this.comando();
    if (texto && navigator.clipboard) {
      navigator.clipboard.writeText(texto).then(
        () => this.avisos.exito('Copiado'),
        () => undefined,
      );
    }
  }

  /** "10:45"; el dato es un instante. */
  protected hora(instante: string | undefined): string {
    return instante
      ? new Date(instante).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
      : '';
  }

  /** Descarta la respuesta de un pedido que salio con otra sede elegida. */
  private delContextoActual<T>(pedido: Observable<T>): Observable<T> {
    const epoca = this.tenant.contextEpoch();
    const vigente = (): boolean => this.tenant.contextEpoch() === epoca;
    return new Observable<T>((destino) =>
      pedido.subscribe({
        next: (valor) => vigente() && destino.next(valor),
        error: (error: unknown) => vigente() && destino.error(error),
        complete: () => destino.complete(),
      }),
    );
  }
}

function mensajeDe(error: unknown): string {
  return error instanceof AkineHttpError ? error.mensaje : 'Volvé a intentar en un momento.';
}
