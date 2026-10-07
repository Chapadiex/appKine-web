import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CajaService } from '../../../api/generated/api/caja.service';
import { JornadaCaja, JornadaCajaEstadoEnum } from '../../../api/generated/model/jornada-caja';
import { MovimientoDeCaja } from '../../../api/generated/model/movimiento-de-caja';
import { RegistrarMovimientoDeCaja } from '../../../api/generated/model/registrar-movimiento-de-caja';

/**
 * Unico punto de la pantalla de caja que toca el cliente generado (M20, AKINE-07.03).
 *
 * <p>Mismo criterio que `BillingApi`: la pantalla depende de esta clase y de los tipos del
 * contrato. Vive aparte porque <b>Caja no es Cobro</b> (regla maestra 5): un cobro con tarjeta
 * existe sin caja abierta, y un movimiento manual de caja no tiene deuda detras.
 *
 * <p>Los importes llegan aca ya convertidos desde centavos enteros (`models/dinero.ts`): esta
 * clase no hace ninguna cuenta.
 */
@Injectable({ providedIn: 'root' })
export class CajaApi {
  private readonly api = inject(CajaService);

  /**
   * La jornada abierta de la sede, o `null` si la caja esta cerrada.
   *
   * <p>El contrato no tiene un "jornada actual": se encuentra filtrando el historico por
   * `estado = ABIERTA`, que es lo que la propia descripcion de la operacion indica. A lo sumo hay
   * una, porque la base lo garantiza con un unique.
   */
  jornadaAbierta(consultorioId: number): Observable<readonly JornadaCaja[]> {
    return this.api.jornadas({ consultorioId, estado: JornadaCajaEstadoEnum.ABIERTA, limite: 1 });
  }

  /** Releida con su saldo teorico y el desglose por medio, que el listado trae vacio. */
  verJornada(consultorioId: number, jornadaId: number): Observable<JornadaCaja> {
    return this.api.verJornada({ consultorioId, jornadaId });
  }

  movimientos(consultorioId: number, jornadaId: number): Observable<readonly MovimientoDeCaja[]> {
    return this.api.movimientos({ consultorioId, jornadaId });
  }

  abrir(consultorioId: number, moneda: string, saldoInicial: number): Observable<JornadaCaja> {
    return this.api.abrir({ consultorioId, abrirCaja: { moneda, saldoInicial } });
  }

  /**
   * Ingreso o egreso manual. Igual que en el cobro, la clave de idempotencia se exige en el tipo
   * aunque el contrato la declare opcional: sin ella un doble click descuadra el arqueo.
   */
  registrarMovimiento(
    consultorioId: number,
    movimiento: RegistrarMovimientoDeCaja & { readonly idempotencyKey: string },
  ): Observable<MovimientoDeCaja> {
    return this.api.registrarMovimiento({ consultorioId, registrarMovimientoDeCaja: movimiento });
  }

  revertir(
    consultorioId: number,
    movimientoId: number,
    motivo: string,
  ): Observable<MovimientoDeCaja> {
    return this.api.revertirMovimiento({
      consultorioId,
      movimientoId,
      revertirMovimientoDeCaja: { motivo },
    });
  }

  /**
   * Arquea y cierra. `saldoTeoricoEsperado` es el teorico que la pantalla mostraba al empezar a
   * contar: si entro plata mientras tanto, el backend responde 409 `caja-saldo-cambio` en vez de
   * registrar un faltante que no existio.
   */
  cerrar(
    consultorioId: number,
    jornadaId: number,
    saldoDeclarado: number,
    saldoTeoricoEsperado: number,
    motivoDiferencia: string | undefined,
  ): Observable<JornadaCaja> {
    return this.api.cerrarCaja({
      consultorioId,
      jornadaId,
      cerrarCaja: { saldoDeclarado, saldoTeoricoEsperado, motivoDiferencia },
    });
  }
}
