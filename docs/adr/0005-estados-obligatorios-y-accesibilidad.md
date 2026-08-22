# ADR-0005 — Estados obligatorios de pantalla y accesibilidad AA

- **Estado:** Aceptado
- **Fecha:** 2026-08-22
- **Etapa:** AKINE-00.02

## Contexto

El plan exige que el frontend cubra "estados de carga, vacío, error, permiso insuficiente,
conflicto y éxito", y que mantenga "accesibilidad, navegación por teclado, diseño responsivo
y mensajes accionables". La especificación fija WCAG 2.1 AA como requisito.

Sin una convención decidida antes de la primera pantalla funcional, pasa lo de siempre: se
implementa el camino feliz, y los estados de error se agregan tarde, de forma distinta en
cada pantalla, o directamente no se agregan. El resultado es una pantalla que ante un error
de red se queda en blanco sin decir nada.

En AKINE eso tiene consecuencia clínica. Si la pantalla de Sesión falla al guardar y no lo
dice con claridad, el profesional cree que registró la evolución y no lo hizo.

Con la accesibilidad ocurre lo mismo: agregarla al final es rehacer el HTML. Fijarla desde
el shell y verificarla en el lint cuesta mucho menos.

## Decisión

### Estados obligatorios

Toda pantalla que consulte datos maneja **explícitamente**:

| Estado | Qué exige |
|---|---|
| Cargando | Indicación visible y anunciada por lector de pantalla |
| Éxito | El contenido |
| Vacío | Mensaje que distinga "no hay datos" de "todavía no cargó" |
| Error de red | Mensaje + **acción de reintento**. Nunca un cartel sin salida |
| Error del servidor | Mensaje del backend (`ProblemDetail.detail`), no uno genérico |
| Permiso insuficiente | Mensaje claro. Un guard es UX; la autoridad es el backend |
| Conflicto | Explicar qué cambió y qué puede hacer el usuario |

El estado se modela como **unión discriminada**, no como booleanos sueltos:

```ts
type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'conectado'; version: VersionResponse }
  | { tipo: 'sin-conexion' };
```

Con `cargando` y `error` como booleanos independientes existen estados imposibles
—`cargando && error`— que el compilador no puede descartar y que en la práctica terminan
renderizados. La unión los hace inexpresables.

El estrechamiento del tipo se hace en TypeScript con un `computed`, no en la plantilla con
`$any`: así lo verifica el compilador.

### Accesibilidad

Toda pantalla cumple:

- **Skip link** operativo por teclado como primer elemento enfocable.
- Landmarks semánticos (`header`, `main`, `nav`) y jerarquía de headings sin saltos.
- **Foco visible** en todo elemento interactivo. Nunca `outline: none` sin reemplazo.
- Labels reales en todos los campos. Un `placeholder` no es un label.
- Contraste AA: 4.5:1 en texto normal.
- Cambios de estado anunciados con `aria-live`; los errores con `role="alert"`.
- Navegación completa por teclado.

Se verifica con `angular.configs.templateAccessibility` en ESLint —que falla el build— y con
E2E que ejercitan el recorrido por teclado.

El shell (`app.html`) implementa los tres estados y todas las garantías de accesibilidad:
es la referencia a copiar.

## Alternativas consideradas

**Booleanos `loading` / `error` / `data`.** Lo más común y lo más rápido de escribir.
Descartada por los estados imposibles: nada impide `loading = true` junto con `error = true`,
y el bug resultante es intermitente y difícil de reproducir.

**Un componente genérico que envuelva y resuelva todos los estados.** Tentador por lo DRY.
Descartada para el baseline: sin pantallas reales todavía, el componente se diseñaría contra
casos imaginarios. La abstracción correcta se extrae cuando haya tres o cuatro pantallas que
la justifiquen, no antes.

**Accesibilidad como checklist de revisión manual.** Descartada por lo mismo que las reglas
de arquitectura del backend (ADR-0006 del backend): una verificación manual se saltea el día
que hay apuro. Las reglas de plantilla de `angular-eslint` cubren buena parte y no cuestan
nada.

**Solo reintentar automáticamente, sin botón.** Descartada: el reintento automático sin
control confunde y puede amplificar una caída. El usuario debe poder decidir.

## Consecuencias

### Positivas

- Los estados imposibles no compilan.
- Ninguna pantalla puede quedarse en blanco ante un error: el estado tiene que estar escrito.
- Las reglas de accesibilidad de plantilla fallan el build, no la revisión.
- El shell sirve de referencia concreta, no de descripción abstracta.

### Negativas

- Más código por pantalla que el camino feliz solo.
- Las uniones discriminadas requieren estrechar el tipo, lo que agrega un `computed` por
  pantalla.
- `templateAccessibility` no cubre todo: contraste y orden de foco siguen necesitando
  verificación manual o E2E.
- Sin componente genérico hay repetición hasta que se extraiga la abstracción.

### Qué obliga a hacer

- Toda pantalla nueva modela su estado como unión discriminada.
- Todo error de red ofrece una acción de reintento.
- Los errores usan `role="alert"`; los cambios de estado, `aria-live`.
- Los E2E de cada feature verifican al menos un estado de error y el recorrido por teclado.
- **PENDIENTE(F1):** cuando existan tres o cuatro pantallas, evaluar extraer el componente
  genérico de estados y verificar contraste con una herramienta automática (axe).
