# Calidad de dependencias y análisis estático (AKINE G-6)

Tres cosas que vigilan el frontend sin que nadie tenga que acordarse de mirarlas. El backend tiene
las mismas, con el detalle de JaCoCo, en `appKine-api/docs/calidad.md`.

## Dependabot — `.github/dependabot.yml`

Una corrida por semana (lunes 06:00, hora de Córdoba) para `npm`, GitHub Actions y las imágenes
base del `Dockerfile`.

- **Angular va en un grupo propio.** `@angular/*` se declaran peer de la misma versión exacta:
  actualizados por separado, `npm ci` falla con `ERESOLVE`. Pasó al armar este PR.
- El resto de las menores y parches de `npm` llegan **en un solo PR**; las mayores, de a una.
- TypeScript y las mayores de Node no los sube Dependabot: los fija Angular y `NODE_VERSION`.
- Tope de PRs abiertos por ecosistema: 5 (`npm`), 3 (Actions), 2 (Docker). Las actualizaciones
  **de seguridad** no respetan ni el grupo ni el horario.

> Las *alertas* de Dependabot (no los PRs de versión) se encienden en
> **Settings › Code security › Dependabot alerts / security updates**. Es un ajuste del repositorio
> y no se versiona: lo tiene que activar quien administra el repo.

## `npm audit` en el CI

Paso del job `build`, después de `npm ci`:

```bash
npm audit --omit=dev --audit-level=high
```

- `--omit=dev`: sólo lo que viaja al navegador. El tooling (CLI, generador de cliente, Vitest,
  Playwright) no llega al bundle.
- `--audit-level=high`: falla por altas y críticas; las moderadas no frenan el merge.

### Estado al 09/10/2026

- **Producción: 0 vulnerabilidades**, después de subir Angular de `21.2.21` a `21.2.25`
  (`@angular/build` y `@angular/cli` a `21.2.26`). La alta era
  [GHSA-ff3f-86qr-9cv3](https://github.com/advisories/GHSA-ff3f-86qr-9cv3) en `@angular/router`
  (DoS en SSR; AKINE no usa SSR, pero el bump es un parche).
- **Desarrollo: 5 altas, todas de una sola cadena** — `@openapitools/openapi-generator-cli` →
  `proxy-agent` → `pac-proxy-agent` → `get-uri` → `basic-ftp` ≤ 6.2.0
  ([GHSA-c475-qrg2-pj4r](https://github.com/advisories/GHSA-c475-qrg2-pj4r)). **No tiene bump
  simple**: `get-uri` pide `basic-ftp ^5` y la corrección está en la 6; `npm audit fix --force`
  propone *bajar* el generador a 2.14.0, que es una mayor hacia atrás. Sólo corre en
  `npm run api:generate`, en la máquina del desarrollador y en el job `contrato`, nunca en el
  bundle. Queda como decisión: un `overrides` a `basic-ftp@^6` (cruza una mayor que `get-uri` no
  declara) o esperar a que el generador actualice su cadena.

## SonarQube — job `sonar` del `ci.yml`

Listo y **apagado**: el job corre siempre, comprueba si existen los secretos y, si no, termina en
verde con un aviso.

Para activarlo, en **Settings › Secrets and variables › Actions** del repositorio:

| Secreto | Valor |
|---|---|
| `SONAR_TOKEN` | Token de análisis (SonarQube: *My Account › Security*; SonarCloud: igual) |
| `SONAR_HOST_URL` | URL de la instancia, p. ej. `https://sonarcloud.io` |

El proyecto se llama `akine-web`. No vuelve a correr los tests: reusa el `lcov.info` que publica
`build` en el artifact `coverage-report`. El cliente generado queda fuera del análisis y de la
cobertura, igual que en `angular.json`. Con SonarCloud hace falta además
`-Dsonar.organization=<org>` en los `args` del paso.
