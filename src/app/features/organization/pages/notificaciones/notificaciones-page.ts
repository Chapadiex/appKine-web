import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { EstadoDeListado, vistaDeListado } from '../../../../shared/utils/estado-de-listado';
import { NotificacionesService } from '../../../../api/generated/api/notificaciones.service';
import { NotificationPageResponse } from '../../../../api/generated/model/notification-page-response';
import { NotificationResponse } from '../../../../api/generated/model/notification-response';
import {
  FILAS_POR_PAGINA_INICIAL,
  Paginacion,
} from '../../../../shared/components/paginacion/paginacion';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
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
import { Icono } from '../../../../shared/components/icono/icono';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import {
  CamposDeSort,
  ordenDeServidor,
} from '../../../../shared/components/tabla/orden-de-servidor';
import { textoDeBusqueda } from '../../../../shared/utils/texto-de-busqueda';
import { ListNotificationsRequestParams } from '../../../../api/generated/api/notificaciones.serviceInterface';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

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
  imports: [
    CabeceraDePagina,
    Pestanas,
    Ayuda,
    Icono,
    Filtros,
    ColumnaOrdenable,
    RouterLink,
    Paginacion,
    EstadoVacio,
    Alerta,
  ],
  templateUrl: './notificaciones-page.html',
  styleUrl: '../../organization.css',
})
export class NotificacionesPage {
  protected readonly pestanas = PESTANAS_DE_COLABORADORES;
  protected readonly etiquetaDePestanas = ETIQUETA_PESTANAS_DE_COLABORADORES;

  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly notificaciones = inject(NotificacionesService);
  private readonly avisos = inject(AvisosStore);
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

  /** Filas por pagina (UX-14): viaja como `size`; el usuario lo cambia desde el pie. */
  protected readonly porPagina = signal<number>(FILAS_POR_PAGINA_INICIAL);

  /** El tipo de notificacion, o el destinatario exacto (DP-45, `q` del servidor). */
  protected readonly busqueda = signal('');

  /** Orden de la tabla, pedido al servidor: cambiarlo vuelve a la primera pagina (DP-45). */
  protected readonly orden = ordenDeServidor<CamposDeSort<ListNotificationsRequestParams['sort']>>(
    () => this.consultarDesdeElPrincipio(),
  );

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

  constructor() {
    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.paginaActual.set(0);
        this.busqueda.set('');
        this.orden.reiniciar();
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
    this.consultarDesdeElPrincipio();
  }

  protected buscar(texto: string): void {
    this.busqueda.set(texto);
    this.consultarDesdeElPrincipio();
  }

  /** "Limpiar filtros": sin busqueda y con los estados de entrada (Fallida + Agotada). */
  protected limpiarFiltros(): void {
    this.busqueda.set('');
    this.elegidos.set(new Set(ESTADOS_POR_DEFECTO));
    this.consultarDesdeElPrincipio();
  }

  /** Otro tamaño de pagina: vuelve a la primera, que la actual puede no existir con el nuevo. */
  protected cambiarPorPagina(cantidad: number): void {
    this.porPagina.set(cantidad);
    this.consultarDesdeElPrincipio();
  }

  private consultarDesdeElPrincipio(): void {
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
    this.reintentando.set(notificationId);

    this.notificaciones.retryNotification({ orgId, notificationId }).subscribe({
      next: () => {
        this.reintentando.set(null);
        // UX-12: accion de una fila, sin formulario: el resultado va al aviso global.
        this.avisos.exito('Notificación en la cola de envío', {
          descripcion:
            `La notificación ${notificationId} (${textoTipo(fila.tipo)} a ${fila.destinatario ?? '-'}) ` +
            'sale en el próximo ciclo; el negocio que la origino no se repite.',
        });
        this.consultar();
      },
      error: (error: unknown) => {
        this.reintentando.set(null);
        // Sin "Reintentar" en el aviso: el listado se relee y, si la fila sigue admitiendo
        // reintento, su propio boton es la salida.
        this.avisos.error('No pudimos reintentar la notificación', {
          descripcion: traducirErrorDeReintento(error, notificationId),
        });
        this.consultar();
      },
    });
  }

  protected consultar(): void {
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
        size: this.porPagina(),
        q: textoDeBusqueda(this.busqueda()),
        sort: this.orden.sort(),
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
      return `La notificación ${id} ya no existe en esta organización. Se actualizo el listado.`;
    }
    if (error.status === 409) {
      const estado = error.extension('estado');
      const actual =
        typeof estado === 'string'
          ? `: ahora esta ${textoEstado(estado as EstadoNotificacion)}`
          : '';
      return (
        `La notificación ${id} ya no admite reintento${actual}. Solo se reintentan las fallidas ` +
        'o agotadas. Se actualizo el listado.'
      );
    }
  }
  return traducirErrorColaborador(error, {
    generico: 'No pudimos reintentar la notificación. Volvé a intentar en un momento.',
  }).mensaje;
}
