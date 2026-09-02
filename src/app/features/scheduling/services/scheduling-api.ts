import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Agenda } from '../../../api/generated/model/agenda';
import { AgendaService } from '../../../api/generated/api/agenda.service';
import { EventoDeTurno } from '../../../api/generated/model/evento-de-turno';
import { HabilitacionesResponse } from '../../../api/generated/model/habilitaciones-response';
import { OfertaResponse } from '../../../api/generated/model/oferta-response';
import { PersonaPageResponse } from '../../../api/generated/model/persona-page-response';
import { PersonasService } from '../../../api/generated/api/personas.service';
import { ServiciosYOfertasService } from '../../../api/generated/api/servicios-y-ofertas.service';
import { Turno } from '../../../api/generated/model/turno';
import { TurnoDelDia } from '../../../api/generated/model/turno-del-dia';
import { TurnosService } from '../../../api/generated/api/turnos.service';

/**
 * Unico punto de la feature `scheduling` que toca el cliente generado (M12, AKINE-05.01 y 05.02).
 *
 * <p>Mismo criterio que `PersonApi` y `OfferingApi`: las pantallas dependen de esta clase y de los
 * tipos del contrato, nunca de los servicios generados directo.
 *
 * <h2>Por que esta fachada habla con cuatro servicios generados y no con uno</h2>
 *
 * <p>La agenda necesita cuatro cosas que viven en tags distintos del contrato: los slots
 * (`Agenda`), la reserva (`Turnos`), que ofertas tiene la sede y quien esta habilitado a
 * prestarlas (`Servicios y ofertas`) y a quien se le reserva (`Personas`).
 *
 * <p><b>No importa `OfferingApi` ni `PersonApi`</b>, y es deliberado: un feature no importa de
 * otro (AGENT.md 4.5). Lo que se comparte es el <b>cliente generado</b>, que es de todos. Dos
 * fachadas llamando al mismo servicio generado no es duplicacion de dominio: es cada feature
 * declarando que parte del contrato consume.
 *
 * <h2>El ciclo de vida del turno (AKINE-05.03)</h2>
 *
 * <p>Las cuatro transiciones y el historial entraron con 05.03. Las tres que mutan estado llevan
 * `expectedVersion`: la version que devolvio la <b>ultima lectura</b> del turno. Si otro operador
 * lo toco entre medio el backend rechaza con 409 en vez de pisarlo, y quien llama tiene que releer
 * —de ahi que todas devuelvan el {@link Turno} entero, con su version nueva—.
 *
 * <h2>La recepcion del dia (M13, AKINE-05.04)</h2>
 *
 * <p>El contrato <b>0.23.0</b> agrego lo que 0.21.0 no tenia: <b>leer turnos</b>.
 * {@link turnosDelDia} lista los de una sede en un dia con el paciente ya resuelto, y
 * {@link verTurno} lee uno solo. Las dos devuelven {@link TurnoDelDia}, que <b>si trae la
 * `version`</b>: la limitacion que `pages/ciclo-de-turno` documenta dejo de existir del lado del
 * contrato, aunque esa pantalla todavia no la aproveche.
 *
 * <p>{@link registrarLlegada} y {@link deshacerLlegada} <b>no son simetricas</b>, y escribirlas
 * como si lo fueran es el error facil: la primera es idempotente y la segunda no. El detalle esta
 * en el javadoc de cada una.
 *
 * <p>Esta fachada no traduce errores —eso es `models/agenda-errors.ts`— ni guarda estado.
 */
@Injectable({ providedIn: 'root' })
export class SchedulingApi {
  private readonly agenda = inject(AgendaService);
  private readonly turnos = inject(TurnosService);
  private readonly ofertas = inject(ServiciosYOfertasService);
  private readonly personas = inject(PersonasService);

  /**
   * Slots de una oferta entre dos fechas locales de la sede.
   *
   * <p>`hasta` es <b>exclusivo</b> y la ventana no puede pasar de 62 dias: pedir mas devuelve 400
   * `ventana-demasiado-amplia` con `maxDays`, que la pantalla usa para recortar sola.
   *
   * <p>Un slot devuelto <b>no es una reserva</b>. Entre esta lectura y la escritura puede entrar
   * otro: la exclusion real la hace {@link reservar}.
   */
  buscarAgenda(
    consultorioId: number,
    ofertaId: number,
    ventana: { readonly desde: string; readonly hasta: string; readonly profesionalId?: number },
  ): Observable<Agenda> {
    return this.agenda.buscar({
      consultorioId,
      ofertaId,
      desde: ventana.desde,
      hasta: ventana.hasta,
      profesionalId: ventana.profesionalId,
    });
  }

  /**
   * Toma un slot.
   *
   * <p>`idempotencyKey` es lo que hace que el doble click no cree dos turnos: el mismo intento
   * reintentado devuelve <b>200 con el turno ya creado</b> en vez de un segundo 201. Reusarla con
   * otro contenido es 409 `idempotency-key-conflict`, que es un bug del cliente y no del usuario.
   *
   * <p>El servidor revalida todo y elige el espacio: pedirlo desde aca seria una promesa que dos
   * busquedas concurrentes rompen.
   */
  reservar(
    consultorioId: number,
    ofertaId: number,
    cuerpo: {
      readonly inicio: string;
      readonly personaId: number;
      readonly profesionalId?: number;
      readonly idempotencyKey: string;
    },
  ): Observable<Turno> {
    return this.turnos.reservar({
      consultorioId,
      ofertaId,
      reservarTurno: {
        inicio: cuerpo.inicio,
        personaId: cuerpo.personaId,
        profesionalId: cuerpo.profesionalId,
        idempotencyKey: cuerpo.idempotencyKey,
      },
    });
  }

  /**
   * Confirma la reserva. Es idempotente: confirmar dos veces devuelve 200 sin cambiar nada.
   *
   * <p><b>Es la unica transicion sin `expectedVersion`</b>, y por eso es tambien la unica que se
   * puede ofrecer cuando la pantalla no conoce la version del turno. Confirmar es un estado de la
   * RESERVA: no dice nada del cobro ni de que el paciente haya llegado.
   */
  confirmar(consultorioId: number, turnoId: number): Observable<Turno> {
    return this.turnos.confirmar({ consultorioId, turnoId });
  }

  /**
   * Cancela un turno futuro. <b>Libera el lugar</b> y no borra nada (RN-M12-002).
   *
   * <p>El motivo es <b>obligatorio</b> (DP-04) y la version tambien. No es idempotente: entre dos
   * cancelaciones el lugar pudo haber sido tomado por otro paciente, asi que la segunda no
   * contesta 200 en silencio.
   */
  cancelar(
    consultorioId: number,
    turnoId: number,
    cuerpo: { readonly motivo: string; readonly expectedVersion: number },
  ): Observable<Turno> {
    return this.turnos.cancelar({
      consultorioId,
      turnoId,
      cancelarTurno: { motivo: cuerpo.motivo, expectedVersion: cuerpo.expectedVersion },
    });
  }

  /**
   * Mueve el turno a otro horario. <b>Es el mismo turno</b>: conserva id, paciente e historial.
   *
   * <p>No cancela uno y crea otro, entre otras cosas porque la Sesion de M14 cuelga del `turnoId`
   * y ese vinculo se cortaria. `inicio` tiene que ser un instante que <b>devolvio la agenda</b>:
   * el servidor revalida el destino entero bajo el mismo lock de sede que usa una reserva.
   *
   * <p>`profesionalId` puede ser <b>otro</b>: mover el turno porque el profesional se ausento es
   * el caso mas frecuente. Un turno confirmado vuelve a `RESERVADO`.
   */
  reprogramar(
    consultorioId: number,
    turnoId: number,
    cuerpo: {
      readonly inicio: string;
      readonly motivo: string;
      readonly expectedVersion: number;
      readonly profesionalId?: number;
    },
  ): Observable<Turno> {
    return this.turnos.reprogramar({
      consultorioId,
      turnoId,
      reprogramarTurno: {
        inicio: cuerpo.inicio,
        motivo: cuerpo.motivo,
        expectedVersion: cuerpo.expectedVersion,
        profesionalId: cuerpo.profesionalId,
      },
    });
  }

  /**
   * Registra que el paciente no vino. <b>NO libera el lugar</b>: la hora se consumio igual.
   *
   * <p>Es la diferencia con cancelar, y es la razon por la que son dos operaciones distintas.
   * Solo se registra <b>despues</b> de la hora del turno: una ausencia anticipada es una
   * cancelacion.
   *
   * <p><b>El motivo es opcional aca</b> —el contrato solo exige `expectedVersion`—, asi que el
   * panel que la confirma tiene que declararlo opcional o el boton no hace nada.
   */
  registrarAusencia(
    consultorioId: number,
    turnoId: number,
    cuerpo: { readonly expectedVersion: number; readonly motivo?: string },
  ): Observable<Turno> {
    return this.turnos.registrarAusencia({
      consultorioId,
      turnoId,
      registrarAusencia: {
        expectedVersion: cuerpo.expectedVersion,
        motivo: cuerpo.motivo === '' ? undefined : cuerpo.motivo,
      },
    });
  }

  /**
   * Todas las transiciones del turno, de la mas vieja a la mas nueva (RF-M12-008).
   *
   * <p>Exige `turno:read` y no `turno:manage`: leer quien cancelo y por que es parte de mirar la
   * agenda, no de operarla.
   *
   * <p><b>Es lo unico que se puede leer de un turno existente</b>, y <b>no trae la version</b>.
   */
  historial(consultorioId: number, turnoId: number): Observable<readonly EventoDeTurno[]> {
    return this.turnos.historial({ consultorioId, turnoId });
  }

  // -------------------------------------------------------------------------------------
  // Recepcion del dia (M13, AKINE-05.04)
  // -------------------------------------------------------------------------------------

  /**
   * Los turnos de la sede en un dia, del mas temprano al mas tarde (RF-M13-001).
   *
   * <p><b>Incluye los cancelados, con su motivo, y no hay que filtrarlos.</b> Es una decision
   * deliberada del backend y la razon por la que la respuesta trae `motivoCancelacion`: alguien
   * se presenta en el mostrador a un turno que se cancelo, y una lista que lo esconda deja a la
   * recepcion sin nada que decirle.
   *
   * <p>Cada fila llega con `personaNombre`, `documento` y `ofertaNombre` <b>ya resueltos</b>: no
   * hay ninguna consulta por fila que hacer. Y no trae <b>ningun dato clinico</b>, que tampoco hay
   * que ir a buscar a otro lado: la recepcion no es la pantalla de la atencion (DP-05).
   *
   * <p>`fecha` es la fecha <b>local de la sede</b> (`YYYY-MM-DD`); los instantes que vuelven son
   * UTC. Exige `turno:read` y no `turno:manage`: mirar quien viene hoy es leer la agenda.
   */
  turnosDelDia(consultorioId: number, fecha: string): Observable<readonly TurnoDelDia[]> {
    return this.turnos.delDia({ consultorioId, fecha });
  }

  /**
   * Un turno solo, con la misma forma que una fila del dia.
   *
   * <p>La pantalla lo usa para <b>corregir una fila sola</b> cuando una operacion choca contra un
   * 409: releer el dia entero por un turno le mueve la lista bajo el dedo a quien esta atendiendo
   * a alguien. Devuelve la `version` vigente, que es lo que destraba el conflicto.
   */
  verTurno(consultorioId: number, turnoId: number): Observable<TurnoDelDia> {
    return this.turnos.verTurno({ consultorioId, turnoId });
  }

  /**
   * Check-in: el paciente llego y queda <b>en espera</b> (RF-M13-002). <b>Sin cuerpo</b> — la hora
   * la pone el servidor, que es lo que la hace la hora REAL de llegada y no la que alguien tipeo.
   *
   * <p><b>Es idempotente</b>: marcar dos veces devuelve 200 sin mover la hora ni registrar un
   * segundo evento. El doble click en el mostrador es el caso normal, no un error, y ni esta
   * fachada ni la pantalla tienen que defenderse de el.
   *
   * <p><b>`EN_ESPERA` no significa que lo esten atendiendo.</b> Significa que llego y aguarda:
   * entre llegar y ser atendido el paciente todavia puede irse. La prestacion la registra la
   * Sesion, que es otra pantalla y otra maquina de estados (DP-05).
   *
   * <p>409 `turno-transicion-no-permitida` si el turno esta cancelado o ya marcado ausente.
   */
  registrarLlegada(consultorioId: number, turnoId: number): Observable<Turno> {
    return this.turnos.registrarLlegada({ consultorioId, turnoId });
  }

  /**
   * Revierte un check-in hecho sobre el turno equivocado. El turno vuelve al estado del que vino
   * y <b>se limpia la hora de llegada</b>: un check-in deshecho no dejo una llegada, dejo un error
   * corregido. El rastro de que ocurrio queda en el historial, que es append-only.
   *
   * <p><b>NO es idempotente, al reves que {@link registrarLlegada}</b>, y la asimetria es
   * deliberada: deshacer lo ya deshecho responde 409. Aca el segundo click no es un doble click
   * sino una operacion sobre un turno que entre medio pudo cambiar de estado —lo pudieron marcar
   * ausente—, y contestar 200 le haria creer al operador que revirtio algo.
   *
   * <p>Por eso ese 409 <b>no se muestra como "error inesperado"</b>: ver `traducirErrorRecepcion`.
   */
  deshacerLlegada(consultorioId: number, turnoId: number): Observable<Turno> {
    return this.turnos.deshacerLlegada({ consultorioId, turnoId });
  }

  /** Ofertas ACTIVAS de la sede: son las unicas que se pueden agendar. */
  ofertasAgendables(consultorioId: number): Observable<readonly OfertaResponse[]> {
    return this.ofertas.listOfertas({ consultorioId, estado: 'ACTIVO' });
  }

  /**
   * Habilitaciones de la oferta. Alimenta el selector de profesional con <b>nombres</b>.
   *
   * <p>Sin esto el filtro pediria un id a mano, que nadie sabe, y el conflicto
   * `recurso-ocupado` no podria ofrecer "elegi otro profesional" con una lista real.
   */
  habilitaciones(consultorioId: number, ofertaId: number): Observable<HabilitacionesResponse> {
    return this.ofertas.getHabilitaciones({ consultorioId, ofertaId });
  }

  /**
   * Busca personas del padron para elegir a quien se le reserva.
   *
   * <p><b>Sin filtrar por perfil de paciente.</b> Podria filtrarse a `CON_PERFIL` y evitar el 409,
   * pero eso esconderia el caso real: la persona esta en el padron, vino a atenderse y todavia no
   * tiene perfil clinico. El backend responde `persona-sin-perfil-paciente` y la pantalla ofrece
   * activarlo, que es la accion que resuelve el problema del mostrador.
   */
  buscarPersonas(texto: string): Observable<PersonaPageResponse> {
    const q = texto.trim();
    return this.personas.buscarPersonas({
      q: q === '' ? undefined : q,
      estado: 'ACTIVO',
      perfil: 'TODOS',
      page: 0,
      size: 10,
    });
  }
}
