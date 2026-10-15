import { Component, effect, inject, input, untracked } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { VisitaClinica } from '../../services/visita-clinica';

/**
 * Marco de una visita a la Historia Clinica: provee {@link VisitaClinica} a la historia, al caso y
 * al plan, que se montan adentro.
 *
 * <p>Sin plantilla propia mas alla del `router-outlet`: cada pantalla tiene su titulo y su camino
 * de vuelta. Lo unico que hace es <b>cortar la visita</b> cuando cambia la persona o el contexto
 * —otra organizacion u otra sede—: lo que se habia declarado ya no vale y el motivo se vuelve a
 * pedir.
 */
@Component({
  selector: 'app-visita-clinica-page',
  imports: [RouterOutlet],
  providers: [VisitaClinica],
  template: '<router-outlet />',
})
export class VisitaClinicaPage {
  private readonly visita = inject(VisitaClinica);
  private readonly contexto = inject(TenantContextStore);

  readonly personaId = input.required<string>();

  constructor() {
    effect(() => {
      const personaId = Number(this.personaId());
      this.contexto.contextEpoch();
      untracked(() => this.visita.iniciar(personaId));
    });
  }
}
