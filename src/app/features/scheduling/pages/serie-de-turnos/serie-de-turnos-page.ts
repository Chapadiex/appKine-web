import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AlcanceDeSerie } from '../../../../api/generated/model/alcance-de-serie';
import { CancelarSerieDeTurnosAlcanceEnum } from '../../../../api/generated/model/cancelar-serie-de-turnos';
import { SerieDeTurnos } from '../../../../api/generated/model/serie-de-turnos';
import { Turno, TurnoEstadoEnum } from '../../../../api/generated/model/turno';
import { PERMISO_TURNO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { fechaEnPalabras } from '../../models/etiquetas-de-agenda';
import { fechaHoraEnZona, textoDeEstado } from '../../models/etiquetas-de-turno';
import { ErrorSerie, traducirErrorSerie } from '../../models/series-errors';
import { fechaEnZona, textoDeAlcance, textoDeDias, textoDeOmitido } from '../../models/series';
import { AlcanceSerie, SeriesApi } from '../../services/series-api';

/** Estados en los que un turno todavia se puede cancelar. El resto lo omite el backend. */
const PENDIENTES: ReadonlySet<string> = new Set<string>([
  TurnoEstadoEnum.RESERVADO,
  TurnoEstadoEnum.CONFIRMADO,
]);

interface Pedido {
  readonly alcance: AlcanceSerie;
  readonly turnoId?: number;
}

/**
 * Una serie de turnos y la cancelacion con alcance (M12, AKINE E-3, DP-04).
 *
 * <p>Muestra la regla con la que se genero la serie y sus turnos <b>tal como estan hoy</b>. La
 * regla no se reescribe cuando un turno se mueve: describe como se genero, y los turnos son la
 * verdad.
 *
 * <h2>Cancelar es previsualizar, mirar y confirmar una cantidad</h2>
 *
 * <p>Es lo que DP-04 pide y lo que el contrato exige: la cancelacion lleva
 * `cantidadConfirmada`, que es la cantidad de afectados que <b>se le mostro</b> al operador. El
 * flujo no deja saltear la previsualizacion porque no hay de donde sacar esa cantidad sin ella.
 * Los omitidos se muestran con su motivo: un turno en espera o con atencion no se cancela en lote,
 * y el operador tiene que saber por que quedo.
 *
 * <p>Si entre la previsualizacion y el click otro operador toco un turno del alcance, el backend
 * responde 409 y no cancela nada; la pantalla ofrece volver a previsualizar.
 *
 * <p><b>Reprogramar con alcance existe en el contrato y no tiene pantalla todavia</b>: exige elegir
 * el horario nuevo del turno pivote en la agenda. Mover un turno solo sigue disponible desde el
 * ciclo del turno, al que enlaza cada fila.
 */
@Component({
  selector: 'app-serie-de-turnos-page',
  imports: [RouterLink, ConfirmacionConMotivo],
  templateUrl: './serie-de-turnos-page.html',
  styleUrl: '../../agenda.css',
})
export class SerieDeTurnosPage {
  private readonly api = inject(SeriesApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);

  /** De la ruta. */
  readonly serieId = input.required<string>();

  protected readonly Alcance = CancelarSerieDeTurnosAlcanceEnum;
  protected readonly fechaEnPalabras = fechaEnPalabras;
  protected readonly textoDeEstado = textoDeEstado;
  protected readonly textoDeAlcance = textoDeAlcance;
  protected readonly textoDeDias = textoDeDias;
  protected readonly textoDeOmitido = textoDeOmitido;

  protected readonly serie = signal<SerieDeTurnos | null>(null);
  protected readonly cargando = signal(false);
  protected readonly error = signal<ErrorSerie | null>(null);

  protected readonly pedido = signal<Pedido | null>(null);
  protected readonly alcance = signal<AlcanceDeSerie | null>(null);
  protected readonly previsualizando = signal(false);
  protected readonly enviando = signal(false);
  protected readonly resultado = signal<AlcanceDeSerie | null>(null);

  protected readonly timezone = computed(() => this.serie()?.timezone ?? '');
  protected readonly puedeOperar = computed(() => this.permisos.tiene(PERMISO_TURNO_MANAGE));
  protected readonly afectados = computed(() => this.alcance()?.afectados ?? []);

  constructor() {
    effect(() => {
      this.serieId();
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.cerrar();
        this.resultado.set(null);
        this.cargar();
      });
    });
  }

  protected cargar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const serieId = this.numeroDeSerie();
    if (consultorioId === null || serieId === null) {
      return;
    }
    this.cargando.set(true);
    this.api.ver(consultorioId, serieId).subscribe({
      next: (serie) => {
        this.cargando.set(false);
        this.serie.set(serie);
      },
      error: (error: unknown) => {
        this.cargando.set(false);
        this.error.set(traducirErrorSerie(error));
      },
    });
  }

  protected esPendiente(turno: Turno): boolean {
    return PENDIENTES.has(turno.estado ?? '');
  }

  protected fechaHora(instante: string | undefined): string {
    return fechaHoraEnZona(instante, this.timezone());
  }

  /** Fecha local del turno, para que el ciclo del turno sepa que dia de agenda releer. */
  protected fechaLocal(turno: Turno): string {
    return fechaEnZona(turno.inicio, this.timezone());
  }

  /** Abre la confirmacion de un alcance y pide su previsualizacion. */
  protected elegir(alcance: AlcanceSerie, turnoId?: number): void {
    this.pedido.set({ alcance, turnoId });
    this.resultado.set(null);
    this.previsualizar();
  }

  protected previsualizar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const serieId = this.numeroDeSerie();
    const pedido = this.pedido();
    if (consultorioId === null || serieId === null || pedido === null) {
      return;
    }
    this.alcance.set(null);
    this.error.set(null);
    this.previsualizando.set(true);
    this.api.previsualizar(consultorioId, serieId, pedido.alcance, pedido.turnoId).subscribe({
      next: (alcance) => {
        this.previsualizando.set(false);
        this.alcance.set(alcance);
      },
      error: (error: unknown) => {
        this.previsualizando.set(false);
        this.error.set(traducirErrorSerie(error, this.timezone()));
      },
    });
  }

  protected cancelar(motivo: string): void {
    const consultorioId = this.tenantContext.consultorioId();
    const serieId = this.numeroDeSerie();
    const pedido = this.pedido();
    if (consultorioId === null || serieId === null || pedido === null) {
      return;
    }
    this.enviando.set(true);
    this.error.set(null);
    this.api
      .cancelar(consultorioId, serieId, {
        alcance: pedido.alcance,
        turnoId: pedido.turnoId,
        motivo,
        cantidadConfirmada: this.afectados().length,
      })
      .subscribe({
        next: (resultado) => {
          this.enviando.set(false);
          this.cerrar();
          this.resultado.set(resultado);
          this.cargar();
        },
        error: (error: unknown) => {
          this.enviando.set(false);
          this.error.set(traducirErrorSerie(error, this.timezone()));
        },
      });
  }

  protected cerrar(): void {
    this.pedido.set(null);
    this.alcance.set(null);
    this.error.set(null);
  }

  private numeroDeSerie(): number | null {
    const id = Number(this.serieId());
    return Number.isFinite(id) && id > 0 ? id : null;
  }
}
