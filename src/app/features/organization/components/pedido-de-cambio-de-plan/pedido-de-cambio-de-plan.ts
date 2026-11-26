import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';

import { PedidosDeCambioDePlanService } from '../../../../api/generated/api/pedidos-de-cambio-de-plan.service';
import {
  PedidoDeCambioDePlanResponse,
  PedidoDeCambioDePlanResponseAdicionalesEnum,
} from '../../../../api/generated/model/pedido-de-cambio-de-plan-response';
import {
  PedidoDeCambioDePlanRequestAdicionalesEnum,
  PedidoDeCambioDePlanRequestServiciosEnum,
} from '../../../../api/generated/model/pedido-de-cambio-de-plan-request';
import { PlanResponse } from '../../../../api/generated/model/plan-response';
import { LimitUsageResponse } from '../../../../api/generated/model/limit-usage-response';
import { ExcesoDeTopeResponse } from '../../../../api/generated/model/exceso-de-tope-response';
import { textoDeAjuste } from '../../../../core/models/ajustes-de-plan';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { ContratacionStore } from '../../../../core/services/contratacion.store';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Icono } from '../../../../shared/components/icono/icono';
import {
  OpcionEnTarjeta,
  OpcionesEnTarjetas,
} from '../../../../shared/components/opciones-en-tarjetas/opciones-en-tarjetas';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';

const NOMBRE_DEL_SERVICIO: Readonly<Record<string, string>> = {
  KINESIOLOGIA: 'Kinesiología',
  ACTIVIDADES: 'Actividades y clases',
};

/**
 * Pedido de cambio de plan del centro (25/11/2026, contrato 0.194.0): el centro elige plan,
 * servicios e IA y la plataforma lo aprueba o lo rechaza. La tarjeta muestra el ultimo pedido;
 * el panel arma uno nuevo. Solo la ve quien tiene `tenant:update` (lo decide la pantalla).
 */
@Component({
  selector: 'app-pedido-de-cambio-de-plan',
  imports: [ReactiveFormsModule, DatePipe, Alerta, Icono, OpcionesEnTarjetas, PanelLateral],
  templateUrl: './pedido-de-cambio-de-plan.html',
  styleUrl: './pedido-de-cambio-de-plan.css',
})
export class PedidoDeCambioDePlan {
  readonly orgId = input.required<number>();
  /** Planes del catalogo; se ofrecen los que estan a la venta. */
  readonly catalogo = input<readonly PlanResponse[]>([]);
  /** Consumo actual de cada tope (de la suscripcion), para avisar al bajar de plan. */
  readonly usos = input<readonly LimitUsageResponse[]>([]);

  private readonly api = inject(PedidosDeCambioDePlanService);
  private readonly contratacion = inject(ContratacionStore);
  private readonly fb = inject(FormBuilder);

  protected readonly pedido = signal<PedidoDeCambioDePlanResponse | null>(null);
  protected readonly panelAbierto = signal(false);
  protected readonly enviando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly formulario = this.fb.nonNullable.group({
    plan: '',
    kinesiologia: false,
    actividades: false,
    ia: false,
    comentario: '',
  });

  private readonly valores = signal(this.formulario.getRawValue());

  protected readonly pendiente = computed(() => this.pedido()?.estado === 'PENDIENTE');

  /** Los planes a la venta como tarjetas, con sus topes como descripción. */
  protected readonly opcionesDePlan = computed<readonly OpcionEnTarjeta[]>(() =>
    this.catalogo()
      .filter((p) => p.ofrecido !== false && p.code)
      .map((p) => ({
        valor: p.code!,
        etiqueta: p.name ?? p.code!,
        descripcion: topes(p),
        icono: 'capas' as const,
      })),
  );

  /** "De → a" de lo que se está pidiendo, para leerlo antes de enviar. */
  protected readonly resumen = computed<readonly string[]>(() => {
    const c = this.contratacion.contratacion();
    const v = this.valores();
    if (!c) {
      return [];
    }
    const lineas: string[] = [];
    if (v.plan && v.plan !== c.planCode) {
      const nuevo = this.catalogo().find((p) => p.code === v.plan)?.name ?? v.plan;
      lineas.push(`Pasás de ${c.planNombre ?? c.planCode} a ${nuevo}`);
    }
    const actuales = new Set((c.servicios ?? []) as readonly string[]);
    for (const [clave, marcado] of [
      ['KINESIOLOGIA', v.kinesiologia],
      ['ACTIVIDADES', v.actividades],
    ] as const) {
      if (marcado && !actuales.has(clave)) {
        lineas.push(`Suma ${NOMBRE_DEL_SERVICIO[clave]}`);
      } else if (!marcado && actuales.has(clave)) {
        lineas.push(`Deja ${NOMBRE_DEL_SERVICIO[clave]}`);
      }
    }
    const teniaIa = ((c.adicionales ?? []) as readonly string[]).includes('IA');
    if (v.ia !== teniaIa) {
      lineas.push(v.ia ? 'Suma la inteligencia artificial' : 'Deja la inteligencia artificial');
    }
    return lineas;
  });

  /**
   * Lo que el centro tiene que ajustar para bajar al plan elegido (26/11/2026): sedes o
   * profesionales de mas. El pedido se envia igual; la plataforma no lo aprueba hasta que se ajuste.
   */
  protected readonly ajustes = computed<readonly string[]>(() => {
    const plan = this.catalogo().find((p) => p.code === this.valores().plan);
    if (!plan) {
      return [];
    }
    return TOPES.flatMap((t) => {
      const limite = plan.limits?.find((l) => l.code === t.codigo);
      const uso = this.usos().find((u) => u.code === t.codigo)?.currentUsage ?? 0;
      if (!limite || limite.unlimited || limite.value === undefined || uso <= limite.value) {
        return [];
      }
      return [textoDeAjuste(t.codigo, limite.value, uso, plan.name ?? plan.code ?? '')];
    });
  });

  /** Servicios que el centro tiene y destildó: quedan en solo lectura. */
  protected readonly dejados = computed<readonly string[]>(() => {
    const v = this.valores();
    const actuales = (this.contratacion.contratacion()?.servicios ?? []) as readonly string[];
    return [
      ...(actuales.includes('KINESIOLOGIA') && !v.kinesiologia ? ['KINESIOLOGIA'] : []),
      ...(actuales.includes('ACTIVIDADES') && !v.actividades ? ['ACTIVIDADES'] : []),
    ].map((s) => NOMBRE_DEL_SERVICIO[s]);
  });

  /** Lo que el pedido pendiente necesita que el centro ajuste, segun el servidor. */
  protected ajustesDelPedido(p: PedidoDeCambioDePlanResponse): readonly string[] {
    return (p.excesos ?? []).map((e: ExcesoDeTopeResponse) =>
      textoDeAjuste(e.limitCode ?? '', e.tope ?? 0, e.uso ?? 0, p.planNombre ?? p.planCode ?? ''),
    );
  }

  protected readonly sinServicios = computed(
    () => !this.valores().kinesiologia && !this.valores().actividades,
  );

  constructor() {
    this.formulario.valueChanges.subscribe(() => this.valores.set(this.formulario.getRawValue()));
    effect(() => {
      const orgId = this.orgId();
      untracked(() => this.cargar(orgId));
    });
  }

  protected abrir(): void {
    const c = this.contratacion.contratacion();
    const servicios = (c?.servicios ?? []) as readonly string[];
    this.formulario.reset({
      plan: c?.planCode ?? '',
      kinesiologia: servicios.includes('KINESIOLOGIA'),
      actividades: servicios.includes('ACTIVIDADES'),
      ia: ((c?.adicionales ?? []) as readonly string[]).includes('IA'),
      comentario: '',
    });
    this.valores.set(this.formulario.getRawValue());
    this.error.set(null);
    this.panelAbierto.set(true);
  }

  protected cerrar(): void {
    this.panelAbierto.set(false);
  }

  protected enviar(): void {
    const v = this.formulario.getRawValue();
    if (this.enviando() || this.sinServicios() || this.resumen().length === 0) {
      return;
    }
    const servicios: PedidoDeCambioDePlanRequestServiciosEnum[] = [];
    if (v.kinesiologia) servicios.push(PedidoDeCambioDePlanRequestServiciosEnum.KINESIOLOGIA);
    if (v.actividades) servicios.push(PedidoDeCambioDePlanRequestServiciosEnum.ACTIVIDADES);
    this.enviando.set(true);
    this.error.set(null);
    this.api
      .pedirCambioDePlan({
        orgId: this.orgId(),
        pedidoDeCambioDePlanRequest: {
          planCode: v.plan,
          servicios,
          adicionales: v.ia ? [PedidoDeCambioDePlanRequestAdicionalesEnum.IA] : [],
          comentario: v.comentario.trim() || undefined,
        },
      })
      .subscribe({
        next: (pedido) => {
          this.enviando.set(false);
          this.pedido.set(pedido);
          this.panelAbierto.set(false);
        },
        error: (e: unknown) => {
          this.enviando.set(false);
          this.error.set(mensaje(e));
          if (e instanceof AkineHttpError && e.problemType === 'pedido-de-plan-pendiente') {
            this.cargar(this.orgId());
          }
        },
      });
  }

  protected cancelarPedido(): void {
    const pedido = this.pedido();
    if (!pedido || this.enviando()) {
      return;
    }
    this.enviando.set(true);
    this.api
      .cancelarPedidoDeCambioDePlan({
        orgId: this.orgId(),
        id: pedido.id!,
        versionDePedidoRequest: { version: pedido.version! },
      })
      .subscribe({
        next: (cancelado) => {
          this.enviando.set(false);
          this.pedido.set(cancelado);
        },
        error: (e: unknown) => {
          this.enviando.set(false);
          this.error.set(mensaje(e));
          this.cargar(this.orgId());
        },
      });
  }

  /** Texto de lo pedido: plan y servicios, para la tarjeta. */
  protected descripcion(p: PedidoDeCambioDePlanResponse): string {
    const servicios = (p.servicios ?? []).map((s) => NOMBRE_DEL_SERVICIO[s] ?? s);
    const ia = (p.adicionales ?? []).includes(PedidoDeCambioDePlanResponseAdicionalesEnum.IA)
      ? ['inteligencia artificial']
      : [];
    return `${p.planNombre ?? p.planCode} · ${[...servicios, ...ia].join(', ')}`;
  }

  private cargar(orgId: number): void {
    this.api.verPedidoDeCambioDePlan({ orgId }).subscribe({
      // 204 llega como null: el centro nunca pidió.
      next: (pedido) => this.pedido.set(pedido ?? null),
      error: () => this.pedido.set(null),
    });
  }
}

const TOPES = [{ codigo: 'MAX_CONSULTORIOS' }, { codigo: 'MAX_PROFESIONALES' }] as const;

/** "Hasta 3 sedes · 6 profesionales" a partir de los topes del plan. */
function topes(plan: PlanResponse): string {
  const tope = (codigo: string, singular: string, plural: string): string | null => {
    const limite = plan.limits?.find((l) => l.code === codigo);
    if (!limite) return null;
    if (limite.unlimited || limite.value === undefined) return `${plural} sin tope`;
    return `${limite.value} ${limite.value === 1 ? singular : plural}`;
  };
  const partes = [
    tope('MAX_CONSULTORIOS', 'sede', 'sedes'),
    tope('MAX_PROFESIONALES', 'profesional', 'profesionales'),
  ].filter((p): p is string => p !== null);
  return partes.length > 0 ? `Hasta ${partes.join(' · ')}` : 'Sin topes declarados';
}

function mensaje(e: unknown): string {
  if (e instanceof AkineHttpError) {
    if (e.problemType === 'pedido-de-plan-pendiente') {
      return 'Ya hay un pedido esperando respuesta. Cancelalo si querés pedir otra cosa.';
    }
    if (e.problemType === 'pedido-sin-cambios') {
      return 'Lo que elegiste es lo que ya tenés contratado.';
    }
    if (e.esDeRed) {
      return 'No se pudo contactar al servidor. Probá de nuevo.';
    }
    if (e.problemType === 'concurrent-modification') {
      return 'El pedido cambió mientras lo mirabas. Ya lo actualizamos.';
    }
    return e.message;
  }
  return 'No pudimos enviar el pedido.';
}
