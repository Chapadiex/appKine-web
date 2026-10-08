import { Location } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';

import { Agenda } from '../../../../api/generated/model/agenda';
import { EventoDeTurno } from '../../../../api/generated/model/evento-de-turno';
import { PERMISO_TURNO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { SlotDisponible } from '../../../../api/generated/model/slot-disponible';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { TurnoDelDia } from '../../../../api/generated/model/turno-del-dia';
import { Turno } from '../../../../api/generated/model/turno';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { SchedulingApi } from '../../services/scheduling-api';
import { AccionSugerida, ErrorAgenda, traducirErrorAgenda } from '../../models/agenda-errors';
import {
  fechaEnPalabras,
  hoy,
  rangoEnZona,
  slotCompleto,
  sumarDias,
} from '../../models/etiquetas-de-agenda';
import {
  esTerminal,
  estadoSegunHistorial,
  fechaHoraEnZona,
  horarioSegunHistorial,
  textoDeEstado,
  textoDeEvento,
} from '../../models/etiquetas-de-turno';

/** Panel abierto. Uno solo a la vez: son tres confirmaciones sobre el mismo turno. */
type Panel = 'ninguno' | 'cancelar' | 'ausencia' | 'reprogramar';

/**
 * Ciclo de vida de un turno: confirmar, cancelar, reprogramar, marcar ausente e historial
 * (M12, AKINE-05.03, RF-M12-008).
 *
 * <h2>1. Las cuatro transiciones no son cuatro sabores de lo mismo</h2>
 *
 * <p>Es lo que esta pantalla tiene que dejar claro, porque confundirlas destruye informacion:
 *
 * <ul>
 *   <li><b>Cancelar libera el lugar</b>, que vuelve a la agenda. Exige motivo (DP-04) y solo vale
 *       sobre turnos futuros.</li>
 *   <li><b>Marcar ausente NO libera el lugar</b>: la hora se consumio igual, el profesional estuvo
 *       ahi. Solo se registra despues de la hora, y el motivo es <b>opcional</b>.</li>
 *   <li><b>Reprogramar MUEVE el turno</b>: mismo id, mismo paciente, mismo historial. No cancela
 *       uno y crea otro, entre otras cosas porque la Sesion de M14 cuelga del `turnoId`. Un turno
 *       confirmado vuelve a `RESERVADO`, porque lo que el paciente confirmo era otro horario.</li>
 *   <li><b>Confirmar es idempotente</b> y no lleva version: es la unica que se puede ofrecer sin
 *       conocerla.</li>
 * </ul>
 *
 * <h2>2. Un turno con atencion clinica registrada no se toca, y la pantalla dice por que</h2>
 *
 * <p>El backend rechaza cancelar, reprogramar y marcar ausente con 409 `turno-con-atencion`
 * (DP-05). El requisito de esta etapa era explicito: eso no se muestra como "error inesperado".
 * Se muestra como lo que es —hay una Sesion y borrarla no es una opcion— con el enlace a la
 * atencion, que es lo unico que lo resuelve.
 *
 * <h2>3. De donde sale el estado: del turno, y el historial es respaldo</h2>
 *
 * <p><b>Desde el contrato 0.23.0 existe `GET /turnos/{turnoId}`</b> y de ahi salen el estado, el
 * horario y —lo que importa— la `version`. Esta pantalla es autonoma: se abre por un enlace pelado
 * y funciona.
 *
 * <p>No siempre fue asi, y conviene saber por que el codigo tiene tres fuentes. Hasta 0.21.0 lo
 * unico legible de un turno era su historial, asi que el estado se <b>derivaba</b> del ultimo
 * evento y la `version` —que el historial no trae— tenia que llegar por query (`?version=`). Una
 * URL pegada a mano dejaba la pantalla a medias: historial completo, confirmar, y nada mas.
 *
 * <p>Las tres fuentes sobreviven en orden de frescura —la ultima transicion, la lectura del turno,
 * la query— y cada una cubre un hueco de la siguiente: la transicion es lo mas nuevo que existe,
 * la lectura hace autonoma a la pantalla, y la query permite seguir operando si esa lectura falla.
 * La derivacion desde el historial queda como ultimo recurso.
 *
 * <p>La `version` se sigue <b>reescribiendo en la URL</b> despues de cada operacion. Ya no es
 * imprescindible, pero mantiene el enlace copiable coherente con lo que la pantalla muestra.
 *
 * <h2>4. Reprogramar elige un slot de la agenda, no una hora escrita a mano</h2>
 *
 * <p>El contrato pide un `inicio` "tal como lo devolvio la agenda": el servidor revalida el
 * destino entero bajo el mismo lock de sede que usa una reserva. Un `datetime-local` libre
 * produciria `slot-no-disponible` casi siempre. El profesional sale del slot elegido, que puede
 * ser <b>otro</b>: mover el turno porque el profesional se ausento es el caso normal.
 */
@Component({
  selector: 'app-ciclo-de-turno-page',
  imports: [RouterLink, ConfirmacionConMotivo],
  templateUrl: './ciclo-de-turno-page.html',
  styleUrl: '../../agenda.css',
})
export class CicloDeTurnoPage {
  private readonly api = inject(SchedulingApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);
  private readonly location = inject(Location);

  /** Del path. `withComponentInputBinding` lo liga solo. */
  readonly turnoId = input.required<string>();

  /** De la query. Ver el punto 3 del encabezado: sin esto no hay como operar el turno. */
  readonly version = input<string>('');
  readonly ofertaId = input<string>('');
  readonly fecha = input<string>('');

  protected readonly fechaEnPalabras = fechaEnPalabras;
  protected readonly textoDeEstado = textoDeEstado;
  protected readonly textoDeEvento = textoDeEvento;

  protected readonly eventos = signal<readonly EventoDeTurno[]>([]);
  protected readonly cargando = signal(false);
  protected readonly enviando = signal(false);
  protected readonly error = signal<ErrorAgenda | null>(null);
  protected readonly exito = signal<string | null>(null);
  protected readonly panel = signal<Panel>('ninguno');

  /** Ultimo turno devuelto por una transicion. Es la fuente mas fresca de `version`. */
  protected readonly turno = signal<Turno | null>(null);

  /**
   * El turno tal como esta guardado, leido al abrir la pantalla.
   *
   * <p>Existe desde el contrato 0.23.0, que publico `GET /turnos/{turnoId}`. Es lo que permite que
   * la pantalla sea autonoma: antes la `version` solo podia llegar por query y una URL abierta a
   * mano quedaba a medias.
   */
  protected readonly turnoLeido = signal<TurnoDelDia | null>(null);

  /** Agenda del dia destino, para el selector de horarios de la reprogramacion. */
  protected readonly agendaDestino = signal<Agenda | null>(null);
  protected readonly fechaDestino = signal('');
  protected readonly instanteDestino = signal('');
  protected readonly faltaHorario = signal(false);

  /**
   * Zona de la sede. Sale de la agenda cuando se pudo pedir, y si no queda en UTC.
   *
   * <p>El historial no trae zona: es una lista de instantes UTC y nada mas. Formatear con la del
   * navegador correria las horas en silencio, asi que cuando no se sabe se rotula UTC en pantalla.
   */
  protected readonly timezone = computed(() => this.agendaDestino()?.timezone ?? '');
  protected readonly zonaConocida = computed(() => this.timezone() !== '');

  /**
   * Tres fuentes en orden de frescura, y la derivada queda ultima.
   *
   * <p>Reconstruir el estado desde los eventos funciona y es informacion real del servidor, pero es
   * una deduccion: exige leer todo el historial para mostrar una linea y se rompe si algun dia un
   * evento no lleva estado. Con `GET /turnos/{turnoId}` el estado es un dato, no una inferencia.
   */
  protected readonly estado = computed(
    () => this.turno()?.estado ?? this.turnoLeido()?.estado ?? estadoSegunHistorial(this.eventos()),
  );

  protected readonly horario = computed(() => {
    const actual = this.turno() ?? this.turnoLeido();
    const { inicio, fin } =
      actual === null || actual === undefined
        ? horarioSegunHistorial(this.eventos())
        : { inicio: actual.inicio ?? '', fin: actual.fin ?? '' };
    if (inicio === '') {
      return '';
    }
    const zona = this.timezone();
    const desde = fechaHoraEnZona(inicio, zona);
    const hasta = fechaHoraEnZona(fin, zona);
    return hasta === '' ? desde : `${desde} a ${hasta}`;
  });

  /**
   * `null` solo cuando la pantalla no puede saber la version por ningun camino.
   *
   * <p>Tres fuentes, en orden de frescura: <b>la ultima transicion</b> —lo que el servidor acaba
   * de devolver, siempre lo mas nuevo—, <b>la lectura del turno</b> y, al final, <b>la query</b>.
   *
   * <p>La query queda ultima y ya no es imprescindible: existe por compatibilidad con los enlaces
   * que la reserva sigue armando, y porque si la lectura del turno falla es lo unico que permite
   * seguir operando. Antes de 0.23.0 era la unica fuente, y por eso una URL pegada a mano dejaba
   * la pantalla a medias.
   */
  protected readonly versionConocida = computed<number | null>(() => {
    const deLaTransicion = this.turno()?.version;
    if (deLaTransicion !== undefined) {
      return deLaTransicion;
    }
    const deLaLectura = this.turnoLeido()?.version;
    if (deLaLectura !== undefined) {
      return deLaLectura;
    }
    const deLaUrl = Number(this.version());
    return this.version() !== '' && Number.isInteger(deLaUrl) && deLaUrl >= 0 ? deLaUrl : null;
  });

  protected readonly puedeOperar = computed(() => this.permisos.tiene(PERMISO_TURNO_MANAGE));
  protected readonly cicloCerrado = computed(() => esTerminal(this.estado()));

  /** Las tres transiciones con version, disponibles solo cuando hay todo lo que necesitan. */
  protected readonly puedeTransicionar = computed(
    () => this.puedeOperar() && !this.cicloCerrado() && this.versionConocida() !== null,
  );

  /** Reprogramar necesita ademas la oferta, que es de donde salen los horarios candidatos. */
  protected readonly puedeReprogramar = computed(
    () => this.puedeTransicionar() && this.numeroDeOferta() !== null,
  );

  protected readonly slotsDestino = computed<readonly SlotDisponible[]>(
    () => this.agendaDestino()?.dias?.[0]?.slots ?? [],
  );

  protected readonly accion = computed<AccionSugerida>(() => this.error()?.accion ?? 'ninguna');

  constructor() {
    effect(() => {
      // Depende del turno de la ruta y del contexto: cambiar de sede convierte este turno en uno
      // de otra sede, que no es alcanzable ni deberia quedar en pantalla.
      this.turnoId();
      this.tenantContext.contextEpoch();
      const fecha = this.fecha();
      untracked(() => {
        this.turno.set(null);
        this.turnoLeido.set(null);
        this.agendaDestino.set(null);
        this.eventos.set([]);
        this.error.set(null);
        this.exito.set(null);
        this.panel.set('ninguno');
        this.instanteDestino.set('');
        this.fechaDestino.set(fecha === '' ? hoy() : fecha);
        this.cargarTurnoYHistorial();
        this.cargarDestino();
      });
    });
  }

  // -------------------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------------------

  /**
   * Relee el turno y su historial. Es tambien la accion de `recargar-turno`.
   *
   * <p><b>El turno se lee del servidor desde el contrato 0.23.0</b>, y con el viene la `version`.
   * Antes no habia forma: lo unico legible era el historial, la version tenia que llegar por query
   * y una URL pegada a mano dejaba la pantalla a medias. Se pide primero el turno y despues el
   * historial porque el primero es el que habilita las acciones; si el historial falla, la
   * pantalla sigue pudiendo operar.
   */
  protected cargarTurnoYHistorial(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const turnoId = this.numeroDeTurno();
    if (consultorioId === null || turnoId === null) {
      return;
    }
    // Se captura ANTES del pedido: si el enlace no traia la oferta, la agenda —de donde sale el
    // timezone— no se pudo pedir todavia, y hay que pedirla cuando la lectura la revele.
    //
    // NO sirve preguntar despues por `agendaDestino() === null`: cuando el enlace SI trae la
    // oferta, ese pedido ya salio y todavia no volvio, asi que la condicion daria verdadero y
    // dispararia un segundo pedido identico.
    const sabiaLaOferta = this.numeroDeOferta() !== null;
    this.api.verTurno(consultorioId, turnoId).subscribe({
      next: (turno) => {
        // Gana la version mas nueva, venga de donde venga. Una lectura que vuelve con una
        // version MAYOR que la de la ultima transicion reemplaza a esa transicion, que
        // `estado` y `versionConocida` prefieren: sin esto, despues de un 409 por un turno que
        // otra persona movio, releer traia la version nueva y la pantalla seguia mostrando y
        // mandando la vieja, un 409 sin salida. Y una lectura que vuelve con una version MENOR
        // —la de la apertura, que llego despues de un "Confirmar" rapido— no puede pisar lo que
        // la transicion ya devolvio. Las dos cosas las destapo el E2E contra el backend real
        // (AKINE E-2).
        const deLaTransicion = this.turno()?.version;
        if (deLaTransicion === undefined || (turno.version ?? -1) >= deLaTransicion) {
          this.turno.set(null);
          this.turnoLeido.set(turno);
          this.fijarVersionEnLaUrl(turno.version);
        }
        if (!sabiaLaOferta && this.numeroDeOferta() !== null) {
          this.cargarDestino();
        }
      },
      // Un fallo aca no voltea la pantalla: el historial sigue cargando y la version de la query
      // —si vino— sigue sirviendo. Lo que se pierde es la independencia, no la pantalla.
      error: () => this.turnoLeido.set(null),
    });
    this.cargarHistorial();
  }

  /**
   * Relee SOLO el historial.
   *
   * <p>Es lo que corresponde despues de una transicion: la respuesta de la transicion ya trajo el
   * turno con su version nueva, asi que volver a pedirlo seria una vuelta al servidor para
   * enterarse de algo que ya se sabe. Lo unico que cambio y no se tiene es la fila del historial.
   */
  protected cargarHistorial(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const turnoId = this.numeroDeTurno();
    if (consultorioId === null || turnoId === null) {
      return;
    }

    this.cargando.set(true);
    this.api.historial(consultorioId, turnoId).subscribe({
      next: (eventos) => {
        this.eventos.set(eventos);
        this.cargando.set(false);
      },
      error: (error: unknown) => {
        this.cargando.set(false);
        this.error.set(traducirErrorAgenda(error));
      },
    });
  }

  /**
   * Agenda del dia destino de la reprogramacion.
   *
   * <p>Se pide aunque el panel este cerrado, porque de la misma respuesta sale el `timezone` con
   * el que se rotula todo el historial. Un fallo aca <b>no</b> es un error de la pantalla: el
   * historial sigue siendo legible sin horarios candidatos.
   */
  protected cargarDestino(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const ofertaId = this.numeroDeOferta();
    const desde = this.fechaDestino();
    if (consultorioId === null || ofertaId === null || desde === '') {
      return;
    }

    this.api
      .buscarAgenda(consultorioId, ofertaId, { desde, hasta: sumarDias(desde, 1) })
      .subscribe({
        next: (agenda) => this.agendaDestino.set(agenda),
        error: () => this.agendaDestino.set(null),
      });
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

  // -------------------------------------------------------------------------------------
  // Transiciones
  // -------------------------------------------------------------------------------------

  /** Idempotente y sin version: confirmar dos veces devuelve 200 sin cambiar nada. */
  protected confirmar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const turnoId = this.numeroDeTurno();
    if (consultorioId === null || turnoId === null) {
      return;
    }
    this.ejecutar(
      this.api.confirmar(consultorioId, turnoId),
      'Turno confirmado. Confirmar es un estado de la reserva: no dice nada del cobro ni de que el ' +
        'paciente haya llegado.',
    );
  }

  /** Motivo <b>obligatorio</b> (DP-04): el panel usa el default del componente compartido. */
  protected cancelar(motivo: string): void {
    const consultorioId = this.tenantContext.consultorioId();
    const turnoId = this.numeroDeTurno();
    const expectedVersion = this.versionConocida();
    if (consultorioId === null || turnoId === null || expectedVersion === null) {
      return;
    }
    this.ejecutar(
      this.api.cancelar(consultorioId, turnoId, { motivo, expectedVersion }),
      'Turno cancelado. El lugar se libero y vuelve a estar disponible en la agenda.',
    );
  }

  /**
   * Motivo <b>opcional</b>: el contrato solo exige `expectedVersion`.
   *
   * <p>El panel lo declara con `motivoObligatorio` en `false` a proposito. El default del
   * componente compartido es `true` —lo necesitan las bajas— y dejarlo puesto aca haria que el
   * boton no emitiera nada con el campo vacio: sin peticion, sin error y sin sintoma. Ya paso una
   * vez con la activacion del perfil de paciente.
   */
  protected marcarAusente(motivo: string): void {
    const consultorioId = this.tenantContext.consultorioId();
    const turnoId = this.numeroDeTurno();
    const expectedVersion = this.versionConocida();
    if (consultorioId === null || turnoId === null || expectedVersion === null) {
      return;
    }
    this.ejecutar(
      this.api.registrarAusencia(consultorioId, turnoId, { expectedVersion, motivo }),
      'Ausencia registrada. El lugar NO se libero: la hora se consumio igual.',
    );
  }

  /** Mueve el turno. Mismo id, mismo paciente, mismo historial. */
  protected reprogramar(motivo: string): void {
    const consultorioId = this.tenantContext.consultorioId();
    const turnoId = this.numeroDeTurno();
    const expectedVersion = this.versionConocida();
    const inicio = this.instanteDestino();
    if (inicio === '') {
      // Sin horario elegido no hay pedido que mandar, y el motivo escrito no se pierde.
      this.faltaHorario.set(true);
      return;
    }
    if (consultorioId === null || turnoId === null || expectedVersion === null) {
      return;
    }
    const profesionalId = this.slotsDestino().find((s) => s.desde === inicio)?.profesionalId;
    this.ejecutar(
      this.api.reprogramar(consultorioId, turnoId, {
        inicio,
        motivo,
        expectedVersion,
        profesionalId,
      }),
      'Turno reprogramado. Es el mismo turno: conserva su numero, su paciente y su historial. Si ' +
        'estaba confirmado vuelve a quedar reservado, porque lo confirmado era otro horario.',
    );
  }

  protected abrir(panel: Panel): void {
    this.panel.set(panel);
    this.error.set(null);
    this.exito.set(null);
    this.faltaHorario.set(false);
  }

  protected cerrar(): void {
    this.panel.set('ninguno');
    this.faltaHorario.set(false);
  }

  /** Accion de `recargar-turno` y de `recargar-agenda`: lo que hay en pantalla quedo viejo. */
  protected recargar(): void {
    this.error.set(null);
    this.cargarTurnoYHistorial();
    this.cargarDestino();
  }

  // -------------------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------------------

  protected instanteEnZona(instante: string | undefined): string {
    return fechaHoraEnZona(instante, this.timezone());
  }

  protected rangoDelSlot(slot: SlotDisponible): string {
    return rangoEnZona(slot, this.timezone());
  }

  protected slotCompleto = slotCompleto;

  protected esElDestino(slot: SlotDisponible): boolean {
    return slot.desde === this.instanteDestino() && this.instanteDestino() !== '';
  }

  /**
   * Corre una transicion y deja la pantalla consistente con lo que devolvio.
   *
   * <p>Las cuatro terminan igual —turno nuevo, historial releido, version reescrita en la URL— y
   * escribirlo una vez es lo que impide que una de las cuatro se olvide de una de las tres cosas.
   */
  private ejecutar(peticion: Observable<Turno>, mensaje: string): void {
    this.enviando.set(true);
    this.error.set(null);
    this.exito.set(null);
    peticion.subscribe({
      next: (turno) => {
        this.enviando.set(false);
        this.turno.set(turno);
        this.panel.set('ninguno');
        this.instanteDestino.set('');
        this.exito.set(mensaje);
        this.fijarVersionEnLaUrl(turno.version);
        this.cargarHistorial();
      },
      error: (error: unknown) => {
        this.enviando.set(false);
        this.error.set(traducirErrorAgenda(error));
      },
    });
  }

  /**
   * Reescribe `?version=` sin navegar.
   *
   * <p>`replaceState` y no una navegacion: no hay pantalla nueva ni entrada de historial que
   * agregar, y una navegacion volveria a disparar el efecto que resetea todo. Lo que se gana es
   * que un refresh despues de operar siga pudiendo operar.
   */
  private fijarVersionEnLaUrl(version: number | undefined): void {
    if (version === undefined) {
      return;
    }
    const query = new URLSearchParams();
    query.set('version', String(version));
    if (this.ofertaId() !== '') {
      query.set('ofertaId', this.ofertaId());
    }
    if (this.fecha() !== '') {
      query.set('fecha', this.fecha());
    }
    this.location.replaceState(`/agenda/turnos/${this.turnoId()}`, query.toString());
  }

  private numeroDeTurno(): number | null {
    const id = Number(this.turnoId());
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  /**
   * La oferta del turno, de la query o —desde 0.23.0— de la lectura del turno.
   *
   * <p>Es lo que termina de hacer autonoma a la pantalla. La oferta no se usa solo para
   * reprogramar: de su agenda sale el <b>timezone</b> con el que se rotula todo el historial, asi
   * que sin ella un enlace pelado mostraba las horas en UTC. Con la lectura ya no hace falta que
   * quien enlaza sepa la oferta.
   */
  private numeroDeOferta(): number | null {
    const deLaUrl = Number(this.ofertaId());
    if (Number.isFinite(deLaUrl) && deLaUrl > 0) {
      return deLaUrl;
    }
    const deLaLectura = this.turnoLeido()?.ofertaId;
    return deLaLectura !== undefined && deLaLectura > 0 ? deLaLectura : null;
  }
}
