import { Injectable, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Observable, finalize, switchMap } from 'rxjs';

import { AuthorizedContextResponse } from '../../api/generated/model/authorized-context-response';
import { SessionService } from '../../core/services/session.service';
import {
  RUTA_INICIO,
  SECCIONES,
  SECCIONES_DE_CUENTA,
  SECCION_PLATAFORMA,
  seccionDe,
} from '../navegacion-principal/secciones';

/**
 * Cambio de sede desde la barra superior (refactor de la cabecera global, 28/10/2026).
 *
 * <p><b>La pantalla se vuelve a crear.</b> Mientras el cambio esta en curso el shell saca el
 * `router-outlet` (ver `app.html`): la pantalla que se estaba mirando se destruye antes de pedir el
 * token nuevo y se crea de cero despues. Las features reaccionan a `contextEpoch`, pero una que
 * cargo sus datos en el constructor y no lo mira dejaria en pantalla datos de la sede anterior —con
 * otra organizacion, datos clinicos ajenos—. Recrearla no depende de que cada pantalla lo haga bien.
 *
 * <p><b>Se vuelve a la raiz de la seccion, no a la URL exacta.</b> Un detalle (`/pacientes/12`,
 * `/presentaciones/7`) puede no existir en la otra sede u organizacion; la lista de la misma seccion
 * si. Fuera de toda seccion conocida, el destino es el inicio.
 *
 * <p><b>Los guards del destino corren con la sede nueva.</b> Volver a `/caja` estando en `/caja`
 * es la misma URL, y Angular la ignora sin correr `permissionGuard`; tampoco recrear el outlet los
 * corre. Sin esto, quien opera la caja en una sede y no en la otra se quedaba en la caja con cada
 * pedido en 403. Por eso se pasa antes por {@link SEGMENTO_DE_TRANSITO}: una ruta vacia, sin titulo
 * y sin tocar la barra de direcciones, desde la que el destino se activa entero.
 */
@Injectable({ providedIn: 'root' })
export class CambioDeSede {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  private readonly destinoEnCurso = signal<string | null>(null);

  /** Nombre de la sede a la que se esta entrando, o `null` si no hay cambio en curso. */
  readonly cambiandoA = this.destinoEnCurso.asReadonly();

  /**
   * Canjea el token por uno de la sede elegida y vuelve a abrir la seccion actual. Si el canje
   * falla, el error llega a quien se suscribe y la pantalla vuelve tal como estaba: el token viejo
   * sigue vigente.
   */
  cambiar(contexto: AuthorizedContextResponse): Observable<boolean> {
    const destino = destinoTrasCambio(this.router.url);
    this.destinoEnCurso.set(
      contexto.consultorioName || contexto.organizationName || 'la sede elegida',
    );
    return this.session.seleccionarContexto(contexto.organizationId!, contexto.consultorioId!).pipe(
      switchMap(() =>
        this.router.navigateByUrl(`/${SEGMENTO_DE_TRANSITO}`, { skipLocationChange: true }),
      ),
      // `replaceUrl`: "Atras" no vuelve a una pantalla de la sede anterior.
      switchMap(() => this.router.navigateByUrl(destino, { replaceUrl: true })),
      finalize(() => this.destinoEnCurso.set(null)),
    );
  }
}

/** Ruta vacia por la que pasa el cambio de sede (ver {@link CambioDeSede}). */
export const SEGMENTO_DE_TRANSITO = 'cambiando-de-sede';

/** Solo se entra durante un cambio de sede; escrita a mano en la barra, lleva al inicio. */
export const transitoGuard: CanActivateFn = () =>
  inject(CambioDeSede).cambiandoA() !== null || inject(Router).parseUrl(RUTA_INICIO);

/** Raiz de la seccion de `url`, o el inicio si no pertenece a ninguna. */
export function destinoTrasCambio(url: string): string {
  return (
    seccionDe(url, [...SECCIONES, SECCION_PLATAFORMA, ...SECCIONES_DE_CUENTA])?.ruta ?? RUTA_INICIO
  );
}
