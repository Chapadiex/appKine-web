import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';

import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { CharlaDelAsistente } from '../../components/charla-del-asistente/charla-del-asistente';
import { VinculoDeTelegram } from '../../../../shared/telegram/vinculo-de-telegram';

/** Pantalla del asistente de datos: la cabecera y la charla a todo el ancho. */
@Component({
  selector: 'app-asistente-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CabeceraDePagina, Ayuda, VinculoDeTelegram, CharlaDelAsistente],
  templateUrl: './asistente-page.html',
})
export class AsistentePage {
  private readonly charla = viewChild.required(CharlaDelAsistente);

  protected nuevaCharla(): void {
    this.charla().nuevaCharla();
  }
}
