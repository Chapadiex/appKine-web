# Modo táctil — plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: superpowers:executing-plans (o subagent-driven-development). Pasos con `- [ ]`.

**Goal:** que el profesional cargue con el dedo en una tablet apaisada (1024×768) sin escribir lo común y
sin scroll de página, en las mismas pantallas que ya usa con mouse.

**Architecture:** tokens táctiles activados por `@media (pointer: coarse)` o `:root[data-puntero='tactil']`;
seis componentes compartidos de entrada (chips, escala, segmentado, número con pasos, texto opcional,
pestañas internas); y la adopción de esos componentes en ficha de ingreso, atención (reestructurada en
pestañas), mediciones, tratamientos, alta de antecedente y agenda.

**Tech Stack:** Angular 22 zoneless/OnPush, signals (`model()`), Vitest (`ng test`), tokens de
`src/design-system.css`.

**Spec:** `docs/superpowers/specs/2026-11-16-modo-tactil-design.md`

## Global Constraints

- Rama `akine-web-estetica-3`. **Sin commit, push ni PR** hasta que el usuario lo pida: los pasos de commit
  de la plantilla se reemplazan por "dejar sin commitear".
- Sólo frontend: no se tocan backend, contrato ni cliente generado.
- Sólo tokens de `design-system.css`; ningún `#hex` fuera de ese archivo. WCAG AA en claro y oscuro.
- Modo táctil: control tocable ≥ 44×44 px; nada que dependa de `:hover`; ningún `<select>` nativo para
  ≤ 7 opciones en las pantallas tocadas.
- Modo mouse (`pointer: fine`, sin `data-puntero`): `--alto-control` sigue en 2.5rem; la densidad de hoy no
  cambia.
- Texto libre del recorrido del profesional: opcional. Validadores del cliente se quitan sólo donde el
  backend ya acepta vacío; lo que el backend exige queda como está y se anota en el ledger.
- Bundle inicial ≤ 448 kB (hoy ~446). Al CSS global van sólo los tokens; el CSS de componentes viaja lazy.
- Pocos tests: un spec corto por componente compartido; los specs existentes que rompa el cambio se
  ajustan. Comando de una carpeta:
  `npx ng test --watch=false --no-coverage --include "src/app/<carpeta>/**/*.spec.ts"`.
- Hay ~54 specs de `features/clinical` que ya fallaban antes de este trabajo (tanda estética previa). No
  son de este plan: se registra el conteo antes y después y no se suma ninguno nuevo.
- Verificación en `localhost:4200` (config `akine-web-dev`, backend `akine-api-qa` en 8080) con
  `document.documentElement.dataset.puntero = 'tactil'` a 1024×768, más mouse a 1440×900 y 375 px, en los
  dos temas.

## Review Focus

1. Cambiar de pestaña en la atención con texto escrito y sin guardar → lo escrito sigue al volver (el
   estado vive en la página). Test en Task 5.
2. `app-numero-con-pasos` con "72,5", "72.5", texto no numérico, vacío y valores fuera de rango → acepta
   coma y punto, no emite valor para texto inválido, el +/− respeta min/max. Test en Task 3.
3. Toques rápidos de +/− en peso de la ficha → un solo guardado por ráfaga (confirmación con espera),
   sin 409. Test en Task 3 (`confirmado` con espera) y verificación en Task 4.
4. Atención cerrada → las cinco pestañas en sólo lectura, sin controles habilitados. Verificación en
   Task 5.
5. Chip elegido en tema oscuro y con foco → se distingue por algo más que color (borde/tilde) y el foco
   se ve. Verificación en Task 9.

---

### Task 1: Tokens táctiles

**Files:**
- Modify: `src/design-system.css` (bloque de tokens de `:root`, ~líneas 200–260)

**Interfaces:**
- Produces: tokens `--alto-tocable`, `--hueco-tocable` (nuevos) y el bloque táctil que redefine
  `--alto-control` 3rem, `--alto-control-chico` 2.75rem, `--alto-tocable` 3rem, `--hueco-tocable`
  `var(--esp-5)`. Valores en mouse: `--alto-tocable` 2rem, `--hueco-tocable` `var(--esp-3)`.

- [ ] **Step 1:** Agregar los dos tokens nuevos a `:root` con los valores de mouse.
- [ ] **Step 2:** Agregar el bloque táctil con el mismo contenido bajo `@media (pointer: coarse) { :root {…} }`
  y bajo `:root[data-puntero='tactil'] {…}`.
- [ ] **Step 3: Verificar** en 4200 con la herramienta JS del navegador:
  `getComputedStyle(document.documentElement).getPropertyValue('--alto-control')`.
  Expected: `2.5rem` sin atributo; `3rem` tras `dataset.puntero='tactil'`.
- [ ] **Step 4:** `npm run build`. Expected: bundle inicial < 448 kB.

### Task 2: Componentes de elección — `app-chips`, `app-segmentado`, `app-escala`

**Files:**
- Create: `src/app/shared/components/chips/chips.{ts,css,spec.ts}`
- Create: `src/app/shared/components/segmentado/segmentado.{ts,css,spec.ts}`
- Create: `src/app/shared/components/escala/escala.{ts,css,spec.ts}`
- Reference (aspecto a generalizar): `.chip`, `.escala`, `.segmentado` en `src/app/features/clinical/atencion.css`

**Interfaces:**
- Produces:
  - `export interface OpcionChip { readonly valor: string; readonly etiqueta: string; readonly tono?: 'mejor' | 'igual' | 'peor' | 'neutro'; }` (en `chips.ts`)
  - `app-chips`: `opciones = input.required<readonly OpcionChip[]>()`, `etiqueta = input.required<string>()`
    (aria-label del grupo), `multiple = input(false)`, `deseleccionable = input(true)`,
    `deshabilitado = input(false)`, `permitirOtra = input(false)`, `textoOtra = model('')`,
    `valor = model<string | readonly string[] | null>(null)`. Botones con `aria-pressed`; flechas
    izquierda/derecha mueven el foco dentro del grupo (roving tabindex). "Otra…" es un input corto al
    final, `textoOtra` se actualiza en `change`. Implementa `ControlValueAccessor` además de `model`.
  - `app-segmentado`: `opciones = input.required<readonly OpcionChip[]>()`, `etiqueta = input.required<string>()`,
    `deshabilitado = input(false)`, `valor = model<string | null>(null)`. Radios nativos en `fieldset`
    (un `name` único por instancia). CVA.
  - `app-escala`: `desde = input(0)`, `hasta = input(10)`, `etiqueta = input.required<string>()`,
    `deshabilitado = input(false)`, `valor = model<number | null>(null)`. Tocar el valor elegido lo deja en
    `null`. Clases de tono bajo (≤3), medio (4–6), alto (≥7) como hoy; `aria-label` "N de 10".
  - Todos: altura mínima `var(--alto-tocable)`, separación `var(--hueco-tocable)`, `OnPush`.

- [ ] **Step 1: Specs** (uno por componente, cortos):
  - `chips.spec.ts`: `elegir_unico_emiteValor` (click en "B" → `valor()` = `'B'`);
    `deseleccionable_vuelveANull` (click dos veces → `null`); `multiple_acumula` (A y C → `['A','C']`);
    `flechaDerecha_mueveFoco`.
  - `segmentado.spec.ts`: `elegir_emiteValor`.
  - `escala.spec.ts`: `tocar7_emite7`; `tocarElegido_null`; `once_botones_de_0_a_10`.
- [ ] **Step 2:** Correr los tres specs → FAIL (no existen).
- [ ] **Step 3:** Implementar los tres componentes con las interfaces de arriba.
- [ ] **Step 4:** `npx ng test --watch=false --no-coverage --include "src/app/shared/components/{chips,segmentado,escala}/**/*.spec.ts"` → PASS.

### Task 3: Componentes de entrada — `app-numero-con-pasos`, `app-texto-opcional`

**Files:**
- Create: `src/app/shared/components/numero-con-pasos/numero-con-pasos.{ts,css,spec.ts}`
- Create: `src/app/shared/components/texto-opcional/texto-opcional.{ts,css,spec.ts}`

**Interfaces:**
- Produces:
  - `app-numero-con-pasos`: `idCampo = input.required<string>()`, `etiqueta = input.required<string>()`,
    `paso = input(1)`, `min = input<number | null>(null)`, `max = input<number | null>(null)`,
    `decimales = input(0)`, `deshabilitado = input(false)`, `valor = model<number | null>(null)`,
    `confirmado = output<number | null>()`, `invalido = output<boolean>()`. Input con
    `inputmode="decimal"` (o `numeric` si `decimales === 0`), acepta coma o punto, muestra con coma.
    Texto no numérico → no cambia `valor`, marca `aria-invalid` y emite `invalido(true)`. Vacío → `null`.
    − y + parten de `min` (o 0) si `valor` es `null`, quedan dentro de `[min, max]` y se deshabilitan en el
    borde. `confirmado` sale en el blur del input y **700 ms después del último toque** de −/+ (una ráfaga =
    una confirmación). Mantener apretado repite: el ritmo lo decide el implementador. CVA.
  - `app-texto-opcional`: `idCampo = input.required<string>()`, `etiqueta = input.required<string>()`,
    `multilinea = input(false)`, `filas = input(3)`, `maxlength = input(500)`, `placeholder = input('')`,
    `deshabilitado = input(false)`, `valor = model('')`, `confirmado = output<string>()` (en blur). La
    etiqueta muestra "(opcional)" con `.campo__opcional`. `enterkeyhint="done"`, `autocapitalize="sentences"`.
    Pista "Podés dictar con el micrófono del teclado" visible sólo en modo táctil (media query o
    `:root[data-puntero='tactil']`). Nunca `required`. CVA.

- [ ] **Step 1: Specs**:
  - `numero-con-pasos.spec.ts`: `coma_y_punto_iguales` ("72,5" y "72.5" → `72.5`); `texto_invalido_no_cambia_valor`
    (valor 70, escribe "70 kg" → `valor()` sigue 70 y `aria-invalid="true"`); `vacio_es_null`;
    `mas_respeta_max` (valor 400, max 400 → + deshabilitado); `rafaga_una_confirmacion` (con
    `vi.useFakeTimers()`: tres toques de + → `confirmado` emitido una vez tras 700 ms, con el valor final).
  - `texto-opcional.spec.ts`: `etiqueta_dice_opcional`; `blur_confirma_valor`.
- [ ] **Step 2:** Correr → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npx ng test --watch=false --no-coverage --include "src/app/shared/components/{numero-con-pasos,texto-opcional}/**/*.spec.ts"` → PASS.

### Task 4: Ficha de ingreso táctil

**Files:**
- Modify: `src/app/features/clinical/components/ficha-de-ingreso/ficha-de-ingreso.{ts,html,css}`

**Interfaces:**
- Consumes: `app-numero-con-pasos`, `app-chips`, `app-texto-opcional` (Tasks 2–3).
- Produces: sin cambios en inputs/outputs públicos del componente (`guardar`, `tildar`, `revisar`,
  `agregarOcupacion`, `guardarOcupacion()`, `fallo()`).

- [ ] **Step 1:** Peso → `app-numero-con-pasos` (`paso` 0.5, `decimales` 1, `min` 1, `max` 400); altura →
  (`paso` 1, `min` 30, `max` 250). Los signals `peso`/`altura` pasan a `number | null`; `confirmado` llama a
  `salirDeCampo()`. `numeroInvalido` se alimenta de `invalido`. La cola, `sincronizar` (comparando números)
  y el no pisar lo que se edita se mantienen.
- [ ] **Step 2:** Actividad → `app-chips` (opciones de `actividades`, `deseleccionable`), confirmando al
  cambiar. "¿Cuál?" → `app-texto-opcional` con `confirmado` → `salirDeCampo()`.
- [ ] **Step 3:** Tildes de enfermedad con alto mínimo `var(--alto-tocable)`.
- [ ] **Step 4:** Ajustar specs que lo usen (`datos-declarados-page.spec.ts`, `historia-clinica-page.spec.ts`)
  y correr `npx ng test --watch=false --no-coverage --include "src/app/features/clinical/{components/ficha-de-ingreso,pages/datos-declarados}/**/*.spec.ts"`.
  Expected: sin fallas nuevas respecto del conteo previo.
- [ ] **Step 5: Verificar en 4200** (Datos declarados de una persona QA, modo táctil): tres + seguidos en
  peso → un solo PUT en red y el valor final persistido; IMC se actualiza.

### Task 5: Atención en pestañas — `app-pestanas-internas` + Evaluación, Notas y Cierre

**Files:**
- Create: `src/app/shared/components/pestanas-internas/pestanas-internas.{ts,css,spec.ts}`
- Modify: `src/app/features/clinical/pages/atencion/atencion-page.{ts,html}`, `src/app/features/clinical/atencion.css`
- Test: `src/app/features/clinical/pages/atencion/atencion-page.spec.ts`

**Interfaces:**
- Produces:
  - `export interface PestanaInterna { readonly id: string; readonly etiqueta: string; readonly conDatos?: boolean; }`
  - `app-pestanas-internas`: `pestanas = input.required<readonly PestanaInterna[]>()`,
    `etiqueta = input.required<string>()`, `activa = model.required<string>()`. Renderiza el `tablist`; ids
    `pestana-{id}` (tab) y `panel-{id}` (lo usa la página en su `role="tabpanel"`). Flechas y Home/End
    mueven y activan. Punto con texto oculto "con datos" cuando `conDatos`.
  - Atención: `pestanaActiva = signal<'evaluacion' | 'mediciones' | 'tratamiento' | 'notas' | 'cierre'>('evaluacion')`.

- [ ] **Step 1: Specs**: `pestanas-internas.spec.ts` → `click_activa`, `flecha_derecha_activa_siguiente`,
  `aria_selected_y_controls`. En `atencion-page.spec.ts` agregar
  `cambiar_de_pestana_conserva_lo_escrito`: escribir objetivo en Evaluación, ir a Notas, volver → el input
  tiene el texto.
- [ ] **Step 2:** Correr → FAIL.
- [ ] **Step 3:** Implementar `app-pestanas-internas`.
- [ ] **Step 4:** Reestructurar la plantilla de atención:
  - Caso, error y conflicto quedan arriba y antes de las pestañas.
  - Cabecera fija con paciente, hora, caso y **Cerrar ▸**. Va debajo de la barra superior y lleva a la
    pestaña Cierre.
  - Cinco paneles, con la misma lógica de hoy:
    - Evaluación: `app-escala`; zona con `app-chips multiple permitirOtra` ligado a `zonasElegidas`/`otraZona`;
      lado y evolución con `app-chips` (evolución con `tono`); objetivo, motivo y limitación con
      `app-texto-opcional`; modo con `app-segmentado`.
    - Mediciones y Tratamiento: los componentes existentes, sin cambios todavía.
    - Notas: `app-texto-opcional multilinea`.
    - Cierre: asistencia con `app-segmentado`; tolerancia y conducta con `app-chips`; respuesta,
      indicaciones y nota con `app-texto-opcional`.
  - `conDatos` de cada pestaña sale de los signals que ya existen.
  - La página no scrollea a 1024×768: el panel activo usa `overflow-y: auto` dentro de un alto disponible.
- [ ] **Step 5:** Atención cerrada: mismas pestañas con los bloques en sólo lectura (lo que hoy muestra
  "Lo que quedó registrado" repartido por pestaña); la pestaña Cierre muestra el registro, sin botón.
- [ ] **Step 6:** Opcionales: revisar validadores del cliente en Evaluación/Cierre; quitar los que el backend
  no exige (mirar los `required` del cliente generado `CerrarSesionRequest`/`RegistrarEvaluacion…`);
  anotar en el ledger los que quedan.
- [ ] **Step 7:** `npx ng test --watch=false --no-coverage --include "src/app/{shared/components/pestanas-internas,features/clinical/pages/atencion}/**/*.spec.ts"`
  → specs nuevos PASS; sin fallas nuevas en atención respecto del conteo previo.
- [ ] **Step 8: Verificar en 4200** como profesional QA, modo táctil, 1024×768: abrir una atención, cargar
  dolor/evolución/nota/cierre sin scroll de página (`document.scrollingElement.scrollHeight <= innerHeight`);
  abrir una cerrada y confirmar que no hay controles habilitados.

### Task 6: Mediciones y tratamientos táctiles

**Files:**
- Modify: `src/app/features/clinical/components/mediciones-de-sesion/mediciones-de-sesion.{ts,html,css}`
- Modify: `src/app/features/clinical/components/tratamientos-de-sesion/tratamientos-de-sesion.{ts,html,css}`

**Interfaces:**
- Consumes: Tasks 2–3.

- [ ] **Step 1: Mediciones.**
  - "Medida": hasta 7 definiciones → `app-chips`; con más, se queda el select. Es un catálogo que crece
    (regla de la spec).
  - Lado → `app-chips`.
  - Valor numérico → `app-numero-con-pasos`, con `min`/`max` de la definición y `decimales` según
    la definición. `Enter`/confirmar sigue registrando.
  - Resultado booleano → `app-segmentado`.
  - Hallazgo y nota → `app-texto-opcional`.
- [ ] **Step 2: Tratamientos.**
  - Lado → `app-chips`.
  - Minutos → `app-numero-con-pasos` (`paso` 5, `min` 1, `max` 240).
  - Parámetros:
    - el tipo, si son ≤ 7 tipos, → `app-segmentado`;
    - el valor booleano → `app-segmentado` Sí/No;
    - el valor numérico → `app-numero-con-pasos` (`decimales` 1);
    - el nombre: chips de `claves` cuando son ≤ 7; si no, se queda el select.
  - Técnica y observación → `app-texto-opcional`.
  - Práctica y espacio se quedan como select si son catálogos de más de 7.
- [ ] **Step 3:** `npx ng test --watch=false --no-coverage --include "src/app/features/clinical/components/{mediciones-de-sesion,tratamientos-de-sesion}/**/*.spec.ts"`
  → sin fallas nuevas respecto del conteo previo (ajustar selectores de los specs que cambien).
- [ ] **Step 4: Verificar en 4200**: registrar una medición numérica con +/− y un tratamiento con minutos
  y un parámetro numérico, en modo táctil; ambos aparecen en la lista.

### Task 7: Alta de antecedente táctil (HC y Datos declarados)

**Files:**
- Modify: `src/app/features/clinical/pages/historia-clinica/historia-clinica-page.{ts,html}`
- Modify: `src/app/features/clinical/pages/datos-declarados/datos-declarados-page.{ts,html,css}`
- Create: `src/app/features/clinical/models/zonas-del-cuerpo.ts`

**Interfaces:**
- Produces: `export const ZONAS_DEL_CUERPO: readonly string[]`. Se arma con la lista de zonas que hoy
  está en `atencion-page.ts` (`zonas`). Atención pasa a importarla de acá.

- [ ] **Step 1:** Crear `ZONAS_DEL_CUERPO` y hacer que atención la use.
- [ ] **Step 2:** En las dos pantallas:
  - Tipo de antecedente (`tipoNuevo`) → `app-chips`.
  - Cirugía (`QUIRURGICO`):
    - zona → `app-chips permitirOtra` con `ZONAS_DEL_CUERPO`, guardando el texto elegido u "otra";
    - año → `app-numero-con-pasos` (`decimales` 0, `min` 1900, `max` año actual);
    - lugar → `app-texto-opcional`.
  - Descripción → `app-texto-opcional`.
  - Validación y envío (`registrarAntecedente`, `declararAntecedente`) sin cambios.
- [ ] **Step 3:** `npx ng test --watch=false --no-coverage --include "src/app/features/clinical/pages/{historia-clinica,datos-declarados}/**/*.spec.ts"`
  → sin fallas nuevas respecto del conteo previo.
- [ ] **Step 4: Verificar en 4200**: cargar una cirugía con zona por chip y año con +, en las dos pantallas;
  el detalle aparece en la lista.

### Task 8: Agenda del profesional táctil

**Files:**
- Modify: `src/app/features/scheduling/pages/agenda/agenda-page.{html,css}` (y el panel del turno que abre,
  si vive en otro componente: el implementador lo sigue desde el click del turno)

- [ ] **Step 1:** En modo táctil (sólo CSS con la media query o `data-puntero`):
  - bloques de turno con alto mínimo `var(--alto-tocable)`;
  - controles de navegación de día (‹ Hoy ›) y botones de vista con `--alto-control`;
  - nada que se active sólo con `:hover`.
- [ ] **Step 2:** Acciones del turno elegido (atender, ausente u otras que ya existan para el rol) como
  botones visibles, no detrás de "⋯", cuando la pantalla está en táctil. Sin transiciones ni permisos nuevos.
- [ ] **Step 3:** `npx ng test --watch=false --no-coverage --include "src/app/features/scheduling/pages/agenda/**/*.spec.ts"`
  → PASS (o sin fallas nuevas).
- [ ] **Step 4: Verificar en 4200** como profesional QA en modo táctil a 1024×768: tocar un turno de hoy y
  abrir su atención en dos toques.

### Task 9: Verificación integral

- [ ] **Step 1:** Recorrido completo en 4200 como profesional, modo táctil, 1024×768: agenda → atención
  (cinco pestañas) → cerrar → HC (ficha y antecedente). Sin scroll de página en agenda y atención.
- [ ] **Step 2:** Mismo recorrido con mouse a 1440×900: densidad de hoy (`--alto-control` 2.5rem), sin
  scroll de página en la atención.
- [ ] **Step 3:** 375 px y tema oscuro: sin desborde horizontal; chip elegido distinguible por borde/tilde
  además del color; foco visible en chips, escala y +/−.
- [ ] **Step 4:** `npm run build` → bundle inicial < 448 kB. `npm run lint` sobre lo tocado.
- [ ] **Step 5:** Capturas para el usuario (tablet y escritorio de la atención).
