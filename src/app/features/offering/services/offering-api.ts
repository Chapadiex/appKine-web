import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CreateOfertaRequest } from '../../../api/generated/model/create-oferta-request';
import { CreateServicioRequest } from '../../../api/generated/model/create-servicio-request';
import { OfertaResponse } from '../../../api/generated/model/oferta-response';
import { ServicioResponse } from '../../../api/generated/model/servicio-response';
import { ServiciosYOfertasService } from '../../../api/generated/api/servicios-y-ofertas.service';
import { UpdateOfertaRequest } from '../../../api/generated/model/update-oferta-request';
import { UpdateServicioRequest } from '../../../api/generated/model/update-servicio-request';

/**
 * Filtro de estado de los dos listados. Los tres valores son los del contrato.
 *
 * <p><b>No es un DTO manual.</b> Es la union de un <b>query param</b>, no un cuerpo que viaje
 * serializado, y el mismo precedente esta en `catalogos-page.ts`. Si el contrato agregara un
 * cuarto valor esto no deja de compilar -es un filtro de la pantalla, no la respuesta-, pero
 * si se escribe uno que el backend no acepta el resultado es un `400` inmediato y visible.
 */
export type FiltroEstado = 'ACTIVO' | 'INACTIVO' | 'TODOS';

/**
 * Unico punto de la feature `offering` que toca el cliente generado (M27, AKINE-02.06).
 *
 * <h2>Por que existe esta fachada, si AGENT.md 4.5 dice que los servicios de feature consumen
 * el cliente generado</h2>
 *
 * <p>Precisamente por eso: <b>esto es el servicio de feature</b>, y lo que consume el cliente
 * generado es exactamente un archivo. Las dos pantallas dependen de esta clase y de los tipos
 * del contrato, nunca de {@link ServiciosYOfertasService} directo.
 *
 * <p>El motivo concreto: el contrato 0.12.0 se publica <b>despues</b> de escribirse esta
 * feature -la regla de coordinacion del workspace prohibe asumir commits atomicos entre
 * repos-, asi que la primera regeneracion del cliente puede traer nombres que no coincidan
 * exactamente con los que aca se anticiparon. Cuando eso pase, lo que hay que corregir es
 * <b>este archivo</b> y no doce lugares repartidos entre dos plantillas y sus specs.
 *
 * <p><b>Lo que NO hace.</b> No traduce errores -eso es `models/offering-errors.ts`-, no
 * guarda estado y no sabe cual es la sede activa: el `consultorioId` entra por parametro
 * porque quien decide que hacer cuando no hay contexto es la pantalla, que tiene un estado
 * `sin-contexto` propio y un enlace al selector. Una fachada que leyera el contexto por su
 * cuenta convertiria ese caso en una peticion invalida o en un `undefined` silencioso.
 *
 * <p><b>Los tipos de request y response se importan del generado</b>, no se redeclaran
 * (ADR-0002). Eso incluye los tres `limpiar*` de {@link UpdateOfertaRequest}: la semantica de
 * "no lo toques" contra "sacaselo" vive en el contrato y la pantalla la expresa, no la
 * inventa.
 */
@Injectable({ providedIn: 'root' })
export class OfferingApi {
  private readonly api = inject(ServiciosYOfertasService);

  // ---------------------------------------------------------------------------------------
  // Catalogo global de Servicios. Autenticado para leer; rol de plataforma para mutar.
  // ---------------------------------------------------------------------------------------

  /**
   * Servicios del catalogo global.
   *
   * <p>`texto` vacio viaja como `undefined` y no como `''`: el cliente generado omite el
   * parametro y el backend distingue "sin filtro" de "filtra por la cadena vacia", que no
   * matchea nada. Es la misma decision que toma el catalogo clinico.
   *
   * <p><b>No lleva `consultorioId` ni depende del contexto.</b> El `Servicio` es puramente
   * global: no tiene `organizationId` (diseno 1). Lo que depende de la sede es la Oferta.
   */
  listarServicios(filtros: {
    readonly texto?: string;
    readonly estado: FiltroEstado;
  }): Observable<readonly ServicioResponse[]> {
    const texto = filtros.texto?.trim() ?? '';
    return this.api.listServicios({
      q: texto === '' ? undefined : texto,
      estado: filtros.estado,
    });
  }

  crearServicio(cuerpo: CreateServicioRequest): Observable<ServicioResponse> {
    return this.api.createServicio({ createServicioRequest: cuerpo });
  }

  /**
   * Edita un servicio global.
   *
   * <p>`cuerpo.expectedVersion` es obligatorio en el contrato y no tiene default: sin el, dos
   * ediciones concurrentes se pisan en silencio. El `409 conflict` que devuelve cuando quedo
   * vieja lo traduce `offering-errors.ts`.
   *
   * <p>El `codigo` <b>no</b> esta en {@link UpdateServicioRequest} y no es un olvido del
   * contrato: es la clave estable con la que el servicio se referencia, y renombrarla dejaria
   * huerfano todo lo que ya lo cito.
   */
  editarServicio(servicioId: number, cuerpo: UpdateServicioRequest): Observable<ServicioResponse> {
    return this.api.updateServicio({ servicioId, updateServicioRequest: cuerpo });
  }

  /**
   * Baja logica de un servicio global, con motivo obligatorio.
   *
   * <p>La baja <b>no cascadea</b> (diseno 7.8): las ofertas de los centros que lo referencian
   * siguen operando y conservan sus historicos. Lo que se impide es crear ofertas nuevas sobre
   * un servicio inactivo.
   */
  darDeBajaServicio(servicioId: number, motivo: string): Observable<unknown> {
    return this.api.deactivateServicio({
      servicioId,
      deactivateOfferingRequest: { reason: motivo },
    });
  }

  // ---------------------------------------------------------------------------------------
  // Ofertas de una sede. Lectura por pertenencia; mutaciones con `consultorio:manage`.
  // ---------------------------------------------------------------------------------------

  /**
   * Ofertas de una sede.
   *
   * <p>La organizacion <b>no</b> viaja en la ruta: sale del token acotado al contexto. Un
   * `consultorioId` de otro tenant responde `404`, nunca `403` — enumerar sedes ajenas
   * probando ids no puede distinguirse de pedir una que no existe.
   */
  listarOfertas(
    consultorioId: number,
    filtros: { readonly estado: FiltroEstado; readonly servicioId?: number },
  ): Observable<readonly OfertaResponse[]> {
    return this.api.listOfertas({
      consultorioId,
      estado: filtros.estado,
      servicioId: filtros.servicioId,
    });
  }

  crearOferta(consultorioId: number, cuerpo: CreateOfertaRequest): Observable<OfertaResponse> {
    return this.api.createOferta({ consultorioId, createOfertaRequest: cuerpo });
  }

  editarOferta(
    consultorioId: number,
    ofertaId: number,
    cuerpo: UpdateOfertaRequest,
  ): Observable<OfertaResponse> {
    return this.api.updateOferta({ consultorioId, ofertaId, updateOfertaRequest: cuerpo });
  }

  darDeBajaOferta(consultorioId: number, ofertaId: number, motivo: string): Observable<unknown> {
    return this.api.deactivateOferta({
      consultorioId,
      ofertaId,
      deactivateOfferingRequest: { reason: motivo },
    });
  }
}
