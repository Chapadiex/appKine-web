import { Component, input, output } from '@angular/core';

import { SlotDisponible } from '../../../../api/generated/model/slot-disponible';
import { fechaEnPalabras, rangoEnZona, slotCompleto } from '../../models/etiquetas-de-agenda';

/**
 * Dia y horario destino de un turno que se mueve: un dia de la agenda y sus slots.
 *
 * <p>Lo usan el ciclo del turno (mover uno) y la serie (mover varios desde un pivote). Es
 * presentacional a proposito: no pide la agenda ni sabe que se va a hacer con el horario. La
 * pantalla le pasa los slots del dia y escucha los dos eventos.
 *
 * <p>Se elige un slot <b>de la agenda</b> y no una hora escrita a mano: el contrato pide el
 * `inicio` tal como lo devolvio la agenda, y una hora tipeada daria `slot-no-disponible` casi
 * siempre.
 */
@Component({
  selector: 'app-selector-de-horario',
  templateUrl: './selector-de-horario.html',
  styleUrl: '../../agenda.css',
})
export class SelectorDeHorario {
  /** `id` del campo de fecha. Tiene que ser unico en la pantalla. */
  readonly idDia = input.required<string>();
  readonly fecha = input.required<string>();
  readonly slots = input.required<readonly SlotDisponible[]>();
  readonly timezone = input('');
  /** `desde` del slot elegido, o vacio. */
  readonly elegido = input('');
  readonly faltaHorario = input(false);
  readonly textoFaltaHorario = input('Elegi el horario destino antes de mover el turno.');

  readonly diaCambiado = output<string>();
  readonly slotElegido = output<SlotDisponible>();

  protected readonly fechaEnPalabras = fechaEnPalabras;
  protected readonly slotCompleto = slotCompleto;

  protected rango(slot: SlotDisponible): string {
    return rangoEnZona(slot, this.timezone());
  }

  protected esElElegido(slot: SlotDisponible): boolean {
    return this.elegido() !== '' && slot.desde === this.elegido();
  }
}
