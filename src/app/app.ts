import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Layout raiz de AKINE (AKINE-00.02).
 *
 * <p>Solo estructura: skip link, cabecera y el landmark `main` donde el router monta cada
 * pagina. <b>No contiene logica de pantalla</b> —eso vive en las paginas de cada feature—,
 * asi que no necesita cambiar cuando se agregue una.
 *
 * <p>Aca viven las garantias de accesibilidad que toda pantalla hereda: el skip link como
 * primer elemento enfocable y los landmarks semanticos (ADR-0005).
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}
