import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { AlertaDeAutorizacionResponse } from '../../../api/generated/model/alerta-de-autorizacion-response';
import { AutorizacionElegibleResponse } from '../../../api/generated/model/autorizacion-elegible-response';
import { AutorizacionesService } from '../../../api/generated/api/autorizaciones.service';
import { ConsumoDeAutorizacionesService } from '../../../api/generated/api/consumo-de-autorizaciones.service';
import { MovimientoResponse } from '../../../api/generated/model/movimiento-response';
import { SaldoAutorizacionResponse } from '../../../api/generated/model/saldo-autorizacion-response';

/**
 * Saldo, ledger, alertas y reversion de una autorizacion, y el selector explicable (M17, C-4, D-f).
 *
 * <p>Fachada aparte de {@link DocumentosApi} porque habla de <b>otra cosa</b>: aquella carga y
 * corrige papeles; esta explica que paso con las unidades que esos papeles otorgaron. Nada de lo
 * que hay aca consume: el consumo nace solo del cierre de una sesion (C-4 §1).
 *
 * <h2>Revertir no es "deshacer la anulacion"</h2>
 *
 * <p>Anular la deuda de una sesion no devuelve la unidad (DP-13): deja una alerta "consumo a
 * revisar". Devolverla es una decision humana con motivo obligatorio, y crea una fila de
 * compensacion en el ledger sin borrar el consumo original. La alerta se resuelve sola con esa
 * reversion; no existe endpoint para descartarla sin revertir (C-4 §9.1, decision abierta).
 */
@Injectable({ providedIn: 'root' })
export class ConsumosApi {
  private readonly consumos = inject(ConsumoDeAutorizacionesService);
  private readonly autorizaciones = inject(AutorizacionesService);

  saldo(autorizacionId: number): Observable<SaldoAutorizacionResponse> {
    return this.consumos.consultarSaldoDeAutorizacion({ autorizacionId });
  }

  /** Del mas viejo al mas nuevo: es una linea de tiempo, no una bandeja. */
  movimientos(autorizacionId: number): Observable<MovimientoResponse[]> {
    return this.consumos.listMovimientosDeAutorizacion({ autorizacionId });
  }

  /** Pendientes y resueltas: una alerta se resuelve, no se borra. */
  alertas(autorizacionId: number): Observable<AlertaDeAutorizacionResponse[]> {
    return this.consumos.listAlertasDeAutorizacion({ autorizacionId });
  }

  revertir(
    autorizacionId: number,
    movimientoId: number,
    motivo: string,
  ): Observable<MovimientoResponse> {
    return this.consumos.revertirConsumoDeAutorizacion({
      autorizacionId,
      revertirConsumoRequest: { movimientoId, motivo },
    });
  }

  /**
   * Todas las autorizaciones activas con su veredicto para un dia, en el orden en que el cierre
   * las gasta: primero las que habilitan y, dentro de cada grupo, la que vence antes.
   */
  candidatas(
    personaId: number,
    fecha: string | undefined,
  ): Observable<AutorizacionElegibleResponse[]> {
    return this.autorizaciones.listAutorizacionesElegibles({ personaId, fecha });
  }
}
