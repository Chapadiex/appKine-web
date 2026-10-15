import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Subscription, forkJoin } from 'rxjs';

import { AlertaDeAutorizacionResponse } from '../../../../api/generated/model/alerta-de-autorizacion-response';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { MovimientoResponse } from '../../../../api/generated/model/movimiento-response';
import { PERMISO_PACIENTE_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { SaldoAutorizacionResponse } from '../../../../api/generated/model/saldo-autorizacion-response';
import { formatearInstante } from '../../../../shared/utils/instantes';
import { ConsumosApi } from '../../services/consumos-api';
import { traducirErrorPersona } from '../../models/person-errors';
import {
  alertaEnPalabras,
  cantidadOSinTope,
  consumosRevertidos,
  efectoEnPalabras,
  origenDeMovimiento,
  resolucionDeAlerta,
  tipoDeMovimiento,
  veredictoDeSaldo,
} from '../../models/etiquetas-de-consumo';

interface Lectura {
  readonly saldo: SaldoAutorizacionResponse;
  readonly movimientos: readonly MovimientoResponse[];
  readonly alertas: readonly AlertaDeAutorizacionResponse[];
}

type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly lectura: Lectura }
  | { readonly tipo: 'error'; readonly mensaje: string };

/**
 * Saldo explicable, ledger y alertas "consumo a revisar" de una autorizacion (M17, C-4, D-f).
 *
 * <p>RF-M17-003 (saldo), RF-M17-004 (consumo), RF-M17-005 (reversion manual), RN-M17-003 y DP-13
 * (alertas). Lee las tres cosas juntas porque responden una sola pregunta: <b>por que el saldo es
 * el que es</b>.
 *
 * <h2>La alerta no se descarta: se revierte el consumo, o queda</h2>
 *
 * <p>Anular la deuda de una sesion no prueba que la prestacion no ocurrio, asi que la unidad no
 * vuelve sola (DP-13). La unica accion que el contrato ofrece es revertir el consumo con motivo,
 * y eso resuelve la alerta. "Descartar sin revertir" no existe (C-4 §9.1): la pantalla lo dice en
 * vez de inventar un boton.
 *
 * <h2>Lo que no hace</h2>
 *
 * <p>No recalcula el saldo. Muestra el de la columna y, si el backend dice que no coincide con el
 * ledger (`coherente = false`), muestra las dos cuentas y no corrige nada: corregir en un GET
 * taparia el sintoma.
 */
@Component({
  selector: 'app-consumo-de-autorizacion',
  imports: [ConfirmacionConMotivo, PermisoDirective],
  templateUrl: './consumo-de-autorizacion.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: '../../person.css',
})
export class ConsumoDeAutorizacion {
  private readonly api = inject(ConsumosApi);

  readonly autorizacionId = input.required<number>();
  readonly numero = input('');

  /** Avisa que el saldo cambio, para que el listado se relea. */
  readonly revertido = output<void>();

  protected readonly permisoManage = PERMISO_PACIENTE_MANAGE;
  protected readonly cantidadOSinTope = cantidadOSinTope;
  protected readonly veredictoDeSaldo = veredictoDeSaldo;
  protected readonly tipoDeMovimiento = tipoDeMovimiento;
  protected readonly origenDeMovimiento = origenDeMovimiento;
  protected readonly efectoEnPalabras = efectoEnPalabras;
  protected readonly alertaEnPalabras = alertaEnPalabras;
  protected readonly resolucionDeAlerta = resolucionDeAlerta;
  protected readonly formatearInstante = formatearInstante;

  protected readonly estado = signal<Estado>({ tipo: 'cargando' });
  protected readonly lectura = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.lectura : null;
  });
  protected readonly mensajeDeCarga = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : '';
  });

  protected readonly revertidos = computed(() =>
    consumosRevertidos(this.lectura()?.movimientos ?? []),
  );
  protected readonly alertasPendientes = computed(() =>
    (this.lectura()?.alertas ?? []).filter((alerta) => alerta.pendiente === true),
  );
  protected readonly alertasResueltas = computed(() =>
    (this.lectura()?.alertas ?? []).filter((alerta) => alerta.pendiente !== true),
  );

  /** Consumo que se esta por revertir, o `null`. */
  protected readonly aRevertir = signal<number | null>(null);
  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly exito = signal<string | null>(null);

  private enVuelo: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.enVuelo?.unsubscribe());
    effect(() => {
      const id = this.autorizacionId();
      untracked(() => this.leer(id));
    });
  }

  protected reintentar(): void {
    this.leer(this.autorizacionId());
  }

  protected esRevertible(movimiento: MovimientoResponse): boolean {
    return (
      movimiento.tipo === 'CONSUMO' &&
      movimiento.id !== undefined &&
      !this.revertidos().has(movimiento.id)
    );
  }

  protected pedirReversion(movimientoId: number | undefined): void {
    if (movimientoId === undefined) {
      return;
    }
    this.errorAccion.set(null);
    this.exito.set(null);
    this.aRevertir.set(movimientoId);
  }

  protected cancelarReversion(): void {
    this.aRevertir.set(null);
    this.errorAccion.set(null);
  }

  protected confirmarReversion(motivo: string): void {
    const movimientoId = this.aRevertir();
    if (movimientoId === null) {
      return;
    }
    this.enviando.set(true);
    this.errorAccion.set(null);
    this.api.revertir(this.autorizacionId(), movimientoId, motivo).subscribe({
      next: () => {
        this.enviando.set(false);
        this.aRevertir.set(null);
        this.exito.set(
          `Se revirtio el consumo #${movimientoId}: la unidad volvio al saldo y, si tenia una ` +
            'alerta pendiente, quedo resuelta. El consumo original sigue en el ledger.',
        );
        this.leer(this.autorizacionId());
        this.revertido.emit();
      },
      error: (error: unknown) => {
        this.enviando.set(false);
        this.errorAccion.set(traducirErrorPersona(error).mensaje);
      },
    });
  }

  private leer(autorizacionId: number): void {
    this.enVuelo?.unsubscribe();
    this.estado.set({ tipo: 'cargando' });
    this.enVuelo = forkJoin({
      saldo: this.api.saldo(autorizacionId),
      movimientos: this.api.movimientos(autorizacionId),
      alertas: this.api.alertas(autorizacionId),
    }).subscribe({
      next: (lectura) => this.estado.set({ tipo: 'listo', lectura }),
      error: (error: unknown) =>
        this.estado.set({ tipo: 'error', mensaje: traducirErrorPersona(error).mensaje }),
    });
  }
}
