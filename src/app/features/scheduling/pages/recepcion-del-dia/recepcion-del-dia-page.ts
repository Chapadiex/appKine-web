import { Location } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';

import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { PERMISO_COBRO_REGISTER, PERMISO_TURNO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { PrepagoDeRecepcionEstadoEnum } from '../../../../api/generated/model/prepago-de-recepcion';
import { Recepcion, RecepcionEstadoEnum } from '../../../../api/generated/model/recepcion';
import { TurnoDelDia, TurnoDelDiaEstadoEnum } from '../../../../api/generated/model/turno-del-dia';
import { SchedulingApi } from '../../services/scheduling-api';
import { CausaAgenda, ErrorAgenda, traducirErrorRecepcion } from '../../models/agenda-errors';
import { fechaEnPalabras, horaEnZona, hoy } from '../../models/etiquetas-de-agenda';
import { textoDeEstado } from '../../models/etiquetas-de-turno';
import {
  recepcionAbierta,
  textoDeModalidad,
  textoDePrepago,
  textoDeRecepcion,
} from '../../models/etiquetas-de-recepcion';

/** La ruta que monta esta pantalla. Se reescribe la fecha sobre ella sin navegar. */
const RUTA = '/agenda/recepcion';

/** Las dos transiciones que piden un motivo antes de mandarse. */
type TipoDePanel = 'particular' | 'anular';

/** Errores tras los que la fila que se ve quedo vieja y conviene releerla sola. */
const CAUSAS_QUE_RELEEN: ReadonlySet<CausaAgenda> = new Set<CausaAgenda>([
  'turno-transicion-no-permitida',
  'recepcion-transicion-no-permitida',
  'conflicto',
  'no-encontrado',
]);

/**
 * Recepcion del dia: quien viene hoy, quien llego y en que punto del mostrador esta (M13,
 * AKINE-05.04 y E-4, RF-M13-001 a 005).
 *
 * <h2>1. Esta pantalla es del MOSTRADOR, no de la atencion</h2>
 *
 * <p>DP-05 separa Turno, Recepcion y Sesion, y desde DP-16 (contrato 0.63.0) <b>la Recepcion tiene
 * maquina propia</b>: `LLEGO → VALIDADA | OBSERVADA → EN_ESPERA → LLAMADA`, con `ANULADA` para un
 * check-in por error y `CERRADA` cuando el turno se cancela con la persona presente. El turno
 * vuelve a ser solo la reserva y <b>esta pantalla ya no mira `EN_ESPERA` en el turno</b>: el
 * servidor dejo de emitirlo, y todo lo que dice la columna "Recepcion" sale de
 * `TurnoDelDia.recepcion`.
 *
 * <p>Ningun estado de recepcion prueba que la atencion ocurrio. `LLAMADA` no es "atendido": la
 * prestacion la registra la Sesion, que es otra pantalla. Y no se muestra ningun dato clinico:
 * `TurnoDelDia` es PHI minima a proposito.
 *
 * <h2>2. Los cancelados se muestran, y esa es media pantalla</h2>
 *
 * <p>El backend los devuelve <b>a proposito</b>, con su `motivoCancelacion`: el caso que esta
 * pantalla existe para resolver es el paciente que se presenta a un turno cancelado. Se muestran
 * distinguidos y <b>sin acciones</b>.
 *
 * <h2>3. Registrar y anular NO son simetricos</h2>
 *
 * <ul>
 *   <li><b>Registrar la llegada es idempotente.</b> El doble click del mostrador es el caso normal
 *       y el servidor devuelve la misma recepcion sin mover la hora.</li>
 *   <li><b>Anular no lo es</b>, ni llamar, ni pasar a espera: llevan la `version` de la
 *       recepcion, y si otro puesto la movio el servidor rechaza con 409. Ese 409 se explica (ver
 *       `traducirErrorRecepcion`) y la fila se relee sola.</li>
 * </ul>
 *
 * <h2>4. Validar no es un error aunque observe</h2>
 *
 * <p>El servidor decide si la recepcion queda `VALIDADA` u `OBSERVADA` (RF-M13-003/004). Una
 * observacion responde 200 y <b>no bloquea</b> (RN-M13-003): la pantalla la muestra en la fila y
 * sigue ofreciendo pasar a espera y continuar como Particular, que pide motivo obligatorio
 * (RF-M13-005).
 *
 * <h2>5. Por que un 409 recarga UNA fila y no el dia entero</h2>
 *
 * <p>Releer el dia completo le mueve la lista bajo el dedo a quien esta atendiendo a alguien, asi
 * que la pantalla usa `verTurno` para corregir esa fila sola. Lo mismo despues de registrar una
 * llegada: el check-in avanza la `version` del <b>turno</b> aunque no cambie su estado, y el
 * enlace al ciclo del turno la necesita vigente.
 *
 * <h2>6. La zona horaria viene en la respuesta, y hay que usar esa</h2>
 *
 * <p>Los instantes vienen en UTC y las horas del mostrador son locales de la sede. Si la zona
 * llegara vacia, la pantalla <b>rotula UTC</b> en vez de mentir con la del navegador.
 *
 * <h2>7. El prepago avisa, no bloquea (E-6, DP-06 / ADR-0013)</h2>
 *
 * <p>`Recepcion.prepago` lo calcula el servidor al leer. `PENDIENTE` se muestra como alerta con el
 * precio sugerido y ofrece "Registrar prepago", que lleva al registro de cobro de `billing` en modo
 * anticipo atado al turno. Ninguna transicion de esta pantalla mira el prepago: pasar a espera con
 * el prepago pendiente se permite y el servidor deja constancia.
 */
@Component({
  selector: 'app-recepcion-del-dia-page',
  imports: [RouterLink, ConfirmacionConMotivo],
  templateUrl: './recepcion-del-dia-page.html',
  styleUrl: '../../agenda.css',
})
export class RecepcionDelDiaPage {
  private readonly api = inject(SchedulingApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);
  private readonly location = inject(Location);

  /**
   * De la query. Sin ella, hoy: la recepcion abre el dia que esta atendiendo.
   *
   * <p>El `transform` no es decorativo: con `withComponentInputBinding`, un query param AUSENTE
   * llega como `undefined` y no como el default. Sin normalizarlo, entrar desde el enlace de la
   * agenda —que no lleva `?fecha=`— dejaba la pantalla en blanco. Lo destapo el E2E contra el
   * backend real (AKINE E-2).
   */
  readonly fecha = input('', { transform: (valor: string | undefined) => valor ?? '' });

  protected readonly fechaEnPalabras = fechaEnPalabras;
  protected readonly textoDeEstado = textoDeEstado;
  protected readonly textoDeRecepcion = textoDeRecepcion;
  protected readonly textoDeModalidad = textoDeModalidad;
  protected readonly textoDePrepago = textoDePrepago;

  /** Dia que se muestra. Vive en un signal aparte del input: el selector lo mueve sin navegar. */
  protected readonly dia = signal(hoy());

  protected readonly turnos = signal<readonly TurnoDelDia[]>([]);
  protected readonly cargando = signal(false);
  protected readonly error = signal<ErrorAgenda | null>(null);
  protected readonly exito = signal<string | null>(null);

  /** Id del turno con un pedido en vuelo, o `null`. Es por fila: el resto sigue operable. */
  protected readonly enVuelo = signal<number | null>(null);

  /** Panel de motivo abierto (Particular o anulacion), o `null`. Uno a la vez. */
  protected readonly panel = signal<{
    readonly turno: TurnoDelDia;
    readonly tipo: TipoDePanel;
  } | null>(null);

  /** Zona de la sede. Vacia cuando no se pudo averiguar; ver el punto 6 del encabezado. */
  protected readonly timezone = signal('');
  protected readonly zonaConocida = computed(() => this.timezone() !== '');

  protected readonly puedeOperar = computed(() => this.permisos.tiene(PERMISO_TURNO_MANAGE));
  protected readonly puedeCobrar = computed(() => this.permisos.tiene(PERMISO_COBRO_REGISTER));
  protected readonly hayTurnos = computed(() => this.turnos().length > 0);

  /** Cuantos estan en la sala de espera. Es el numero que el mostrador mira sin leer la tabla. */
  protected readonly enEspera = computed(
    () => this.turnos().filter((t) => t.recepcion?.estado === RecepcionEstadoEnum.EN_ESPERA).length,
  );

  constructor() {
    effect(() => {
      // Cambiar de sede convierte esta lista en la de otra sede: se vacia antes de pedir la nueva,
      // porque dejarla en pantalla mostraria pacientes de otro tenant mientras carga.
      const deLaUrl = this.fecha();
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.dia.set(deLaUrl === '' ? hoy() : deLaUrl);
        this.reiniciar();
        this.cargar();
      });
    });
  }

  // -------------------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------------------

  protected cambiarDia(fecha: string): void {
    if (fecha === '') {
      return;
    }
    this.dia.set(fecha);
    // `replaceState` y no una navegacion: navegar volveria a disparar el efecto que reinicia
    // todo. Lo que se gana es que un refresh —o un enlace copiado— siga abriendo el mismo dia.
    this.location.replaceState(RUTA, `fecha=${fecha}`);
    this.reiniciar();
    this.cargar();
  }

  /** Relee el dia. Es tambien la accion de `recargar-dia`. */
  protected cargar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      return;
    }

    this.cargando.set(true);
    this.api.turnosDelDia(consultorioId, this.dia()).subscribe({
      next: (agenda) => {
        this.turnos.set(agenda.turnos ?? []);
        this.timezone.set(agenda.timezone ?? '');
        this.cargando.set(false);
      },
      error: (error: unknown) => {
        this.cargando.set(false);
        this.error.set(traducirErrorRecepcion(error));
      },
    });
  }

  // -------------------------------------------------------------------------------------
  // Transiciones de la recepcion
  // -------------------------------------------------------------------------------------

  /** Check-in. Idempotente: ver el punto 3 del encabezado. */
  protected marcarLlegada(turno: TurnoDelDia): void {
    this.transicion(
      turno,
      (c, t) => this.api.registrarLlegada(c, t),
      () =>
        `Llegada registrada para ${nombre(turno)}. Falta validar como se atiende; la atencion se ` +
        'registra desde la pantalla clinica.',
      true,
    );
  }

  /** El servidor decide VALIDADA u OBSERVADA. Una observacion no es un error. */
  protected validar(turno: TurnoDelDia): void {
    this.transicion(
      turno,
      (c, t) => this.api.validarRecepcion(c, t, { expectedVersion: versionDe(turno) }),
      (recepcion) =>
        recepcion.estado === RecepcionEstadoEnum.OBSERVADA
          ? `La validacion de ${nombre(turno)} quedo observada. No impide pasar a espera; ` +
            'tambien se puede continuar como Particular.'
          : `Recepcion de ${nombre(turno)} validada: ya se sabe como se atiende.`,
    );
  }

  protected pasarAEspera(turno: TurnoDelDia): void {
    this.transicion(
      turno,
      (c, t) => this.api.pasarAEspera(c, t, versionDe(turno)),
      () =>
        `${nombre(turno)} paso a la sala de espera: aguarda ser llamado.` +
        // El prepago pendiente avisa y no bloquea (DP-06): el servidor deja constancia en el evento.
        (this.prepagoPendiente(turno)
          ? ' Paso sin el prepago que exige la prestacion; quedo registrado en la recepcion.'
          : ''),
    );
  }

  protected llamar(turno: TurnoDelDia): void {
    this.transicion(
      turno,
      (c, t) => this.api.llamar(c, t, versionDe(turno)),
      () =>
        `${nombre(turno)} fue llamado. Llamar no registra la atencion: eso lo hace la Sesion, ` +
        'desde la pantalla clinica.',
    );
  }

  protected abrirPanel(turno: TurnoDelDia, tipo: TipoDePanel): void {
    this.panel.set({ turno, tipo });
  }

  protected cerrarPanel(): void {
    this.panel.set(null);
  }

  /**
   * Manda la transicion del panel abierto.
   *
   * <p>El motivo de Particular es obligatorio y el de anulacion no. La validacion la hace
   * `ConfirmacionConMotivo` (`motivoObligatorio`), que ya sabe senalar el campo y mover el foco.
   */
  protected confirmarPanel(motivo: string): void {
    const abierto = this.panel();
    if (abierto === null) {
      return;
    }
    const { turno, tipo } = abierto;

    if (tipo === 'particular') {
      this.transicion(
        turno,
        (c, t) =>
          this.api.atenderComoParticular(c, t, { expectedVersion: versionDe(turno), motivo }),
        () => `${nombre(turno)} se atiende como Particular. La cobertura de su ficha no cambio.`,
      );
    } else {
      this.transicion(
        turno,
        (c, t) => this.api.anularRecepcion(c, t, { expectedVersion: versionDe(turno), motivo }),
        () =>
          `Llegada de ${nombre(turno)} anulada: el check-in fue un error y la llegada no vale. ` +
          'Queda en el historial de la recepcion.',
      );
    }
    this.cerrarPanel();
  }

  // -------------------------------------------------------------------------------------
  // Lecturas de presentacion
  // -------------------------------------------------------------------------------------

  /** `09:00 a 09:45` en la zona de la sede. El fin es exclusivo. */
  protected rango(turno: TurnoDelDia): string {
    const desde = horaEnZona(turno.inicio, this.timezone());
    const hasta = horaEnZona(turno.fin, this.timezone());
    return hasta === '' ? desde : `${desde} a ${hasta}`;
  }

  /** La hora REAL de llegada: la de la recepcion vigente. */
  protected horaDeLlegada(turno: TurnoDelDia): string {
    return horaEnZona(turno.recepcion?.llegadaEn ?? turno.llegadaEn, this.timezone());
  }

  protected cancelado(turno: TurnoDelDia): boolean {
    return turno.estado === TurnoDelDiaEstadoEnum.CANCELADO;
  }

  protected abierta(turno: TurnoDelDia): boolean {
    return recepcionAbierta(turno.recepcion);
  }

  protected esperando(turno: TurnoDelDia): boolean {
    return turno.recepcion?.estado === RecepcionEstadoEnum.EN_ESPERA;
  }

  /**
   * `true` cuando el turno todavia admite un check-in: la reserva esta viva y no hay una
   * recepcion abierta. Se pregunta por los estados que lo admiten y no por los que no: un estado
   * que el contrato sume manana no va a aparecer con un boton que el backend rechaza.
   */
  protected admiteLlegada(turno: TurnoDelDia): boolean {
    const reservaViva =
      turno.estado === TurnoDelDiaEstadoEnum.RESERVADO ||
      turno.estado === TurnoDelDiaEstadoEnum.CONFIRMADO;
    return reservaViva && !recepcionAbierta(turno.recepcion);
  }

  protected admiteValidar(turno: TurnoDelDia): boolean {
    return enEstado(turno, RecepcionEstadoEnum.LLEGO, RecepcionEstadoEnum.OBSERVADA);
  }

  protected admiteEspera(turno: TurnoDelDia): boolean {
    return enEstado(turno, RecepcionEstadoEnum.VALIDADA, RecepcionEstadoEnum.OBSERVADA);
  }

  protected admiteLlamar(turno: TurnoDelDia): boolean {
    return enEstado(turno, RecepcionEstadoEnum.EN_ESPERA);
  }

  /** Query del enlace al ciclo del turno: sin la version, esa pantalla no puede operar. */
  protected queryDelTurno(turno: TurnoDelDia): Record<string, string | number> {
    return { version: turno.version ?? 0, ofertaId: turno.ofertaId ?? 0, fecha: this.dia() };
  }

  /**
   * `true` cuando la fila ofrece "Registrar prepago" (E-6): la oferta lo exige, no hay anticipo y
   * el turno sigue siendo una reserva viva, que es lo unico que el backend admite. Si no se cumple
   * igual responde 409 `prepago-no-admitido`; esto solo evita ofrecer lo que va a fallar.
   */
  protected admitePrepago(turno: TurnoDelDia): boolean {
    const reservaViva =
      turno.estado === TurnoDelDiaEstadoEnum.RESERVADO ||
      turno.estado === TurnoDelDiaEstadoEnum.CONFIRMADO;
    return (
      reservaViva &&
      turno.personaId !== undefined &&
      turno.recepcion?.prepago?.estado === PrepagoDeRecepcionEstadoEnum.PENDIENTE
    );
  }

  protected prepagoPendiente(turno: TurnoDelDia): boolean {
    return turno.recepcion?.prepago?.estado === PrepagoDeRecepcionEstadoEnum.PENDIENTE;
  }

  /**
   * Enlace al registro de cobro en modo prepago. Es una URL y no un import: `billing` es otro
   * feature (AGENT.md 4.4). Lleva el turno, el importe sugerido, la moneda y el dia para volver;
   * al volver, esta pantalla relee el dia entero y la fila ya dice REGISTRADO.
   */
  protected rutaDePrepago(turno: TurnoDelDia): readonly (string | number)[] {
    return ['/pacientes', turno.personaId ?? 0, 'cuenta-corriente', 'cobrar'];
  }

  protected queryDePrepago(turno: TurnoDelDia): Record<string, string | number> {
    const prepago = turno.recepcion?.prepago;
    return {
      turnoId: turno.id ?? 0,
      fecha: this.dia(),
      ...(prepago?.importeSugerido === undefined
        ? {}
        : { importeSugerido: prepago.importeSugerido }),
      ...(prepago?.moneda ? { monedaSugerida: prepago.moneda } : {}),
    };
  }

  // -------------------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------------------

  private reiniciar(): void {
    this.turnos.set([]);
    this.error.set(null);
    this.exito.set(null);
    this.enVuelo.set(null);
    this.panel.set(null);
    this.timezone.set('');
  }

  /**
   * Corre una transicion de recepcion y deja la fila consistente con lo que devolvio.
   *
   * <p>La respuesta es la {@link Recepcion} entera: se reemplaza `recepcion` en la fila con un
   * <b>objeto nuevo</b> —mutar en su lugar no re-renderiza nada—. Una recepcion `ANULADA` deja de
   * ser la vigente, asi que la fila vuelve a no tenerla, que es lo que el servidor diria al
   * releer.
   */
  private transicion(
    turno: TurnoDelDia,
    peticion: (consultorioId: number, turnoId: number) => Observable<Recepcion>,
    mensaje: (recepcion: Recepcion) => string,
    releerTurno = false,
  ): void {
    const consultorioId = this.tenantContext.consultorioId();
    const turnoId = turno.id;
    if (consultorioId === null || turnoId === undefined) {
      return;
    }
    this.enVuelo.set(turnoId);
    this.error.set(null);
    this.exito.set(null);
    peticion(consultorioId, turnoId).subscribe({
      next: (recepcion) => {
        this.enVuelo.set(null);
        this.exito.set(mensaje(recepcion));
        const vigente = recepcion.estado === RecepcionEstadoEnum.ANULADA ? undefined : recepcion;
        this.fusionar(turnoId, { recepcion: vigente, llegadaEn: vigente?.llegadaEn });
        if (releerTurno) {
          this.refrescarFila(turnoId);
        }
      },
      error: (error: unknown) => {
        this.enVuelo.set(null);
        const traducido = traducirErrorRecepcion(error);
        this.error.set(traducido);
        if (CAUSAS_QUE_RELEEN.has(traducido.causa)) {
          this.refrescarFila(turnoId);
        }
      },
    });
  }

  /**
   * Relee un turno solo y actualiza su fila.
   *
   * <p>Silencioso a proposito: se dispara despues de algo que la pantalla ya explico. Si falla, la
   * fila queda como estaba y el boton de recargar el dia sigue disponible.
   */
  private refrescarFila(turnoId: number): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      return;
    }
    this.api.verTurno(consultorioId, turnoId).subscribe({
      // Reemplazo y no fusion para `recepcion`: si el servidor ya no la trae, la fila no la tiene.
      next: (leido) =>
        this.fusionar(turnoId, {
          ...leido,
          recepcion: leido.recepcion,
          llegadaEn: leido.llegadaEn,
        }),
      error: () => undefined,
    });
  }

  private fusionar(turnoId: number, cambios: Partial<TurnoDelDia>): void {
    this.turnos.update((filas) =>
      filas.map((fila) => (fila.id === turnoId ? { ...fila, ...cambios } : fila)),
    );
  }
}

function nombre(turno: TurnoDelDia): string {
  return turno.personaNombre ?? 'el paciente';
}

/** Version de la RECEPCION, no del turno: son dos controles optimistas distintos. */
function versionDe(turno: TurnoDelDia): number {
  return turno.recepcion?.version ?? 0;
}

function enEstado(turno: TurnoDelDia, ...estados: readonly RecepcionEstadoEnum[]): boolean {
  const actual = turno.recepcion?.estado;
  return actual !== undefined && estados.includes(actual);
}
