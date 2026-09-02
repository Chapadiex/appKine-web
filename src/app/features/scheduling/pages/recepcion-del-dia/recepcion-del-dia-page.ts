import { Location } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';

import { PERMISO_TURNO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Turno } from '../../../../api/generated/model/turno';
import { TurnoDelDia, TurnoDelDiaEstadoEnum } from '../../../../api/generated/model/turno-del-dia';
import { SchedulingApi } from '../../services/scheduling-api';
import { ErrorAgenda, traducirErrorRecepcion } from '../../models/agenda-errors';
import { fechaEnPalabras, horaEnZona, hoy } from '../../models/etiquetas-de-agenda';
import { textoDeEstado } from '../../models/etiquetas-de-turno';

/** La ruta que monta esta pantalla. Se reescribe la fecha sobre ella sin navegar. */
const RUTA = '/agenda/recepcion';

/**
 * Recepcion del dia: quien viene hoy y quien ya llego (M13, AKINE-05.04, RF-M13-001/002).
 *
 * <h2>1. Esta pantalla es del MOSTRADOR, no de la atencion</h2>
 *
 * <p>Es la distincion que DP-05 protege y la que esta pantalla no puede borrar con un rotulo
 * perezoso. <b>`EN_ESPERA` significa que el paciente llego y aguarda</b>: no significa que lo
 * esten atendiendo, y entre llegar y ser atendido todavia puede irse. La prestacion la registra la
 * Sesion, que es otra pantalla, otra maquina de estados y otro rol. Por eso todos los textos de
 * aca hablan de <b>llegada</b> y ninguno de atencion, y por eso la unica mencion a la atencion
 * clinica es un enlace que sale de esta pantalla.
 *
 * <p>Corolario que tambien se respeta: <b>no se muestra ningun dato clinico</b>. La respuesta no
 * lo trae —`TurnoDelDia` es PHI minima a proposito— y esta pantalla no lo va a buscar a ningun
 * lado. Nombre, documento, oferta, hora y estado alcanzan para atender el mostrador.
 *
 * <h2>2. Los cancelados se muestran, y esa es media pantalla</h2>
 *
 * <p>El backend los devuelve <b>a proposito</b>, con su `motivoCancelacion`. Filtrarlos seria
 * facil y estaria mal: el caso que esta pantalla existe para resolver es el paciente que se
 * presenta a un turno que se cancelo, y una lista que lo esconda deja a la recepcion sin nada que
 * decirle. Se muestran <b>distinguidos</b> —fila atenuada, marca de estado, el motivo debajo— y
 * <b>sin acciones de llegada</b>, que es lo que el backend tambien rechazaria.
 *
 * <h2>3. Marcar y deshacer NO son simetricos</h2>
 *
 * <ul>
 *   <li><b>Marcar la llegada es idempotente.</b> El doble click en el mostrador es el caso normal
 *       y el servidor devuelve 200 sin mover la hora. La pantalla no lo castiga: el boton se
 *       deshabilita mientras el pedido esta en vuelo —para no mandar dos veces lo mismo, no para
 *       impedir un error— y si igual se colara, no pasa nada.</li>
 *   <li><b>Deshacer no lo es.</b> Deshacer lo ya deshecho responde 409, y ese 409 se muestra
 *       explicando la asimetria, no como "error inesperado" (ver `traducirErrorRecepcion`).</li>
 * </ul>
 *
 * <h2>4. Por que un 409 recarga UNA fila y no el dia entero</h2>
 *
 * <p>Un 409 aca significa que otra persona toco ese turno. Releer el dia completo le mueve la
 * lista bajo el dedo a alguien que esta atendiendo a un paciente, asi que la pantalla usa
 * `verTurno` para corregir <b>esa fila sola</b>: la fila se acomoda, el resto no se mueve y el
 * mensaje explica que paso. El boton de recargar el dia entero sigue estando, para cuando el
 * problema no es de una fila.
 *
 * <h2>5. La zona horaria viene en la respuesta, y hay que usar esa</h2>
 *
 * <p>Los instantes vienen en UTC y las horas del mostrador son locales de la sede. Formatear con
 * la zona del navegador de quien mira <b>correria la agenda entera sin fallar</b>, que es la peor
 * falla posible en esta pantalla: no hay error que ver, solo horas equivocadas.
 *
 * <p>Desde el contrato 0.24.0 la zona viaja en el cuerpo de la respuesta del dia. La primera
 * version de esta pantalla tuvo que deducirla con una segunda lectura sobre la agenda de la oferta
 * del primer turno —fragil, porque un dia vacio no tiene primer turno— y eso motivo el arreglo del
 * backend. Si aun asi llegara vacia, la pantalla <b>rotula UTC</b> en vez de mentir.
 */
@Component({
  selector: 'app-recepcion-del-dia-page',
  imports: [RouterLink],
  templateUrl: './recepcion-del-dia-page.html',
  styleUrl: '../../agenda.css',
})
export class RecepcionDelDiaPage {
  private readonly api = inject(SchedulingApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);
  private readonly location = inject(Location);

  /** De la query. Sin ella, hoy: la recepcion abre el dia que esta atendiendo. */
  readonly fecha = input<string>('');

  protected readonly fechaEnPalabras = fechaEnPalabras;
  protected readonly textoDeEstado = textoDeEstado;

  /** Dia que se muestra. Vive en un signal aparte del input: el selector lo mueve sin navegar. */
  protected readonly dia = signal(hoy());

  protected readonly turnos = signal<readonly TurnoDelDia[]>([]);
  protected readonly cargando = signal(false);
  protected readonly error = signal<ErrorAgenda | null>(null);
  protected readonly exito = signal<string | null>(null);

  /** Id del turno con un pedido en vuelo, o `null`. Es por fila: el resto sigue operable. */
  protected readonly enVuelo = signal<number | null>(null);

  /** Zona de la sede. Vacia cuando no se pudo averiguar; ver el punto 5 del encabezado. */
  protected readonly timezone = signal('');
  protected readonly zonaConocida = computed(() => this.timezone() !== '');

  protected readonly puedeOperar = computed(() => this.permisos.tiene(PERMISO_TURNO_MANAGE));
  protected readonly hayTurnos = computed(() => this.turnos().length > 0);

  /** Cuantos ya estan esperando. Es el numero que el mostrador mira sin leer la tabla. */
  protected readonly enEspera = computed(
    () => this.turnos().filter((t) => t.estado === TurnoDelDiaEstadoEnum.EN_ESPERA).length,
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
    // `replaceState` y no una navegacion: no hay pantalla nueva que apilar en el historial, y
    // navegar volveria a disparar el efecto que reinicia todo. Lo que se gana es que un refresh
    // —o un enlace copiado— siga abriendo el mismo dia.
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
        // La zona viene en el cuerpo desde 0.24.0. Se aplica aunque el dia este vacio: es un
        // dato de la sede y el rotulo tiene que decir la verdad igual.
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
  // Llegada
  // -------------------------------------------------------------------------------------

  /**
   * Marca que el paciente llego. Idempotente: ver el punto 3 del encabezado.
   *
   * <p>El texto de exito dice lo que `EN_ESPERA` <b>no</b> significa. Es lo unico que impide que
   * la recepcion lea "en espera" como "lo estan atendiendo".
   */
  protected marcarLlegada(turno: TurnoDelDia): void {
    const consultorioId = this.tenantContext.consultorioId();
    const turnoId = turno.id;
    if (consultorioId === null || turnoId === undefined) {
      return;
    }
    this.ejecutar(
      turnoId,
      this.api.registrarLlegada(consultorioId, turnoId),
      `Llegada registrada para ${turno.personaNombre ?? 'el paciente'}. Queda en espera: llego y ` +
        'aguarda. La atencion se registra desde la pantalla clinica.',
    );
  }

  /** Revierte un check-in puesto sobre el turno equivocado. <b>No</b> es idempotente. */
  protected deshacerLlegada(turno: TurnoDelDia): void {
    const consultorioId = this.tenantContext.consultorioId();
    const turnoId = turno.id;
    if (consultorioId === null || turnoId === undefined) {
      return;
    }
    this.ejecutar(
      turnoId,
      this.api.deshacerLlegada(consultorioId, turnoId),
      'Llegada deshecha. El turno volvio al estado que tenia y se borro la hora de llegada: no ' +
        'quedo una llegada, quedo un error corregido. El cambio si queda en el historial.',
    );
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

  protected horaDeLlegada(turno: TurnoDelDia): string {
    return horaEnZona(turno.llegadaEn, this.timezone());
  }

  protected cancelado(turno: TurnoDelDia): boolean {
    return turno.estado === TurnoDelDiaEstadoEnum.CANCELADO;
  }

  protected esperando(turno: TurnoDelDia): boolean {
    return turno.estado === TurnoDelDiaEstadoEnum.EN_ESPERA;
  }

  /**
   * `true` cuando el turno todavia admite un check-in.
   *
   * <p>Se pregunta por los dos estados que lo admiten y no por los que no: un estado que el
   * contrato sume manana no va a aparecer con un boton que el backend rechaza.
   */
  protected admiteLlegada(turno: TurnoDelDia): boolean {
    return (
      turno.estado === TurnoDelDiaEstadoEnum.RESERVADO ||
      turno.estado === TurnoDelDiaEstadoEnum.CONFIRMADO
    );
  }

  /** Query del enlace al ciclo del turno: sin la version, esa pantalla no puede operar. */
  protected queryDelTurno(turno: TurnoDelDia): Record<string, string | number> {
    return { version: turno.version ?? 0, ofertaId: turno.ofertaId ?? 0, fecha: this.dia() };
  }

  // -------------------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------------------

  private reiniciar(): void {
    this.turnos.set([]);
    this.error.set(null);
    this.exito.set(null);
    this.enVuelo.set(null);
    this.timezone.set('');
  }

  /**
   * Corre una operacion de llegada y deja la fila consistente con lo que devolvio.
   *
   * <p>La respuesta es un {@link Turno} y no un {@link TurnoDelDia}: trae el estado, la hora de
   * llegada y la version nuevos, pero <b>no</b> el nombre, el documento ni la oferta, que la fila
   * ya tiene resueltos. Por eso se fusiona en vez de reemplazar, y por eso el reemplazo es de
   * <b>objetos nuevos</b> —mutar la fila en su lugar no re-renderiza nada bajo `OnPush`—.
   */
  private ejecutar(turnoId: number, peticion: Observable<Turno>, mensaje: string): void {
    this.enVuelo.set(turnoId);
    this.error.set(null);
    this.exito.set(null);
    peticion.subscribe({
      next: (turno) => {
        this.enVuelo.set(null);
        this.exito.set(mensaje);
        this.fusionar(turnoId, {
          estado: turno.estado as TurnoDelDiaEstadoEnum | undefined,
          llegadaEn: turno.llegadaEn,
          motivoCancelacion: turno.motivoCancelacion,
          version: turno.version,
        });
      },
      error: (error: unknown) => {
        this.enVuelo.set(null);
        const traducido = traducirErrorRecepcion(error);
        this.error.set(traducido);
        if (traducido.causa === 'turno-transicion-no-permitida') {
          this.refrescarFila(turnoId);
        }
      },
    });
  }

  /**
   * Relee un turno solo y actualiza su fila.
   *
   * <p>Silencioso a proposito: se dispara despues de un error que la pantalla ya explico, y un
   * segundo cartel encima del primero solo taparia el que importa. Si falla, la fila queda como
   * estaba y el boton de recargar el dia sigue disponible.
   */
  private refrescarFila(turnoId: number): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      return;
    }
    this.api.verTurno(consultorioId, turnoId).subscribe({
      next: (turno) => this.fusionar(turnoId, turno),
      error: () => undefined,
    });
  }

  private fusionar(turnoId: number, cambios: Partial<TurnoDelDia>): void {
    this.turnos.update((filas) =>
      filas.map((fila) => (fila.id === turnoId ? { ...fila, ...cambios } : fila)),
    );
  }


}
