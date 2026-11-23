import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  computed,
  inject,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { Icono } from '../../../../shared/components/icono/icono';
import { PedidoDePrueba } from '../../components/pedido-de-prueba/pedido-de-prueba';
import { PieDeLanding } from '../../components/pie-de-landing/pie-de-landing';
import {
  CantidadDeSedes,
  ConIa,
  ServiciosElegidos,
  recomendarPlan,
} from '../../models/armador-de-plan';
import { EleccionDelArmador } from '../../models/eleccion-del-armador';

const SEDES: readonly CantidadDeSedes[] = ['una', 'hasta-tres', 'mas-de-tres'];
const SERVICIOS: readonly ServiciosElegidos[] = ['kinesiologia', 'actividades', 'ambos'];
const IA: readonly ConIa[] = ['si', 'no'];

const NOMBRE_DE_SERVICIOS: Record<ServiciosElegidos, string> = {
  kinesiologia: 'Kinesiología',
  actividades: 'Actividades',
  ambos: 'Kinesiología y actividades',
};

/**
 * Pedir la prueba gratis, en `/prueba` (22/11/2026). El plan se arma en la landing y llega en la
 * dirección (`?sedes=…&servicios=…&ia=…`): acá se muestra resumido y el formulario no lo vuelve a
 * preguntar. Sin plan en la dirección (se entró por el botón de la portada), el formulario lo
 * pregunta como siempre.
 */
@Component({
  selector: 'app-prueba',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icono, PedidoDePrueba, PieDeLanding],
  templateUrl: './prueba.html',
  styleUrls: ['../../landing-comun.css', './prueba.css'],
  providers: [EleccionDelArmador],
})
export class Prueba {
  private readonly eleccion = inject(EleccionDelArmador);

  /** Si el plan llegó armado desde la landing. */
  protected readonly planElegido: boolean;

  protected readonly plan = computed(
    () =>
      recomendarPlan({
        sedes: this.eleccion.sedes(),
        servicios: this.eleccion.servicios(),
        ia: this.eleccion.ia(),
      }).plan,
  );
  protected readonly servicios = computed(() => NOMBRE_DE_SERVICIOS[this.eleccion.servicios()]);
  protected readonly conIa = computed(() => this.eleccion.ia() === 'si');

  constructor() {
    const parametros = inject(ActivatedRoute).snapshot.queryParamMap;
    const sedes = parametros.get('sedes') as CantidadDeSedes | null;
    const servicios = parametros.get('servicios') as ServiciosElegidos | null;
    const ia = parametros.get('ia') as ConIa | null;
    this.planElegido =
      sedes !== null &&
      SEDES.includes(sedes) &&
      servicios !== null &&
      SERVICIOS.includes(servicios) &&
      ia !== null &&
      IA.includes(ia);
    if (this.planElegido) {
      this.eleccion.sedes.set(sedes!);
      this.eleccion.servicios.set(servicios!);
      this.eleccion.ia.set(ia!);
    }

    // El router no restaura el desplazamiento: se llega desde abajo de la landing.
    const documento = inject(DOCUMENT);
    afterNextRender(() => documento.defaultView?.scrollTo(0, 0));
  }
}
