import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { PedidosDePruebaService } from '../../../../api/generated/api/pedidos-de-prueba.service';
import { ListarSolicitudesDePruebaRequestParams } from '../../../../api/generated/api/pedidos-de-prueba.serviceInterface';
import { SolicitudDePruebaResponse } from '../../../../api/generated/model/solicitud-de-prueba-response';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { AccionesDeFila } from '../../../../shared/components/acciones-de-fila/acciones-de-fila';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import { Icono } from '../../../../shared/components/icono/icono';
import {
  FILAS_POR_PAGINA_INICIAL,
  Paginacion,
} from '../../../../shared/components/paginacion/paginacion';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import { Pestanas } from '../../../../shared/components/pestanas/pestanas';
import { formatearInstante } from '../../../../shared/utils/instantes';
import { ErrorContratacion, traducirErrorContratacion } from '../../models/contratacion-errors';
import {
  etiquetaDeSedes,
  marcaDePedido,
  serviciosDelPedido,
  serviciosEnTexto,
} from '../../models/contratacion';
import {
  ETIQUETA_PESTANAS_DE_PLATAFORMA,
  PESTANAS_DE_CENTROS,
} from '../../models/pestanas-de-plataforma';
import { RUTA_ALTA_DE_CENTRO_DE_PLATAFORMA } from '../../models/rutas-de-plataforma';

type EstadoDelPedido = NonNullable<ListarSolicitudesDePruebaRequestParams['estado']>;

interface PaginaDePedidos {
  readonly pedidos: readonly SolicitudDePruebaResponse[];
  readonly pagina: number;
  readonly totalPaginas: number;
  readonly total: number;
}

type Listado =
  | { readonly tipo: 'cargando' }
  | ({ readonly tipo: 'listo' } & PaginaDePedidos)
  | { readonly tipo: 'error'; readonly error: ErrorContratacion };

/**
 * Bandeja de pedidos de prueba gratis que llegan desde la landing (diseño
 * `AKINE-landing-y-ofertas.md` §5).
 *
 * <p>La plataforma <b>aprueba dando de alta el centro</b>: "Dar de alta" lleva al formulario de alta
 * prellenado con el pedido (`?solicitud=<id>`), que es quien lo deja `APROBADA` en la misma
 * transaccion. Descartar pide motivo y manda la version leida; si otra persona lo resolvio antes,
 * el backend responde 409 y la bandeja se relee.
 *
 * <p>La lista se pagina en el servidor, que ordena por fecha de llegada, la mas reciente primero
 * (el contrato no admite otro orden). El contador de pendientes es el total sin filtro, el que
 * manda la respuesta: no depende de la busqueda.
 */
@Component({
  selector: 'app-pedidos-de-prueba-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AccionesDeFila,
    Alerta,
    Ayuda,
    CabeceraDePagina,
    ConfirmacionConMotivo,
    EstadoVacio,
    Filtros,
    Icono,
    Paginacion,
    PanelLateral,
    Pestanas,
    RouterLink,
  ],
  templateUrl: './pedidos-de-prueba-page.html',
  styleUrl: './pedidos-de-prueba-page.css',
})
export class PedidosDePruebaPage {
  private readonly pedidosDePrueba = inject(PedidosDePruebaService);
  private readonly avisos = inject(AvisosStore);

  protected readonly pestanasDePlataforma = PESTANAS_DE_CENTROS;
  protected readonly etiquetaDePestanas = ETIQUETA_PESTANAS_DE_PLATAFORMA;
  protected readonly rutaAlta = RUTA_ALTA_DE_CENTRO_DE_PLATAFORMA;
  protected readonly marcaDePedido = marcaDePedido;
  protected readonly etiquetaDeSedes = etiquetaDeSedes;

  protected readonly busqueda = signal('');
  /** `''` = todos los estados. Entra en pendientes: es lo que hay que resolver. */
  protected readonly filtroDeEstado = signal<EstadoDelPedido | ''>('PENDIENTE');
  protected readonly filtrosAvanzadosActivos = computed(() =>
    Number(this.filtroDeEstado() !== 'PENDIENTE'),
  );
  protected readonly porPagina = signal<number>(FILAS_POR_PAGINA_INICIAL);
  protected readonly listado = signal<Listado>({ tipo: 'cargando' });
  /** Pendientes sin filtro, de la ultima respuesta. `null` hasta la primera. */
  protected readonly pendientes = signal<number | null>(null);
  protected readonly hayFiltros = signal(false);

  /** El pedido abierto en el panel lateral. */
  protected readonly seleccionado = signal<SolicitudDePruebaResponse | null>(null);
  protected readonly descartando = signal(false);
  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);

  private filtroAplicado: Pick<ListarSolicitudesDePruebaRequestParams, 'q' | 'estado'> = {
    estado: 'PENDIENTE',
  };
  private paginaActual = 0;
  private pedidoDeListado: Subscription | null = null;

  protected readonly paginaDePedidos = computed<PaginaDePedidos | null>(() => {
    const listado = this.listado();
    return listado.tipo === 'listo' ? listado : null;
  });
  protected readonly errorDeListado = computed(() => {
    const listado = this.listado();
    return listado.tipo === 'error' ? listado.error : null;
  });

  constructor() {
    this.listar(0);
  }

  protected buscar(): void {
    const q = this.busqueda().trim();
    const estado = this.filtroDeEstado();
    this.filtroAplicado = {
      ...(q === '' ? {} : { q }),
      ...(estado === '' ? {} : { estado }),
    };
    this.hayFiltros.set(q !== '' || estado !== 'PENDIENTE');
    this.listar(0);
  }

  protected limpiarFiltros(): void {
    this.busqueda.set('');
    this.filtroDeEstado.set('PENDIENTE');
    this.buscar();
  }

  protected cambiarPorPagina(cantidad: number): void {
    this.porPagina.set(cantidad);
    this.listar(0);
  }

  protected irAPagina(pagina: number): void {
    this.listar(pagina);
  }

  protected ver(pedido: SolicitudDePruebaResponse): void {
    this.seleccionado.set(pedido);
    this.descartando.set(false);
    this.errorAccion.set(null);
  }

  protected pedirDescarte(pedido: SolicitudDePruebaResponse): void {
    this.ver(pedido);
    this.descartando.set(true);
  }

  protected cerrar(): void {
    this.seleccionado.set(null);
    this.descartando.set(false);
    this.errorAccion.set(null);
  }

  protected descartar(motivo: string): void {
    const pedido = this.seleccionado();
    if (pedido?.id === undefined || pedido.version === undefined || this.enviando()) return;
    this.enviando.set(true);
    this.errorAccion.set(null);
    this.pedidosDePrueba
      .descartarSolicitudDePrueba({
        id: pedido.id,
        descartarSolicitudRequest: { motivo, version: pedido.version },
      })
      .subscribe({
        next: () => {
          this.enviando.set(false);
          this.avisos.exito('Pedido descartado', {
            descripcion: `${pedido.nombreCentro ?? 'El pedido'} quedó descartado.`,
          });
          this.cerrar();
          this.listar(this.paginaActual);
        },
        error: (error: unknown) => {
          this.enviando.set(false);
          const traducido = traducirErrorContratacion(error, 'descarte');
          this.errorAccion.set(traducido.mensaje);
          if (traducido.causa === 'conflicto' || traducido.causa === 'no-encontrado') {
            this.descartando.set(false);
            this.releer(pedido.id!);
            this.listar(this.paginaActual);
          }
        },
      });
  }

  protected persona(pedido: SolicitudDePruebaResponse): string {
    return [pedido.nombre, pedido.apellido].filter(Boolean).join(' ') || 'Sin nombre';
  }

  protected servicios(pedido: SolicitudDePruebaResponse): string {
    return serviciosEnTexto(serviciosDelPedido(pedido));
  }

  protected fecha(instante: string | undefined): string {
    return formatearInstante(instante) ?? 'Sin fecha';
  }

  protected textoPendientes(cantidad: number): string {
    return cantidad === 1 ? '1 pendiente' : `${cantidad} pendientes`;
  }

  /** Vuelve a leer el pedido abierto para mostrar como lo dejo quien gano. */
  private releer(id: number): void {
    this.pedidosDePrueba.verSolicitudDePrueba({ id }).subscribe({
      next: (pedido) => {
        if (this.seleccionado()?.id === id) this.seleccionado.set(pedido);
      },
      error: () => undefined,
    });
  }

  private listar(pagina: number): void {
    this.paginaActual = pagina;
    this.listado.set({ tipo: 'cargando' });
    this.pedidoDeListado?.unsubscribe();
    this.pedidoDeListado = this.pedidosDePrueba
      .listarSolicitudesDePrueba({ ...this.filtroAplicado, page: pagina, size: this.porPagina() })
      .subscribe({
        next: (respuesta) => {
          const pedidos = respuesta.content ?? [];
          this.pendientes.set(respuesta.pendientes ?? null);
          this.listado.set({
            tipo: 'listo',
            pedidos,
            pagina: respuesta.page ?? pagina,
            totalPaginas: respuesta.totalPages ?? 1,
            total: respuesta.totalElements ?? pedidos.length,
          });
        },
        error: (error: unknown) =>
          this.listado.set({ tipo: 'error', error: traducirErrorContratacion(error, 'lectura') }),
      });
  }
}
