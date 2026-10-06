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

import { EntradaClinicaResponse } from '../../../../../api/generated/model/entrada-clinica-response';
import { EntradaClinicaVersionResponse } from '../../../../../api/generated/model/entrada-clinica-version-response';
import { ErrorHistoria, traducirErrorHistoria } from '../../../models/historia-errors';
import { TIPOS_DE_ENTRADA, fechaYHora, rotulo } from '../../../models/etiquetas-de-historia';
import { HistoriaClinicaApi, Justificacion } from '../../../services/historia-clinica-api';

type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'lista'; readonly entrada: EntradaClinicaResponse }
  | { readonly tipo: 'error'; readonly error: ErrorHistoria };

/**
 * Una entrada clinica abierta desde el timeline (D-a, RF-M09-003, RN-M09-004).
 *
 * <p><b>Corregir es enmendar, nunca editar.</b> La enmienda crea una version nueva con su motivo y
 * deja la anterior consultable con su autor y su fecha. Por eso el formulario pide motivo y el
 * historial esta a un click: lo que se escribio una vez sigue siendo parte de la historia.
 *
 * <p>La enmienda manda la `version` leida. Si alguien enmendo en el medio, el backend responde 409
 * y la pantalla no reintenta sola: el texto propio queda en el campo y se ofrece releer, para que
 * quien enmienda vea la correccion ajena antes de escribir encima.
 */
@Component({
  selector: 'app-detalle-de-entrada',
  templateUrl: './detalle-de-entrada.html',
  styleUrl: '../historia-clinica.css',
})
export class DetalleDeEntrada {
  private readonly api = inject(HistoriaClinicaApi);

  readonly entradaId = input.required<number>();
  readonly justificacion = input.required<Justificacion>();

  protected readonly fechaYHora = fechaYHora;

  protected readonly estado = signal<Estado>({ tipo: 'cargando' });
  protected readonly versiones = signal<readonly EntradaClinicaVersionResponse[] | null>(null);
  protected readonly errorDeVersiones = signal<ErrorHistoria | null>(null);

  protected readonly enmendando = signal(false);
  protected readonly cuerpoNuevo = signal('');
  protected readonly motivo = signal('');
  protected readonly enviando = signal(false);
  protected readonly errorDeEnmienda = signal<ErrorHistoria | null>(null);
  protected readonly intentoEnviar = signal(false);
  protected readonly aviso = signal('');

  protected readonly entrada = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'lista' ? estado.entrada : null;
  });

  protected readonly error = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.error : null;
  });

  protected readonly tipo = computed(() => rotulo(TIPOS_DE_ENTRADA, this.entrada()?.tipo));
  protected readonly faltaCuerpo = computed(() => this.cuerpoNuevo().trim() === '');
  protected readonly faltaMotivo = computed(() => this.motivo().trim() === '');
  protected readonly conflicto = computed(() => this.errorDeEnmienda()?.causa === 'version-vieja');

  private pedido: Subscription | null = null;
  private pedidoDeVersiones: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.pedido?.unsubscribe();
      this.pedidoDeVersiones?.unsubscribe();
    });

    effect(() => {
      const id = this.entradaId();
      const justificacion = this.justificacion();
      untracked(() => this.cargar(id, justificacion));
    });
  }

  protected releer(): void {
    this.cargar(this.entradaId(), this.justificacion());
  }

  protected verVersiones(): void {
    this.errorDeVersiones.set(null);
    this.pedidoDeVersiones?.unsubscribe();
    this.pedidoDeVersiones = this.api.versiones(this.entradaId(), this.justificacion()).subscribe({
      next: (versiones) =>
        this.versiones.set(
          [...versiones].sort((a, b) => (b.numeroVersion ?? 0) - (a.numeroVersion ?? 0)),
        ),
      error: (error: unknown) => this.errorDeVersiones.set(traducirErrorHistoria(error)),
    });
  }

  protected empezarEnmienda(): void {
    this.cuerpoNuevo.set(this.entrada()?.cuerpo ?? '');
    this.motivo.set('');
    this.intentoEnviar.set(false);
    this.errorDeEnmienda.set(null);
    this.enmendando.set(true);
  }

  protected cancelarEnmienda(): void {
    this.enmendando.set(false);
    this.errorDeEnmienda.set(null);
  }

  protected enmendar(): void {
    const entrada = this.entrada();
    this.intentoEnviar.set(true);
    if (entrada?.version === undefined || this.faltaCuerpo() || this.faltaMotivo()) {
      return;
    }

    this.enviando.set(true);
    this.errorDeEnmienda.set(null);
    this.pedido?.unsubscribe();
    this.pedido = this.api
      .enmendar(
        this.entradaId(),
        this.cuerpoNuevo().trim(),
        this.motivo().trim(),
        entrada.version,
        this.justificacion(),
      )
      .subscribe({
        next: (enmendada) => {
          this.enviando.set(false);
          this.enmendando.set(false);
          this.estado.set({ tipo: 'lista', entrada: enmendada });
          this.aviso.set(`Enmienda guardada como version ${enmendada.numeroVersion ?? ''}.`);
          if (this.versiones() !== null) {
            this.verVersiones();
          }
        },
        error: (error: unknown) => {
          this.enviando.set(false);
          this.errorDeEnmienda.set(traducirErrorHistoria(error));
        },
      });
  }

  /** Releer tras un conflicto deja el texto propio en el campo: no se pierde nada escrito. */
  protected releerTrasConflicto(): void {
    this.pedido?.unsubscribe();
    this.pedido = this.api.entrada(this.entradaId(), this.justificacion()).subscribe({
      next: (entrada) => {
        this.estado.set({ tipo: 'lista', entrada });
        this.errorDeEnmienda.set(null);
        this.aviso.set('Releimos la entrada. Tu texto sigue en el campo.');
      },
      error: (error: unknown) => this.errorDeEnmienda.set(traducirErrorHistoria(error)),
    });
  }

  private cargar(id: number, justificacion: Justificacion): void {
    this.estado.set({ tipo: 'cargando' });
    this.versiones.set(null);
    this.enmendando.set(false);
    this.aviso.set('');
    this.pedido?.unsubscribe();
    this.pedidoDeVersiones?.unsubscribe();
    this.pedido = this.api.entrada(id, justificacion).subscribe({
      next: (entrada) => this.estado.set({ tipo: 'lista', entrada }),
      error: (error: unknown) =>
        this.estado.set({ tipo: 'error', error: traducirErrorHistoria(error) }),
    });
  }
}
