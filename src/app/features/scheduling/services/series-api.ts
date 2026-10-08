import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { AlcanceDeSerie } from '../../../api/generated/model/alcance-de-serie';
import { CancelarSerieDeTurnosAlcanceEnum } from '../../../api/generated/model/cancelar-serie-de-turnos';
import { CrearSerieDeTurnos } from '../../../api/generated/model/crear-serie-de-turnos';
import { SerieDeTurnos } from '../../../api/generated/model/serie-de-turnos';
import { SerieDeTurnosPage } from '../../../api/generated/model/serie-de-turnos-page';
import { SeriesDeTurnosService } from '../../../api/generated/api/series-de-turnos.service';
import { ListarSeriesDeTurnosRequestParams } from '../../../api/generated/api/series-de-turnos.serviceInterface';

/** Los tres alcances que el contrato admite. Es el enum generado, con un nombre de la feature. */
export type AlcanceSerie = CancelarSerieDeTurnosAlcanceEnum;

/** Filtro de la bandeja: los parametros de `listarSeriesDeTurnos` sin la sede. */
export type FiltroDeSeries = Omit<ListarSeriesDeTurnosRequestParams, 'consultorioId'>;

/**
 * Fachada de las series de turnos (M12, AKINE E-3, DP-04).
 *
 * <p>Es una clase aparte de `SchedulingApi` a proposito: las series son un tag propio del contrato
 * (`Series de turnos`) y mantenerlas separadas deja a la fachada de la agenda sin cambios mientras
 * otras etapas la tocan. Mismo criterio que el resto: las pantallas dependen de esta clase y de los
 * tipos del contrato, nunca del servicio generado directo.
 *
 * <h2>Lo que el contrato ofrece y lo que no</h2>
 *
 * <ul>
 *   <li><b>El alta es todo o nada.</b> No hay previsualizacion previa al alta: si una ocurrencia no
 *       tiene lugar el 409 conserva el tipo de la causa y agrega `ocurrenciaInicio`. La pantalla
 *       arma su propia previsualizacion leyendo la agenda, que es orientativa.</li>
 *   <li><b>La cancelacion con alcance si tiene previsualizacion</b> (`GET .../alcance`), y el
 *       comando exige `cantidadConfirmada`: la cantidad de afectados que se le mostro al
 *       operador. Si cambio entre medio, 409 `conflict` y no se cancela nada.</li>
 *   <li><b>El listado llego con el contrato 0.68.0</b> (E-8, {@link listar}): la bandeja de la
 *       sede, filtrable por persona y por estado. Antes una serie solo se alcanzaba por su id.</li>
 * </ul>
 */
@Injectable({ providedIn: 'root' })
export class SeriesApi {
  private readonly series = inject(SeriesDeTurnosService);

  /**
   * Reserva todas las ocurrencias de la regla, o ninguna.
   *
   * <p>`idempotencyKey` cumple el mismo papel que en la reserva suelta: un reintento del mismo
   * intento devuelve 200 con la serie ya creada en vez de una segunda serie.
   */
  crear(consultorioId: number, cuerpo: CrearSerieDeTurnos): Observable<SerieDeTurnos> {
    return this.series.crearSerieDeTurnos({ consultorioId, crearSerieDeTurnos: cuerpo });
  }

  /**
   * Bandeja de series de la sede, mas nuevas primero (AKINE E-8). Exige `turno:read`.
   *
   * <p>El estado no es una columna: el backend lo deriva de los turnos al leer, con el mismo
   * instante con que filtra. `size` se acota a 100 del lado del servidor.
   */
  listar(consultorioId: number, filtro: FiltroDeSeries): Observable<SerieDeTurnosPage> {
    return this.series.listarSeriesDeTurnos({ consultorioId, ...filtro });
  }

  /** La regla y los turnos tal como estan hoy, en cualquier estado. Exige `turno:read`. */
  ver(consultorioId: number, serieId: number): Observable<SerieDeTurnos> {
    return this.series.verSerieDeTurnos({ consultorioId, serieId });
  }

  /**
   * Que turnos tocaria una operacion con ese alcance, sin tocar nada.
   *
   * <p>`turnoId` es el pivote. Es obligatorio salvo en `TODA_LA_SERIE`.
   */
  previsualizar(
    consultorioId: number,
    serieId: number,
    alcance: AlcanceSerie,
    turnoId?: number,
  ): Observable<AlcanceDeSerie> {
    return this.series.previsualizarAlcanceDeSerie({ consultorioId, serieId, alcance, turnoId });
  }

  /**
   * Cancela los turnos futuros pendientes del alcance.
   *
   * <p><b>No es idempotente</b>: repetirla da 409. `cantidadConfirmada` es la cantidad de afectados
   * que mostro {@link previsualizar}; el motivo es obligatorio (DP-04).
   */
  cancelar(
    consultorioId: number,
    serieId: number,
    cuerpo: {
      readonly alcance: AlcanceSerie;
      readonly turnoId?: number;
      readonly motivo: string;
      readonly cantidadConfirmada: number;
    },
  ): Observable<AlcanceDeSerie> {
    return this.series.cancelarSerieDeTurnos({
      consultorioId,
      serieId,
      cancelarSerieDeTurnos: {
        alcance: cuerpo.alcance,
        turnoId: cuerpo.turnoId,
        motivo: cuerpo.motivo,
        cantidadConfirmada: cuerpo.cantidadConfirmada,
      },
    });
  }
}
