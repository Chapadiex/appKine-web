import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

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
import { EleccionDelArmador } from '../../models/eleccion-del-armador';

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

  /** La elección vive en la página: el formulario del pedido de prueba la usa para precargarse. */
  protected readonly eleccion = inject(EleccionDelArmador);

  protected readonly planes = PLANES;

  protected readonly recomendacion = computed(() =>
    recomendarPlan({
      sedes: this.eleccion.sedes(),
      servicios: this.eleccion.servicios(),
      ia: this.eleccion.ia(),
    }),
  );

  protected elegirSedes(valor: string | null): void {
    if (valor !== null) {
      this.eleccion.sedes.set(valor as CantidadDeSedes);
    }
  }

  protected elegirServicios(valor: string | null): void {
    if (valor !== null) {
      this.eleccion.servicios.set(valor as ServiciosElegidos);
    }
  }

  protected elegirIa(valor: string | null): void {
    if (valor !== null) {
      this.eleccion.ia.set(valor as ConIa);
    }
  }
}
