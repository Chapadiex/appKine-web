import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { BibliotecaBusquedaResponse } from '../../../../api/generated/model/biblioteca-busqueda-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { ErrorBiblioteca, traducirErrorBiblioteca } from '../../models/biblioteca-errors';
import { BibliotecaApi } from '../../services/biblioteca-api';

/**
 * Contenido del panel "Probar busqueda" (M30): corre la consulta contra la biblioteca y muestra
 * los pasajes con su puntaje. Los que no superan el corte se rotulan y se atenuan con un token de
 * texto secundario (no con opacidad). Si el usuario busca dos veces seguidas, solo cuenta la
 * ultima respuesta.
 */
@Component({
  selector: 'app-probar-busqueda',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, Alerta, Ayuda],
  templateUrl: './probar-busqueda.html',
  styleUrl: './probar-busqueda.css',
})
export class ProbarBusqueda {
  private readonly api = inject(BibliotecaApi);
  private readonly tenantContext = inject(TenantContextStore);
  private busqueda: Subscription | null = null;

  protected readonly maximo = 600;
  protected readonly consulta = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(this.maximo)],
  });
  protected readonly largo = signal(0);
  protected readonly buscando = signal(false);
  protected readonly resultado = signal<BibliotecaBusquedaResponse | null>(null);
  protected readonly error = signal<ErrorBiblioteca | null>(null);
  protected readonly pasajes = computed(() => this.resultado()?.pasajes ?? []);
  /** Unica region viva: un resumen corto, no la lista entera. */
  protected readonly resumenVivo = computed(() => {
    if (this.buscando()) {
      return 'Buscando…';
    }
    const r = this.resultado();
    if (r === null) {
      return '';
    }
    const n = this.pasajes().length;
    const pasajes = `${n} ${n === 1 ? 'pasaje' : 'pasajes'}`;
    return `${pasajes}; la biblioteca ${r.alcanza ? 'alcanza' : 'no alcanza'} para esta pregunta`;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.busqueda?.unsubscribe());
  }

  protected alEscribir(): void {
    this.largo.set(this.consulta.value.length);
  }

  protected rotuloDePaginas(desde?: number, hasta?: number): string {
    if (desde === undefined) {
      return '';
    }
    return hasta === undefined || hasta === desde ? `pág. ${desde}` : `págs. ${desde}–${hasta}`;
  }

  protected buscar(): void {
    const texto = this.consulta.value.trim();
    const orgId = this.tenantContext.organizationId();
    if (texto === '' || texto.length > this.maximo || orgId === null) {
      return;
    }
    // Una busqueda nueva descarta la anterior: una respuesta vieja no pisa a la ultima.
    this.busqueda?.unsubscribe();
    this.buscando.set(true);
    this.error.set(null);
    this.busqueda = this.api.buscar(orgId, texto).subscribe({
      next: (respuesta) => {
        this.resultado.set(respuesta);
        this.buscando.set(false);
      },
      error: (causa: unknown) => {
        this.resultado.set(null);
        this.error.set(traducirErrorBiblioteca(causa));
        this.buscando.set(false);
      },
    });
  }
}
