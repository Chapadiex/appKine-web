import { ChangeDetectionStrategy, Component } from '@angular/core';

import { Icono } from '../../../../shared/components/icono/icono';

interface SedeDeMuestra {
  readonly nombre: string;
  readonly horario: string;
  readonly espacios: string;
  readonly turnos: number;
  /** Parte de los ingresos del mes, en porcentaje. */
  readonly parte: number;
  /** Token de color de la sede en el dibujo. */
  readonly color: string;
}

/** Dibujo de una organización con tres sedes (datos inventados): ilustración, no datos. */
@Component({
  selector: 'app-mapa-de-sedes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icono],
  templateUrl: './mapa-de-sedes.html',
  styleUrl: './mapa-de-sedes.css',
})
export class MapaDeSedes {
  protected readonly sedes: readonly SedeDeMuestra[] = [
    {
      nombre: 'Sede Centro',
      horario: 'Lun a sáb · 7 a 21',
      espacios: '4 boxes · 1 sala',
      turnos: 32,
      parte: 46,
      color: 'var(--color-landing-menta)',
    },
    {
      nombre: 'Sede Norte',
      horario: 'Lun a vie · 8 a 20',
      espacios: '3 boxes',
      turnos: 21,
      parte: 32,
      color: 'var(--color-landing-accion)',
    },
    {
      nombre: 'Sede Cerro',
      horario: 'Lun a vie · 14 a 21',
      espacios: '2 salas',
      turnos: 14,
      parte: 22,
      color: 'var(--color-ia-vivo-desde)',
    },
  ];
}
