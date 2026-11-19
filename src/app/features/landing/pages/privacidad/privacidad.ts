import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { PaginaLegal } from '../../components/pagina-legal/pagina-legal';
import { RUTA_TERMINOS } from '../../models/rutas-legales';

/** Política de privacidad. BORRADOR para revisión legal: no es un texto vigente. */
@Component({
  selector: 'app-privacidad',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PaginaLegal, RouterLink],
  templateUrl: './privacidad.html',
  styleUrl: '../legal.css',
})
export class Privacidad {
  protected readonly rutaTerminos = RUTA_TERMINOS;
}
