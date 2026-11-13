import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { MarcaStore } from '../../core/services/marca.store';
import { TenantContextStore } from '../../core/services/tenant-context.store';

/**
 * Pie institucional: el logo y los datos de contacto que el centro cargo en su marca.
 *
 * <p>Solo se dibuja con contexto elegido y si el centro cargo al menos un dato: un pie vacio es
 * ruido. Lo que no esta cargado no deja hueco ni separador. Es solo texto, sin enlaces: informa,
 * no es un lugar desde donde llamar ni escribir.
 */
@Component({
  selector: 'app-pie-institucional',
  templateUrl: './pie-institucional.html',
  styleUrl: './pie-institucional.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PieInstitucional {
  private readonly store = inject(MarcaStore);
  private readonly tenant = inject(TenantContextStore);

  protected readonly marca = this.store.marca;
  protected readonly logo = this.store.logoUrl;
  protected readonly nombre = computed(() => this.tenant.context()?.organizationName ?? '');

  protected readonly visible = computed(() => {
    const m = this.marca();
    return (
      this.tenant.hasContext() &&
      m !== null &&
      Boolean(m.telefono || m.email || m.sitioWeb || m.direccion || m.leyenda)
    );
  });

  /** El sitio sin el protocolo, que es como se lee. */
  protected readonly sitioLegible = computed(() =>
    (this.marca()?.sitioWeb ?? '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
  );
}
