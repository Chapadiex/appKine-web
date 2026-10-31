import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';

import {
  EntradaDeListaDeEspera,
  EntradaDeListaDeEsperaEstadoEnum,
  EntradaDeListaDeEsperaPrioridadEnum,
} from '../../../../api/generated/model/entrada-de-lista-de-espera';
import { HorarioDisponible } from '../../../../api/generated/model/horario-disponible';
import { OfertaResponse } from '../../../../api/generated/model/oferta-response';
import { TurnoDelDia } from '../../../../api/generated/model/turno-del-dia';
import { PERMISO_TURNO_MANAGE } from '../../../../core/models/permisos';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { FlujoDeTurnosStore } from '../../../../core/services/flujo-de-turnos.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
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
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import { PieDeTabla } from '../../../../shared/components/tabla/pie-de-tabla';
import { tablaLocal } from '../../../../shared/components/tabla/tabla-local';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { ListaDeHorarios } from '../../flujo/lista-de-horarios';
import { CausaAgenda, ErrorAgenda, traducirErrorAgenda } from '../../models/agenda-errors';
import {
  fechaEnPalabras,
  horaEnZona,
  sumarDias,
  textoSinMotivoDeBusqueda,
} from '../../models/etiquetas-de-agenda';
import { DIAS_ABREVIADOS, nombreDePrioridad } from '../../models/etiquetas-de-turno';
import { ETIQUETA_PESTANAS_DE_AGENDA, pestanasDeAgenda } from '../../models/pestanas-de-agenda';
import { diaEnZona } from '../../models/semana';
import { MAXIMO_DIAS_DE_AGENDA } from '../../models/series';
import { SchedulingApi } from '../../services/scheduling-api';

/** Cuantos horarios se ofrecen de entrada al asignar: alcanza para elegir sin navegar una agenda. */
const HORARIOS_INICIALES = 12;

type FiltroDeEstado = 'ACTIVA' | 'ASIGNADA' | 'DESCARTADA';

const ESTADOS: readonly { readonly valor: FiltroDeEstado; readonly etiqueta: string }[] = [
  { valor: 'ACTIVA', etiqueta: 'Activas' },
  { valor: 'ASIGNADA', etiqueta: 'Asignadas' },
  { valor: 'DESCARTADA', etiqueta: 'Descartadas' },
];

/** El horario se ocupo mientras se elegia: la lista quedo vieja, la entrada sigue activa. */
const HORARIO_PERDIDO: ReadonlySet<CausaAgenda> = new Set<CausaAgenda>([
  'slot-no-disponible',
  'slot-completo',
  'recurso-ocupado',
]);

/** Otro puesto resolvio o toco la entrada: lo que hay que hacer es volver a leerla. */
const ENTRADA_VIEJA: ReadonlySet<CausaAgenda> = new Set<CausaAgenda>([
  'lista-de-espera-cerrada',
  'no-encontrado',
  'conflicto',
]);

/**
 * Quienes esperan lugar en esta sede (TURNO.md §20, TURNO - Tecnico §31 y §32).
 *
 * <p>Una entrada no es un turno sin fecha: no ocupa la agenda. <b>Asignar crea un turno comun</b>, con
 * las validaciones de cualquier reserva, y si falla la entrada sigue activa. Por eso los horarios que
 * se ofrecen salen del motor de disponibilidad con lo que a esa persona le sirve, y no se confia en
 * una coincidencia calculada antes.
 *
 * <h2>Lo que se libero</h2>
 *
 * <p>`?turno=` llega de una cancelacion: arriba de la lista van solo las entradas a las que les sirve
 * ese horario, que calcula el backend. La lista completa sigue debajo.
 *
 * <h2>Lista paginada por el servidor, sin `sort` ni `q`</h2>
 *
 * <p>El contrato no los tiene: el orden lo fija el backend, primero las mas urgentes y, a igual
 * prioridad, las mas viejas. Por eso esos encabezados no se ordenan: ordenar la pagina visible haria
 * creer que se ordeno todo. Las compatibles si llegan enteras, y esas si (UX-14 §1).
 *
 * <p>Tocar un turno desde el flujo o cambiar de sede relee en su lugar: no se vacia la tabla ni se
 * pierden los filtros, salvo que la sede sea otra, porque entonces lo filtrado ya no es de aca.
 */
@Component({
  selector: 'app-lista-de-espera-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AccionesDeFila,
    Alerta,
    Ayuda,
    CabeceraDePagina,
    ColumnaOrdenable,
    ConfirmacionConMotivo,
    EstadoVacio,
    Filtros,
    Icono,
    ListaDeHorarios,
    NgTemplateOutlet,
    Paginacion,
    PanelLateral,
    PermisoDirective,
    Pestanas,
    PieDeTabla,
    RouterLink,
  ],
  templateUrl: './lista-de-espera-page.html',
  styleUrls: ['../../agenda.css', '../../flujo/flujo.css'],
})
export class ListaDeEsperaPage {
  private readonly api = inject(SchedulingApi);
  private readonly tenant = inject(TenantContextStore);
  private readonly dia = inject(DiaDeLaSede);
  private readonly avisos = inject(AvisosStore);
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);
  protected readonly flujo = inject(FlujoDeTurnosStore);

  /** De la query: el turno que se cancelo. El `transform` cubre el parametro ausente. */
  readonly turno = input('', { transform: (valor: string | undefined) => valor ?? '' });

  /** La ruta exige `turno:read`: todas las pestanas de la agenda estan disponibles. */
  protected readonly pestanas = pestanasDeAgenda(true);
  protected readonly etiquetaDePestanas = ETIQUETA_PESTANAS_DE_AGENDA;
  protected readonly PERMISO_TURNO_MANAGE = PERMISO_TURNO_MANAGE;
  protected readonly ESTADOS = ESTADOS;
  protected readonly Estado = EntradaDeListaDeEsperaEstadoEnum;
  protected readonly Prioridad = EntradaDeListaDeEsperaPrioridadEnum;
  protected readonly nombreDePrioridad = nombreDePrioridad;
  protected readonly fechaEnPalabras = fechaEnPalabras;

  // Lista
  protected readonly filtroEstado = signal<FiltroDeEstado>('ACTIVA');
  protected readonly ofertaId = signal<number | null>(null);
  protected readonly ofertas = signal<readonly OfertaResponse[]>([]);
  protected readonly pagina = signal(0);
  protected readonly porPagina = signal<number>(FILAS_POR_PAGINA_INICIAL);
  protected readonly resultado = signal<{
    readonly entradas: readonly EntradaDeListaDeEspera[];
    readonly total: number;
  } | null>(null);
  protected readonly cargando = signal(false);
  protected readonly error = signal<ErrorAgenda | null>(null);

  // Compatibles con el horario que se libero
  protected readonly coincidencias = signal<readonly EntradaDeListaDeEspera[]>([]);
  protected readonly leyendoCoincidencias = signal(false);
  protected readonly errorDeCoincidencias = signal<ErrorAgenda | null>(null);
  private readonly turnoQueSeLibero = signal<TurnoDelDia | null>(null);

  // Asignar
  protected readonly aAsignar = signal<EntradaDeListaDeEspera | null>(null);
  protected readonly horarios = signal<readonly HorarioDisponible[]>([]);
  protected readonly timezone = signal('');
  protected readonly truncado = signal(false);
  protected readonly motivosSinHorario = signal<readonly string[]>([]);
  protected readonly buscando = signal(false);
  protected readonly errorDeHorarios = signal<ErrorAgenda | null>(null);
  protected readonly limite = signal(HORARIOS_INICIALES);
  /** Ya paso el ultimo dia que le servia: no hay nada que buscar. */
  protected readonly vencida = signal(false);
  /** Hasta donde se miro, si lo que le sirve es mas largo que la ventana de busqueda. */
  protected readonly miradoHasta = signal('');
  protected readonly elegido = signal<HorarioDisponible | null>(null);

  // Descartar
  protected readonly aDescartar = signal<EntradaDeListaDeEspera | null>(null);

  protected readonly enviando = signal(false);
  protected readonly rechazo = signal<ErrorAgenda | null>(null);

  private epochLeido: number | null = null;
  /** Con dos lecturas en vuelo no gana la ultima en llegar sino la ultima pedida. */
  private ultimoPedido = 0;
  private ultimoPedidoDeCoincidencias = 0;
  private ultimoPedidoDeHorarios = 0;

  protected readonly entradas = computed(() => this.resultado()?.entradas ?? []);
  protected readonly total = computed(() => this.resultado()?.total ?? 0);
  protected readonly totalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.porPagina())),
  );

  protected readonly hayFiltros = computed(
    () => this.filtroEstado() !== 'ACTIVA' || this.ofertaId() !== null,
  );

  protected readonly turnoLiberado = computed(() => {
    const id = Number(this.turno());
    return Number.isInteger(id) && id > 0 ? id : null;
  });

  /** "viernes 31 de octubre · 16:00 · Kinesiología": de que horario se esta hablando. */
  protected readonly horarioLiberado = computed(() => {
    const turno = this.turnoQueSeLibero();
    if (turno?.inicio === undefined) {
      return '';
    }
    const zona = this.dia.zona();
    return [
      fechaEnPalabras(diaEnZona(turno.inicio, zona)),
      horaEnZona(turno.inicio, zona),
      turno.ofertaNombre,
    ]
      .filter(Boolean)
      .join(' · ');
  });

  protected readonly tablaDeCoincidencias = tablaLocal(this.coincidencias, {
    columnas: {
      paciente: (entrada) => entrada.personaNombre,
      prestacion: (entrada) => entrada.ofertaNombre,
      prioridad: (entrada) => ordenDePrioridad(entrada.prioridad),
      antiguedad: (entrada) => (entrada.creadaEn ? new Date(entrada.creadaEn) : null),
    },
  });

  protected readonly conflictoDeLugar = computed(() => {
    const causa = this.rechazo()?.causa;
    return causa !== undefined && HORARIO_PERDIDO.has(causa);
  });

  constructor() {
    effect(() => {
      const epoch = this.tenant.contextEpoch();
      this.flujo.cambios();
      this.turnoLiberado();
      untracked(() => {
        if (epoch !== this.epochLeido) {
          this.epochLeido = epoch;
          this.empezarDeCero();
        }
        this.leer();
        this.leerCoincidencias();
      });
    });
  }

  // -------------------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------------------

  /** Otra sede: lo leido, lo filtrado y lo abierto no son de aca. */
  private empezarDeCero(): void {
    this.filtroEstado.set('ACTIVA');
    this.ofertaId.set(null);
    this.pagina.set(0);
    this.resultado.set(null);
    this.ofertas.set([]);
    this.cerrarPaneles();

    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null) {
      return;
    }
    const epoch = this.tenant.contextEpoch();
    this.api.ofertasAgendables(consultorioId).subscribe({
      next: (ofertas) => {
        if (epoch === this.tenant.contextEpoch()) {
          this.ofertas.set(ofertas);
        }
      },
      // El filtro es opcional: sin ofertas la lista se lee igual.
      error: () => this.ofertas.set([]),
    });
  }

  protected leer(): void {
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null) {
      return;
    }
    const pedido = ++this.ultimoPedido;
    this.cargando.set(true);
    this.error.set(null);
    this.api
      .listarEspera(consultorioId, {
        estado: this.filtroEstado(),
        ofertaId: this.ofertaId() ?? undefined,
        page: this.pagina(),
        size: this.porPagina(),
      })
      .subscribe({
        next: (respuesta) => {
          if (pedido !== this.ultimoPedido) {
            return;
          }
          const total = respuesta.totalElements ?? 0;
          const entradas = respuesta.content ?? [];
          // Se resolvio la ultima fila de la ultima pagina: esa pagina ya no existe.
          const ultima = Math.max(0, Math.ceil(total / this.porPagina()) - 1);
          if (this.pagina() > ultima) {
            this.pagina.set(ultima);
            if (total > 0) {
              this.leer();
              return;
            }
          }
          this.cargando.set(false);
          this.resultado.set({ entradas, total });
        },
        error: (error: unknown) => {
          if (pedido === this.ultimoPedido) {
            this.cargando.set(false);
            this.resultado.set(null);
            this.error.set(traducirErrorAgenda(error));
          }
        },
      });
  }

  protected leerCoincidencias(): void {
    const consultorioId = this.tenant.consultorioId();
    const turnoId = this.turnoLiberado();
    const pedido = ++this.ultimoPedidoDeCoincidencias;
    this.errorDeCoincidencias.set(null);
    if (consultorioId === null || turnoId === null) {
      this.coincidencias.set([]);
      this.turnoQueSeLibero.set(null);
      this.leyendoCoincidencias.set(false);
      return;
    }
    this.leyendoCoincidencias.set(true);
    forkJoin({
      entradas: this.api.coincidenciasEnEspera(consultorioId, { turnoId }),
      // Solo rotula el horario: si no se puede leer, la lista de compatibles sirve igual.
      turno: this.api.verTurno(consultorioId, turnoId).pipe(catchError(() => of(null))),
    }).subscribe({
      next: ({ entradas, turno }) => {
        if (pedido === this.ultimoPedidoDeCoincidencias) {
          this.leyendoCoincidencias.set(false);
          this.coincidencias.set(entradas);
          this.turnoQueSeLibero.set(turno);
        }
      },
      error: (error: unknown) => {
        if (pedido === this.ultimoPedidoDeCoincidencias) {
          this.leyendoCoincidencias.set(false);
          this.coincidencias.set([]);
          this.errorDeCoincidencias.set(traducirErrorAgenda(error));
        }
      },
    });
  }

  /** Saca `?turno=` de la URL: el `input` cambia y el efecto relee. */
  protected dejarDeMostrarCompatibles(): void {
    this.router
      .navigate([], {
        relativeTo: this.ruta,
        queryParams: { turno: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      })
      .catch(() => undefined);
  }

  // -------------------------------------------------------------------------------------
  // Filtros y paginas
  // -------------------------------------------------------------------------------------

  protected cambiarEstado(valor: string): void {
    this.filtroEstado.set(ESTADOS.find((estado) => estado.valor === valor)?.valor ?? 'ACTIVA');
    this.recargarDesdeElPrincipio();
  }

  protected cambiarOferta(valor: string): void {
    const id = Number(valor);
    this.ofertaId.set(valor !== '' && Number.isFinite(id) ? id : null);
    this.recargarDesdeElPrincipio();
  }

  protected limpiarFiltros(): void {
    this.filtroEstado.set('ACTIVA');
    this.ofertaId.set(null);
    this.recargarDesdeElPrincipio();
  }

  protected irAPagina(numero: number): void {
    this.pagina.set(numero);
    this.leer();
  }

  protected cambiarPorPagina(cantidad: number): void {
    this.porPagina.set(cantidad);
    this.recargarDesdeElPrincipio();
  }

  private recargarDesdeElPrincipio(): void {
    this.pagina.set(0);
    this.leer();
  }

  protected agregar(): void {
    this.flujo.listaDeEspera({ origen: 'LISTA_DE_ESPERA' });
  }

  // -------------------------------------------------------------------------------------
  // Asignar
  // -------------------------------------------------------------------------------------

  protected abrirAsignacion(entrada: EntradaDeListaDeEspera): void {
    this.aDescartar.set(null);
    this.aAsignar.set(entrada);
    this.rechazo.set(null);
    this.elegido.set(null);
    this.limite.set(HORARIOS_INICIALES);
    this.timezone.set(this.dia.zona());
    this.leerHorarios();
  }

  /** Los proximos horarios que le sirven de verdad: el motor de disponibilidad, no una suposicion. */
  protected leerHorarios(): void {
    const consultorioId = this.tenant.consultorioId();
    const entrada = this.aAsignar();
    if (consultorioId === null || entrada?.ofertaId === undefined) {
      return;
    }
    const pedido = ++this.ultimoPedidoDeHorarios;
    this.horarios.set([]);
    this.truncado.set(false);
    this.motivosSinHorario.set([]);
    this.errorDeHorarios.set(null);
    this.miradoHasta.set('');

    const ventana = this.ventanaDe(entrada);
    this.vencida.set(ventana === null);
    if (ventana === null) {
      this.buscando.set(false);
      return;
    }
    this.buscando.set(true);
    this.api
      .buscarHorarios(consultorioId, {
        ofertaId: entrada.ofertaId,
        profesionalId: entrada.profesionalId,
        desde: ventana.desde,
        hasta: ventana.hasta,
        horaDesde: entrada.horaDesde,
        horaHasta: entrada.horaHasta,
        dias: (entrada.dias ?? []).length > 0 ? entrada.dias : undefined,
        limite: this.limite(),
      })
      .subscribe({
        next: (respuesta) => {
          if (pedido !== this.ultimoPedidoDeHorarios) {
            return;
          }
          this.buscando.set(false);
          this.timezone.set(respuesta.timezone ?? this.timezone());
          this.horarios.set(respuesta.horarios ?? []);
          this.truncado.set(respuesta.truncado === true);
          this.motivosSinHorario.set(respuesta.motivosSinHorario ?? []);
          this.miradoHasta.set(ventana.recortada ? sumarDias(ventana.hasta, -1) : '');
        },
        error: (error: unknown) => {
          if (pedido === this.ultimoPedidoDeHorarios) {
            this.buscando.set(false);
            this.errorDeHorarios.set(traducirErrorAgenda(error));
          }
        },
      });
  }

  /**
   * Desde hoy o desde que le sirva, hasta su ultimo dia: `fechaHasta` es inclusiva y el `hasta` de la
   * busqueda exclusivo. El motor mira a lo sumo 62 dias. `null` si ya no queda ningun dia.
   */
  private ventanaDe(
    entrada: EntradaDeListaDeEspera,
  ): { readonly desde: string; readonly hasta: string; readonly recortada: boolean } | null {
    const hoy = this.dia.hoy();
    const desde =
      entrada.fechaDesde !== undefined && entrada.fechaDesde > hoy ? entrada.fechaDesde : hoy;
    const tope = sumarDias(desde, MAXIMO_DIAS_DE_AGENDA);
    const fin = entrada.fechaHasta === undefined ? tope : sumarDias(entrada.fechaHasta, 1);
    if (fin <= desde) {
      return null;
    }
    return fin > tope
      ? { desde, hasta: tope, recortada: true }
      : { desde, hasta: fin, recortada: false };
  }

  protected verMasHorarios(): void {
    this.limite.update((actual) => actual + HORARIOS_INICIALES);
    this.leerHorarios();
  }

  protected motivoSinHorarios(): string {
    return textoSinMotivoDeBusqueda(this.motivosSinHorario());
  }

  protected asignar(horario: HorarioDisponible): void {
    const consultorioId = this.tenant.consultorioId();
    const entrada = this.aAsignar();
    if (
      consultorioId === null ||
      entrada?.id === undefined ||
      entrada.version === undefined ||
      horario.desde === undefined ||
      this.enviando()
    ) {
      return;
    }
    const zona = this.timezone();
    const rotulo = `${fechaEnPalabras(diaEnZona(horario.desde, zona))} · ${horaEnZona(horario.desde, zona)}`;
    this.enviando.set(true);
    this.rechazo.set(null);
    this.elegido.set(horario);
    this.api
      .asignarDesdeEspera(consultorioId, entrada.id, {
        inicio: horario.desde,
        profesionalId: horario.profesionalId ?? entrada.profesionalId,
        expectedVersion: entrada.version,
      })
      .subscribe({
        next: (asignada) => {
          this.enviando.set(false);
          const turnoId = asignada.turnoId;
          this.avisos.exito('Turno asignado.', {
            descripcion: `${entrada.personaNombre ?? ''} · ${rotulo}`,
            accion:
              turnoId === undefined
                ? undefined
                : { etiqueta: 'Ver turno', ejecutar: () => this.flujo.verTurno(turnoId) },
          });
          this.cerrarPaneles();
          // Lo escucha esta misma pantalla y cualquier otra que muestre turnos: cada una relee.
          this.flujo.notificarCambio();
        },
        error: (error: unknown) => {
          this.enviando.set(false);
          this.elegido.set(null);
          const fallo = traducirErrorAgenda(error);
          if (ENTRADA_VIEJA.has(fallo.causa)) {
            this.soltarEntrada(fallo);
            return;
          }
          this.rechazo.set(fallo);
          if (HORARIO_PERDIDO.has(fallo.causa)) {
            this.leerHorarios();
          }
        },
      });
  }

  // -------------------------------------------------------------------------------------
  // Descartar
  // -------------------------------------------------------------------------------------

  protected abrirDescarte(entrada: EntradaDeListaDeEspera): void {
    this.aAsignar.set(null);
    this.aDescartar.set(entrada);
    this.rechazo.set(null);
  }

  protected descartar(motivo: string): void {
    const consultorioId = this.tenant.consultorioId();
    const entrada = this.aDescartar();
    if (
      consultorioId === null ||
      entrada?.id === undefined ||
      entrada.version === undefined ||
      this.enviando()
    ) {
      return;
    }
    this.enviando.set(true);
    this.rechazo.set(null);
    this.api
      .descartarDeEspera(consultorioId, entrada.id, {
        motivo: motivo === '' ? undefined : motivo,
        expectedVersion: entrada.version,
      })
      .subscribe({
        next: () => {
          this.enviando.set(false);
          this.avisos.exito('Paciente descartado de la lista de espera.');
          this.cerrarPaneles();
          this.leer();
          this.leerCoincidencias();
        },
        error: (error: unknown) => {
          this.enviando.set(false);
          const fallo = traducirErrorAgenda(error);
          if (ENTRADA_VIEJA.has(fallo.causa)) {
            this.soltarEntrada(fallo);
          } else {
            this.rechazo.set(fallo);
          }
        },
      });
  }

  /** La entrada cambio en otro puesto: reintentar con esta version vieja daria el mismo 409. */
  private soltarEntrada(fallo: ErrorAgenda): void {
    this.cerrarPaneles();
    this.avisos.advertencia(fallo.mensaje);
    this.leer();
    this.leerCoincidencias();
  }

  protected cerrarPaneles(): void {
    this.aAsignar.set(null);
    this.aDescartar.set(null);
    this.rechazo.set(null);
    this.elegido.set(null);
    this.ultimoPedidoDeHorarios++;
    this.buscando.set(false);
  }

  // -------------------------------------------------------------------------------------
  // Celdas
  // -------------------------------------------------------------------------------------

  protected enlaceDeTelefono(telefono: string): string {
    return `tel:${telefono.replace(/[^\d+]/g, '')}`;
  }

  /** "31/10 al 14/11". El ultimo dia es inclusivo, como lo cargo quien lo anoto. */
  protected fechasQueLeSirven(entrada: EntradaDeListaDeEspera): string {
    return `${fechaCorta(entrada.fechaDesde)} al ${fechaCorta(entrada.fechaHasta)}`;
  }

  /** "Lun, Mié · 14:00 a 18:00". Sin dias ni franja, le sirve cualquiera: se dice. */
  protected diasYFranja(entrada: EntradaDeListaDeEspera): string {
    const dias = DIAS_ABREVIADOS.filter((dia) => (entrada.dias ?? []).includes(dia.iso)).map(
      (dia) => dia.etiqueta,
    );
    const textoDeDias = dias.length === 0 ? 'Cualquier día' : dias.join(', ');
    const franja = entrada.horaDesde
      ? `${entrada.horaDesde.slice(0, 5)} a ${entrada.horaHasta?.slice(0, 5) ?? ''}`
      : 'cualquier horario';
    return `${textoDeDias} · ${franja}`;
  }

  protected queLeSirve(entrada: EntradaDeListaDeEspera): string {
    return `${this.fechasQueLeSirven(entrada)} · ${this.diasYFranja(entrada)}`;
  }

  /** En dias de calendario de la sede: a quien recibe el llamado no le importan las horas. */
  protected antiguedad(creadaEn: string | undefined): string {
    const creada = diaEnZona(creadaEn, this.dia.zona());
    if (creada === '') {
      return '';
    }
    const dias = Math.round(
      (Date.parse(`${this.dia.hoy()}T00:00:00Z`) - Date.parse(`${creada}T00:00:00Z`)) / 86_400_000,
    );
    if (dias <= 0) {
      return 'Hoy';
    }
    return dias === 1 ? 'Ayer' : `Hace ${dias} días`;
  }
}

function fechaCorta(fecha: string | undefined): string {
  return fecha === undefined ? '' : `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
}

/** Ordenar por el nombre pondria "Alta" antes que "Normal" y "Urgente" al final. */
function ordenDePrioridad(prioridad: EntradaDeListaDeEsperaPrioridadEnum | undefined): number {
  switch (prioridad) {
    case EntradaDeListaDeEsperaPrioridadEnum.URGENTE:
      return 0;
    case EntradaDeListaDeEsperaPrioridadEnum.ALTA:
      return 1;
    default:
      return 2;
  }
}
