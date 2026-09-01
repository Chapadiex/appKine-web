# AKINE-06.05 + 07.01 — frontend

Cliente regenerado **0.17.0 → 0.19.0**, aditivo: `ObligacionesService` y cuatro modelos nuevos,
`Sesion` suma `numeroSesion`/`cerradaEn`/`cierre`, `ProblemType` suma los tres problemas nuevos.
Verificado a mano contra el YAML —`api:check` no corre desde un worktree—: 109 `operationId` en el
contrato y 109 métodos generados, `package.json` del cliente en 0.19.0, y ambos `environment*.ts`
declarando 0.19.0.

**Cierre (06.05)** — en la misma pantalla `/atencion/turnos/:turnoId`, sin ruta propia: lo que se
cierra es lo que se acaba de cargar. Obligatorios sólo `asistencia` y, con `PRESENTE`,
`notaDeCierre`; tolerancia, respuesta, indicaciones y próxima conducta van rotuladas "(opcional)"
y con `AUSENTE` no se pide nada más. **Modo lectura** derivado de `numeroSesion` —ausente = abierta,
según el contrato— y no de una bandera propia: así también entra en lectura cuando la cerraron desde
otra pestaña. Un 409 `sesion-cerrada` relee la sesión y la adopta entera; no ofrece reintentar.
Se muestra "Sesión número 8 de este paciente". **Nada de plata en la pantalla.**

**Cuenta corriente (07.01)** — `/pacientes/:personaId/cuenta-corriente`, feature `billing` propia,
declarada en `app.routes.ts` **antes** de `pacientes` (si no, `loadChildren` se queda con
`pacientes/**`). Se entra por un enlace en el padrón detrás de `*akinePermiso="cobro:register"`.
**No se agregó sección de navegación**: sin persona elegida no hay consulta que hacer.
Importes con `Intl.NumberFormat` y la `moneda` de la respuesta, dos decimales fijos, fallback sin
símbolo si el código es inválido. **Cero aritmética: no hay total** —el backend no lo devuelve y
sumar en punto flotante da centavos que no cuadran—, y la pantalla lo dice. `snapshotPrecio` se
rotula "Precio al devengar". Anular reusa `ConfirmacionConMotivo` con su default
`motivoObligatorio: true`. Los tres errores por `problemType`: `obligacion-con-cobros` explica que
corresponde una **devolución** y muestra el `yaCobrado` formateado con la moneda de esa obligación
—nunca dice "no se puede"—, `obligacion-already-anulada` avisa que el estado ya está, y
`concurrent-modification` que no se pisó nada; los dos últimos ofrecen recargar.

**Cero literales de color**: `billing.css` no define ningún color, `design-system.css` sin tocar.

`npm run test:ci`: **84 archivos, 740 tests, 0 fallos** — 87,59 st · **80,24 rama** · 85,53 fn ·
88,60 ln, los cuatro gates verdes (baseline 87,54 / 80,25 / 85,57 / 88,58). Lint y `format:check`
limpios. Auditoría axe en las dos pantallas, la de lectura de la sesión cerrada incluida.

`npx playwright test`: **34 pasan, 16 fallan por `ECONNREFUSED` contra `localhost:8080`** —no hay
backend levantado, Docker no arranca en esta máquina—. Son `smoke`, `auth-flujo`,
`contexto-sin-fuga` y `errores-sin-internals`, todas de backend real; las dos de agenda, que mockean
rutas, pasan, y también la del 404, que es la que verificaba la ruta nueva. **No se corrieron contra
el stack real, así que no son evidencia de esta etapa.**
