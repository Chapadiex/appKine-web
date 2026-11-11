import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';

import { ConsultaEventoError } from '../../../api/generated/model/consulta-evento-error';
import { ConsultaEventoEspera } from '../../../api/generated/model/consulta-evento-espera';
import { ConsultaEventoFin } from '../../../api/generated/model/consulta-evento-fin';
import { ConsultaEventoFuentes } from '../../../api/generated/model/consulta-evento-fuentes';
import { ConsultaEventoTexto } from '../../../api/generated/model/consulta-evento-texto';
import { ConsultaRequest } from '../../../api/generated/model/consulta-request';
import { FuenteDeConsultaResponse } from '../../../api/generated/model/fuente-de-consulta-response';
import { environment } from '../../../../environments/environment';
import { AkineHttpError, ProblemDetail } from '../../../core/interceptors/error.interceptor';
import { AuthTokenStore } from '../../../core/services/auth-token.store';
import { SessionService } from '../../../core/services/session.service';
import { leerEventosSse } from '../models/lector-sse';

/** Lo que el servidor va contando durante una consulta, ya tipado. */
export type EventoConsulta =
  | { tipo: 'espera'; posicion: number }
  | { tipo: 'fuentes'; fuentes: FuenteDeConsultaResponse[] }
  | { tipo: 'texto'; texto: string }
  | { tipo: 'fin'; sinMaterial: boolean; camino: string }
  | { tipo: 'error'; type: string };

/**
 * Consulta a la biblioteca con el asistente.
 *
 * <p>El cliente generado de Angular no sabe leer un stream, asi que esta fachada usa `fetch`:
 * agrega el `Authorization` a mano, renueva la sesion una vez ante un 401 previo al stream y
 * convierte cualquier rechazo previo al stream en el mismo `AkineHttpError` que arma el
 * interceptor, para que `traducirErrorBiblioteca` lo entienda. Desuscribirse aborta el `fetch`
 * y, con eso, el backend libera su turno de la cola.
 */
@Injectable({ providedIn: 'root' })
export class ConsultaApi {
  private readonly token = inject(AuthTokenStore);
  private readonly sesion = inject(SessionService);

  consultar(orgId: number, pedido: ConsultaRequest): Observable<EventoConsulta> {
    return new Observable<EventoConsulta>((suscriptor) => {
      const aborto = new AbortController();

      const correr = async (): Promise<void> => {
        let respuesta = await this.pedir(orgId, pedido, aborto.signal);
        if (respuesta.status === 401) {
          await firstValueFrom(this.sesion.refrescar());
          respuesta = await this.pedir(orgId, pedido, aborto.signal);
        }
        if (!respuesta.ok || !respuesta.body) {
          throw await errorDeRespuesta(respuesta);
        }
        for await (const { evento, datos } of leerEventosSse(respuesta.body)) {
          const emitido = aEvento(evento, datos);
          if (emitido) {
            suscriptor.next(emitido);
          }
        }
        suscriptor.complete();
      };

      correr().catch((error: unknown) => {
        if (aborto.signal.aborted) {
          return;
        }
        suscriptor.error(
          error instanceof AkineHttpError ? error : new AkineHttpError(0, null, true),
        );
      });

      return () => aborto.abort();
    });
  }

  private pedir(orgId: number, pedido: ConsultaRequest, signal: AbortSignal): Promise<Response> {
    const token = this.token.token();
    return fetch(`${environment.apiBaseUrl}/api/v1/organizations/${orgId}/biblioteca/consultas`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(pedido),
      credentials: 'include',
      signal,
    });
  }
}

function aEvento(nombre: string, datos: string): EventoConsulta | null {
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(datos);
  } catch {
    return null;
  }
  switch (nombre) {
    case 'espera':
      return { tipo: 'espera', posicion: (cuerpo as ConsultaEventoEspera).posicion };
    case 'fuentes':
      return { tipo: 'fuentes', fuentes: (cuerpo as ConsultaEventoFuentes).fuentes };
    case 'texto':
      return { tipo: 'texto', texto: (cuerpo as ConsultaEventoTexto).texto };
    case 'fin': {
      const fin = cuerpo as ConsultaEventoFin;
      return { tipo: 'fin', sinMaterial: fin.sinMaterial, camino: fin.camino };
    }
    case 'error':
      return { tipo: 'error', type: (cuerpo as ConsultaEventoError).type };
    default:
      return null;
  }
}

/** El mismo `AkineHttpError` que produce `errorInterceptor` para una respuesta no 2xx. */
async function errorDeRespuesta(respuesta: Response): Promise<AkineHttpError> {
  let problem: ProblemDetail | null;
  try {
    const analizado: unknown = JSON.parse(await respuesta.text());
    problem =
      typeof analizado === 'object' && analizado !== null ? (analizado as ProblemDetail) : null;
  } catch {
    problem = null;
  }
  const crudo = respuesta.headers.get('Retry-After');
  const segundos = crudo === null ? NaN : Number(crudo);
  const espera = Number.isFinite(segundos) && segundos >= 0 ? segundos : null;
  return new AkineHttpError(respuesta.status, problem, false, espera);
}
