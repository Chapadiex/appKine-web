import { HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ReporteResponse } from '../../../api/generated/model/reporte-response';
import { Observable } from 'rxjs';

import { CatalogoDeReportesResponse } from '../../../api/generated/model/catalogo-de-reportes-response';
import { ReportesService } from '../../../api/generated/api/reportes.service';
import { SerieDeReporte } from '../../../api/generated/model/serie-de-reporte';
import { CodigoDeReporte } from '../models/reportes';

/**
 * Fachada de M23 sobre el cliente generado (AGENT.md §4.5: las features no usan `HttpClient`).
 */
@Injectable({ providedIn: 'root' })
export class ReportesApi {
  private readonly api = inject(ReportesService);

  catalogo(consultorioId: number): Observable<CatalogoDeReportesResponse> {
    return this.api.catalogoDeReportes({ consultorioId });
  }

  generar(
    consultorioId: number,
    reporte: CodigoDeReporte,
    desde: string,
    hasta: string,
  ): Observable<ReporteResponse> {
    return this.api.generarReporte({ consultorioId, reporte, desde, hasta });
  }

  /**
   * Los indicadores sumables abiertos por dia o por semana, para el grafico (DP-45). Mismo permiso
   * y mismas omisiones que el reporte; la suma de los puntos de cada serie es su indicador.
   */
  serie(
    consultorioId: number,
    reporte: CodigoDeReporte,
    desde: string,
    hasta: string,
    agrupacion: 'DIA' | 'SEMANA',
  ): Observable<SerieDeReporte> {
    return this.api.generarSerieDeReporte({ consultorioId, reporte, desde, hasta, agrupacion });
  }

  /**
   * El CSV con la misma computacion que la pantalla (RF-M23-006).
   *
   * <p><b>El `Accept` va fijo en `text/csv`.</b> Sin el, el cliente generado elige
   * `application/problem+json` —es el primer tipo JSON de la lista—, pide la respuesta como JSON
   * y el servidor, que produce CSV, contesta 406 antes de entrar al metodo.
   *
   * <p><b>Se pide la respuesta entera y no solo el cuerpo</b>: el nombre del archivo lo decide el
   * servidor en `Content-Disposition`, igual que el CSV de una presentacion.
   */
  exportar(
    consultorioId: number,
    reporte: CodigoDeReporte,
    desde: string,
    hasta: string,
  ): Observable<HttpResponse<string>> {
    return this.api.exportarReporte({ consultorioId, reporte, desde, hasta }, 'response', false, {
      httpHeaderAccept: 'text/csv',
    }) as Observable<HttpResponse<string>>;
  }
}
