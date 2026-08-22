import { Component, computed, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { catchError, of } from 'rxjs';

import { PlatformService } from './api/generated/api/platform.service';
import { VersionResponse } from './api/generated/model/version-response';
import { environment } from '../environments/environment';

/** Estado de la comprobacion de conectividad con el backend. */
type EstadoBackend =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'conectado'; readonly version: VersionResponse }
  | { readonly tipo: 'sin-conexion' };

/**
 * Shell de la aplicacion (AKINE-00.01).
 *
 * <p>Deliberadamente NO contiene pantallas funcionales: las features de M01-M29 se crean en
 * sus etapas correspondientes. Lo unico que hace es probar de punta a punta que el arranque
 * funciona: Angular monta, el cliente generado se inyecta, el proxy resuelve `/api` y el
 * backend responde.
 *
 * <p>Cubre los tres estados que toda pantalla de AKINE debe manejar —cargando, exito y
 * error— para que la convencion quede fijada desde la primera.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly platformService = inject(PlatformService);

  protected readonly estado = signal<EstadoBackend>({ tipo: 'cargando' });
  protected readonly versionContrato = environment.contractVersion;

  /**
   * Version del backend, o `null` si todavia no se conocio.
   *
   * Existe para que la plantilla no tenga que estrechar el tipo de la union con `$any`:
   * el estrechamiento se hace aca, en TypeScript, donde el compilador lo verifica.
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
