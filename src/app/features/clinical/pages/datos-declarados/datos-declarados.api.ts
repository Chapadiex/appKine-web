import { HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { AdjuntosClinicosService } from '../../../../api/generated/api/adjuntos-clinicos.service';
import { DatosDeclaradosService } from '../../../../api/generated/api/datos-declarados.service';
import { HistoriaClinicaService } from '../../../../api/generated/api/historia-clinica.service';
import { OcupacionesService } from '../../../../api/generated/api/ocupaciones.service';
import { AdjuntoClinicoResponse } from '../../../../api/generated/model/adjunto-clinico-response';
import { AntecedenteResponse } from '../../../../api/generated/model/antecedente-response';
import { DatosDeclaradosResponse } from '../../../../api/generated/model/datos-declarados-response';
import { FichaDeIngresoRequest } from '../../../../api/generated/model/ficha-de-ingreso-request';
import { FichaDeIngresoResponse } from '../../../../api/generated/model/ficha-de-ingreso-response';
import { OcupacionResponse } from '../../../../api/generated/model/ocupacion-response';
import { RegistrarAntecedenteRequest } from '../../../../api/generated/model/registrar-antecedente-request';
import { Justificacion, motivoDeAcceso } from '../../services/historia-clinica-api';

export type { DatosDeclaradosResponse };
export type AntecedenteDeclarado = AntecedenteResponse;
export type AdjuntoDeclarado = AdjuntoClinicoResponse;
export type TipoDatoDeclarado = 'antecedentes' | 'adjuntos';
export type { FichaDeIngresoRequest, FichaDeIngresoResponse, OcupacionResponse };

/** Detalle opcional de la ficha de ingreso: cirugia (zona, año, lugar) o enfermedad de la lista. */
export interface DetalleDeAntecedente {
  zona?: string;
  anio?: number;
  lugar?: string;
  codigo?: string;
}

/** Categorias que se pueden declarar (DP-47). El resto es del profesional. */
export type CategoriaDeclarable = 'ESTUDIO' | 'INFORME' | 'IMAGEN' | 'OTRO';

/**
 * Acceso a los datos que declara el paciente (DP-47) y a la revision del profesional, sobre el
 * cliente generado (contrato 0.173.0). Una sola puerta para las pantallas de `clinical`, incluida la
 * ficha de ingreso (declarada o del profesional) y el catalogo de ocupaciones.
 */
@Injectable({ providedIn: 'root' })
export class DatosDeclaradosApi {
  private readonly declarados = inject(DatosDeclaradosService);
  private readonly historias = inject(HistoriaClinicaService);
  private readonly adjuntos = inject(AdjuntosClinicosService);
  private readonly ocupacionesApi = inject(OcupacionesService);

  ver(personaId: number, justificacion: Justificacion): Observable<DatosDeclaradosResponse> {
    return this.declarados.verDatosDeclarados({ personaId, ...motivoDeAcceso(justificacion) });
  }

  declararAntecedente(
    personaId: number,
    tipo: string,
    descripcion: string,
    justificacion: Justificacion,
    detalle: DetalleDeAntecedente = {},
  ): Observable<AntecedenteDeclarado> {
    return this.declarados.declararAntecedente({
      personaId,
      registrarAntecedenteRequest: {
        tipo: tipo as RegistrarAntecedenteRequest['tipo'],
        descripcion,
        ...(detalle as Partial<RegistrarAntecedenteRequest>),
      },
      ...motivoDeAcceso(justificacion),
    });
  }

  declararAdjunto(
    personaId: number,
    archivo: File,
    categoria: string,
    titulo: string,
    justificacion: Justificacion,
  ): Observable<AdjuntoDeclarado> {
    return this.declarados.declararAdjunto({
      personaId,
      archivo,
      categoria: categoria as CategoriaDeclarable,
      ...(titulo === '' ? {} : { titulo }),
      ...motivoDeAcceso(justificacion),
    });
  }

  contenido(
    personaId: number,
    adjuntoId: number,
    justificacion: Justificacion,
  ): Observable<HttpResponse<Blob>> {
    return this.declarados.verContenidoDeAdjuntoDeclarado(
      { personaId, adjuntoId, ...motivoDeAcceso(justificacion) },
      'response',
      false,
      { httpHeaderAccept: 'application/octet-stream' },
    ) as Observable<HttpResponse<Blob>>;
  }

  darDeBaja(
    personaId: number,
    tipoDato: TipoDatoDeclarado,
    id: number,
    motivo: string,
    justificacion: Justificacion,
  ): Observable<void> {
    return this.declarados.darDeBajaDatoDeclarado({
      personaId,
      tipoDato,
      id,
      bajaDeAntecedenteRequest: { motivo },
      ...motivoDeAcceso(justificacion),
    }) as Observable<void>;
  }

  /** La ficha de ingreso declarada: queda sin revisar (exige `hc:declarar`). */
  declararFicha(
    personaId: number,
    ficha: FichaDeIngresoRequest,
    justificacion: Justificacion,
  ): Observable<FichaDeIngresoResponse> {
    return this.declarados.declararFichaDeIngreso({
      personaId,
      fichaDeIngresoRequest: ficha,
      ...motivoDeAcceso(justificacion),
    });
  }

  /** La ficha desde la historia (exige `hc:read`); null si todavia no se cargo (204). */
  verFicha(
    personaId: number,
    justificacion: Justificacion,
  ): Observable<FichaDeIngresoResponse | null> {
    return this.historias.verFichaDeIngreso({
      personaId,
      ...motivoDeAcceso(justificacion),
    }) as Observable<FichaDeIngresoResponse | null>;
  }

  /** La ficha guardada por el profesional: queda revisada (exige `hc:write`). */
  registrarFicha(
    personaId: number,
    ficha: FichaDeIngresoRequest,
    justificacion: Justificacion,
  ): Observable<FichaDeIngresoResponse> {
    return this.historias.registrarFichaDeIngreso({
      personaId,
      fichaDeIngresoRequest: ficha,
      ...motivoDeAcceso(justificacion),
    });
  }

  revisarFicha(
    personaId: number,
    justificacion: Justificacion,
  ): Observable<FichaDeIngresoResponse> {
    return this.historias.revisarFichaDeIngreso({ personaId, ...motivoDeAcceso(justificacion) });
  }

  ocupaciones(): Observable<OcupacionResponse[]> {
    return this.ocupacionesApi.listarOcupaciones();
  }

  /** Agrega una ocupacion del centro; si ya existe con otro formato devuelve esa. */
  agregarOcupacion(nombre: string): Observable<OcupacionResponse> {
    return this.ocupacionesApi.agregarOcupacion({ altaDeOcupacionRequest: { nombre } });
  }

  /** Revision del profesional (exige `hc:write`). */
  revisarAntecedente(
    personaId: number,
    antecedenteId: number,
    justificacion: Justificacion,
  ): Observable<AntecedenteDeclarado> {
    return this.historias.revisarAntecedente({
      personaId,
      antecedenteId,
      ...motivoDeAcceso(justificacion),
    });
  }

  revisarAdjunto(
    historiaClinicaId: number,
    adjuntoId: number,
    justificacion: Justificacion,
  ): Observable<AdjuntoDeclarado> {
    return this.adjuntos.revisarAdjunto({
      historiaClinicaId,
      adjuntoId,
      ...motivoDeAcceso(justificacion),
    });
  }
}
