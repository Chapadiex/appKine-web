import { Component, inject } from '@angular/core';

import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { PreferenciasStore, Tema } from '../../../../core/services/preferencias.store';

/**
 * Preferencias personales (refactor de la cabecera global, 28/10/2026). Solo lo de quien usa la
 * aplicacion: la configuracion del centro vive en Configuracion, nunca aca.
 *
 * <p>Hoy, el tema. Las preferencias se guardan en este navegador ({@link PreferenciasStore}): el
 * contrato no tiene donde guardarlas por cuenta, y por eso las notificaciones personales no
 * estan.
 */
@Component({
  selector: 'app-preferencias-page',
  imports: [Ayuda],
  templateUrl: './preferencias-page.html',
})
export class PreferenciasPage {
  private readonly preferencias = inject(PreferenciasStore);

  protected readonly tema = this.preferencias.tema;

  protected readonly temas: readonly { readonly valor: Tema; readonly etiqueta: string }[] = [
    { valor: 'sistema', etiqueta: 'Igual que el sistema' },
    { valor: 'claro', etiqueta: 'Claro' },
    { valor: 'oscuro', etiqueta: 'Oscuro' },
  ];

  protected elegir(tema: Tema): void {
    this.preferencias.elegirTema(tema);
  }
}
