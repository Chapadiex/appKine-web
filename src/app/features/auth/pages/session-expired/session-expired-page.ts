import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { PARAM_VOLVER_A, destinoInterno } from '../../../../core/models/rutas';

/**
 * Sesion expirada (M02, AKINE-01.02).
 *
 * <p>Es el destino de los `401` del refresh: refresh ausente, invalido, vencido, revocado o
 * reusado responden los cinco igual y la respuesta borra la cookie. No se distinguen en
 * pantalla, a proposito: el cliente no puede saber si "te detectamos un reuso" o "no
 * servia".
 *
 * <p><b>Solo el 401 del refresh llega aca.</b> Un `403` -sin permiso o sin contexto- NO
 * cierra la sesion y no debe traer al usuario a esta pantalla: se maneja donde ocurre.
 *
 * <p>No limpia estado por su cuenta: para cuando se llega aca, el interceptor ya descarto el
 * access token. Su unico trabajo es explicar que paso y dar el camino de vuelta,
 * conservando a donde queria ir el usuario.
 */
@Component({
  selector: 'app-session-expired-page',
  imports: [RouterLink],
  templateUrl: './session-expired-page.html',
  styleUrl: '../../auth.css',
})
export class SessionExpiredPage {
  private readonly ruta = inject(ActivatedRoute);

  /**
   * Parametros con los que se vuelve al login, para retomar donde se corto.
   *
   * <p>El nombre del parametro lo fija `core/`: es el mismo que escriben los guards y el
   * interceptor de auth, y esta pantalla se limita a reenviarlo intacto al login. El
   * sanitizado tambien sale de `core/` -{@link destinoInterno}-: un destino absoluto
   * convertiria el login en una redireccion abierta hacia un sitio de phishing.
   */
  protected readonly parametrosDeVuelta = computed<Record<string, string>>(() => {
    const destino = destinoInterno(this.ruta.snapshot.queryParamMap.get(PARAM_VOLVER_A));
    const parametros: Record<string, string> = {};
    if (destino !== null) {
      parametros[PARAM_VOLVER_A] = destino;
    }
    return parametros;
  });
}
