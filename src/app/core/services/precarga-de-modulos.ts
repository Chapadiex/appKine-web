import { DOCUMENT, DestroyRef, Injectable, inject } from '@angular/core';
import { RouteConfigLoadStart, Router } from '@angular/router';

/** Id del bloque de datos que `scripts/build-produccion.mjs` escribe en el `index.html`. */
export const ID_MANIFIESTO_DE_PRECARGA = 'akine-precarga';

/** Nombre del chunk dentro de un `loadComponent` compilado: `import(`./chunk-XXXXXXXX.js`)`. */
const IMPORT_DE_CHUNK = /import\(\s*[`'"]\.\/(chunk-[\w-]+\.js)[`'"]\s*\)/;

type Manifiesto = Readonly<Record<string, readonly string[]>>;

/**
 * Precarga las dependencias de la pantalla que se esta por bajar (AKINE-LCP, segunda vuelta).
 *
 * <p><b>Que resuelve.</b> El codigo de cada pantalla llega en un chunk perezoso que importa de
 * forma estatica otros chunks compartidos —formularios, servicios del cliente generado,
 * componentes de `shared/`—. El navegador recien los descubre cuando termina de bajar y analizar
 * el de la pantalla: son dos idas y vueltas en serie, y con la latencia movil de G-10 (150 ms) la
 * segunda es la que mas pesa en el LCP del Paciente 360.
 *
 * <p><b>Como.</b> El build calcula, para cada chunk que el `main` importa de forma dinamica, el
 * cierre de sus imports estaticos, y lo deja en el `index.html` como un bloque
 * `<script type="application/json">` (no se ejecuta: la CSP no lo alcanza). Cuando el router
 * empieza a bajar una pantalla ({@link RouteConfigLoadStart}), o cuando un guard la adelanta
 * ({@link precargar}), se agrega un `<link rel="modulepreload">` por cada dependencia: salen a la
 * red junto con el chunk de la pantalla y no despues.
 *
 * <p><b>No decide nada.</b> Solo adelanta bajadas que el navegador iba a hacer igual al evaluar el
 * chunk: el mapa de modulos reutiliza lo precargado y no vuelve a pedirlo. Si el manifiesto falta
 * (build de desarrollo, tests) o el `loadComponent` no tiene la forma compilada, no hace nada.
 */
@Injectable({ providedIn: 'root' })
export class PrecargaDeModulos {
  private readonly documento = inject(DOCUMENT);
  private manifiesto: Manifiesto | null | undefined;
  private readonly pedidos = new Set<string>();

  /** Engancha la precarga a cada pantalla que el router empieza a bajar. */
  escucharRouter(): void {
    const suscripcion = inject(Router).events.subscribe((evento) => {
      if (evento instanceof RouteConfigLoadStart) {
        // El evento sale ANTES de que el router llame al `loadComponent`: se difiere un
        // microtask para que el chunk de la pantalla pida conexion primero. Con HTTP/1.1 hay
        // seis por origen, y el que mas tarda en llegar no puede quedar al final de la cola.
        const cargar = evento.route.loadComponent;
        queueMicrotask(() => this.precargar(cargar));
      }
    });
    inject(DestroyRef).onDestroy(() => suscripcion.unsubscribe());
  }

  /** Precarga las dependencias del chunk que importa `cargar`, si el manifiesto las conoce. */
  precargar(cargar: unknown): void {
    if (typeof cargar !== 'function') {
      return;
    }
    const chunk = IMPORT_DE_CHUNK.exec(String(cargar))?.[1];
    const dependencias = chunk === undefined ? undefined : this.leerManifiesto()?.[chunk];
    if (dependencias === undefined) {
      return;
    }
    for (const dependencia of dependencias) {
      if (this.pedidos.has(dependencia)) {
        continue;
      }
      this.pedidos.add(dependencia);
      const enlace = this.documento.createElement('link');
      enlace.rel = 'modulepreload';
      enlace.href = dependencia;
      this.documento.head.appendChild(enlace);
    }
  }

  private leerManifiesto(): Manifiesto | null {
    if (this.manifiesto === undefined) {
      this.manifiesto = null;
      const bloque = this.documento.getElementById(ID_MANIFIESTO_DE_PRECARGA)?.textContent;
      if (bloque) {
        try {
          this.manifiesto = JSON.parse(bloque) as Manifiesto;
        } catch {
          // Un manifiesto roto no puede romper la navegacion: sin el, todo baja como antes.
        }
      }
    }
    return this.manifiesto;
  }
}
