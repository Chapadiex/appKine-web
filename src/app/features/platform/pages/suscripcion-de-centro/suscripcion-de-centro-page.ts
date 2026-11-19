import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { ContratacionService } from '../../../../api/generated/api/contratacion.service';
import { PlanesService } from '../../../../api/generated/api/planes.service';
import { PlataformaService } from '../../../../api/generated/api/plataforma.service';
import { ListPlatformOrganizationsRequestParams } from '../../../../api/generated/api/plataforma.serviceInterface';
import { ContratacionResponse } from '../../../../api/generated/model/contratacion-response';
import { PlanResponse } from '../../../../api/generated/model/plan-response';
import { PlatformOrganizationResponse } from '../../../../api/generated/model/platform-organization-response';
import {
  UpdateContratacionRequestAdicionalesEnum,
  UpdateContratacionRequestServiciosEnum,
} from '../../../../api/generated/model/update-contratacion-request';
import {
  FILAS_POR_PAGINA_INICIAL,
  Paginacion,
} from '../../../../shared/components/paginacion/paginacion';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
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
import { ErrorContratacion, traducirErrorContratacion } from '../../models/contratacion-errors';
import {
  SERVICIOS,
  Servicio,
  diasRestantes,
  marcaDeSuscripcion,
  planesOfrecidos,
  rotuloDeTope,
  serviciosEnTexto,
  tieneIa,
  topeDeSedes,
} from '../../models/contratacion';
import { RUTA_ALTA_DE_CENTRO_DE_PLATAFORMA } from '../../models/rutas-de-plataforma';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../core/services/avisos.store';

type Estado =
  | { readonly tipo: 'inicial' }
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly contratacion: ContratacionResponse }
  | { readonly tipo: 'error'; readonly error: ErrorContratacion };

type EstadoDeSuscripcion = NonNullable<ListPlatformOrganizationsRequestParams['status']>;

/** Lo que el panel necesita del centro elegido: viene del listado o de la vuelta del alta. */
type CentroElegido = Pick<PlatformOrganizationResponse, 'id' | 'name' | 'slug'>;

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

/**
 * La suscripcion y la contratacion de un centro, para la administracion de plataforma (PLA-06 y
 * landing con prueba gratis, 18/11/2026).
 *
 * <p><b>Una sola lectura, una sola version.</b> El panel lee la contratacion de plataforma
 * (`getContratacionDeCentroEnPlataforma`): plan, servicios, adicionales, estado, fin de la prueba y
 * la version de la suscripcion. El cambio (`updateContratacionDeCentro`) es un reemplazo completo
 * con esa version; si otro cambio llego antes, 409 y la pantalla relee. Reemplaza al viejo "Cambiar
 * el plan", que ofrecia todos los planes: ahora solo se contratan los que se ofrecen.
 *
 * <p><b>La prueba.</b> `PRUEBA` muestra los dias que quedan; vencida, el centro esta en solo lectura
 * (`soloLectura`) aunque el estado guardado siga en `PRUEBA`. "Pasar a contrato" manda
 * `contratar: true` y la deja `ACTIVA`, vencida o no.
 *
 * <p><b>El centro se elige, no se tipea (RNF-M01-005).</b> El listado de plataforma busca por
 * nombre o slug y filtra por el estado de la suscripcion. Tambien se abre con `?org=<id>`, que es
 * a donde vuelve el alta de un centro.
 *
 * <p><b>Sin contexto de tenant</b>: quien la usa administra la plataforma y no es miembro del centro.
 */
@Component({
  selector: 'app-suscripcion-de-centro-page',
  imports: [
    CabeceraDePagina,
    Ayuda,
    ColumnaOrdenable,
    Filtros,
    Icono,
    PanelLateral,
    Pestanas,
    Paginacion,
    EstadoVacio,
    Alerta,
    RouterLink,
  ],
  templateUrl: './suscripcion-de-centro-page.html',
})
export class SuscripcionDeCentroPage implements OnInit {
  private readonly plataforma = inject(PlataformaService);
  private readonly contratacionDeCentro = inject(ContratacionService);
  private readonly avisos = inject(AvisosStore);
  private readonly catalogoDePlanes = inject(PlanesService);

  /** `?org=<id>&nombre=<nombre>`: abre el panel de ese centro (vuelta del alta). */
  readonly org = input<string | undefined>(undefined);
  readonly nombre = input<string | undefined>(undefined);

  protected readonly pestanasDePlataforma = PESTANAS_DE_PLATAFORMA;
  protected readonly etiquetaDePestanas = ETIQUETA_PESTANAS_DE_PLATAFORMA;
  protected readonly rutaAlta = RUTA_ALTA_DE_CENTRO_DE_PLATAFORMA;
  protected readonly servicios = SERVICIOS;
  protected readonly marcaDeSuscripcion = marcaDeSuscripcion;
  protected readonly topeDeSedes = topeDeSedes;
  protected readonly tieneIa = tieneIa;
  protected readonly rotuloDeTope = rotuloDeTope;
  protected readonly serviciosEnTexto = serviciosEnTexto;

  protected readonly busqueda = signal('');
  protected readonly filtroDeEstado = signal<EstadoDeSuscripcion | ''>('');
  /** Filtros avanzados (detras del embudo) fuera de su valor por defecto. */
  protected readonly filtrosAvanzadosActivos = computed(() => Number(this.filtroDeEstado() !== ''));
  protected readonly listado = signal<Listado>({ tipo: 'cargando' });

  /** Filas por pagina (UX-14): viaja como `size`; el usuario lo cambia desde el pie. */
  protected readonly porPagina = signal<number>(FILAS_POR_PAGINA_INICIAL);

  /** La ultima busqueda enviada tenia texto o estado: decide cual de los dos vacios es. */
  protected readonly hayFiltros = signal(false);

  /**
   * Orden del listado de centros, pedido al servidor (DP-45): vuelve a la primera pagina con el
   * filtro ya aplicado, igual que paginar.
   */
  protected readonly orden = ordenDeServidor<
    CamposDeSort<ListPlatformOrganizationsRequestParams['sort']>
  >(() => this.listar(0));
  /** El centro elegido del listado: su nombre encabeza la contratacion. */
  protected readonly centro = signal<CentroElegido | null>(null);
  protected readonly estado = signal<Estado>({ tipo: 'inicial' });
  /** Solo los planes que se ofrecen. */
  protected readonly planes = signal<readonly PlanResponse[]>([]);
  protected readonly planesNoDisponibles = signal(false);

  // Lo que se esta editando en el panel, inicializado con la ultima lectura.
  protected readonly planElegido = signal('');
  protected readonly serviciosElegidos = signal<readonly Servicio[]>([]);
  protected readonly iaElegida = signal(false);

  protected readonly enviando = signal(false);
  /** Rechazo del ultimo cambio: va arriba del formulario, dentro del panel (UX-12). */
  protected readonly errorCambio = signal<string | null>(null);

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
  protected readonly contratacion = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'listo' ? estado.contratacion : null;
  });
  protected readonly error = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.error : null;
  });
  protected readonly enPrueba = computed(() => this.contratacion()?.estado === 'PRUEBA');
  /** Suspendida o cancelada: la contratacion no se cambia desde aca. */
  protected readonly editable = computed(() => {
    const estado = this.contratacion()?.estado;
    return estado === 'PRUEBA' || estado === 'ACTIVA';
  });
  protected readonly dias = computed(() => diasRestantes(this.contratacion()?.pruebaHasta));
  protected readonly pruebaVencida = computed(() => {
    const dias = this.dias();
    return this.enPrueba() && dias !== null && dias <= 0;
  });
  /** El plan vigente no se ofrece mas (BASICO, PROFESIONAL): hay que elegir uno ofrecido. */
  protected readonly planNoOfrecido = computed(() => {
    const actual = this.contratacion()?.planCode;
    return actual !== undefined && !this.planes().some((p) => p.code === actual);
  });
  protected readonly planElegidoOfrecido = computed(() =>
    this.planes().some((p) => p.code === this.planElegido()),
  );
  protected readonly sinServicios = computed(() => this.serviciosElegidos().length === 0);
  /** Lo editado es igual a lo leido: guardar no cambiaria nada. */
  protected readonly sinCambios = computed(() => {
    const c = this.contratacion();
    if (c === null) return true;
    const leidos = [...(c.servicios ?? [])].sort().join();
    const elegidos = [...this.serviciosElegidos()].sort().join();
    return (
      this.planElegido() === c.planCode &&
      leidos === elegidos &&
      this.iaElegida() === tieneIa(c.adicionales)
    );
  });

  constructor() {
    this.catalogoDePlanes.listPlans().subscribe({
      next: (planes) => this.planes.set(planesOfrecidos(planes)),
      error: () => this.planesNoDisponibles.set(true),
    });
    this.listar(0);
  }

  ngOnInit(): void {
    const id = Number(this.org());
    if (this.org() && Number.isInteger(id) && id > 0) {
      this.elegir({ id, name: this.nombre() ?? 'Centro nuevo' });
    }
  }

  protected buscar(): void {
    const q = this.busqueda().trim();
    const status = this.filtroDeEstado();
    this.filtroAplicado = {
      ...(q === '' ? {} : { q }),
      ...(status === '' ? {} : { status }),
    };
    this.hayFiltros.set(q !== '' || status !== '');
    this.listar(0);
  }

  /** "Limpiar filtros": sin texto ni estado, todos los centros desde la primera pagina. */
  protected limpiarFiltros(): void {
    this.busqueda.set('');
    this.filtroDeEstado.set('');
    this.buscar();
  }

  /** Otro tamaño de pagina: vuelve a la primera con el filtro ya aplicado. */
  protected cambiarPorPagina(cantidad: number): void {
    this.porPagina.set(cantidad);
    this.listar(0);
  }

  protected irAPagina(pagina: number): void {
    this.listar(pagina);
  }

  protected elegir(centro: CentroElegido): void {
    if (centro.id === undefined) return;
    this.centro.set(centro);
    this.errorCambio.set(null);
    this.leer();
  }

  /** Cierra el panel: descarta la lectura en vuelo y el resultado. */
  protected cerrarSuscripcion(): void {
    this.pedido?.unsubscribe();
    this.centro.set(null);
    this.estado.set({ tipo: 'inicial' });
    this.errorCambio.set(null);
  }

  protected esElegido(centro: PlatformOrganizationResponse): boolean {
    return centro.id !== undefined && centro.id === this.centro()?.id;
  }

  protected fechaDeAlta(centro: PlatformOrganizationResponse): string {
    return formatearFecha(centro.createdAt) || '—';
  }

  protected fechaDeFin(instante: string | undefined): string {
    return formatearFecha(instante) || '—';
  }

  protected alternarServicio(servicio: Servicio, elegido: boolean): void {
    this.serviciosElegidos.update((actuales) =>
      elegido
        ? [...actuales.filter((s) => s !== servicio), servicio]
        : actuales.filter((s) => s !== servicio),
    );
  }

  protected servicioElegido(servicio: Servicio): boolean {
    return this.serviciosElegidos().includes(servicio);
  }

  /** Guarda lo editado; con `contratar`, ademas pasa la prueba a contrato. */
  protected guardar(contratar: boolean): void {
    const orgId = this.centro()?.id;
    const c = this.contratacion();
    const planCode = this.planElegido();
    if (
      orgId === undefined ||
      c?.version === undefined ||
      !this.planElegidoOfrecido() ||
      this.sinServicios() ||
      this.enviando() ||
      (!contratar && this.sinCambios())
    ) {
      return;
    }
    this.enviando.set(true);
    this.errorCambio.set(null);
    const nombre = this.centro()?.name ?? 'El centro';
    this.contratacionDeCentro
      .updateContratacionDeCentro({
        orgId,
        updateContratacionRequest: {
          planCode,
          servicios: SERVICIOS.filter((s) => this.servicioElegido(s.valor)).map(
            (s) => s.valor as UpdateContratacionRequestServiciosEnum,
          ),
          adicionales: this.iaElegida() ? [UpdateContratacionRequestAdicionalesEnum.IA] : [],
          contratar,
          version: c.version,
        },
      })
      .subscribe({
        next: (actualizada) => {
          this.enviando.set(false);
          this.avisos.exito(contratar ? 'Pasó a contrato' : 'Contratación guardada', {
            descripcion: contratar
              ? `${nombre} dejó la prueba: la suscripción está activa.`
              : `${nombre}: plan ${actualizada.planNombre ?? actualizada.planCode}, ${serviciosEnTexto(
                  actualizada.servicios,
                )}.`,
          });
          this.mostrar(actualizada);
          // El listado muestra plan y estado: se relee la pagina en la que estaba.
          this.listar(this.paginaDeCentros()?.pagina ?? 0);
        },
        error: (error: unknown) => {
          this.enviando.set(false);
          const traducido = traducirErrorContratacion(error, 'contratacion');
          this.errorCambio.set(traducido.mensaje);
          if (traducido.causa === 'conflicto') this.leer();
        },
      });
  }

  /** Modificador de `.marca-estado` del listado (el estado guardado). */
  protected claseDeEstado(estado: string | undefined): string {
    return marcaDeSuscripcion(estado).clase;
  }

  protected nombreDePlan(codigo: string | undefined): string {
    if (!codigo) return 'sin plan';
    return this.planes().find((p) => p.code === codigo)?.name ?? codigo;
  }

  private listar(pagina: number): void {
    this.listado.set({ tipo: 'cargando' });
    this.pedidoDeListado?.unsubscribe();
    this.pedidoDeListado = this.plataforma
      .listPlatformOrganizations({
        ...this.filtroAplicado,
        sort: this.orden.sort(),
        page: pagina,
        size: this.porPagina(),
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

  protected leer(): void {
    const orgId = this.centro()?.id;
    if (orgId === undefined) return;
    this.estado.set({ tipo: 'cargando' });
    this.pedido?.unsubscribe();
    this.pedido = this.contratacionDeCentro
      .getContratacionDeCentroEnPlataforma({ orgId })
      .subscribe({
        next: (contratacion) => this.mostrar(contratacion),
        error: (error: unknown) =>
          this.estado.set({
            tipo: 'error',
            error: traducirErrorContratacion(error, 'contratacion'),
          }),
      });
  }

  private mostrar(contratacion: ContratacionResponse): void {
    this.estado.set({ tipo: 'listo', contratacion });
    this.planElegido.set(contratacion.planCode ?? '');
    this.serviciosElegidos.set([...(contratacion.servicios ?? [])]);
    this.iaElegida.set(tieneIa(contratacion.adicionales));
  }
}
