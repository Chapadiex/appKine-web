import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';

import { OpcionChip } from '../../../../shared/components/chips/chips';
import { Icono } from '../../../../shared/components/icono/icono';
import { Segmentado } from '../../../../shared/components/segmentado/segmentado';
import {
  CantidadDeSedes,
  ConIa,
  PLANES,
  ServiciosElegidos,
  recomendarPlan,
} from '../../models/armador-de-plan';

/**
 * Armador de la sección de planes: tres preguntas y el plan que corresponde con lo que incluye.
 * Sin precios (§9.1 del plan de la landing) y sin enviar nada: sólo orienta antes de pedir la
 * prueba.
 */
@Component({
  selector: 'app-armador-de-plan',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Segmentado, Icono],
  templateUrl: './armador-de-plan.html',
  styleUrl: './armador-de-plan.css',
})
export class ArmadorDePlan {
  protected readonly opcionesDeSedes: readonly OpcionChip[] = [
    { valor: 'una', etiqueta: '1 sede' },
    { valor: 'hasta-tres', etiqueta: '2 o 3' },
    { valor: 'mas-de-tres', etiqueta: 'Más de 3' },
  ];
  protected readonly opcionesDeServicios: readonly OpcionChip[] = [
    { valor: 'kinesiologia', etiqueta: 'Kinesiología' },
    { valor: 'actividades', etiqueta: 'Actividades' },
    { valor: 'ambos', etiqueta: 'Los dos' },
  ];
  protected readonly opcionesDeIa: readonly OpcionChip[] = [
    { valor: 'si', etiqueta: 'Sí, sumala' },
    { valor: 'no', etiqueta: 'Por ahora no' },
  ];

  protected readonly sedes = signal<string | null>('una');
  protected readonly servicios = signal<string | null>('kinesiologia');
  protected readonly ia = signal<string | null>('no');

  protected readonly planes = PLANES;

  protected readonly recomendacion = computed(() =>
    recomendarPlan({
      sedes: (this.sedes() ?? 'una') as CantidadDeSedes,
      servicios: (this.servicios() ?? 'kinesiologia') as ServiciosElegidos,
      ia: (this.ia() ?? 'no') as ConIa,
    }),
  );
}
