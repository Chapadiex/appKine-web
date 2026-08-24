import { DestroyRef, computed, inject, signal } from '@angular/core';

/**
 * Cuenta regresiva del `429`.
 *
 * <p>El boton queda deshabilitado mientras corre: reintentar antes de tiempo solo suma otro
 * rechazo y, en los endpoints con limite por IP, alarga el bloqueo del propio usuario.
 *
 * <p>El restante es un signal porque Angular 21 es zoneless: un contador mutado fuera de un
 * signal no repintaria la pantalla.
 */
export class EsperaPorLimite {
  private readonly restantes = signal(0);
  private temporizador: ReturnType<typeof setInterval> | null = null;

  /** Segundos que faltan. 0 cuando no hay espera vigente. */
  readonly segundos = this.restantes.asReadonly();

  readonly activa = computed(() => this.restantes() > 0);

  iniciar(segundos: number): void {
    this.detener();
    if (segundos <= 0) {
      return;
    }

    this.restantes.set(segundos);
    this.temporizador = setInterval(() => {
      this.restantes.update((valor) => Math.max(0, valor - 1));
      if (this.restantes() === 0) {
        this.detener();
      }
    }, 1000);
  }

  detener(): void {
    if (this.temporizador !== null) {
      clearInterval(this.temporizador);
      this.temporizador = null;
    }
  }
}

/**
 * Crea la espera y la apaga al destruir el componente.
 *
 * Debe llamarse en contexto de inyeccion. Sin el `onDestroy`, el intervalo sobrevive a la
 * navegacion y mantiene viva la pantalla entera.
 */
export function crearEsperaPorLimite(): EsperaPorLimite {
  const espera = new EsperaPorLimite();
  inject(DestroyRef).onDestroy(() => espera.detener());
  return espera;
}
