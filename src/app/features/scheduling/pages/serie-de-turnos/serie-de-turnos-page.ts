import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';

import { Agenda } from '../../../../api/generated/model/agenda';
import { AlcanceDeSerie } from '../../../../api/generated/model/alcance-de-serie';
import { CancelarSerieDeTurnosAlcanceEnum } from '../../../../api/generated/model/cancelar-serie-de-turnos';
import { SerieDeTurnos } from '../../../../api/generated/model/serie-de-turnos';
import { Turno, TurnoEstadoEnum } from '../../../../api/generated/model/turno';
import { PERMISO_TURNO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { SlotDisponible } from '../../../../api/generated/model/slot-disponible';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { SelectorDeHorario } from '../../components/selector-de-horario/selector-de-horario';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import { PieDeTabla } from '../../../../shared/components/tabla/pie-de-tabla';
import { tablaLocal } from '../../../../shared/components/tabla/tabla-local';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { fechaEnPalabras, sumarDias } from '../../models/etiquetas-de-agenda';
import {
  detalleDeEstado,
  fechaHoraEnZona,
  nombreDeEstado,
  textoDeEstado,
} from '../../models/etiquetas-de-turno';
import { ErrorSerie, OperacionDeSerie, traducirErrorSerie } from '../../models/series-errors';
import {
  fechaEnZona,
  horarioDesplazado,
  textoDeAlcance,
  textoDeDias,
  textoDeOcurrenciaOmitida,
  textoDeOmitido,
} from '../../models/series';
import { SchedulingApi } from '../../services/scheduling-api';
import { AlcanceSerie, SeriesApi } from '../../services/series-api';
import { AccionesDeFila } from '../../../../shared/components/acciones-de-fila/acciones-de-fila';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

import { Alerta } from '../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { FlujoDeTurnosStore } from '../../../../core/services/flujo-de-turnos.store';

/** Estados en los que un turno todavia se puede cancelar. El resto lo omite el backend. */
const PENDIENTES: ReadonlySet<string> = new Set<string>([
  TurnoEstadoEnum.RESERVADO,
  TurnoEstadoEnum.CONFIRMADO,
]);

/**
 * La operacion abierta. Cancelar y reprogramar comparten la previsualizacion y la confirmacion
 * de la cantidad; reprogramar agrega el pivote, cuyo horario nuevo se elige en la agenda.
 */
type Pedido =
  | {
      readonly operacion: 'cancelar';
      readonly alcance: AlcanceSerie;
      readonly turnoId?: number;
    }
  | {
      readonly operacion: 'reprogramar';
      readonly alcance: AlcanceSerie;
      readonly turnoId: number;
      readonly pivote: Turno;
    };

/**
 * Una serie de turnos y la cancelacion con alcance (M12, AKINE E-3, DP-04).
 *
 * <p>Muestra la regla con la que se genero la serie y sus turnos <b>tal como estan hoy</b>. La
 * regla no se reescribe cuando un turno se mueve: describe como se genero, y los turnos son la
 * verdad.
 *
 * <h2>Cancelar es previsualizar, mirar y confirmar una cantidad</h2>
 *
 * <p>Es lo que DP-04 pide y lo que el contrato exige: la cancelacion lleva
 * `cantidadConfirmada`, que es la cantidad de afectados que <b>se le mostro</b> al operador. El
 * flujo no deja saltear la previsualizacion porque no hay de donde sacar esa cantidad sin ella.
 * Los omitidos se muestran con su motivo: un turno en espera o con atencion no se cancela en lote,
 * y el operador tiene que saber por que quedo.
 *
 * <p>Si entre la previsualizacion y el click otro operador toco un turno del alcance, el backend
 * responde 409 y no cancela nada; la pantalla ofrece volver a previsualizar.
 *
 * <h2>Reprogramar es lo mismo, mas el horario nuevo del pivote</h2>
 *
 * <p>Se parte de un turno —el pivote— y se elige su horario nuevo en la agenda de la oferta, con el
 * selector de horario. El backend calcula el desplazamiento en hora local y lo aplica igual a todos
 * los afectados; la pantalla muestra donde quedaria cada uno como estimacion. Los afectados y omitidos son los mismos que en la cancelacion, y la confirmacion
 * tambien: `cantidadConfirmada`, y si cambio, 409 y volver a previsualizar.
 *
 * <p>Por omision cada turno <b>conserva su profesional</b> (appKine-api #66): la agenda se pide
 * filtrada por el del pivote y `profesionalId` no viaja. Pasar la serie a otro profesional es una
 * decision explicita: se marca, la agenda se pide sin filtro y viaja el del horario elegido.
 *
 * <h2>Un turno de la serie se ve y se opera en el panel del flujo unico</h2>
 *
 * <p>Se abre sobre esta pantalla, y lo que el panel cambia se relee sin vaciar la tabla ni perder la
 * pagina (TURNO - Tecnico §87 y §88).
 */
@Component({
  selector: 'app-serie-de-turnos-page',
  imports: [
    CabeceraDePagina,
    ColumnaOrdenable,
    EstadoVacio,
    PieDeTabla,
    Alerta,
    Ayuda,
    RouterLink,
    NgTemplateOutlet,
    ConfirmacionConMotivo,
    SelectorDeHorario,
    AccionesDeFila,
    PanelLateral,
  ],
  templateUrl: './serie-de-turnos-page.html',
  styleUrl: '../../agenda.css',
})
export class SerieDeTurnosPage {
  private readonly api = inject(SeriesApi);
  private readonly avisos = inject(AvisosStore);
  private readonly agenda = inject(SchedulingApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);
  protected readonly flujo = inject(FlujoDeTurnosStore);

  /** De la ruta. */
  readonly serieId = input.required<string>();

  protected readonly Alcance = CancelarSerieDeTurnosAlcanceEnum;
  protected readonly alcancesDeReprogramacion: readonly AlcanceSerie[] = [
    CancelarSerieDeTurnosAlcanceEnum.ESTE,
    CancelarSerieDeTurnosAlcanceEnum.ESTE_Y_SIGUIENTES,
    CancelarSerieDeTurnosAlcanceEnum.TODA_LA_SERIE,
  ];
  protected readonly fechaEnPalabras = fechaEnPalabras;
  protected readonly textoDeEstado = textoDeEstado;
  protected readonly nombreDeEstado = nombreDeEstado;
  protected readonly detalleDeEstado = detalleDeEstado;
  protected readonly textoDeAlcance = textoDeAlcance;
  protected readonly textoDeDias = textoDeDias;
  protected readonly textoDeOmitido = textoDeOmitido;
  protected readonly textoDeOcurrenciaOmitida = textoDeOcurrenciaOmitida;

  protected readonly serie = signal<SerieDeTurnos | null>(null);

  /**
   * Los turnos con su numero DENTRO de la serie (el orden en que los devuelve el servidor, del mas
   * temprano al mas tarde): ordenar la tabla por estado no les cambia el numero.
   */
  private readonly turnosNumerados = computed(() =>
    (this.serie()?.turnos ?? []).map((turno, indice) => ({ turno, numero: indice + 1 })),
  );

  /** Orden y pie estandar de la tabla de turnos (UX-14 §1): la serie llega entera. */
  protected readonly tabla = tablaLocal(this.turnosNumerados, {
    columnas: {
      numero: (fila) => fila.numero,
      fecha: (fila) => (fila.turno.inicio ? new Date(fila.turno.inicio) : null),
      estado: (fila) => nombreDeEstado(fila.turno.estado),
    },
  });
  protected readonly cargando = signal(false);
  /** Error al LEER la serie: va en el lugar del contenido, con Reintentar (UX-12). */
  protected readonly errorDeCarga = signal<ErrorSerie | null>(null);

  /**
   * Rechazo de la previsualizacion o de la operacion del panel abierto: arriba del panel. Lo que
   * sale bien es un aviso global.
   */
  protected readonly error = signal<ErrorSerie | null>(null);
  protected readonly tituloDelError = signal('');

  /** Un rechazo que pide releer o elegir otro horario es un conflicto, no una falla. */
  protected readonly esConflicto = computed(() => {
    const accion = this.error()?.accion;
    return accion === 'releer-alcance' || accion === 'revisar-ocurrencias';
  });

  protected readonly pedido = signal<Pedido | null>(null);
  protected readonly alcance = signal<AlcanceDeSerie | null>(null);
  protected readonly previsualizando = signal(false);
  protected readonly enviando = signal(false);

  /** Horario nuevo del pivote, en la reprogramacion. */
  protected readonly agendaDestino = signal<Agenda | null>(null);
  protected readonly fechaDestino = signal('');
  protected readonly instanteDestino = signal('');
  protected readonly faltaHorario = signal(false);
  protected readonly cambiarProfesional = signal(false);
  protected readonly slotsDestino = computed<readonly SlotDisponible[]>(
    () => this.agendaDestino()?.dias?.[0]?.slots ?? [],
  );

  protected readonly timezone = computed(() => this.serie()?.timezone ?? '');
  protected readonly puedeOperar = computed(() => this.permisos.tiene(PERMISO_TURNO_MANAGE));
  protected readonly afectados = computed(() => this.alcance()?.afectados ?? []);
  protected readonly reprogramacion = computed(() => {
    const pedido = this.pedido();
    return pedido?.operacion === 'reprogramar' ? pedido : null;
  });

  /** El primer turno pendiente: el pivote de "reprogramar toda la serie". */
  protected readonly primerPendiente = computed(
    () => (this.serie()?.turnos ?? []).find((turno) => this.esPendiente(turno)) ?? null,
  );

  /**
   * La fila de "Avance" del canvas, contada sobre los turnos que la serie ya trae. No hay dato
   * nuevo: son los mismos estados de la tabla de abajo, agrupados.
   */
  protected readonly avance = computed(() => {
    const turnos = this.serie()?.turnos ?? [];
    const contar = (estado: string) => turnos.filter((t) => t.estado === estado).length;
    const ultimo = turnos.length > 0 ? turnos[turnos.length - 1] : null;
    return {
      total: turnos.length,
      pendientes: turnos.filter((t) => this.esPendiente(t)).length,
      cancelados: contar('CANCELADO'),
      ausentes: contar('AUSENTE'),
      ultimo: ultimo ? this.fechaHora(ultimo.inicio) : '',
    };
  });

  constructor() {
    effect(() => {
      this.serieId();
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.cerrar();
        this.cargar();
      });
    });

    // El panel del turno se abre sobre esta pantalla: lo que cambia tiene que verse en la tabla.
    let primera = true;
    effect(() => {
      this.flujo.cambios();
      if (primera) {
        primera = false;
        return;
      }
      untracked(() => this.releerEnElLugar());
    });
  }

  /**
   * Relee la serie sin que se note: quien mira conserva la pagina y el orden, y no aparece el cartel
   * de carga. Si falla, lo que hay en pantalla sigue ahi y el aviso ofrece volver a leer.
   */
  private releerEnElLugar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const serieId = this.numeroDeSerie();
    if (consultorioId === null || serieId === null) {
      return;
    }
    this.api.ver(consultorioId, serieId).subscribe({
      next: (serie) => this.tabla.conservandoPagina(() => this.serie.set(serie)),
      error: (error: unknown) =>
        this.avisos.error('No pudimos actualizar la serie', {
          descripcion: traducirErrorSerie(error).mensaje,
          accion: { etiqueta: 'Volver a leer', ejecutar: () => this.cargar() },
        }),
    });
  }

  protected cargar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const serieId = this.numeroDeSerie();
    if (consultorioId === null || serieId === null) {
      return;
    }
    this.cargando.set(true);
    this.errorDeCarga.set(null);
    this.api.ver(consultorioId, serieId).subscribe({
      next: (serie) => {
        this.cargando.set(false);
        this.serie.set(serie);
      },
      error: (error: unknown) => {
        this.cargando.set(false);
        this.errorDeCarga.set(traducirErrorSerie(error));
      },
    });
  }

  protected esPendiente(turno: Turno): boolean {
    return PENDIENTES.has(turno.estado ?? '');
  }

  protected fechaHora(instante: string | undefined): string {
    return fechaHoraEnZona(instante, this.timezone());
  }

  /** Fecha local del turno: el dia en que arranca el selector de horario al moverlo. */
  protected fechaLocal(turno: Turno): string {
    return fechaEnZona(turno.inicio, this.timezone());
  }

  /** Abre la cancelacion de un alcance y pide su previsualizacion. */
  protected elegir(alcance: AlcanceSerie, turnoId?: number): void {
    this.pedido.set({ operacion: 'cancelar', alcance, turnoId });
    this.previsualizar();
  }

  protected previsualizar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const serieId = this.numeroDeSerie();
    const pedido = this.pedido();
    if (consultorioId === null || serieId === null || pedido === null) {
      return;
    }
    this.alcance.set(null);
    this.error.set(null);
    this.previsualizando.set(true);
    this.api.previsualizar(consultorioId, serieId, pedido.alcance, pedido.turnoId).subscribe({
      next: (alcance) => {
        this.previsualizando.set(false);
        this.alcance.set(alcance);
      },
      error: (error: unknown) => {
        this.previsualizando.set(false);
        this.tituloDelError.set('No pudimos calcular qué turnos entran');
        this.error.set(traducirErrorSerie(error, this.timezone(), pedido.operacion));
      },
    });
  }

  protected cancelar(motivo: string): void {
    const consultorioId = this.tenantContext.consultorioId();
    const serieId = this.numeroDeSerie();
    const pedido = this.pedido();
    if (consultorioId === null || serieId === null || pedido === null) {
      return;
    }
    this.enviando.set(true);
    this.error.set(null);
    this.api
      .cancelar(consultorioId, serieId, {
        alcance: pedido.alcance,
        turnoId: pedido.turnoId,
        motivo,
        cantidadConfirmada: this.afectados().length,
      })
      .subscribe({
        next: (resultado) => this.hecho('cancelar', resultado),
        error: (error: unknown) => this.fallo(error, 'cancelar'),
      });
  }

  // -------------------------------------------------------------------------------------
  // Reprogramar
  // -------------------------------------------------------------------------------------

  /**
   * Abre la reprogramacion desde un turno pivote. El dia destino arranca en el del pivote, que es
   * lo mas comun: mover la hora dentro del mismo dia.
   */
  protected reprogramarDesde(
    pivote: Turno,
    alcance: AlcanceSerie = CancelarSerieDeTurnosAlcanceEnum.ESTE,
  ): void {
    if (pivote.id === undefined) {
      return;
    }
    this.pedido.set({ operacion: 'reprogramar', alcance, turnoId: pivote.id, pivote });
    this.cambiarProfesional.set(false);
    this.instanteDestino.set('');
    this.faltaHorario.set(false);
    this.fechaDestino.set(this.fechaLocal(pivote));
    this.cargarDestino();
    this.previsualizar();
  }

  /** Cambiar el alcance cambia los afectados: la previsualizacion anterior ya no vale. */
  protected cambiarAlcance(alcance: AlcanceSerie): void {
    const pedido = this.reprogramacion();
    if (pedido === null || pedido.alcance === alcance) {
      return;
    }
    this.pedido.set({ ...pedido, alcance });
    this.previsualizar();
  }

  protected cambiarDiaDestino(fecha: string): void {
    this.fechaDestino.set(fecha);
    this.instanteDestino.set('');
    this.cargarDestino();
  }

  protected elegirDestino(slot: SlotDisponible): void {
    this.instanteDestino.set(slot.desde ?? '');
    this.faltaHorario.set(false);
  }

  protected alternarProfesional(marcado: boolean): void {
    this.cambiarProfesional.set(marcado);
    this.instanteDestino.set('');
    this.cargarDestino();
  }

  /** Donde quedaria un afectado con el horario elegido. Vacio hasta que se elige uno. */
  protected destinoEstimado(turno: Turno): string {
    const pedido = this.reprogramacion();
    if (pedido === null || this.instanteDestino() === '') {
      return '';
    }
    return horarioDesplazado(
      turno.inicio,
      pedido.pivote.inicio,
      this.instanteDestino(),
      this.timezone(),
    );
  }

  protected reprogramar(motivo: string): void {
    const consultorioId = this.tenantContext.consultorioId();
    const serieId = this.numeroDeSerie();
    const pedido = this.reprogramacion();
    const inicio = this.instanteDestino();
    if (inicio === '') {
      // Sin horario no hay pedido que mandar, y el motivo escrito no se pierde.
      this.faltaHorario.set(true);
      return;
    }
    if (consultorioId === null || serieId === null || pedido === null || this.alcance() === null) {
      return;
    }
    const profesionalId = this.cambiarProfesional()
      ? this.slotsDestino().find((slot) => slot.desde === inicio)?.profesionalId
      : undefined;
    this.enviando.set(true);
    this.error.set(null);
    this.api
      .reprogramar(consultorioId, serieId, {
        alcance: pedido.alcance,
        turnoId: pedido.turnoId,
        inicio,
        profesionalId,
        motivo,
        cantidadConfirmada: this.afectados().length,
      })
      .subscribe({
        next: (resultado) => this.hecho('reprogramar', resultado),
        error: (error: unknown) => this.fallo(error, 'reprogramar'),
      });
  }

  /**
   * Agenda del dia destino. Filtrada por el profesional del pivote salvo que se quiera pasar la
   * serie a otro: sin filtro, el selector ofreceria horarios que el backend rechazaria al
   * conservar el profesional de cada turno.
   */
  private cargarDestino(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const ofertaId = this.serie()?.ofertaId;
    const pedido = this.reprogramacion();
    const desde = this.fechaDestino();
    this.agendaDestino.set(null);
    if (consultorioId === null || ofertaId === undefined || pedido === null || desde === '') {
      return;
    }
    const profesionalId = this.cambiarProfesional() ? undefined : pedido.pivote.profesionalId;
    this.agenda
      .buscarAgenda(consultorioId, ofertaId, { desde, hasta: sumarDias(desde, 1), profesionalId })
      .subscribe({
        next: (agenda) => this.agendaDestino.set(agenda),
        error: () => this.agendaDestino.set(null),
      });
  }

  // -------------------------------------------------------------------------------------
  // Comun
  // -------------------------------------------------------------------------------------

  protected cerrar(): void {
    this.pedido.set(null);
    this.alcance.set(null);
    this.error.set(null);
    this.agendaDestino.set(null);
    this.instanteDestino.set('');
    this.faltaHorario.set(false);
  }

  /** Salio bien: el panel se cierra, la serie se relee y el resultado va al aviso global. */
  private hecho(operacion: OperacionDeSerie, alcance: AlcanceDeSerie): void {
    this.enviando.set(false);
    this.cerrar();
    const cuantos = alcance.afectados?.length ?? 0;
    const omitidos = alcance.omitidos?.length ?? 0;
    const quedaron = omitidos > 0 ? ` ${omitidos} quedaron como estaban.` : '';
    if (operacion === 'reprogramar') {
      this.avisos.exito(`Se movieron ${cuantos} turnos`, {
        descripcion:
          'Cada uno conserva su número, su paciente y su historial, y vuelve a quedar ' +
          `reservado.${quedaron}`,
      });
    } else {
      this.avisos.exito(`Se cancelaron ${cuantos} turnos`, {
        ...(quedaron === '' ? {} : { descripcion: quedaron.trim() }),
      });
    }
    this.cargar();
  }

  /**
   * Un rechazo deja el panel abierto. Si fue la cantidad, la previsualizacion se descarta: no se
   * puede volver a confirmar una cantidad que ya se sabe vieja.
   */
  private fallo(error: unknown, operacion: OperacionDeSerie): void {
    this.enviando.set(false);
    const traducido = traducirErrorSerie(error, this.timezone(), operacion);
    if (traducido.accion === 'releer-alcance') {
      this.alcance.set(null);
    }
    this.tituloDelError.set(
      traducido.accion === 'releer-alcance'
        ? 'La serie cambió desde la vista previa'
        : traducido.accion === 'revisar-ocurrencias'
          ? 'El horario nuevo no tiene lugar'
          : operacion === 'reprogramar'
            ? 'No pudimos mover los turnos'
            : 'No pudimos cancelar los turnos',
    );
    this.error.set(traducido);
  }

  private numeroDeSerie(): number | null {
    const id = Number(this.serieId());
    return Number.isFinite(id) && id > 0 ? id : null;
  }
}
