import { Location } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

/**
 * Pagina no encontrada (404 de ruta, dentro de la app).
 *
 * <p>Muestra la direccion pedida, para que quien llego por un enlace roto sepa cual era, y dos
 * salidas: el inicio y volver atras.
 */
@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  templateUrl: './not-found.html',
  styleUrl: './not-found.css',
})
export class NotFound {
  private readonly location = inject(Location);

  protected readonly ruta = inject(Router).url;

  protected volver(): void {
    this.location.back();
  }
}
