# CLAUDE.md — appKine-web

Workflow de trabajo y comportamiento esperado del agente en el frontend de AKINE.

> **Reglas técnicas y de negocio: `AGENT.md`.** Leerlo completo antes de cualquier tarea.
> Este archivo define *cómo* trabajar, no *qué* construir.

---

## 1. Protocolo de sesión inicial

1. `/caveman` — activar modo de ahorro de tokens.
2. `mem_search` con keywords del tema (Engram) — recuperar contexto de sesiones anteriores.
3. Leer `AGENT.md` completo (o confirmarlo en memoria).
4. Verificar estado del repo — correr tests antes de tocar código.
5. **Verificar que la rama coincide con la del backend** si vas a probar contra la API.
6. Identificar el próximo paso — ver §7 "Estado actual".

## 2. Skills instaladas y sus triggers

### Plugin `superpowers` (v6.3.0)

| Skill | Cuándo se usa |
|---|---|
| `superpowers:brainstorming` | **Obligatorio** antes de cualquier trabajo creativo: pantalla nueva, componente, cambio de comportamiento |
| `superpowers:writing-plans` | Ya hay spec/requisitos y falta el plan, antes de tocar código |
| `superpowers:executing-plans` | Ejecutar un plan escrito con checkpoints de revisión |
| `superpowers:test-driven-development` | **Obligatorio** al implementar feature o bugfix — tests primero |
| `superpowers:systematic-debugging` | **Obligatorio** ante cualquier bug o comportamiento inesperado, antes de proponer un fix |
| `superpowers:subagent-driven-development` | Tareas independientes dentro de la misma sesión |
| `superpowers:dispatching-parallel-agents` | 2+ tareas sin estado compartido |
| `superpowers:using-git-worktrees` | Trabajo que necesita aislamiento del workspace principal |
| `superpowers:requesting-code-review` | Al completar tareas o antes de mergear |
| `superpowers:receiving-code-review` | Al recibir feedback de un PR |
| `superpowers:finishing-a-development-branch` | Implementación completa, tests en verde |
| `superpowers:verification-before-completion` | **Obligatorio** antes de decir "listo" o "funciona" — evidencia antes de afirmar |

### Skills globales (`~/.claude/skills/`)

| Skill | Trigger |
|---|---|
| `engram-sdd-flow` | Cambios no triviales — ciclo explore → propose → apply → verify → archive |
| `debugging-code` | Debugger interactivo, inspección de estado en runtime |
| `playwright-skill` | Tests E2E y de API con Playwright |

### Skills built-in relevantes al frontend

| Skill / comando | Uso |
|---|---|
| `/caveman` | Modo ahorro de tokens (~75 %) |
| `/simplify` | **Obligatorio** después de implementar: reuso, simplificación, eficiencia |
| `/code-review` | Review de correctitud sobre el diff, un PR o una rama |
| `/security-review` | Review de seguridad de los cambios pendientes |
| `/run` | Levantar la app y verificar un cambio en la app real |
| `dataviz` | **Antes de escribir cualquier gráfico o dashboard** (M23 Reportes) |
| `artifact-design` | Antes de publicar cualquier artifact de diseño |
| `design` | Mockups y wireframes multi-artboard antes de implementar una pantalla |

### Plugin `playwright` (MCP)

Browser automation para QA y E2E. Herramientas `mcp__plugin_playwright_playwright__*`.

### Plugin `engram` — memoria persistente

`mem_save`, `mem_search`, `mem_context`, `mem_session_summary`. Ver §5.

> **No existen** `/sdd-new`, `/sdd-apply`, `/sdd-ff`, `/sdd-archive` ni la skill `judgment-day`
> en esta instalación. El ciclo SDD corre por `engram-sdd-flow` y el paso adversarial de
> diseño está definido explícitamente en §3.

## 3. Workflow — Spec Driven Development

Todo cambio no trivial pasa por exploración y especificación antes de tocar código.

### Ciclo canónico

```
brainstorming → explore → propose → spec → design → DESIGN CHALLENGE
              → tasks → apply (TDD) → /simplify → verify
              → verification-before-completion → archive
```

| Fase | Qué produce | Herramienta |
|---|---|---|
| brainstorming | Intent y requisitos explorados antes de comprometerse | `superpowers:brainstorming` — **obligatorio** |
| explore | Análisis del código, del RF/CA aplicable y del contrato disponible | `engram-sdd-flow` |
| propose | Propuesta con intent, scope y enfoque | `engram-sdd-flow` |
| spec | Requisitos y escenarios trazados a `RF-MXX-NNN` / `CA-MXX-NNN-YY` | `engram-sdd-flow` |
| design | Estructura de componentes, estado, rutas, contrato consumido | `engram-sdd-flow` + `AGENT.md` |
| **design challenge** | Revisión adversarial del diseño — ver abajo | **obligatorio**, paso manual |
| tasks | Checklist implementable y ordenada | `superpowers:writing-plans` |
| apply | Código real, tests primero | `superpowers:test-driven-development` |
| simplify | Reuso, simplificación, eficiencia, deuda | `/simplify` — **obligatorio** |
| verify | Tests + E2E + verificación en la app real | `/run`, Playwright, `/code-review` |
| verification-before-completion | Evidencia de completitud antes de cerrar | `superpowers:verification-before-completion` — **obligatorio** |
| archive | Cierre y persistencia del estado | `mem_save` + `mem_session_summary` |

### Design challenge — paso obligatorio al cerrar `design`

Antes de pasar a `tasks`, el agente debe desafiar su propio diseño respondiendo por escrito:

1. **Contrato** — ¿todos los datos que necesita esta pantalla existen en el cliente generado?
   ¿Estoy por escribir un DTO a mano? Si falta algo, **es un pedido al backend**, no un parche acá.
2. **Ubicación** — ¿esto va en `core/`, `shared/` o `features/`? ¿`shared/` está sabiendo
   de dominio?
3. **Zoneless / OnPush** — ¿el estado son signals? ¿Hay alguna mutación in-place que no
   dispare re-render?
4. **Contexto tenant** — ¿qué pasa con esta pantalla si el usuario cambia de Organización
   o de Consultorio? ¿Queda estado viejo en memoria?
5. **Permisos** — ¿estoy tratando un guard como si fuera seguridad? El backend rechaza igual.
6. **Reglas maestras** — ¿la pantalla confunde Turno con Sesión, HC con Caso, u Obligación
   con Cobro o Caja?
7. **Accesibilidad** — ¿navegable por teclado? ¿labels reales? ¿contraste AA?
8. **El caso que rompe la pantalla** — nombrar el escenario más adverso (lista vacía, error
   de red, token expirado a mitad de flujo, 500 campos) y decir cómo lo resuelve.

Si alguna respuesta es insatisfactoria, se vuelve a `design`. No se avanza a `tasks`.

### Flujos por tipo de tarea

**Pantalla o feature nueva**
```
/caveman → brainstorming → (design skill para mockup si aplica)
→ engram-sdd-flow (explore/propose/spec/design) → DESIGN CHALLENGE
→ writing-plans → TDD → /simplify → tests + E2E + /run → /code-review
→ verification-before-completion → mem_save
```

**Fix o cambio pequeño**
```
/caveman → systematic-debugging → test que reproduce → fix → /simplify → tests → mem_save
```

**Refactor o cambio complejo**
```
/caveman → brainstorming → using-git-worktrees → writing-plans → DESIGN CHALLENGE
→ executing-plans → /simplify → tests + E2E → /code-review
→ verification-before-completion → finishing-a-development-branch → mem_save
```

**Regeneración del cliente API**
```
backend publica akine-api.yaml vX.Y.Z → regenerar src/app/api/generated/
→ compilar (los breaking changes aparecen acá) → ajustar servicios de feature
→ tests + contract/E2E → actualizar la versión declarada del contrato
```
Nunca editar el cliente generado a mano. Nunca asumir commit atómico con el backend.

**Reportes y dashboards (M23)**
```
/caveman → dataviz (ANTES de escribir la primera línea de gráfico) → brainstorming → ...
```

## 4. Protocolo de cambios

- **Nada de código sin un RF/CA que lo respalde.** Si no existe, se pregunta.
- **Tests primero.** TDD no es opcional.
- **El cliente generado no se edita.** Si falta un campo, se pide al backend.
- **Nada de DTO manuales duplicados.**
- **Signals para el estado.** Zoneless + OnPush: mutar no re-renderiza.
- **`shared/` sin reglas de dominio.**
- Accesibilidad AA en cada pantalla nueva.
- Datos sintéticos únicamente. Jamás datos reales de pacientes.
- Sin secretos en el bundle.
- `main` siempre desplegable. Trabajo incompleto detrás de feature flag.
- Commits y PRs en prosa normal, no en caveman.

## 5. Memoria — Engram

### Guardar (`mem_save`) — proactivamente, sin que lo pidan

Inmediatamente después de: decisión de arquitectura o UX, convención establecida, bug fijado
(con causa raíz), elección de librería con tradeoffs, descubrimiento no obvio, gotcha de
Angular 21 / zoneless, patrón de naming o estructura, preferencia del usuario.

Auto-check después de cada tarea:
*"¿Tomé una decisión, fijé un bug, aprendí algo no obvio o establecí una convención?
Si sí → `mem_save` ahora."*

Tipos: `bugfix`, `decision`, `architecture`, `discovery`, `pattern`, `config`, `preference`.

### Topic keys estables

```
akine/web/{feature}/design
akine/web/{feature}/decisions
akine/web/etapa/{AKINE-XX.YY}
akine/web/gotchas
akine/contract/openapi
```

### Buscar (`mem_search`)

Al inicio de sesión, antes de empezar algo que pudo hacerse antes, y cuando el usuario dice
"recordá", "qué hicimos", "cómo resolvimos".

### Cierre de sesión (`mem_session_summary`) — obligatorio antes de decir "listo"

Goal · Discoveries · Accomplished · Next Steps · Relevant Files.

### Después de compactación de contexto

1. `mem_session_summary` con el contenido compactado.
2. `mem_context` para recuperar sesiones anteriores.
3. Recién entonces continuar.

## 6. QA manual y gate de deploy

`.claude/qa-config.md` es **bloqueante**: sin él no corre el QA manual post-verify y no se
puede deployar ni pushear a `main`.

Es personal de cada máquina y está **gitignored**.
Template: `~/.claude/templates/qa-config-template.md`.

Reglas innegociables del QA:
- **Mismo branch que el backend.** Si no, se prueban dos versiones distintas.
- Validación de persistencia **contra la DB directamente** después de cada write/update/delete.
  Un `200` en la Network tab no prueba que el dato quedó bien guardado.
- Verificar aislamiento de tenant: cambiar de Organización no debe dejar datos de la anterior
  en pantalla ni en memoria.
- **No maquillar la DB para forzar estados.** Si un flujo no llega, se registra como hallazgo.
- Si hay Local API Switch, cambiarlo a localhost antes de probar y **revertirlo siempre**
  al terminar, haya pasado o fallado el QA.

## 7. Estado actual

**Rama `akine-01.02-identidad`, 24 commits, working tree CON cambios sin commitear** (30/08/2026).
Cerradas 00.01, 00.02, 01.01, 01.02, 01.03, 02.01, 02.02, 02.03, 02.04, 02.05 y 02.06; 03.01 está
commiteada pero **no declarada cerrada**. Cliente generado y fijado en el contrato **0.13.0**.
**640 tests en 74 archivos**, lint limpio y los cuatro pisos de cobertura sobre 80 % (rama en
80,39 %, que es el más ajustado).

Features: `auth`, `organization`, `platform`, `resource`, `catalog`, `offering`, `person`.

> **Hay dos cosas distintas sin commitear en el árbol de trabajo.** Una es el frontend de **02.07**
> —la pantalla de habilitaciones de la oferta y los cambios de `offering`—, que quedó a medio hacer
> cuando esa etapa se escribió en paralelo con 03.01. La otra es la corrección del motivo opcional
> del 30/08 que describe el bloque de abajo. **No las mezcles en un commit.**

> **El motivo de la confirmación era obligatorio siempre, y eso dejaba una acción inejecutable.**
> `shared/components/confirmacion-con-motivo` tenía `Validators.required` fijo en el control. Las
> cuatro pantallas de baja que lo usan lo querían así, pero el padrón de personas rotula su campo
> "Motivo (opcional)" —el contrato lo declara `NOT_REQUIRED`— y con el campo vacío el botón no
> emitía nada: sin petición, sin error en consola, sin síntoma. RF-M07-008 no se podía ejecutar
> desde la pantalla. Ahora hay un input `motivoObligatorio` que **por defecto vale `true`**, y el
> validador se aplica en un `effect`: el valor de un signal input no está disponible en el
> inicializador del `FormControl`.
>
> **La lección es de dónde salió el hueco.** El spec del padrón verificaba el *texto* del panel y
> nunca enviaba el formulario; y ninguna de las cuatro pantallas de baja afirmaba que el motivo
> vacío **bloquea** el envío. Un test que mira lo que la pantalla dice no prueba lo que la pantalla
> hace.

> **Los bloques de abajo son el registro por etapa y quedaron congelados en su fecha.** Los
> números de 01.02 —"3 commits", "sin commitear", cobertura del momento— describen ese cierre y
> no el estado de hoy: el de hoy es el párrafo de arriba. Mapa verificado del proyecto:
> `../docs/PROJECT_MAP.md`.

> **Sin E2E desde 01.02.** `e2e/` sigue teniendo los mismos cuatro archivos —`auth-flujo`,
> `contexto-sin-fuga`, `errores-sin-internals` y `smoke`— y ninguna de las pantallas de espacios,
> catálogo, horarios ni servicios está cubierta. No es que no se corrieron: no existen.

> **El contraste de color no está verificado en ninguna parte.** La regla `color-contrast` de axe
> vuelve siempre `incomplete` bajo jsdom, que no calcula layout. Vale para todas las auditorías de
> accesibilidad del repositorio.

### AKINE-00.01 — completada y verificada

Stack fijado: Angular **21.2.6** · Node 24.13 · npm 11.6 · Vitest 4 · Playwright ·
cliente generado con openapi-generator **7.24.0** (`typescript-angular`).

Evidencia: build OK · 4 tests unitarios · **5 E2E en verde contra el stack real**
(MySQL + Spring Boot + Angular).

<!-- PENDIENTE: agregar el remote de GitHub cuando se configure (el backend ya tiene
     https://github.com/Chapadiex/appKine-api.git) -->

### Rutas y comandos reales

```
appKine-web/
├── angular.json · package.json · tsconfig*.json
├── proxy.conf.json                    # /api → localhost:8080
├── openapi-generator.json             # config del generador
├── playwright.config.ts
├── scripts/check-contract-version.mjs
├── .prettierignore                    # excluye el cliente generado
├── .github/workflows/ci.yml
├── e2e/smoke.spec.ts
└── src/
    ├── environments/environment.ts · environment.prod.ts
    └── app/
        ├── app.ts · app.html · app.css · app.config.ts · app.routes.ts · app.spec.ts
        ├── api/generated/             # NO SE EDITA
        ├── core/
        │   ├── services/     auth-token.store.ts · tenant-context.store.ts · session.service.ts
        │   ├── interceptors/ auth.interceptor.ts · error.interceptor.ts
        │   ├── guards/       auth.guard.ts · context.guard.ts
        │   └── models/       rutas.ts
        ├── shared/{components,pipes,directives}/ · shared/pages/not-found/
        └── features/
            ├── auth/          # M02 — 7 pantallas (01.02)
            ├── organization/  # M01 — 3 pantallas (01.01)
            └── platform/      # pantalla de estado del baseline
```

```bash
npm start
```
Dev server en `http://localhost:4200` **con el proxy ya aplicado**. Usar siempre este
script, nunca `ng serve` pelado: sin el proxy, `/api` no resuelve.

```bash
npm run test:ci
```
Unitarios + **gate de cobertura** (falla bajo 80 %).

```bash
npm run lint
```
Incluye las reglas propias de AKINE y las de accesibilidad de plantilla.

```bash
npm run build
```

```bash
npm run api:generate
```
Regenera el cliente desde `../appKine-api/openapi/akine-api.yaml`.

```bash
npm run api:check
```
Verifica que `contractVersion` de `environment.ts` coincida con el contrato del backend.

```bash
npm run e2e
```
Requiere backend levantado. Playwright arranca el frontend solo.

### Decisiones de AKINE-00.01

| Decisión | Elección | Por qué |
|---|---|---|
| Local API Switch | **Proxy de dev** (`proxy.conf.json`) | Imposible commitear una URL de localhost. Nada que revertir tras el QA |
| JWT | **Access en memoria + refresh en cookie httpOnly** | AKINE maneja historia clínica: un XSS no puede leer memoria ni una cookie httpOnly |
| Generador | openapi-generator `typescript-angular` | El más maduro, output nativo de Angular |
| Change detection | Zoneless + signals, declarado explícito | Default de Angular 21 |

> **Cuidado con el cliente generado y Prettier.** `src/app/api/generated/` está en
> `.prettierignore` a propósito: si Prettier lo reformatea, el gate de drift de CI falla
> en cada corrida porque el generador produce otro formato.

### AKINE-00.02 — completada

- [x] Commit inicial del baseline en `main`
- [x] **ESLint + `angular-eslint`**, con reglas propias de AKINE
- [x] **Umbral de cobertura al 80 %** (`scripts/check-coverage.mjs`). Medido: **98,7 %**
- [x] **Estructura de rutas y layout**: `App` es layout puro, páginas en `features/`, ruta 404
- [x] Tests de `core/`: stores de token y contexto tenant, ambos interceptores
- [x] **ADRs** en `docs/adr/` — 5 decisiones
- [x] Reporte reproducible: `../docs/baseline-report.md`

**37 pruebas** (30 unitarias + 7 E2E). Cobertura 98,7 % statements, 92,3 % branches.

Reglas de lint propias:

| Regla | Qué previene |
|---|---|
| `no-restricted-globals` sobre `localStorage`/`sessionStorage` | Que el token de historia clínica quede legible para un XSS (ADR-0001) |
| `no-console` (salvo `warn`/`error`) | Un dato clínico en la consola del navegador |
| `templateAccessibility` | Incumplir WCAG 2.1 AA |

> El cliente generado está excluido de ESLint **y** de Prettier. Lintearlo o formatearlo
> rompe el gate de drift del pipeline en cada corrida.

### AKINE-01.01 — completada

Commit `9c3697c`. Primera feature de negocio: `features/organization` con tres pantallas
(`context-selector`, `organization`, `subscription`), cliente regenerado desde el contrato
**0.2.0** y 9 specs unitarias más la E2E.

> Ninguna de las tres pantallas era ejercitable de punta a punta al cerrar la etapa: sin login
> no había forma de obtener un contexto. Eso lo destraba 01.02.

### AKINE-01.02 — construida, sin commitear

Feature `auth` (M02) con **7 pantallas**: `ingresar`, `registro`, `activar`,
`reenviar-activacion`, `olvide-mi-contrasena`, `restablecer`, `sesion-expirada`. Se monta bajo
`/auth` con `loadChildren` y **sin guards**: son las únicas rutas que un usuario anónimo tiene
que poder abrir, y los enlaces de correo entran por `auth/activar` y `auth/restablecer`.

`core/services/session.service.ts` concentra la sesión: canje del refresh con **cola
single-flight** (`refreshEnVuelo`, línea 79) y rotación estricta del lado del backend
(documentada en la línea 137). `core/guards/auth.guard.ts` y `context.guard.ts` quedan
cableados en `app.routes.ts`: `authGuard` en `/seleccionar-contexto`, los dos en
`/organizacion`.

Cliente regenerado desde el contrato **0.3.0** (5 servicios y 12 modelos nuevos),
`contractVersion` subido en ambos `environment*.ts`.

**20 specs · 169 `it()`.** Cobertura del reporte en `coverage/akine-web/coverage-summary.json`:
**97,14 % statements · 97,45 % líneas · 97,85 % funciones · 88,98 % ramas**. Los E2E siguen
siendo 7 `test()` en `e2e/smoke.spec.ts`: **ningún flujo de auth está cubierto por E2E**.

> **El repo no tiene ningún commit de 01.02**: 64 rutas sin commitear en la rama
> `akine-01.02-identidad`. El cliente generado apunta a un contrato 0.3.0 que el backend
> tampoco commiteó todavía; la regla de coordinación §4 del workspace pide publicar primero
> del lado del backend.

Reglas que esta etapa dejó fijadas y que las siguientes heredan:

| Regla | Por qué |
|---|---|
| Las rutas de `auth` van **sin guards** | Un `authGuard` ahí deja la aplicación sin ninguna ruta alcanzable sin sesión |
| El token de la URL (`?token=...`) **no se persiste** en ninguna de las dos pantallas de correo | Es lo único que un correo puede abrir; guardarlo lo deja sobreviviendo a la navegación |
| Un solo canje de refresh en vuelo: **cola single-flight** en `SessionService` | La rotación del backend invalida el refresh presentado; dos canjes en paralelo se pisan y cierran la sesión |
| Los guards son **UX, no seguridad** | La autoridad de permisos es el backend, que rechaza igual si se llega por URL directa |
| Falta de contexto se resuelve mandando a `/seleccionar-contexto`, no mostrando un 403 | Sin eso la pantalla se abre vacía y el usuario no tiene cómo salir |

### Próximo paso — cerrar 03.01, o el frontend de 02.07

Para cerrar **03.01** falta una sola cosa y es de entorno: el quinto escenario del QA manual
—activar el perfil de paciente— **contra MySQL**. El defecto de código que lo bloqueaba ya está
corregido y verificado en un navegador real contra la API simulada; lo que no arranca es el motor
de Docker de esta máquina (`com.docker.service` detenido y la distro WSL `docker-desktop` también,
y levantar ese servicio **exige elevación**).

El frontend de **02.07** sigue a medio hacer y sin commitear.

Pendientes que arrastra el frontend:

- [ ] E2E de todo lo posterior a 01.03: espacios, catálogo, horarios, servicios y padrón. **Ninguno existe**
- [ ] Remote de GitHub y protección de rama en `main`
- [ ] Activar el job E2E del pipeline (listo y comentado — espera la imagen Docker del backend)
- [ ] Regla de ESLint que prohíba imports entre features (ADR-0004, hoy depende de revisión)
- [ ] Completar los `PENDIENTE(F1)` de `.claude/qa-config.md`
- [ ] `src/app/features/organization/organization.routes.spec.ts` no pasa `format:check`. Preexistente, sin relación con ninguna etapa reciente
- [ ] Endpoint que diga si el usuario tiene rol de plataforma: sin él, la pantalla de servicios muestra las acciones y deja que el 403 del servidor sea la respuesta

## 8. Checklist de cierre de tarea

- [ ] Tests en verde (unit + componente)
- [ ] E2E en verde si el cambio toca un flujo completo
- [ ] Verificado en la app real (`/run` o Playwright), no solo en tests
- [ ] `/simplify` corrido
- [ ] `/code-review` sin hallazgos abiertos
- [ ] Cliente API regenerado si cambió el contrato
- [ ] Accesibilidad AA verificada en pantallas nuevas
- [ ] Local API Switch revertido si se tocó
- [ ] `superpowers:verification-before-completion` con evidencia real
- [ ] `mem_save` de decisiones y descubrimientos
- [ ] `mem_session_summary` antes de cerrar
