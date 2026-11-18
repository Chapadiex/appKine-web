import { ChangeDetectionStrategy, Component } from '@angular/core';

import { Icono, NombreDeIcono } from '../../../../shared/components/icono/icono';

interface FuncionDeIa {
  readonly icono: NombreDeIcono;
  readonly titulo: string;
  readonly texto: string;
}

/** El adicional de IA (§2.3 del plan de la landing): qué hace cada función y dónde corre. */
@Component({
  selector: 'app-seccion-ia',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icono],
  templateUrl: './seccion-ia.html',
  styleUrls: ['../../landing-comun.css', './seccion-ia.css'],
})
export class SeccionIa {
  protected readonly funcionesIa: readonly FuncionDeIa[] = [
    {
      icono: 'buscar',
      titulo: 'Asistente de datos',
      texto: 'Preguntás en tus palabras y responde con los datos que tu rol puede ver.',
    },
    {
      icono: 'microfono',
      titulo: 'Dictado por voz',
      texto: 'Hablás durante la evaluación y propone en qué campo va cada cosa. Vos elegís.',
    },
    {
      icono: 'capas',
      titulo: 'Evolución del caso',
      texto: 'Alertas de dolor, adherencia y frecuencia sobre las sesiones cerradas.',
    },
    {
      icono: 'documento',
      titulo: 'Sugerencias y biblioteca',
      texto: 'Propuestas con citas de los protocolos de tu centro. El profesional decide.',
    },
  ];
}
