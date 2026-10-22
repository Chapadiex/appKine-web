import { ChangeDetectionStrategy, Component, ViewEncapsulation, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Miga, Migas } from '../migas/migas';
import { Pestana, Pestanas } from '../pestanas/pestanas';

/** Una marca de estado al lado del titulo. El tono elige el color, no el texto. */
export interface MarcaDeFicha {
  readonly texto: string;

  readonly tono: 'activa' | 'revocada' | 'neutra';
}

/** Todo lo que la banda dibuja. Lo arma quien sabe de dominio; la banda no decide nada. */
export interface ModeloDeCabeceraDeFicha {
  readonly migas: readonly Miga[];

  readonly titulo: string;

  /** Con ruta, el titulo es un enlace a la ficha; sin ella, texto (o el `h1`, ver abajo). */
  readonly rutaTitulo: string | null;

  /** Datos cortos al lado del titulo: el documento, por ejemplo. */
  readonly datos: readonly string[];

  readonly marcas: readonly MarcaDeFicha[];

  readonly pestanas: readonly Pestana[];

  readonly etiquetaPestanas: string;
}

/**
 * Banda de una ficha (UX-01): migas, titulo, datos y marcas arriba, y las pestanas de las
 * pantallas hermanas debajo.
 *
 * <p>Antes vivia como `app-cabecera-de-persona` en cuatro copias (person, billing, activity y
 * clinical) porque las features no pueden importarse entre si (ADR-0004). La parte de dominio
 * -que pestanas ve quien, como se escribe el documento- subio a `core/models/cabecera-de-persona`;
 * aca queda solo el dibujo, que no sabe que es una persona.
 *
 * <p><b>Dos ranuras.</b> `[cabeceraAyuda]` va pegada al titulo (el "?"); el resto, a la derecha
 * (las acciones de la pantalla).
 *
 * <p>`ViewEncapsulation.None` para ajustar las pestanas compartidas dentro de la banda; las clases
 * llevan el prefijo `cabecera-ficha` y no chocan con nada.
 */
@Component({
  selector: 'app-cabecera-de-ficha',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Migas, Pestanas],
  templateUrl: './cabecera-de-ficha.html',
  styleUrl: './cabecera-de-ficha.css',
  encapsulation: ViewEncapsulation.None,
})
export class CabeceraDeFicha {
  readonly modelo = input.required<ModeloDeCabeceraDeFicha>();

  /** En la ficha el titulo ES el `h1` de la pantalla; en las hermanas, un enlace a ella. */
  readonly tituloComoH1 = input(false);
}
