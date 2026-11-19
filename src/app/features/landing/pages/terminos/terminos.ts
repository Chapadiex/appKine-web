import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { PaginaLegal } from '../../components/pagina-legal/pagina-legal';
import { RUTA_PRIVACIDAD } from '../../models/rutas-legales';

/** Términos y condiciones. BORRADOR para revisión legal: no es un texto vigente. */
@Component({
  selector: 'app-terminos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PaginaLegal, RouterLink],
  templateUrl: './terminos.html',
  styleUrl: '../legal.css',
})
export class Terminos {
  protected readonly rutaPrivacidad = RUTA_PRIVACIDAD;
}
