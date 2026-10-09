import { DatePipe } from '@angular/common';
import { Component, effect, inject, input, numberAttribute, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { CasoClinico } from '../../../../../api/generated/model/caso-clinico';
import { CasosApi } from '../../casos-api';
import { ErrorCaso, traducirErrorCaso } from '../../casos-errors';

@Component({
  selector: 'app-casos-listado-page',
  imports: [RouterLink, DatePipe],
  template: `
    <h1>Casos clinicos</h1>
    <p>
      <a class="enlace" [routerLink]="['/atencion', 'casos', 'hc', historiaClinicaId(), 'nuevo']">
        Abrir caso nuevo
      </a>
    </p>

    <label>
      <input
        type="checkbox"
        data-testid="casos-solo-activos"
        [checked]="soloActivos()"
        (change)="soloActivos.set($any($event.target).checked)"
      />
      Solo activos
    </label>

    @if (cargando()) {
      <p class="estado estado--cargando">Cargando casos…</p>
    }

    @if (error(); as problema) {
      <p class="estado estado--error" role="alert" data-testid="casos-error">
        {{ problema.mensaje }}
      </p>
    }

    @if (!cargando() && !error()) {
      @if (casos().length === 0) {
        <p class="estado estado--vacio">No hay casos para mostrar.</p>
      } @else {
        <ul data-testid="casos-lista">
          @for (caso of casos(); track caso.id) {
            <li class="tarjeta" data-testid="caso-item">
              <h2>
                <a class="enlace" [routerLink]="['/atencion', 'casos', 'detalle', caso.id]">
                  Caso {{ caso.numeroCaso }}
                </a>
              </h2>
              <p>{{ caso.diagnosticoPresuntivo }}</p>
              <p class="ayuda">
                {{ caso.estado }} · abierto el {{ caso.abiertoEn | date: 'dd/MM/yyyy' }} · Equipo:
                {{ equipoVigente(caso) }}
              </p>
            </li>
          }
        </ul>
      }
    }
  `,
})
export class CasosListadoPage {
  private readonly api = inject(CasosApi);

  readonly historiaClinicaId = input.required({ transform: numberAttribute });

  readonly casos = signal<CasoClinico[]>([]);
  readonly cargando = signal(false);
  readonly error = signal<ErrorCaso | null>(null);
  readonly soloActivos = signal(false);

  constructor() {
    effect(() => {
      const id = this.historiaClinicaId();
      const soloActivos = this.soloActivos();
      untracked(() => this.cargar(id, soloActivos));
    });
  }

  equipoVigente(caso: CasoClinico): string {
    const vigentes = (caso.equipo ?? []).filter((p) => p.vigente);
    if (vigentes.length === 0) return 'sin equipo';
    return vigentes.map((p) => `#${p.profesionalMembershipId} (${p.rol})`).join(', ');
  }

  private cargar(historiaClinicaId: number, soloActivos: boolean): void {
    this.cargando.set(true);
    this.error.set(null);
    this.api.listar(historiaClinicaId, soloActivos).subscribe({
      next: (casos) => {
        this.casos.set(casos);
        this.cargando.set(false);
      },
      error: (e) => {
        this.casos.set([]);
        this.error.set(traducirErrorCaso(e));
        this.cargando.set(false);
      },
    });
  }
}
