import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { AutorizacionResponse } from '../../../api/generated/model/autorizacion-response';
import { AutorizacionesService } from '../../../api/generated/api/autorizaciones.service';
import { CatalogoClinicoService } from '../../../api/generated/api/catalogo-clinico.service';
import { CatalogoConceptoPageResponse } from '../../../api/generated/model/catalogo-concepto-page-response';
import { CreateAutorizacionRequest } from '../../../api/generated/model/create-autorizacion-request';
import { CreateOrdenRequest } from '../../../api/generated/model/create-orden-request';
import { ElegibilidadAdministrativaService } from '../../../api/generated/api/elegibilidad-administrativa.service';
import { ElegibilidadResponse } from '../../../api/generated/model/elegibilidad-response';
import { HistorialDeAutorizacionResponse } from '../../../api/generated/model/historial-de-autorizacion-response';
import { OrdenResponse } from '../../../api/generated/model/orden-response';
import { OrdenesMedicasService } from '../../../api/generated/api/ordenes-medicas.service';
import { ResolverAutorizacionRequest } from '../../../api/generated/model/resolver-autorizacion-request';
import { UpdateAutorizacionRequest } from '../../../api/generated/model/update-autorizacion-request';
import { UpdateOrdenRequest } from '../../../api/generated/model/update-orden-request';

/** Filtro por ciclo de vida. Vale igual para ordenes y para autorizaciones. */
export type FiltroDeDocumentos = 'ACTIVA' | 'INACTIVA' | 'TODAS';

/** Las tres acciones que el backend acepta sobre una autorizacion. Son del contrato. */
export type AccionDeAutorizacion = 'APROBAR' | 'OBSERVAR' | 'RECHAZAR';

/**
 * Unico punto de la feature que toca ordenes, autorizaciones y elegibilidad (M17, AKINE-03.06).
 *
 * <h2>1. Resolver una autorizacion recibe una ACCION, no un estado destino</h2>
 *
 * <p>Es la decision del contrato que esta fachada tiene que respetar tal cual, y por eso
 * {@link resolver} recibe `APROBAR | OBSERVAR | RECHAZAR` y no un estado. Con un estado destino,
 * pedir `APROBADA` sobre una `RECHAZADA` seria una peticion valida que el servidor rechaza por
 * semantica, y el cliente podria construir cualquier transicion imaginable. Con una accion, la
 * unica forma de llegar a APROBADA es aprobar, y el conjunto de transiciones posibles vive
 * entero del lado del backend.
 *
 * <p><b>APROBADA y RECHAZADA son terminales.</b> Corregir una decision tomada es dar de baja la
 * autorizacion y cargar otra: si una aprobada pudiera volver a PENDIENTE, el saldo que ya se conto
 * para atender a alguien desapareceria retroactivamente.
 *
 * <h2>2. Vincular un documento NO sube nada</h2>
 *
 * <p>El archivo lo sube {@link AdjuntosApi}, que ya valida tipo y tamano por los bytes, genera una
 * clave de almacenamiento que no sale del backend y autoriza cada descarga. Aca solo se guarda el
 * vinculo. Un segundo mecanismo de carga significaria una segunda validacion, una segunda ruta de
 * descarga y una segunda superficie de path traversal.
 *
 * <p>`adjuntoId` en `null` <b>desvincula</b>, y es legitimo: el operador subio el escaneo
 * equivocado y lo saca sin dar de baja la orden entera.
 *
 * <h2>3. La elegibilidad no consume nada y no afirma que sea facturable</h2>
 *
 * <p>Es idempotente, no persiste nada (RN-M17-001) y dice si la <b>documentacion administrativa</b>
 * esta presente, que no es lo mismo que decir que la prestacion se pueda facturar a ese financiador
 * (RN-M08-004). Lee el convenio <b>vivo</b> y no la copia congelada de ninguna autorizacion: decidir
 * que se puede hacer hoy se hace con la regla de hoy, y la copia existe para explicar el pasado.
 */
@Injectable({ providedIn: 'root' })
export class DocumentosApi {
  private readonly ordenesApi = inject(OrdenesMedicasService);
  private readonly autorizacionesApi = inject(AutorizacionesService);
  private readonly elegibilidadApi = inject(ElegibilidadAdministrativaService);
  private readonly catalogo = inject(CatalogoClinicoService);

  // -------------------------------------------------------------------------------------
  // Ordenes medicas
  // -------------------------------------------------------------------------------------

  /**
   * El historial de ordenes: vigentes, vencidas y dadas de baja, mas nuevas primero.
   *
   * <p>Trae todo a proposito. "Un documento vencido no desaparece" es requisito de M17, y sin el
   * historial no se puede explicar con que papel se atendio al paciente el mes pasado. `estado`
   * filtra el ciclo de vida y <b>no</b> la vigencia: una orden ACTIVA vencida es el caso normal.
   */
  listarOrdenes(
    personaId: number,
    filtro: FiltroDeDocumentos,
    fecha: string | undefined,
  ): Observable<OrdenResponse[]> {
    return this.ordenesApi.listOrdenesDePaciente({
      personaId,
      estado: filtro,
      fecha: fecha === '' ? undefined : fecha,
    });
  }

  /**
   * Registra una orden (RF-M17-001).
   *
   * <p>El emisor es <b>texto libre</b> y no una fila de ningun catalogo: el medico que firma es
   * externo al centro, y exigir que exista dejaria al mostrador sin poder cargar la orden que el
   * paciente trajo hoy. La matricula es opcional, que resuelve el documento ilegible sin rechazar
   * la carga.
   *
   * <p>La cobertura tambien es opcional: una prescripcion la firma un medico, no un financiador.
   * Sin `coberturaId` la orden vale para cualquiera.
   */
  crearOrden(personaId: number, cuerpo: CreateOrdenRequest): Observable<OrdenResponse> {
    return this.ordenesApi.createOrdenMedica({ personaId, createOrdenRequest: cuerpo });
  }

  /**
   * Corrige una orden. Edicion parcial y `expectedVersion` obligatorio.
   *
   * <p>Una orden <b>vencida si se edita</b> —corregir la fecha mal tipeada es el caso normal— y una
   * dada de baja no: 409 `orden-inactiva`. La persona y la cobertura no estan en el cuerpo porque
   * mudar una orden de paciente reescribiria quien presento que papel.
   */
  editarOrden(
    personaId: number,
    ordenId: number,
    cuerpo: UpdateOrdenRequest,
  ): Observable<OrdenResponse> {
    return this.ordenesApi.updateOrdenMedica({ personaId, ordenId, updateOrdenRequest: cuerpo });
  }

  /** Baja logica con motivo. <b>No es lo mismo que vencer</b>: una vencida sigue activa. */
  darDeBajaOrden(personaId: number, ordenId: number, motivo: string): Observable<unknown> {
    return this.ordenesApi.deactivateOrdenMedica({
      personaId,
      ordenId,
      deactivateDocumentoRequest: { reason: motivo },
    });
  }

  /** Vincula —o desvincula, con `null`— el escaneo ya subido. Ver el javadoc de la clase. */
  vincularDocumentoDeOrden(
    personaId: number,
    ordenId: number,
    adjuntoId: number | undefined,
  ): Observable<OrdenResponse> {
    return this.ordenesApi.vincularDocumentoDeOrden({
      personaId,
      ordenId,
      vincularDocumentoRequest: { adjuntoId },
    });
  }

  // -------------------------------------------------------------------------------------
  // Autorizaciones
  // -------------------------------------------------------------------------------------

  /**
   * El historial de autorizaciones, con saldo, vencimiento y veredicto calculados al leer.
   *
   * <p>`estado` filtra el <b>ciclo de vida</b> (ACTIVA/INACTIVA), no el estado de la autorizacion
   * ni su vigencia: una RECHAZADA sigue siendo ACTIVA y se lista, porque es lo que explica por que
   * no se pudo atender.
   *
   * <p>Todo lo derivado —`vencida`, `agotada`, `habilita`, `diasParaVencer`— se calcula contra la
   * fecha que se pregunta y <b>no existe ningun job</b> que mueva estados: materializarlos dejaria
   * autorizaciones vencidas que el sistema cree vigentes el dia que el job no corra.
   */
  listarAutorizaciones(
    personaId: number,
    filtro: FiltroDeDocumentos,
    fecha: string | undefined,
  ): Observable<AutorizacionResponse[]> {
    return this.autorizacionesApi.listAutorizacionesDePaciente({
      personaId,
      estado: filtro,
      fecha: fecha === '' ? undefined : fecha,
    });
  }

  /**
   * Registra una autorizacion.
   *
   * <p>`estadoInicial` admite PENDIENTE —el default— o APROBADA, y nada mas: OBSERVADA y RECHAZADA
   * son la <b>respuesta</b> a un pedido y se aplican con {@link resolver}. Solo si nace APROBADA se
   * valida el solapamiento.
   */
  crearAutorizacion(
    personaId: number,
    cuerpo: CreateAutorizacionRequest,
  ): Observable<AutorizacionResponse> {
    return this.autorizacionesApi.createAutorizacion({
      personaId,
      createAutorizacionRequest: cuerpo,
    });
  }

  /**
   * Corrige una autorizacion. `expectedVersion` obligatorio.
   *
   * <p>La cobertura, la practica y el estado <b>no estan en el cuerpo</b>, y ninguno es un olvido:
   * las dos primeras son inmutables porque cambiarlas reescribiria contra que se autorizo, y el
   * estado se mueve con una accion.
   */
  editarAutorizacion(
    personaId: number,
    autorizacionId: number,
    cuerpo: UpdateAutorizacionRequest,
  ): Observable<AutorizacionResponse> {
    return this.autorizacionesApi.updateAutorizacion({
      personaId,
      autorizacionId,
      updateAutorizacionRequest: cuerpo,
    });
  }

  /**
   * Aplica la respuesta del financiador.
   *
   * <p>Al <b>aprobar</b>, `cantidadAutorizada` y las vigencias <b>pisan</b> a las declaradas al
   * cargar: el financiador puede otorgar seis sesiones donde se pidieron veinte, o una ventana mas
   * corta, y lo que vale es lo que concedio. Es la autorizacion parcial, y por eso los tres campos
   * viajan en esta operacion y no solo en la edicion.
   *
   * <p>El motivo es <b>obligatorio al observar y al rechazar</b>: sin el, el mostrador no sabe que
   * corregir.
   */
  resolver(
    personaId: number,
    autorizacionId: number,
    cuerpo: ResolverAutorizacionRequest,
  ): Observable<AutorizacionResponse> {
    return this.autorizacionesApi.resolverAutorizacion({
      personaId,
      autorizacionId,
      resolverAutorizacionRequest: cuerpo,
    });
  }

  /** Baja logica con motivo. <b>No es rechazar y no es vencer.</b> */
  darDeBajaAutorizacion(
    personaId: number,
    autorizacionId: number,
    motivo: string,
  ): Observable<unknown> {
    return this.autorizacionesApi.deactivateAutorizacion({
      personaId,
      autorizacionId,
      deactivateDocumentoRequest: { reason: motivo },
    });
  }

  /** Vincula —o desvincula— el comprobante ya subido. Ver el javadoc de la clase. */
  vincularDocumentoDeAutorizacion(
    personaId: number,
    autorizacionId: number,
    adjuntoId: number | undefined,
  ): Observable<AutorizacionResponse> {
    return this.autorizacionesApi.vincularDocumentoDeAutorizacion({
      personaId,
      autorizacionId,
      vincularDocumentoRequest: { adjuntoId },
    });
  }

  // -------------------------------------------------------------------------------------
  // Elegibilidad y catalogo
  // -------------------------------------------------------------------------------------

  /**
   * Que le falta al paciente para que le atiendan esa practica (RF-M17-007).
   *
   * <p><b>Un requisito faltante no es un error</b>: responde 200 con `elegible = false` y el detalle
   * de que falta. Un 409 obligaria a la pantalla a tratar el caso mas frecuente —al paciente le
   * falta la orden— como una excepcion.
   */
  elegibilidad(
    personaId: number,
    coberturaId: number,
    practicaId: number,
    fecha: string | undefined,
  ): Observable<ElegibilidadResponse> {
    return this.elegibilidadApi.consultarElegibilidadAdministrativa({
      personaId,
      coberturaId,
      practicaId,
      fecha: fecha === '' ? undefined : fecha,
    });
  }

  /**
   * Historial de una autorizacion (B-4, DP-23): sus hechos del mas viejo al mas nuevo, paginado.
   *
   * <p>El vencimiento <b>no es un evento</b>: viaja calculado en `vencida`/`vencidaDesde` contra
   * la fecha de hoy. Las autorizaciones cargadas antes del historial traen un solo ALTA
   * reconstruido, y su `detalle` lo declara.
   */
  historialDeAutorizacion(
    personaId: number,
    autorizacionId: number,
    pagina: number,
    tamano: number,
  ): Observable<HistorialDeAutorizacionResponse> {
    return this.autorizacionesApi.getHistorialDeAutorizacion({
      personaId,
      autorizacionId,
      page: pagina,
      size: tamano,
    });
  }

  /**
   * Practicas del catalogo clinico, para elegir contra que se autoriza o se consulta.
   *
   * <p>Es el <b>cliente generado</b> del catalogo, no la feature `catalog`: no hay import entre
   * features. Se piden solo las activas y una sola pagina grande, porque es para poblar un selector
   * y no para navegar el catalogo — eso ya tiene su pantalla.
   */
  practicas(): Observable<CatalogoConceptoPageResponse> {
    return this.catalogo.searchCatalogo({
      tipo: 'practicas',
      estado: 'ACTIVO',
      alcance: 'TODOS',
      page: 0,
      size: 200,
    });
  }
}
