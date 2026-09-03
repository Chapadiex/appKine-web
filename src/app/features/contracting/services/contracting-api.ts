import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CreateFinanciadorRequest } from '../../../api/generated/model/create-financiador-request';
import { CreatePlanCoberturaRequest } from '../../../api/generated/model/create-plan-cobertura-request';
import { DeactivateContractingRequest } from '../../../api/generated/model/deactivate-contracting-request';
import { FinanciadorResponse } from '../../../api/generated/model/financiador-response';
import { FinanciadoresYPlanesService } from '../../../api/generated/api/financiadores-y-planes.service';
import { PlanCoberturaResponse } from '../../../api/generated/model/plan-cobertura-response';
import { UpdateFinanciadorRequest } from '../../../api/generated/model/update-financiador-request';
import { UpdatePlanCoberturaRequest } from '../../../api/generated/model/update-plan-cobertura-request';

/**
 * Filtro de estado de los dos listados. Los tres valores son los del contrato.
 *
 * <p><b>No es un DTO manual.</b> Es la union de un <b>query param</b>, no un cuerpo que viaje
 * serializado, y el precedente esta en `offering-api.ts` y en `catalogos-page.ts`. Si el
 * contrato agregara un cuarto valor esto no deja de compilar; si se escribe uno que el backend
 * no acepta, el resultado es un `400` inmediato y visible.
 */
export type FiltroEstado = 'ACTIVO' | 'INACTIVO' | 'TODOS';

/** Tipos de financiador del contrato, para el filtro del listado. Mismo criterio que arriba. */
export type FiltroTipo =
  'OBRA_SOCIAL' | 'PREPAGA' | 'ART' | 'MUTUAL' | 'ORGANISMO_PUBLICO' | 'OTRO';

/**
 * Unico punto de la feature `contracting` que toca el cliente generado (M15, AKINE-03.03).
 *
 * <h2>Por que existe esta fachada</h2>
 *
 * <p>Es <b>el servicio de feature</b> que AGENT.md 4.5 pide, y lo que consume el cliente
 * generado es exactamente un archivo: las pantallas dependen de esta clase y de los tipos del
 * contrato, nunca de {@link FinanciadoresYPlanesService} directo. Cuando el contrato se
 * regenera y algun nombre se mueve, lo que hay que corregir es <b>este archivo</b> y no doce
 * lugares repartidos entre plantillas y specs. Ya paso: el cliente venia en `0.24.0` mientras
 * el backend publicaba `0.29.0`, y la regeneracion renombro operaciones.
 *
 * <p><b>Lo que NO hace.</b> No traduce errores —eso es `models/contracting-errors.ts`—, no
 * guarda estado, y no decide que hacer cuando falta algo: eso es de la pantalla.
 *
 * <h2>Por que no recibe `consultorioId` y la fachada de convenios si</h2>
 *
 * <p>El financiador y sus planes son de la <b>organizacion</b>, no de la sede: el backend los
 * acota con el tenant del token y sus rutas no llevan `{consultorioId}`. El convenio si es por
 * sede —ahi el arancel cambia entre una sucursal y otra—, y por eso vive en
 * {@link ConveniosApi}, que si lo pide por parametro. Meter las dos cosas en una sola fachada
 * habria obligado a pasar un `consultorioId` que la mitad de las operaciones ignora.
 */
@Injectable({ providedIn: 'root' })
export class ContractingApi {
  private readonly api = inject(FinanciadoresYPlanesService);

  /**
   * Financiadores de la organizacion.
   *
   * <p>`q` busca por codigo o nombre y va sin normalizar: normalizarlo aca duplicaria la regla
   * que el backend ya aplica, y las dos copias se desincronizarian en la primera correccion.
   */
  listarFinanciadores(
    filtros: {
      readonly q?: string;
      readonly estado?: FiltroEstado;
      readonly tipo?: FiltroTipo;
    } = {},
  ): Observable<FinanciadorResponse[]> {
    return this.api.listFinanciadores({
      q: filtros.q,
      estado: filtros.estado,
      tipo: filtros.tipo,
    });
  }

  obtenerFinanciador(financiadorId: number): Observable<FinanciadorResponse> {
    return this.api.getFinanciador({ financiadorId });
  }

  crearFinanciador(cuerpo: CreateFinanciadorRequest): Observable<FinanciadorResponse> {
    return this.api.createFinanciador({ createFinanciadorRequest: cuerpo });
  }

  /**
   * Edita un financiador. `expectedVersion` es obligatorio en el contrato y no tiene default:
   * la version viaja desde la fila que la pantalla ya tiene, y un `0` inventado seria un `409`
   * que le echa la culpa a nadie.
   */
  editarFinanciador(
    financiadorId: number,
    cuerpo: UpdateFinanciadorRequest,
  ): Observable<FinanciadorResponse> {
    return this.api.updateFinanciador({ financiadorId, updateFinanciadorRequest: cuerpo });
  }

  /**
   * Baja logica del financiador.
   *
   * <p><b>No cascadea.</b> Los planes que ya lo prestaban siguen existiendo y las coberturas
   * firmadas contra ellos siguen valiendo: lo unico que se impide es elegirlo de ahora en mas.
   * La pantalla tiene que decirlo, porque "dar de baja" sugiere lo contrario.
   */
  darDeBajaFinanciador(
    financiadorId: number,
    cuerpo: DeactivateContractingRequest,
  ): Observable<unknown> {
    return this.api.deactivateFinanciador({
      financiadorId,
      deactivateContractingRequest: cuerpo,
    });
  }

  /**
   * Planes de un financiador.
   *
   * <p>`fecha` filtra por vigencia y es <b>inclusiva en el extremo superior</b>: un plan con
   * `vigenciaHasta` igual a la fecha pedida todavia entra. Lo fijo 03.03 en la base y en el
   * codigo, despues de que `V24` dejara esa ambiguedad sin resolver.
   */
  listarPlanes(
    financiadorId: number,
    filtros: { readonly estado?: FiltroEstado; readonly fecha?: string } = {},
  ): Observable<PlanCoberturaResponse[]> {
    return this.api.listPlanesDeCobertura({
      financiadorId,
      estado: filtros.estado,
      fecha: filtros.fecha,
    });
  }

  crearPlan(
    financiadorId: number,
    cuerpo: CreatePlanCoberturaRequest,
  ): Observable<PlanCoberturaResponse> {
    return this.api.createPlanDeCobertura({
      financiadorId,
      createPlanCoberturaRequest: cuerpo,
    });
  }

  editarPlan(
    financiadorId: number,
    planId: number,
    cuerpo: UpdatePlanCoberturaRequest,
  ): Observable<PlanCoberturaResponse> {
    return this.api.updatePlanDeCobertura({
      financiadorId,
      planId,
      updatePlanCoberturaRequest: cuerpo,
    });
  }

  darDeBajaPlan(
    financiadorId: number,
    planId: number,
    cuerpo: DeactivateContractingRequest,
  ): Observable<unknown> {
    return this.api.deactivatePlanDeCobertura({
      financiadorId,
      planId,
      deactivateContractingRequest: cuerpo,
    });
  }
}
