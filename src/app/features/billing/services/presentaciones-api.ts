import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CuentaCorrienteDeFinanciador } from '../../../api/generated/model/cuenta-corriente-de-financiador';
import { FinanciadorResponse } from '../../../api/generated/model/financiador-response';
import { FinanciadoresYPlanesService } from '../../../api/generated/api/financiadores-y-planes.service';
import { Obligacion } from '../../../api/generated/model/obligacion';
import { PagoDeFinanciador } from '../../../api/generated/model/pago-de-financiador';
import { Presentacion } from '../../../api/generated/model/presentacion';
import { PresentacionItem } from '../../../api/generated/model/presentacion-item';
import { PresentacionesService } from '../../../api/generated/api/presentaciones.service';
import { CrearPresentacion } from '../../../api/generated/model/crear-presentacion';
import { RegistrarPagoDeFinanciador } from '../../../api/generated/model/registrar-pago-de-financiador';
import { ValidacionDePresentacion } from '../../../api/generated/model/validacion-de-presentacion';

/** Filtros de la bandeja. Todos opcionales: sin ninguno, el backend trae todo lo de la sede. */
export interface FiltroDePresentaciones {
  readonly estado?: string;
  readonly financiadorId?: number;
  readonly desde?: string;
  readonly hasta?: string;
}

/**
 * Fachada de la feature sobre el cliente generado para M21 (AKINE-07.04).
 *
 * <p>Existe por lo mismo que `BillingApi`: las paginas hablan con metodos de nombre propio y los
 * specs interceptan HTTP, no un mock de esta clase. No agrega ni transforma datos —el contrato es
 * la autoridad—, solo arma los `RequestParams`.
 *
 * <p>La lista de financiadores sale de `contracting` por el cliente generado y no importando la
 * feature `contracting` (AGENT.md 4.4: un feature no importa de otro).
 */
@Injectable({ providedIn: 'root' })
export class PresentacionesApi {
  private readonly api = inject(PresentacionesService);
  private readonly financiadores = inject(FinanciadoresYPlanesService);

  financiadoresActivos(): Observable<readonly FinanciadorResponse[]> {
    return this.financiadores.listFinanciadores({});
  }

  buscar(
    consultorioId: number,
    filtro: FiltroDePresentaciones,
  ): Observable<readonly Presentacion[]> {
    return this.api.buscarPresentacion({ consultorioId, ...filtro });
  }

  crear(consultorioId: number, crearPresentacion: CrearPresentacion): Observable<Presentacion> {
    return this.api.crear({ consultorioId, crearPresentacion });
  }

  detalle(consultorioId: number, presentacionId: number): Observable<Presentacion> {
    return this.api.detalle({ consultorioId, presentacionId });
  }

  elegibles(
    consultorioId: number,
    financiadorId: number,
    desde?: string,
    hasta?: string,
  ): Observable<readonly Obligacion[]> {
    return this.api.elegibles({ consultorioId, financiadorId, desde, hasta });
  }

  agregarItem(
    consultorioId: number,
    presentacionId: number,
    obligacionId: number,
  ): Observable<PresentacionItem> {
    return this.api.agregarItem({
      consultorioId,
      presentacionId,
      agregarItemAPresentacion: { obligacionId },
    });
  }

  quitarItem(consultorioId: number, presentacionId: number, itemId: number): Observable<unknown> {
    return this.api.quitarItem({ consultorioId, presentacionId, itemId });
  }

  validar(consultorioId: number, presentacionId: number): Observable<ValidacionDePresentacion> {
    return this.api.validar({ consultorioId, presentacionId });
  }

  confirmar(consultorioId: number, presentacionId: number): Observable<Presentacion> {
    return this.api.confirmarPresentacion({ consultorioId, presentacionId });
  }

  anular(consultorioId: number, presentacionId: number, motivo: string): Observable<Presentacion> {
    return this.api.anularPresentacion({
      consultorioId,
      presentacionId,
      anularPresentacion: { motivo },
    });
  }

  registrarFactura(
    consultorioId: number,
    presentacionId: number,
    numero: string,
    fecha: string,
  ): Observable<Presentacion> {
    return this.api.registrarFactura({
      consultorioId,
      presentacionId,
      registrarFacturaDePresentacion: { numero, fecha },
    });
  }

  debitar(
    consultorioId: number,
    presentacionId: number,
    itemId: number,
    importe: number,
    motivo: string,
  ): Observable<PresentacionItem> {
    return this.api.debitar({
      consultorioId,
      presentacionId,
      itemId,
      registrarDebito: { importe, motivo },
    });
  }

  registrarPago(
    consultorioId: number,
    presentacionId: number,
    pago: RegistrarPagoDeFinanciador,
  ): Observable<PagoDeFinanciador> {
    return this.api.registrarPago({
      consultorioId,
      presentacionId,
      registrarPagoDeFinanciador: pago,
    });
  }

  pagosDelLote(
    consultorioId: number,
    presentacionId: number,
  ): Observable<readonly PagoDeFinanciador[]> {
    return this.api.pagosDelLote({ consultorioId, presentacionId });
  }

  conciliar(consultorioId: number, presentacionId: number): Observable<Presentacion> {
    return this.api.conciliar({ consultorioId, presentacionId });
  }

  cuentaCorriente(
    consultorioId: number,
    financiadorId: number,
  ): Observable<CuentaCorrienteDeFinanciador> {
    return this.api.cuentaCorriente({ consultorioId, financiadorId });
  }
}
