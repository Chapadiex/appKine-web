# AI Development Environment — Setup Guide (appKine-web)

Frontend de AKINE: SPA Angular 21 para centros de kinesiología, fisioterapia y rehabilitación.

Este documento configura el entorno de trabajo de tu IA para este repositorio. Pasáselo completo
al agente al inicio de la sesión si es la primera vez, o si necesita reconfigurar todo.

Al final de este setup tendrás:
- Plugins y skills de productividad instaladas
- Workflow SDD activo para cualquier cambio no trivial
- Contexto completo del proyecto cargado en memoria

---

## Quick path

1. Instalá los plugins requeridos
2. Instalá las skills globales
3. Verificá que el repo tiene `CLAUDE.md` y `AGENT.md`
4. Cargá el contexto del proyecto desde Engram
5. Verificá el estado inicial del repo
6. Creá tu `.claude/qa-config.md` local (requerido para QA manual y deploy)

---

## 1. Plugins requeridos

> **Agente: instalalos vos.** No le pidas al usuario que abra `/plugin` ni que los instale a mano.
> Corré los comandos, verificá el resultado, y solo escalá al usuario si un comando falla.

Verificar primero qué hay instalado:

```bash
claude plugin list
```

### superpowers — workflow skills (brainstorming, TDD, planes, reviews)

```bash
claude plugin install superpowers@claude-plugins-official
```

### engram — memoria persistente entre sesiones

```bash
claude plugin marketplace add Gentleman-Programming/engram
```

```bash
claude plugin install engram@engram
```

### playwright — browser automation para QA y E2E

**Crítico en este repo.** Los E2E de AKINE corren con Playwright.

```bash
claude plugin install playwright@claude-plugins-official
```

### caveman — ahorro de tokens (~75 %)

```bash
claude plugin marketplace add JuliusBrussee/caveman
```

```bash
claude plugin install caveman@caveman
```

Después de instalar, los plugins se activan al reiniciar la sesión de Claude Code.

---

## 2. Skills globales a instalar

Van en `~/.claude/skills/` (globales, disponibles en cualquier proyecto).

### engram-sdd-flow — ciclo Spec Driven Development

No viene incluida en el plugin `engram` (v0.1.1 solo trae la skill `memory`). Se copia desde
el marketplace ya clonado:

```bash
mkdir -p ~/.claude/skills/engram-sdd-flow && cp ~/.claude/plugins/marketplaces/engram/skills/sdd-flow/SKILL.md ~/.claude/skills/engram-sdd-flow/SKILL.md
```

### playwright-skill — tests E2E y de API

```
Instalá la skill playwright-skill de testdino-hq en ~/.claude/skills/playwright-skill/SKILL.md

Contenido del SKILL.md: fetchealo de
https://raw.githubusercontent.com/testdino-hq/playwright-skill/main/SKILL.md
```

### debugging-code — debugger interactivo

```
Instalá la skill debugging-code de AlmogBaku/debug-skill en ~/.claude/skills/debugging-code/SKILL.md

Contenido del SKILL.md: fetchealo de
https://raw.githubusercontent.com/AlmogBaku/debug-skill/main/skills/debugging-code/SKILL.md
```

### Templates del entorno de IA

```bash
mkdir -p ~/.claude/templates && cp ../templates/*.md ~/.claude/templates/
```

---

## 3. Verificación de archivos del repo

| Archivo | Propósito |
|---|---|
| `AGENT.md` | Lineamientos técnicos y de negocio. Leerlo completo antes de cualquier tarea. |
| `CLAUDE.md` | Workflow, skills activas, protocolo de cambios, estado actual. |
| `docs/ai-setup.md` | Esta guía. |
| `.claude/qa-config.md` | Config local de QA. **Gitignored.** Sin él no hay QA manual ni deploy. |
| `../CLAUDE.md` | Índice del workspace y regla de coordinación entre repos. |
| `../../appKine-api/docs/producto/` | Especificación funcional canónica y plan de implementación. |
| `../../appKine-api/docs/producto/plan_sesiones.txt` | Rediseño clínico/UX de la Sesión (M14). Obligatorio antes de tocar esa pantalla. |

Verificación rápida:

```bash
ls AGENT.md CLAUDE.md docs/ai-setup.md .claude/qa-config.md
```

---

## 4. Contexto del proyecto (Engram)

Antes de responder cualquier cosa, buscar contexto:

```
mem_search("AKINE frontend Angular 21 arquitectura")
mem_search("AKINE contexto tenant autenticacion")
mem_search("appKine-web CLAUDE.md workflow")
```

Si no hay memorias: leer `AGENT.md` completo, luego `CLAUDE.md`, luego
`../../appKine-api/docs/producto/AKINE_IMPLEMENTATION_PLAN.md`.

---

## 5. Estado del repo — verificación inicial

**Estado actual: greenfield.** Rama `main`, cero commits, sin `package.json` ni código.
No hay tests que correr todavía.

Una vez creado el proyecto en la etapa AKINE-00.01:

```bash
npm test
```

```bash
npx playwright test
```

Si los tests fallan antes de tocar código, reportarlo inmediatamente.

<!-- PENDIENTE: reemplazar por los scripts exactos una vez que exista el package.json (AKINE-00.01) -->

---

## 6. QA config — validación funcional

El QA manual y el gate de deploy **se bloquean** si no existe `qa-config.md`.

Orden de búsqueda:
1. `.claude/qa-config.md` (recomendado — local, **gitignored**)
2. `docs/qa-config.md`
3. `qa-config.md` (raíz)

Es **personal de cada máquina**. Cada integrante crea el suyo desde
`~/.claude/templates/qa-config-template.md`.

Reglas de uso durante el QA:
- **Este repo y `appKine-api` deben estar en la misma rama.** Verificar antes de arrancar.
- Si hay Local API Switch definido, el agente lo cambia a localhost **antes** de probar y lo
  **revierte siempre** al terminar — haya pasado o fallado el QA.
- La validación de persistencia es innegociable: después de cada write/update/delete, consultar
  la DB directamente. Un `200` en la Network tab no prueba que el dato quedó bien guardado.
- Verificar aislamiento de tenant al cambiar de Organización: no puede quedar estado viejo.
- No maquillar la DB para forzar estados: si un flujo no llega, se registra como hallazgo.

---

## Resumen del proyecto

**Qué es:** SPA de AKINE, SaaS multi-tenant para centros de kinesiología, fisioterapia,
rehabilitación y actividades de salud/bienestar. Interfaz para pacientes, profesionales,
administrativos y propietarios de organización. Consume **exclusivamente** la API REST
de `appKine-api`.

**Regla central:** el backend es la autoridad. La interfaz no puede elevar privilegios ni
saltear una validación — ocultar un botón es UX, no seguridad. Y el cliente API es
**generado desde el contrato**: nada de DTO manuales duplicados.

**Stack:** Angular 21 (zoneless, standalone, OnPush por defecto) · npm · Vitest ·
Playwright · cliente TS generado desde OpenAPI 3 · WCAG 2.1 AA ·
GitHub Actions + SonarQube · Docker.

**Arquitectura:**

```
src/app/
├── core/            # singletons: auth, contexto tenant, interceptors, guards
├── shared/          # standalone reutilizables — SIN reglas de dominio
├── features/        # una carpeta por dominio, lazy loaded
└── api/generated/   # cliente generado — NO SE EDITA A MANO

feature → shared / core / api      (permitido)
feature → otro feature             (prohibido)
shared  → dominio                  (prohibido)
```

**Features (alineadas a los módulos backend):**
`identity` · `organization` · `resource` · `person` · `contracting` · `clinical` ·
`scheduling` · `billing` · `offering` · `activity` · `notification` · `reporting`

MVP inicial: M01–M27. Segunda entrega obligatoria: M28–M29 (clases, inscripciones,
asistencias, pases y abonos).

**Gotchas de Angular 21 que rompen hábitos de v17/v18:**
zoneless por defecto (signals manejan el CD) · `OnPush` es el default (mutar no re-renderiza) ·
Vitest en lugar de Karma · sin sufijo `.component` en los nombres de archivo ·
`public/` en lugar de `src/assets`.

---

## Workflow — Spec Driven Development

Todo cambio no trivial sigue este ciclo. No escribir código sin exploración y especificación.

```
brainstorming → explore → propose → spec → design → DESIGN CHALLENGE
              → tasks → apply (TDD) → /simplify → verify
              → verification-before-completion → archive
```

Pasos obligatorios en todo flujo no trivial:
- `superpowers:brainstorming` antes de empezar cualquier trabajo creativo — siempre
- **Design challenge** al cerrar la fase design — las 8 preguntas de `CLAUDE.md` §3
- `superpowers:test-driven-development` durante `apply`
- `/simplify` después de `apply`, antes de `verify`
- `superpowers:verification-before-completion` antes de cerrar

```
# Pantalla o feature nueva
/caveman → brainstorming → (design para mockup) → engram-sdd-flow → DESIGN CHALLENGE
→ writing-plans → TDD → /simplify → tests + E2E + /run → /code-review
→ verification-before-completion → mem_save

# Fix o cambio pequeño
/caveman → systematic-debugging → test que reproduce → fix → /simplify → tests → mem_save

# Refactor o cambio complejo
/caveman → brainstorming → using-git-worktrees → writing-plans → DESIGN CHALLENGE
→ executing-plans → /simplify → tests + E2E → /code-review
→ verification-before-completion → finishing-a-development-branch → mem_save
```

**Regeneración del cliente API:** backend publica `akine-api.yaml` vX.Y.Z → regenerar
`src/app/api/generated/` → compilar (los breaking changes aparecen acá) → ajustar servicios
de feature → tests + contract/E2E → actualizar la versión declarada del contrato.
Nunca editar el generado a mano ni asumir commit atómico con el backend.

**Reportes y dashboards (M23):** invocar la skill `dataviz` **antes** de escribir la primera
línea de código de gráfico.

> `/sdd-new`, `/sdd-apply`, `/sdd-ff`, `/sdd-archive` y la skill `judgment-day` **no existen**
> en esta instalación. El ciclo SDD corre por `engram-sdd-flow`; el paso adversarial de diseño
> está definido explícitamente en `CLAUDE.md` §3 "Design challenge".

---

## Checklist de sesión inicial

- [ ] Plugins instalados: superpowers, engram, playwright, caveman
- [ ] Skills instaladas: engram-sdd-flow, playwright-skill, debugging-code
- [ ] `AGENT.md` leído
- [ ] `CLAUDE.md` leído
- [ ] `../../appKine-api/docs/producto/AKINE_IMPLEMENTATION_PLAN.md` consultado para la etapa en curso
- [ ] Contexto Engram cargado (o archivos leídos como fallback)
- [ ] Tests corriendo en verde — *N/A hasta AKINE-00.01*
- [ ] Rama coincidente con `appKine-api` si se va a probar contra la API
- [ ] `.claude/qa-config.md` creado (local, gitignored)
- [ ] Próximo paso identificado (ver "Estado actual" en `CLAUDE.md`)
