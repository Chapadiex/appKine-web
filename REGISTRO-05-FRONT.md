# Registro de cierre — frontend de AKINE-05.01 y 05.02 (agenda y reserva)

Worktree `.worktrees/web-agenda`, rama `akine-05-agenda`. Archivo aparte para que el carril
principal lo integre sin conflicto de merge.

- **Cliente regenerado y fijado en `0.15.0`** (era 0.13.0). Cambio puramente aditivo: dos servicios
  (`AgendaService`, `TurnosService`) y cinco modelos. Ningun tipo escrito a mano.
  `npm run api:check` **no corre desde un worktree**: asume `../appKine-api` como hermano.
- **Feature `scheduling`** con dos pantallas: `/agenda` (buscador) y
  `/agenda/ofertas/:ofertaId/reservar`. El slot elegido viaja en la query, no en el estado de
  navegacion, para sobrevivir a un refresh.
- **Ningun dia se omite y ningun slot se esconde.** Los nueve `motivoSinSlots` tienen texto propio
  que dice que hacer; el slot con `cupoLibre: 0` se dibuja marcado como completo. Sin
  `turno:manage` el hueco tambien se dibuja, sin ser accionable.
- **La ventana se recorta sola.** Un 400 `ventana-demasiado-amplia` con `maxDays` reemplaza `hasta`
  por `desde + maxDays` y reintenta, avisando. Sin `maxDays` no se inventa un ancho.
- **`timezone` se rotula y se usa**: los instantes UTC se formatean con `Intl` en la zona de la
  sede, no en la del navegador.
- **Los cinco conflictos van a cinco acciones distintas** (`models/agenda-errors.ts`):
  `slot-no-disponible` → recargar la agenda (muestra `motivo`); `slot-completo` → tomar el
  siguiente slot con cupo (muestra `cupoTotal`); `recurso-ocupado` → elegir otro horario o
  profesional (muestra `recurso`); `persona-sin-perfil-paciente` → enlace al padron;
  `idempotency-key-conflict` → reintento con clave nueva, declarando que no es error del usuario.
- **`idempotencyKey` por intento**, estable entre reintentos y regenerada al cambiar persona,
  horario o tras el 409 de clave reusada. **Sin cancelar ni reprogramar**: 05.03 esta fuera de
  alcance por DP-10 y el endpoint no existe.
- **Cero colores literales**: solo tokens de `design-system.css`; `grep` de `#rrggbb`/`rgb(` sobre
  `features/scheduling` da cero.
- **`npm run test:ci` VERDE — 689 tests en 79 archivos**, cobertura 87,37 st · **80,21 rama** ·
  85,57 fn · 88,44 ln, los cuatro gates arriba de 80. Lint limpio; `format:check` solo marca el
  `organization.routes.spec.ts` preexistente.
- **Pendiente para el carril principal:** enlace a `/agenda` desde la navegacion, E2E (ninguno
  existe desde 01.02), QA contra MySQL real —bloqueado por Docker en esta maquina— y contraste de
  color, que axe no verifica bajo jsdom.
