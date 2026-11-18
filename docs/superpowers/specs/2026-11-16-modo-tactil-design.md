# Modo táctil: cargar con el dedo — diseño

Fecha: 16/11/2026 · Rama: `akine-web-estetica-3` (sin commit hasta que el usuario lo pida) · Sólo frontend.

## Por qué

El profesional carga en una **tablet**, al lado de la camilla, con el dedo. Escribir con el teclado en
pantalla es lento y molesto. Admin y secretaria usan **escritorio** (mouse y teclado). El usuario quiere
AKINE "simple, claro, fácil de usar, compacto y sin scroll", y que **siempre** se pueda cargar de forma
simple: elegir en vez de escribir, y escribir sólo lo puntual.

Decisión del usuario: **una sola pantalla que se adapta** (no pantallas aparte para la tablet).

## Objetivos

1. Toda pantalla del profesional se usa cómodamente con el dedo en una tablet apaisada de 1024×768.
2. Lo común se carga **eligiendo**: chips, botones, escalas y +/−. El texto libre es siempre
   **opcional** y nunca bloquea guardar ni cerrar.
3. **Sin scroll de página** en 1024×768 apaisado en las pantallas del profesional. Lo largo se parte en
   pestañas.
4. La misma pantalla, con mouse, queda compacta como hoy.

## No objetivos

- Pantallas o rutas separadas para la tablet.
- Cambios de backend, contrato o reglas de negocio.
- Paleta, letra o identidad nueva (rebranding visual): es otra etapa, después.
- Rehacer las pantallas de escritorio de admin y secretaria (caja, cobros, padrón, presentaciones):
  heredan los componentes nuevos pero no se rediseñan en esta etapa.
- Reconocimiento de voz propio. Para dictar se usa el micrófono del teclado de la tablet.
- Tablet vertical sin scroll: en vertical funciona, pero puede tener scroll.

## Antiobjetivos (si pasa, falló aunque "funcione")

- Un campo de texto obligatorio en el recorrido del profesional.
- Un control tocable de menos de 44×44 px en modo táctil.
- Algo que sólo se ve o se activa con `:hover` (en la tablet no hay hover).
- Un `<select>` nativo para elegir entre 7 opciones o menos.
- Que el modo mouse se vuelva "grande y espaciado": el escritorio sigue denso.

## Cómo se adapta

**Detección:** CSS `@media (pointer: coarse)`. El navegador sabe si el puntero principal es un dedo. No
hay que elegir nada ni depender del rol.

**Forzado para probar:** el mismo bloque de tokens se aplica también con `:root[data-puntero='tactil']`.
Sirve para verificar en el navegador de escritorio, porque redimensionar la ventana no emula el dedo.
Llave de prueba, sin UI para el usuario. Que haya o no un interruptor visible queda a criterio del
constructor; no es necesario.

**Tokens** (en `src/design-system.css`, sobre `:root`, dentro del bloque táctil):

| Token | Mouse (hoy) | Táctil |
|---|---|---|
| `--alto-control` | 2.5rem | **3rem** (48 px) |
| `--alto-control-chico` | 2rem | **2.75rem** (44 px) |
| `--alto-tocable` (nuevo) | 2rem | **3rem**: mínimo de chips, botones de escala y +/− |
| `--hueco-tocable` (nuevo) | `var(--esp-3)` | `var(--esp-5)`: separación entre controles vecinos |

La letra **no** cambia. El modo táctil agranda las zonas tocables y los huecos, no el texto.

## Componentes compartidos nuevos (`src/app/shared/components/`)

Todos son `ControlValueAccessor` (se usan con `formControl` o `[value]`/`(cambio)`), `OnPush`, sólo con
tokens, accesibles con teclado (flechas en los grupos) y con lector de pantalla (`aria-pressed` o radios
nativos). Se generalizan los patrones que ya existen en la pantalla de atención (`.chip`, `.escala`,
`.segmentado`), sin inventar otro aspecto.

1. **`app-chips`**: elección única o múltiple (`multiple`) entre opciones `{valor, etiqueta}`. Opcional:
   `permitirOtra`, que agrega un chip "Otra…" que abre un campo de texto corto. Volver a tocar el chip
   elegido lo desmarca cuando `deseleccionable`.
2. **`app-escala`**: fila de 0 a N (por defecto 0–10) con colores bajo, medio y alto. Generaliza
   `.escala` de atención.
3. **`app-numero-con-pasos`**: campo numérico con botones − y + (`paso`, `min`, `max`, `decimales`).
   Usa `inputmode="decimal"` (teclado numérico) y acepta coma o punto. Si queda vacío, no tiene valor.
   Mantener apretado el botón repite el paso; el constructor decide la velocidad.
4. **`app-segmentado`**: dos a cuatro opciones excluyentes en una barra (por ejemplo, Asistencia o
   "Sesión rápida / Evaluación completa"). Reemplaza `.segmentado` suelto.
5. **`app-texto-opcional`**: input o textarea corto con la etiqueta "(opcional)", `enterkeyhint="done"` y
   `autocapitalize="sentences"`. Debajo, en táctil, una pista discreta: "Podés dictar con el micrófono del
   teclado". Nunca es `required`.

**Regla para elegir control:**
- 2 a 4 opciones excluyentes → `app-segmentado`.
- Hasta 7 opciones → `app-chips`.
- Más de 7, o un catálogo que crece → `app-buscador-con-alta` (existente). Los enums fijos del cliente
  generado (tolerancia, conducta, actividad, lateralidad, evolución) son listas cerradas: van con chips.

## Pantallas de esta etapa (las del profesional)

### 1. Agenda del profesional — "Mi día"

La vista de agenda que abre el profesional muestra sus turnos de hoy como **filas grandes tocables**:
hora, paciente, servicio y estado. Tocar la fila abre la atención. Las acciones de la fila (atender,
ausente) son botones visibles; en táctil **no** van detrás del menú "⋯". Cambiar de día con "‹ Hoy ›".

Qué componente de agenda es hoy la entrada del profesional (`agenda`, `recepcion-del-dia`) lo confirma
el constructor leyendo la navegación por rol. Se toca esa, sin crear una pantalla nueva.

### 2. Atención (`features/clinical/pages/atencion`)

Hoy es una página larga, con scroll, de tarjetas apiladas. Pasa a:

- **Cabecera fija:** paciente, hora, caso y el botón **Cerrar ▸** siempre a la vista.
- **Pestañas** (`app-pestanas`): **Evaluación · Mediciones · Tratamiento · Notas · Cierre**. Las
  pestañas también se usan con mouse: es la misma pantalla, y así el escritorio tampoco hace scroll. Una
  pestaña con datos cargados muestra un punto.
- **Evaluación:** dolor con `app-escala`; zona con `app-chips multiple permitirOtra` (ya son chips);
  lado y evolución con `app-chips`. Objetivo, motivo clínico y limitación funcional pasan a
  `app-texto-opcional`. La elección "Sesión rápida / Evaluación completa" queda con `app-segmentado`.
- **Mediciones** (`mediciones-de-sesion`, hoy 5 campos de texto o select): los valores numéricos van
  con `app-numero-con-pasos` y las opciones cerradas con chips.
- **Tratamiento** (`tratamientos-de-sesion`, hoy 13 campos): los parámetros numéricos (series,
  repeticiones, minutos, intensidad) con `app-numero-con-pasos`; las opciones cerradas con chips. Lo
  libre queda como texto opcional.
- **Notas:** `app-texto-opcional` en versión textarea, que ocupa la pestaña.
- **Cierre:** asistencia con `app-segmentado`; tolerancia y conducta (hoy `<select>`) con `app-chips`;
  respuesta, indicaciones y nota de cierre con texto opcional. Lo irreversible sigue arriba del botón que
  lo dispara.
- **Guardado:** se mantiene el comportamiento actual (qué guarda cada botón y cuándo). Cambiar de
  pestaña **no** pierde lo cargado: el estado vive en la página, no en la pestaña.

### 3. Ficha de ingreso (`features/clinical/components/ficha-de-ingreso`)

- Peso y altura con `app-numero-con-pasos`: peso con paso 0,5 kg y rango 1–400; altura con paso 1 cm y
  rango 30–250. Son los mismos rangos que los CHECK de V20.
- Actividad física (`<select>` hoy) con `app-chips`.
- "¿Cuál?" con `app-texto-opcional`.
- Las enfermedades siguen como tildes, con zona tocable de `--alto-tocable`.
- Se mantienen la cola de guardado y las reglas de sincronización actuales.

### 4. Historia clínica y Datos declarados (alta de antecedente)

- Tipo de antecedente con `app-chips`.
- Cirugía:
  - zona con `app-chips permitirOtra` (lista corta de zonas del cuerpo, la misma de atención);
  - año con `app-numero-con-pasos` (sin decimales, máximo el año actual, arranca vacío);
  - lugar con texto opcional.
- Descripción con texto opcional cuando el tipo lo admita. Las reglas de validación del backend no
  cambian.

## Restricciones

- Angular 22, componentes `OnPush`, sólo tokens de `design-system.css` y `DESIGN.md` (WCAG AA en claro y
  oscuro).
- Presupuesto del bundle inicial: error a 448 kB. Los componentes nuevos se cargan con las pantallas
  clínicas (lazy), no en el bundle inicial.
- Pocos tests y sin TDD (preferencia del usuario). Un spec corto por componente compartido, para el valor
  que emite y para el teclado. Los specs existentes que rompa el cambio se ajustan.
- Verificar en `localhost:4200` con `data-puntero='tactil'` a 1024×768, más un vistazo con mouse a
  1440×900 y a 375 px.
- Sin commit, push ni PR hasta que el usuario lo pida.

## Enfoques considerados

- **A. Modo profesional aparte** (pantallas propias para la tablet). Descartado por el usuario:
  duplicaba pantallas.
- **B. Las mismas pantallas, adaptables. Elegido.** Sin duplicar. Se resuelve con componentes que
  sirven igual con mouse y dedo, y con tokens que sólo agrandan zonas tocables.
- **C. Primero el rebranding visual de toda la app.** Postergado: no ataca el dolor real, que es
  escribir en la tablet.

## Decisiones tomadas tras la revisión (a criterio del diseñador, corregibles)

1. **Pestañas internas:** `app-pestanas` navega por rutas y no sirve para esto. Se crea un componente
   nuevo, `app-pestanas-internas`, con el patrón `role="tablist"` / `tab` / `tabpanel`, el estado en un
   signal de la página, flechas para moverse y un punto en la pestaña con datos. No crea rutas hijas: el
   botón Atrás sale de la atención, no cambia de pestaña.
2. **Estados de la atención:**
   - La elección de caso, los paneles de error y el de conflicto van **antes** de las pestañas, que
     aparecen cuando la atención está lista para cargar.
   - La atención cerrada muestra las mismas cinco pestañas en sólo lectura, sin "Cierre" editable.
   - "Sesión rápida / Evaluación completa" sigue decidiendo cuánto se ve **dentro** de Evaluación. Las
     cinco pestañas existen en los dos modos.
   - Cada botón de guardar queda en su pestaña.
   - La atención grupal queda fuera de esta etapa.
   - Es una reestructuración de la plantilla, no un retoque.
3. **Sin scroll:** la **página** no scrollea en 1024×768. El contenido de una pestaña puede scrollear
   por dentro cuando hay N mediciones o tratamientos. La cabecera de la atención va debajo de la barra
   superior de la app.
4. **Opcional:** se marca opcional y se le quita el validador del cliente sólo a lo que el backend ya
   acepta vacío. Lo que el backend exige no cambia en esta etapa: queda como está, con el control táctil
   que le corresponda, y se anota en el registro para decidir aparte.
5. **Mi día:** la entrada del profesional es `features/scheduling/pages/agenda` (ruta `/agenda`,
   alcance propio por rol desde el 04/11). Se agranda esa vista en táctil, sin pantalla nueva. Las
   acciones de la fila son las transiciones y los permisos que ya existen; no se agrega ninguna.
6. **Alcance de los tokens:** en táctil, `--alto-control` sube en toda la app, así que caja o padrón
   también agrandan sus controles **si se abren en una tablet**. En escritorio no cambia nada.
7. **Bundle:** al CSS global sólo van los tokens del bloque táctil (unas pocas líneas). Los estilos de
   los componentes nuevos viajan con sus pantallas, que son lazy. Si el bundle inicial pasa de 448 kB, se
   mueve CSS global no crítico; no se sube el tope.

## Lo que decide el constructor

- Velocidad de repetición del +/− y si el campo numérico acepta el gesto de arrastrar.
- La lista exacta de zonas del cuerpo compartida entre atención y antecedentes (partir de la de
  atención).
- Nombres internos, archivos y cómo reparte los specs.
- Cómo se marca una pestaña "con datos".
