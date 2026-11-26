import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, forkJoin, map, of } from 'rxjs';

import { CatalogoClinicoService } from '../../api/generated/api/catalogo-clinico.service';
import { PlataformaService } from '../../api/generated/api/plataforma.service';
import { SessionService } from './session.service';

/** Los numeros que la barra lateral de la consola de plataforma muestra en insignias. */
export type ContadorDePlataforma =
  'centros-activos' | 'pedidos-pendientes' | 'solicitudes-pendientes' | 'cambios-pendientes';

interface Contadores {
  readonly epoca: number;
  readonly centrosActivos: number | null;
  readonly pedidosPendientes: number | null;
  readonly cambiosPendientes: number | null;
  readonly solicitudesPendientes: number | null;
}

/**
 * Contadores de la consola de plataforma (19/11/2026): centros activos, pedidos de prueba y
 * solicitudes de catalogo pendientes, para las insignias de la barra lateral.
 *
 * <p>Sale del panel de plataforma (`centros.activos`, `pedidosPendientes`) y del listado de
 * solicitudes `PENDIENTE`. Nada se pide hasta que alguien llama a {@link asegurarCargados} o a
 * {@link refrescar}: la barra lo hace solo en modo plataforma.
 *
 * <p>El cache se sella con `SessionService.epocaDeIdentidad`, como `PlatformRoleStore`: los numeros
 * son de quien administra, y un logout los invalida en el mismo tick.
 *
 * <p><b>Un fallo no se ve.</b> Cada consulta que falla deja su contador en `null` y la insignia no
 * se dibuja: es un adorno, no un dato del que dependa una decision.
 */
@Injectable({ providedIn: 'root' })
export class ContadoresDePlataformaStore {
  private readonly plataforma = inject(PlataformaService);
  private readonly catalogo = inject(CatalogoClinicoService);
  private readonly session = inject(SessionService);

  private readonly cache = signal<Contadores | null>(null);

  /** Epoca de la consulta en vuelo: evita pedir dos veces lo mismo. */
  private enVuelo: number | null = null;

  private readonly vigente = computed(() => {
    const cache = this.cache();
    return cache !== null && cache.epoca === this.session.epocaDeIdentidad() ? cache : null;
  });

  readonly centrosActivos: Signal<number | null> = computed(
    () => this.vigente()?.centrosActivos ?? null,
  );

  readonly pedidosPendientes: Signal<number | null> = computed(
    () => this.vigente()?.pedidosPendientes ?? null,
  );

  /** Pedidos de cambio de plan de los centros sin responder (25/11/2026). */
  readonly cambiosPendientes: Signal<number | null> = computed(
    () => this.vigente()?.cambiosPendientes ?? null,
  );

  readonly solicitudesPendientes: Signal<number | null> = computed(
    () => this.vigente()?.solicitudesPendientes ?? null,
  );

  /** `true` si ya hay numeros (o fallos) para la sesion actual. */
  readonly cargados: Signal<boolean> = computed(() => this.vigente() !== null);

  /** El valor de un contador por nombre, como lo declara una seccion de la barra. */
  valor(contador: ContadorDePlataforma): number | null {
    switch (contador) {
      case 'centros-activos':
        return this.centrosActivos();
      case 'pedidos-pendientes':
        return this.pedidosPendientes();
      case 'solicitudes-pendientes':
        return this.solicitudesPendientes();
      case 'cambios-pendientes':
        return this.cambiosPendientes();
    }
  }

  /** Pide los contadores si todavia no estan para esta sesion. */
  asegurarCargados(): void {
    if (!this.cargados()) {
      this.refrescar();
    }
  }

  /**
   * Vuelve a pedir los contadores. Sin sesion no sale a la red; con una consulta de la misma
   * sesion en vuelo, no repite.
   */
  refrescar(): void {
    if (this.session.estado() === 'anonimo') {
      return;
    }
    const epoca = this.session.epocaDeIdentidad();
    if (this.enVuelo === epoca) {
      return;
    }
    this.enVuelo = epoca;

    forkJoin([this.pedirPanel(), this.pedirSolicitudes()])
      .pipe(
        finalize(() => {
          if (this.enVuelo === epoca) {
            this.enVuelo = null;
          }
        }),
      )
      .subscribe(([panel, solicitudesPendientes]) => {
        if (this.session.epocaDeIdentidad() === epoca) {
          this.cache.set({ epoca, ...panel, solicitudesPendientes });
        }
      });
  }

  private pedirPanel(): Observable<{
    centrosActivos: number | null;
    pedidosPendientes: number | null;
    cambiosPendientes: number | null;
  }> {
    return this.plataforma.getPanelDePlataforma().pipe(
      map((panel) => ({
        centrosActivos: panel.centros?.activos ?? null,
        pedidosPendientes: panel.pedidosPendientes ?? null,
        cambiosPendientes: panel.cambiosDePlanPendientes ?? null,
      })),
      catchError(() =>
        of({ centrosActivos: null, pedidosPendientes: null, cambiosPendientes: null }),
      ),
    );
  }

  private pedirSolicitudes(): Observable<number | null> {
    return this.catalogo.listCatalogoSolicitudes({ estado: 'PENDIENTE' }).pipe(
      map((lista) => lista.length),
      catchError(() => of(null)),
    );
  }
}
