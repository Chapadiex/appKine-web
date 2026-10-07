import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CoberturaParaOfertaResponse } from '../../../api/generated/model/cobertura-para-oferta-response';
import { CoberturaResponse } from '../../../api/generated/model/cobertura-response';
import { CoberturasDelPacienteService } from '../../../api/generated/api/coberturas-del-paciente.service';
import { CreateCoberturaRequest } from '../../../api/generated/model/create-cobertura-request';
import { FinanciadorResponse } from '../../../api/generated/model/financiador-response';
import { FinanciadoresYPlanesService } from '../../../api/generated/api/financiadores-y-planes.service';
import { OfertaResponse } from '../../../api/generated/model/oferta-response';
import { PracticasDeOfertaResponse } from '../../../api/generated/model/practicas-de-oferta-response';
import { ServiciosYOfertasService } from '../../../api/generated/api/servicios-y-ofertas.service';
import { PlanCoberturaResponse } from '../../../api/generated/model/plan-cobertura-response';
import { UpdateCoberturaRequest } from '../../../api/generated/model/update-cobertura-request';

/** Filtro por ciclo de vida de la cobertura. Los tres valores son los del contrato. */
export type FiltroDeCoberturas = 'ACTIVA' | 'INACTIVA' | 'TODAS';

/**
 * Unico punto de la feature que toca las coberturas del paciente (M08, AKINE-03.04).
 *
 * <h2>1. Por que esta clase tambien lee el catalogo de financiadores</h2>
 *
 * <p>Porque el alta financiada necesita elegir un plan, y el catalogo vive en `contracting`. Lo
 * que se usa es el <b>cliente generado</b> de ese modulo —no una pantalla ni un servicio de otra
 * feature—, asi que no hay ningun import entre features (AGENT.md 4.4): `financiadores-y-planes`
 * es API, no `features/contracting`.
 *
 * <p>Se lee <b>solo para poblar el selector</b>. Ninguna otra parte de esta feature vuelve a
 * consultarlo, y esa ausencia es deliberada: el backend <b>congela</b> el plan en la cobertura al
 * darla de alta —copia codigo, nombre, copago y exigencias del dia `vigenciaDesde`— y no lo vuelve
 * a leer nunca. Resolver el nombre del financiador contra el catalogo de hoy para mostrarlo en el
 * historial reescribiria con que cobertura se atendio al paciente el mes pasado, que es
 * exactamente lo que RN-M08-003 prohibe. El texto que se muestra sale <b>siempre</b> de la
 * cobertura.
 *
 * <h2>2. PARTICULAR no es una fila del catalogo</h2>
 *
 * <p>Es la ausencia de plan financiado, y siempre esta disponible (RN-M08-001). No hay nada que
 * buscar, nada que elegir y nada que dar de baja: por eso {@link agregar} recibe el tipo y no
 * intenta resolver un plan cuando es particular.
 *
 * <h2>3. Editar no es lo mismo que finalizar, y ninguna de las dos es dar de baja</h2>
 *
 * <ul>
 *   <li><b>Mandar `vigenciaHasta` es finalizar la vigencia</b> (RF-M08-003). La cobertura queda
 *       ACTIVA y consultable, y deja de aplicar despues de esa fecha. Es "el paciente cambio de
 *       obra social".</li>
 *   <li><b>El DELETE es dar de baja</b>: "esta cobertura nunca debio cargarse". No borra nada, la
 *       cobertura sigue legible con estado INACTIVA, y desmarca la principal.</li>
 * </ul>
 *
 * <h2>4. `GET /coberturas/seleccion` no se usa, y es una decision</h2>
 *
 * <p>El contrato ofrece esa operacion para responder "con que se atiende hoy" (RF-M08-004 y
 * RF-M08-005). La pantalla contesta lo mismo <b>derivandolo del historial</b>, que ya viene con
 * `principal` y `vigente` calculados contra hoy, y se ahorra una segunda peticion en la lectura
 * mas frecuente del modulo. No hay ambiguedad al derivarlo: la principal es determinista del lado
 * del backend —lo hace cumplir un lock, no un desempate—, y `particularSiempreDisponible` es
 * constante por definicion.
 *
 * <p>Se declara aca porque el dia que algo <b>persista</b> una eleccion de cobertura —el turno, la
 * sesion, la obligacion— va a tener que preguntarlo al endpoint y no derivarlo: ahi la respuesta
 * tiene que venir del backend, no de una cuenta hecha en el navegador.
 *
 * <p><b>El plan no se puede cambiar</b> y por eso no esta en el cuerpo de la edicion. Cambiar de
 * plan es OTRA cobertura.
 */
@Injectable({ providedIn: 'root' })
export class CoberturasApi {
  private readonly api = inject(CoberturasDelPacienteService);
  private readonly catalogo = inject(FinanciadoresYPlanesService);
  private readonly ofertasApi = inject(ServiciosYOfertasService);

  /**
   * Que cobertura vigente aplica a una oferta de la sede, y por que no las otras (RF-M08-006).
   *
   * <p>Solo lectura y sin auditoria. La sede sale del token: sin sede el backend responde 403,
   * nunca "particular". La fecha vacia viaja como `undefined`: el backend usa el dia de la sede.
   */
  coberturaAplicable(
    personaId: number,
    ofertaId: number,
    fecha: string | undefined,
  ): Observable<CoberturaParaOfertaResponse> {
    return this.api.resolverCoberturaAplicablePorOferta({
      personaId,
      ofertaId,
      fecha: fecha === '' ? undefined : fecha,
    });
  }

  /** Ofertas activas de la sede, para elegir contra cual preguntar. */
  ofertasDeLaSede(consultorioId: number): Observable<OfertaResponse[]> {
    return this.ofertasApi.listOfertas({ consultorioId, estado: 'ACTIVO' });
  }

  /** Las practicas que declara la oferta: dan nombre a los `practicaId` de la respuesta. */
  practicasDeOferta(
    consultorioId: number,
    ofertaId: number,
  ): Observable<PracticasDeOfertaResponse> {
    return this.ofertasApi.getPracticasDeOferta({ consultorioId, ofertaId });
  }

  /**
   * El historial completo: vigentes, vencidas y dadas de baja, mas nuevas primero.
   *
   * <p>Trae todo a proposito. RN-M08-003 y la regla maestra 10 exigen poder explicar con que
   * cobertura se atendio al paciente el mes pasado, y un listado que solo muestre lo vigente hace
   * esa pregunta incontestable desde la pantalla.
   *
   * <p>`fecha` es el dia contra el que el backend calcula `vigente` y `credencialVencida`. No es un
   * filtro: una cobertura ACTIVA con la vigencia cerrada se devuelve igual, con `vigente = false`.
   */
  listar(
    personaId: number,
    filtro: FiltroDeCoberturas,
    fecha: string | undefined,
  ): Observable<CoberturaResponse[]> {
    return this.api.listCoberturasDePaciente({
      personaId,
      estado: filtro,
      fecha: fecha === '' ? undefined : fecha,
    });
  }

  /**
   * Alta de una cobertura.
   *
   * <p>La persona <b>tiene que ser paciente</b>: si no lo es, el backend responde 409
   * `persona-sin-perfil-paciente`. Es RF-M07-010 sostenido desde M08 — cargarle la obra social a
   * un contacto administrativo no significa nada.
   *
   * <p>El plan se congela contra `vigenciaDesde` y no contra hoy: la pregunta es si ese plan se
   * podia elegir el dia en que la cobertura empieza a valer.
   */
  agregar(personaId: number, cuerpo: CreateCoberturaRequest): Observable<CoberturaResponse> {
    return this.api.createCoberturaDePaciente({ personaId, createCoberturaRequest: cuerpo });
  }

  /** Edicion parcial, que es tambien como se finaliza la vigencia. `expectedVersion` es obligatorio. */
  editar(
    personaId: number,
    coberturaId: number,
    cuerpo: UpdateCoberturaRequest,
  ): Observable<CoberturaResponse> {
    return this.api.updateCoberturaDePaciente({
      personaId,
      coberturaId,
      updateCoberturaRequest: cuerpo,
    });
  }

  /**
   * Marca o desmarca la cobertura principal (RF-M08-004).
   *
   * <p>Es una operacion propia y no un campo de la edicion porque es un invariante <b>entre</b>
   * filas y no un dato de esta: meterlo en el PUT obligaria a mandar la version de una fila para
   * modificar el estado de otra.
   *
   * <p><b>No desmarca a la anterior en silencio</b>: si ya hay una principal vigente solapada
   * responde 409 con su id. Un click que cambia dos coberturas deja una que despues nadie puede
   * explicar.
   *
   * <p>`principal = false` desmarca, y es legitimo: un paciente puede no tener ninguna preferida.
   */
  marcarPrincipal(
    personaId: number,
    coberturaId: number,
    principal: boolean,
  ): Observable<CoberturaResponse> {
    return this.api.marcarCoberturaPrincipal({
      personaId,
      coberturaId,
      marcarCoberturaPrincipalRequest: { principal },
    });
  }

  /** Baja logica con motivo obligatorio. No hay reactivacion: una cobertura que vuelve es un alta. */
  darDeBaja(personaId: number, coberturaId: number, motivo: string): Observable<unknown> {
    return this.api.deactivateCoberturaDePaciente({
      personaId,
      coberturaId,
      deactivateCoberturaRequest: { reason: motivo },
    });
  }

  /** Financiadores activos, para el primer paso del selector del alta financiada. */
  financiadores(): Observable<FinanciadorResponse[]> {
    return this.catalogo.listFinanciadores({ estado: 'ACTIVO' });
  }

  /**
   * Planes activos de un financiador, evaluados contra la fecha en que la cobertura empieza.
   *
   * <p>Contra `vigenciaDesde` y no contra hoy, por lo mismo que el congelamiento: ofrecer planes
   * vigentes hoy para una cobertura que arranca en otra fecha produce un 409
   * `plan-no-seleccionable` que el operador no puede explicarse mirando la lista que la pantalla
   * le acaba de mostrar.
   */
  planes(financiadorId: number, fecha: string | undefined): Observable<PlanCoberturaResponse[]> {
    return this.catalogo.listPlanesDeCobertura({
      financiadorId,
      estado: 'ACTIVO',
      fecha: fecha === '' ? undefined : fecha,
    });
  }
}
