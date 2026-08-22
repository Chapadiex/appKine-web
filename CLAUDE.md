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

**AKINE-00.01 completada y verificada.**

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
        │   ├── services/     auth-token.store.ts · tenant-context.store.ts
        │   ├── interceptors/ auth.interceptor.ts · error.interceptor.ts
        │   ├── guards/       (vacío hasta F1)
        │   └── models/       (vacío hasta F1)
        ├── shared/{components,pipes,directives}/
        └── features/                  # una carpeta por dominio, desde M01
```

```bash
npm start
```
Dev server en `http://localhost:4200` **con el proxy ya aplicado**. Usar siempre este
script, nunca `ng serve` pelado: sin el proxy, `/api` no resuelve.

```bash
npm run test:ci
```

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

### Próximo paso — etapa AKINE-00.02

- [ ] Commit inicial, remote de GitHub y protección de rama en `main`
- [ ] Activar el job E2E del pipeline (listo y comentado — espera la imagen Docker del backend)
- [ ] ESLint + `angular-eslint` (hoy solo hay Prettier)
- [ ] Umbral de cobertura al 80 %
- [ ] Completar los `PENDIENTE` de `.claude/qa-config.md`

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
