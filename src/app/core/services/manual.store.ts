import { Injectable, signal } from '@angular/core';

/**
 * Pedidos al manual de usuario (appKine-api/docs/diseno/AKINE-manual-de-usuario.md §5.5). Vive en
 * `core` y no sabe nada del contenido: el panel llega en su propio chunk la primera vez que alguien
 * lo abre (entrada «Ayuda», F1 o el asistente), igual que `FlujoDeTurnosStore`.
 */
@Injectable({ providedIn: 'root' })
export class ManualStore {
  private readonly estaAbierto = signal(false);
  private readonly pedida = signal<string | null>(null);

  readonly abierto = this.estaAbierto.asReadonly();
  /** Una ficha pedida por id (desde el asistente); `null` = la de la pantalla actual. */
  readonly fichaPedida = this.pedida.asReadonly();

  abrir(): void {
    this.pedida.set(null);
    this.estaAbierto.set(true);
  }

  alternar(): void {
    if (this.estaAbierto()) {
      this.cerrar();
    } else {
      this.abrir();
    }
  }

  verFicha(id: string): void {
    this.pedida.set(id);
    this.estaAbierto.set(true);
  }

  /** Vuelve a seguir la pantalla actual. */
  seguirPantalla(): void {
    this.pedida.set(null);
  }

  cerrar(): void {
    this.estaAbierto.set(false);
  }
}
