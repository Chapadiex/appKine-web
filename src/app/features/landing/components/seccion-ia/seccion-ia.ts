import { ChangeDetectionStrategy, Component } from '@angular/core';

import { Icono } from '../../../../shared/components/icono/icono';

interface BarraDeAusentes {
  readonly dia: string;
  readonly valor: number;
  readonly destacada?: boolean;
}

/**
 * La IA en la landing (§2.3 del plan): una característica principal, con una pantalla en
 * miniatura por función. Todo es ilustración con datos inventados (`aria-hidden`); el texto de
 * cada tarjeta es lo que se lee.
 */
@Component({
  selector: 'app-seccion-ia',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icono],
  templateUrl: './seccion-ia.html',
  styleUrls: ['../../landing-comun.css', './seccion-ia.css'],
})
export class SeccionIa {
  protected readonly ausentes: readonly BarraDeAusentes[] = [
    { dia: 'L', valor: 1 },
    { dia: 'M', valor: 3, destacada: true },
    { dia: 'X', valor: 0.5 },
    { dia: 'J', valor: 1 },
    { dia: 'V', valor: 0.5 },
  ];

  /** Dolor en seis sesiones, ya en coordenadas del dibujo. */
  protected readonly evolucion = [
    { x: 10, y: 22 },
    { x: 54, y: 34 },
    { x: 98, y: 50 },
    { x: 142, y: 66 },
    { x: 186, y: 70 },
    { x: 230, y: 84 },
  ];

  protected readonly onda: readonly number[] = [
    0.3, 0.6, 0.9, 0.5, 0.8, 1, 0.4, 0.7, 0.95, 0.5, 0.3, 0.75, 0.6, 0.9, 0.4, 0.65, 0.85, 0.35,
  ];

  protected readonly libros: readonly string[] = [
    'Protocolo de LCA',
    'Esguince de tobillo',
    'Lumbalgia aguda',
  ];
}
