import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { EventoDeAgenda } from '../../../../api/generated/model/evento-de-agenda';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import {
  ErrorAsistencia,
  errorSinContexto,
  traducirErrorAsistencia,
} from '../../models/asistencia-errors';
import { etiquetaDeEstadoDeClase, horaEnZona } from '../../models/etiquetas-de-asistencia';
import { AsistenciaApi } from '../../services/asistencia-api';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { Paginacion } from '../../../../shared/components/paginacion/paginacion';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import { tablaLocal } from '../../../../shared/components/tabla/tabla-local';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly clases: readonly EventoDeAgenda[]; readonly zona: string }
  | { readonly tipo: 'error'; readonly error: ErrorAsistencia };

/**
 * Clases del dia, para elegir a cual tomarle lista (M28, AKINE-08.03).
 *
 * <p>Lee la agenda unificada del dia —la misma que discrimina TURNO de CLASE— y se queda con las
 * clases. El dia por defecto es el de la SEDE ({@link DiaDeLaSede}), no el del navegador: de
 * noche un navegador en UTC ya esta en manana.
 */
@Component({
  selector: 'app-clases-del-dia-page',
  imports: [CabeceraDePagina, Ayuda, ColumnaOrdenable, Paginacion, RouterLink],
  templateUrl: './clases-del-dia-page.html',
  styleUrl: '../../asistencia.css',
})
export class ClasesDelDiaPage {
  private readonly api = inject(AsistenciaApi);
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly tenant = inject(TenantContextStore);

  protected readonly etiquetaDeEstado = etiquetaDeEstadoDeClase;
  protected readonly hora = horaEnZona;

  protected readonly fecha = signal(this.diaDeLaSede.hoy());
  protected readonly estado = signal<Estado>({ tipo: 'cargando' });

  protected readonly clases = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.clases : [];
  });
  /** Orden y paginado de la lista completa (plan §3.4): la agenda del dia no se pagina. */
  protected readonly tabla = tablaLocal(this.clases, {
    columnas: {
      horario: (clase) => clase.inicio,
      clase: (clase) => clase.titulo || clase.ofertaNombre,
      estado: (clase) => this.etiquetaDeEstado(clase.estado),
    },
  });
  protected readonly zona = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.zona : '';
  });
  protected readonly error = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.error : null;
  });

  /** Respuesta mas nueva pedida: una vieja que llega tarde no pisa a la nueva. */
  private pedido = 0;

  constructor() {
    this.diaDeLaSede.alinear(
      () => this.fecha(),
      (hoy) => this.fecha.set(hoy),
    );
    effect(() => {
      this.tenant.contextEpoch();
      const fecha = this.fecha();
      untracked(() => this.cargar(fecha));
    });
  }

  protected porcentajeDeCupo(clase: EventoDeAgenda): number {
    const capacidad = clase.capacidad ?? 0;
    return capacidad > 0 ? Math.min(100, ((clase.ocupados ?? 0) / capacidad) * 100) : 0;
  }

  protected cambiarFecha(valor: string): void {
    if (valor !== '') {
      this.fecha.set(valor);
    }
  }

  protected cargar(fecha = this.fecha()): void {
    const consultorioId = this.tenant.consultorioId();
    const pedido = ++this.pedido;
    if (consultorioId === null) {
      this.estado.set({ tipo: 'error', error: errorSinContexto() });
      return;
    }
    this.estado.set({ tipo: 'cargando' });
    this.api.clasesDelDia(consultorioId, fecha).subscribe({
      next: (agenda) => {
        if (pedido === this.pedido) {
          this.estado.set({
            tipo: 'listo',
            clases: agenda.eventos ?? [],
            zona: agenda.timezone ?? this.diaDeLaSede.zona(),
          });
        }
      },
      error: (error: unknown) => {
        if (pedido === this.pedido) {
          this.estado.set({ tipo: 'error', error: traducirErrorAsistencia(error) });
        }
      },
    });
  }
}
