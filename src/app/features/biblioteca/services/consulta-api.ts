import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';

import { ConsultaRequest } from '../../../api/generated/model/consulta-request';
import { OpcionDeAclaracionResponse } from '../../../api/generated/model/opcion-de-aclaracion-response';
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
  | { tipo: 'aclaracion'; texto: string; opciones: OpcionDeAclaracionResponse[] }
  | { tipo: 'etapa'; etapa: 'buscando' | 'redactando' }
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

      // Un fallo de refrescar() es de la sesion, no de la conexion: se propaga tal cual.
      let falloDeSesion: { error: unknown } | null = null;

      const correr = async (): Promise<void> => {
        let respuesta = await this.pedir(orgId, pedido, aborto.signal);
        if (respuesta.status === 401) {
          try {
            await firstValueFrom(this.sesion.refrescar());
          } catch (error) {
            falloDeSesion = { error };
            throw error;
          }
          respuesta = await this.pedir(orgId, pedido, aborto.signal);
        }
        if (!respuesta.ok || !respuesta.body) {
          throw await errorDeRespuesta(respuesta);
        }
        let terminado = false;
        for await (const { evento, datos } of leerEventosSse(respuesta.body)) {
          const emitido = aEvento(evento, datos);
          if (emitido) {
            terminado ||= emitido.tipo === 'fin' || emitido.tipo === 'error';
            suscriptor.next(emitido);
          }
        }
        // Sin `fin` ni `error` el corte fue de la red o de un proxy, no de la respuesta.
        if (!terminado) {
          throw errorDeConexion();
        }
        suscriptor.complete();
      };

      correr().catch((error: unknown) => {
        if (aborto.signal.aborted) {
          return;
        }
        const propio = falloDeSesion as { error: unknown } | null;
        suscriptor.error(
          propio ? propio.error : error instanceof AkineHttpError ? error : errorDeConexion(),
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

function errorDeConexion(): AkineHttpError {
  return new AkineHttpError(0, null, true);
}

const NOMBRES_CONOCIDOS = new Set(['espera', 'fuentes', 'texto', 'aclaracion', 'etapa', 'fin', 'error']);

/**
 * El evento tipado, o `null` si el nombre no se conoce (se ignora). Un evento conocido con JSON
 * roto o de forma inesperada lanza: perder un `fin` o un `error` dejaria la pantalla cargando.
 */
function aEvento(nombre: string, datos: string): EventoConsulta | null {
  if (!NOMBRES_CONOCIDOS.has(nombre)) {
    return null;
  }
  let cuerpo: Record<string, unknown>;
  try {
    const analizado: unknown = JSON.parse(datos);
    if (typeof analizado !== 'object' || analizado === null) {
      throw new Error('forma');
    }
    cuerpo = analizado as Record<string, unknown>;
  } catch {
    throw errorDeConexion();
  }
  switch (nombre) {
    case 'espera':
      if (typeof cuerpo['posicion'] === 'number') {
        return { tipo: 'espera', posicion: cuerpo['posicion'] };
      }
      break;
    case 'fuentes':
      if (Array.isArray(cuerpo['fuentes'])) {
        return { tipo: 'fuentes', fuentes: cuerpo['fuentes'] as FuenteDeConsultaResponse[] };
      }
      break;
    case 'texto':
      if (typeof cuerpo['texto'] === 'string') {
        return { tipo: 'texto', texto: cuerpo['texto'] };
      }
      break;
    case 'aclaracion':
      if (typeof cuerpo['texto'] === 'string' && Array.isArray(cuerpo['opciones'])) {
        const opciones = cuerpo['opciones'] as unknown[];
        const validas = opciones.every(
          (o) =>
            typeof o === 'object' &&
            o !== null &&
            typeof (o as Record<string, unknown>)['etiqueta'] === 'string' &&
            typeof (o as Record<string, unknown>)['pregunta'] === 'string',
        );
        if (validas) {
          return {
            tipo: 'aclaracion',
            texto: cuerpo['texto'],
            opciones: opciones as OpcionDeAclaracionResponse[],
          };
        }
      }
      break;
    case 'etapa':
      if (cuerpo['etapa'] === 'buscando' || cuerpo['etapa'] === 'redactando') {
        return { tipo: 'etapa', etapa: cuerpo['etapa'] };
      }
      break;
    case 'fin':
      if (typeof cuerpo['sinMaterial'] === 'boolean' && typeof cuerpo['camino'] === 'string') {
        return { tipo: 'fin', sinMaterial: cuerpo['sinMaterial'], camino: cuerpo['camino'] };
      }
      break;
    case 'error':
      if (typeof cuerpo['type'] === 'string') {
        return { tipo: 'error', type: cuerpo['type'] };
      }
      break;
  }
  throw errorDeConexion();
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
