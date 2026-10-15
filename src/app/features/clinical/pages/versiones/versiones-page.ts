import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

import { ClinicalApi } from '../../services/clinical-api';
import { ErrorAtencion, traducirErrorAtencion } from '../../models/atencion-errors';
import { compararVersiones, contenidoDe } from '../../models/contenido-de-version';
import { ASISTENCIAS, etiquetaDe, instanteEnPalabras } from '../../models/etiquetas-de-atencion';
import { Sesion } from '../../../../api/generated/model/sesion';
import { SesionVersion } from '../../../../api/generated/model/sesion-version';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';

/**
 * Historial de versiones de una sesion cerrada (AKINE-06.06, RF-M24-005, RN-M14-006).
 *
 * <p>La version 1 es lo que se asento al cerrar; cada enmienda agrego la siguiente con su motivo,
 * su autor y su instante. El backend manda cada version <b>entera</b> y la comparacion se arma
 * aca: por defecto la ultima contra la anterior, que es la pregunta que trae a alguien a esta
 * pantalla —que se corrigio—, y con dos selectores para comparar cualquier par.
 *
 * <p>Lo que cambio se dice con una palabra en la columna, no solo con un estilo: un color o una
 * negrita no le dicen nada a un lector de pantalla.
 *
 * <p>La lectura es clinica y el backend la audita. Nada de lo que se lee aca va a la consola ni a
 * la URL: la ruta lleva solo el id de la sesion.
 */
@Component({
  selector: 'app-versiones-page',
  imports: [RouterLink],
  templateUrl: './versiones-page.html',
  styleUrl: '../../atencion.css',
})
export class VersionesPage {
  private readonly api = inject(ClinicalApi);
  private readonly tenantContext = inject(TenantContextStore);

  readonly sesionId = input.required<string>();

  protected readonly instanteEnPalabras = instanteEnPalabras;
  protected readonly contenidoDe = contenidoDe;

  protected readonly sesion = signal<Sesion | null>(null);
  protected readonly versiones = signal<readonly SesionVersion[]>([]);
  protected readonly cargando = signal(false);
  protected readonly error = signal<ErrorAtencion | null>(null);

  /** Numeros de version que se comparan. `null` hasta que se leen las versiones. */
  protected readonly numeroAntes = signal<number | null>(null);
  protected readonly numeroDespues = signal<number | null>(null);

  /** De la mas nueva a la mas vieja: lo ultimo que se corrigio es lo primero que se busca. */
  protected readonly versionesRecientesPrimero = computed(() =>
    [...this.versiones()].sort((a, b) => (b.numeroVersion ?? 0) - (a.numeroVersion ?? 0)),
  );

  protected readonly antes = computed(() => this.versionNumero(this.numeroAntes()));
  protected readonly despues = computed(() => this.versionNumero(this.numeroDespues()));

  protected readonly comparacion = computed(() => {
    const antes = this.antes();
    const despues = this.despues();
    return antes === null || despues === null ? [] : compararVersiones(antes, despues);
  });

  protected readonly cantidadDeCambios = computed(
    () => this.comparacion().filter((fila) => fila.cambio).length,
  );

  protected readonly asistencia = computed(() =>
    etiquetaDe(ASISTENCIAS, this.sesion()?.cierre?.asistencia),
  );

  constructor() {
    effect(() => {
      this.sesionId();
      this.tenantContext.contextEpoch();
      untracked(() => this.cargar());
    });
  }

  protected cargar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const sesionId = numeroDe(this.sesionId());
    if (consultorioId === null || sesionId === null) {
      return;
    }
    this.cargando.set(true);
    this.error.set(null);
    forkJoin({
      sesion: this.api.ver(consultorioId, sesionId),
      versiones: this.api.versiones(consultorioId, sesionId),
    }).subscribe({
      next: ({ sesion, versiones }) => {
        this.cargando.set(false);
        this.sesion.set(sesion);
        this.versiones.set(versiones);
        const numeros = versiones.map((v) => v.numeroVersion ?? 0).sort((a, b) => a - b);
        const ultima = numeros.at(-1) ?? null;
        this.numeroDespues.set(ultima);
        this.numeroAntes.set(numeros.length > 1 ? numeros[numeros.length - 2] : ultima);
      },
      error: (error: unknown) => {
        this.cargando.set(false);
        this.sesion.set(null);
        this.versiones.set([]);
        this.error.set(traducirErrorAtencion(error));
      },
    });
  }

  protected elegirAntes(valor: string): void {
    this.numeroAntes.set(numeroDe(valor));
  }

  protected elegirDespues(valor: string): void {
    this.numeroDespues.set(numeroDe(valor));
  }

  private versionNumero(numero: number | null): SesionVersion | null {
    return numero === null
      ? null
      : (this.versiones().find((version) => version.numeroVersion === numero) ?? null);
  }
}

function numeroDe(valor: string): number | null {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}
