import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Observable, forkJoin } from 'rxjs';

import { AvanceDelPlan } from '../../../api/generated/model/avance-del-plan';
import { PlanItem } from '../../../api/generated/model/plan-item';
import {
  PlanTratamiento,
  PlanTratamientoEstadoEnum,
} from '../../../api/generated/model/plan-tratamiento';
import { PlanTratamientoVersion } from '../../../api/generated/model/plan-tratamiento-version';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { PlanApi } from './plan-api';
import { ErrorPlan, traducirErrorPlan } from './plan-errors';

interface FilaItem {
  ofertaId: string;
  cantidadPlanificada: string;
}

/**
 * Plan de tratamiento de un caso clinico.
 *
 * <p>Recibe el `casoId` por la ruta: no lista ni abre casos. Muestra el plan vigente (el ultimo
 * no finalizado, o el ultimo si todos finalizaron), sus items, versiones y avance, y ofrece
 * crear/modificar y las transiciones. <b>No reimplementa reglas del backend</b>: activar sin
 * items o una transicion invalida devuelven un 409 que se muestra tal cual. Sin
 * `permissionGuard`: la autoridad es el backend.
 */
@Component({
  selector: 'app-plan-page',
  template: `
    <main class="plan" aria-labelledby="plan-titulo">
      <h1 id="plan-titulo">Plan de tratamiento</h1>

      @if (cargando()) {
        <p role="status">Cargando el plan...</p>
      }

      @if (error(); as e) {
        <p class="plan-error" role="alert" [attr.data-causa]="e.causa">{{ e.mensaje }}</p>
        @if (e.causa === 'version-vieja') {
          <button type="button" id="plan-releer" (click)="cargar()">Releer el plan</button>
        }
      }

      @if (plan(); as p) {
        <section aria-label="Estado del plan">
          <p>
            Plan #{{ p.numeroPlan }} · <strong id="plan-estado">{{ p.estado }}</strong> · version
            {{ p.version }}
          </p>
          @if (p.motivoSuspension && p.estado === 'SUSPENDIDO') {
            <p>Motivo de suspension: {{ p.motivoSuspension }}</p>
          }
          @if (p.motivoFinalizacion) {
            <p>Motivo de finalizacion: {{ p.motivoFinalizacion }}</p>
          }
        </section>

        <section aria-label="Items del plan">
          <h2>Items</h2>
          @if (items().length === 0) {
            <p id="plan-sin-items">El plan todavia no tiene items.</p>
          } @else {
            <ul id="plan-items">
              @for (i of items(); track i.id) {
                <li>
                  {{ i.ofertaNombre ?? 'Oferta ' + i.ofertaId }} · {{ i.cantidadPlanificada }}
                  sesiones planificadas
                  @if (i.cantidadAutorizada !== undefined) {
                    · {{ i.cantidadAutorizada }} autorizadas
                  }
                </li>
              }
            </ul>
          }
        </section>

        @if (avance(); as a) {
          <section aria-label="Avance">
            <h2>Avance</h2>
            <p id="plan-avance">{{ a.completo ? 'Plan completo.' : 'Plan en curso.' }}</p>
            <ul>
              @for (it of a.items ?? []; track $index) {
                <li>{{ resumenAvance(it) }}</li>
              }
            </ul>
          </section>
        }

        <section aria-label="Versiones">
          <h2>Versiones</h2>
          <ol id="plan-versiones">
            @for (v of versiones(); track v.id) {
              <li>
                v{{ v.numeroVersion }}
                @if (v.motivoModificacion) {
                  · {{ v.motivoModificacion }}
                }
              </li>
            }
          </ol>
        </section>
      }

      @if (puedeEditar()) {
        <section aria-label="Editor">
          <h2>{{ plan() ? 'Modificar plan' : 'Crear plan' }}</h2>
          <label for="plan-objetivos">Objetivos</label>
          <textarea
            id="plan-objetivos"
            [value]="objetivos()"
            (input)="objetivos.set($any($event.target).value)"
          ></textarea>
          <label for="plan-indicaciones">Indicaciones</label>
          <textarea
            id="plan-indicaciones"
            [value]="indicaciones()"
            (input)="indicaciones.set($any($event.target).value)"
          ></textarea>
          <label for="plan-frecuencia">Frecuencia semanal</label>
          <input
            id="plan-frecuencia"
            type="number"
            [value]="frecuencia()"
            (input)="frecuencia.set($any($event.target).value)"
          />
          <label for="plan-duracion">Duracion (semanas)</label>
          <input
            id="plan-duracion"
            type="number"
            [value]="duracion()"
            (input)="duracion.set($any($event.target).value)"
          />

          <h3>Items a planificar</h3>
          @for (f of filas(); track $index) {
            <div class="plan-fila">
              <input
                type="number"
                aria-label="Oferta"
                class="plan-oferta"
                [value]="f.ofertaId"
                (input)="editarFila($index, 'ofertaId', $any($event.target).value)"
              />
              <input
                type="number"
                aria-label="Cantidad"
                class="plan-cantidad"
                [value]="f.cantidadPlanificada"
                (input)="editarFila($index, 'cantidadPlanificada', $any($event.target).value)"
              />
              <button type="button" (click)="quitarFila($index)">Quitar</button>
            </div>
          }
          <button type="button" id="plan-agregar-item" (click)="agregarFila()">Agregar item</button>

          @if (plan()) {
            <label for="plan-motivo-mod">Motivo de la modificacion</label>
            <input
              id="plan-motivo-mod"
              [value]="motivoModificacion()"
              (input)="motivoModificacion.set($any($event.target).value)"
            />
          }
          <button
            type="button"
            id="plan-guardar"
            [disabled]="enVuelo() || !objetivos().trim()"
            (click)="guardar()"
          >
            {{ plan() ? 'Guardar cambios' : 'Crear plan' }}
          </button>
        </section>
      }

      @if (plan(); as p) {
        @if (p.estado !== 'FINALIZADO') {
          <section aria-label="Transiciones">
            <h2>Estado del plan</h2>
            @if (p.estado === 'BORRADOR') {
              <button type="button" id="plan-activar" [disabled]="enVuelo()" (click)="activar()">
                Activar
              </button>
            }
            @if (p.estado === 'SUSPENDIDO') {
              <button type="button" id="plan-reanudar" [disabled]="enVuelo()" (click)="reanudar()">
                Reanudar
              </button>
            }
            <label for="plan-motivo">Motivo (suspender o finalizar)</label>
            <input
              id="plan-motivo"
              [value]="motivo()"
              (input)="motivo.set($any($event.target).value)"
            />
            @if (p.estado === 'ACTIVO') {
              <button
                type="button"
                id="plan-suspender"
                [disabled]="enVuelo() || !motivo().trim()"
                (click)="suspender()"
              >
                Suspender
              </button>
            }
            <button
              type="button"
              id="plan-finalizar"
              [disabled]="enVuelo() || !motivo().trim()"
              (click)="finalizar()"
            >
              Finalizar
            </button>
          </section>
        }
      }
    </main>
  `,
})
export class PlanPage {
  private readonly api = inject(PlanApi);
  private readonly tenantContext = inject(TenantContextStore);

  /** De la ruta. `withComponentInputBinding` lo liga solo. */
  readonly casoId = input.required<string>();

  protected readonly plan = signal<PlanTratamiento | null>(null);
  protected readonly versiones = signal<PlanTratamientoVersion[]>([]);
  protected readonly avance = signal<AvanceDelPlan | null>(null);
  protected readonly cargando = signal(false);
  protected readonly enVuelo = signal(false);
  protected readonly error = signal<ErrorPlan | null>(null);

  protected readonly objetivos = signal('');
  protected readonly indicaciones = signal('');
  protected readonly frecuencia = signal('');
  protected readonly duracion = signal('');
  protected readonly motivoModificacion = signal('');
  protected readonly motivo = signal('');
  protected readonly filas = signal<FilaItem[]>([]);

  protected readonly items = computed(() => this.plan()?.versionVigente?.items ?? []);
  protected readonly puedeEditar = computed(() => {
    const p = this.plan();
    return !this.cargando() && (!p || p.estado !== PlanTratamientoEstadoEnum.FINALIZADO);
  });

  constructor() {
    effect(() => {
      this.casoId();
      this.tenantContext.consultorioId();
      untracked(() => this.cargar());
    });
  }

  /** Busca el plan vigente del caso y trae sus versiones y su avance. */
  cargar(): void {
    this.error.set(null);
    this.cargando.set(true);
    this.api.listar(Number(this.casoId())).subscribe({
      next: (planes) => {
        const elegido = elegirVigente(planes);
        if (elegido?.id) {
          this.traer(elegido.id);
        } else {
          this.limpiar();
        }
      },
      error: (e) => this.fallar(e),
    });
  }

  protected guardar(): void {
    const p = this.plan();
    const base = {
      objetivos: this.objetivos().trim(),
      indicaciones: this.indicaciones().trim() || undefined,
      frecuenciaSemanal: aNumero(this.frecuencia()),
      duracionSemanas: aNumero(this.duracion()),
      items: this.itemsDeFilas(),
    };
    if (!p?.id) {
      this.ejecutar(this.api.crear(Number(this.casoId()), base));
      return;
    }
    this.ejecutar(
      this.api.modificar(p.id, {
        ...base,
        expectedVersion: p.version ?? 0,
        motivo: this.motivoModificacion().trim() || undefined,
      }),
    );
  }

  protected activar(): void {
    const p = this.plan();
    if (p?.id) this.ejecutar(this.api.activar(p.id, p.version ?? 0));
  }

  protected reanudar(): void {
    const p = this.plan();
    if (p?.id) this.ejecutar(this.api.reanudar(p.id, p.version ?? 0));
  }

  protected suspender(): void {
    const p = this.plan();
    if (p?.id) {
      this.ejecutar(
        this.api.suspender(p.id, { expectedVersion: p.version ?? 0, motivo: this.motivo().trim() }),
      );
    }
  }

  protected finalizar(): void {
    const p = this.plan();
    if (p?.id) {
      this.ejecutar(
        this.api.finalizar(p.id, { expectedVersion: p.version ?? 0, motivo: this.motivo().trim() }),
      );
    }
  }

  protected agregarFila(): void {
    this.filas.update((f) => [...f, { ofertaId: '', cantidadPlanificada: '1' }]);
  }

  protected quitarFila(indice: number): void {
    this.filas.update((f) => f.filter((_, i) => i !== indice));
  }

  protected editarFila(indice: number, campo: keyof FilaItem, valor: string): void {
    this.filas.update((f) =>
      f.map((fila, i) => (i === indice ? { ...fila, [campo]: valor } : fila)),
    );
  }

  protected resumenAvance(item: object): string {
    return Object.entries(item)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');
  }

  private traer(planId: number): void {
    forkJoin({
      plan: this.api.ver(planId),
      versiones: this.api.versiones(planId),
      avance: this.api.avance(planId),
    }).subscribe({
      next: ({ plan, versiones, avance }) => {
        this.plan.set(plan);
        this.versiones.set(versiones);
        this.avance.set(avance);
        this.llenarEditor(plan);
        this.motivo.set('');
        this.cargando.set(false);
      },
      error: (e) => this.fallar(e),
    });
  }

  /** Corre una escritura; al volver relee todo desde el servidor. Nunca reintenta en silencio. */
  private ejecutar(operacion: Observable<PlanTratamiento>): void {
    this.error.set(null);
    this.enVuelo.set(true);
    operacion.subscribe({
      next: (plan) => {
        this.enVuelo.set(false);
        if (plan.id) this.traer(plan.id);
      },
      error: (e) => this.fallar(e),
    });
  }

  private fallar(e: unknown): void {
    this.cargando.set(false);
    this.enVuelo.set(false);
    this.error.set(traducirErrorPlan(e));
  }

  private limpiar(): void {
    this.plan.set(null);
    this.versiones.set([]);
    this.avance.set(null);
    this.llenarEditor(null);
    this.cargando.set(false);
  }

  private llenarEditor(plan: PlanTratamiento | null): void {
    const v = plan?.versionVigente;
    this.objetivos.set(v?.objetivos ?? '');
    this.indicaciones.set(v?.indicaciones ?? '');
    this.frecuencia.set(v?.frecuenciaSemanal?.toString() ?? '');
    this.duracion.set(v?.duracionSemanas?.toString() ?? '');
    this.motivoModificacion.set('');
    this.filas.set(
      (v?.items ?? []).map((i) => ({
        ofertaId: String(i.ofertaId ?? ''),
        cantidadPlanificada: String(i.cantidadPlanificada ?? 1),
      })),
    );
  }

  private itemsDeFilas(): PlanItem[] {
    return this.filas()
      .filter((f) => f.ofertaId.trim() !== '')
      .map((f) => ({
        ofertaId: Number(f.ofertaId),
        cantidadPlanificada: Number(f.cantidadPlanificada) || 1,
      }));
  }
}

function aNumero(valor: string): number | undefined {
  return valor.trim() === '' ? undefined : Number(valor);
}

/** El ultimo plan no finalizado; si todos finalizaron, el de numero mayor. */
function elegirVigente(planes: PlanTratamiento[]): PlanTratamiento | undefined {
  const porNumero = [...planes].sort((a, b) => (b.numeroPlan ?? 0) - (a.numeroPlan ?? 0));
  return porNumero.find((p) => p.estado !== PlanTratamientoEstadoEnum.FINALIZADO) ?? porNumero[0];
}
