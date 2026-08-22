import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Pagina 404.
 *
 * <p>Vive en `shared` y no en un feature porque no sabe nada de dominio: es la respuesta a
 * una ruta inexistente, sea cual sea (ADR-0004).
 *
 * <p>Ofrece una salida ademas del mensaje: un cartel de error sin accion deja al usuario
 * sin nada que hacer (ADR-0005).
 */
@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  templateUrl: './not-found.html',
  styleUrl: './not-found.css',
})
export class NotFound {}
