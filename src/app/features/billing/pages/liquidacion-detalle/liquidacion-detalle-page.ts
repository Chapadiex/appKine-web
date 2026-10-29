import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  LiquidacionDeHonorarios,
  LiquidacionDeHonorariosEstadoEnum,
} from '../../../../api/generated/model/liquidacion-de-honorarios';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import {
  ErrorEgreso,
  errorSinContextoDeEgreso,
  traducirErrorEgreso,
} from '../../models/egreso-errors';
import { instanteEnPalabras } from '../../models/etiquetas-de-cobro';
import { estadoDeEgresoEnPalabras } from '../../models/etiquetas-de-egreso';
import { importeEnPalabras } from '../../models/etiquetas-de-obligacion';
import { fechaIsoEnPalabras } from '../../models/etiquetas-de-presentacion';
import { parteEnPalabras } from '../../models/honorarios';
import { EgresosApi } from '../../services/egresos-api';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

import { Alerta } from '../../../../shared/components/alerta/alerta';
import { publicarMigas } from '../../../../core/services/migas.store';

/**
 * Una liquidacion de honorarios por clase confirmada, con su snapshot (DP-38, CA-M22-007-06).
 *
 * <p>Es la foto de lo que se liquido: una tarifa nueva o una asistencia corregida despues no la
 * cambian. Se llega desde el egreso que la origino (`liquidacionHonorariosId`) o al confirmarla.
 * <b>Liberada</b> quiere decir que se anulo su egreso: sus clases vuelven a poder liquidarse.
 */
@Component({
  selector: 'app-liquidacion-detalle-page',
  imports: [CabeceraDePagina, Ayuda, RouterLink, Alerta],
  templateUrl: './liquidacion-detalle-page.html',
  styleUrls: ['../../billing.css', '../../economia.css'],
})
export class LiquidacionDetallePage {
  /** Ruta de navegacion de la barra superior (UX-13). */
  private readonly migasDeLaBarra = publicarMigas(() => [
    { etiqueta: 'Honorarios', ruta: '/egresos/honorarios' },
  ]);

  private readonly api = inject(EgresosApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly diaDeLaSede = inject(DiaDeLaSede);

  /** De la ruta. */
  readonly liquidacionId = input.required<string>();

  protected readonly fecha = fechaIsoEnPalabras;
  protected readonly parteEnPalabras = parteEnPalabras;
  protected readonly estadoDeEgreso = estadoDeEgresoEnPalabras;
  protected readonly instante = (valor: string | undefined): string =>
    instanteEnPalabras(valor, this.diaDeLaSede.zona());

  protected readonly liquidacion = signal<LiquidacionDeHonorarios | null>(null);
  protected readonly error = signal<ErrorEgreso | null>(null);
  protected readonly liberada = computed(
    () => this.liquidacion()?.estado === LiquidacionDeHonorariosEstadoEnum.LIBERADA,
  );

  constructor() {
    effect(() => {
      this.liquidacionId();
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.liquidacion.set(null);
        this.cargar();
      });
    });
  }

  protected cargar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const id = Number(this.liquidacionId());
    if (consultorioId === null) {
      this.error.set(errorSinContextoDeEgreso());
      return;
    }
    this.error.set(null);
    this.api.verLiquidacion(consultorioId, id).subscribe({
      next: (liquidacion) => this.liquidacion.set(liquidacion),
      error: (error: unknown) => this.error.set(traducirErrorEgreso(error)),
    });
  }

  protected importe(valor: number | undefined): string {
    return importeEnPalabras(valor, this.liquidacion()?.moneda);
  }
}
