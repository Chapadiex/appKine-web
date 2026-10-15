import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { PasesService } from '../../../api/generated/api/pases.service';
import { PersonasService } from '../../../api/generated/api/personas.service';
import { ServiciosYOfertasService } from '../../../api/generated/api/servicios-y-ofertas.service';
import { CrearProducto } from '../../../api/generated/model/crear-producto';
import { EditarProducto } from '../../../api/generated/model/editar-producto';
import { OfertaResponse } from '../../../api/generated/model/oferta-response';
import { Pase } from '../../../api/generated/model/pase';
import { PaseDetalle } from '../../../api/generated/model/pase-detalle';
import { PersonaPageResponse } from '../../../api/generated/model/persona-page-response';
import { PersonaResponse } from '../../../api/generated/model/persona-response';
import { Producto } from '../../../api/generated/model/producto';
import { ResultadoDeVenta } from '../../../api/generated/model/resultado-de-venta';

/** El unico esquema de cobro que admite productos de pack (RN-M29-005). */
export const ESQUEMA_POR_PACK = 'POR_PACK';

/**
 * Fachada de productos de pack y pases (M29, AKINE-08.06) sobre el cliente generado.
 *
 * <h2>Lo que el contrato ofrece y lo que no</h2>
 *
 * <ul>
 *   <li><b>Un producto cuelga de una oferta activa con `esquemaCobro = POR_PACK`.</b> Si no, el alta
 *       responde 409. Por eso la pantalla filtra: ofrecer otra seria ofrecer un error.</li>
 *   <li><b>Crear un producto no le da saldo a nadie</b> (CA-M29-001-06).</li>
 *   <li><b>Vender genera una deuda y nada mas</b> (DP-06): ni cobro ni caja. La deuda se paga desde
 *       la cuenta corriente de la persona.</li>
 *   <li><b>El consumo no tiene operacion propia</b>: lo hace el backend al registrar la asistencia.
 *       Esta fachada solo lee el ledger.</li>
 *   <li><b>No hay ajuste manual, anulacion ni vencimiento programado</b> todavia (08.07).</li>
 * </ul>
 */
@Injectable({ providedIn: 'root' })
export class PasesApi {
  private readonly pases = inject(PasesService);
  private readonly ofertas = inject(ServiciosYOfertasService);
  private readonly personas = inject(PersonasService);

  /** Vigentes primero. Exige `producto:read`. */
  productos(consultorioId: number, incluirBajas = false): Observable<readonly Producto[]> {
    return this.pases.listarProductos({ consultorioId, incluirBajas });
  }

  crearProducto(consultorioId: number, cuerpo: CrearProducto): Observable<Producto> {
    return this.pases.crearProducto({ consultorioId, crearProducto: cuerpo });
  }

  /** Control optimista por `version`. Los pases ya vendidos no cambian. */
  editarProducto(
    consultorioId: number,
    productoId: number,
    cuerpo: EditarProducto,
  ): Observable<Producto> {
    return this.pases.editarProducto({ consultorioId, productoId, editarProducto: cuerpo });
  }

  /** Baja logica, idempotente, que no cascadea a los pases vendidos. */
  darDeBajaProducto(
    consultorioId: number,
    productoId: number,
    motivo: string,
  ): Observable<Producto> {
    return this.pases.darDeBajaProducto({
      consultorioId,
      productoId,
      bajaDeProducto: { motivo },
    });
  }

  /** Todas las ofertas de la sede, para nombrar la de cada producto. */
  ofertasDeLaSede(consultorioId: number): Observable<readonly OfertaResponse[]> {
    return this.ofertas.listOfertas({ consultorioId, estado: 'TODOS' });
  }

  /** Pases que la persona compro en esta sede, el que vence mas tarde primero. */
  pasesDePersona(consultorioId: number, personaId: number): Observable<readonly Pase[]> {
    return this.pases.listarPasesDePersona({ consultorioId, personaId });
  }

  /** El pase con su ledger, del movimiento mas viejo al mas nuevo (RF-M29-009). */
  verPase(consultorioId: number, paseId: number): Observable<PaseDetalle> {
    return this.pases.verPase({ consultorioId, paseId });
  }

  /** `idempotencyKey` hace que un reintento no venda dos veces (CA-M29-002-06). */
  vender(
    consultorioId: number,
    productoId: number,
    personaId: number,
    idempotencyKey: string,
  ): Observable<ResultadoDeVenta> {
    return this.pases.venderPase({
      consultorioId,
      venderPase: { productoId, personaId, idempotencyKey },
    });
  }

  verPersona(personaId: number): Observable<PersonaResponse> {
    return this.personas.verPersona({ personaId });
  }

  /** Personas activas del padron. No exige perfil de paciente: un pase se vende a cualquiera. */
  buscarPersonas(texto: string): Observable<PersonaPageResponse> {
    const q = texto.trim();
    return this.personas.buscarPersonas({
      q: q === '' ? undefined : q,
      estado: 'ACTIVO',
      perfil: 'TODOS',
      page: 0,
      size: 10,
    });
  }
}
