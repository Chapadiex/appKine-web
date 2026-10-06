import {
  Component,
  computed,
  effect,
  inject,
  input,
  numberAttribute,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Observable, forkJoin } from 'rxjs';

import { CasoClinico } from '../../../../../api/generated/model/caso-clinico';
import { CasoEvento } from '../../../../../api/generated/model/caso-evento';
import { CasoProfesional, CasoProfesionalRolEnum } from '../../../../../api/generated/model/caso-profesional';
import { IntegranteDelEquipoRolEnum } from '../../../../../api/generated/model/integrante-del-equipo';
import { CasosApi } from '../../casos-api';
import { ErrorCaso, traducirErrorCaso } from '../../casos-errors';

/** Enlace al plan de tratamiento del caso. Local a proposito: A2 lo reconcilia con A3. */
const RUTA_PLAN_DEL_CASO = (casoId: number) => ['/atencion', 'plan', 'caso', casoId];

type PanelCaso = 'editar' | 'cerrar' | 'reabrir';

interface IntegranteBorrador {
  membershipId: string;
  rol: IntegranteDelEquipoRolEnum;
}

@Component({
  selector: 'app-caso-detalle-page',
  imports: [RouterLink, DatePipe],
  templateUrl: './caso-detalle-page.html',
  styleUrl: '../../../atencion.css',
})
export class CasoDetallePage {
  readonly casoId = input.required<number, unknown>({ transform: numberAttribute });

  private readonly api = inject(CasosApi);

  readonly caso = signal<CasoClinico | null>(null);
  readonly eventos = signal<CasoEvento[]>([]);
  readonly cargando = signal(false);
  readonly error = signal<ErrorCaso | null>(null);

  protected readonly guardando = signal(false);
  protected readonly panel = signal<PanelCaso | null>(null);
  protected readonly diagnostico = signal('');
  protected readonly objetivo = signal('');
  protected readonly motivo = signal('');
  protected readonly integrantes = signal<IntegranteBorrador[]>([]);
  private equipoEditado = false;

  protected readonly rutaPlan = computed(() => RUTA_PLAN_DEL_CASO(this.casoId()));
  protected readonly activo = computed(() => this.caso()?.estado === 'ACTIVO');
  protected readonly cerrado = computed(() => this.caso()?.estado === 'CERRADO');
  protected readonly vigentes = computed(() => this.equipoDe(true));
  protected readonly historicos = computed(() => this.equipoDe(false));
  protected readonly roles = Object.values(IntegranteDelEquipoRolEnum);

  constructor() {
    effect(() => {
      this.casoId();
      untracked(() => {
        this.equipoEditado = false;
        this.panel.set(null);
        this.recargar();
      });
    });
  }

  private equipoDe(vigente: boolean): CasoProfesional[] {
    return (this.caso()?.equipo ?? []).filter((p) => (p.vigente ?? !p.hasta) === vigente);
  }

  /** Relee `ver` y `eventos`. Nunca toca los borradores que el usuario escribio. */
  private recargar(alTerminar?: () => void): void {
    const id = this.casoId();
    this.cargando.set(true);
    forkJoin({ caso: this.api.ver(id), eventos: this.api.eventos(id) }).subscribe({
      next: ({ caso, eventos }) => {
        this.caso.set(caso);
        this.eventos.set(eventos);
        this.error.set(null);
        if (!this.equipoEditado) this.integrantes.set(this.borradorDeEquipo(caso));
        this.cargando.set(false);
        alTerminar?.();
      },
      error: (e) => {
        this.error.set(traducirErrorCaso(e));
        this.cargando.set(false);
      },
    });
  }

  private borradorDeEquipo(caso: CasoClinico): IntegranteBorrador[] {
    return (caso.equipo ?? [])
      .filter((p) => p.vigente ?? !p.hasta)
      .map((p) => ({
        membershipId: String(p.profesionalMembershipId ?? ''),
        rol:
          p.rol === CasoProfesionalRolEnum.RESPONSABLE
            ? IntegranteDelEquipoRolEnum.RESPONSABLE
            : IntegranteDelEquipoRolEnum.TRATANTE,
      }));
  }

  protected abrirPanel(panel: PanelCaso): void {
    if (panel === 'editar') {
      this.diagnostico.set(this.caso()?.diagnosticoPresuntivo ?? '');
      this.objetivo.set(this.caso()?.objetivoTerapeutico ?? '');
    } else {
      this.motivo.set('');
    }
    this.error.set(null);
    this.panel.set(panel);
  }

  protected cancelarPanel(): void {
    this.panel.set(null);
  }

  protected puedeConfirmar(): boolean {
    return this.panel() === 'editar'
      ? this.diagnostico().trim().length > 0
      : this.motivo().trim().length > 0;
  }

  protected confirmar(): void {
    const version = this.caso()?.version;
    const panel = this.panel();
    if (version === undefined || panel === null || !this.puedeConfirmar()) return;
    const id = this.casoId();
    const motivo = this.motivo().trim();
    const accion =
      panel === 'editar'
        ? this.api.editar(id, {
            expectedVersion: version,
            diagnosticoPresuntivo: this.diagnostico().trim(),
            objetivoTerapeutico: this.objetivo().trim(),
          })
        : panel === 'cerrar'
          ? this.api.cerrar(id, { expectedVersion: version, motivo })
          : this.api.reabrir(id, { expectedVersion: version, motivo });
    this.ejecutar(accion, () => this.panel.set(null));
  }

  protected agregarIntegrante(): void {
    this.equipoEditado = true;
    this.integrantes.update((l) => [
      ...l,
      { membershipId: '', rol: IntegranteDelEquipoRolEnum.TRATANTE },
    ]);
  }

  protected quitarIntegrante(indice: number): void {
    this.equipoEditado = true;
    this.integrantes.update((l) => l.filter((_, i) => i !== indice));
  }

  protected cambiarIntegrante(indice: number, parcial: Partial<IntegranteBorrador>): void {
    this.equipoEditado = true;
    this.integrantes.update((l) => l.map((x, i) => (i === indice ? { ...x, ...parcial } : x)));
  }

  protected equipoValido(): boolean {
    return this.integrantes().every((i) => {
      const n = Number(i.membershipId);
      return i.membershipId.trim() !== '' && Number.isInteger(n) && n > 0;
    });
  }

  protected guardarEquipo(): void {
    const version = this.caso()?.version;
    if (version === undefined || !this.equipoValido()) return;
    this.ejecutar(
      this.api.cambiarEquipo(this.casoId(), {
        expectedVersion: version,
        integrantes: this.integrantes().map((i) => ({
          profesionalMembershipId: Number(i.membershipId),
          rol: i.rol,
        })),
      }),
      () => {
        // `cambiarEquipo` devuelve la version LEIDA, no la nueva: se relee con `ver`.
        this.equipoEditado = false;
      },
    );
  }

  /**
   * Corre una accion y, si sale bien, relee `ver` y `eventos`. Si falla:
   * - `version-vieja`: relee y avisa; los borradores quedan como estaban.
   * - `caso-cerrado`: relee y vuelve a modo lectura.
   */
  private ejecutar(accion: Observable<CasoClinico>, alExito: () => void): void {
    this.guardando.set(true);
    accion.subscribe({
      next: () => {
        alExito();
        this.guardando.set(false);
        this.recargar();
      },
      error: (e) => {
        const err = traducirErrorCaso(e);
        this.guardando.set(false);
        if (err.causa === 'caso-cerrado') this.panel.set(null);
        if (err.causa === 'version-vieja' || err.causa === 'caso-cerrado') {
          this.recargar(() => this.error.set(err));
        } else {
          this.error.set(err);
        }
      },
    });
  }
}
