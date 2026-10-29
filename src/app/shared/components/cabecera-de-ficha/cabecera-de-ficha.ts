import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
} from '@angular/core';

import { CabeceraDePagina } from '../cabecera-de-pagina/cabecera-de-pagina';
import { Pestana, Pestanas } from '../pestanas/pestanas';

/** Una marca de estado al lado del titulo. El tono elige el color, no el texto. */
export interface MarcaDeFicha {
  readonly texto: string;

  readonly tono: 'activa' | 'revocada' | 'neutra';
}

/** Todo lo que la banda dibuja. Lo arma quien sabe de dominio; la banda no decide nada. */
export interface ModeloDeCabeceraDeFicha {
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
 * Cabecera de una ficha (UX-01): titulo, datos y marcas arriba, y las pestanas de las
 * pantallas hermanas debajo. Desde el 29/10/2026 es una {@link CabeceraDePagina} con esos datos:
 * la misma fila, la misma altura y el mismo lugar para la accion principal que cualquier pantalla.
 *
 * <p>Antes vivia como `app-cabecera-de-persona` en cuatro copias (person, billing, activity y
 * clinical) porque las features no pueden importarse entre si (ADR-0004). La parte de dominio
 * -que pestanas ve quien, como se escribe el documento- subio a `core/models/cabecera-de-persona`;
 * aca queda solo el dibujo, que no sabe que es una persona.
 *
 * <p><b>La ficha y sus hermanas.</b> En la ficha el titulo es el nombre de la persona. En una
 * pantalla hermana (`titulo`: "Coberturas") el titulo es el de la seccion y la persona queda al
 * lado como dato, con su documento. La ruta de navegacion ("Padrón / Perez, Ana / Coberturas")
 * vive en la barra superior (UX-13) y la publica `cabeceraDePersona`.
 *
 * <p><b>Dos ranuras.</b> `app-ayuda` va pegada al titulo (el "?"); el resto, a la derecha (las
 * acciones de la pantalla).
 *
 * <p>`ViewEncapsulation.None` para que los estilos alcancen a lo proyectado; las clases llevan el
 * prefijo `cabecera-ficha` y no chocan con nada.
 */
@Component({
  selector: 'app-cabecera-de-ficha',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CabeceraDePagina, Pestanas],
  templateUrl: './cabecera-de-ficha.html',
  styleUrl: './cabecera-de-ficha.css',
  encapsulation: ViewEncapsulation.None,
})
export class CabeceraDeFicha {
  readonly modelo = input.required<ModeloDeCabeceraDeFicha>();

  /** El titulo de la seccion en una pantalla hermana. Sin el, el titulo es el de la ficha. */
  readonly titulo = input<string | null>(null);

  /** En una hermana, quien es la persona: nombre y documento, en una linea. */
  protected readonly persona = computed(() => {
    const m = this.modelo();
    return [m.titulo, ...m.datos].join(' · ');
  });
}
