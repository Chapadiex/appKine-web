import { HttpEvent } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BibliotecaService } from '../../../api/generated/api/biblioteca.service';
import { ListarLibrosRequestParams } from '../../../api/generated/api/biblioteca.serviceInterface';
import { BibliotecaBusquedaResponse } from '../../../api/generated/model/biblioteca-busqueda-response';
import { LibroDatosRequest } from '../../../api/generated/model/libro-datos-request';
import { LibroDetalleResponse } from '../../../api/generated/model/libro-detalle-response';
import { LibroPageResponse } from '../../../api/generated/model/libro-page-response';
import { LibroResponse } from '../../../api/generated/model/libro-response';

/** Filtros del listado. Los tipos de `estado` y `sort` son los del contrato. */
export interface FiltroDeLibros {
  readonly q?: string;
  readonly area?: string;
  readonly estado?: ListarLibrosRequestParams['estado'];
  readonly page?: number;
  readonly size?: number;
  readonly sort?: ListarLibrosRequestParams['sort'];
}

/** Datos del formulario de subida. La declaracion de derechos se exige en el tipo. */
export interface DatosDeSubida {
  readonly titulo: string;
  readonly autores?: string;
  readonly edicion?: string;
  readonly area?: string;
  readonly declaracionDerechos: true;
}

/**
 * Fachada de la feature sobre el cliente generado para la biblioteca del centro.
 *
 * <p>Mismo criterio que `EgresosApi`: metodos de nombre propio y nada de logica. La organizacion
 * la recibe cada metodo (es la del contexto). Subir y reemplazar emiten eventos HTTP para poder
 * mostrar el progreso real de un PDF grande.
 */
@Injectable({ providedIn: 'root' })
export class BibliotecaApi {
  private readonly api = inject(BibliotecaService);

  listar(orgId: number, filtro: FiltroDeLibros): Observable<LibroPageResponse> {
    return this.api.listarLibros({ orgId, ...filtro });
  }

  ver(orgId: number, id: number): Observable<LibroDetalleResponse> {
    return this.api.verLibro({ orgId, id });
  }

  subir(orgId: number, datos: DatosDeSubida, archivo: File): Observable<HttpEvent<LibroResponse>> {
    return this.api.subirLibro({ orgId, ...datos, archivo }, 'events', true);
  }

  reemplazar(
    orgId: number,
    id: number,
    archivo: File,
    declaracionDerechos: true,
  ): Observable<HttpEvent<LibroResponse>> {
    return this.api.reemplazarLibro({ orgId, id, archivo, declaracionDerechos }, 'events', true);
  }

  editar(orgId: number, id: number, datos: LibroDatosRequest): Observable<LibroResponse> {
    return this.api.editarLibro({ orgId, id, libroDatosRequest: datos });
  }

  reprocesar(orgId: number, id: number): Observable<LibroResponse> {
    return this.api.reprocesarLibro({ orgId, id });
  }

  activar(orgId: number, id: number): Observable<LibroResponse> {
    return this.api.activarLibro({ orgId, id });
  }

  desactivar(orgId: number, id: number): Observable<LibroResponse> {
    return this.api.desactivarLibro({ orgId, id });
  }

  eliminar(orgId: number, id: number): Observable<unknown> {
    return this.api.eliminarLibro({ orgId, id });
  }

  buscar(orgId: number, consulta: string, k = 5): Observable<BibliotecaBusquedaResponse> {
    return this.api.buscarEnBiblioteca({ orgId, bibliotecaBusquedaRequest: { consulta, k } });
  }
}
