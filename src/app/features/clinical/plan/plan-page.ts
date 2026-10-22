import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable, Subscription, forkJoin } from 'rxjs';

import { AvanceDelPlan } from '../../../api/generated/model/avance-del-plan';
import { AvanceDeItem } from '../../../api/generated/model/avance-de-item';
import { CasoClinico } from '../../../api/generated/model/caso-clinico';
import { OfertaResponse } from '../../../api/generated/model/oferta-response';
import { PlanItem } from '../../../api/generated/model/plan-item';
import { PlanItemPlanificado } from '../../../api/generated/model/plan-item-planificado';
import { PlanTratamiento } from '../../../api/generated/model/plan-tratamiento';
import { PlanTratamientoVersion } from '../../../api/generated/model/plan-tratamiento-version';
import { DiaDeLaSede } from '../../../core/services/dia-de-la-sede';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { CasosApi } from '../casos/casos-api';
import { PedidoDeMotivo } from '../components/pedido-de-motivo';
import { ESTADOS_DE_PLAN } from '../models/etiquetas-de-casos';
import { fechaYHora, rotulo } from '../models/etiquetas-de-historia';
import { SedeClinicaApi, ofertaElegible } from '../services/sede-clinica-api';
import { VisitaClinica } from '../services/visita-clinica';
import { advertenciasDelPlan, vigenciaDeAutorizacion } from './advertencias-del-plan';
import { PlanApi } from './plan-api';
import { ErrorPlan, errorDeCausaPlan, traducirErrorPlan } from './plan-errors';
import { Ayuda } from '../../../shared/components/ayuda/ayuda';

/** Una fila del editor. Texto mientras se escribe; se valida y convierte al guardar. */
interface FilaDeItem {
  readonly ofertaId: number | null;
  readonly planificadas: string;
  readonly autorizadas: string;
}

type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'requiere-justificacion' }
  | { readonly tipo: 'listo' }
  | { readonly tipo: 'error'; readonly error: ErrorPlan };

type Editor = { readonly modo: 'crear' } | { readonly modo: 'modificar'; readonly plan: number };

/**
 * El Plan de Tratamiento de un caso (D-c, RF-M11-001..006).
 *
 * <p><b>Planificado no es realizado</b> (RN-M11-001): la pantalla muestra lo planificado, lo
 * autorizado y lo realizado lado a lado, y lo realizado sale SIEMPRE del avance que deriva el
 * backend. Nada se carga a mano.
 *
 * <p>Un caso tiene a lo sumo un plan vivo, pero puede tener varios finalizados: son su recorrido.
 * La pantalla lista todos, elige el vigente y deja mirar cualquiera, con sus versiones y el avance
 * de cada version ("8 de 20" en la v1 y "8 de 24" en la v2 son los dos correctos).
 */
@Component({
  selector: 'app-plan-page',
  imports: [Ayuda, RouterLink, PedidoDeMotivo],
  templateUrl: './plan-page.html',
  styleUrl: '../pages/historia-clinica/historia-clinica.css',
})
export class PlanPage {
  private readonly api = inject(PlanApi);
  private readonly casos = inject(CasosApi);
  private readonly sede = inject(SedeClinicaApi);
  private readonly contexto = inject(TenantContextStore);
  private readonly dia = inject(DiaDeLaSede);
  protected readonly visita = inject(VisitaClinica);

  readonly casoId = input.required<string>();

  protected readonly fechaYHora = fechaYHora;
  protected readonly rotuloDeEstado = (estado: string | undefined) =>
    rotulo(ESTADOS_DE_PLAN, estado);

  protected readonly estado = signal<Estado>({ tipo: 'cargando' });
  protected readonly caso = signal<CasoClinico | null>(null);
  protected readonly planes = signal<readonly PlanTratamiento[]>([]);
  protected readonly planId = signal<number | null>(null);
  protected readonly versiones = signal<readonly PlanTratamientoVersion[]>([]);
  protected readonly avance = signal<AvanceDelPlan | null>(null);
  /** Version cuyo avance se mira; `null` es la vigente. */
  protected readonly versionDelAvance = signal<number | null>(null);
  private readonly ofertas = signal<readonly OfertaResponse[]>([]);

  protected readonly enVuelo = signal(false);
  protected readonly errorDeOperacion = signal<ErrorPlan | null>(null);
  protected readonly aviso = signal('');

  // Editor
  protected readonly editor = signal<Editor | null>(null);
  protected readonly objetivos = signal('');
  protected readonly indicaciones = signal('');
  protected readonly frecuencia = signal('');
  protected readonly duracion = signal('');
  protected readonly filas = signal<readonly FilaDeItem[]>([]);
  protected readonly motivoModificacion = signal('');
  protected readonly intentoGuardar = signal(false);

  // Transiciones
  protected readonly motivoTransicion = signal('');
  protected readonly intentoTransicion = signal(false);

  protected readonly idDelCaso = computed(() => Number(this.casoId()));
  protected readonly plan = computed(
    () => this.planes().find((p) => p.id === this.planId()) ?? null,
  );
  protected readonly casoActivo = computed(() => this.caso()?.estado === 'ACTIVO');
  /** Sin plan vivo en el caso se ofrece crear uno; con uno vivo, se trabaja sobre ese. */
  protected readonly hayPlanVivo = computed(() =>
    this.planes().some((p) => p.estado === 'ACTIVO' || p.estado === 'SUSPENDIDO'),
  );
  protected readonly elegibles = computed(() => this.ofertas().filter(ofertaElegible));
  protected readonly advertencias = computed(() => {
    const plan = this.plan();
    return plan === null
      ? []
      : advertenciasDelPlan(plan, this.avance(), this.ofertas(), this.dia.hoy());
  });

  protected readonly faltaObjetivos = computed(() => this.objetivos().trim() === '');
  protected readonly filasInvalidas = computed(() =>
    this.filas().some((f) => f.ofertaId === null || !esEnteroPositivo(f.planificadas)),
  );
  protected readonly faltaMotivoTransicion = computed(() => this.motivoTransicion().trim() === '');

  private pedido: Subscription | null = null;
  private pedidoDelPlan: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.pedido?.unsubscribe();
      this.pedidoDelPlan?.unsubscribe();
    });

    effect(() => {
      this.casoId();
      this.visita.motivo();
      this.contexto.contextEpoch();
      untracked(() => this.cargar(null));
    });

    effect(() => {
      const consultorioId = this.contexto.consultorioId();
      untracked(() => {
        this.ofertas.set([]);
        if (consultorioId !== null) {
          this.sede.ofertas$(consultorioId).subscribe((lista) => this.ofertas.set(lista));
        }
      });
    });
  }

  protected nombreDeOferta(ofertaId: number | undefined, snapshot?: string): string {
    if (snapshot) return snapshot;
    if (ofertaId === undefined) return 'Sin oferta';
    return this.ofertas().find((o) => o.id === ofertaId)?.nombreComercial ?? `Oferta #${ofertaId}`;
  }

  /** Vigencia de la autorizacion del item contra el dia de la sede, o `null` si no tiene. */
  protected vigenciaDe(item: PlanItemPlanificado) {
    return vigenciaDeAutorizacion(item, this.dia.hoy());
  }

  protected resumenDeAvance(item: AvanceDeItem): string {
    const autorizadas =
      item.autorizadas === undefined || item.autorizadas === null
        ? 'sin autorización declarada'
        : `${item.autorizadas} autorizadas`;
    return (
      `${item.realizadas ?? 0} de ${item.planificadas ?? 0} realizadas · ${autorizadas} · ` +
      `${item.canceladas ?? 0} canceladas · ${item.restantes ?? 0} restantes`
    );
  }

  protected elegirPlan(valor: string): void {
    this.planId.set(Number(valor));
    this.cerrarEditor();
    this.cargarDetalle();
  }

  protected verAvanceDe(numeroVersion: number | undefined): void {
    this.versionDelAvance.set(numeroVersion ?? null);
    this.cargarAvance();
  }

  protected releer(): void {
    this.cargar(this.planId());
  }

  // --- Editor ----------------------------------------------------------------------------

  protected crear(): void {
    this.editor.set({ modo: 'crear' });
    this.llenarEditor(null);
  }

  protected modificar(): void {
    const plan = this.plan();
    if (plan?.id === undefined) return;
    this.editor.set({ modo: 'modificar', plan: plan.id });
    this.llenarEditor(plan.versionVigente ?? null);
  }

  protected cerrarEditor(): void {
    this.editor.set(null);
    this.intentoGuardar.set(false);
  }

  protected agregarFila(): void {
    this.filas.update((f) => [...f, { ofertaId: null, planificadas: '', autorizadas: '' }]);
  }

  protected quitarFila(indice: number): void {
    this.filas.update((f) => f.filter((_, i) => i !== indice));
  }

  protected editarFila(indice: number, campo: keyof FilaDeItem, valor: string): void {
    this.filas.update((f) =>
      f.map((fila, i) =>
        i !== indice
          ? fila
          : campo === 'ofertaId'
            ? { ...fila, ofertaId: valor === '' ? null : Number(valor) }
            : { ...fila, [campo]: valor },
      ),
    );
  }

  protected guardar(): void {
    this.intentoGuardar.set(true);
    const editor = this.editor();
    const caso = this.caso();
    if (editor === null || caso?.id === undefined) return;
    if (this.faltaObjetivos() || this.filasInvalidas()) return;

    const contenido = {
      objetivos: this.objetivos().trim(),
      ...opcional('indicaciones', this.indicaciones().trim()),
      ...numeroOpcional('frecuenciaSemanal', this.frecuencia()),
      ...numeroOpcional('duracionSemanas', this.duracion()),
      items: this.filas().map((f): PlanItem => ({
        ofertaId: f.ofertaId as number,
        cantidadPlanificada: Number(f.planificadas),
        ...(esEnteroNoNegativo(f.autorizadas) ? { cantidadAutorizada: Number(f.autorizadas) } : {}),
      })),
    };

    if (editor.modo === 'crear') {
      this.operar(
        this.api.crear(caso.id, contenido, this.visita.motivo()),
        'Se creo el plan en borrador. Activarlo es otra decision.',
      );
      return;
    }
    const plan = this.plan();
    this.operar(
      this.api.modificar(
        editor.plan,
        {
          ...contenido,
          expectedVersion: plan?.version ?? 0,
          ...opcional('motivo', this.motivoModificacion().trim()),
        },
        this.visita.motivo(),
      ),
      plan?.estado === 'BORRADOR'
        ? 'Se guardo el borrador.'
        : 'Se guardo una versión nueva del plan. La anterior sigue consultable.',
    );
  }

  // --- Transiciones ----------------------------------------------------------------------

  protected activar(): void {
    const plan = this.plan();
    if (plan?.id === undefined) return;
    this.operar(
      this.api.activar(plan.id, plan.version ?? 0, this.visita.motivo()),
      'El plan quedo activo.',
    );
  }

  protected reanudar(): void {
    const plan = this.plan();
    if (plan?.id === undefined) return;
    this.operar(
      this.api.reanudar(plan.id, plan.version ?? 0, this.visita.motivo()),
      'El plan se reanudo.',
    );
  }

  protected suspender(): void {
    this.conMotivo((plan, motivo) =>
      this.operar(
        this.api.suspender(plan.id!, motivo, plan.version ?? 0, this.visita.motivo()),
        'El plan quedo suspendido. Sigue ocupando el lugar del vigente hasta reanudarlo o finalizarlo.',
      ),
    );
  }

  protected finalizar(): void {
    this.conMotivo((plan, motivo) =>
      this.operar(
        this.api.finalizar(plan.id!, motivo, plan.version ?? 0, this.visita.motivo()),
        'El plan quedo finalizado. No se reabre: si hace falta, se crea uno nuevo.',
      ),
    );
  }

  /** Va al plan que ocupa el lugar (`plan-vivo-en-el-caso`). */
  protected irAlPlan(planId: number): void {
    this.planId.set(planId);
    this.errorDeOperacion.set(null);
    this.cargarDetalle();
  }

  // ---------------------------------------------------------------------------------------

  private conMotivo(accion: (plan: PlanTratamiento, motivo: string) => void): void {
    this.intentoTransicion.set(true);
    const plan = this.plan();
    if (plan?.id === undefined || this.faltaMotivoTransicion()) return;
    accion(plan, this.motivoTransicion().trim());
  }

  private operar(pedido: Observable<PlanTratamiento>, exito: string): void {
    this.enVuelo.set(true);
    this.errorDeOperacion.set(null);
    this.aviso.set('');
    pedido.subscribe({
      next: (plan) => {
        this.enVuelo.set(false);
        this.cerrarEditor();
        this.motivoTransicion.set('');
        this.intentoTransicion.set(false);
        this.motivoModificacion.set('');
        this.aviso.set(exito);
        // Activar uno puede finalizar otro: se relee la lista entera, no solo este plan.
        this.cargar(plan.id ?? null);
      },
      error: (error: unknown) => {
        this.enVuelo.set(false);
        const traducido = traducirErrorPlan(error);
        if (traducido.causa === 'requiere-justificacion') {
          this.estado.set({ tipo: 'requiere-justificacion' });
          return;
        }
        this.errorDeOperacion.set(traducido);
      },
    });
  }

  private cargar(preferido: number | null): void {
    if (this.visita.personaId() === null) return;
    const casoId = Number(this.casoId());
    if (!Number.isSafeInteger(casoId) || casoId <= 0) {
      this.estado.set({ tipo: 'error', error: errorDeCausaPlan('no-encontrado') });
      return;
    }
    if (this.estado().tipo !== 'listo') this.estado.set({ tipo: 'cargando' });
    this.pedido?.unsubscribe();
    const motivo = this.visita.motivo();
    this.pedido = forkJoin({
      caso: this.casos.ver(casoId, motivo),
      planes: this.api.listar(casoId, motivo),
    }).subscribe({
      next: ({ caso, planes }) => {
        this.caso.set(caso);
        this.planes.set(planes);
        const elegido = planes.find((p) => p.id === preferido) ?? planVigente(planes);
        this.planId.set(elegido?.id ?? null);
        this.estado.set({ tipo: 'listo' });
        this.cargarDetalle();
      },
      error: (error: unknown) => {
        // El caso y la lista comparten acceso: el mismo 403 o 404 vale para los dos.
        const traducido = traducirErrorPlan(error);
        this.estado.set(
          traducido.causa === 'requiere-justificacion'
            ? { tipo: 'requiere-justificacion' }
            : { tipo: 'error', error: traducido },
        );
      },
    });
  }

  private cargarDetalle(): void {
    const planId = this.planId();
    this.versiones.set([]);
    this.avance.set(null);
    this.versionDelAvance.set(null);
    if (planId === null) return;
    this.pedidoDelPlan?.unsubscribe();
    const motivo = this.visita.motivo();
    this.pedidoDelPlan = forkJoin({
      versiones: this.api.versiones(planId, motivo),
      avance: this.api.avance(planId, null, motivo),
    }).subscribe({
      next: ({ versiones, avance }) => {
        this.versiones.set(versiones);
        this.avance.set(avance);
      },
      error: (error: unknown) => this.errorDeOperacion.set(traducirErrorPlan(error)),
    });
  }

  private cargarAvance(): void {
    const planId = this.planId();
    if (planId === null) return;
    this.api.avance(planId, this.versionDelAvance(), this.visita.motivo()).subscribe({
      next: (avance) => this.avance.set(avance),
      error: (error: unknown) => this.errorDeOperacion.set(traducirErrorPlan(error)),
    });
  }

  private llenarEditor(version: PlanTratamientoVersion | null): void {
    this.intentoGuardar.set(false);
    this.objetivos.set(version?.objetivos ?? '');
    this.indicaciones.set(version?.indicaciones ?? '');
    this.frecuencia.set(version?.frecuenciaSemanal?.toString() ?? '');
    this.duracion.set(version?.duracionSemanas?.toString() ?? '');
    this.motivoModificacion.set('');
    this.filas.set(
      (version?.items ?? []).map((i) => ({
        ofertaId: i.ofertaId ?? null,
        planificadas: i.cantidadPlanificada?.toString() ?? '',
        autorizadas: i.cantidadAutorizada?.toString() ?? '',
      })),
    );
    if (this.filas().length === 0) this.agregarFila();
  }
}

/** El que esta en juego: el activo, si no el suspendido, si no el borrador mas reciente. */
function planVigente(planes: readonly PlanTratamiento[]): PlanTratamiento | undefined {
  for (const estado of ['ACTIVO', 'SUSPENDIDO', 'BORRADOR'] as const) {
    const plan = planes.find((p) => p.estado === estado);
    if (plan) return plan;
  }
  return planes[0];
}

function esEnteroPositivo(valor: string): boolean {
  return /^\d+$/.test(valor.trim()) && Number(valor) > 0;
}

function esEnteroNoNegativo(valor: string): boolean {
  return /^\d+$/.test(valor.trim());
}

function opcional<K extends string>(clave: K, valor: string): Partial<Record<K, string>> {
  return valor === '' ? {} : ({ [clave]: valor } as Record<K, string>);
}

function numeroOpcional<K extends string>(clave: K, valor: string): Partial<Record<K, number>> {
  return esEnteroPositivo(valor) ? ({ [clave]: Number(valor) } as Record<K, number>) : {};
}
