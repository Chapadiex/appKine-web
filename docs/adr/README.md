# Architecture Decision Records — appKine-web

Registro de decisiones arquitectónicas del frontend de AKINE.

Un ADR captura **una decisión, su contexto y sus consecuencias** en el momento en que se
tomó. No documenta cómo funciona el sistema —eso está en `AGENT.md` y en el código— sino
**por qué es así y qué se descartó**.

## Reglas

1. **Un ADR por decisión.**
2. **Los ADR aceptados no se editan.** Si una decisión cambia, se escribe uno nuevo que la
   supersede y se marca el anterior como `Superseded by ADR-XXXX`. Reescribir el registro
   destruye justamente lo que lo hace útil.
3. Numeración correlativa, sin reutilizar números.
4. **Las alternativas descartadas son obligatorias.** Un ADR sin alternativas no explica nada.
5. **Las consecuencias incluyen las malas.** Un ADR que solo lista ventajas es marketing.

## Índice

| ADR | Título | Estado | Etapa |
|---|---|---|---|
| [0001](0001-token-en-memoria-refresh-en-cookie-httponly.md) | Access token en memoria, refresh en cookie httpOnly | Aceptado | AKINE-00.01 |
| [0002](0002-cliente-api-generado.md) | Cliente API generado, con DTO manuales prohibidos | Aceptado | AKINE-00.01 |
| [0003](0003-proxy-de-dev-sin-url-de-api-versionada.md) | Proxy de desarrollo en lugar de una URL de API versionada | Aceptado | AKINE-00.01 |
| [0004](0004-estructura-core-shared-features.md) | Estructura `core`/`shared`/`features` y contexto multi-tenant | Aceptado | AKINE-00.01 |
| [0005](0005-estados-obligatorios-y-accesibilidad.md) | Estados obligatorios de pantalla y accesibilidad AA | Aceptado | AKINE-00.02 |

## Decisiones que viven en el backend

Estas afectan al frontend pero se decidieron —y se documentan— en `appKine-api/docs/adr/`:

| ADR | Título | Por qué importa acá |
|---|---|---|
| 0002 | Contrato OpenAPI code-first con gate de drift | Define cómo y cuándo se regenera el cliente |
| 0005 | Errores como RFC 7807 Problem Details | Es el formato que consume `error.interceptor.ts` |

> Las decisiones de producto `DP-01`–`DP-09` del plan se formalizan como ADRs en la etapa
> **AKINE-00.03**.

## Plantilla

```markdown
# ADR-XXXX — Título en una línea

- **Estado:** Propuesto | Aceptado | Superseded by ADR-YYYY | Deprecado
- **Fecha:** AAAA-MM-DD
- **Etapa:** AKINE-XX.YY

## Contexto
## Decisión
## Alternativas consideradas
## Consecuencias
### Positivas
### Negativas
### Qué obliga a hacer
```
