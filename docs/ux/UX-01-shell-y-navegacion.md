# UX-01 · Shell y navegación — análisis y propuesta

> Etapa 1 del plan [`00-plan-refactor-ux-ui.md`](00-plan-refactor-ux-ui.md). Escrito el 21/10/2026
> sobre `main` = `8493929`, antes de implementar, con el formato §22 de la skill
> `refactor-ux-ui`. Decisiones del §9 del plan tomadas por el usuario el 21/10: seis grupos, notas
> plegadas en su lugar, SVG inline propios, `system-ui`, panel lateral + pantalla.

## 1. Objetivo de la pantalla

El shell no es una pantalla: es el marco de las 80. Lo que el usuario intenta hacer con él, cien
veces por día, es **llegar a la pantalla que necesita y saber dónde está**. Nada más. Todo lo que
el shell muestre y no sirva a eso es ruido que se paga en cada navegación.

## 2. Problemas detectados

| # | Problema | Sev. |
|---|---|---|
| 1 | **Quince secciones en una barra horizontal**, sin agrupar, que a 1366 px se parte en dos filas y a 1024 en tres. "Productos de pack" y "Egresos" pesan lo mismo que "Agenda". El usuario recorre quince palabras para encontrar una | ALTO |
| 2 | **La cabecera mide 180 px**: marca de 20 px con eslogan, dos filas de menú, línea de contexto. A 768 de alto (notebook) se lleva el 23 % de la pantalla antes del título | ALTO |
| 3 | **Las pantallas hermanas no están en la navegación.** Recepción del día (la más usada) se alcanza por un enlace de texto bajo el título de la agenda. Series, atención sin turno, invitaciones, sedes, auditoría: igual. Desde Caja no hay camino a Recepción sin pasar por Agenda | ALTO |
| 4 | **El contexto activo repite el nombre**: "Centro Agenda E2E d950233b · Centro Agenda E2E d950233b" cuando la sede se llama como el centro. Y "Cambiar" es un enlace de 12 px | MEDIO |
| 5 | **Sin señal de grupo**: la marca activa dice qué sección, no de qué parte de la aplicación (operación, administración, configuración) | MEDIO |
| 6 | **El eslogan** "Gestion de centros de kinesiologia y rehabilitacion" ocupa 330 px en cada pantalla y no cambia nada de lo que el usuario hace | BAJO |
| 7 | **Sin iconografía**: a igual tipografía, quince palabras son un párrafo | BAJO |

## 3. Jerarquía propuesta

1. **Dónde estoy** (grupo + sección), siempre visible y a la izquierda.
2. **A dónde puedo ir**, agrupado por tarea, a un clic.
3. **Para quién trabajo** (centro · sede) y cómo cambiarlo, arriba y compacto.
4. El contenido, que arranca a **48 px** del borde superior en vez de 180.

## 4. Flujo propuesto

- La **barra lateral** (240 px, fija, fondo de marca) lleva la marca y las secciones agrupadas.
  Todas visibles, ningún grupo plegado: a 768 px de alto entran las 17 entradas y 6 rótulos con
  filas de 32 px. Nada que descubrir, nada que desplegar.
- La **barra superior** (48 px, superficie de página) lleva el contexto activo con su enlace
  "Cambiar", el acceso a la consola de plataforma cuando corresponde y, en tablet, el botón que
  abre la barra lateral.
- En **tablet y menor** (< 1024 px) la barra lateral sale de pantalla y se abre con el botón
  "Menú" (`aria-expanded`, `aria-controls`, Escape cierra, el foco entra al menú y vuelve al
  botón al cerrar, un fondo oscurecido cierra al tocarlo).
- La sección actual se marca por **el prefijo más largo** que coincida con la URL: en
  `/agenda/recepcion` se marca Recepción del día y no Agenda; en `/agenda/ofertas/1/reservar`,
  Agenda. `aria-current="page"` en una sola entrada.
- El skip link sigue siendo el primer elemento enfocable y salta a `main`.

### Grupos y entradas

| Grupo | Entradas (ruta · permiso que la muestra) |
|---|---|
| **Operación** | Agenda `/agenda` · Recepción del día `/agenda/recepcion` (`turno:read`) |
| **Pacientes** | Padrón `/pacientes` (`paciente:read`) |
| **Actividades** | Clases (`clase:read`) · Asistencia (`inscripcion:read`) · Productos de pack (`producto:read`) |
| **Economía** | Caja (`caja:operate`) · Egresos (`caja:operate`) · Presentaciones (`cobro:register`) · Reportes (`reporte:read`) |
| **Configuración** | Organización · Espacios · Horarios (`colaborador:read`) · Servicios · Catálogo (`catalogo:read`) · Contratación (`convenio:read`) |
| **Plataforma** | Consola (solo `PLATFORM_ADMIN`), al pie, separada |

Los nombres de las secciones **no cambian** ("Contratacion", "Catalogo", "Productos de pack",
"Agenda"…): cuatro E2E los buscan por `getByRole('link', { name })` y siguen encontrándolos,
porque la barra lateral los deja todos en el DOM. Un grupo que se pliega los escondería y
rompería `riesgo-permisos-*`: por eso no se pliega.

Las pantallas hermanas que **no** entran en la barra (Series, Atención sin turno, Sedes,
Colaboradores, Invitaciones, Financiadores, Catálogo de servicios…) pasan a **pestañas de
sección** (`app-pestanas`) en la etapa que refactoriza cada pantalla (UX-03, UX-04, UX-07). El
componente nace acá, con la Agenda como primer uso (Turnos · Recepción · Series), para que
UX-02 ya lo tenga.

## 5. Elementos a mantener

- Skip link primero, `header` como banner, `nav` con `aria-label="Secciones de AKINE"`, `main#contenido` con `tabindex="-1"`.
- Filtro de secciones por permiso (`PermissionsStore.tieneAlguno`) y carga perezosa de permisos y rol de plataforma al tener contexto.
- Los tokens `--color-marca-*` para la superficie oscura, con su anillo de foco `--color-foco-sobre-marca`.
- La región viva del aviso de 503 y el ancho de contenido por ruta (`lectura` 46rem / `amplio` 76rem).
- Los textos "Elegi donde vas a trabajar" y "Consola de plataforma" para la sesión sin contexto.

## 6. Elementos a modificar

- `secciones.ts`: de lista plana a **grupos** (`GRUPOS`), conservando `SECCIONES` derivada (la usa `egresos.routes.spec.ts`) y `RUTA_INICIO`.
- `navegacion-principal`: pasa a ser la **barra lateral**; el contexto y los enlaces sin contexto salen de acá.
- Nueva `barra-superior`: contexto, "Cambiar", consola de plataforma, botón de menú en tablet.
- `app.html` / `app.css`: grilla de dos columnas (barra lateral + columna de barra superior y `main`); contenido alineado a la izquierda con su `max-width`, no centrado.
- `design-system.css`: tokens `--ancho-barra-lateral`, `--alto-barra-superior`; el anillo de foco sobre marca aplica a `.barra-lateral` además de `.cabecera`.
- Contexto: cuando la sede se llama igual que el centro se muestra **una sola vez**.
- Se quita el eslogan de la cabecera (queda en el `<title>` y en el login).

## 7. Elementos a ocultar o mostrar progresivamente

- En tablet, la barra lateral entera (menú).
- Nada más: el shell no tiene texto explicativo que plegar.

## 8. Componentes reutilizables

- `layout/barra-superior` (nuevo).
- `layout/navegacion-principal` (rehecho como barra lateral).
- `shared/components/pestanas` (nuevo): lista de enlaces hermanos con `aria-current`, sin reglas de dominio; recibe `{ etiqueta, ruta, exacta? }[]`.
- Iconos: un componente `shared/components/icono` con un mapa de SVG inline (`menu`, `cerrar`, `cambiar`), `aria-hidden` por defecto. Sin dependencia nueva.

## 9. Propuesta visual

```
┌──────────────┬──────────────────────────────────────────────────────────────┐
│ AKINE        │ [☰]  Centro Agenda E2E · Sede Centro   Cambiar     Plataforma │ 48 px
│              ├──────────────────────────────────────────────────────────────┤
│ OPERACIÓN    │                                                              │
│  Agenda      │  Agenda de turnos                                            │
│ ▌Recepción   │  ─ Turnos · Recepción del día · Series ─   (app-pestanas)    │
│ PACIENTES    │                                                              │
│  Padrón      │  … contenido, max-width según la ruta, alineado a la izq. …  │
│ ACTIVIDADES  │                                                              │
│  Clases      │                                                              │
│  Asistencia  │                                                              │
│  Productos   │                                                              │
│ ECONOMÍA     │                                                              │
│  Caja        │                                                              │
│  Egresos     │                                                              │
│  Presentac.  │                                                              │
│  Reportes    │                                                              │
│ CONFIGURACIÓN│                                                              │
│  Organización│                                                              │
│  Espacios    │                                                              │
│  Horarios    │                                                              │
│  Servicios   │                                                              │
│  Catálogo    │                                                              │
│  Contratación│                                                              │
│              │                                                              │
│ Plataforma   │                                                              │
└──────────────┴──────────────────────────────────────────────────────────────┘
   240 px
```

- Barra lateral: fondo `--color-marca-fondo`, rótulos de grupo en `--tipo-2xs` mayúsculas y
  `--color-marca-texto-suave`, entradas de 32 px con 12 px de sangría; la activa con fondo
  `--color-marca-superficie-activa` y una barra de 3 px a la izquierda en `--color-marca-borde`
  (no solo color: también peso de fuente, y `aria-current` para el lector).
- Barra superior: fondo `--color-superficie`, borde inferior `--color-borde-sutil`, texto del
  contexto en `--tipo-sm`; "Cambiar" como enlace con subrayado.
- Tablet: barra lateral `position: fixed`, `transform: translateX(-100%)` cerrada, fondo
  oscurecido al abrir; botón "Menú" de 44 px con el icono.

## 10. Implementación — tareas

1. Tokens y reglas globales en `design-system.css`.
2. `secciones.ts` con `GRUPOS` y `SECCIONES` derivada.
3. `shared/components/icono` (menu, cerrar).
4. `layout/navegacion-principal` como barra lateral (plantilla, estilos, lógica de prefijo más largo, apertura en tablet).
5. `layout/barra-superior` (contexto, Cambiar, plataforma, botón de menú).
6. `app.html` / `app.css` / `app.ts`: grilla, estado `menuAbierto`, foco y Escape.
7. `shared/components/pestanas` y su primer uso en la Agenda (Turnos · Recepción · Series), reemplazando los dos enlaces sueltos.
8. Specs: `navegacion-principal.spec`, `barra-superior.spec`, `app.spec`, `pestanas.spec`; ajustar `agenda-*` E2E si el texto "Ver la recepcion del dia" deja de existir.
9. Estados de contraste: la cabecera y las pestañas ya quedan dentro de las pantallas auditadas (toda pantalla con contexto monta el shell).
10. Capturas a 1366, 1024 y 768 para el PR.

## 11. Design challenge (CLAUDE.md §3)

1. **Contrato:** no consume nada nuevo. Permisos y rol de plataforma ya vienen de `PermissionsStore` y `PlatformRoleStore`.
2. **Ubicación:** `layout/` para barra lateral y superior (saben de secciones y contexto), `shared/` para pestañas e iconos (no saben de dominio).
3. **Zoneless:** `menuAbierto` es un signal; la sección activa es `toSignal` de `NavigationEnd`.
4. **Contexto tenant:** la barra se recalcula desde `TenantContextStore.context()`; al cambiar de contexto los permisos se vuelven a cargar como hoy.
5. **Permisos:** siguen siendo UX; el backend rechaza igual.
6. **Reglas maestras:** la barra separa Agenda (turnos) de Atención (sesión): no hay entrada "Atención" en la barra que sugiera que atender es lo mismo que recibir.
7. **Accesibilidad:** `nav` nombrado, `aria-current` único, foco gestionado al abrir y cerrar el menú, 44 px de toque, contraste con tokens ya medidos.
8. **El caso que rompe:** un usuario con permisos mínimos (rol paciente) ve un grupo vacío. Un grupo sin entradas visibles **no se renderiza**, rótulo incluido.

## 12. Registro de cierre — 21/10/2026

**Implementado** en la rama `akine-web-ux-01-shell` tal como lo describe este documento, con una
diferencia: Series y Atención sin turno no entraron en la barra lateral (quedan como pestaña y
como enlace de la recepción); la barra lleva 17 entradas en 5 grupos más Plataforma.

**Verificación** (medida sobre el worktree, contra el stack `demo-api` en `localhost:8080`):

| Qué | Resultado |
|---|---|
| `npm run lint`, `npm run format:check` | limpios |
| Unitarias (`npm run test:ci`) | 190 archivos / 2.035 tests: **2.034 en verde, 1 fallo preexistente y ajeno** (`clases-del-dia-page.spec.ts` fija `2026-10-21` como "otra fecha" y hoy es esa fecha; vence sola, se corrige aparte). Gate de cobertura en verde |
| Contraste (`contraste-claro` + `contraste-oscuro` + `movil`) | 89 en verde; 3 de `contraste-no-textual` en oscuro fallaron por carga (elementos desprendidos mientras corría otra suite con 6 workers) y pasaron 12/12 al repetirlos con 2 workers. `movil` 25/25 tras acotar su chequeo a `main` |
| E2E contra el backend real, proyecto `agenda` | 19/19, incluidos `agenda-recepcion` y `flujo-prepago`, que ahora entran a la recepción por la pestaña |
| E2E `chromium` (`contexto-sin-fuga`, `riesgo-permisos-de-convenios-y-catalogo`, `riesgo-permisos-de-f9`) | 10/10 tras acotar a `main` los cinco localizadores del nombre del centro (abajo). `smoke` no se corrió localmente |
| Capturas | 1366, 1024 y 768 px, claro y oscuro, agenda, recepción, padrón, caja, convenios y login; sin desborde horizontal en ninguna; foco entra al panel al abrir y vuelve al botón con Escape |

**E2E que hubo que tocar**, y por qué (plan §3.6):

- `agenda-recepcion`, `flujo-prepago`: entraban por el enlace "Ver la recepcion del dia", que ya no
  existe; entran por la pestaña "Recepcion".
- `contexto-sin-fuga`, `riesgo-permisos-de-convenios-y-catalogo`, `riesgo-permisos-de-f9`: afirmaban
  `getByText(centro, { exact: true })` y la barra superior ahora dice el centro **una sola vez**
  (antes decía "X · X" y no coincidía exacto). Se acotaron a `main`, que es lo que querían probar.
- `movil`: buscaba el título con `getByText(...).first()` y el primero pasó a ser el enlace de la
  barra lateral, escondido en el teléfono. Se acotó a `main`.

**Defectos encontrados al verificar** (ninguno en `main`, todos de esta rama y corregidos antes
del PR): la clase `.grupo` colisionaba con la global de fieldset y la barra heredaba un borde; la
grilla del shell estiraba la fila vacía del `nav` y empujaba la cabecera 100 px en tablet y en el
login; el foco al abrir el menú se pedía antes del render (`queueMicrotask` → `afterNextRender`).

**Hallazgos de la revisión** (§6, paso 5): la lectura del diff dejó un MEDIO corregido en el mismo
PR (la consola de plataforma no se marcaba como actual porque no era una sección) y ninguno abierto.

## 13. Ajustes tras la primera revisión del usuario — 21/10/2026

El usuario vio el PR y pidió dos cambios:

1. **"El menú lateral tiene muchas cosas": agrupar y poner un ícono.** Cada grupo pasó a ser un
   acordeón (`details`/`summary` con `name` compartido) con ícono propio: llega desplegado solo el
   grupo de la pantalla actual, y abrir otro cierra el anterior. Un grupo con una sola sección
   visible (Pacientes, o Agenda para un rol sin `turno:read`) no se despliega: es un enlace directo
   con el ícono del grupo. La barra pasa de 17 entradas a la vista a 5 cabeceras más las secciones
   del grupo actual.
   Esto revierte la decisión del §4 de no plegar ningún grupo. Lo que esa decisión protegía se
   resolvió de otro modo: los E2E de permisos buscan los enlaces con `includeHidden: true`, y
   cuentan si el enlace existe en la barra, no si está desplegado.
2. **Un ícono "?" que muestre la explicación en un popover.** Nuevo `app-ayuda`
   (`shared/components/ayuda`): botón redondo al lado del `h1` con `aria-expanded`/`aria-controls`,
   panel que se cierra con Escape (devuelve el foco) o con un clic afuera. Reemplaza las **17 notas
   didácticas** (`nota-clave`) de pantalla. El texto no se borró, solo cambió de lugar. Sigue en el
   DOM con `hidden`, así que los specs que lo leen pasan sin cambios. En las tres pantallas con
   título condicional (aranceles, importar aranceles, planes) la ayuda es una `ng-template`
   compartida por las dos ramas.

**Defecto encontrado al verificar:** la nota de la ficha llevaba adentro el botón "Abrir la
historia clinica", y la migración lo escondió en el panel. Lo destapó `acceso-clinico.spec.ts`.
Regla que queda: **una ayuda explica, nunca contiene acciones.** El botón volvió a la vista.

**Ajuste del arnés de foco:** `e2e/support/no-textual.ts` consideraba visibles los enlaces de un
`details` cerrado (Chromium les deja cajas) y esperaba que el Tab los recorriera. Ahora cuenta
como invisible lo que está dentro de un `details` cerrado, salvo su `summary`. Así el arnés queda
igual al comportamiento del navegador.
