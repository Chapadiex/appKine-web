import { HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { AdjuntoPageResponse } from '../../../api/generated/model/adjunto-page-response';
import { AdjuntoResponse } from '../../../api/generated/model/adjunto-response';
import { AdjuntosService } from '../../../api/generated/api/adjuntos.service';
import { ClasificarAdjuntoRequest } from '../../../api/generated/model/clasificar-adjunto-request';

/**
 * Categorias administrativas de un adjunto, en el orden en que se ofrecen.
 *
 * <p>Son las seis del contrato y <b>ninguna es clinica</b>, a proposito: RN-M25-005, y el `CHECK`
 * de `V40` lo hace cumplir del lado de la base. Un estudio o un informe vive en M09 con sus
 * propios controles, no aca. Si esta lista creciera con una categoria clinica, la pantalla
 * ofreceria una carga que el backend rechaza y el operador leeria el rechazo como un error suyo.
 */
export const CATEGORIAS_DE_ADJUNTO = [
  'DOCUMENTO_IDENTIDAD',
  'CREDENCIAL_COBERTURA',
  'CONSENTIMIENTO',
  'AUTORIZACION',
  'COMPROBANTE',
  'OTRO',
] as const;

export type CategoriaDeAdjunto = (typeof CATEGORIAS_DE_ADJUNTO)[number];

/** Filtro por ciclo de vida de la fila. `VIGENTES` es el default del backend. */
export type FiltroDeAdjuntos = 'VIGENTES' | 'TODOS';

/**
 * Unico punto de la feature que toca el cliente generado de adjuntos (M25, AKINE-03.02).
 *
 * <p>Mismo criterio que {@link PersonApi}: la pantalla depende de esta clase y de los tipos del
 * contrato, nunca de {@link AdjuntosService} directo.
 *
 * <h2>Lo que esta fachada NO hace, y es lo importante</h2>
 *
 * <p><b>No arma ninguna URL de descarga.</b> No existe: el contrato no devuelve rutas internas ni
 * URLs firmadas (RN-M25-002), y la razon esta escrita en el registro de cierre de la etapa —una
 * URL firmada seria un segundo camino de autorizacion, mas debil, con un token en la query string
 * que se copia, queda en los logs del proxy y no se puede revocar—. El contenido se pide con una
 * peticion autenticada como cualquier otra, y el backend autoriza <b>cada</b> llamada.
 *
 * <p><b>No decide el tipo del archivo.</b> El backend lo decide por los bytes y descarta el
 * `Content-Type` declarado, porque lo elige quien sube y no valida nada. La pantalla puede
 * sugerir extensiones en el selector, pero no puede prometer que algo va a entrar.
 *
 * <p><b>No reemplaza el contenido de un adjunto.</b> Lo unico editable es como esta descripto —su
 * categoria y su titulo—: reemplazar el archivo de una fila reescribiria un hecho. Para cambiar un
 * documento se da de baja el viejo y se sube el nuevo, que deja las dos versiones consultables.
 */
@Injectable({ providedIn: 'root' })
export class AdjuntosApi {
  private readonly api = inject(AdjuntosService);

  /**
   * Metadata de los adjuntos de una persona. <b>Nunca el contenido.</b>
   *
   * <p>`incluirDadosDeBaja` viaja solo cuando es `true`: omitido, el backend aplica su default
   * —los vigentes—, y mandar `false` explicito diria lo mismo con una URL distinta que despues
   * cuesta reconocer en un log.
   *
   * <p>Una persona INACTIVA lista igual: sus documentos siguen siendo consultables, que es
   * RN-M07-004 aplicada al documento en vez de a la persona.
   */
  listar(filtros: {
    readonly personaId: number;
    readonly categoria?: CategoriaDeAdjunto;
    readonly filtro: FiltroDeAdjuntos;
    readonly pagina: number;
    readonly tamano: number;
  }): Observable<AdjuntoPageResponse> {
    return this.api.listarAdjuntosDePersona({
      personaId: filtros.personaId,
      categoria: filtros.categoria,
      incluirDadosDeBaja: filtros.filtro === 'TODOS' ? true : undefined,
      page: filtros.pagina,
      size: filtros.tamano,
    });
  }

  /**
   * Sube un documento administrativo (RF-M25-001).
   *
   * <p><b>Es idempotente del lado del servidor</b>, y eso decide como se comporta la pantalla:
   * subir dos veces el mismo archivo a la misma persona devuelve 200 con el adjunto que ya existe,
   * no 201 y no 409. Una subida es la operacion mas expuesta a reintentos del producto —mostrador,
   * varios MB, timeouts— asi que la pantalla no tiene que prevenir el doble click con un candado
   * propio ni avisar de un duplicado que el backend ya resolvio.
   *
   * <p>El `titulo` vacio viaja como `undefined`: es la diferencia entre "no le pongas titulo" y
   * "ponele el titulo vacio", y el segundo deja una fila que en la tabla se lee como un hueco.
   */
  subir(
    personaId: number,
    categoria: CategoriaDeAdjunto,
    archivo: Blob,
    titulo: string | undefined,
  ): Observable<AdjuntoResponse> {
    return this.api.subirAdjuntoDePersona({
      personaId,
      categoria,
      archivo,
      titulo: titulo === '' ? undefined : titulo,
    });
  }

  /**
   * Descarga el contenido, con la respuesta entera y no solo el cuerpo.
   *
   * <p><b>Los dos parametros del final no son decorativos y sin ellos esto no funciona.</b>
   * `observe: 'response'` es lo que deja leer `Content-Disposition`, que es de donde sale el
   * nombre con el que el archivo se guarda; y `httpHeaderAccept: 'application/octet-stream'` es lo
   * que hace que el cliente generado use `responseType: 'blob'`. Sin el segundo, el generado
   * negocia `application/problem+json` —el de sus errores—, lo reconoce como JSON y trata un PDF
   * como texto a parsear: la descarga falla con un error de parseo que no dice nada.
   *
   * <p>Se descarga <b>aunque el adjunto o la persona esten dados de baja</b>: una baja logica dice
   * "esto ya no corresponde para operar", no "esto nunca existio". Y cada descarga se audita del
   * lado del backend: es el unico evento de lectura que M25 registra, porque un listado no entrega
   * contenido y una descarga si.
   */
  descargar(personaId: number, adjuntoId: number): Observable<HttpResponse<Blob>> {
    return this.api.descargarAdjuntoDePersona({ personaId, adjuntoId }, 'response', false, {
      httpHeaderAccept: 'application/octet-stream',
    }) as Observable<HttpResponse<Blob>>;
  }

  /**
   * Reclasifica un adjunto vigente (RF-M25-003). Edicion parcial: lo que no viaja, no se toca.
   *
   * <p>Un adjunto dado de baja responde 409: se sigue descargando, no se reclasifica.
   */
  reclasificar(
    personaId: number,
    adjuntoId: number,
    categoria: CategoriaDeAdjunto,
    titulo: string | undefined,
  ): Observable<AdjuntoResponse> {
    return this.api.clasificarAdjuntoDePersona({
      personaId,
      adjuntoId,
      clasificarAdjuntoRequest: {
        // El cast es el mismo caso que el tipo de documento en el padron: el generador emite UN
        // ENUM POR DTO, asi que la categoria del cuerpo de reclasificacion es un tipo distinto del
        // de la subida —que ahi es una union de literales, no un enum— aunque los seis valores
        // sean identicos. {@link CategoriaDeAdjunto} es la union comun y el cast se hace una sola
        // vez, aca, con el tipo que este cuerpo declara.
        categoria: categoria as ClasificarAdjuntoRequest['categoria'],
        titulo: titulo === '' ? undefined : titulo,
      },
    });
  }

  /**
   * Baja logica con motivo obligatorio (RF-M25-004).
   *
   * <p><b>El binario no se borra</b>, y eso es lo que hace que el historico siga resolviendo: el
   * contenido se sigue pudiendo descargar despues de la baja. Un adjunto ya dado de baja responde
   * 409.
   */
  darDeBaja(personaId: number, adjuntoId: number, motivo: string): Observable<AdjuntoResponse> {
    return this.api.darDeBajaAdjuntoDePersona({
      personaId,
      adjuntoId,
      bajaDeAdjuntoRequest: { motivo },
    });
  }
}
