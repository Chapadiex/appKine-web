import { ChangeDetectionStrategy, Component } from '@angular/core';

import { Icono } from '../../../../shared/components/icono/icono';

/** Dibujo de una organización con tres sedes (datos inventados): ilustración, no datos. */
@Component({
  selector: 'app-mapa-de-sedes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icono],
  templateUrl: './mapa-de-sedes.html',
  styleUrl: './mapa-de-sedes.css',
})
export class MapaDeSedes {}
