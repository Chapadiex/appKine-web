import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { PoliticaDeEnmienda } from '../../../../api/generated/model/politica-de-enmienda';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { instanteEnPalabras } from '../../models/etiquetas-de-atencion';
import { ErrorAtencion, traducirErrorAtencion } from '../../models/atencion-errors';
import { ClinicalApi } from '../../services/clinical-api';

/** Rango del contrato: de 1 a 3650 dias. */
export const VENTANA_MINIMA = 1;
export const VENTANA_MAXIMA = 3650;

/**
 * Ventana para enmendar sesiones de la organizacion (DP-43, U-25).
 *
 * <p>Es de la organizacion del contexto y la administra el `ORG_ADMIN` (`consultorio:manage` con
 * alcance organizacion). Sin politica propia rigen 30 dias y la lectura trae `porDefecto` con
 * `version` nula, que es la que se manda la primera vez.
 *
 * <p><b>Rige tambien para las ya cerradas</b>: la ventana no se congela en cada sesion. Achicarla
 * puede dejar fuera de ventana una sesion que hoy se podia enmendar, y la pantalla lo dice antes de
 * guardar.
 */
@Component({
  selector: 'app-politica-de-enmienda-page',
  imports: [RouterLink],
  templateUrl: './politica-de-enmienda-page.html',
  styleUrl: '../../atencion.css',
})
export class PoliticaDeEnmiendaPage {
  private readonly api = inject(ClinicalApi);
  private readonly tenantContext = inject(TenantContextStore);

  protected readonly minima = VENTANA_MINIMA;
  protected readonly maxima = VENTANA_MAXIMA;
  protected readonly instanteEnPalabras = instanteEnPalabras;

  protected readonly politica = signal<PoliticaDeEnmienda | null>(null);
  protected readonly cargando = signal(false);
  protected readonly enviando = signal(false);
  protected readonly dias = signal('');
  protected readonly error = signal<ErrorAtencion | null>(null);
  protected readonly exito = signal('');

  protected readonly diasValidos = computed(() => {
    const n = Number(this.dias());
    return Number.isInteger(n) && n >= VENTANA_MINIMA && n <= VENTANA_MAXIMA;
  });
  /** Achicar la ventana alcanza a las sesiones ya cerradas: se avisa antes de guardar. */
  protected readonly achica = computed(
    () => this.diasValidos() && Number(this.dias()) < (this.politica()?.ventanaDias ?? 0),
  );
  protected readonly sinCambios = computed(
    () => Number(this.dias()) === this.politica()?.ventanaDias,
  );

  constructor() {
    effect(() => {
      // La politica es de la organizacion del contexto: otra organizacion, otra politica.
      this.tenantContext.contextEpoch();
      untracked(() => this.cargar());
    });
  }

  protected cargar(): void {
    this.cargando.set(true);
    this.error.set(null);
    this.api.verPoliticaDeEnmienda().subscribe({
      next: (politica) => {
        this.cargando.set(false);
        this.adoptar(politica);
      },
      error: (error: unknown) => {
        this.cargando.set(false);
        this.politica.set(null);
        this.error.set(traducirErrorDePolitica(error));
      },
    });
  }

  protected guardar(): void {
    const actual = this.politica();
    if (actual === null || !this.diasValidos() || this.sinCambios() || this.enviando()) {
      return;
    }
    this.enviando.set(true);
    this.error.set(null);
    this.exito.set('');
    this.api.fijarPoliticaDeEnmienda(Number(this.dias()), actual.version ?? undefined).subscribe({
      next: (politica) => {
        this.enviando.set(false);
        this.adoptar(politica);
        this.exito.set(
          `Listo: las sesiones se pueden enmendar durante ${politica.ventanaDias ?? this.dias()} ` +
            'dias desde su cierre, tambien las que ya estaban cerradas.',
        );
      },
      error: (error: unknown) => {
        this.enviando.set(false);
        const traducido = traducirErrorDePolitica(error);
        this.error.set(traducido);
        if (traducido.causa === 'version-vieja') {
          this.cargar();
        }
      },
    });
  }

  private adoptar(politica: PoliticaDeEnmienda): void {
    this.politica.set(politica);
    this.dias.set(String(politica.ventanaDias ?? 30));
  }
}

/** El 403 de esta pantalla no es de atenciones: es de administrar la organizacion. */
function traducirErrorDePolitica(error: unknown): ErrorAtencion {
  const traducido = traducirErrorAtencion(error);
  return traducido.causa === 'sin-permiso'
    ? {
        ...traducido,
        mensaje:
          'La ventana de enmienda la fija quien administra la organizacion. Tu cuenta no tiene ' +
          'ese alcance en este contexto.',
      }
    : traducido;
}
