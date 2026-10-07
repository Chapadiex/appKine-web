import { Injectable, inject } from '@angular/core';
import { ReporteResponse } from '../../../api/generated/model/reporte-response';
import { Observable } from 'rxjs';

import { CatalogoDeReportesResponse } from '../../../api/generated/model/catalogo-de-reportes-response';
import { ReportesService } from '../../../api/generated/api/reportes.service';
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
   * El CSV con la misma computacion que la pantalla (RF-M23-006).
   *
   * <p><b>El `Accept` va fijo en `text/csv`.</b> Sin el, el cliente generado elige
   * `application/problem+json` —es el primer tipo JSON de la lista—, pide la respuesta como JSON
   * y el servidor, que produce CSV, contesta 406 antes de entrar al metodo.
   */
  exportar(
    consultorioId: number,
    reporte: CodigoDeReporte,
    desde: string,
    hasta: string,
  ): Observable<string> {
    return this.api.exportarReporte({ consultorioId, reporte, desde, hasta }, 'body', false, {
      httpHeaderAccept: 'text/csv',
    });
  }
}
