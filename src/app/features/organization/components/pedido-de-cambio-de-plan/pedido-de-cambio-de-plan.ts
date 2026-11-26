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
