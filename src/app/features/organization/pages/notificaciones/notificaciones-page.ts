import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { EstadoDeListado, vistaDeListado } from '../../../../shared/utils/estado-de-listado';
import { NotificacionesService } from '../../../../api/generated/api/notificaciones.service';
import { NotificationPageResponse } from '../../../../api/generated/model/notification-page-response';
import { NotificationResponse } from '../../../../api/generated/model/notification-response';
import { Paginacion } from '../../../../shared/components/paginacion/paginacion';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { formatearInstante } from '../../../../shared/utils/instantes';
import { traducirErrorColaborador } from '../../models/colaborador-errors';
import {
  ESTADOS_FILTRABLES,
  ESTADOS_POR_DEFECTO,
  EstadoNotificacion,
  textoEstado,
  textoTipo,
} from '../../models/notificaciones';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import { Pestanas } from '../../../../shared/components/pestanas/pestanas';
import {
  ETIQUETA_PESTANAS_DE_COLABORADORES,
  PESTANAS_DE_COLABORADORES,
} from '../../models/pestanas-de-colaboradores';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';

const POR_PAGINA = 20;

/**
 * Notificaciones de la organizacion que no salieron, con reintento por fila (RF-M26-005).
 *
 * <p>Consume `listNotifications` y `retryNotification`, los dos con `colaborador:manage`. Reemplaza
 * la seccion de Invitaciones que pedia el numero de notificacion a mano: ese numero ahora viene en
 * cada fila, y el boton "Reintentar" solo aparece donde el backend dice `reintentable`.
 *
 * <p><b>El filtro arranca en FALLIDA + AGOTADA</b>, que es lo que pide accion. Si se destildan
 * todos los estados no se consulta: el backend, sin `estado`, volveria a listar esas dos, y la
 * pantalla mostraria un resultado que no corresponde a lo que el usuario eligio.
 *
 * <p><b>Despues de reintentar se relee la pagina</b>, haya salido bien o mal: un 409 o un 404
 * significan que la fila que se ve ya no es la del servidor.
 *
 * <p><b>Reacciona a `contextEpoch`</b>: las notificaciones de la Organizacion A no pueden quedar en
 * pantalla bajo la B.
 */
@Component({
  selector: 'app-notificaciones-page',
  imports: [Pestanas, Ayuda, Filtros, RouterLink, Paginacion],
  templateUrl: './notificaciones-page.html',
  styleUrl: '../../organization.css',
})
export class NotificacionesPage {
  protected readonly pestanas = PESTANAS_DE_COLABORADORES;
  protected readonly etiquetaDePestanas = ETIQUETA_PESTANAS_DE_COLABORADORES;

  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly notificaciones = inject(NotificacionesService);
  private readonly tenantContext = inject(TenantContextStore);

  protected readonly estadosFiltrables = ESTADOS_FILTRABLES;
  protected readonly textoEstado = textoEstado;
  protected readonly textoTipo = textoTipo;
  protected readonly formatearInstante = (instante: string | undefined | null): string | null =>
    formatearInstante(instante, this.diaDeLaSede.zona());

  protected readonly estado = signal<EstadoDeListado<NotificationPageResponse>>({
    tipo: 'cargando',
  });
  private readonly vista = vistaDeListado<NotificationResponse>(this.estado);
  protected readonly filas = this.vista.filas;
  protected readonly totalPaginas = this.vista.totalPaginas;
  protected readonly totalNotificaciones = this.vista.totalElementos;
  protected readonly mensajeError = this.vista.mensajeError;
  protected readonly faltaContexto = this.vista.faltaContexto;

  protected readonly paginaActual = signal(0);
  protected readonly elegidos = signal<ReadonlySet<EstadoNotificacion>>(
    new Set(ESTADOS_POR_DEFECTO),
  );
  protected readonly sinEstados = computed(() => this.elegidos().size === 0);
  /** 1 si los estados elegidos no son los de por defecto (regla de filtros, plan §3.4). */
  protected readonly filtrosAvanzadosActivos = computed(() => {
    const elegidos = this.elegidos();
    const iguales =
      elegidos.size === ESTADOS_POR_DEFECTO.length &&
      ESTADOS_POR_DEFECTO.every((estado) => elegidos.has(estado));
    return Number(!iguales);
  });

  /** Id de la fila que se esta reintentando; deshabilita todos los botones mientras tanto. */
  protected readonly reintentando = signal<number | null>(null);
  protected readonly exito = signal<string | null>(null);
  protected readonly errorReintento = signal<string | null>(null);

  constructor() {
    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.paginaActual.set(0);
        this.exito.set(null);
        this.errorReintento.set(null);
        this.consultar();
      });
    });
  }

  protected estaElegido(estado: EstadoNotificacion): boolean {
    return this.elegidos().has(estado);
  }

  protected alternar(estado: EstadoNotificacion, evento: Event): void {
    const marcado = (evento.target as HTMLInputElement).checked;
    const siguiente = new Set(this.elegidos());
    if (marcado) {
      siguiente.add(estado);
    } else {
      siguiente.delete(estado);
    }
    this.elegidos.set(siguiente);
    this.paginaActual.set(0);
    this.consultar();
  }

  protected irAPagina(numero: number): void {
    if (numero < 0 || numero >= this.totalPaginas()) {
      return;
    }
    this.paginaActual.set(numero);
    this.consultar();
  }

  protected reintentar(fila: NotificationResponse): void {
    const orgId = this.tenantContext.organizationId();
    if (fila.id === undefined || orgId === null) {
      return;
    }
    const notificationId = fila.id;
    this.exito.set(null);
    this.errorReintento.set(null);
    this.reintentando.set(notificationId);

    this.notificaciones.retryNotification({ orgId, notificationId }).subscribe({
      next: () => {
        this.reintentando.set(null);
        this.exito.set(
          `La notificacion ${notificationId} (${textoTipo(fila.tipo)} a ${fila.destinatario ?? '-'}) ` +
            'volvio a la cola de envio. Sale en el proximo ciclo; el negocio que la origino no se repite.',
        );
        this.consultar();
      },
      error: (error: unknown) => {
        this.reintentando.set(null);
        this.errorReintento.set(traducirErrorDeReintento(error, notificationId));
        this.consultar();
      },
    });
  }

  private consultar(): void {
    const orgId = this.tenantContext.organizationId();
    if (orgId === null) {
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }
    if (this.sinEstados()) {
      this.estado.set({ tipo: 'inicial' });
      return;
    }

    this.estado.set({ tipo: 'cargando' });
    this.notificaciones
      .listNotifications({
        orgId,
        estado: ESTADOS_FILTRABLES.filter((estado) => this.elegidos().has(estado)),
        page: this.paginaActual(),
        size: POR_PAGINA,
      })
      .subscribe({
        next: (pagina) => this.estado.set({ tipo: 'listo', pagina }),
        error: (error: unknown) => {
          const traducido = traducirErrorColaborador(error);
          this.estado.set({
            tipo: 'error',
            mensaje: traducido.mensaje,
            faltaContexto: traducido.causa === 'sin-contexto',
          });
        },
      });
  }
}

function traducirErrorDeReintento(error: unknown, id: number): string {
  if (error instanceof AkineHttpError && !error.esDeRed) {
    if (error.status === 404) {
      return `La notificacion ${id} ya no existe en esta organizacion. Se actualizo el listado.`;
    }
    if (error.status === 409) {
      const estado = error.extension('estado');
      const actual =
        typeof estado === 'string'
          ? `: ahora esta ${textoEstado(estado as EstadoNotificacion)}`
          : '';
      return (
        `La notificacion ${id} ya no admite reintento${actual}. Solo se reintentan las fallidas ` +
        'o agotadas. Se actualizo el listado.'
      );
    }
  }
  return traducirErrorColaborador(error, {
    generico: 'No pudimos reintentar la notificacion. Volve a intentar en un momento.',
  }).mensaje;
}
