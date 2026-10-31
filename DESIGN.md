---
name: AKINE
description: Gestión clínica, administrativa y económica de centros de kinesiología; una interfaz de mostrador sobria, densa y medida.
colors:
  acento: "#1d5fbf"
  accion-fondo: "#1d5fbf"
  accion-fondo-hover: "#164a96"
  accion-texto: "#ffffff"
  enlace: "#1d5fbf"
  foco: "#1d5fbf"
  acento-claro: "#eaf1fb"
  marca-superficie-activa: "#eaf1fb"
  superficie: "#ffffff"
  superficie-sutil: "#f5f6f8"
  superficie-atenuada: "#f8f9fb"
  superficie-codigo: "#eef1f4"
  texto: "#1f2933"
  texto-fuerte: "#1f2933"
  texto-suave: "#5f6b7a"
  marca-texto-suave: "#3b4754"
  borde: "#e1e5ea"
  borde-sutil: "#eef1f4"
  borde-control: "#808a99"
  deshabilitado: "#6b7684"
  exito: "#1e7b45"
  exito-fondo: "#e6f4ec"
  exito-texto: "#155c33"
  aviso: "#8a5200"
  aviso-fondo: "#fff3e0"
  aviso-texto: "#7a4800"
  peligro: "#a32820"
  peligro-fondo: "#fcebea"
  peligro-texto: "#8e2a2a"
typography:
  headline:
    fontFamily: "Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.3
  title-lg:
    fontFamily: "Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.3
  title:
    fontFamily: "Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  body-md:
    fontFamily: "Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.2
  label-sm:
    fontFamily: "Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.5
  label-xs:
    fontFamily: "Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.5
  caption:
    fontFamily: "Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "'Roboto Mono', ui-monospace, Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  pastilla: "999px"
spacing:
  esp-1: "0.125rem"
  esp-2: "0.25rem"
  esp-3: "0.375rem"
  esp-4: "0.5rem"
  esp-5: "0.75rem"
  esp-6: "1rem"
  esp-7: "1.25rem"
  esp-8: "1.5rem"
  esp-9: "2rem"
components:
  boton:
    backgroundColor: "{colors.accion-fondo}"
    textColor: "{colors.accion-texto}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1.25rem"
    height: "2.5rem"
  boton-hover:
    backgroundColor: "{colors.accion-fondo-hover}"
  boton-deshabilitado:
    backgroundColor: "{colors.deshabilitado}"
    textColor: "{colors.accion-texto}"
  boton-secundario:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.enlace}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1.25rem"
    height: "2.5rem"
  boton-secundario-hover:
    backgroundColor: "{colors.superficie-sutil}"
  boton-chico:
    padding: "0 0.75rem"
    height: "2rem"
  boton-texto:
    backgroundColor: "transparent"
    textColor: "{colors.texto-suave}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: "0 0.5rem"
    height: "2rem"
  campo:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.texto}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.625rem"
    height: "2.5rem"
  filtros-boton:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.texto}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 1rem"
    height: "2.5rem"
  filtros-contador:
    backgroundColor: "{colors.accion-fondo}"
    textColor: "{colors.accion-texto}"
    typography: "{typography.label-xs}"
    rounded: "{rounded.pastilla}"
    height: "1.25rem"
  filtro-rapido-elegido:
    backgroundColor: "{colors.acento-claro}"
    textColor: "{colors.texto-fuerte}"
    typography: "{typography.label}"
    rounded: "{rounded.pastilla}"
    padding: "0.25rem 0.75rem"
    height: "2rem"
  marca-estado-activa:
    backgroundColor: "{colors.exito-fondo}"
    textColor: "{colors.exito-texto}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.pastilla}"
    padding: "0.125rem 0.5rem"
  marca-estado-suspendida:
    backgroundColor: "{colors.aviso-fondo}"
    textColor: "{colors.aviso-texto}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.pastilla}"
    padding: "0.125rem 0.5rem"
  marca-estado-revocada:
    backgroundColor: "{colors.peligro-fondo}"
    textColor: "{colors.peligro-texto}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.pastilla}"
    padding: "0.125rem 0.5rem"
  pestana:
    textColor: "{colors.texto-suave}"
    typography: "{typography.label}"
    padding: "0.375rem 0.75rem"
  pestana-actual:
    textColor: "{colors.texto-fuerte}"
  tabla-encabezado:
    backgroundColor: "{colors.superficie-atenuada}"
    textColor: "{colors.marca-texto-suave}"
    typography: "{typography.label-xs}"
    padding: "0.75rem"
  tabla-celda:
    textColor: "{colors.texto}"
    typography: "{typography.body}"
    padding: "0.75rem"
  tabla-fila-hover:
    backgroundColor: "{colors.superficie-atenuada}"
  tabla-fila-seleccionada:
    backgroundColor: "{colors.acento-claro}"
  paginacion-actual:
    backgroundColor: "{colors.accion-fondo}"
    textColor: "{colors.accion-texto}"
    rounded: "{rounded.md}"
    height: "2rem"
  nav-enlace:
    textColor: "{colors.marca-texto-suave}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 0.75rem"
    height: "2.125rem"
  nav-enlace-actual:
    backgroundColor: "{colors.marca-superficie-activa}"
    textColor: "{colors.acento}"
  ayuda-boton:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.texto-suave}"
    rounded: "{rounded.pastilla}"
    size: "1.5rem"
  tarjeta:
    backgroundColor: "{colors.superficie}"
    rounded: "{rounded.md}"
    padding: "1.25rem 1.5rem"
  alerta-error:
    backgroundColor: "{colors.peligro-fondo}"
    textColor: "{colors.peligro-texto}"
    rounded: "{rounded.md}"
    padding: "0.75rem 1rem"
  alerta-advertencia:
    backgroundColor: "{colors.aviso-fondo}"
    textColor: "{colors.aviso-texto}"
    rounded: "{rounded.md}"
    padding: "0.75rem 1rem"
  alerta-info:
    backgroundColor: "{colors.acento-claro}"
    textColor: "{colors.texto}"
    rounded: "{rounded.md}"
    padding: "0.75rem 1rem"
  alerta-exito:
    backgroundColor: "{colors.exito-fondo}"
    textColor: "{colors.exito-texto}"
    rounded: "{rounded.md}"
    padding: "0.75rem 1rem"
---

# Design System: AKINE

> Escrito en modo scan el 29/10/2026 a partir del código: `src/design-system.css` (capa de tokens y
> primitivas), `src/styles.css`, `src/app/app.css`, `src/app/layout/` y `src/app/shared/components/`.
> Las claves del frontmatter son los tokens de `src/design-system.css` sin el prefijo de grupo:
> `colors.acento` es `--color-acento`, `rounded.md` es `--radio-md`; el espaciado conserva su
> nombre (`spacing.esp-4` es `--esp-4`). El frontmatter lleva el tema claro; el oscuro vive en
> `.impeccable/design.json` (`colorMeta.<token>.dark`).

## Overview

**Creative North Star: "El Mostrador Ordenado"**

AKINE es la pantalla que la recepción de un centro tiene abierta todo el día. El sistema está hecho
para no cansar: un fondo gris frío casi blanco, superficies blancas, texto pizarra y un único azul
que significa "acá se actúa". La densidad es alta y pareja —cuerpo de 14 px, controles de 40 px,
filas de tabla compactas—, porque la misma persona abre las mismas pantallas cientos de veces y
necesita encontrar el dato, no leer la pantalla.

La jerarquía no sale de la decoración sino del lugar: cada pantalla repite la misma anatomía
(cabecera de pantalla, avisos, buscador y embudo, resultado), el título arranca siempre en el mismo
punto y la acción principal está siempre contra el borde derecho de esa fila. Lo que explica se
pliega detrás de un "?"; lo que es dato, estado o advertencia queda a la vista. El color de estado
nunca viaja solo: toda marca lleva su palabra.

La profundidad es tonal. La página se separa de sus superficies por tono y por espacio, y la sombra
queda para lo que flota encima (menús, ayudas, avisos, el panel lateral). La accesibilidad es parte
del material y no un retoque: los bordes de control están calibrados a 3:1, el anillo de foco es
global y el contraste de los dos temas lo mide el CI en un navegador real.

**Key Characteristics:**

- Un solo azul de acción (#1d5fbf) sobre una base de grises fríos; verde, ámbar y rojo solo para estado.
- Roboto en tres pesos (400, 500, 700) y Roboto Mono para códigos, servidas desde el bundle.
- Cuerpo de 14 px, controles de 40 px, radio de 8 px en todo control y contenedor.
- Plano en reposo: profundidad por tono; sombra solo en lo que flota.
- Una cabecera de pantalla única, un buscador más un embudo, tablas ordenables y paginadas.
- Tema claro y oscuro definidos solo con tokens, elegidos por el sistema o por la persona.

## Colors

Una paleta fría y contenida: grises pizarra con un tinte azul apenas perceptible, un azul de acción
saturado y tres colores de estado que nunca se usan como decoración.

### Primary

- **Azul de Acción** (#1d5fbf, `acento`, `accion-fondo`, `enlace`, `foco`): el relleno del botón
  principal, la página actual de la paginación, el contador del embudo, el subrayado de la pestaña
  actual, el texto de la entrada actual de la barra lateral, los enlaces y el anillo de foco. Es el
  mismo azul en cuatro roles en claro, y son cuatro tokens porque en oscuro se separan (ver abajo).
- **Azul Profundo** (#164a96, `accion-fondo-hover`): el relleno del botón principal bajo el puntero
  y el color de un enlace en hover.
- **Celeste de Selección** (#eaf1fb, `acento-claro`, `marca-superficie-activa`): el fondo de la
  entrada actual de la barra lateral, de la fila de tabla cuyo panel lateral está abierto, del filtro
  rápido elegido y de la alerta informativa. Nunca un fondo de página.
- **Blanco de Acción** (#ffffff, `accion-texto`): el texto sobre cualquier relleno de acción.

### Neutral

- **Blanco Papel** (#ffffff, `superficie`): tarjetas, campos, botones secundarios, menús, paneles
  y la barra lateral.
- **Gris Niebla** (#f5f6f8, `superficie-sutil`): el fondo de la página (`body`), el hover de botones
  secundarios y de ítems de menú, y el panel de filtros avanzados.
- **Gris Velado** (#f8f9fb, `superficie-atenuada`): el encabezado de tabla, el hover de fila y la
  fila de un registro dado de baja.
- **Gris Pizarra Claro** (#eef1f4, `superficie-codigo`): el fondo de un código o una ruta en mono.
- **Tinta Pizarra** (#1f2933, `texto`, `texto-fuerte`): el texto corriente y los títulos. En claro
  valen lo mismo; en oscuro el fuerte es más claro que el corriente.
- **Pizarra Media** (#5f6b7a, `texto-suave`): texto secundario, ayudas de campo, conteos,
  resúmenes de pie de tabla e íconos de navegación. Es el token más usado del sistema.
- **Pizarra Oscura** (#3b4754, `marca-texto-suave`): las entradas de la barra lateral y el rótulo de
  los encabezados de tabla.
- **Línea Fría** (#e1e5ea, `borde`) y **Línea Tenue** (#eef1f4, `borde-sutil`): bordes decorativos
  de tarjetas, paneles y separadores; la tenue separa las filas de una tabla.
- **Gris Control** (#808a99, `borde-control`): el contorno de todo control operable (campo, botón del
  embudo, menú de fila, "?", flechas de paginación, filtros rápidos) y el indicador de desborde de
  una tabla. Es la única desviación deliberada del canvas *AKINE · Pantallas*, que usaba #d5dbe2.
- **Gris Inactivo** (#6b7684, `deshabilitado`): el relleno del botón deshabilitado y el texto de un
  ítem deshabilitado.

### Estado

- **Verde Vigente** (#1e7b45 / fondo #e6f4ec / texto #155c33, `exito*`): estado vigente o activo,
  operación exitosa.
- **Ámbar Reversible** (#8a5200 / fondo #fff3e0 / texto #7a4800, `aviso*`): estado suspendido o
  reversible, advertencia, servicio no disponible.
- **Rojo Terminal** (#a32820 / fondo #fcebea / texto #8e2a2a, `peligro*`): estado revocado o
  terminal, error, campo inválido, acción destructiva dentro de un menú.

Cada estado tiene tres tokens: el color fuerte va en bordes e íconos, el fondo tiñe la superficie y
el texto es la versión oscura que llega a AA sobre ese fondo.

### Tema oscuro

El oscuro no es un filtro: redefine los mismos tokens con valores propios (superficie #0f1a26,
página #17242f, texto #e6edf3) en dos bloques idénticos, uno para "sistema" y otro para "oscuro"
elegido en Preferencias (`data-tema` en `<html>`). La inversión es asimétrica a propósito: el relleno
de acción pasa a un azul claro (#4f9ae0) con texto casi negro (#06121c), los enlaces y el foco a
#7fb6ea, y la entrada activa de la barra lateral se separa aclarando (#22313f) en vez de oscurecer.
Los valores completos están en `colorMeta.<token>.dark` del sidecar.

### Named Rules

**La regla de la capa única.** Toda decisión de color vive en el bloque `:root` de
`src/design-system.css` y en ningún otro lado: fuera de ese bloque no hay un solo `#rrggbb` en
`src/`. El modo oscuro redefine solo tokens, nunca una regla de componente.

**La regla del azul que actúa.** El azul de acción marca lo que se puede hacer o dónde se está, y
nada más. Una pantalla tiene un solo botón con relleno azul; el resto va en contorno o como texto.

**La regla del contorno a 3:1.** Lo que se opera lleva `borde-control` (3,2:1 sobre la página, WCAG
1.4.11). `borde` y `borde-sutil` son para separar, nunca para dibujar un control.

## Typography

**Display Font:** no hay voz de display; el título más grande es de 20 px y usa la familia de cuerpo.
**Body Font:** Roboto (con system-ui, -apple-system, 'Segoe UI', sans-serif), servida desde el
bundle con `@fontsource/roboto` en 400, 500 y 700.
**Label/Mono Font:** Roboto Mono (con ui-monospace, Menlo, Consolas, monospace), 400 y 500, solo
para códigos de error, rutas y datos de máquina.

**Character:** una sans neutra de interfaz, legible a 13–14 px y estable en tablas; la jerarquía la
da el peso más que el tamaño. El suavizado de fuente está activado en el `body`.

### Hierarchy

- **Headline** (700, 1.25rem / 20 px, 1.3): el `h1` de la cabecera de pantalla, en una sola línea
  que se corta con "…" (dos líneas en teléfono).
- **Title Large** (700, 1.125rem / 18 px, 1.3): el título del panel lateral y de los asistentes por
  pasos.
- **Title** (500, 1rem / 16 px, -0.01em): el `h2` de una sección o tarjeta.
- **Body Medium** (400, 0.9375rem / 15 px, 1.5): listas de detalle (`dl.detalle`) y el título de un
  panel de ayuda; en 700, el rótulo de la barra superior.
- **Body** (400, 0.875rem / 14 px, 1.5): el cuerpo de toda la aplicación, celdas de tabla y campos.
  La prosa se corta a 90ch.
- **Label** (500, 0.875rem / 14 px): rótulos de campo, botones, pestañas, cabeceras de grupo de la
  navegación.
- **Label Small** (500, 0.8125rem / 13 px): marcas de estado, "Más opciones", botones dentro de una
  fila.
- **Label XS** (500, 0.75rem / 12 px): encabezados de tabla (en caja normal), contador del embudo y
  etiquetas neutras; los títulos de los desplegables de la barra superior van además en mayúsculas
  con 0.04em.
- **Caption** (400, 0.8125rem / 13 px): ayuda de campo y acción terciaria de texto.
- **Mono** (500, 0.8125rem / 13 px): el código de una pantalla de error y una ruta.

### Named Rules

**La regla de los tres pesos.** El bundle carga Roboto en 400, 500 y 700 y nada más. No existe un
600: el navegador lo sintetiza. `--peso-semi` vale 500, igual que `--peso-medio`.

**La regla de las cifras alineadas.** Tablas, paginación y conteos de filtros rápidos usan
`font-variant-numeric: tabular-nums`: un importe se compara con el de arriba sin bailar.

## Layout

**Shell.** Dos columnas en escritorio: la barra lateral (15.5rem) y la página (`minmax(0, 1fr)`,
para que una tabla ancha se desplace dentro de su contenedor y no agrande la columna). Arriba, una
barra superior pegajosa de 3rem con la ruta de navegación a la izquierda y la sede y el perfil a la
derecha. El contenido usa todo el ancho útil, sin columnas centradas, con un margen de 1rem arriba,
1.5rem a los costados y 2rem abajo. Solo las pantallas de acceso se centran: una tarjeta de 25rem
(30rem para elegir contexto) con la marca arriba y el pie abajo.

**Anatomía de pantalla.** Cabecera de pantalla → avisos → filtros → resultado. Las secciones se
separan por espacio y por su título, no por bordes. Los avisos de una operación aparecen arriba a la
derecha, debajo de la barra superior, en una pila de 24rem.

**Formularios.** Todo `form` es una grilla de 12 columnas (separación de 1rem) salvo
`.formulario--libre`. Cada campo pide el ancho de su dato: fecha, hora o número 2 columnas; por
defecto 3; correo 4; texto largo 6; textarea y texto libre 12. La grilla responde al ancho del propio
formulario con container queries: bajo 52rem cada campo duplica su ancho; bajo 30rem va uno por fila.
Las acciones van a la derecha con la principal en el borde, y en un formulario largo dentro de una
tarjeta quedan pegadas al pie mientras se desplaza.

**Ritmo.** La escala va de 2 a 32 px (`esp-1` a `esp-9`). Los pasos que hacen el sistema son 8 px
(`esp-4`, separación entre controles), 12 px (`esp-5`, relleno de celda y separación de bloques
chicos) y 16 px (`esp-6`, relleno de panel y separación de columnas).

**Responsive.** Bajo 64rem (tablet, el objetivo de las pantallas clínicas) la barra lateral sale de
la vista y vuelve como cajón sobre un velo, el botón de menú aparece en la barra superior, los
objetivos táctiles de la navegación suben a 44 px y las columnas secundarias de las tablas se
esconden. Bajo 48rem la cabecera de pantalla baja el contexto a una segunda línea; bajo 40rem los
botones parten su rótulo y los avisos ocupan el ancho; bajo 30rem la cabecera apila título, acciones
y contexto, y las listas de detalle pasan a una columna. A 375 px nada desborda.

### Named Rules

**La regla de los lugares fijos.** El título arranca siempre en el mismo punto, el "?" va pegado a
él y la acción principal contra el borde derecho de la misma fila. Sin acción, ese lugar queda vacío
y nada se corre. Las pantallas hermanas van en pestañas, en una segunda fila dentro de la cabecera.

**La regla del buscador y el embudo.** Arriba de un listado va un solo campo que busca por todo y, a
su lado, el embudo que despliega hacia abajo los filtros avanzados, con el contador de los aplicados.
Un filtro sin el que la pantalla no tiene sentido (el día en la recepción) queda a la vista.

**La regla de la grilla de 12.** Un campo nunca ocupa más de lo que pide su dato: un número no se
estira a 1.100 px.

## Elevation & Depth

Híbrido con predominio tonal. En reposo todo es plano: la página es Gris Niebla, las superficies son
blancas, el encabezado de tabla y el hover de fila bajan a Gris Velado. La sombra aparece solo en lo
que se despega de la página y siempre con desplazamiento y desenfoque suave, en un negro o un azul
pizarra muy transparentes.

### Shadow Vocabulary

- **Filo de tarjeta** (`box-shadow: 0 1px 2px rgb(16 38 63 / 0.05)`): la tarjeta en reposo; apenas
  despega el blanco del gris.
- **Ayuda de campo** (`box-shadow: 0 4px 12px rgb(16 38 63 / 0.12)`): la explicación que flota bajo
  un campo mientras tiene el foco.
- **Capa flotante** (`--sombra-flotante`: `0 8px 24px rgb(0 0 0 / 0.16)`): popovers del menú de fila y de la
  ayuda "?", desplegables de la barra superior y avisos. Un solo token, negro en los dos temas.
- **Panel lateral** (`box-shadow: -8px 0 24px rgb(16 38 63 / 0.14)`): el cajón de detalle o edición
  que entra desde la derecha sobre un velo oscuro.

### Named Rules

**La regla de lo que flota.** La sombra es una respuesta a estar encima de la página, no un adorno:
menús, ayudas, avisos y paneles la llevan; secciones, tablas y filtros no. Una tarjeta dentro de otra
pierde borde, sombra y relleno.

## Shapes

Esquinas suaves y uniformes. **8 px** (`md`) es el radio de todo: botones, campos, tarjetas,
paginación, menú de fila, entradas de navegación y alertas. **6 px** (`sm`) para lo chico dentro de
una línea (la acción de texto, el botón de orden de una columna, el cierre de un aviso, un código).
**10 px** (`lg`) para los paneles que se abren sobre el contenido (ayuda "?", filtros avanzados,
tarjeta de acceso). **La pastilla** (999 px) queda para lo que marca o conmuta: marcas de estado,
etiquetas neutras, el contador del embudo, los filtros rápidos y el botón "?". El círculo, para el
avatar y el punto del grupo que contiene la pantalla actual.

Los bordes son de 1 px; 2 px para el campo inválido y el subrayado de la pestaña actual; 4 px para el
indicador de desborde de una tabla, que pinta su borde lateral mientras queda contenido escondido de
ese lado. El estado vacío se dibuja con borde punteado. El foco es un anillo sólido de 3 px en
`--color-foco`, separado 2 px (1 px en los campos), global para todo elemento operable.

Los íconos son SVG propios en una grilla de 24 px, trazo de 1.8 con puntas redondeadas, en
`currentColor` y a 1.25em del texto que acompañan (`app-icono`).

## Components

### Buttons

Firmes y compactos, con una sola voz fuerte por pantalla.

- **Shape:** esquinas suaves (8 px), alto mínimo de 40 px, rótulo en una línea (en teléfono parte).
- **Primary** (`.boton`): relleno y borde Azul de Acción, texto blanco en Label (14 px, 500),
  relleno de 0.5rem × 1.25rem, separación de 0.5rem con su ícono.
- **Hover / Focus:** el relleno pasa a Azul Profundo en 0.15s; un botón deshabilitado no reacciona al
  puntero. Foco con el anillo global de 3 px.
- **Disabled:** relleno y borde Gris Inactivo, cursor bloqueado; el porqué va escrito al lado.
- **Secondary** (`.boton--secundario`): fondo blanco, borde y texto en `enlace`; hover a Gris Niebla.
- **Chico** (`.boton--chico`): 32 px de alto para la acción principal de una fila o de un pie.
- **Tertiary** (`.boton-texto`): solo texto en Pizarra Media, 13 px, 32 px de alto; subraya en hover.

### Chips

- **Marca de estado** (`.marca-estado`): pastilla con borde del color fuerte, fondo tintado y texto
  oscuro del estado, 13 px en 500. Tres niveles de severidad, no de dominio: `activa` (vigente),
  `suspendida` (reversible), `revocada` (terminal). Siempre con la palabra del estado.
- **Etiqueta neutra** (`.etiqueta`): pastilla de 12 px con contorno Gris Control y texto Pizarra
  Media, al lado de un dato ("Fundador", "Sin fin previsto"); nunca se parte en dos líneas.
- **Filtro rápido** (`app-filtros-rapidos`): pastillas conmutables de 32 px con su conteo; la elegida
  toma borde azul, fondo Celeste de Selección y peso 500, y lo anuncia con `aria-pressed`.

### Cards / Containers

- **Corner Style:** 8 px.
- **Background:** Blanco Papel sobre la página Gris Niebla.
- **Shadow Strategy:** el filo de tarjeta (ver Elevation & Depth).
- **Border:** 1 px Línea Fría.
- **Internal Padding:** 1.25rem × 1.5rem; el `h2` interno en Title, a 1rem del contenido.
- **Uso:** la tarjeta agrupa un formulario o un listado, no cada bloque. Las secciones de una misma
  pantalla se separan por espacio y título; una tarjeta anidada se aplana sola.

### Inputs / Fields

- **Style:** fondo blanco, contorno de 1 px Gris Control, esquinas de 8 px, 40 px de alto, relleno de
  0.5rem × 0.625rem. El rótulo va arriba en Label; "(opcional)" en peso normal y Pizarra Media.
- **Focus:** anillo de 3 px en `--color-foco` separado 1 px.
- **Error:** el borde pasa a Rojo Terminal y a 2 px (`aria-invalid`), y el mensaje va debajo del
  campo, en texto.
- **Ayuda de campo:** la que no cambia lo que se escribe aparece solo con el foco, flotando bajo el
  campo sin atrapar el puntero; la que muestra un dato o una consecuencia queda fija (`.ayuda--fija`).
- **Búsqueda:** el mismo campo con la lupa adentro a la izquierda y 2.5rem de relleno.

### Navigation

- **Barra lateral:** blanca, con borde derecho de 1 px. Marca arriba (cuadrado azul de 28 px con la
  inicial y el nombre en 700). Grupos en acordeón con ícono, nombre y flecha que gira; un punto azul
  marca el grupo plegado que contiene la pantalla actual. Las entradas, de 34 px, van en Pizarra
  Oscura; la actual toma fondo Celeste de Selección, texto azul y peso 500. En tablet es un cajón que
  entra en 0.2s y deja de ser tabulable cerrado.
- **Barra superior:** superficie blanca con filo inferior; ruta de navegación a la izquierda, sede y
  perfil contra la derecha.
- **Pestañas** (`app-pestanas`): una línea de enlaces de 14 px en Pizarra Media sobre una línea base
  de 1 px; la actual en Tinta Pizarra, peso 500 y subrayado azul de 2 px. Hover: texto pleno y
  subrayado gris. Son lugar, no acción: nunca bordeadas como botones.

### Cabecera de pantalla

`app-cabecera-de-pagina`, la misma en toda pantalla con sesión. Una fila de 40 px en grilla —título
con su "?" y sus marcas, contexto (fecha, semana, "Hoy"), hueco, acción principal— y las pestañas en
una segunda fila pegada. El hueco cede primero, después el título se corta con "…" sin bajar de su
mínimo; la cabecera nunca desplaza ni tiene `overflow`. La ficha de persona usa
`app-cabecera-de-ficha`, la misma cabecera con los datos de la persona.

### Barra de filtros

`app-filtros`: el campo de búsqueda (hasta 36rem) y, pegado a su derecha y a la altura del control,
el botón "Filtros" con el embudo, contorno Gris Control y 40 px de alto. Con filtros aplicados lleva
un contador en pastilla azul y el panel llega abierto. El panel avanzado se despliega debajo sobre
Gris Niebla, con radio de 10 px y los campos en fila mientras entren. El conteo de resultados va en la
misma fila, contra el borde derecho.

### Tablas

- **Contenedor:** `.tabla-scroll` desplaza la tabla (nunca la página), usa el alto disponible con el
  encabezado fijo y es enfocable con nombre propio. El desborde horizontal se anuncia con una barra
  de 4 px en el borde lateral del lado escondido.
- **Encabezado:** fondo Gris Velado, rótulo de 12 px en 500 y Pizarra Oscura, sin cortes de línea.
  Las columnas ordenables (`th[appOrdenable]`) llevan un botón del tamaño del rótulo con el ícono de
  orden tenue, pleno cuando la columna está ordenada.
- **Filas:** celdas de 14 px con relleno de 12 px y separación de 1 px Línea Tenue; hover en Gris
  Velado; la fila con panel abierto en Celeste de Selección; la dada de baja atenuada pero presente.
- **Acciones:** una visible por fila (botón chico) y el resto en el menú "⋯" (`app-acciones-de-fila`):
  un botón cuadrado de 32 px con contorno de control que abre un popover de 12rem con ítems de 32 px;
  lo destructivo va adentro, en texto de peligro y con confirmación.
- **Pie:** "Mostrando 1–10 de 87 · Filas por página · ‹ 1 2 3 … 9 ›" en 14 px Pizarra Media; la
  página actual con relleno azul, las flechas con contorno de control, 10 filas por defecto.
- **Vacío:** `app-estado-vacio` en lugar de la tabla, centrado, con borde punteado, una frase y la
  acción que lo resuelve.

### Ayuda contextual "?"

`app-ayuda`: un botón redondo de 24 px con contorno de control y el ícono de ayuda, pegado al título
al que pertenece. Abre un popover de 21.25rem (28rem el amplio) en la capa superior, con la capa
flotante, radio de 10 px, título en 15 px y una flecha que apunta al "?". Lo que no entra se desplaza
dentro del cuerpo con el título fijo.

**La regla del "?".** Lo que explica —qué es la pantalla, cómo funciona el modelo, por qué existe una
sección— va detrás del "?". Nunca van ahí los datos, el estado de la pantalla, las advertencias de
una acción irreversible ni la instrucción de un paso obligatorio. Una ayuda nunca contiene acciones.

### Alertas y avisos

- **Alerta en el lugar** (`app-alerta`): fondo tintado del estado, borde de 1 px del color del estado
  (Línea Fría en la informativa), ícono del estado a 18 px, título en 500 y acciones chicas debajo.
- **Aviso global** (`app-avisos`): superficie blanca con borde fino, ícono del color del estado,
  capa flotante, entrada de 6 px hacia abajo en 0.18s y cierre propio; sin animación si la persona
  pidió movimiento reducido.

### Panel lateral

`app-panel-lateral`: un `<dialog>` de 34rem (46rem el amplio) que entra desde la derecha a todo el
alto, con cabecera separada por una línea, título en Title Large y el formulario con su pie de
acciones fijo. La fila de la tabla que lo abrió queda marcada.

## Do's and Don'ts

### Do:

- **Do** consumí solo `var(--...)` de `src/design-system.css`; un color nuevo es un token nuevo en
  `:root` y en los dos bloques del tema oscuro.
- **Do** abrí toda pantalla con sesión con `app-cabecera-de-pagina`: título, "?", marcas, contexto,
  una acción principal contra el borde derecho y las pestañas en la segunda fila.
- **Do** poné la explicación detrás de un "?" (`app-ayuda`) y dejá a la vista los datos, el estado,
  las advertencias irreversibles y las instrucciones de un paso obligatorio.
- **Do** armá los listados con un buscador que busca por todo, el embudo `app-filtros` con su
  contador y una tabla con `tablaLocal` + `th[appOrdenable]` y el pie con total y paginación.
- **Do** declará el ancho de cada campo en la grilla de 12 según su dato (fecha, hora o número 2;
  texto corto 3; correo 4; texto libre 12).
- **Do** decí el estado con texto además de color: la marca con su palabra, la pestaña actual con
  subrayado y peso, el campo inválido con borde de 2 px y mensaje.
- **Do** usá los íconos de `app-icono` (SVG de 24 px, trazo 1.8, `currentColor`); uno nuevo es un
  `@case` más.
- **Do** respetá el anillo de foco global (3 px `--color-foco`, separado 2 px) y los objetivos
  táctiles: 24 px para un enlace suelto, 44 px en la navegación de tablet.

### Don't:

- **Don't** escribas un `#rrggbb` fuera del bloque de tokens ni repitas una regla de componente en el
  bloque del tema oscuro.
- **Don't** pongas más de una acción con relleno azul en una pantalla: las demás van en contorno
  (`.boton--secundario`) o como texto (`.boton-texto`).
- **Don't** metas botones ni enlaces que hagan algo dentro de una ayuda "?".
- **Don't** armes una cabecera propia con `div.titulo-con-ayuda` + `h1`, ni pongas migas o un
  "Volver a…" arriba del título.
- **Don't** ordenes en el cliente la página visible de una lista paginada por el servidor.
- **Don't** envuelvas cada bloque en `.tarjeta`: las secciones se separan por espacio y título.
- **Don't** uses un peso 600 ni otra familia: Roboto 400, 500 y 700 y Roboto Mono son lo único que
  carga el bundle.
- **Don't** le pongas `overflow` ni `max-height` a la cabecera de pantalla ni a las pestañas: dibuja
  una barra de desplazamiento en cada pantalla.
- **Don't** dibujes un control con `--color-borde` (#e1e5ea): un control lleva `--color-borde-control`.
