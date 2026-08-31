import { Component, computed, effect, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { PermissionsStore } from '../../core/services/permissions.store';
import { RUTA_SELECTOR_CONTEXTO } from '../../core/models/rutas';
import { SECCIONES, Seccion } from './secciones';
import { SessionService } from '../../core/services/session.service';
import { TenantContextStore } from '../../core/services/tenant-context.store';

/**
 * Navegacion principal de AKINE, en la barra de marca del layout raiz.
 *
 * <p><b>Por que existe.</b> Hasta esta tarea el shell tenia cero enlaces: todas las pantallas
 * se alcanzaban tipeando la URL a mano. Una aplicacion sin navegacion no se puede demostrar y
 * no se puede usar.
 *
 * <h2>Que se muestra</h2>
 *
 * <p>Tres situaciones, y las tres son distintas para el usuario:
 *
 * <ul>
 *   <li><b>Anonimo</b> — nada. Las pantallas de login, activacion y recuperacion no tienen a
 *       donde navegar, y ofrecerle secciones a quien no tiene sesion solo produce rebotes al
 *       login.</li>
 *   <li><b>Autenticado sin contexto</b> — un unico enlace al selector. Con un token
 *       `pre_context` <b>ningun</b> endpoint de negocio responde (el backend corta con
 *       `403 missing-tenant-context`), asi que cada seccion se abriria vacia y llena de
 *       errores. Lo que corresponde es mandar a elegir donde trabajar.</li>
 *   <li><b>Con contexto</b> — las secciones que el contexto habilita, mas el indicador de
 *       donde esta parado el usuario y como cambiarlo.</li>
 * </ul>
 *
 * <h2>Filtrado por permiso</h2>
 *
 * <p>Cada seccion declara en {@link SECCIONES} el permiso que exige el `permissionGuard` de su
 * propia ruta, y aca se filtra contra los permisos efectivos del contexto. <b>Esconder no es
 * autorizar</b>: esto es UX, y quien decide es el backend. Lo que compra es no ofrecer un
 * enlace cuyo unico destino posible era la pantalla de "no tenes permiso".
 *
 * <p><b>Mientras los permisos no cargaron se esconde</b>, igual que `*akinePermiso` y por el
 * mismo motivo: durante esa ventana "no se todavia" y "no tiene" son el mismo `Set` vacio, y
 * de las dos salidas la cerrada es la reversible. Las secciones sin permiso —que son casi
 * todas, porque el backend las autoriza por pertenencia— no dependen de esa carga y se ven
 * desde el primer frame.
 *
 * <p>El filtrado se hace en TypeScript y no con `*akinePermiso` sobre cada `li` a proposito:
 * la directiva exige un valor y `tieneAlguno()` sin argumentos devuelve `false`, asi que una
 * seccion sin permiso pasada como lista vacia quedaria escondida para todo el mundo. Eso
 * obliga a pedir los permisos aca, cosa que la directiva hacia sola: de eso se ocupa el
 * `effect` del constructor.
 */
@Component({
  selector: 'app-navegacion-principal',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './navegacion-principal.html',
  styleUrl: './navegacion-principal.css',
})
export class NavegacionPrincipal {
  private readonly session = inject(SessionService);
  private readonly tenant = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);

  protected readonly rutaSelector = RUTA_SELECTOR_CONTEXTO;

  /** Contexto activo: de aca salen los nombres de la organizacion y la sede. */
  protected readonly contexto = this.tenant.context;

  /** `true` con sesion pero sin contexto elegido: se ofrece el selector y nada mas. */
  protected readonly faltaContexto = computed(() => this.session.estado() === 'sin-contexto');

  /**
   * `true` solo con token de contexto <b>y</b> contexto en el store.
   *
   * <p>Se exigen los dos y no uno: el estado dice que el token opera, y el store es de donde
   * salen los nombres. Si alguna vez se desincronizaran, dibujar la barra sin saber en que
   * organizacion se esta es peor que no dibujarla.
   */
  protected readonly hayContexto = computed(
    () => this.session.estado() === 'activa' && this.tenant.context() !== null,
  );

  /** Las secciones que este contexto puede abrir, en el orden declarado. */
  protected readonly secciones = computed<readonly Seccion[]>(() =>
    SECCIONES.filter(
      (seccion) => seccion.permisos === undefined || this.permisos.tieneAlguno(...seccion.permisos),
    ),
  );

  constructor() {
    // Los permisos no se piden solos. Este menu es, en varias pantallas, el unico consumidor
    // que existe -las que no llevan `permissionGuard` ni muestran acciones condicionadas-, y
    // sin esto la seccion de horarios no aparecia nunca. `asegurarCargados` es idempotente,
    // comparte la carga en vuelo y no hace nada sin contexto.
    //
    // Va dentro del `effect` y no suelto en el constructor: `cargados()` vuelve a `false` en
    // cada cambio de contexto, y eso tiene que volver a disparar la carga.
    effect(() => {
      if (this.hayContexto() && !this.permisos.cargados()) {
        this.permisos.asegurarCargados();
      }
    });
  }
}
