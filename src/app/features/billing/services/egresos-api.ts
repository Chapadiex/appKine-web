import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { ColaboradoresService } from '../../../api/generated/api/colaboradores.service';
import { EgresosService } from '../../../api/generated/api/egresos.service';
import { Egreso } from '../../../api/generated/model/egreso';
import {
  MembershipResponse,
  MembershipResponseEstadoEnum,
} from '../../../api/generated/model/membership-response';
import { PagoDeEgreso } from '../../../api/generated/model/pago-de-egreso';
import { RegistrarEgreso } from '../../../api/generated/model/registrar-egreso';
import { RegistrarPagoDeEgreso } from '../../../api/generated/model/registrar-pago-de-egreso';

/** Filtros del listado. Todos opcionales: sin ninguno, el backend trae lo de la sede. */
export interface FiltroDeEgresos {
  readonly estado?: string;
  readonly categoria?: string;
  readonly desde?: string;
  readonly hasta?: string;
}

/**
 * Fachada de la feature sobre el cliente generado para M22 (egresos y pagos, AKINE-07.05).
 *
 * <p>Mismo criterio que `PresentacionesApi`: las paginas hablan con metodos de nombre propio, los
 * specs interceptan HTTP, y aca no se transforma nada —el contrato es la autoridad—.
 *
 * <p>La clave de idempotencia se exige en el tipo aunque el contrato la declare opcional: sin ella
 * un doble click carga dos veces la misma liquidacion, o saca dos veces la plata del cajon.
 */
@Injectable({ providedIn: 'root' })
export class EgresosApi {
  private readonly api = inject(EgresosService);
  private readonly colaboradores = inject(ColaboradoresService);

  buscar(consultorioId: number, filtro: FiltroDeEgresos): Observable<readonly Egreso[]> {
    return this.api.buscarEgreso({ consultorioId, ...filtro });
  }

  ver(consultorioId: number, egresoId: number): Observable<Egreso> {
    return this.api.verEgreso({ consultorioId, egresoId });
  }

  registrar(
    consultorioId: number,
    egreso: RegistrarEgreso & { readonly idempotencyKey: string },
  ): Observable<Egreso> {
    return this.api.registrarEgreso({ consultorioId, registrarEgreso: egreso });
  }

  editar(consultorioId: number, egresoId: number, egreso: RegistrarEgreso): Observable<Egreso> {
    return this.api.editar({ consultorioId, egresoId, registrarEgreso: egreso });
  }

  confirmar(consultorioId: number, egresoId: number): Observable<Egreso> {
    return this.api.confirmarEgreso({ consultorioId, egresoId });
  }

  anular(consultorioId: number, egresoId: number, motivo: string): Observable<Egreso> {
    return this.api.anularEgreso({ consultorioId, egresoId, anularEgreso: { motivo } });
  }

  pagar(
    consultorioId: number,
    egresoId: number,
    pago: RegistrarPagoDeEgreso & { readonly idempotencyKey: string },
  ): Observable<PagoDeEgreso> {
    return this.api.pagar({ consultorioId, egresoId, registrarPagoDeEgreso: pago });
  }

  anularPago(
    consultorioId: number,
    egresoId: number,
    pagoId: number,
    motivo: string,
  ): Observable<PagoDeEgreso> {
    return this.api.anularPago({ consultorioId, egresoId, pagoId, anularEgreso: { motivo } });
  }

  /**
   * Colaboradores con vinculo ACTIVO, candidatos a beneficiario.
   *
   * <p>Sale del cliente generado y no de la feature `organization` (AGENT.md 4.4). Se filtra la
   * vigencia del lado del cliente porque el listado no tiene ese filtro; igual el backend valida
   * el vinculo al crear (`beneficiario-no-vinculado`).
   */
  colaboradoresVigentes(organizationId: number): Observable<readonly MembershipResponse[]> {
    return this.colaboradores
      .listMemberships({ orgId: organizationId, size: 200 })
      .pipe(
        map((pagina) =>
          (pagina.content ?? []).filter((m) => m.estado === MembershipResponseEstadoEnum.ACTIVA),
        ),
      );
  }
}
