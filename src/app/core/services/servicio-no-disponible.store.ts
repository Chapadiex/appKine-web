import { Injectable, computed, signal } from '@angular/core';

/**
 * Aviso global de "el backend no esta disponible" (`503 service-unavailable`).
 *
 * <p>Desde el contrato 0.85.0 el backend responde `503 service-unavailable` cuando pierde la
 * base, tambien desde los filtros de seguridad. Antes esa misma caida salia como `401` y el
 * frontend la trataba como sesion vencida: renovaba, fallaba y mandaba al login a alguien
 * cuya sesion seguia perfectamente viva. Ahora es un aviso <b>no destructivo</b>: no toca el
 * token, no navega y no reemplaza el mensaje de la pantalla que pidio el dato; solo le dice al
 * usuario que el problema es transitorio y del servidor.
 *
 * <p>Lo publica `errorInterceptor` en cada `503` y lo descarta la siguiente respuesta exitosa
 * de la API: si el servicio volvio, el aviso ya no es cierto.
 */
@Injectable({ providedIn: 'root' })
export class ServicioNoDisponibleStore {
  /** `null` = no hay aviso. Si hay, los segundos de `Retry-After` o `null` si no vino. */
  private readonly estado = signal<{ readonly segundos: number | null } | null>(null);

  /** Texto a mostrar, o `null` si no hay aviso activo. */
  readonly aviso = computed(() => {
    const actual = this.estado();
    if (actual === null) {
      return null;
    }
    return actual.segundos !== null && actual.segundos > 0
      ? `El servicio no está disponible. Reintentá en ${actual.segundos} segundos.`
      : 'El servicio no está disponible, reintentá en unos segundos.';
  });

  /** Publica el aviso. `segundos` sale de `Retry-After`; sin header no se inventa un plazo. */
  avisar(segundos: number | null): void {
    this.estado.set({ segundos: segundos === null ? null : Math.ceil(segundos) });
  }

  /** Quita el aviso: lo cerro el usuario o el servicio volvio a responder. */
  descartar(): void {
    if (this.estado() !== null) {
      this.estado.set(null);
    }
  }
}
