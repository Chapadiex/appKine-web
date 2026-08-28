import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CreatePersonaRequest } from '../../../api/generated/model/create-persona-request';
import { PersonaPageResponse } from '../../../api/generated/model/persona-page-response';
import { PersonaResponse } from '../../../api/generated/model/persona-response';
import { PersonasService } from '../../../api/generated/api/personas.service';
import { UpdatePersonaRequest } from '../../../api/generated/model/update-persona-request';

/** Filtro por ciclo de vida de la ficha. Los tres valores son los del contrato. */
export type FiltroEstadoPersona = 'ACTIVO' | 'INACTIVO' | 'TODOS';

/**
 * Filtro por perfil clinico.
 *
 * <p>Es la consulta que hace operativa la separacion Persona/Paciente: "dame las que ya son
 * pacientes" y "dame las que todavia no" son dos preguntas distintas, y las dos se hacen en el
 * mostrador.
 */
export type FiltroPerfil = 'CON_PERFIL' | 'SIN_PERFIL' | 'TODOS';

/**
 * Unico punto de la feature `person` que toca el cliente generado (M07, AKINE-03.01).
 *
 * <p>Mismo criterio que `OfferingApi`: la pantalla depende de esta clase y de los tipos del
 * contrato, nunca de {@link PersonasService} directo. Si una regeneracion del cliente cambia un
 * nombre, lo que hay que corregir es <b>este archivo</b> y no diez lugares repartidos entre la
 * plantilla y su spec.
 *
 * <h2>Lo que esta fachada NO tiene, y es lo importante</h2>
 *
 * <p><b>No hay ningun metodo que cree una persona con perfil clinico de una sola vez.</b> No es
 * una omision: el contrato tampoco lo ofrece, y por el mismo motivo. Dar de alta a alguien y
 * convertirlo en paciente son dos operaciones separadas —RF-M07-010— y esta capa no las junta en
 * una comodidad que despues alguien llame desde una inscripcion a una clase de pilates.
 *
 * <p>Tampoco traduce errores —eso es `models/person-errors.ts`— ni guarda estado.
 *
 * <p><b>Ningun metodo recibe `organizationId`.</b> El tenant sale del contexto validado del
 * request y el backend lo resuelve solo: no hay ningun lugar en la URL donde el cliente pueda
 * afirmar una pertenencia. Es la diferencia con `OfferingApi`, que si recibe `consultorioId`
 * porque las ofertas cuelgan de una sede.
 */
@Injectable({ providedIn: 'root' })
export class PersonApi {
  private readonly api = inject(PersonasService);

  /**
   * Busca en el padron. Un unico `texto` cubre documento, apellido, nombre y telefono.
   *
   * <p>`texto` vacio viaja como `undefined` y no como `''`: el cliente generado omite el
   * parametro y el backend distingue "sin filtro" de "filtra por la cadena vacia". Misma
   * decision que el catalogo clinico y que las ofertas.
   */
  buscar(filtros: {
    readonly texto?: string;
    readonly estado: FiltroEstadoPersona;
    readonly perfil: FiltroPerfil;
    readonly pagina: number;
    readonly tamano: number;
  }): Observable<PersonaPageResponse> {
    const texto = filtros.texto?.trim();
    return this.api.buscarPersonas({
      q: texto === undefined || texto === '' ? undefined : texto,
      estado: filtros.estado,
      perfil: filtros.perfil,
      page: filtros.pagina,
      size: filtros.tamano,
    });
  }

  ver(personaId: number): Observable<PersonaResponse> {
    return this.api.verPersona({ personaId });
  }

  /**
   * Alta de una PERSONA. Nunca de un paciente.
   *
   * <p>`confirmaPosibleDuplicado` es el reenvio despues de que el backend devolviera 409 con la
   * lista de candidatos: el operador ya los vio y declara que es otra persona. <b>No saltea el
   * documento repetido</b>, que es un invariante duro y no una advertencia.
   */
  crear(cuerpo: CreatePersonaRequest): Observable<PersonaResponse> {
    return this.api.crearPersona({ createPersonaRequest: cuerpo });
  }

  /** Edicion parcial: lo que no viaja, no se toca. Un campo ausente NO vacia el valor. */
  editar(personaId: number, cuerpo: UpdatePersonaRequest): Observable<PersonaResponse> {
    return this.api.editarPersona({ personaId, updatePersonaRequest: cuerpo });
  }

  /**
   * Activa el perfil clinico sobre una persona que ya existe.
   *
   * <p><b>Es idempotente y responde 200</b>, no 201: activar dos veces devuelve el perfil que ya
   * estaba. La pantalla no necesita distinguir "recien activado" de "ya lo estaba", y esa es
   * justamente la razon por la que el contrato lo resolvio asi.
   *
   * <p><b>Y no crea Historia Clinica.</b> La HC es M09, de un modulo que todavia no existe.
   */
  activarPerfil(personaId: number, motivo: string | undefined): Observable<PersonaResponse> {
    return this.api.activarPerfilPaciente({
      personaId,
      activarPerfilPacienteRequest: { motivo: motivo === '' ? undefined : motivo },
    });
  }
}
