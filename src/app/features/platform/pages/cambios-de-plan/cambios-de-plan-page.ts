import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';

import { PedidosDeCambioDePlanService } from '../../../../api/generated/api/pedidos-de-cambio-de-plan.service';
import { ListarPedidosDeCambioDePlanRequestParams } from '../../../../api/generated/api/pedidos-de-cambio-de-plan.serviceInterface';
import { PedidoDeCambioDePlanResponse } from '../../../../api/generated/model/pedido-de-cambio-de-plan-response';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { textoDeAjuste } from '../../../../core/models/ajustes-de-plan';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { ContadoresDePlataformaStore } from '../../../../core/services/contadores-de-plataforma.store';
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
import { serviciosEnTexto } from '../../models/contratacion';
import { ErrorContratacion, traducirErrorContratacion } from '../../models/contratacion-errors';
import {
  ETIQUETA_PESTANAS_DE_PLATAFORMA,
  PESTANAS_DE_CENTROS,
} from '../../models/pestanas-de-plataforma';

type EstadoDelPedido = NonNullable<ListarPedidosDeCambioDePlanRequestParams['estado']>;

interface PaginaDePedidos {
  readonly pedidos: readonly PedidoDeCambioDePlanResponse[];
  readonly pagina: number;
  readonly totalPaginas: number;
  readonly total: number;
}

type Listado =
  | { readonly tipo: 'cargando' }
  | ({ readonly tipo: 'listo' } & PaginaDePedidos)
  | { readonly tipo: 'error'; readonly error: ErrorContratacion };

const MARCA: Readonly<Record<string, { clase: string; texto: string }>> = {
  PENDIENTE: { clase: 'marca-estado--info', texto: 'Pendiente' },
  APROBADO: { clase: 'marca-estado--activa', texto: 'Aprobado' },
  RECHAZADO: { clase: 'marca-estado--revocada', texto: 'Rechazado' },
  CANCELADO: { clase: 'marca-estado--neutra', texto: 'Cancelado por el centro' },
};

/**
 * Bandeja de pedidos de cambio de plan de los centros (25/11/2026, contrato 0.194.0).
 *
 * <p>Aprobar aplica la contratacion pedida —plan, servicios e IA— sin pasar una prueba a ACTIVA;
 * rechazar pide un motivo que el centro ve en su Suscripcion. Las dos mandan la version leida: si
 * el centro cancelo o alguien respondio antes, el backend da 409 y la bandeja se relee.
 */
@Component({
  selector: 'app-cambios-de-plan-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
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
  ],
  templateUrl: './cambios-de-plan-page.html',
  styleUrls: ['../pedidos-de-prueba/pedidos-de-prueba-page.css', './cambios-de-plan-page.css'],
})
export class CambiosDePlanPage {
  private readonly api = inject(PedidosDeCambioDePlanService);
  private readonly avisos = inject(AvisosStore);
  private readonly contadores = inject(ContadoresDePlataformaStore);

  protected readonly pestanasDePlataforma = PESTANAS_DE_CENTROS;
  protected readonly etiquetaDePestanas = ETIQUETA_PESTANAS_DE_PLATAFORMA;

  protected readonly busqueda = signal('');
  protected readonly filtroDeEstado = signal<EstadoDelPedido | ''>('PENDIENTE');
  protected readonly filtrosAvanzadosActivos = computed(() =>
    Number(this.filtroDeEstado() !== 'PENDIENTE'),
  );
  protected readonly porPagina = signal<number>(FILAS_POR_PAGINA_INICIAL);
  protected readonly listado = signal<Listado>({ tipo: 'cargando' });
  protected readonly pendientes = signal<number | null>(null);
  protected readonly hayFiltros = signal(false);

  protected readonly seleccionado = signal<PedidoDeCambioDePlanResponse | null>(null);
  protected readonly rechazando = signal(false);
  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);

  private filtroAplicado: Pick<ListarPedidosDeCambioDePlanRequestParams, 'q' | 'estado'> = {
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

  protected ver(pedido: PedidoDeCambioDePlanResponse): void {
    this.seleccionado.set(pedido);
    this.rechazando.set(false);
    this.errorAccion.set(null);
  }

  protected cerrar(): void {
    this.seleccionado.set(null);
    this.rechazando.set(false);
    this.errorAccion.set(null);
  }

  protected aprobar(): void {
    const pedido = this.seleccionado();
    if (pedido?.id === undefined || pedido.version === undefined || this.enviando()) return;
    this.enviando.set(true);
    this.errorAccion.set(null);
    this.api
      .aprobarPedidoDeCambioDePlan({
        id: pedido.id,
        versionDePedidoRequest: { version: pedido.version },
      })
      .subscribe({
        next: () =>
          this.resuelto(`Se aplicó el cambio de ${pedido.organizationNombre ?? 'el centro'}.`),
        error: (error: unknown) => this.fallo(error),
      });
  }

  protected rechazar(motivo: string): void {
    const pedido = this.seleccionado();
    if (pedido?.id === undefined || pedido.version === undefined || this.enviando()) return;
    this.enviando.set(true);
    this.errorAccion.set(null);
    this.api
      .rechazarPedidoDeCambioDePlan({
        id: pedido.id,
        rechazarPedidoDePlanRequest: { motivo, version: pedido.version },
      })
      .subscribe({
        next: () =>
          this.resuelto(
            `El pedido de ${pedido.organizationNombre ?? 'el centro'} quedó rechazado.`,
          ),
        error: (error: unknown) => this.fallo(error),
      });
  }

  /** "Plan Base · Kinesiología" de lo que tiene o de lo que pide. */
  protected contratacion(
    plan: string | undefined,
    servicios: readonly string[] | undefined,
    adicionales: readonly string[] | undefined,
  ): string {
    const ia = (adicionales ?? []).includes('IA') ? ' · con IA' : '';
    return `${plan ?? 'Sin plan'} · ${serviciosEnTexto(servicios)}${ia}`;
  }

  /** Lo que el centro tiene que ajustar antes de poder aprobar (26/11/2026). */
  protected ajustes(pedido: PedidoDeCambioDePlanResponse): readonly string[] {
    return (pedido.excesos ?? []).map((e) =>
      textoDeAjuste(e.limitCode ?? '', e.tope ?? 0, e.uso ?? 0, pedido.planNombre ?? ''),
    );
  }

  protected marca(estado: string | undefined): { clase: string; texto: string } {
    return MARCA[estado ?? ''] ?? { clase: 'marca-estado--neutra', texto: 'Sin dato' };
  }

  protected fecha(instante: string | undefined): string {
    return formatearInstante(instante) ?? 'Sin fecha';
  }

  protected textoPendientes(cantidad: number): string {
    return cantidad === 1 ? '1 pendiente' : `${cantidad} pendientes`;
  }

  private resuelto(descripcion: string): void {
    this.enviando.set(false);
    this.avisos.exito('Pedido respondido', { descripcion });
    this.cerrar();
    this.contadores.refrescar();
    this.listar(this.paginaActual);
  }

  private fallo(error: unknown): void {
    this.enviando.set(false);
    const traducido = traducirErrorContratacion(error, 'pedido-de-plan');
    if (error instanceof AkineHttpError && error.problemType === 'pedido-excede-limites') {
      // Se ajusto otra cosa en el medio: el centro sigue pasado de tope. Se relee para mostrar cuanto.
      this.errorAccion.set(
        'El centro todavía tiene más sedes o profesionales de los que permite el plan pedido. ' +
          'Se aprueba cuando se ajuste.',
      );
      this.listar(this.paginaActual);
      return;
    }
    this.errorAccion.set(traducido.mensaje);
    if (traducido.causa === 'conflicto' || traducido.causa === 'no-encontrado') {
      this.rechazando.set(false);
      this.listar(this.paginaActual);
    }
  }

  private listar(pagina: number): void {
    this.paginaActual = pagina;
    this.listado.set({ tipo: 'cargando' });
    this.pedidoDeListado?.unsubscribe();
    this.pedidoDeListado = this.api
      .listarPedidosDeCambioDePlan({ ...this.filtroAplicado, page: pagina, size: this.porPagina() })
      .subscribe({
        next: (respuesta) => {
          const pedidos = respuesta.content ?? [];
          this.pendientes.set(respuesta.pendientes ?? null);
          const abierto = this.seleccionado();
          if (abierto) {
            this.seleccionado.set(pedidos.find((p) => p.id === abierto.id) ?? abierto);
          }
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
