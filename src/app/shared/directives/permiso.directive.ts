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
 * en la navegacion normal la ventana ni siquiera se llega a ver.
 *
 * <h2>La directiva PIDE los permisos, no solo los lee</h2>
 *
 * <p>Hasta AKINE-02.02 el unico que llamaba a `PermissionsStore.cargar()` era
 * {@link permissionGuard}. Una ruta que no lleva ese guard —el listado de sedes y el de
 * espacios, que se abren con solo ser miembro porque el `GET` no exige mas que eso— no lo
 * llamaba nadie: `cargados()` se quedaba en `false` y esta directiva escondia <b>todas</b>
 * las acciones. Un administrador veia la tabla completa y ni un boton, sin ningun error que
 * lo explicara.
 *
 * <p>Por eso el `effect` llama a `PermissionsStore.asegurarCargados()` mientras el contenido
 * este oculto. <b>Va aca y no en cada pantalla</b>: dejarselo a la pantalla es como nacio el
 * defecto —la proxima que se olvide vuelve a tenerlo, en silencio—, mientras que esto no se
 * puede olvidar, porque pedir los permisos pasa a ser parte de usar la directiva. La
 * idempotencia, la carga en vuelo compartida y el corte sin contexto viven en el store: veinte
 * filas son una sola peticion, y una pantalla sin sesion no dispara ninguna.
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

      // Los permisos no se piden solos. Esta directiva es el unico consumidor que existe en
      // TODA pantalla que muestre acciones condicionadas, con guard de permiso o sin el, asi
      // que es el unico lugar donde pedirlos no se puede olvidar. `asegurarCargados` no hace
      // nada si ya estan, si hay una carga en vuelo o si no hay contexto: veinte filas con la
      // directiva siguen siendo una sola peticion, y una pantalla publica, ninguna.
      //
      // Va DENTRO del `effect` y no en el constructor a proposito: `cargados()` vuelve a
      // `false` en cada cambio de contexto -por comparacion de epoca, en el mismo tick-, y eso
      // reejecuta esto. Un `asegurarCargados()` suelto en el constructor cargaria los permisos
      // de la primera organizacion y no los de la segunda.
      if (!debeVerse) {
        this.permisos.asegurarCargados();
      }

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
