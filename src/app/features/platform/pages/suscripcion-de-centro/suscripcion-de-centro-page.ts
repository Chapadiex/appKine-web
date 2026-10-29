import { Component, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';

import { PlanesService } from '../../../../api/generated/api/planes.service';
import { PlataformaService } from '../../../../api/generated/api/plataforma.service';
import { ListPlatformOrganizationsRequestParams } from '../../../../api/generated/api/plataforma.serviceInterface';
import { SuscripcionesService } from '../../../../api/generated/api/suscripciones.service';
import { LimitUsageResponse } from '../../../../api/generated/model/limit-usage-response';
import { PlanResponse } from '../../../../api/generated/model/plan-response';
import { PlatformOrganizationResponse } from '../../../../api/generated/model/platform-organization-response';
import { PlatformSubscriptionResponse } from '../../../../api/generated/model/platform-subscription-response';
import { Paginacion } from '../../../../shared/components/paginacion/paginacion';
import { formatearFecha } from '../../../../shared/utils/instantes';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import { Icono } from '../../../../shared/components/icono/icono';
import { Pestanas } from '../../../../shared/components/pestanas/pestanas';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import {
  CamposDeSort,
  ordenDeServidor,
} from '../../../../shared/components/tabla/orden-de-servidor';
import {
  ETIQUETA_PESTANAS_DE_PLATAFORMA,
  PESTANAS_DE_PLATAFORMA,
} from '../../models/pestanas-de-plataforma';
import { ErrorSuscripcion, traducirErrorSuscripcion } from '../../models/suscripcion-errors';

type Estado =
  | { readonly tipo: 'inicial' }
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly suscripcion: PlatformSubscriptionResponse }
  | { readonly tipo: 'error'; readonly error: ErrorSuscripcion };

type EstadoDeSuscripcion = NonNullable<ListPlatformOrganizationsRequestParams['status']>;

interface PaginaDeCentros {
  readonly centros: readonly PlatformOrganizationResponse[];
  readonly pagina: number;
  readonly totalPaginas: number;
  readonly total: number;
}

type Listado =
  | { readonly tipo: 'cargando' }
  | ({ readonly tipo: 'listo' } & PaginaDeCentros)
  | { readonly tipo: 'error'; readonly error: ErrorSuscripcion };

interface Resultado {
  readonly ok: boolean;
  readonly texto: string;
  readonly excedidos: readonly LimitUsageResponse[];
}

const TAMANO_DE_PAGINA = 20;

/**
 * La suscripcion de un centro y el cambio de plan, para la administracion de plataforma (PLA-06).
 *
 * <p><b>Por que existe (D3 del pre-QA del 14/10).</b> El cambio de plan exige `expectedVersion`, y
 * la unica lectura de la suscripcion era la del tenant (`GET /organizations/{org}/subscription`),
 * que para la plataforma pide un acceso de soporte abierto. Sin soporte, la version solo salia de
 * la base. `appKine-api` #133 agrego `getPlatformSubscription` con el mismo guard que el cambio de
 * plan, y esta pantalla toma la version <b>de ahi</b>, nunca de un campo que se escriba a mano.
 *
 * <p><b>El centro se elige, no se tipea (RNF-M01-005).</b> El listado de plataforma
 * (`listPlatformOrganizations`, `appKine-api` #137) busca por nombre o slug y filtra por el estado
 * de la suscripcion. El identificador viaja por detras: la persona reconoce al centro por su
 * nombre, no por un numero interno.
 *
 * <p><b>Sin contexto de tenant</b>, igual que la bandeja de solicitudes: quien la usa administra la
 * plataforma y no es miembro del centro. Tampoco trae el consumo de limites, que es dato del centro
 * y sigue detras del soporte: los limites que el plan nuevo ya excede vuelven en la respuesta del
 * cambio, como aviso.
 */
@Component({
  selector: 'app-suscripcion-de-centro-page',
  imports: [Ayuda, ColumnaOrdenable, Filtros, Icono, PanelLateral, Pestanas, Paginacion],
  templateUrl: './suscripcion-de-centro-page.html',
})
export class SuscripcionDeCentroPage {
  private readonly plataforma = inject(PlataformaService);
  private readonly suscripciones = inject(SuscripcionesService);
  private readonly catalogoDePlanes = inject(PlanesService);

  protected readonly pestanasDePlataforma = PESTANAS_DE_PLATAFORMA;
  protected readonly etiquetaDePestanas = ETIQUETA_PESTANAS_DE_PLATAFORMA;

  protected readonly busqueda = signal('');
  protected readonly filtroDeEstado = signal<EstadoDeSuscripcion | ''>('');
  /** Filtros avanzados (detras del embudo) fuera de su valor por defecto. */
  protected readonly filtrosAvanzadosActivos = computed(() => Number(this.filtroDeEstado() !== ''));
  protected readonly listado = signal<Listado>({ tipo: 'cargando' });

  /**
   * Orden del listado de centros, pedido al servidor (DP-45): vuelve a la primera pagina con el
   * filtro ya aplicado, igual que paginar.
   */
  protected readonly orden = ordenDeServidor<
    CamposDeSort<ListPlatformOrganizationsRequestParams['sort']>
  >(() => this.listar(0));
  /** El centro elegido del listado: su nombre encabeza la suscripcion. */
  protected readonly centro = signal<PlatformOrganizationResponse | null>(null);
  protected readonly estado = signal<Estado>({ tipo: 'inicial' });
  protected readonly planes = signal<readonly PlanResponse[]>([]);
  protected readonly planesNoDisponibles = signal(false);
  protected readonly planElegido = signal('');
  protected readonly enviando = signal(false);
  protected readonly resultado = signal<Resultado | null>(null);

  /** El filtro de la ultima busqueda enviada: paginar no toma lo que se esta escribiendo. */
  private filtroAplicado: Pick<ListPlatformOrganizationsRequestParams, 'q' | 'status'> = {};
  private pedidoDeListado: Subscription | null = null;
  private pedido: Subscription | null = null;

  protected readonly paginaDeCentros = computed<PaginaDeCentros | null>(() => {
    const listado = this.listado();
    return listado.tipo === 'listo' ? listado : null;
  });
  protected readonly errorDeListado = computed(() => {
    const listado = this.listado();
    return listado.tipo === 'error' ? listado.error : null;
  });
  protected readonly suscripcion = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'listo' ? estado.suscripcion : null;
  });
  protected readonly error = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.error : null;
  });
  protected readonly activa = computed(() => this.suscripcion()?.status === 'ACTIVA');
  /** Elegir el plan vigente no es un cambio: el backend responderia `applied=false`. */
  protected readonly mismoPlan = computed(
    () => this.planElegido() !== '' && this.planElegido() === this.suscripcion()?.planCode,
  );

  constructor() {
    this.catalogoDePlanes.listPlans().subscribe({
      next: (planes) => this.planes.set(planes),
      error: () => this.planesNoDisponibles.set(true),
    });
    this.listar(0);
  }

  protected buscar(): void {
    const q = this.busqueda().trim();
    const status = this.filtroDeEstado();
    this.filtroAplicado = {
      ...(q === '' ? {} : { q }),
      ...(status === '' ? {} : { status }),
    };
    this.listar(0);
  }

  protected irAPagina(pagina: number): void {
    this.listar(pagina);
  }

  protected elegir(centro: PlatformOrganizationResponse): void {
    if (centro.id === undefined) return;
    this.centro.set(centro);
    this.resultado.set(null);
    this.leer();
  }

  /** Cierra el panel de la suscripcion: descarta la lectura en vuelo y el resultado. */
  protected cerrarSuscripcion(): void {
    this.pedido?.unsubscribe();
    this.centro.set(null);
    this.estado.set({ tipo: 'inicial' });
    this.resultado.set(null);
  }

  protected esElegido(centro: PlatformOrganizationResponse): boolean {
    return centro.id !== undefined && centro.id === this.centro()?.id;
  }

  protected fechaDeAlta(centro: PlatformOrganizationResponse): string {
    return formatearFecha(centro.createdAt) || '—';
  }

  protected cambiarPlan(): void {
    const orgId = this.centro()?.id;
    const suscripcion = this.suscripcion();
    const planCode = this.planElegido();
    if (
      orgId === undefined ||
      suscripcion?.version === undefined ||
      planCode === '' ||
      this.mismoPlan() ||
      this.enviando()
    ) {
      return;
    }
    this.enviando.set(true);
    this.resultado.set(null);
    this.suscripciones
      .changeSubscriptionPlan({
        orgId,
        planChangeRequest: { planCode, expectedVersion: suscripcion.version },
      })
      .subscribe({
        next: (respuesta) => {
          this.enviando.set(false);
          const excedidos = (respuesta.warnings ?? []).filter((w) => w.exceeded !== false);
          this.resultado.set({
            ok: true,
            texto:
              respuesta.applied === false
                ? 'Ese plan ya era el vigente: no hubo cambio.'
                : `El centro paso al plan ${this.nombreDePlan(planCode)}.`,
            excedidos,
          });
          // La version nueva sale de la relectura, que es la misma fuente que uso este envio.
          this.leer();
        },
        error: (error: unknown) => {
          this.enviando.set(false);
          const traducido = traducirErrorSuscripcion(error);
          this.resultado.set({ ok: false, texto: traducido.mensaje, excedidos: [] });
          if (traducido.causa === 'version-vieja') this.leer();
        },
      });
  }

  /** Modificador de `.marca-estado`: activa es vigente, suspendida reversible, cancelada terminal. */
  protected claseDeEstado(estado: string | undefined): string {
    if (estado === 'ACTIVA') return 'marca-estado--activa';
    if (estado === 'SUSPENDIDA') return 'marca-estado--suspendida';
    return 'marca-estado--revocada';
  }

  protected nombreDePlan(codigo: string | undefined): string {
    if (!codigo) return 'sin plan';
    return this.planes().find((p) => p.code === codigo)?.name ?? codigo;
  }

  protected rotuloDeLimite(limite: LimitUsageResponse): string {
    return `${limite.code ?? 'Limite'}: ${limite.currentUsage ?? '?'} en uso, el plan admite ${
      limite.limitValue ?? '?'
    }`;
  }

  private listar(pagina: number): void {
    this.listado.set({ tipo: 'cargando' });
    this.pedidoDeListado?.unsubscribe();
    this.pedidoDeListado = this.plataforma
      .listPlatformOrganizations({
        ...this.filtroAplicado,
        sort: this.orden.sort(),
        page: pagina,
        size: TAMANO_DE_PAGINA,
      })
      .subscribe({
        next: (respuesta) => {
          const centros = respuesta.content ?? [];
          this.listado.set({
            tipo: 'listo',
            centros,
            pagina: respuesta.page ?? pagina,
            totalPaginas: respuesta.totalPages ?? 1,
            total: respuesta.totalElements ?? centros.length,
          });
        },
        error: (error: unknown) =>
          this.listado.set({ tipo: 'error', error: traducirErrorSuscripcion(error) }),
      });
  }

  private leer(): void {
    const orgId = this.centro()?.id;
    if (orgId === undefined) return;
    this.estado.set({ tipo: 'cargando' });
    this.pedido?.unsubscribe();
    this.pedido = this.plataforma.getPlatformSubscription({ orgId }).subscribe({
      next: (suscripcion) => {
        this.estado.set({ tipo: 'listo', suscripcion });
        this.planElegido.set(suscripcion.planCode ?? '');
      },
      error: (error: unknown) =>
        this.estado.set({ tipo: 'error', error: traducirErrorSuscripcion(error) }),
    });
  }
}
