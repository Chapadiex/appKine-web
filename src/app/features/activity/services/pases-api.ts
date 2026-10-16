import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { PasesService } from '../../../api/generated/api/pases.service';
import { PersonasService } from '../../../api/generated/api/personas.service';
import { ServiciosYOfertasService } from '../../../api/generated/api/servicios-y-ofertas.service';
import { CrearProducto } from '../../../api/generated/model/crear-producto';
import { EditarProducto } from '../../../api/generated/model/editar-producto';
import { OfertaResponse } from '../../../api/generated/model/oferta-response';
import { PaginaDeMovimientosDePase } from '../../../api/generated/model/pagina-de-movimientos-de-pase';
import { Pase } from '../../../api/generated/model/pase';
import { PaseDetalle } from '../../../api/generated/model/pase-detalle';
import { PersonaPageResponse } from '../../../api/generated/model/persona-page-response';
import { PersonaResponse } from '../../../api/generated/model/persona-response';
import { ResultadoDeAnulacionDePase } from '../../../api/generated/model/resultado-de-anulacion-de-pase';
import { Producto } from '../../../api/generated/model/producto';
import { ResultadoDeVenta } from '../../../api/generated/model/resultado-de-venta';

/** El unico esquema de cobro que admite productos de pack (RN-M29-005). */
export const ESQUEMA_POR_PACK = 'POR_PACK';
/** El unico esquema de cobro que admite abonos (RF-M29-007, desde 0.109.0). */
export const ESQUEMA_POR_ABONO = 'POR_ABONO';

/** Movimientos por pagina del ledger: el default del backend, que acota a 100. */
export const MOVIMIENTOS_POR_PAGINA = 20;

/** El periodo de un abono. Un pack no lo lleva: el contrato lo prohibe. */
export interface PeriodoDeAbono {
  readonly desde: string;
  /** Vacio: el periodo dura los `vigenciaDias` del producto. */
  readonly hasta?: string;
  /**
   * Que el sistema venda solo el periodo siguiente al acercarse el fin de este (0.116.0). Solo se
   * manda en `true`: ausente es no renovar, y en un pack el backend responde 400.
   */
  readonly renovacionAutomatica?: boolean;
}

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
 *   <li><b>Un abono es un pase con periodo</b> (08.08): se vende sobre una oferta `POR_ABONO` eligiendo
 *       el periodo, y sus creditos son las asistencias que ese periodo permite.</li>
 *   <li><b>Ajustar y anular piden `pase:adjust`</b> y la `version` leida (08.07). Anular el pase
 *       anula tambien su deuda, que no se borra.</li>
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

  /**
   * El ledger de a paginas, del movimiento mas viejo al mas nuevo (RF-M29-009, 0.116.0): el orden en
   * que se lee `saldoResultante`. `page` en base cero.
   */
  movimientos(
    consultorioId: number,
    paseId: number,
    page: number,
    size = MOVIMIENTOS_POR_PAGINA,
  ): Observable<PaginaDeMovimientosDePase> {
    return this.pases.listarMovimientosDePase({ consultorioId, paseId, page, size });
  }

  /**
   * Prende o apaga la renovacion automatica de un abono (08.08, 0.116.0). Pide `pase:manage`
   * —prenderla es autorizar ventas a nombre de quien la prende— y la `version` leida. Idempotente
   * por estado. Apagarla no anula un periodo ya renovado.
   */
  configurarRenovacion(
    consultorioId: number,
    paseId: number,
    activa: boolean,
    version: number,
  ): Observable<Pase> {
    return this.pases.configurarRenovacionDeAbono({
      consultorioId,
      paseId,
      configuracionDeRenovacionDeAbono: { activa, version },
    });
  }

  /**
   * `idempotencyKey` hace que un reintento no venda dos veces (CA-M29-002-06). `periodo` solo para
   * un abono.
   */
  vender(
    consultorioId: number,
    productoId: number,
    personaId: number,
    idempotencyKey: string,
    periodo?: PeriodoDeAbono,
  ): Observable<ResultadoDeVenta> {
    return this.pases.venderPase({
      consultorioId,
      venderPase: {
        productoId,
        personaId,
        idempotencyKey,
        ...(periodo
          ? {
              periodoDesde: periodo.desde,
              ...(periodo.hasta ? { periodoHasta: periodo.hasta } : {}),
              ...(periodo.renovacionAutomatica ? { renovacionAutomatica: true } : {}),
            }
          : {}),
      },
    });
  }

  /**
   * Suma o resta creditos con motivo (RF-M29-005). `cantidad` lleva signo y nunca es cero; el saldo
   * final tiene que quedar entre 0 y los creditos comprados. Exige `pase:adjust`.
   */
  ajustarSaldo(
    consultorioId: number,
    paseId: number,
    cantidad: number,
    motivo: string,
    version: number,
  ): Observable<PaseDetalle> {
    return this.pases.ajustarSaldoDePase({
      consultorioId,
      paseId,
      ajusteDeSaldoDePase: { cantidad, motivo, version },
    });
  }

  /** Anula un pase sin creditos usados y su deuda, que queda ANULADA (no se borra). */
  anular(
    consultorioId: number,
    paseId: number,
    motivo: string,
    version: number,
  ): Observable<ResultadoDeAnulacionDePase> {
    return this.pases.anularPase({ consultorioId, paseId, anulacionDePase: { motivo, version } });
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
