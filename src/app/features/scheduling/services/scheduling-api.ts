import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Agenda } from '../../../api/generated/model/agenda';
import { AgendaService } from '../../../api/generated/api/agenda.service';
import { HabilitacionesResponse } from '../../../api/generated/model/habilitaciones-response';
import { OfertaResponse } from '../../../api/generated/model/oferta-response';
import { PersonaPageResponse } from '../../../api/generated/model/persona-page-response';
import { PersonasService } from '../../../api/generated/api/personas.service';
import { ServiciosYOfertasService } from '../../../api/generated/api/servicios-y-ofertas.service';
import { Turno } from '../../../api/generated/model/turno';
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
 * <h2>Lo que esta fachada NO tiene</h2>
 *
 * <p><b>No hay cancelar ni reprogramar.</b> No es una omision: no existen en el contrato porque
 * AKINE-05.03 quedo fuera de alcance por DP-10. Un boton sin endpoint es peor que la ausencia del
 * boton, porque promete algo que despues es un 404.
 *
 * <p>Tampoco traduce errores —eso es `models/agenda-errors.ts`— ni guarda estado.
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

  /** Confirma la reserva. Es idempotente: confirmar dos veces devuelve 200 sin cambiar nada. */
  confirmar(consultorioId: number, turnoId: number): Observable<Turno> {
    return this.turnos.confirmar({ consultorioId, turnoId });
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
