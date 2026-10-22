import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { BorradorDeHonorarios } from '../../../../api/generated/model/borrador-de-honorarios';
import { LiquidacionDeHonorarios } from '../../../../api/generated/model/liquidacion-de-honorarios';
import { MembershipResponse } from '../../../../api/generated/model/membership-response';
import { OfertaResponse } from '../../../../api/generated/model/oferta-response';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { nuevaClaveDeIntento } from '../../../../shared/utils/clave-de-intento';
import {
  ErrorEgreso,
  errorSinContextoDeEgreso,
  traducirErrorEgreso,
} from '../../models/egreso-errors';
import { primeroDelMes } from '../../models/etiquetas-de-egreso';
import { importeEnPalabras } from '../../models/etiquetas-de-obligacion';
import { fechaIsoEnPalabras } from '../../models/etiquetas-de-presentacion';
import {
  GrupoDeHonorarios,
  agruparPorOferta,
  importeDelGrupo,
  motivoDeExclusionEnPalabras,
  parteEnPalabras,
} from '../../models/honorarios';
import { EgresosApi } from '../../services/egresos-api';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';

/** Lo que se pidio: el borrador se confirma contra exactamente esto. */
interface Pedido {
  readonly colaboradorMembershipId: number;
  readonly desde: string;
  readonly hasta: string;
  readonly ofertaId: number | undefined;
}

type EstadoBorrador =
  | { readonly tipo: 'sin-pedir' }
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly borrador: BorradorDeHonorarios; readonly pedido: Pedido }
  | { readonly tipo: 'error'; readonly error: ErrorEgreso };

/**
 * Liquidacion de honorarios por clase (DP-38, RF-M22-006/007, contrato 0.134.0).
 *
 * <p>Se elige colaborador, periodo y, si se quiere, una oferta; el backend calcula el borrador al
 * pedirlo —no se guarda nada— con las clases dictadas incluidas, su importe, y las excluidas con su
 * motivo. Confirmar crea un <b>egreso en borrador</b> de M22, imputado a la oferta (DP-39), y la
 * liquidacion con el snapshot por clase. No mueve la caja: el egreso sigue su ciclo.
 *
 * <h2>Una liquidacion por oferta</h2>
 *
 * <p>Si el borrador mezcla ofertas el backend no lo confirma entero (400). La pantalla agrupa por
 * oferta y confirma cada grupo con su `ofertaId`: el recalculo con ese filtro da exactamente las
 * clases y el total del grupo.
 *
 * <h2>Lo que puede cambiar entre mirar y confirmar</h2>
 *
 * <p>Otra liquidacion, una asistencia corregida o una tarifa nueva: el backend responde 409
 * `borrador-de-honorarios-desactualizado` y no liquida nada. La pantalla lo dice y <b>relee el
 * borrador</b>; no reintenta sola, porque el importe nuevo lo tiene que ver alguien.
 *
 * <p>La clave de idempotencia es por grupo y se renueva con cada borrador: un reintento por error de
 * red reusa la misma y no liquida dos veces.
 */
@Component({
  selector: 'app-liquidacion-de-honorarios-page',
  imports: [Ayuda, ReactiveFormsModule, RouterLink],
  templateUrl: './liquidacion-de-honorarios-page.html',
  styleUrls: ['../../billing.css', '../../economia.css'],
})
export class LiquidacionDeHonorariosPage {
  private readonly api = inject(EgresosApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly fecha = fechaIsoEnPalabras;
  protected readonly motivoEnPalabras = motivoDeExclusionEnPalabras;
  protected readonly parteEnPalabras = parteEnPalabras;

  protected readonly filtro = this.fb.group({
    colaborador: ['', Validators.required],
    desde: [primeroDelMes(this.diaDeLaSede.hoy()), Validators.required],
    hasta: [this.diaDeLaSede.hoy(), Validators.required],
    ofertaId: [''],
  });

  /** Opcional: sin concepto, el backend arma "Honorarios por clase del X al Y". */
  protected readonly concepto = this.fb.control('');

  protected readonly colaboradores = signal<readonly MembershipResponse[]>([]);
  protected readonly sinColaboradores = signal(false);
  protected readonly ofertas = signal<readonly OfertaResponse[]>([]);
  protected readonly estado = signal<EstadoBorrador>({ tipo: 'sin-pedir' });
  protected readonly filtroIntentado = signal(false);
  /** El grupo que se esta confirmando, por `ofertaId`. */
  protected readonly confirmando = signal<number | null>(null);
  protected readonly errorConfirmacion = signal<ErrorEgreso | null>(null);
  protected readonly confirmadas = signal<readonly LiquidacionDeHonorarios[]>([]);

  /** Una clave por grupo, renovada con cada borrador nuevo. */
  private claves = new Map<number, string>();

  protected readonly borrador = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.borrador : null;
  });
  protected readonly error = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.error : null;
  });
  protected readonly grupos = computed<readonly GrupoDeHonorarios[]>(() =>
    agruparPorOferta(this.borrador()?.clases ?? []),
  );
  protected readonly excluidas = computed(() => this.borrador()?.excluidas ?? []);
  protected readonly mezclaOfertas = computed(() => this.grupos().length > 1);

  constructor() {
    const desde = this.filtro.controls.desde;
    const hasta = this.filtro.controls.hasta;
    this.diaDeLaSede.alinear(
      () => hasta.value,
      (hoy) => {
        desde.setValue(primeroDelMes(hoy));
        hasta.setValue(hoy);
      },
    );
    // Cambiar el pedido invalida el borrador en pantalla: confirmar uno viejo seria liquidar otra
    // cosa que lo que el formulario dice.
    this.filtro.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.estado().tipo === 'listo') {
        this.estado.set({ tipo: 'sin-pedir' });
      }
    });

    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        // Cambiar de organizacion no puede dejar colaboradores ni honorarios de la anterior.
        this.colaboradores.set([]);
        this.ofertas.set([]);
        this.estado.set({ tipo: 'sin-pedir' });
        this.confirmadas.set([]);
        this.errorConfirmacion.set(null);
        this.cargarOpciones();
      });
    });
  }

  protected calcular(): void {
    this.filtroIntentado.set(true);
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      this.estado.set({ tipo: 'error', error: errorSinContextoDeEgreso() });
      return;
    }
    if (this.filtro.invalid || this.periodoInvalido()) {
      return;
    }
    const v = this.filtro.getRawValue();
    this.confirmadas.set([]);
    this.pedir(consultorioId, {
      colaboradorMembershipId: Number(v.colaborador),
      desde: v.desde,
      hasta: v.hasta,
      ofertaId: v.ofertaId === '' ? undefined : Number(v.ofertaId),
    });
  }

  protected confirmar(grupo: GrupoDeHonorarios): void {
    const consultorioId = this.tenantContext.consultorioId();
    const actual = this.estado();
    if (consultorioId === null || actual.tipo !== 'listo' || this.confirmando() !== null) {
      return;
    }
    const { pedido } = actual;
    const clave = this.claves.get(grupo.ofertaId) ?? nuevaClaveDeIntento();
    this.claves.set(grupo.ofertaId, clave);
    this.confirmando.set(grupo.ofertaId);
    this.errorConfirmacion.set(null);
    this.api
      .confirmarLiquidacion(consultorioId, {
        colaboradorMembershipId: pedido.colaboradorMembershipId,
        desde: pedido.desde,
        hasta: pedido.hasta,
        ofertaId: grupo.ofertaId,
        claseIds: [...grupo.claseIds],
        importeTotal: importeDelGrupo(grupo),
        concepto: this.concepto.value.trim() || undefined,
        idempotencyKey: clave,
      })
      .subscribe({
        next: (liquidacion) => {
          this.confirmando.set(null);
          this.confirmadas.update((lista) => [...lista, liquidacion]);
          // Las clases recien liquidadas pasan a "Ya liquidada": se relee para mostrarlo.
          this.pedir(consultorioId, pedido);
        },
        error: (error: unknown) => {
          this.confirmando.set(null);
          const traducido = traducirErrorEgreso(error);
          this.errorConfirmacion.set(traducido);
          if (traducido.renovarClave === true) {
            this.claves.delete(grupo.ofertaId);
          }
          if (
            traducido.causa === 'borrador-desactualizado' ||
            traducido.causa === 'liquidacion-vacia'
          ) {
            // Lo que se miro ya no es lo que hay: se relee para que se vea el borrador de ahora.
            this.pedir(consultorioId, pedido, false);
          }
        },
      });
  }

  protected importe(valor: number | undefined, moneda?: string): string {
    return importeEnPalabras(valor, moneda ?? this.borrador()?.moneda);
  }

  protected totalDelGrupo(grupo: GrupoDeHonorarios): string {
    return importeEnPalabras(importeDelGrupo(grupo), grupo.moneda);
  }

  protected nombreDe(membership: MembershipResponse): string {
    return membership.accountName || membership.accountEmail || `Vinculo ${membership.id}`;
  }

  protected campoInvalido(nombre: 'colaborador' | 'desde' | 'hasta'): boolean {
    if (!this.filtroIntentado()) {
      return false;
    }
    if (nombre === 'hasta' && this.periodoInvalido()) {
      return true;
    }
    return this.filtro.controls[nombre].invalid;
  }

  private periodoInvalido(): boolean {
    const { desde, hasta } = this.filtro.getRawValue();
    return desde !== '' && hasta !== '' && hasta < desde;
  }

  private pedir(consultorioId: number, pedido: Pedido, limpiarError = true): void {
    if (limpiarError) {
      this.errorConfirmacion.set(null);
    }
    this.claves = new Map();
    this.estado.set({ tipo: 'cargando' });
    this.api
      .borradorDeHonorarios(
        consultorioId,
        pedido.colaboradorMembershipId,
        pedido.desde,
        pedido.hasta,
        pedido.ofertaId,
      )
      .subscribe({
        next: (borrador) => this.estado.set({ tipo: 'listo', borrador, pedido }),
        error: (error: unknown) =>
          this.estado.set({ tipo: 'error', error: traducirErrorEgreso(error) }),
      });
  }

  private cargarOpciones(): void {
    const organizationId = this.tenantContext.organizationId();
    const consultorioId = this.tenantContext.consultorioId();
    if (organizationId !== null) {
      this.sinColaboradores.set(false);
      this.api.colaboradoresVigentes(organizationId).subscribe({
        next: (lista) => this.colaboradores.set(lista),
        error: () => {
          this.colaboradores.set([]);
          this.sinColaboradores.set(true);
        },
      });
    }
    if (consultorioId !== null) {
      // Solo las grupales tienen clases. Con las de baja: una clase dictada antes de la baja se
      // sigue liquidando.
      this.api.ofertasDeLaSede(consultorioId).subscribe({
        next: (lista) => this.ofertas.set(lista.filter((o) => o.modalidad === 'GRUPAL')),
        error: () => this.ofertas.set([]),
      });
    }
  }
}
