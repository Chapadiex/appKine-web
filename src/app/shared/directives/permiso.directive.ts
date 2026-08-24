import {
  Directive,
  TemplateRef,
  ViewContainerRef,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';

import { PermissionsStore } from '../../core/services/permissions.store';

/**
 * Muestra el contenido solo si el contexto activo tiene alguno de los permisos.
 *
 * <pre>
 * &lt;button *akinePermiso="'colaborador:manage'"&gt;Invitar colaborador&lt;/button&gt;
 * &lt;a *akinePermiso="[PERMISO_AUDITORIA_READ, PERMISO_AUDITORIA_READ_CLINICA]"&gt;Auditoria&lt;/a&gt;
 * </pre>
 *
 * <p><b>OCULTAR NO ES AUTORIZAR.</b> Esta directiva no borra nada del lado del servidor: el
 * boton que no se dibuja corresponde a un endpoint que sigue estando ahi, alcanzable por
 * URL directa, por curl o editando el bundle —el `Set` de permisos es una variable de
 * JavaScript y cualquiera puede escribirla desde la consola—. Quien decide es el backend,
 * que reevalua rol, grants, alcance y habilitacion vigente en cada request. Esto es
 * exclusivamente UX: evita ofrecer una accion que iba a terminar en un `403`.
 *
 * <p><b>Recibe un string y no sabe que significa.</b> `shared/` no puede contener reglas de
 * dominio (AGENT.md 4): la directiva compara codigos opacos contra un `Set`. El catalogo
 * vive en `core/models/permisos.ts` y lo importan las pantallas de `features/`, que si
 * saben que estan pidiendo.
 *
 * <h2>Mientras los permisos no cargaron: se OCULTA</h2>
 *
 * <p>La ventana existe de verdad —entre que la pantalla se monta y que
 * `GET /me/permissions` responde— y las dos salidas cuestan algo:
 *
 * <ul>
 *   <li><b>Mostrar y despues ocultar:</b> durante esa ventana la interfaz ofrece acciones
 *       que el usuario puede <b>clickear</b>. El resultado es un `403` que no sabe
 *       interpretar, o peor, un formulario a medio llenar que se desvanece. Y el dano no se
 *       deshace: la accion ya salio.</li>
 *   <li><b>Ocultar y despues mostrar:</b> durante esa ventana falta contenido que despues
 *       aparece. Molesto, pero <b>reversible y sin consecuencias</b>: nadie puede clickear
 *       lo que no se dibujo.</li>
 * </ul>
 *
 * <p>Se elige ocultar, que es la opcion cerrada. Ante la duda, la interfaz de un sistema de
 * historia clinica ofrece de menos y no de mas. Ademas es coherente con el resto del
 * arranque: `provideAppInitializer` ya espera a `restaurarSesion()` antes de activar la
 * primera ruta, y {@link permissionGuard} carga los permisos antes de dejar entrar, asi que
 * en la navegacion normal la ventana ni siquiera se llega a ver — el caso real que queda es
 * el de una pantalla que se monta sin guard de permiso.
 *
 * <p><b>Lo que NO resuelve, y hay que resolver en la pantalla.</b> Un contenedor entero
 * dentro de `*akinePermiso` deja la pantalla vacia durante la ventana, y "vacio" y "no
 * tenes acceso" se ven igual. Esta directiva es para <b>acciones</b> —botones, items de
 * menu, enlaces—, no para el cuerpo de la pagina: una pantalla que depende de un permiso se
 * cubre con {@link permissionGuard}, que espera la carga y ademas explica por que no entra.
 * El diseno de AKINE-01.03 (seccion 9) pide ademas preferir <b>deshabilitar con
 * explicacion</b> antes que ocultar donde el usuario necesite saber a quien pedirle acceso;
 * eso es decision de cada pantalla y no de esta directiva, que solo ofrece la forma
 * estructural.
 */
@Directive({
  selector: '[akinePermiso]',
})
export class PermisoDirective {
  private readonly template = inject(TemplateRef<unknown>);
  private readonly contenedor = inject(ViewContainerRef);
  private readonly permisos = inject(PermissionsStore);

  /**
   * Uno o varios codigos de permiso. Con varios alcanza tener <b>alguno</b> (OR).
   *
   * <p>`required` a proposito: `*akinePermiso` sin valor mostraria siempre, que es lo
   * contrario de lo que aparenta el codigo que lo escribio. Falla al compilar la plantilla.
   */
  readonly akinePermiso = input.required<string | readonly string[]>();

  /**
   * Depende de `cargados()` ademas de los permisos: sin ese termino, "todavia no se" y "no
   * tiene" son el mismo `Set` vacio, y la directiva no podria distinguirlos ni cambiar de
   * decision manana.
   */
  private readonly visible = computed(() => {
    const pedidos = this.akinePermiso();
    if (!this.permisos.cargados()) {
      return false;
    }
    return this.permisos.tieneAlguno(...(typeof pedidos === 'string' ? [pedidos] : pedidos));
  });

  constructor() {
    // Zoneless: el `effect` es lo que conecta el signal con el DOM. Se guarda si la vista
    // esta creada en lugar de recrearla en cada corrida: `createEmbeddedView` sobre una
    // vista ya montada la duplicaria, y limpiar y recrear sin necesidad perderia el estado
    // local del contenido (foco, texto tipeado) en cada cambio de contexto.
    let creada = false;

    effect(() => {
      const debeVerse = this.visible();

      if (debeVerse && !creada) {
        this.contenedor.createEmbeddedView(this.template);
        creada = true;
        return;
      }

      if (!debeVerse && creada) {
        this.contenedor.clear();
        creada = false;
      }
    });
  }
}
