import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { Observable, Subscription } from 'rxjs';

import { CancelarTurnoOrigenEnum } from '../../../api/generated/model/cancelar-turno';
import { EventoDeRecepcion } from '../../../api/generated/model/evento-de-recepcion';
import { EventoDeTurno } from '../../../api/generated/model/evento-de-turno';
import { HorarioDisponible } from '../../../api/generated/model/horario-disponible';
import { OfertaResponse } from '../../../api/generated/model/oferta-response';
import { PrepagoDeRecepcionEstadoEnum } from '../../../api/generated/model/prepago-de-recepcion';
import { RecursoLibre } from '../../../api/generated/model/recurso-libre';
import { TurnoDelDia } from '../../../api/generated/model/turno-del-dia';
import {
  PERMISO_HC_READ,
  PERMISO_SESION_REGISTER,
  PERMISO_TURNO_MANAGE,
  PERMISO_TURNO_SOBRETURNO,
} from '../../../core/models/permisos';
import { VistaInicialDeTurno } from '../../../core/models/contexto-de-turno';
import { AvisosStore } from '../../../core/services/avisos.store';
import { DiaDeLaSede } from '../../../core/services/dia-de-la-sede';
import { FlujoDeTurnosStore } from '../../../core/services/flujo-de-turnos.store';
import { PerfilPropioStore } from '../../../core/services/perfil-propio.store';
import { PermissionsStore } from '../../../core/services/permissions.store';
import { SessionService } from '../../../core/services/session.service';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { Alerta } from '../../../shared/components/alerta/alerta';
import { Ayuda } from '../../../shared/components/ayuda/ayuda';
import { PanelLateral } from '../../../shared/components/panel-lateral/panel-lateral';
import { PermisoDirective } from '../../../shared/directives/permiso.directive';
import { AccionSugerida, ErrorAgenda, traducirErrorAgenda } from '../models/agenda-errors';
import { fechaEnPalabras, horaEnZona } from '../models/etiquetas-de-agenda';
import {
  llegadaVigente,
  nombreDeEstadoDeRecepcion,
  textoDeEventoDeRecepcion,
  textoDePrepago,
} from '../models/etiquetas-de-recepcion';
import {
  coberturaParaReservar,
  MOTIVOS_DE_CANCELACION,
  MOTIVOS_DE_REPROGRAMACION,
  ORIGENES_DE_CANCELACION,
  esTerminal,
  fechaHoraEnZona,
  nombreDeEstado,
  nombreDeEstadoOperativo,
  simboloDeEstadoOperativo,
  textoDeEvento,
} from '../models/etiquetas-de-turno';
import { diaEnZona } from '../models/semana';
import { SchedulingApi } from '../services/scheduling-api';
import { ListaDeHorarios } from './lista-de-horarios';

type Vista = 'resumen' | 'reprogramar' | 'cancelar' | 'ausente' | 'historial' | 'trasladar';

/** El motivo que solo no dice nada: con este, la observacion deja de ser opcional (DP-04). */
const MOTIVO_OTRO = 'Otro';

/** Un rechazo con alguna de estas salidas dice que lo que se ve, aca y atras, quedo viejo. */
const QUEDO_VIEJO: ReadonlySet<AccionSugerida> = new Set<AccionSugerida>([
  'recargar-agenda',
  'recargar-dia',
  'recargar-turno',
  'resolver-atencion',
]);

/**
 * Lo que se ve y se hace con un turno (TURNO - Tecnico §29 y §30). Es el unico lugar donde se opera un
 * turno: lo abren la agenda, la recepcion, la serie y la direccion `/agenda/turnos/:turnoId`.
 *
 * <p>Las acciones dependen del estado, y lo decide `estadoOperativo`: un turno cancelado no ofrece
 * iniciar la atencion. Las principales quedan a la vista y el resto en "Mas acciones". Marcar presente
 * se ejecuta directo; cancelar pide motivo (§51).
 *
 * <p><b>Reprogramar es la misma operacion de siempre</b>, con el mismo turno: el id, el paciente, el
 * caso y el plan no cambian, y el historial guarda de donde vino. El destino sale de la disponibilidad
 * y puede ser de otro profesional: mover un turno porque el profesional falta es el caso normal.
 *
 * <p><b>La version es la de la ultima lectura.</b> Las transiciones la mandan y el servidor rechaza
 * con 409 si otra persona toco el turno. <b>Todo rechazo relee el turno</b>, incluido el de reprogramar:
 * sin eso el panel seguiria mandando la version vieja y el 409 no tendria salida. Una lectura nueva
 * cancela la anterior, para que el orden de llegada de las respuestas no decida cual vale.
 */
@Component({
  selector: 'app-detalle-de-turno-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alerta, Ayuda, ListaDeHorarios, PanelLateral, PermisoDirective],
  templateUrl: './detalle-de-turno-panel.html',
  styleUrl: './flujo.css',
})
export class DetalleDeTurnoPanel implements OnInit {
  private readonly api = inject(SchedulingApi);
  private readonly tenant = inject(TenantContextStore);
  private readonly dia = inject(DiaDeLaSede);
  private readonly avisos = inject(AvisosStore);
  private readonly flujo = inject(FlujoDeTurnosStore);
  private readonly permisos = inject(PermissionsStore);
  private readonly perfil = inject(PerfilPropioStore);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  readonly turnoId = input.required<number>();
  /** Con que operacion abre: la tabla de turnos afectados por un bloqueo entra directo a mover o cancelar. */
  readonly vistaInicial = input<VistaInicialDeTurno>('resumen');
  readonly cerrar = output<void>();

  protected readonly PERMISO_TURNO_MANAGE = PERMISO_TURNO_MANAGE;
  protected readonly PERMISO_SESION_REGISTER = PERMISO_SESION_REGISTER;
  protected readonly PERMISO_HC_READ = PERMISO_HC_READ;
  protected readonly PERMISO_TURNO_SOBRETURNO = PERMISO_TURNO_SOBRETURNO;
  protected readonly ORIGENES_DE_CANCELACION = ORIGENES_DE_CANCELACION;
  protected readonly MOTIVOS_DE_CANCELACION = MOTIVOS_DE_CANCELACION;
  protected readonly MOTIVOS_DE_REPROGRAMACION = MOTIVOS_DE_REPROGRAMACION;
  protected readonly nombreDeEstadoOperativo = nombreDeEstadoOperativo;
  protected readonly simboloDeEstadoOperativo = simboloDeEstadoOperativo;
  protected readonly textoDeEvento = textoDeEvento;
  protected readonly nombreDeEstado = nombreDeEstado;
  protected readonly textoDeEventoDeRecepcion = textoDeEventoDeRecepcion;
  protected readonly nombreDeEstadoDeRecepcion = nombreDeEstadoDeRecepcion;

  protected readonly turno = signal<TurnoDelDia | null>(null);
  protected readonly cargando = signal(true);
  protected readonly vista = signal<Vista>('resumen');
  protected readonly masAcciones = signal(false);
  protected readonly enviando = signal(false);
  protected readonly error = signal<ErrorAgenda | null>(null);
  private pedidoDeLectura: Subscription | null = null;
  private vistaInicialAplicada = false;

  /** La sede del contexto: el turno es de la sede en la que se esta trabajando. */
  protected readonly sede = computed(() => this.tenant.context()?.consultorioName ?? '');

  protected readonly eventos = signal<readonly EventoDeTurno[]>([]);
  protected readonly leyendoHistorial = signal(false);
  protected readonly errorDeHistorial = signal<ErrorAgenda | null>(null);

  /**
   * La otra maquina (DP-16): llegada, validacion, espera, retiro. Todas las recepciones del turno,
   * anuladas incluidas. Si no se puede leer la seccion no aparece: el historial del turno sigue.
   */
  protected readonly eventosDeRecepcion = signal<readonly EventoDeRecepcion[]>([]);

  /**
   * La zona que trajo la busqueda de horarios, que es la de la sede y gana sobre la del contexto.
   *
   * <p>La del contexto puede no estar resuelta al abrir el panel —entrando por la direccion del turno
   * se carga en paralelo—: por eso es un `computed` y no una foto. Una foto dejaba las horas en UTC.
   */
  private readonly zonaDeLaBusqueda = signal('');
  protected readonly timezone = computed(() => this.zonaDeLaBusqueda() || this.dia.zona());
  protected readonly hoy = computed(() => this.dia.hoy());

  protected readonly horarios = signal<readonly HorarioDisponible[]>([]);
  protected readonly buscando = signal(false);
  protected readonly errorDeBusqueda = signal<ErrorAgenda | null>(null);
  /** Vacia si no se eligio o no se pudo leer: es un dato de mas, no una condicion. */
  protected readonly cobertura = signal('');
  private pedidoDeDestinos: Subscription | null = null;
  protected readonly truncado = signal(false);
  protected readonly limite = signal(12);
  protected readonly destino = signal<HorarioDisponible | null>(null);
  /** Con quien se buscan los horarios. Arranca en el del turno; `null` es cualquiera. */
  protected readonly profesionalDestino = signal<number | null>(null);
  protected readonly desdeDestino = signal('');
  protected readonly motivoReprogramacion = signal<string>(MOTIVOS_DE_REPROGRAMACION[0]);
  /** "¿Quien esta libre a esta hora?": otros profesionales para el mismo horario. Null: no se pregunto. */
  protected readonly libresALaHora = signal<readonly RecursoLibre[] | null>(null);
  protected readonly buscandoLibres = signal(false);
  protected readonly errorDeLibres = signal<ErrorAgenda | null>(null);
  private pedidoDeLibres: Subscription | null = null;

  protected readonly origenCancelacion = signal<string>('PACIENTE');
  protected readonly motivoCancelacion = signal<string>(MOTIVOS_DE_CANCELACION[0]);
  protected readonly observacion = signal('');

  protected readonly consumeSesion = signal(false);

  protected readonly estado = computed(() => this.turno()?.operativo?.estadoOperativo ?? '');
  protected readonly operativo = computed(() => this.turno()?.operativo ?? null);

  /** Sigue siendo una reserva: se puede operar. */
  protected readonly vivo = computed(() => ['RESERVADO', 'CONFIRMADO'].includes(this.estado()));
  protected readonly enElCentro = computed(() => this.estado() === 'PRESENTE');
  protected readonly enAtencion = computed(() => this.estado() === 'EN_ATENCION');
  protected readonly atendido = computed(() => this.estado() === 'ATENDIDO');
  protected readonly cerrado = computed(() =>
    ['CANCELADO', 'AUSENTE', 'RETIRADO'].includes(this.estado()),
  );
  /** Se fue sin ser atendido (U-21): la llegada consta, y el backend rechaza ausencia y mover. */
  protected readonly retirado = computed(() => this.estado() === 'RETIRADO');
  protected readonly empezo = computed(() => {
    const inicio = this.turno()?.inicio;
    return inicio !== undefined && new Date(inicio).getTime() <= Date.now();
  });
  /** Sin version no se ofrece lo que la lleva: inventarla seria prometer un 409. */
  private readonly conVersion = computed(() => this.turno()?.version !== undefined);
  /** El retiro no cierra la reserva: el lugar sigue tomado, y cancelar es lo que lo libera. */
  protected readonly puedeCancelar = computed(
    () =>
      this.conVersion() && (this.vivo() || this.enElCentro() || this.retirado()) && !this.empezo(),
  );
  protected readonly puedeReprogramar = computed(
    () => this.conVersion() && this.vivo() && !this.empezo(),
  );
  protected readonly puedeMarcarAusente = computed(
    () => this.conVersion() && this.vivo() && this.empezo(),
  );
  /**
   * Con `turno:manage` recortado a la actividad propia (contrato 0.154.0), el turno de otro
   * profesional se mira y no se toca: el backend responde 403 igual, esto evita ofrecerlo.
   */
  protected readonly esAjeno = computed(
    () =>
      this.permisos.soloPropio(PERMISO_TURNO_MANAGE) &&
      this.turno() !== null &&
      this.turno()?.profesionalId !== this.perfil.membershipId(),
  );
  protected readonly puedeOperar = computed(
    () => this.permisos.tiene(PERMISO_TURNO_MANAGE) && !this.esAjeno(),
  );

  // Observaciones del turno: administrativas, nunca clinicas.
  protected readonly editandoObservaciones = signal(false);
  protected readonly textoDeObservaciones = signal('');

  // Cambio de sede: cancela el original y reserva otro en la sede de destino, en una transaccion.
  protected readonly sedesDestino = computed(() => {
    const actual = this.tenant.context();
    return this.session
      .contextos()
      .filter(
        (c) =>
          c.organizationId === actual?.organizationId &&
          c.consultorioId !== undefined &&
          c.consultorioId !== actual?.consultorioId,
      );
  });
  protected readonly sedeDestino = signal<number | null>(null);
  protected readonly ofertasDestino = signal<readonly OfertaResponse[]>([]);
  protected readonly ofertaDestino = signal<number | null>(null);
  protected readonly motivoTraslado = signal('');

  /** Los boxes que la busqueda ofrece para el horario elegido, si hay mas de uno. */
  protected readonly boxesDelDestino = computed(() => {
    const destino = this.destino();
    if (destino === null) {
      return [];
    }
    const vistos = new Map<number, string>();
    for (const h of this.horarios()) {
      if (
        h.desde === destino.desde &&
        h.profesionalId === destino.profesionalId &&
        h.espacioId !== undefined
      ) {
        vistos.set(h.espacioId, h.espacioNombre ?? `Box ${h.espacioId}`);
      }
    }
    return [...vistos].map(([id, nombre]) => ({ id, nombre }));
  });
  protected readonly boxElegido = signal<number | null>(null);

  /** Nombres de profesionales para el historial: el evento trae ids. */
  private readonly nombresDeProfesionales = signal<ReadonlyMap<number, string>>(new Map());

  /** El documento desambigua homonimos, que en un mostrador son el caso normal. */
  protected readonly subtitulo = computed(() => {
    const turno = this.turno();
    return [turno?.personaNombre, turno?.documento].filter(Boolean).join(' · ') || null;
  });

  protected readonly tituloDelError = computed(() =>
    this.turno() === null ? 'No pudimos abrir el turno' : 'No se pudo completar la acción',
  );

  /** Si el turno no se pudo leer y volver a pedirlo tiene sentido. Un 404 no cambia solo. */
  protected readonly lecturaReintentable = computed(
    () => this.turno() === null && ['red', 'limite', 'otro'].includes(this.error()?.causa ?? ''),
  );

  /**
   * El prepago (E-8), o vacio. Solo de lectura: cobrarlo es de la recepcion del dia. Avisa y no
   * bloquea (DP-06). Un `PENDIENTE` en un turno que ya cayo deja de valer; un `REGISTRADO` sigue
   * siendo cierto, porque es un anticipo que hay que reintegrar.
   */
  protected readonly avisoDePrepago = computed(() => {
    const turno = this.turno();
    const caido = esTerminal(turno?.estado ?? '');
    if (caido && turno?.prepago?.estado === PrepagoDeRecepcionEstadoEnum.PENDIENTE) {
      return '';
    }
    return textoDePrepago(turno?.prepago, {
      antesDelCheckin: !llegadaVigente(turno?.recepcion),
      turnoCaido: caido,
    });
  });

  /** "Otro" solo no es un motivo: DP-04 pide saber por que, asi que hay que escribirlo. */
  protected readonly motivoEsOtro = computed(() => {
    const vista = this.vista();
    return (
      (vista === 'cancelar' && this.motivoCancelacion() === MOTIVO_OTRO) ||
      (vista === 'reprogramar' && this.motivoReprogramacion() === MOTIVO_OTRO)
    );
  });
  protected readonly faltaDetalle = computed(
    () => this.motivoEsOtro() && this.observacion().trim() === '',
  );

  protected readonly titulo = computed(() => {
    switch (this.vista()) {
      case 'reprogramar':
        return 'Reprogramar turno';
      case 'cancelar':
        return 'Cancelar turno';
      case 'ausente':
        return 'Marcar ausente';
      case 'historial':
        return 'Historial del turno';
      case 'trasladar':
        return 'Cambiar de sede';
      default:
        return 'Turno';
    }
  });

  protected readonly cuando = computed(() => {
    const turno = this.turno();
    const zona = this.timezone();
    if (turno === null) {
      return '';
    }
    return (
      `${fechaEnPalabras(diaEnZona(turno.inicio, zona))} · ` +
      `${horaEnZona(turno.inicio, zona)} a ${horaEnZona(turno.fin, zona)}` +
      // Sin zona las horas salen en UTC: se rotula, porque la del navegador mentiria sin que nada falle.
      (zona === '' ? ' (UTC)' : '')
    );
  });

  ngOnInit(): void {
    this.perfil.asegurarCargado();
    this.leer();
  }

  /** Lo que dice el servidor: despues de operar, y despues de un rechazo para que la version sirva. */
  private leer(): void {
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null) {
      return;
    }
    this.cargando.set(true);
    this.pedidoDeLectura?.unsubscribe();
    this.pedidoDeLectura = this.api.verTurno(consultorioId, this.turnoId()).subscribe({
      next: (turno) => {
        this.cargando.set(false);
        this.turno.set(turno);
        this.leerCobertura(turno);
        this.aplicarVistaInicial();
        this.volverSiYaNoSePuede();
      },
      error: (error: unknown) => {
        this.cargando.set(false);
        // Con el turno a la vista, lo que hay que explicar es el rechazo que hizo releer.
        if (this.turno() === null || this.error() === null) {
          this.error.set(this.errorDeLectura(error));
        }
      },
    });
  }

  /** El 404 generico habla de ofertas y del buscador; aca lo que no se encontro es un turno. */
  private errorDeLectura(error: unknown): ErrorAgenda {
    const traducido = traducirErrorAgenda(error);
    return traducido.causa === 'no-encontrado'
      ? { ...traducido, mensaje: 'Este turno no existe, o es de otra sede.' }
      : traducido;
  }

  /** Una sola vez, con el turno leido: si la operacion pedida no se puede, queda el resumen. */
  private aplicarVistaInicial(): void {
    if (this.vistaInicialAplicada) {
      return;
    }
    this.vistaInicialAplicada = true;
    const vista = this.vistaInicial();
    if (
      (vista === 'reprogramar' && this.puedeReprogramar()) ||
      (vista === 'cancelar' && this.puedeCancelar())
    ) {
      this.abrir(vista);
    }
  }

  /** Si la relectura dice que la operacion abierta ya no vale, no se deja el formulario a la vista. */
  private volverSiYaNoSePuede(): void {
    const vista = this.vista();
    const sigue =
      vista === 'cancelar'
        ? this.puedeCancelar()
        : vista === 'reprogramar' || vista === 'trasladar'
          ? this.puedeReprogramar()
          : vista === 'ausente'
            ? this.puedeMarcarAusente()
            : true;
    if (!sigue) {
      this.vista.set('resumen');
    }
  }

  protected reintentarLectura(): void {
    this.error.set(null);
    this.leer();
  }

  /** El turno trae el id de la cobertura elegida: el nombre se lee de las del paciente. */
  private leerCobertura(turno: TurnoDelDia): void {
    this.cobertura.set('');
    const { personaId, coberturaId, inicio } = turno;
    if (personaId === undefined || coberturaId === undefined || coberturaId === null) {
      return;
    }
    this.api.coberturasElegibles(personaId, diaEnZona(inicio, this.timezone())).subscribe({
      next: (lista) => {
        const elegida = lista.find((c) => c.id === coberturaId);
        this.cobertura.set(elegida ? coberturaParaReservar(elegida) : '');
      },
      error: () => this.cobertura.set(''),
    });
  }

  protected abrir(vista: Vista): void {
    this.error.set(null);
    this.masAcciones.set(false);
    this.observacion.set('');
    this.vista.set(vista);
    if (vista === 'historial') {
      this.leerHistorial();
    }
    if (vista === 'trasladar') {
      this.prepararTraslado();
    }
    if (vista === 'reprogramar') {
      this.libresALaHora.set(null);
      this.errorDeLibres.set(null);
      this.limite.set(12);
      this.elegirDestino(null);
      this.desdeDestino.set('');
      this.profesionalDestino.set(this.turno()?.profesionalId ?? null);
      this.buscarDestino();
    }
    if (vista === 'ausente') {
      this.consumeSesion.set(false);
    }
  }

  /** "Volver": lo que se rechazo era de la operacion que se esta dejando. */
  protected volver(): void {
    this.error.set(null);
    this.vista.set('resumen');
  }

  protected leerHistorial(): void {
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null) {
      return;
    }
    this.leyendoHistorial.set(true);
    this.errorDeHistorial.set(null);
    this.api.historial(consultorioId, this.turnoId()).subscribe({
      next: (eventos) => {
        this.leyendoHistorial.set(false);
        this.eventos.set(eventos);
        this.leerNombresSiHacenFalta(consultorioId, eventos);
      },
      error: (error: unknown) => {
        this.leyendoHistorial.set(false);
        this.errorDeHistorial.set(traducirErrorAgenda(error));
      },
    });
    this.api.historialRecepcion(consultorioId, this.turnoId()).subscribe({
      next: (eventos) => this.eventosDeRecepcion.set(eventos),
      error: () => this.eventosDeRecepcion.set([]),
    });
  }

  /** Solo si algun evento cambio de profesional: el resto del historial no necesita nombres. */
  private leerNombresSiHacenFalta(consultorioId: number, eventos: readonly EventoDeTurno[]): void {
    const hacenFalta = eventos.some(
      (e) =>
        e.profesionalAnteriorId !== undefined &&
        e.profesionalNuevoId !== undefined &&
        e.profesionalAnteriorId !== e.profesionalNuevoId,
    );
    if (!hacenFalta || this.nombresDeProfesionales().size > 0) {
      return;
    }
    this.api.profesionales(consultorioId).subscribe({
      next: (lista) =>
        this.nombresDeProfesionales.set(new Map(lista.map((p) => [p.id ?? 0, p.nombre ?? '']))),
      error: () => undefined,
    });
  }

  /** "Ana -> Juan" si el evento cambio de profesional; vacio si no. */
  protected cambioDeProfesional(evento: EventoDeTurno): string {
    const antes = evento.profesionalAnteriorId;
    const despues = evento.profesionalNuevoId;
    if (antes === undefined || despues === undefined || antes === despues) {
      return '';
    }
    const nombre = (id: number): string =>
      this.nombresDeProfesionales().get(id) || `Profesional #${id}`;
    return `Profesional: ${nombre(antes)} → ${nombre(despues)}`;
  }

  /** El evento trae ids de box y no nombres: se muestran como tales. */
  protected cambioDeBox(evento: EventoDeTurno): string {
    const antes = evento.espacioAnteriorId;
    const despues = evento.espacioNuevoId;
    if (antes === despues) {
      return '';
    }
    const box = (id: number | undefined): string => (id === undefined ? 'sin box' : `Box #${id}`);
    return `Box: ${box(antes)} → ${box(despues)}`;
  }

  protected instante(valor: string | undefined): string {
    return fechaHoraEnZona(valor, this.timezone());
  }

  /** Quien hizo el cambio. Sin cuenta lo hizo el sistema, o es un evento reconstruido por V38. */
  protected quien(evento: EventoDeTurno | EventoDeRecepcion): string {
    if (evento.actorNombre) {
      return evento.actorNombre;
    }
    return evento.actorCuentaId ? `Cuenta #${evento.actorCuentaId}` : 'Sin registrar';
  }

  // -------------------------------------------------------------------------------------
  // Acciones de un paso
  // -------------------------------------------------------------------------------------

  protected marcarPresente(): void {
    this.ejecutar(
      (consultorioId, turnoId) => this.api.registrarLlegada(consultorioId, turnoId),
      'Paciente marcado como presente.',
    );
  }

  // -------------------------------------------------------------------------------------
  // Observaciones
  // -------------------------------------------------------------------------------------

  protected editarObservaciones(): void {
    this.textoDeObservaciones.set(this.operativo()?.observaciones ?? '');
    this.editandoObservaciones.set(true);
  }

  protected guardarObservaciones(): void {
    const consultorioId = this.tenant.consultorioId();
    const expectedVersion = this.turno()?.version;
    if (consultorioId === null || expectedVersion === undefined) {
      return;
    }
    this.enviando.set(true);
    this.error.set(null);
    this.api
      .actualizarObservaciones(consultorioId, this.turnoId(), {
        observaciones: this.textoDeObservaciones(),
        expectedVersion,
      })
      .subscribe({
        next: () => {
          this.enviando.set(false);
          this.editandoObservaciones.set(false);
          this.avisos.exito('Observaciones guardadas.');
          this.flujo.notificarCambio();
          this.leer();
        },
        error: (error: unknown) => this.rechazado(error),
      });
  }

  protected confirmarTurno(): void {
    this.ejecutar(
      (consultorioId, turnoId) => this.api.confirmar(consultorioId, turnoId),
      'Turno confirmado.',
    );
  }

  private ejecutar(
    accion: (consultorioId: number, turnoId: number) => Observable<unknown>,
    mensaje: string,
  ): void {
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null) {
      return;
    }
    this.enviando.set(true);
    this.error.set(null);
    accion(consultorioId, this.turnoId()).subscribe({
      next: () => {
        this.enviando.set(false);
        this.avisos.exito(mensaje);
        this.flujo.notificarCambio();
        this.leer();
      },
      error: (error: unknown) => this.rechazado(error),
    });
  }

  /**
   * Un rechazo se explica y se relee el turno, para que el proximo intento lleve la version vigente.
   * Si dice que lo que se veia quedo viejo, tambien se avisa a la pantalla de atras.
   */
  private rechazado(error: unknown): void {
    this.enviando.set(false);
    const traducido = traducirErrorAgenda(error);
    this.error.set(traducido);
    this.leer();
    if (QUEDO_VIEJO.has(traducido.accion)) {
      this.flujo.notificarCambio();
    }
  }

  /** "Otro: lo que escribio", o el motivo solo. */
  private motivoConObservacion(motivo: string): string {
    const nota = this.observacion().trim();
    return nota === '' ? motivo : `${motivo}: ${nota}`;
  }

  /** La atencion es otra pantalla y otra maquina de estados (DP-05): el turno solo lleva hasta ahi. */
  protected iniciarAtencion(): void {
    this.router.navigate(['/atencion', 'turnos', this.turnoId()]).catch(() => undefined);
    this.cerrar.emit();
  }

  protected irA(ruta: readonly (string | number)[]): void {
    this.router.navigate([...ruta]).catch(() => undefined);
    this.cerrar.emit();
  }

  protected rutaDelCaso(): readonly (string | number)[] {
    const turno = this.turno();
    return [
      '/historia-clinica',
      'personas',
      turno?.personaId ?? 0,
      'casos',
      turno?.operativo?.casoId ?? 0,
    ];
  }

  /** Mismos datos, otro horario: paciente, prestacion, caso, plan y profesional no se repreguntan. */
  protected buscarNuevoTurno(): void {
    const turno = this.turno();
    if (turno === null) {
      return;
    }
    this.flujo.nuevoTurno({
      origen: 'TURNO_ANTERIOR',
      personaId: turno.personaId,
      ofertaId: turno.ofertaId,
      profesionalId: turno.profesionalId,
      casoId: turno.operativo?.casoId,
      planId: turno.operativo?.planId,
    });
  }

  protected programarProxima(): void {
    this.buscarNuevoTurno();
  }

  /**
   * Otro turno en el mismo horario, a conciencia (TURNO.md §11): el formulario abre con el horario, el
   * profesional y la prestacion de este, y directo en el paso del sobreturno, que avisa que el lugar
   * esta ocupado y pide motivo. El paciente es otro: no se arrastra.
   */
  protected agregarSobreturno(): void {
    const turno = this.turno();
    if (turno?.inicio === undefined) {
      return;
    }
    this.flujo.nuevoTurno({
      origen: 'AGENDA',
      fecha: diaEnZona(turno.inicio, this.timezone()),
      inicio: turno.inicio,
      profesionalId: turno.profesionalId,
      ofertaId: turno.ofertaId,
      sobreturnoDe: this.turnoId(),
    });
  }

  // -------------------------------------------------------------------------------------
  // Reprogramar
  // -------------------------------------------------------------------------------------

  protected buscarDestino(): void {
    const consultorioId = this.tenant.consultorioId();
    const turno = this.turno();
    if (consultorioId === null || turno?.ofertaId === undefined) {
      return;
    }
    this.buscando.set(true);
    this.errorDeBusqueda.set(null);
    this.pedidoDeDestinos?.unsubscribe();
    this.pedidoDeDestinos = this.api
      .buscarHorarios(consultorioId, {
        ofertaId: turno.ofertaId,
        profesionalId: this.profesionalDestino() ?? undefined,
        desde: this.desdeDestino() === '' ? undefined : this.desdeDestino(),
        limite: this.limite(),
      })
      .subscribe({
        next: (respuesta) => {
          this.buscando.set(false);
          this.zonaDeLaBusqueda.set(respuesta.timezone ?? '');
          this.horarios.set(respuesta.horarios ?? []);
          this.truncado.set(respuesta.truncado === true);
        },
        error: (error: unknown) => {
          this.buscando.set(false);
          this.errorDeBusqueda.set(traducirErrorAgenda(error));
        },
      });
  }

  protected verMasHorarios(): void {
    this.limite.update((actual) => actual + 12);
    this.buscarDestino();
  }

  protected filtrarDesde(valor: string): void {
    this.desdeDestino.set(valor);
    this.volverABuscar();
  }

  protected filtrarProfesional(valor: string): void {
    this.profesionalDestino.set(valor === '' ? null : Number(valor));
    this.volverABuscar();
  }

  /**
   * Quien puede atender a la misma hora: el motor valida el horario del turno sin profesional, sin
   * contar este turno, y devuelve los libres. El del turno se saca: moverlo a si mismo no es mover.
   */
  protected buscarLibresALaHora(): void {
    const consultorioId = this.tenant.consultorioId();
    const turno = this.turno();
    if (consultorioId === null || turno?.ofertaId === undefined || turno.inicio === undefined) {
      return;
    }
    this.buscandoLibres.set(true);
    this.errorDeLibres.set(null);
    this.pedidoDeLibres?.unsubscribe();
    this.pedidoDeLibres = this.api
      .validarHorario(consultorioId, {
        ofertaId: turno.ofertaId,
        inicio: turno.inicio,
        turnoExcluidoId: this.turnoId(),
        personaId: turno.personaId,
      })
      .subscribe({
        next: (validacion) => {
          this.buscandoLibres.set(false);
          this.libresALaHora.set(
            (validacion.profesionales ?? []).filter((p) => p.id !== turno.profesionalId),
          );
        },
        error: (error: unknown) => {
          this.buscandoLibres.set(false);
          this.errorDeLibres.set(traducirErrorAgenda(error));
        },
      });
  }

  /** Elegir otro horario descarta el box que se habia elegido para el anterior. */
  protected elegirDestino(horario: HorarioDisponible | null): void {
    this.destino.set(horario);
    this.boxElegido.set(horario?.espacioId ?? null);
  }

  protected elegirBox(valor: string): void {
    this.boxElegido.set(valor === '' ? null : Number(valor));
  }

  /** Mismo horario, otro profesional: es un destino como cualquiera de la lista. */
  protected elegirLibre(profesional: RecursoLibre): void {
    const turno = this.turno();
    this.elegirDestino({
      desde: turno?.inicio,
      hasta: turno?.fin,
      profesionalId: profesional.id,
      profesionalNombre: profesional.nombre,
    });
  }

  protected esLibreElegido(profesional: RecursoLibre): boolean {
    const destino = this.destino();
    return (
      destino !== null &&
      destino.desde === this.turno()?.inicio &&
      destino.profesionalId === profesional.id
    );
  }

  /** Con otros criterios la lista es otra: lo elegido de la anterior ya no vale. */
  private volverABuscar(): void {
    this.limite.set(12);
    this.elegirDestino(null);
    this.buscarDestino();
  }

  protected reprogramar(): void {
    const consultorioId = this.tenant.consultorioId();
    const expectedVersion = this.turno()?.version;
    const destino = this.destino();
    if (consultorioId === null || expectedVersion === undefined || destino?.desde === undefined) {
      return;
    }
    this.enviando.set(true);
    this.error.set(null);
    this.api
      .reprogramar(consultorioId, this.turnoId(), {
        inicio: destino.desde,
        profesionalId: destino.profesionalId,
        espacioId: this.boxElegido() ?? undefined,
        motivo: this.motivoConObservacion(this.motivoReprogramacion()),
        expectedVersion,
      })
      .subscribe({
        next: () => {
          this.enviando.set(false);
          this.avisos.exito('Turno reprogramado correctamente.');
          this.flujo.notificarCambio();
          this.vista.set('resumen');
          this.leer();
        },
        error: (error: unknown) => {
          this.rechazado(error);
          this.elegirDestino(null);
          this.buscarDestino();
        },
      });
  }

  // -------------------------------------------------------------------------------------
  // Cambiar de sede
  // -------------------------------------------------------------------------------------

  private prepararTraslado(): void {
    this.sedeDestino.set(null);
    this.ofertasDestino.set([]);
    this.ofertaDestino.set(null);
    this.horarios.set([]);
    this.elegirDestino(null);
    this.desdeDestino.set('');
    this.motivoTraslado.set('');
    this.errorDeBusqueda.set(null);
    if (this.session.contextos().length === 0) {
      this.session.cargarContextos().subscribe({ error: () => undefined });
    }
  }

  protected elegirSedeDestino(valor: string): void {
    const id = valor === '' ? null : Number(valor);
    this.sedeDestino.set(id);
    this.ofertasDestino.set([]);
    this.ofertaDestino.set(null);
    this.horarios.set([]);
    this.elegirDestino(null);
    this.errorDeBusqueda.set(null);
    if (id === null) {
      return;
    }
    this.api.ofertasAgendables(id).subscribe({
      next: (lista) => {
        this.ofertasDestino.set(lista);
        // La misma prestacion, si la sede de destino la ofrece con ese nombre.
        const igual = lista.find((o) => o.nombreComercial === this.turno()?.ofertaNombre);
        if (igual?.id !== undefined) {
          this.elegirOfertaDestino(String(igual.id));
        }
      },
      error: (error: unknown) => this.errorDeBusqueda.set(traducirErrorAgenda(error)),
    });
  }

  protected elegirOfertaDestino(valor: string): void {
    this.ofertaDestino.set(valor === '' ? null : Number(valor));
    this.limite.set(12);
    this.buscarEnDestino();
  }

  protected filtrarDesdeEnDestino(valor: string): void {
    this.desdeDestino.set(valor);
    this.limite.set(12);
    this.buscarEnDestino();
  }

  protected verMasHorariosEnDestino(): void {
    this.limite.update((actual) => actual + 12);
    this.buscarEnDestino();
  }

  /** La misma busqueda de horarios de reprogramar, contra la sede de destino. */
  protected buscarEnDestino(): void {
    const sede = this.sedeDestino();
    const ofertaId = this.ofertaDestino();
    this.elegirDestino(null);
    this.pedidoDeDestinos?.unsubscribe();
    if (sede === null || ofertaId === null) {
      this.horarios.set([]);
      return;
    }
    this.buscando.set(true);
    this.errorDeBusqueda.set(null);
    this.pedidoDeDestinos = this.api
      .buscarHorarios(sede, {
        ofertaId,
        desde: this.desdeDestino() === '' ? undefined : this.desdeDestino(),
        limite: this.limite(),
      })
      .subscribe({
        next: (respuesta) => {
          this.buscando.set(false);
          this.zonaDeLaBusqueda.set(respuesta.timezone ?? '');
          this.horarios.set(respuesta.horarios ?? []);
          this.truncado.set(respuesta.truncado === true);
        },
        error: (error: unknown) => {
          this.buscando.set(false);
          this.errorDeBusqueda.set(traducirErrorAgenda(error));
        },
      });
  }

  protected readonly puedeTrasladar = computed(
    () =>
      !this.enviando() &&
      this.destino() !== null &&
      this.sedeDestino() !== null &&
      this.ofertaDestino() !== null &&
      this.motivoTraslado().trim() !== '',
  );

  protected trasladar(): void {
    const consultorioId = this.tenant.consultorioId();
    const expectedVersion = this.turno()?.version;
    const destino = this.destino();
    const sede = this.sedeDestino();
    const ofertaId = this.ofertaDestino();
    const motivo = this.motivoTraslado().trim();
    if (
      consultorioId === null ||
      expectedVersion === undefined ||
      destino?.desde === undefined ||
      sede === null ||
      ofertaId === null ||
      motivo === ''
    ) {
      return;
    }
    this.enviando.set(true);
    this.error.set(null);
    this.api
      .trasladar(consultorioId, this.turnoId(), {
        consultorioDestinoId: sede,
        ofertaId,
        inicio: destino.desde,
        profesionalId: destino.profesionalId,
        espacioId: this.boxElegido() ?? undefined,
        motivo,
        expectedVersion,
      })
      .subscribe({
        next: () => {
          this.enviando.set(false);
          const nombre = this.sedesDestino().find((s) => s.consultorioId === sede)?.consultorioName;
          this.avisos.exito(
            `Turno trasladado${nombre ? ` a ${nombre}` : ''}. El de esta sede quedó cancelado.`,
          );
          this.flujo.notificarCambio();
          this.vista.set('resumen');
          this.leer();
        },
        error: (error: unknown) => {
          this.rechazado(error);
          this.buscarEnDestino();
        },
      });
  }

  // -------------------------------------------------------------------------------------
  // Cancelar
  // -------------------------------------------------------------------------------------

  protected cancelar(): void {
    const consultorioId = this.tenant.consultorioId();
    const expectedVersion = this.turno()?.version;
    if (consultorioId === null || expectedVersion === undefined) {
      return;
    }
    this.enviando.set(true);
    this.error.set(null);
    this.api
      .cancelar(consultorioId, this.turnoId(), {
        motivo: this.motivoConObservacion(this.motivoCancelacion()),
        origen: this.origenCancelacion() as CancelarTurnoOrigenEnum,
        expectedVersion,
      })
      .subscribe({
        next: () => {
          this.enviando.set(false);
          this.flujo.notificarCambio();
          this.avisarCancelacion(consultorioId);
          this.vista.set('resumen');
          this.leer();
        },
        error: (error: unknown) => this.rechazado(error),
      });
  }

  /** El lugar se libero: quien lo esperaba tiene que aparecer ahora (TURNO - Tecnico §32). */
  private avisarCancelacion(consultorioId: number): void {
    this.api.coincidenciasEnEspera(consultorioId, { turnoId: this.turnoId() }).subscribe({
      next: (coincidencias) => {
        if (coincidencias.length === 0) {
          this.avisos.exito('Turno cancelado.');
          return;
        }
        this.avisos.info(
          coincidencias.length === 1
            ? 'Turno cancelado. Un paciente en lista de espera es compatible con este horario.'
            : `Turno cancelado. ${coincidencias.length} pacientes en lista de espera son compatibles con este horario.`,
          {
            duracion: null,
            accion: {
              etiqueta: 'Ver lista de espera',
              ejecutar: () => {
                this.flujo.cerrar();
                this.router
                  .navigate(['/agenda', 'lista-de-espera'], {
                    queryParams: { turno: this.turnoId() },
                  })
                  .catch(() => undefined);
              },
            },
          },
        );
      },
      error: () => this.avisos.exito('Turno cancelado.'),
    });
  }

  // -------------------------------------------------------------------------------------
  // Ausente
  // -------------------------------------------------------------------------------------

  protected marcarAusente(): void {
    const consultorioId = this.tenant.consultorioId();
    const turno = this.turno();
    const expectedVersion = turno?.version;
    if (consultorioId === null || expectedVersion === undefined) {
      return;
    }
    this.enviando.set(true);
    this.error.set(null);
    this.api
      .registrarAusencia(consultorioId, this.turnoId(), {
        motivo: this.observacion().trim(),
        consumeSesionDelPlan: turno?.operativo?.planId ? this.consumeSesion() : undefined,
        expectedVersion,
      })
      .subscribe({
        next: () => {
          this.enviando.set(false);
          this.avisos.exito('Ausencia registrada.', {
            accion: { etiqueta: 'Buscar nuevo turno', ejecutar: () => this.buscarNuevoTurno() },
          });
          this.flujo.notificarCambio();
          this.vista.set('resumen');
          this.leer();
        },
        error: (error: unknown) => this.rechazado(error),
      });
  }
}
