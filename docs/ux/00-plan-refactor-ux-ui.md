# Refactor UX/UI del frontend — plan por etapas

> Escrito el **21/10/2026** sobre `main` = `8493929` (PR #124), cliente **0.143.0**.
> Relevamiento hecho con **19 capturas de pantalla a 1366 px** contra el backend real (centro
> sembrado por la API con `e2e/agenda.setup.ts`), lectura de las **107 plantillas** de `features/`
> y conteo de patrones repetidos por `grep`. Los números de este documento son de esa medición.
>
> La metodología que aplica cada etapa es la skill `.claude/skills/refactor-ux-ui/SKILL.md`
> (análisis previo obligatorio, clasificación de hallazgos, formato de análisis §22). Este
> documento dice **qué** se aborda, **en qué orden** y **cuándo una etapa está terminada**.

---

## 1. Diagnóstico transversal

Lo que importa de este relevamiento es que **los problemas no son de una pantalla: son de la
plantilla mental con la que se construyeron las 80.** Todas siguen el mismo esqueleto:

```
h1
párrafo de descripción (2–3 líneas, didáctico)
enlaces sueltos en <p> ("Ver la recepción del día", "Volver a…")
[tarjeta "nota-clave" con 3 párrafos explicando el modelo]
[botón de acción principal, suelto, en cualquier posición]
tarjeta de filtros (campos a todo el ancho, uno debajo del otro, con ayuda bajo cada uno)
resultado / tabla / estado vacío en texto plano
```

Eso significa que **arreglar el esqueleto arregla las 80 a la vez**, y que el orden correcto es
cimientos primero y pantallas después. Hallazgos, clasificados con la escala de la skill:

| # | Hallazgo | Evidencia | Sev. |
|---|---|---|---|
| T1 | **Navegación plana de 15 secciones** en una barra horizontal que se parte en dos filas a 1366 px. Sin agrupación por tarea ni por rol: "Productos de pack" pesa lo mismo que "Agenda". La cabecera ocupa **180 px** (marca + eslogan + dos filas de menú + línea de contexto) antes del primer pixel útil | `layout/navegacion-principal/secciones.ts`, capturas | **ALTO** |
| T2 | **Navegación secundaria inventada en cada feature.** Enlaces sueltos en párrafos (`routerLink="/…"` en **205** lugares de 72 plantillas, "Volver a…" en **92**), pseudo-pestañas con botones bordeados (`pestan*` en 11 plantillas), y la recepción del día, las series y la atención sin turno colgadas como enlaces de texto bajo el título de la agenda. El usuario no sabe dónde está ni qué hay al lado | `buscador-de-agenda`, `servicios`, `contratacion` | **ALTO** |
| T3 | **La explicación ocupa el primer pliegue.** `class="descripcion"` en 77 plantillas, `nota-clave` (panel didáctico de 3 párrafos) en 20, `class="ayuda"` **722 veces**. En Convenios de la sede el primer dato útil aparece a **1.080 px** de altura; en el Padrón, a 1.050. Los textos son correctos y valiosos (codifican reglas de negocio de la tesis), pero están en el lugar equivocado: se leen una vez y se pagan en cada uso | capturas `pacientes`, `contratacion`, `servicios` | **ALTO** |
| T4 | **Formularios en una columna a todo el ancho.** Un campo numérico ("Saldo inicial contado") mide 1.118 px; "Moneda (ISO 4217)" exhibe la norma en el label. Cada campo lleva ayuda debajo, obligatorio o no, frecuente o no | `caja`, `padron`, `reportes` | **ALTO** |
| T5 | **La acción principal no tiene lugar fijo.** "Dar de alta una persona" vive dentro de la tarjeta de búsqueda; "Firmar un convenio" entre la nota y la lista; "Vincular a alguien" es un botón con texto subrayado; "Abrir la caja" aparece deshabilitado y gris sin decir por qué | capturas | **ALTO** |
| T6 | **Tablas con 4 botones por fila** (`acciones-fila` en 35 plantillas) y datos crudos: fechas ISO (`2026-10-21T13:19:59.154280Z`), e-mails completos de 50 caracteres como subtítulo, columnas de igual peso | `colaboradores` | **MEDIO** |
| T7 | **Estados vacíos y de carga como párrafo suelto** (`estado--vacio` 146 usos, `estado--cargando` 96, `estado--error` 290), sin acción asociada ni jerarquía. "Este día no tiene ningún turno agendado" aparece como una línea entre dos tarjetas | `recepcion`, `servicios` | **MEDIO** |
| T8 | **Sin componentes de estructura.** `shared/components` tiene **3** (confirmación con motivo, editor de franjas, paginación). No hay PageHeader, Tabs, EmptyState, Drawer ni Dialog (`<dialog>`: 0 usos). Cada feature resuelve lo mismo a mano: 303 `tarjeta`, 350 `acciones` | `src/app/shared` | **MEDIO** |
| T9 | **Todo es tarjeta.** 303 `<section class="tarjeta">`: filtros, notas, errores, resultados y formularios tienen el mismo borde y el mismo peso. La jerarquía título → sección → campo → ayuda existe en tipografía pero no en el layout | `design-system.css` | **MEDIO** |
| T10 | **Sin iconografía ni señales visuales** fuera del color de las pastillas de estado. Las acciones se distinguen solo por el texto | — | **BAJO** |

Lo que **funciona y se conserva** (no se toca en ninguna etapa):

- La **capa de tokens** de `design-system.css` (roles, no valores; modo oscuro solo redefine
  tokens; contraste medido por `npm run a11y:contraste`). El refactor **agrega** tokens de
  espaciado y anchos; no renombra ni reemplaza los de color sin volver a medir.
- Las garantías de accesibilidad heredadas: skip link, landmarks, `aria-live` (146 usos),
  anillo de foco global, 3:1 en bordes de control, foco que vuelve al cerrar paneles.
- Los **textos de error del backend** mostrados tal cual (AGENT.md §8) y el catálogo de
  `problemType` verificado por `api:check`.
- Las reglas maestras en la UI: Turno ≠ Sesión, Persona ≠ Paciente, Obligación ≠ Cobro ≠ Caja.
  Ninguna pantalla se fusiona con otra.
- Los nombres accesibles que usan los **68 E2E** (`getByRole`, `getByLabel`). Ver §7.

---

## 2. Estrategia

1. **Cimientos antes que pantallas.** Las dos primeras etapas (shell + sistema de componentes)
   no rediseñan ninguna pantalla: cambian el marco en el que viven todas. Sin eso, cada pantalla
   refactorizada inventaría su propio header, sus propias pestañas y su propio estado vacío, que
   es exactamente el problema de hoy.
2. **Después, por circuito de uso y por frecuencia**, no por módulo técnico. El orden es el del
   día de un centro: mostrador → paciente → atención → plata → configuración → actividades →
   reportes. Las pantallas de configuración se usan una vez al mes; la recepción, cien veces
   al día.
3. **Una pantalla, un PR.** Cada PR lleva el análisis (§22 de la skill), capturas antes/después
   y la lista de E2E que tocó. Nada de "rediseño del módulo X" en un solo diff de 40 archivos.
4. **La primera pantalla de cada etapa fija el patrón; las demás lo repiten.** Si al repetir
   aparece una necesidad nueva de componente, se vuelve al componente (UX-02), no se parchea en
   la pantalla.
5. **Cambio UX/UI ≠ cambio funcional.** Si una mejora exige tocar un servicio, una validación,
   el cliente generado o el contrato, se escribe como pedido aparte y se decide antes. El diff
   de un PR de esta serie no toca `*.service.ts` ni `api/generated/` salvo que el análisis lo
   declare y el usuario lo apruebe.
6. **Secuencial hasta UX-03; paralelo después.** UX-01 y UX-02 tocan archivos globales
   (`layout/`, `shared/`, `design-system.css`) y tienen que estar en `main` antes de cualquier
   pantalla. UX-03 se hace en serie para asentar los patrones. Desde UX-04, las etapas de
   pantallas tocan features distintas (`person`, `clinical`, `billing`…) sin archivos en común y
   pueden correr en worktrees paralelos, una por sesión (regla del proyecto: un worktree por
   paquete).

---

## 3. Criterios comunes de diseño

Son las reglas que toda pantalla refactorizada cumple. Se escriben una vez acá y cada etapa las
cita; cuando una pantalla necesite apartarse, lo dice en su análisis.

### 3.1 Anatomía de una pantalla

```
┌ Cabecera de la app (compacta, 56 px): marca · navegación agrupada · contexto · cuenta
├ Navegación secundaria de la sección (si la sección tiene más de una pantalla): pestañas
├ PageHeader: [volver]  Título                                   [acción secundaria] [ACCIÓN PRINCIPAL]
│            una línea de contexto (opcional, ≤ 90 caracteres)
├ Avisos vivos (éxito / error de operación), en una región fija, no intercalados
├ Contenido: filtros compactos → resultado. Secciones separadas por espacio y título, no por borde
└ (Formularios largos) barra de acciones fija al pie: [Cancelar]        [ACCIÓN PRINCIPAL]
```

### 3.2 Texto explicativo

- La **descripción** bajo el título pasa a **una línea** o desaparece. Dice qué se hace acá, no
  cómo funciona el modelo.
- Las **notas didácticas** (`nota-clave`) y la ayuda larga no se borran: pasan a **revelado
  progresivo** (un `InfoNote` plegado: "¿Activa y vigente no son lo mismo?") o al tooltip de un
  campo. La regla que explica un rechazo se muestra **en el momento del rechazo**, junto al error.
- La **ayuda de campo** queda solo cuando cambia lo que el usuario escribe (formato, rango,
  qué incluye). "Es la fecha local de la sede" no cambia lo que escribe: se va.

### 3.3 Formularios

- Grilla de **12 columnas**; cada campo declara su ancho por tipo: fecha / hora / moneda /
  número = 3–4 col; texto corto = 6; texto largo y textarea = 12. Nunca un número a 1.100 px.
- Campos relacionados en la **misma fila** (desde/hasta, documento tipo/número, moneda/importe).
- Orden: obligatorios y frecuentes primero; raros y avanzados en una sección plegada
  "Más opciones". Los **condicionales aparecen al elegir** la opción que los habilita.
- Una pantalla tiene **una** acción principal (relleno, color de acción) y las demás son
  secundarias (contorno) o terciarias (enlace). Un botón deshabilitado dice **por qué** al lado.
- Los errores de validación van **junto al campo**, con texto, no solo con color; el error
  general del proceso, arriba del formulario en la región de avisos.

### 3.4 Listas y tablas

- Columnas por importancia: identidad → estado → dato clave → vigencia. El resto, en la fila
  expandible o en el detalle.
- **Una** acción visible por fila (la frecuente) y el resto en un menú "⋯" accesible por
  teclado. Suspender / revocar / dar de baja siempre dentro del menú y con confirmación.
- Fechas en palabras ("21 oct 2026, 10:19"), nunca ISO. E-mails y códigos largos, truncados con
  el completo en `title` y copiable.
- Estado vacío con **componente**: ícono, una frase, y la acción que lo resuelve ("Dar de alta
  la primera oferta"). Carga con esqueleto o spinner en el lugar del contenido, no un párrafo
  encima.

### 3.5 Navegación

- Secciones agrupadas por tarea (propuesta en §5, UX-01). El grupo visible depende de los
  permisos, como hoy.
- Dentro de una sección, **pestañas** para sus pantallas hermanas (Agenda: Turnos · Recepción ·
  Series). Nada de enlaces sueltos en párrafos.
- Toda pantalla de detalle tiene **un** "volver" en el PageHeader, con el nombre del lugar al que
  vuelve.

### 3.6 Lo que no cambia de lugar

Nombres accesibles, labels y roles que los E2E usan. Cuando un refactor tenga que cambiar un
texto que un E2E busca, el **mismo PR** actualiza el E2E y lo dice en la descripción.

### 3.7 Responsive

Desktop (≥ 1280) y notebook (1024–1279) para mostrador y administración; **tablet (768–1023)
es el objetivo de las pantallas clínicas** (AGENT.md §8). A 768 px la grilla de formularios
baja a 6 columnas y la navegación agrupada se pliega a un menú. Mobile (375) sigue sin desborde
(ya lo verifica `e2e/movil.spec.ts`) pero no se rediseña.

---

## 4. Componentes reutilizables

Inventario de lo que las etapas construyen en `shared/` (sin reglas de dominio, ADR-0004) o en
`layout/`. Cada uno nace en UX-02 con la primera pantalla que lo necesita y se completa cuando la
segunda lo reutiliza.

| Componente | Reemplaza a | Usos estimados hoy | Nace en |
|---|---|---|---|
| `app-page-header` (título, volver, contexto, acciones) | `h1` + `descripcion` + enlaces "Volver" + botón suelto | 80 pantallas | UX-02 |
| `app-pestanas` (navegación secundaria, `role="tablist"` o enlaces con `aria-current`) | pseudo-pestañas de 11 plantillas + enlaces sueltos | 15 secciones | UX-01 |
| `app-seccion` (título + contenido, con o sin borde) | 303 `tarjeta` | todas | UX-02 |
| `app-nota` (nota plegable, "¿Qué significa…?") | 29 `nota-clave` + ayudas largas | 20 pantallas | UX-02 |
| `app-estado-vacio` (frase + acción) | 146 `estado--vacio` | 71 pantallas | UX-02 |
| `app-estado-carga` (esqueleto / spinner en sitio) | 96 `estado--cargando` | 81 pantallas | UX-02 |
| `app-aviso` (éxito / error / advertencia, con región viva fija) | `estado--ok` / `estado--error` intercalados | 102 pantallas | UX-02 |
| `app-marca-estado` (badge, severidad + texto) | `marca-estado--*` y `etiqueta` | 35 tablas | UX-02 |
| `app-menu-de-fila` (acciones "⋯", teclado y foco) | `acciones-fila` con 3–4 botones | 35 tablas | UX-03 |
| `app-dialogo` (sobre `<dialog>` nativo, foco atrapado y devuelto) | paneles inline que empujan la página | confirmaciones, altas cortas | UX-03 |
| `app-panel-lateral` (drawer para detalle sin salir de la lista) | navegaciones a pantallas de detalle de un dato | padrón, colaboradores, ofertas | UX-04 |
| `app-barra-de-acciones` (pie fijo de formulario) | `acciones` al final de formularios largos | 20 formularios | UX-03 |
| `app-grilla-de-campos` (grilla 12 col + anchos por tipo; solo CSS) | `campo` apilado | todos los formularios | UX-02 |
| Pipes `fechaEnPalabras`, `horaEnZona`, `importe` (si no existen ya en `shared/utils`) | helpers repetidos en cada page | fichas y tablas | UX-02 |

Lo que **ya existe y se mantiene**: `confirmacion-con-motivo` (22 usos; se le da el `app-dialogo`
por debajo), `paginacion`, `editor-de-franjas`, `selector-de-horario`.

Lo que **no se hace**: un `DataTable` genérico con columnas configurables. Las 57 tablas tienen
celdas con lógica propia; un componente genérico las obligaría a pasar por `TemplateRef` y
sería más difícil de leer que el `<table>` de hoy. Se mejoran las **primitivas** (`.tabla`, menú
de fila, badge, fechas) y cada tabla sigue siendo suya.

---

## 5. Etapas

Cada etapa sigue el ciclo de siete pasos del pedido: **análisis de usabilidad → detección de
problemas → propuesta → estructura visual → implementación → revisión → ajustes**, y no se abre
la siguiente hasta cumplir su criterio de cierre (§6).

### UX-00 · Relevamiento y criterios — **hecha con este documento**

- **Entregables:** este plan; la skill en `.claude/skills/refactor-ux-ui/`; las capturas base
  (se regeneran con el script de §8 cuando haga falta: no se commitean).
- **Cierre:** el usuario aprueba el orden de etapas y responde las decisiones de §9.

### UX-01 · Shell y navegación

- **Objetivo:** que el usuario sepa dónde está y llegue a cualquier pantalla en dos clics, y
  que la cabecera deje de costar 180 px.
- **Alcance:** `app.html` / `app.css`, `layout/navegacion-principal/*`, `secciones.ts`, el
  selector de contexto (`/seleccionar-contexto`), el aviso de servicio (503), y la nueva
  navegación secundaria por sección (`app-pestanas`).
- **Propuesta de agrupación** (a validar en §9):
  - **Operación:** Agenda (Turnos · Recepción · Series), Atención (Sin turno · Ventana de enmienda)
  - **Pacientes:** Padrón · (dentro de la ficha: Coberturas · Órdenes y autorizaciones ·
    Documentos · Cuenta corriente · Historia clínica · Pases)
  - **Actividades:** Clases · Asistencia · Productos de pack
  - **Economía:** Caja · Cobros · Egresos · Presentaciones · Reportes
  - **Configuración:** Organización (Datos · Sedes · Colaboradores · Invitaciones ·
    Notificaciones · Auditoría) · Espacios · Horarios · Servicios (Catálogo · Ofertas) ·
    Contratación (Convenios · Financiadores · Consultar arancel)
  - **Plataforma** (solo `PLATFORM_ADMIN`), separada a la derecha.
- **Estructura visual:** cabecera de una fila (marca · grupos como menús desplegables o barra
  de dos niveles · contexto compacto "Centro · Sede ▾" · cuenta). En tablet, grupos plegados en
  un botón de menú. Las pestañas de sección van debajo de la cabecera, dentro del ancho de
  contenido.
- **Dependencias:** ninguna. Bloquea a todas las demás.
- **Riesgos:** `routerLinkActive` por prefijo con el grupo; los E2E que hacen
  `getByRole('link', { name: 'Agenda' })`; el gate de contraste mide la navegación en los dos
  temas (8 estados × 2 temas) y la cabecera cambia de tamaño.
- **Cierre específico:** las 80 pantallas se alcanzan desde la navegación nueva; ninguna
  pantalla conserva un enlace "Ver la X" bajo el título que ahora sea una pestaña; `a11y:contraste`
  y los 68 E2E en verde; capturas de la cabecera a 1366, 1024 y 768.

### UX-02 · Sistema de componentes y guía de estilo

- **Objetivo:** que exista **una** forma de hacer cabecera de página, sección, formulario,
  estado vacío, aviso, badge y nota, y que esté documentada.
- **Alcance:** `shared/components/*` nuevos de §4 (menos los que nacen en UX-03/04),
  `design-system.css` (grilla de campos, anchos por tipo, tokens de espaciado y de ancho de
  contenido, jerarquía de sección sin borde), y `docs/ux/guia-de-estilo.md` con un ejemplo de
  cada componente y sus reglas de uso (§3).
- **Pantalla piloto:** **Recepción del día** (`scheduling/pages/recepcion-del-dia`). Es la de
  mayor frecuencia, tiene filtros, lista, estados vacíos, acciones por fila y un segundo bloque
  (clases del día). Si los componentes sirven para ella, sirven para el resto. Se refactoriza
  completa en esta etapa como prueba de los componentes.
- **Dependencias:** UX-01 (ancho de contenido y pestañas).
- **Riesgos:** el CSS global de `tarjeta` sigue existiendo mientras las demás pantallas no
  migran; convivencia de dos estéticas durante las etapas 03–09 (aceptada: por eso el orden
  va por frecuencia, lo más usado se ve nuevo primero).
- **Cierre específico:** cada componente tiene spec, ejemplo en la guía y se usa al menos en
  la pantalla piloto; la pantalla piloto pasa la revisión del §6; una segunda sesión puede
  refactorizar otra pantalla **sin preguntar nada** leyendo solo la guía.

### UX-03 · Circuito de mostrador

- **Pantallas (en este orden):** Agenda de turnos (buscador) → Reservar un turno → Ciclo del
  turno → Series de turnos (bandeja, detalle, alta, reprogramar) → Atender sin turno (la parte
  administrativa) → Ventana de enmienda.
- **Usuario:** recepción, desktop, cien veces por día. Prioridad por **velocidad**: la agenda
  tiene que mostrar disponibilidad sin elegir cuatro cosas primero (oferta recordada por sesión,
  semana por defecto, profesional como filtro secundario); la reserva, en un diálogo o panel
  lateral sobre la grilla, no en otra pantalla.
- **Componentes que nacen acá:** `app-menu-de-fila`, `app-dialogo`, `app-barra-de-acciones`.
- **Dependencias:** UX-02.
- **Cierre específico:** reservar un turno desde la agenda cuesta **≤ 3 clics** más el
  paciente; la recepción muestra el estado del día sin scroll a 1366 × 768; E2E `agenda-*`,
  `flujo-series*`, `flujo-serie-*`, `flujo-atencion-sin-turno`, `flujo-dia-de-la-sede` en verde.

### UX-04 · Pacientes

- **Pantallas:** Padrón → Ficha de la persona (360) → Coberturas del paciente → Órdenes y
  autorizaciones (la plantilla más grande: **1.341 líneas**, candidata a pestañas internas +
  panel lateral) → Documentos → Cuenta corriente → Pases de la persona.
- **Idea rectora:** la ficha es el **hub** del paciente. Sus pantallas hermanas pasan a ser
  pestañas de la ficha con el encabezado del paciente fijo (nombre, documento, estado del
  perfil, alertas de cobertura), y el padrón abre la ficha en panel lateral para la consulta
  rápida y en pantalla completa para operar.
- **Componentes que nacen acá:** `app-panel-lateral`.
- **Dependencias:** UX-02. Independiente de UX-03 (features distintas): **puede correr en
  paralelo** con UX-03 desde que UX-02 esté en `main`.
- **Cierre específico:** desde el padrón, llegar a cualquier dato del paciente cuesta 2 clics;
  Órdenes y autorizaciones muestra primero "qué le falta para atenderse" y el resto bajo
  demanda; E2E `flujo-padron`, `flujo-documentos`, `flujo-autorizaciones`, `flujo-coberturas-*`,
  `flujo-consumos-a-revisar`, `flujo-historia-administrativa`, `flujo-pases` en verde.

### UX-05 · Atención clínica (tablet)

- **Pantallas:** Atención clínica (816 líneas; sesión rápida vs. evaluación completa según
  `plan_sesiones.txt`) → Atención grupal → Historia clínica (timeline) → Caso clínico → Plan de
  tratamiento → Enmendar una atención → Versiones de una atención.
- **Usuario:** profesional, **tablet**, con el paciente adelante. Prioridad: mínimo ruido
  administrativo, comparabilidad con la sesión anterior, los tratamientos y mediciones como
  bloques que se agregan y no como formulario fijo.
- **Dependencias:** UX-02. Paralelizable con UX-03 y UX-04.
- **Riesgos:** es la pantalla con más reglas (caso obligatorio por oferta, consumo de
  autorización, cierre que devenga). Cualquier cambio que toque **cuándo** se dispara una
  operación es funcional y se separa.
- **Cierre específico:** una sesión rápida se registra en tablet sin scroll horizontal y con
  ≤ 2 pantallas; el análisis de la atención se contrasta con `plan_sesiones.txt` §10; E2E
  `flujo-atencion-*`, `historia-clinica`, `casos-clinicos`, `plan-de-tratamiento`,
  `flujo-auditoria-clinica`, `acceso-clinico` en verde.

### UX-06 · Economía

- **Pantallas:** Caja diaria → Registrar un cobro → Cobros registrados → Egresos y Egreso →
  Presentaciones y Lote de presentación → Cierres y aperturas → Liquidación de honorarios.
- **Idea rectora:** separar visualmente los tres conceptos que la app ya separa (deuda, cobro,
  caja) con un resumen numérico arriba (saldo de caja, pendiente de cobro del día) y el detalle
  abajo; el formulario de cobro en diálogo desde la cuenta corriente.
- **Dependencias:** UX-02 y UX-04 (la cuenta corriente vive en la ficha).
- **Cierre específico:** abrir caja, registrar un cobro y cerrar caja sin leer ninguna nota;
  importes alineados a la derecha con formato de moneda; E2E `flujo-caja`, `flujo-cobros-*`,
  `riesgo-cobro-*`, `riesgo-egreso-*`, `flujo-presentacion*`, `riesgo-presentacion-*`,
  `flujo-honorarios-*` en verde.

### UX-07 · Configuración de la sede

- **Pantallas:** Organización (datos, suscripción, sedes, abrir sede) → Colaboradores →
  Invitaciones → Notificaciones → Auditoría → Espacios y boxes → Horarios (semanal, efectivo,
  general y feriados, excepciones: 612 líneas) → Servicios (catálogo, ofertas: 833 líneas,
  habilitaciones, prácticas, precios, honorarios) → Catálogo clínico (catálogos, vigencias) →
  Contratación (convenios: 694, financiadores, planes, aranceles, importar, arancel efectivo).
- **Usuario:** administrador, desktop, pocas veces. Prioridad: **claridad sobre velocidad**;
  acá es donde más notas didácticas hay, y donde el revelado progresivo rinde más.
- **Dependencias:** UX-02. Paralelizable; es la etapa más larga (≈ 30 pantallas) y puede
  partirse en dos PR-series (organización + recursos / servicios + contratación).
- **Cierre específico:** cada pantalla de listado tiene su alta en diálogo o panel y su
  edición in-place; ninguna nota didáctica visible por defecto; E2E `flujo-sedes`,
  `flujo-colaboradores`, `flujo-invitaciones`, `flujo-notificaciones`, `flujo-desvinculacion`,
  `flujo-espacios`, `flujo-horarios`, `flujo-disponibilidad-resuelta`, `flujo-servicios`,
  `flujo-practicas-*`, `flujo-catalogo*`, `nomenclador-vigencias`, `flujo-financiadores`,
  `flujo-coberturas-y-aranceles`, `riesgo-permisos-de-convenios-y-catalogo` en verde.

### UX-08 · Actividades (F9)

- **Pantallas:** Clases (listado, programar, detalle, atención de la clase) → Asistencia →
  Productos de pack → Honorarios por clase → Liquidar honorarios por clase.
- **Dependencias:** UX-02 y los patrones de UX-03 (la grilla de clases es prima de la agenda).
- **Cierre específico:** tomar asistencia de una clase es una pantalla con un toque por
  participante; E2E `flujo-clases`, `clase-reprogramada`, `flujo-asistencia`,
  `flujo-atencion-grupal`, `circuito-f9`, `riesgo-permisos-de-f9` en verde.

### UX-09 · Reportes, plataforma y acceso

- **Pantallas:** Reportes (con la skill `dataviz` **antes** de tocar cualquier gráfico) →
  Consola de plataforma (suscripciones, solicitudes de catálogo, catálogo de financiadores) →
  Acceso (login, registro, activar, reenviar, recuperar, restablecer, invitación, sesión
  expirada, seleccionar contexto) → páginas de estado (404, sin permiso, baseline).
- **Dependencias:** UX-02. Acceso y estados son independientes de todo y sirven como
  **etapa de relleno** cuando otra se bloquea.
- **Cierre específico:** el tablero de reportes muestra el período y el reporte elegido con
  un resumen numérico antes de la tabla; login y contexto son una tarjeta centrada sin
  explicación; E2E `flujo-reportes`, `auth-flujo`, `contexto-sin-fuga`, `sesion-expirada`,
  `invitacion-aceptada`, `riesgo-permisos-de-la-plata`, `smoke` en verde.

### UX-10 · Consolidación

- **Alcance:** barrido transversal de consistencia (ninguna pantalla con `descripcion` larga,
  `nota-clave` visible, `acciones-fila` con más de un botón, fecha ISO), borrado del CSS que
  quedó sin uso en `design-system.css` y en las hojas de feature, auditoría de tablet en las
  pantallas clínicas y de teclado en las de mostrador, actualización de ADR-0005 y de la guía.
- **Cierre:** un `grep` por cada patrón viejo devuelve cero; `a11y:contraste` 34/34;
  `npm run lint`, `test:ci`, `api:check` y los 68 E2E en verde; `CLAUDE.md` §7 registra el
  cierre con números medidos.

### Resumen de orden y dependencias

```
UX-00 ─► UX-01 ─► UX-02 ─┬─► UX-03 (mostrador) ─────┐
                         ├─► UX-04 (pacientes) ─► UX-06 (economía)
                         ├─► UX-05 (clínica, tablet)  │
                         ├─► UX-07 (configuración)    ├─► UX-10 (consolidación)
                         ├─► UX-08 (actividades) ◄── UX-03 (patrón de grilla)
                         └─► UX-09 (reportes, plataforma, acceso)
```

**Primero:** UX-01, UX-02 y UX-03, en serie. **Después:** UX-04 y UX-05 (los dos circuitos que
más valor dan a la tesis: paciente y atención). **Al final:** UX-07 y UX-08, que son muchas
pantallas de poco uso, y UX-09. **Se deja para después del refactor:** mobile real (no está en
el alcance de AGENT.md), iconografía como dependencia nueva (ver §9) y cualquier cambio de
flujo que exija contrato nuevo.

---

## 6. Criterio de cierre de una etapa

Una etapa está terminada cuando **todas** sus pantallas cumplen esto, y no antes:

1. **Análisis escrito** en `docs/ux/<etapa>-<pantalla>.md` con el formato §22 de la skill
   (objetivo, problemas clasificados, jerarquía, flujo, mantener / modificar / ocultar,
   componentes, propuesta visual), escrito **antes** de implementar.
2. **Un PR por pantalla** con capturas antes/después a 1366 px (y a 768 px en UX-05), la lista
   de componentes nuevos o tocados en `shared/`, y la lista de E2E ajustados.
3. **Sin cambio funcional** en el diff: `*.service.ts`, `api/generated/`, guards, validadores y
   `environment` intactos. Si hubo uno, está declarado en el PR como "CAMBIO FUNCIONAL" y fue
   aprobado antes.
4. **Gates en verde:** `npm run lint`, `npm run test:ci` (cobertura ≥ 80 % en las cuatro),
   `npm run api:check`, `npm run a11y:contraste`, y los E2E de la pantalla contra el backend
   real (el job del CI).
5. **Revisión** con la lista de §3 (anatomía, texto, formularios, tablas, navegación,
   responsive) más `/code-review`. Los hallazgos CRÍTICO y ALTO se corrigen en el mismo PR;
   MEDIO y BAJO pueden ir a un PR de ajustes **antes** de abrir la etapa siguiente.
6. **Ajustes cerrados:** no queda ningún hallazgo abierto de la revisión y el usuario vio las
   capturas finales.
7. **Registro:** la etapa queda tachada en este documento con la fecha y los PR, y `CLAUDE.md`
   §7 lo menciona.

---

## 7. Riesgos y cómo se cubren

| Riesgo | Cobertura |
|---|---|
| Los 68 E2E localizan por nombre accesible; mover un texto los rompe | El refactor mantiene labels y nombres de botón; cuando no puede, el mismo PR ajusta el E2E. Se corren localmente antes de abrir el PR (`e2e/agenda.setup.ts` siembra el centro) |
| El gate de contraste mide 8 estados de pantalla fijos; una cabecera nueva puede no estar en ninguno | UX-01 agrega la cabecera y las pestañas a los estados de `e2e/support/contraste.ts` |
| Dos estéticas conviven durante meses | Aceptado por diseño: el orden por frecuencia hace que lo más usado se vea nuevo primero. UX-10 cierra el resto |
| El texto didáctico codifica reglas que la tesis defiende | No se borra: se pliega. Cada `nota-clave` que se esconde queda accesible con un clic en el mismo lugar |
| Un "rediseño" que termina tocando lógica | Regla 5 de §2 y punto 3 de §6: el diff lo delata y el PR lo declara |
| Angular 22 (Dependabot #84) entra en el medio | DP-41 lo pone después del RC. Si entrara antes, UX-02 se rebasa; los componentes son standalone y no dependen de nada que cambie en v22 |

---

## 8. Cómo regenerar las capturas

Con el backend y el frontend levantados (`docker compose up -d` en `appKine-api`, `npm start`
acá) y Mailpit del stack en uso:

```bash
AKINE_E2E_MAILPIT=http://localhost:8025 npx playwright test --project=agenda-setup
```

Eso deja el centro sembrado en `%TEMP%\akine-e2e-centro-agenda.json`. Un script de Playwright
que inicia sesión con `emailAdmin` y la contraseña de `e2e/support/akine.ts`, y hace
`page.screenshot({ fullPage: true })` por cada ruta a 1366 × 768, produce el set del
relevamiento. Las capturas no se commitean; van en el PR como adjunto.

---

## 9. Decisiones que necesita el usuario antes de UX-01

1. **Agrupación del menú** (§5, UX-01): ¿los seis grupos propuestos, u otros? ¿"Atención" va
   dentro de Operación o es grupo propio para el profesional?
2. **Notas didácticas:** plegadas en su lugar (propuesta), o movidas a una página de ayuda
   única por sección.
3. **Iconografía:** sin íconos (como hoy), SVG inline propios (sin dependencia, ~20 íconos), o
   una librería (Lucide, ~1 kB por ícono usado). Propuesta: **SVG inline propios**, solo para
   estado vacío, menú de fila, navegación plegada y badges; nunca como decoración.
4. **Tipografía:** seguir con `system-ui` (propuesta: sí; es la única que no agrega descarga y
   el contraste ya está medido con ella).
5. **Panel lateral vs. pantalla completa** para el detalle de un paciente desde el padrón
   (UX-04): la propuesta es ambos (panel para consultar, pantalla para operar).
