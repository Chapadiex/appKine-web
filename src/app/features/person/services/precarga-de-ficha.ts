import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot } from '@angular/router';
import { Observable, shareReplay } from 'rxjs';

import { PrecargaDeDatos } from '../../../core/guards/tras-restaurar-sesion';
import { SessionService } from '../../../core/services/session.service';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { ResumenDePersonaResponse } from '../../../api/generated/model/resumen-de-persona-response';
import { PersonApi } from './person-api';

/** Cuanto vive una precarga que nadie tomo: lo que tarda en llegar la pantalla, con holgura. */
const VIGENCIA_MS = 15_000;

interface Precarga {
  readonly personaId: number;
  readonly epoca: number;
  readonly vence: number;
  readonly respuesta: Observable<ResumenDePersonaResponse>;
}

/**
 * Adelanta la consulta del Paciente 360 en la primera carga de la ficha (AKINE-LCP).
 *
 * <p><b>Por que.</b> En una carga dura la cadena era: refresh → contextos y permisos → guards →
 * construir la pantalla → recien ahi pedir el resumen. El resumen solo necesita el token, que
 * existe desde el refresh: con la latencia movil de G-10 eran mas de 300 ms de espera en serie
 * sobre la pantalla que no cumplia el LCP. Ahora la pide {@link precargarResumenDeFicha} apenas
 * vuelve el refresh, en paralelo con el resto, y la pantalla toma esa respuesta en vez de salir de
 * nuevo a la red.
 *
 * <p><b>Que no cambia.</b> Es la misma peticion, con el mismo token: el backend la autoriza igual.
 * Los guards siguen decidiendo si la pantalla se abre; si no la abren, la respuesta se descarta.
 *
 * <p><b>Por que no puede mezclar datos.</b> Se toma UNA vez, solo para la misma persona, la misma
 * epoca de contexto (`contextEpoch`: elegir otra sede la invalida) y dentro de
 * {@link VIGENCIA_MS}. Cualquier otro caso consulta de nuevo, como siempre.
 */
@Injectable({ providedIn: 'root' })
export class PrecargaDeFicha {
  private readonly api = inject(PersonApi);
  private readonly session = inject(SessionService);
  private readonly tenantContext = inject(TenantContextStore);

  private precarga: Precarga | null = null;

  /** Pide el resumen apenas haya token con contexto. Idempotente para la misma persona. */
  precargar(personaId: number): void {
    if (this.vigente(personaId) !== null) {
      return;
    }
    this.session.esperarAcceso().subscribe(() => {
      // Sin contexto la consulta responderia 403: la pantalla ni se va a abrir (contextGuard).
      if (this.session.estado() !== 'activa' || this.vigente(personaId) !== null) {
        return;
      }
      const respuesta = this.api
        .resumen(personaId)
        .pipe(shareReplay({ bufferSize: 1, refCount: false }));
      // Sale ya: no espera a que la pantalla se suscriba. Un error no queda guardado
      // (`shareReplay` se reinicia): quien la tome despues vuelve a consultar y recibe el suyo.
      respuesta.subscribe({ error: () => undefined });
      this.precarga = {
        personaId,
        epoca: this.tenantContext.contextEpoch(),
        vence: Date.now() + VIGENCIA_MS,
        respuesta,
      };
    });
  }

  /** El resumen ya pedido para esta persona, si sigue valido. Se toma una sola vez. */
  tomar(personaId: number): Observable<ResumenDePersonaResponse> | null {
    const precarga = this.vigente(personaId);
    this.precarga = null;
    return precarga?.respuesta ?? null;
  }

  private vigente(personaId: number): Precarga | null {
    const precarga = this.precarga;
    if (
      precarga === null ||
      precarga.personaId !== personaId ||
      precarga.epoca !== this.tenantContext.contextEpoch() ||
      Date.now() >= precarga.vence
    ) {
      return null;
    }
    return precarga;
  }
}

/** Precarga de datos de la ruta de la ficha. Ver `DATA_PRECARGA_DE_DATOS`. */
export const precargarResumenDeFicha: PrecargaDeDatos = (ruta: ActivatedRouteSnapshot) => {
  const personaId = Number(ruta.paramMap.get('personaId'));
  if (Number.isInteger(personaId) && personaId > 0) {
    inject(PrecargaDeFicha).precargar(personaId);
  }
};
