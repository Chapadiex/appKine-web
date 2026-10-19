import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, switchMap } from 'rxjs';

import { ClasesService } from '../../../api/generated/api/clases.service';
import { ColaboradoresService } from '../../../api/generated/api/colaboradores.service';
import { EspaciosService } from '../../../api/generated/api/espacios.service';
import { InscripcionesService } from '../../../api/generated/api/inscripciones.service';
import { PersonasService } from '../../../api/generated/api/personas.service';
import { ServiciosYOfertasService } from '../../../api/generated/api/servicios-y-ofertas.service';
import { Clase } from '../../../api/generated/model/clase';
import { Cupos } from '../../../api/generated/model/cupos';
import { EventoDeClase } from '../../../api/generated/model/evento-de-clase';
import { HabilitacionesResponse } from '../../../api/generated/model/habilitaciones-response';
import { InstructoresDeClase } from '../../../api/generated/model/instructores-de-clase';
import { Inscripcion } from '../../../api/generated/model/inscripcion';
import {
  MembershipResponse,
  MembershipResponseEstadoEnum,
  MembershipResponseRoleCodeEnum,
} from '../../../api/generated/model/membership-response';
import {
  OfertaResponse,
  OfertaResponseModalidadEnum,
} from '../../../api/generated/model/oferta-response';
import { Participante } from '../../../api/generated/model/participante';
import { PersonaPageResponse } from '../../../api/generated/model/persona-page-response';
import { ProgramarClase } from '../../../api/generated/model/programar-clase';
import { ReprogramarClase } from '../../../api/generated/model/reprogramar-clase';
import { ResultadoDeCancelacion } from '../../../api/generated/model/resultado-de-cancelacion';
import { ResultadoDeInscripcion } from '../../../api/generated/model/resultado-de-inscripcion';
import { OpcionDeEspacio, espaciosHabilitadosEnServicio } from '../models/clases';

/**
 * Fachada de la feature `activity` (M28): clases programadas e inscripciones (AKINE-08.01 y
 * 08.02). Las pantallas dependen de esta clase y de los tipos del contrato, nunca del servicio
 * generado directo. Asistencia, pases y abonos (08.03 en adelante) tienen su propia fachada.
 *
 * <h2>Lo que el contrato ofrece y lo que no</h2>
 *
 * <ul>
 *   <li><b>Una clase es un evento unico</b>, no N turnos (CA-M28-001-06). <b>No hay recurrencia</b>:
 *       cada clase se programa por separado.</li>
 *   <li><b>El box se puede elegir</b> (contrato 0.102.0): `espacioId` es opcional al programar y al
 *       reprogramar. Sin el, el backend toma el primer box apto y libre —al reprogramar puede no
 *       ser el actual—; con el, valida ese y solo ese, sin caer a otro.</li>
 *   <li><b>La clase trae sus nombres</b>: `ofertaNombre`, `profesionalNombre` y `espacioNombre`.
 *       Mostrarlos no exige releer ofertas ni habilitaciones.</li>
 *   <li><b>El cupo lo otorga la base</b>: dos inscripciones sobre el ultimo lugar dejan una sola
 *       confirmada. Sin lugar, `aceptaListaEspera` decide entre la cola y `clase-completa`.</li>
 *   <li><b>La baja de una inscripcion con lugar promueve a la cabeza de la espera</b> en el mismo
 *       acto, y la respuesta dice a quien en `promovida`.</li>
 *   <li><b>Los avisos de cambio y cancelacion</b> los encola el backend por outbox: la pantalla no
 *       manda nada, solo lo anuncia.</li>
 * </ul>
 */
@Injectable({ providedIn: 'root' })
export class ActivityApi {
  private readonly clases = inject(ClasesService);
  private readonly inscripciones = inject(InscripcionesService);
  private readonly ofertas = inject(ServiciosYOfertasService);
  private readonly personas = inject(PersonasService);
  private readonly colaboradores = inject(ColaboradoresService);
  private readonly espacios = inject(EspaciosService);

  /** Clases que EMPIEZAN en `[desde, hasta)`, instantes UTC. Exige `clase:read`. */
  listar(consultorioId: number, desde: string, hasta: string): Observable<readonly Clase[]> {
    return this.clases.listarClase({ consultorioId, desde, hasta });
  }

  ver(consultorioId: number, claseId: number): Observable<Clase> {
    return this.clases.verClase({ consultorioId, claseId });
  }

  historial(consultorioId: number, claseId: number): Observable<readonly EventoDeClase[]> {
    return this.clases.historialClase({ consultorioId, claseId });
  }

  /** Exige `clase:manage`. `idempotencyKey` hace que un reintento no cree una segunda clase. */
  programar(consultorioId: number, ofertaId: number, cuerpo: ProgramarClase): Observable<Clase> {
    return this.clases.programar({ consultorioId, ofertaId, programarClase: cuerpo });
  }

  /** Conserva la clase y sus inscriptos. Control optimista por `version`. */
  reprogramar(consultorioId: number, claseId: number, cuerpo: ReprogramarClase): Observable<Clase> {
    return this.clases.reprogramarClase({ consultorioId, claseId, reprogramarClase: cuerpo });
  }

  /** Idempotente: cancelar una cancelada devuelve la misma clase con el motivo original. */
  cancelar(consultorioId: number, claseId: number, motivo: string): Observable<Clase> {
    return this.clases.cancelarClase({ consultorioId, claseId, cancelarClase: { motivo } });
  }

  /** Capacidad, ocupados, disponibles y en espera. Exige `clase:read`; no nombra a nadie. */
  cupos(consultorioId: number, claseId: number): Observable<Cupos> {
    return this.inscripciones.cupos({ consultorioId, claseId });
  }

  /** Participantes en orden de cola, cancelados incluidos. Exige `inscripcion:read`. */
  participantes(consultorioId: number, claseId: number): Observable<readonly Participante[]> {
    return this.inscripciones.participantes({ consultorioId, claseId });
  }

  inscribir(
    consultorioId: number,
    claseId: number,
    cuerpo: {
      readonly personaId: number;
      readonly aceptaListaEspera: boolean;
      readonly idempotencyKey: string;
    },
  ): Observable<ResultadoDeInscripcion> {
    return this.inscripciones.inscribir({ consultorioId, claseId, inscribir: { ...cuerpo } });
  }

  confirmar(
    consultorioId: number,
    claseId: number,
    inscripcionId: number,
  ): Observable<Inscripcion> {
    return this.inscripciones.confirmarInscripcion({ consultorioId, claseId, inscripcionId });
  }

  /** Libera el cupo y, si tenia lugar, promueve a la cabeza de la espera (`promovida`). */
  darDeBaja(
    consultorioId: number,
    claseId: number,
    inscripcionId: number,
    motivo: string,
  ): Observable<ResultadoDeCancelacion> {
    return this.inscripciones.cancelarInscripcion({
      consultorioId,
      claseId,
      inscripcionId,
      cancelarInscripcion: { motivo },
    });
  }

  /** Ofertas GRUPALES activas de la sede: las unicas que pueden sostener una clase. */
  ofertasGrupales(consultorioId: number): Observable<readonly OfertaResponse[]> {
    return this.ofertas
      .listOfertas({ consultorioId, estado: 'ACTIVO' })
      .pipe(
        map((ofertas) => ofertas.filter((o) => o.modalidad === OfertaResponseModalidadEnum.GRUPAL)),
      );
  }

  /** Profesionales habilitados para la oferta, con nombre. */
  habilitaciones(consultorioId: number, ofertaId: number): Observable<HabilitacionesResponse> {
    return this.ofertas.getHabilitaciones({ consultorioId, ofertaId });
  }

  /** Personas del padron, para elegir a quien se inscribe. */
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

  /**
   * Profesionales vigentes de la organizacion. Es el respaldo de {@link habilitaciones} cuando la
   * oferta NO esta restringida: lista vacia significa "cualquiera con vinculo vigente", no
   * "ninguno". Exige `colaborador:read`; sin el, la pantalla no puede ofrecer nombres.
   */
  profesionalesDeLaOrganizacion(organizationId: number): Observable<readonly MembershipResponse[]> {
    return this.colaboradores
      .listMemberships({ orgId: organizationId, size: 200 })
      .pipe(
        map((pagina) =>
          (pagina.content ?? []).filter(
            (m) =>
              m.estado === MembershipResponseEstadoEnum.ACTIVA &&
              m.roleCode === MembershipResponseRoleCodeEnum.PROFESIONAL,
          ),
        ),
      );
  }

  /**
   * Boxes que se pueden ofrecer para una clase de la oferta. Restringida por espacio: sus
   * habilitaciones activas y en servicio. Sin restriccion —`false` es "cualquiera", no "ninguno"—:
   * los espacios activos de la sede. Sin permiso o con error, lista vacia: la pantalla igual deja
   * que el servidor elija.
   */
  espaciosElegibles(
    organizationId: number | null,
    consultorioId: number,
    habilitaciones: HabilitacionesResponse | null,
  ): Observable<readonly OpcionDeEspacio[]> {
    if (habilitaciones?.restringidaPorEspacio) {
      return of(espaciosHabilitadosEnServicio(habilitaciones));
    }
    if (organizationId === null) {
      return of([]);
    }
    return this.espacios
      .listEspacios({ orgId: organizationId, consultorioId, estado: 'ACTIVO', size: 100 })
      .pipe(
        map((pagina) =>
          (pagina.content ?? [])
            .filter((e) => e.id !== undefined && e.enServicio !== false)
            .map((e) => ({ espacioId: e.id as number, nombre: e.name || `Box #${e.id}` })),
        ),
        catchError(() => of([])),
      );
  }

  // -------------------------------------------------------------------------------------------
  // Instructores adicionales (DP-38). El total de honorarios de la clase se reparte en partes
  // iguales entre el principal y los adicionales. El adicional NO ocupa agenda.
  // -------------------------------------------------------------------------------------------

  /** El principal y los adicionales vigentes. Exige `clase:read`. */
  instructores(consultorioId: number, claseId: number): Observable<InstructoresDeClase> {
    return this.clases.getInstructoresDeClase({ consultorioId, claseId });
  }

  /**
   * Reemplaza la lista COMPLETA de adicionales; vacia los quita. Exige `clase:manage`. Una clase
   * con honorarios liquidados responde 409 `clase-con-honorarios-liquidados`.
   */
  reemplazarInstructores(
    consultorioId: number,
    claseId: number,
    adicionales: readonly number[],
  ): Observable<InstructoresDeClase> {
    return this.clases.reemplazarInstructoresDeClase({
      consultorioId,
      claseId,
      reemplazarInstructoresDeClaseRequest: { adicionales: [...adicionales] },
    });
  }

  /**
   * Quienes pueden sumarse como instructores de una clase de la oferta: los habilitados si la
   * oferta esta restringida por profesional; si no, <b>cualquier colaborador</b> con vinculo vigente
   * en la sede, sea cual sea su rol —es la regla del backend para el adicional (DP-38): no exige el
   * rol PROFESIONAL, a diferencia del principal—. Sin permiso o con error, lista vacia: el backend
   * valida igual.
   */
  instructoresElegibles(
    organizationId: number | null,
    consultorioId: number,
    ofertaId: number,
  ): Observable<readonly { readonly membershipId: number; readonly nombre: string }[]> {
    return this.habilitaciones(consultorioId, ofertaId).pipe(
      catchError(() => of(null)),
      switchMap((respuesta) => {
        if (respuesta?.restringidaPorProfesional) {
          return of(
            (respuesta.profesionales ?? [])
              .filter((p) => p.estado === 'ACTIVO' && p.membershipId !== undefined)
              .map((p) => ({
                membershipId: p.membershipId as number,
                nombre: p.nombre || `Profesional #${p.membershipId}`,
              })),
          );
        }
        if (organizationId === null) {
          return of([]);
        }
        return this.colaboradores.listMemberships({ orgId: organizationId, size: 200 }).pipe(
          map((pagina) =>
            (pagina.content ?? [])
              .filter(
                (m) =>
                  m.id !== undefined &&
                  m.estado === MembershipResponseEstadoEnum.ACTIVA &&
                  (m.consultorioId === undefined ||
                    m.consultorioId === null ||
                    m.consultorioId === consultorioId),
              )
              .map((m) => ({
                membershipId: m.id as number,
                nombre: m.accountName || m.accountEmail || `Colaborador #${m.id}`,
              })),
          ),
          catchError(() => of([])),
        );
      }),
    );
  }
}
