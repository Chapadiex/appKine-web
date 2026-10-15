import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { ClasesService } from '../../../api/generated/api/clases.service';
import { ColaboradoresService } from '../../../api/generated/api/colaboradores.service';
import { InscripcionesService } from '../../../api/generated/api/inscripciones.service';
import { PersonasService } from '../../../api/generated/api/personas.service';
import { ServiciosYOfertasService } from '../../../api/generated/api/servicios-y-ofertas.service';
import { Clase } from '../../../api/generated/model/clase';
import { Cupos } from '../../../api/generated/model/cupos';
import { EventoDeClase } from '../../../api/generated/model/evento-de-clase';
import { HabilitacionesResponse } from '../../../api/generated/model/habilitaciones-response';
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
 *   <li><b>El box no se elige</b>: si la oferta lo requiere, el backend toma uno habilitado y libre
 *       y lo devuelve en `espacioId`. Ni `ProgramarClase` ni `ReprogramarClase` lo llevan.</li>
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
}
