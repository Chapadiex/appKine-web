import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ArancelEfectivoResponse } from '../../../api/generated/model/arancel-efectivo-response';
import { ArancelResponse } from '../../../api/generated/model/arancel-response';
import { ConvenioResponse } from '../../../api/generated/model/convenio-response';
import { ConveniosYArancelesService } from '../../../api/generated/api/convenios-y-aranceles.service';
import { CreateArancelRequest } from '../../../api/generated/model/create-arancel-request';
import { CreateConvenioRequest } from '../../../api/generated/model/create-convenio-request';
import { DeactivateContractingRequest } from '../../../api/generated/model/deactivate-contracting-request';
import { UpdateArancelRequest } from '../../../api/generated/model/update-arancel-request';
import { UpdateConvenioRequest } from '../../../api/generated/model/update-convenio-request';
import { FiltroEstado } from './contracting-api';

/**
 * Unico punto de las pantallas de convenios que toca el cliente generado (M16, AKINE-03.05).
 *
 * <h2>Por que va separada de {@link ContractingApi}</h2>
 *
 * <p>Lo anticipa el javadoc de aquella clase y sigue siendo la razon: <b>el convenio es de la
 * sede y el financiador es de la organizacion</b>. Las diez operaciones de aca cuelgan de
 * `/api/v1/consultorios/{consultorioId}/...` y todas necesitan ese id; ninguna de las ocho de
 * financiadores y planes lo lleva, porque el tenant sale del token. Meterlas en una sola fachada
 * habria obligado a pasar un `consultorioId` que la mitad de los metodos ignora, y ese parametro
 * ignorado es exactamente el que alguien termina pasando mal.
 *
 * <p>La separacion tambien es la que hace visible RN-M16-001 desde el codigo: dos sedes de la
 * misma organizacion pueden tener aranceles distintos para la misma practica bajo el mismo plan,
 * y eso es el caso normal de una cadena.
 *
 * <p><b>Lo que NO hace.</b> No traduce errores —eso es `models/contracting-errors.ts`—, no guarda
 * estado, y no decide que hacer cuando no hay arancel: eso es de la pantalla.
 *
 * <h2>El `consultorioId` entra por parametro y no se lee del contexto aca</h2>
 *
 * <p>Podria inyectar `TenantContextStore` y sacarlo solo, y seria peor: un servicio que lee el
 * contexto por su cuenta esconde la dependencia y vuelve intestable cada llamada. Ademas la sede
 * de la ruta es lo que el backend usa para <b>autorizar</b> —no la del token—, asi que dejarla
 * explicita en cada firma es coherente con lo que realmente decide el permiso.
 */
@Injectable({ providedIn: 'root' })
export class ConveniosApi {
  private readonly api = inject(ConveniosYArancelesService);

  /**
   * Convenios de una sede, ordenados por nombre.
   *
   * <p><b>`estado` filtra el ciclo de vida y `fecha` NO filtra nada</b>: es el dia contra el que
   * el backend calcula `vigente`. Un convenio activo con la vigencia vencida se devuelve igual,
   * con `vigente = false`, y es justamente lo que hace falta para explicar por que una prestacion
   * de marzo se liquido distinto que una de octubre. Filtrar por vigencia en el servidor dejaria
   * a la grilla sin poder mostrar esa fila.
   *
   * <p>Sin `estado`, el backend trae solo los ACTIVOS.
   */
  listarConvenios(
    consultorioId: number,
    filtros: { readonly estado?: FiltroEstado; readonly fecha?: string } = {},
  ): Observable<ConvenioResponse[]> {
    return this.api.listConvenios({
      consultorioId,
      estado: filtros.estado,
      fecha: filtros.fecha,
    });
  }

  /**
   * Un convenio, con su `vigente` calculado contra `fecha`.
   *
   * <p>Un convenio <b>INACTIVO se lee con 200 y no con 404</b>: lo que ya se liquido bajo el
   * tiene que seguir siendo explicable (§38). La pantalla que lo abra tiene que estar preparada
   * para mostrar una ficha dada de baja, no para tratarla como inexistente.
   */
  obtenerConvenio(
    consultorioId: number,
    convenioId: number,
    fecha?: string,
  ): Observable<ConvenioResponse> {
    return this.api.getConvenio({ consultorioId, convenioId, fecha });
  }

  /**
   * Da de alta un convenio en la sede.
   *
   * <p>El `planId` es <b>obligatorio</b> y tiene que ser del financiador declarado. No es
   * burocracia: es lo que hace que la resolucion del arancel tenga como mucho una candidata para
   * una fecha, sin necesidad de ninguna regla de prioridad. Un convenio "para todo el
   * financiador" seria una segunda candidata y obligaria a inventar un desempate.
   *
   * <p>Puede responder `409 convenio-solapado`: dos convenios de la misma
   * `(sede, financiador, plan)` no pueden pisarse en el tiempo (RN-M16-002).
   */
  crearConvenio(
    consultorioId: number,
    cuerpo: CreateConvenioRequest,
  ): Observable<ConvenioResponse> {
    return this.api.createConvenio({ consultorioId, createConvenioRequest: cuerpo });
  }

  /**
   * Edita un convenio, <b>o le cierra la vigencia</b>.
   *
   * <p>Son la misma escritura, y esa es la mitad que la pantalla no puede aplanar: cerrar la
   * vigencia es mandar `vigenciaHasta` por acá (RF-M16-003), y el convenio queda <b>ACTIVO y
   * consultable</b>. Dar de baja es {@link darDeBajaConvenio}, exige motivo y no tiene vuelta
   * atras.
   *
   * <p>Mover la vigencia puede producir `409 convenio-solapado`, igual que el alta: estirar el
   * fin de un convenio hasta pisar al siguiente es exactamente lo que RN-M16-002 prohibe.
   *
   * <p>Ni el codigo, ni el financiador, ni el plan estan en el cuerpo: son la identidad del
   * convenio y lo que ya se liquido bajo el los referencia.
   */
  editarConvenio(
    consultorioId: number,
    convenioId: number,
    cuerpo: UpdateConvenioRequest,
  ): Observable<ConvenioResponse> {
    return this.api.updateConvenio({ consultorioId, convenioId, updateConvenioRequest: cuerpo });
  }

  /**
   * Baja logica del convenio, con motivo obligatorio.
   *
   * <p><b>No cascadea a sus aranceles y no se bloquea por tenerlos</b>: dejan de resolver porque
   * su convenio dejo de resolver, y el numero queda en la auditoria. Lo ya liquidado sigue
   * explicandose con su copia congelada — RN-M16-003 prohibe recalcular historicos.
   *
   * <p>Libera el codigo <b>y el periodo</b> para un convenio nuevo de la misma sede: el
   * no-solapamiento solo mira los activos.
   */
  darDeBajaConvenio(
    consultorioId: number,
    convenioId: number,
    cuerpo: DeactivateContractingRequest,
  ): Observable<unknown> {
    return this.api.deactivateConvenio({
      consultorioId,
      convenioId,
      deactivateContractingRequest: cuerpo,
    });
  }

  /**
   * La grilla de vigencias de un convenio, del arancel mas nuevo al mas viejo.
   *
   * <p>Igual que en los convenios: `estado` filtra el ciclo de vida, `fecha` solo decide contra
   * que dia se calcula `vigente`. <b>Dos aranceles de la misma practica conviven</b> —el de 2026
   * y el de 2027— y esa convivencia es el caso normal, no un dato duplicado.
   */
  listarAranceles(
    consultorioId: number,
    convenioId: number,
    filtros: { readonly estado?: FiltroEstado; readonly fecha?: string } = {},
  ): Observable<ArancelResponse[]> {
    return this.api.listAranceles({
      consultorioId,
      convenioId,
      estado: filtros.estado,
      fecha: filtros.fecha,
    });
  }

  /**
   * Define el arancel de una practica bajo un convenio.
   *
   * <p><b>Los tres importes tienen que cuadrar</b>: `importeFinanciador + coseguro =
   * importeTotal`, exactamente. No hay porcentaje de cobertura a proposito (§37).
   *
   * <p><b>La moneda no viaja en el cuerpo</b>: la hereda del convenio. Y la vigencia del arancel
   * tiene que estar <b>contenida</b> en la del convenio, porque fuera de ella nunca podria
   * resolver — la resolucion exige primero un convenio aplicable.
   */
  crearArancel(
    consultorioId: number,
    convenioId: number,
    cuerpo: CreateArancelRequest,
  ): Observable<ArancelResponse> {
    return this.api.createArancel({ consultorioId, convenioId, createArancelRequest: cuerpo });
  }

  /**
   * Edita un arancel.
   *
   * <p><b>Esta NO es la forma correcta de subir un precio</b>: para eso se cierra la vigencia del
   * arancel actual y se crea otro, y asi lo de antes se sigue explicando con su propio precio.
   * Editar el importe de una ventana ya transcurrida se admite —a veces hay que corregir una
   * carga— y no reescribe nada de lo ya liquidado, que guardo su snapshot congelado.
   *
   * <p>Los importes se validan <b>como terna aunque llegue uno solo</b>: subir el total sin tocar
   * las partes rompe la invariante y se rechaza con 400. Ni la practica ni el convenio se pueden
   * cambiar: no seria editar este arancel, seria inventar otro.
   */
  editarArancel(
    consultorioId: number,
    convenioId: number,
    arancelId: number,
    cuerpo: UpdateArancelRequest,
  ): Observable<ArancelResponse> {
    return this.api.updateArancel({
      consultorioId,
      convenioId,
      arancelId,
      updateArancelRequest: cuerpo,
    });
  }

  /**
   * Baja logica del arancel, con motivo obligatorio.
   *
   * <p><b>Libera el periodo</b>: el no-solapamiento solo mira los activos, asi que se puede
   * volver a cargar un arancel de esa practica para las mismas fechas. Lo ya liquidado guarda su
   * snapshot y no se toca.
   */
  darDeBajaArancel(
    consultorioId: number,
    convenioId: number,
    arancelId: number,
    cuerpo: DeactivateContractingRequest,
  ): Observable<unknown> {
    return this.api.deactivateArancel({
      consultorioId,
      convenioId,
      arancelId,
      deactivateContractingRequest: cuerpo,
    });
  }

  /**
   * Resuelve el arancel efectivo de una practica para una fecha (RF-M16-006 y RF-M16-010).
   *
   * <h2>Responde 200 aunque NO haya arancel, y eso cambia como se llama</h2>
   *
   * <p>Por eso este metodo <b>no</b> se llama `obtenerArancel`: no devuelve un precio, devuelve
   * un <b>desenlace</b> —`resuelto: true` con la derivacion completa, o `resuelto: false` con el
   * motivo—. No encontrar convenio es el caso <b>mas frecuente</b>, porque la mayoria de los
   * pacientes se atienden como particulares, y un `404` obligaria a la pantalla a tratar el caso
   * normal como una excepcion.
   *
   * <p>La pantalla no puede mostrar un cartel de error ni un vacio ante `resuelto: false`: tiene
   * que explicar cual de los dos motivos fue, porque mandan a hacer cosas distintas.
   *
   * <p><b>`fecha` es el dia de la PRESTACION, no el de hoy.</b> Consultar una fecha pasada
   * devuelve el arancel que regia entonces, que es lo que hace que una atencion retroactiva se
   * cobre bien. Si se omite, el backend usa hoy.
   */
  resolverArancelEfectivo(
    consultorioId: number,
    clave: {
      readonly financiadorId: number;
      readonly planId: number;
      readonly practicaId: number;
      readonly fecha?: string;
    },
  ): Observable<ArancelEfectivoResponse> {
    return this.api.resolveArancelEfectivo({
      consultorioId,
      financiadorId: clave.financiadorId,
      planId: clave.planId,
      practicaId: clave.practicaId,
      fecha: clave.fecha,
    });
  }
}
