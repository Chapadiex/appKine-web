# UX-11 · Espacio, formularios y paneles laterales (28/10/2026)

> Pedido del usuario del 28/10/2026: refactor UX/UI profundo de toda la app. No menos
> funcionalidad: la complejidad organizada para no verla toda junta. Este documento fija los
> patrones que aplican **todas** las pantallas; el plan general sigue en
> [`00-plan-refactor-ux-ui.md`](00-plan-refactor-ux-ui.md).

## 1. Diagnóstico

| #   | Hallazgo                                                                                                                   | Sev.  |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ----- |
| E1  | Las pantallas "de lectura" usaban 46rem: en 1440 px, menos de la mitad del ancho, con una columna de campos en el medio.   | ALTO  |
| E2  | 19 pantallas abrían el formulario de edición **dentro de la tabla** (`tr.fila-panel`): el listado se partía y se estiraba. | ALTO  |
| E3  | Formularios en una sola columna, con una ayuda permanente debajo de cada campo (555 `.ayuda`).                             | ALTO  |
| E4  | El botón de guardar al final del scroll; la acción principal a la izquierda y Cancelar a la derecha.                       | MEDIO |
| E5  | La sede activa se cambiaba en otra pantalla (enlace "Cambiar"); la cuenta y la salida, al pie de la barra lateral.         | MEDIO |
| E6  | El asistente de alta de sede gastaba 200 px en una columna de dos pasos y mezclaba lo obligatorio con lo opcional.         | MEDIO |
| E7  | Tarjeta dentro de tarjeta, y una tabla de seis columnas con 3 botones por fila.                                            | BAJO  |

## 2. Lo que cambia en todas las pantallas (sin tocar plantillas)

| Regla                       | Dónde                                       | Efecto                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ancho del contenido         | `app.css` `.contenido`                      | Todo el ancho de la columna, con tope de 96rem. La prosa se queda en 90ch (`design-system.css`). Las pantallas sin barra lateral (acceso, selector) siguen en 46rem centradas.                           |
| Formularios en grilla       | `design-system.css` `form`                  | Columnas de 18rem mínimo (tres en 1440, una en el teléfono), sin tope: un `max-width` rompe el ancho mínimo en columnas `1fr`. Lo que no es `.campo`, los `textarea` y `.campo--ancho` van a la fila entera. `.formulario--libre` lo desactiva. |
| Ayuda de campo a demanda    | `.campo > .ayuda`                           | Aparece flotando mientras el campo tiene el foco. Sigue enlazada por `aria-describedby`. **Lo que se ve siempre lleva `.ayuda--fija`** (datos, consecuencias, ayudas con interpolación).                 |
| Acciones de formulario      | `form > .acciones`                          | A la derecha, con la principal en el borde ("Cancelar · Guardar"). Se invierte el orden visual, no el del DOM: la principal se sigue escribiendo **primera**.                                            |
| Barra de acciones fija      | `.tarjeta form > .acciones:last-child`      | Pegada al pie de la ventana mientras el formulario se desplaza.                                                                                                                                          |
| Tarjeta dentro de tarjeta   | `.tarjeta .tarjeta`                         | Sin segundo borde ni sombra.                                                                                                                                                                             |
| Búsqueda                    | `.filtros-barra__principal`                 | Tope de 36rem: el embudo queda al lado.                                                                                                                                                                  |
| Sección opcional plegada    | `details.seccion-plegable`                  | `summary` con el nombre y un resumen de una línea (`.seccion-plegable__resumen`).                                                                                                                        |
| Botón de fila               | `.boton--chico`                             | 32 px de alto para la acción principal de una fila de 48 px.                                                                                                                                             |
| Fila seleccionada           | `.fila--seleccionada`                       | La fila cuyo panel lateral está abierto.                                                                                                                                                                 |

## 3. Shell

- **La cabecera es la de web #140** (`layout/barra-superior`, `layout/selector-de-sede`,
  `layout/menu-de-perfil`): el título de la pantalla a la izquierda; a la derecha **Sede ▾** y
  **perfil ▾**. Son los dos elementos globales y no se repiten en ningún otro lado.
- UX-11 había hecho su propia versión (`layout/menus/`, con `Grupo / Sección` a la izquierda) en
  paralelo con #140. Al integrarlas quedó la de #140, que además trae Mi perfil, Preferencias y el
  cambio de sede que recrea la pantalla; la consola de plataforma sigue en la barra lateral y el
  selector de sede lista las sedes de todas las organizaciones de la cuenta.
- Selector y perfil llegan por `import()` después de la primera pintura (no con `@defer`): la
  carga inicial está al borde de su presupuesto. Se borró `layout/quien-ingreso`.

## 4. Panel lateral (`app-panel-lateral`, `shared/components/panel-lateral`)

Es el patrón de **edición y confirmación desde un listado**. Reemplaza a `tr.fila-panel`.

```html
@if (filaEnPanel(); as sede) {
  @if (panel()?.tipo === 'editar') {
    <app-panel-lateral [titulo]="'Editar ' + sede.name" (cerrar)="cerrarPanel()">
      <form ...>
        ...campos...
        <div class="acciones">
          <button type="submit" class="boton">Guardar los cambios</button>
          <button type="button" class="boton boton--secundario" (click)="cerrarPanel()">Cancelar</button>
        </div>
      </form>
    </app-panel-lateral>
  }
}
```

- Es un `<dialog>` modal nativo: foco atrapado, Escape emite `cerrar`, el fondo **no** cierra
  (un formulario a medio cargar no se descarta con un clic afuera). Al destruirse devuelve el foco
  a quien lo abrió. Enfoca el primer campo al abrir.
- Vive **fuera de la tabla**. La pantalla expone un `computed` que busca la fila del panel en la
  página actual (`sedeEnPanel`) y la plantilla la re-nombra con `@if (...; as fila)`: el contenido
  que antes vivía en el `@for` se mueve sin cambiar sus referencias.
- La fila abierta lleva `[class.fila--seleccionada]`.
- La `.acciones` final del formulario queda pegada al pie del panel. Dentro del panel los
  formularios van en dos columnas de 13rem.
- `ancho="amplio"` (46rem) para paneles con tablas o grillas anchas.
- Pestañas internas (`.panel-lateral__pestanas`, `role="tablist"`) cuando los datos se separan
  en "lo que hace funcionar" y "lo administrativo"; cada pestaña es un
  `.panel-lateral__seccion` (`role="tabpanel"`, `[hidden]`). Con un error en la pestaña oculta,
  se cambia de pestaña y se enfoca el campo con `afterNextRender`.
- `akine-confirmacion-con-motivo` dentro de un panel lleva `[mostrarTitulo]="false"`: el título
  ya está en la cabecera del panel.
- El `h3.panel__titulo` del formulario viejo se borra: el título del panel lo reemplaza.

## 5. Acciones por fila

Una acción visible (la frecuente, `boton boton--secundario boton--chico`) y el resto en
`app-acciones-de-fila` (menú "⋯"), con las destructivas siempre en el menú. La celda lleva
`class="tabla__acciones"` y el encabezado `<span class="visualmente-oculto">Acciones</span>`.

En los E2E, una acción del menú se usa después de abrirlo:
`fila.getByRole('button', { name: /Más acciones de/ }).click()`.

## 6. Procesos guiados (asistente)

- Pasos **arriba y a todo el ancho**, nunca en una columna lateral para dos o tres pasos.
- Un paso hecho es un botón que vuelve a él; el actual lleva `aria-current="step"`.
- Al cambiar de paso el foco va al título del paso (`h2[tabindex=-1]`).
- Separar **lo obligatorio** (paso 1) de **la configuración inicial opcional** (un paso que se
  puede saltear con "Continuar"), y cerrar con una **confirmación** que resume todo agrupado como
  se cargó.
- Botones: `Continuar →` / `← Anterior` / `Cancelar`, y la acción final con el verbo ("Crear la
  sede").

Aplicado en **Abrir una sede**: Datos de la sede → Configuración inicial (primer box y horario
general lado a lado; datos institucionales plegados) → Confirmación.

## 6 bis. Ayuda "?" flotante (`app-ayuda`)

La pantalla da el `titulo`, el contenido y, si hace falta, `tamano="amplio"`. **No elige el
lado**: el componente lo decide.

- El panel se abre en la **capa superior** del navegador (`popover="manual"`). No lo recorta el
  `overflow` de una tabla, una tarjeta o un panel lateral, y queda encima de un `<dialog>` modal.
  CDK Overlay no sirve acá: cuelga del `body`, que con un panel lateral abierto es inerte y queda
  debajo.
- `posicionFlotante` (`shared/utils`) prueba **derecha → izquierda → abajo → arriba**, se queda
  con el primero donde entra entero, lo corre para dejar 10 px a cada borde (shift) y, si no
  entra en ningún lado, lo acota en alto. El título queda fijo y el texto se desplaza adentro. La
  flecha apunta al "?" aunque el panel se haya corrido.
- Ancho de 340 px (`amplio`: 448), nunca mayor que la ventana menos 20 px. Alto máximo de
  `min(28rem, 70vh)`.
- Se recalcula con el scroll, con el tamaño de la ventana y con el del panel lateral. Si el "?"
  sale de la ventana, se cierra.
- Se cierra con el "?", con la ×, con Escape o con un clic afuera. Escape cierra sólo la ayuda:
  el panel lateral que la contiene sigue abierto.

## 7. Qué no se toca

Servicios, cliente generado y contrato. Nombres accesibles y `id` que usan los E2E, salvo que el
mismo cambio actualice el E2E. Las reglas de `00-plan` §3.2 (el "?") y §3.4 (búsqueda + embudo,
tablas ordenables y paginadas).
