import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { FlujoDeTurnosStore } from '../../../core/services/flujo-de-turnos.store';
import { BloqueoDeAgendaPanel } from './bloqueo-de-agenda-panel';
import { DetalleDeTurnoPanel } from './detalle-de-turno-panel';
import { ListaDeEsperaPanel } from './lista-de-espera-panel';
import { NuevoTurnoPanel } from './nuevo-turno-panel';
import { ProgramacionMultiplePanel } from './programacion-multiple-panel';

/**
 * Lo que el shell monta la primera vez que alguien pide algo del flujo de turnos.
 *
 * <p>Un solo punto dibuja los paneles, venga el pedido de la agenda, del paciente o de la atencion: es
 * lo que hace que "muchos puntos de entrada" terminen en un solo flujo (TURNO - Tecnico §1). Cada
 * panel se recrea con su solicitud, y por eso no arrastra el estado del anterior.
 */
@Component({
  selector: 'app-flujo-de-turnos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BloqueoDeAgendaPanel,
    DetalleDeTurnoPanel,
    ListaDeEsperaPanel,
    NuevoTurnoPanel,
    ProgramacionMultiplePanel,
  ],
  template: `
    @if (flujo.solicitud(); as solicitud) {
      @switch (solicitud.tipo) {
        @case ('nuevo') {
          @for (contexto of [solicitud.contexto]; track contexto) {
            <app-nuevo-turno-panel [contexto]="contexto" (cerrar)="flujo.cerrar()" />
          }
        }
        @case ('multiple') {
          @for (contexto of [solicitud.contexto]; track contexto) {
            <app-programacion-multiple-panel [contexto]="contexto" (cerrar)="flujo.cerrar()" />
          }
        }
        @case ('detalle') {
          @for (turnoId of [solicitud.turnoId]; track turnoId) {
            <app-detalle-de-turno-panel [turnoId]="turnoId" (cerrar)="flujo.cerrar()" />
          }
        }
        @case ('espera') {
          @for (contexto of [solicitud.contexto]; track contexto) {
            <app-lista-de-espera-panel [contexto]="contexto" (cerrar)="flujo.cerrar()" />
          }
        }
        @case ('bloqueo') {
          @for (contexto of [solicitud.contexto]; track contexto) {
            <app-bloqueo-de-agenda-panel [contexto]="contexto" (cerrar)="flujo.cerrar()" />
          }
        }
      }
    }
  `,
})
export class FlujoDeTurnos {
  protected readonly flujo = inject(FlujoDeTurnosStore);
}
