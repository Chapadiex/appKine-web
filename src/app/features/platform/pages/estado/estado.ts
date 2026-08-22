import { Component, computed, inject, signal } from '@angular/core';
import { catchError, of } from 'rxjs';

import { PlatformService } from '../../../../api/generated/api/platform.service';
import { VersionResponse } from '../../../../api/generated/model/version-response';
import { environment } from '../../../../../environments/environment';

/**
 * Estado de la comprobacion de conectividad con el backend.
 *
 * Union discriminada, no booleanos sueltos: con `cargando` y `error` independientes existe
 * el estado imposible `cargando && error`, que el compilador no puede descartar y que en la
 * practica termina renderizado (ADR-0005).
 */
type EstadoBackend =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'conectado'; readonly version: VersionResponse }
  | { readonly tipo: 'sin-conexion' };

/**
 * Pagina de estado del baseline tecnico (AKINE-00.01).
 *
 * <p>Es la unica pagina del proyecto hasta que M01 cree las primeras funcionales, y sirve
 * de <b>referencia a copiar</b>: modela su estado como union discriminada y cubre los tres
 * casos obligatorios -cargando, exito y error con reintento- segun ADR-0005.
 *
 * <p>Tambien prueba de punta a punta que el cliente generado, el proxy y el backend se
 * comunican.
 */
@Component({
  selector: 'app-estado',
  templateUrl: './estado.html',
  styleUrl: './estado.css',
})
export class Estado {
  private readonly platformService = inject(PlatformService);

  protected readonly estado = signal<EstadoBackend>({ tipo: 'cargando' });
  protected readonly versionContrato = environment.contractVersion;

  /**
   * Version del backend, o `null` si todavia no se conocio.
   *
   * El estrechamiento del tipo se hace aca, en TypeScript, donde el compilador lo verifica,
   * y no en la plantilla con `$any` (ADR-0005).
   */
  protected readonly version = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'conectado' ? estado.version : null;
  });

  constructor() {
    this.comprobarBackend();
  }

  protected comprobarBackend(): void {
    this.estado.set({ tipo: 'cargando' });

    this.platformService
      .version()
      .pipe(catchError(() => of(null)))
      .subscribe((version) => {
        this.estado.set(version ? { tipo: 'conectado', version } : { tipo: 'sin-conexion' });
      });
  }
}
