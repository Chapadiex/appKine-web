import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { MarcaDeLaOrganizacionService } from '../../../../api/generated/api/marca-de-la-organizacion.service';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { PERMISO_TENANT_UPDATE } from '../../../../core/models/permisos';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { MarcaStore } from '../../../../core/services/marca.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';

type CampoDeContacto = 'telefono' | 'email' | 'sitioWeb' | 'direccion' | 'leyenda';

/**
 * Datos de contacto del centro: lo que se muestra en el pie de cada pantalla.
 *
 * <p>Viven en la marca del centro (el mismo recurso que los colores) y se leen de `MarcaStore`,
 * que ya la tiene cargada para pintar la aplicacion. Guardar reemplaza la marca entera, asi que
 * los colores viajan tal como estan: aca solo cambia el contacto.
 */
@Component({
  selector: 'app-contacto-del-centro',
  imports: [ReactiveFormsModule, PanelLateral, Alerta, PermisoDirective],
  templateUrl: './contacto-del-centro.html',
  styleUrls: ['../../organization.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactoDelCentro {
  private readonly api = inject(MarcaDeLaOrganizacionService);
  private readonly tenant = inject(TenantContextStore);
  private readonly store = inject(MarcaStore);
  private readonly avisos = inject(AvisosStore);

  protected readonly permisoEditar = PERMISO_TENANT_UPDATE;
  protected readonly marca = this.store.marca;

  protected readonly filas: readonly { campo: CampoDeContacto; rotulo: string }[] = [
    { campo: 'telefono', rotulo: 'Teléfono' },
    { campo: 'email', rotulo: 'Email' },
    { campo: 'sitioWeb', rotulo: 'Sitio web' },
    { campo: 'direccion', rotulo: 'Dirección' },
    { campo: 'leyenda', rotulo: 'Leyenda del pie' },
  ];

  protected readonly editando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly erroresDeCampo = signal<Readonly<Record<string, string>>>({});

  protected readonly formulario = inject(FormBuilder).nonNullable.group({
    telefono: [''],
    email: ['', [Validators.email]],
    sitioWeb: ['', [Validators.pattern(/^https?:\/\/\S+$/)]],
    direccion: [''],
    leyenda: [''],
  });

  constructor() {
    effect(() => {
      // Cambiar de centro cierra el panel: lo que se editaba era del anterior.
      this.tenant.contextEpoch();
      untracked(() => this.cerrar());
    });
  }

  protected abrir(): void {
    const marca = this.marca();
    if (marca === null) {
      return;
    }
    this.formulario.reset({
      telefono: marca.telefono ?? '',
      email: marca.email ?? '',
      sitioWeb: marca.sitioWeb ?? '',
      direccion: marca.direccion ?? '',
      leyenda: marca.leyenda ?? '',
    });
    this.error.set(null);
    this.erroresDeCampo.set({});
    this.editando.set(true);
  }

  protected cerrar(): void {
    this.editando.set(false);
    this.guardando.set(false);
  }

  protected conError(campo: 'email' | 'sitioWeb'): boolean {
    const control = this.formulario.controls[campo];
    return (control.invalid && control.touched) || campo in this.erroresDeCampo();
  }

  protected guardar(): void {
    const marca = this.marca();
    const orgId = this.tenant.organizationId();
    if (marca === null || orgId === null) {
      return;
    }
    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }
    const contacto = this.formulario.getRawValue();
    const epoca = this.tenant.contextEpoch();
    this.guardando.set(true);
    this.error.set(null);
    this.erroresDeCampo.set({});
    this.api
      .updateMarcaDeOrganizacion({
        orgId,
        updateMarcaRequest: {
          version: marca.version,
          // Los colores no se tocan desde aca: viajan como estan guardados.
          colorPrincipalClaro: marca.colorPrincipalClaro,
          colorAcentoClaro: marca.colorAcentoClaro,
          colorPrincipalOscuro: marca.colorPrincipalOscuro,
          colorAcentoOscuro: marca.colorAcentoOscuro,
          interfazClaro: marca.interfazClaro,
          interfazOscuro: marca.interfazOscuro,
          telefono: contacto.telefono.trim(),
          email: contacto.email.trim(),
          sitioWeb: contacto.sitioWeb.trim(),
          direccion: contacto.direccion.trim(),
          leyenda: contacto.leyenda.trim(),
        },
      })
      .subscribe({
        next: (guardada) => {
          // La respuesta de un centro que ya no es el activo no se adopta.
          if (this.tenant.contextEpoch() !== epoca) {
            return;
          }
          this.store.adoptar(guardada);
          this.cerrar();
          this.avisos.exito('Datos de contacto guardados', {
            descripcion: 'Ya se ven en el pie de cada pantalla.',
          });
        },
        error: (fallo: unknown) => {
          if (this.tenant.contextEpoch() !== epoca) {
            return;
          }
          this.guardando.set(false);
          if (fallo instanceof AkineHttpError) {
            this.erroresDeCampo.set(fallo.erroresPorCampo);
            this.error.set(
              fallo.status === 409
                ? 'Alguien cambió la marca del centro mientras editabas. Cerrá el panel, recargá y volvé a intentar.'
                : (fallo.mensajeSinCampos(() => true) ?? fallo.message),
            );
            return;
          }
          this.error.set('No pudimos guardar los datos de contacto. Volvé a intentar.');
        },
      });
  }
}
