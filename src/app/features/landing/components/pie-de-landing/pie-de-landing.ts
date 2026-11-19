import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { RUTA_LOGIN } from '../../../../core/models/rutas';
import { RUTA_PRIVACIDAD, RUTA_TERMINOS } from '../../models/rutas-legales';

/** Pie de la landing y de sus páginas legales: contacto, ingreso, estado y textos legales. */
@Component({
  selector: 'app-pie-de-landing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './pie-de-landing.html',
  styleUrls: ['../../landing-comun.css', './pie-de-landing.css'],
})
export class PieDeLanding {
  protected readonly rutaLogin = RUTA_LOGIN;
  protected readonly rutaTerminos = RUTA_TERMINOS;
  protected readonly rutaPrivacidad = RUTA_PRIVACIDAD;
}
