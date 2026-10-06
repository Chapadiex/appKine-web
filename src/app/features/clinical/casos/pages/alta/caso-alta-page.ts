import { Component, inject, input, numberAttribute, signal } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AbrirCasoClinicoRequest } from '../../../../../api/generated/model/abrir-caso-clinico-request';
import { IntegranteDelEquipoRolEnum } from '../../../../../api/generated/model/integrante-del-equipo';
import { CasosApi } from '../../casos-api';
import { ErrorCaso, traducirErrorCaso } from '../../casos-errors';

@Component({
  selector: 'app-caso-alta-page',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <h1>Abrir caso clinico</h1>
    <p>
      <a class="enlace" [routerLink]="['/atencion', 'casos', 'hc', historiaClinicaId()]">
        Volver al listado
      </a>
    </p>

    <form [formGroup]="form" (ngSubmit)="guardar(false)" data-testid="caso-form">
      <label class="campo">
        Oferta (id)
        <input type="number" formControlName="ofertaId" />
      </label>
      <label class="campo">
        Diagnostico presuntivo
        <textarea formControlName="diagnosticoPresuntivo"></textarea>
      </label>
      <label class="campo">
        Objetivo terapeutico (opcional)
        <textarea formControlName="objetivoTerapeutico"></textarea>
      </label>

      <fieldset>
        <legend>Equipo inicial (opcional)</legend>
        <div formArrayName="equipo">
          @for (miembro of equipo.controls; track $index) {
            <div [formGroupName]="$index" class="acciones">
              <input
                type="number"
                formControlName="profesionalMembershipId"
                placeholder="Id profesional"
              />
              <select formControlName="rol">
                <option value="RESPONSABLE">Responsable</option>
                <option value="TRATANTE">Tratante</option>
              </select>
              <button type="button" class="boton" (click)="quitarMiembro($index)">Quitar</button>
            </div>
          }
        </div>
        <button type="button" class="boton" (click)="agregarMiembro()">Agregar profesional</button>
      </fieldset>

      @if (error(); as problema) {
        @if (problema.causa === 'posible-duplicado') {
          <section class="tarjeta" role="alert" data-testid="caso-duplicado-aviso">
            <p class="estado estado--error">{{ problema.mensaje }}</p>
            <button
              type="button"
              class="boton"
              data-testid="caso-confirmar-duplicado"
              [disabled]="guardando()"
              (click)="guardar(true)"
            >
              Abrir igual
            </button>
          </section>
        } @else {
          <p class="estado estado--error" role="alert">{{ problema.mensaje }}</p>
        }
      }

      <div class="acciones">
        <button type="submit" class="boton" data-testid="caso-guardar" [disabled]="guardando()">
          Guardar
        </button>
      </div>
    </form>
  `,
})
export class CasoAltaPage {
  private readonly api = inject(CasosApi);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly historiaClinicaId = input.required({ transform: numberAttribute });

  readonly guardando = signal(false);
  readonly error = signal<ErrorCaso | null>(null);

  readonly equipo: FormArray<FormGroup> = this.fb.array<FormGroup>([]);

  readonly form = this.fb.group({
    ofertaId: this.fb.control<number | null>(null, [Validators.required]),
    diagnosticoPresuntivo: this.fb.control('', [Validators.required]),
    objetivoTerapeutico: this.fb.control(''),
    equipo: this.equipo,
  });

  agregarMiembro(): void {
    this.equipo.push(
      this.fb.group({
        profesionalMembershipId: this.fb.control<number | null>(null, [Validators.required]),
        rol: this.fb.control<IntegranteDelEquipoRolEnum>(IntegranteDelEquipoRolEnum.RESPONSABLE),
      }),
    );
  }

  quitarMiembro(indice: number): void {
    this.equipo.removeAt(indice);
  }

  guardar(confirmaPosibleDuplicado: boolean): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const valor = this.form.getRawValue();
    const objetivo = (valor.objetivoTerapeutico ?? '').trim();
    const body: AbrirCasoClinicoRequest = {
      ofertaId: Number(valor.ofertaId),
      diagnosticoPresuntivo: (valor.diagnosticoPresuntivo ?? '').trim(),
      ...(objetivo && { objetivoTerapeutico: objetivo }),
      ...(valor.equipo.length > 0 && {
        equipo: valor.equipo.map((m) => ({
          profesionalMembershipId: Number(m['profesionalMembershipId']),
          rol: m['rol'] as IntegranteDelEquipoRolEnum,
        })),
      }),
      ...(confirmaPosibleDuplicado && { confirmaPosibleDuplicado: true }),
    };

    this.guardando.set(true);
    this.error.set(null);
    this.api.abrir(this.historiaClinicaId(), body).subscribe({
      next: (caso) => {
        this.guardando.set(false);
        this.router.navigate(['/atencion', 'casos', 'detalle', caso.id]);
      },
      error: (e) => {
        this.guardando.set(false);
        this.error.set(traducirErrorCaso(e));
      },
    });
  }
}
