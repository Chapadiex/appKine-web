import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { PlanesService } from '../../../../api/generated/api/planes.service';
import { PlataformaService } from '../../../../api/generated/api/plataforma.service';
import { SuscripcionesService } from '../../../../api/generated/api/suscripciones.service';
import { LimitUsageResponse } from '../../../../api/generated/model/limit-usage-response';
import { PlanResponse } from '../../../../api/generated/model/plan-response';
import { PlatformSubscriptionResponse } from '../../../../api/generated/model/platform-subscription-response';
import { RUTA_SOLICITUDES_DE_PLATAFORMA } from '../../models/rutas-de-plataforma';
import { ErrorSuscripcion, traducirErrorSuscripcion } from '../../models/suscripcion-errors';

type Estado =
  | { readonly tipo: 'inicial' }
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly suscripcion: PlatformSubscriptionResponse }
  | { readonly tipo: 'error'; readonly error: ErrorSuscripcion };

interface Resultado {
  readonly ok: boolean;
  readonly texto: string;
  readonly excedidos: readonly LimitUsageResponse[];
}

/**
 * La suscripcion de un centro y el cambio de plan, para la administracion de plataforma (PLA-06).
 *
 * <p><b>Por que existe (D3 del pre-QA del 14/10).</b> El cambio de plan exige `expectedVersion`, y
 * la unica lectura de la suscripcion era la del tenant (`GET /organizations/{org}/subscription`),
 * que para la plataforma pide un acceso de soporte abierto. Sin soporte, la version solo salia de
 * la base. `appKine-api` #133 agrego `getPlatformSubscription` con el mismo guard que el cambio de
 * plan, y esta pantalla toma la version <b>de ahi</b>, nunca de un campo que se escriba a mano.
 *
 * <p><b>Sin contexto de tenant</b>, igual que la bandeja de solicitudes: quien la usa administra la
 * plataforma y no es miembro del centro. Tampoco trae el consumo de limites, que es dato del centro
 * y sigue detras del soporte: los limites que el plan nuevo ya excede vuelven en la respuesta del
 * cambio, como aviso.
 */
@Component({
  selector: 'app-suscripcion-de-centro-page',
  imports: [RouterLink],
  templateUrl: './suscripcion-de-centro-page.html',
})
export class SuscripcionDeCentroPage {
  private readonly plataforma = inject(PlataformaService);
  private readonly suscripciones = inject(SuscripcionesService);
  private readonly catalogoDePlanes = inject(PlanesService);

  protected readonly rutaSolicitudes = RUTA_SOLICITUDES_DE_PLATAFORMA;

  protected readonly organizacion = signal('');
  protected readonly intentoBuscar = signal(false);
  protected readonly estado = signal<Estado>({ tipo: 'inicial' });
  protected readonly planes = signal<readonly PlanResponse[]>([]);
  protected readonly planesNoDisponibles = signal(false);
  protected readonly planElegido = signal('');
  protected readonly enviando = signal(false);
  protected readonly resultado = signal<Resultado | null>(null);

  /** La organizacion consultada: la del ultimo pedido, no la que se esta escribiendo. */
  private orgId: number | null = null;
  private pedido: Subscription | null = null;

  protected readonly organizacionInvalida = computed(() => aId(this.organizacion()) === null);
  protected readonly suscripcion = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'listo' ? estado.suscripcion : null;
  });
  protected readonly error = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.error : null;
  });
  protected readonly activa = computed(() => this.suscripcion()?.status === 'ACTIVA');
  /** Elegir el plan vigente no es un cambio: el backend responderia `applied=false`. */
  protected readonly mismoPlan = computed(
    () => this.planElegido() !== '' && this.planElegido() === this.suscripcion()?.planCode,
  );

  constructor() {
    this.catalogoDePlanes.listPlans().subscribe({
      next: (planes) => this.planes.set(planes),
      error: () => this.planesNoDisponibles.set(true),
    });
  }

  protected buscar(): void {
    this.intentoBuscar.set(true);
    const orgId = aId(this.organizacion());
    if (orgId === null) return;
    this.orgId = orgId;
    this.resultado.set(null);
    this.leer();
  }

  protected cambiarPlan(): void {
    const suscripcion = this.suscripcion();
    const planCode = this.planElegido();
    if (
      this.orgId === null ||
      suscripcion?.version === undefined ||
      planCode === '' ||
      this.mismoPlan() ||
      this.enviando()
    ) {
      return;
    }
    this.enviando.set(true);
    this.resultado.set(null);
    this.suscripciones
      .changeSubscriptionPlan({
        orgId: this.orgId,
        planChangeRequest: { planCode, expectedVersion: suscripcion.version },
      })
      .subscribe({
        next: (respuesta) => {
          this.enviando.set(false);
          const excedidos = (respuesta.warnings ?? []).filter((w) => w.exceeded !== false);
          this.resultado.set({
            ok: true,
            texto:
              respuesta.applied === false
                ? 'Ese plan ya era el vigente: no hubo cambio.'
                : `El centro paso al plan ${this.nombreDePlan(planCode)}.`,
            excedidos,
          });
          // La version nueva sale de la relectura, que es la misma fuente que uso este envio.
          this.leer();
        },
        error: (error: unknown) => {
          this.enviando.set(false);
          const traducido = traducirErrorSuscripcion(error);
          this.resultado.set({ ok: false, texto: traducido.mensaje, excedidos: [] });
          if (traducido.causa === 'version-vieja') this.leer();
        },
      });
  }

  protected nombreDePlan(codigo: string | undefined): string {
    if (!codigo) return 'sin plan';
    return this.planes().find((p) => p.code === codigo)?.name ?? codigo;
  }

  protected rotuloDeLimite(limite: LimitUsageResponse): string {
    return `${limite.code ?? 'Limite'}: ${limite.currentUsage ?? '?'} en uso, el plan admite ${
      limite.limitValue ?? '?'
    }`;
  }

  private leer(): void {
    const orgId = this.orgId;
    if (orgId === null) return;
    this.estado.set({ tipo: 'cargando' });
    this.pedido?.unsubscribe();
    this.pedido = this.plataforma.getPlatformSubscription({ orgId }).subscribe({
      next: (suscripcion) => {
        this.estado.set({ tipo: 'listo', suscripcion });
        this.planElegido.set(suscripcion.planCode ?? '');
      },
      error: (error: unknown) =>
        this.estado.set({ tipo: 'error', error: traducirErrorSuscripcion(error) }),
    });
  }
}

/** El numero de organizacion escrito, o `null` si no es un entero positivo. */
function aId(texto: string): number | null {
  const limpio = texto.trim();
  if (!/^\d+$/.test(limpio)) return null;
  const id = Number(limpio);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
