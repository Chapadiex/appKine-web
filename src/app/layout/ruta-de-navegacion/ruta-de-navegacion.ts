import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map, startWith } from 'rxjs';

import { Miga, MigasStore } from '../../core/services/migas.store';
import { PermissionsStore } from '../../core/services/permissions.store';
import { tituloDe } from '../barra-superior/barra-superior';
import {
  SECCIONES,
  SECCIONES_DE_CUENTA,
  SECCION_PLATAFORMA,
  Seccion,
  seccionDe,
} from '../navegacion-principal/secciones';

/**
 * Donde estoy, en la barra superior (UX-13, 29/10/2026): "Padrón / Pérez, Ana / Coberturas del
 * paciente". El ultimo paso es la pantalla y sale del `title` de la ruta ("AKINE - Caja diaria" →
 * "Caja diaria"), que toda pantalla declara para la pestana del navegador. Los pasos anteriores
 * siguen la jerarquia, no el historial: si la pantalla publico los suyos ({@link publicarMigas},
 * con nombres propios), son esos; si no, la seccion del menu que la contiene. En una seccion del
 * menu hay un solo paso y se muestra como titulo, sin `nav`. En telefono queda solo el paso
 * anterior, como "volver".
 *
 * <p><b>Llega despues de la primera pintura.</b> La barra superior la monta con un `import()`,
 * como la sede y el perfil: con la ruta adentro, la carga inicial pasaba su tope de 430 kB.
 * Mientras tanto la barra muestra el titulo de la pantalla, que es el ultimo paso de esta ruta.
 */
@Component({
  selector: 'app-ruta-de-navegacion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './ruta-de-navegacion.html',
  styleUrl: './ruta-de-navegacion.css',
})
export class RutaDeNavegacion {
  private readonly router = inject(Router);
  private readonly migasPublicadas = inject(MigasStore);
  private readonly permisos = inject(PermissionsStore);

  private readonly ubicacion = toSignal(
    this.router.events.pipe(
      filter((evento) => evento instanceof NavigationEnd),
      startWith(null),
      map(() => ({
        camino: this.router.url.split(/[?#]/)[0] ?? '',
        titulo: tituloDe(this.router.routerState.snapshot.root),
      })),
    ),
    { initialValue: { camino: '', titulo: '' } },
  );

  /** Los pasos con enlace (de lo general a lo particular) y el nombre de la pantalla actual. */
  protected readonly migas = computed(() => {
    const { camino, titulo } = this.ubicacion();
    const publicadas = this.migasPublicadas.migas();
    const conRuta = publicadas.filter((miga) => miga.ruta);
    const seccion = seccionDe(camino, SECCIONES_DE_LA_BARRA);
    const anteriores: Miga[] =
      conRuta.length > 0 ? conRuta : seccion && this.visible(seccion) ? [seccion] : [];

    const enlaces: { readonly etiqueta: string; readonly ruta: string }[] = [];
    for (const miga of anteriores) {
      const ruta = this.aTexto(miga.ruta!);
      const repetida = enlaces.some((e) => e.ruta === ruta || e.etiqueta === miga.etiqueta);
      if (ruta !== camino && !repetida) {
        enlaces.push({ etiqueta: miga.etiqueta, ruta });
      }
    }
    const final = publicadas.at(-1);
    const actual = final && !final.ruta ? final.etiqueta : titulo;
    return { enlaces, actual };
  });

  /** Un paso hacia una seccion que la sesion no puede abrir llevaria a "sin permiso": no va. */
  private visible(seccion: Seccion): boolean {
    return seccion.permisos === undefined || this.permisos.tieneAlguno(...seccion.permisos);
  }

  private aTexto(ruta: string | readonly unknown[]): string {
    return typeof ruta === 'string'
      ? ruta
      : this.router.serializeUrl(this.router.createUrlTree([...ruta]));
  }
}

/** Donde puede caer una URL: las secciones del centro, la consola y las de la cuenta propia. */
const SECCIONES_DE_LA_BARRA: readonly Seccion[] = [
  ...SECCIONES,
  SECCION_PLATAFORMA,
  ...SECCIONES_DE_CUENTA,
];
