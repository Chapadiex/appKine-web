import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';

import { TelegramService } from '../../../../api/generated/api/telegram.service';
import { BotDeTelegram } from '../../../../api/generated/model/bot-de-telegram';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Icono } from '../../../../shared/components/icono/icono';

/**
 * Organizacion → Inteligencia artificial → Telegram: conectar el bot del centro (contrato 0.197.0).
 *
 * <p>Guia paso a paso para crear el bot en @BotFather y un solo campo para pegar el token. El token
 * no vuelve nunca del servidor: lo que se muestra despues es el usuario del bot.
 *
 * <p>Con el interruptor del despliegue apagado (409 `telegram-deshabilitado`) la tarjeta lo dice y
 * no ofrece nada; sin `tenant:update` (403) no se muestra.
 */
@Component({
  selector: 'app-telegram-del-centro',
  imports: [ReactiveFormsModule, Alerta, Icono],
  templateUrl: './telegram-del-centro.html',
  styleUrl: './telegram-del-centro.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TelegramDelCentro {
  private readonly api = inject(TelegramService);
  private readonly tenant = inject(TenantContextStore);
  private readonly avisos = inject(AvisosStore);

  protected readonly estado = signal<'cargando' | 'listo' | 'apagado' | 'oculto' | 'error'>(
    'cargando',
  );
  protected readonly bot = signal<BotDeTelegram | null>(null);
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Con un bot conectado, la guia y el campo se abren solo para reemplazarlo. */
  protected readonly reemplazando = signal(false);

  protected readonly token = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(120)],
  });

  constructor() {
    effect(() => {
      this.tenant.contextEpoch();
      untracked(() => {
        this.reemplazando.set(false);
        this.error.set(null);
        this.token.reset();
        this.cargar();
      });
    });
  }

  protected cargar(): void {
    const orgId = this.tenant.organizationId();
    if (orgId === null) {
      return;
    }
    this.estado.set('cargando');
    this.delContextoActual(this.api.getBotDeTelegram({ orgId })).subscribe({
      next: (bot) => {
        this.bot.set(bot);
        this.estado.set('listo');
      },
      error: (error: unknown) => {
        if (error instanceof AkineHttpError && error.problemType === 'telegram-deshabilitado') {
          this.estado.set('apagado');
        } else if (error instanceof AkineHttpError && error.status === 403) {
          this.estado.set('oculto');
        } else {
          this.error.set(mensajeDe(error));
          this.estado.set('error');
        }
      },
    });
  }

  protected conectar(evento?: Event): void {
    evento?.preventDefault();
    const orgId = this.tenant.organizationId();
    if (orgId === null || this.guardando()) {
      return;
    }
    if (this.token.invalid) {
      this.token.markAsTouched();
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    this.delContextoActual(
      this.api.conectarBotDeTelegram({
        orgId,
        conectarBotDeTelegram: { token: this.token.value.trim() },
      }),
    ).subscribe({
      next: (bot) => {
        this.bot.set(bot);
        this.guardando.set(false);
        this.reemplazando.set(false);
        this.token.reset();
        this.avisos.exito(`Bot @${bot.usuario} conectado`);
      },
      error: (error: unknown) => {
        this.guardando.set(false);
        this.error.set(mensajeDe(error));
      },
    });
  }

  protected desconectar(): void {
    const orgId = this.tenant.organizationId();
    if (orgId === null || this.guardando()) {
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    this.delContextoActual(this.api.desconectarBotDeTelegram({ orgId })).subscribe({
      next: () => {
        this.bot.set({ conectado: false });
        this.guardando.set(false);
        this.avisos.exito('Bot desconectado');
      },
      error: (error: unknown) => {
        this.guardando.set(false);
        this.error.set(mensajeDe(error));
      },
    });
  }

  /** "26/11/2026 10:30"; el dato es un instante. */
  protected fechaYHora(instante: string | undefined): string {
    return instante
      ? new Date(instante).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
      : '';
  }

  /** Descarta la respuesta de un pedido que salio con otro centro elegido. */
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
