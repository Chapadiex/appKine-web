# E2E de la vertical de turnos — registro

11 tests en `e2e/agenda-buscador.spec.ts` y `e2e/agenda-reserva.spec.ts`, sobre el harness
`e2e/support/agenda-simulada.ts`. Primeros E2E desde AKINE-01.02.

**Cubren:** camino feliz buscar→reservar→confirmar · los cinco días de la ventana con su motivo
propio · los cuatro conflictos llevando a cuatro acciones distintas (cada test afirma también que
**no** aparecen las otras tres) · el doble click con una sola clave de idempotencia · la clave
nueva tras `idempotency-key-conflict` · la ventana de >62 días recortada y reintentada · el slot
completo dibujado y no accionable · la grilla sin `turno:manage`.

**Alcance del harness.** Real: navegador, router, guards, signals, cliente generado,
interceptores, las dos pantallas. Sintético: la respuesta HTTP (`route.fulfill`, el mismo
mecanismo de `scripts/api-simulada.mjs`). Los seis escenarios que importan son respuestas
puntuales que el backend real no produce a pedido —`slot-completo` exige que otro llene el cupo
entre lectura y escritura— y montarlas contra MySQL terminaría probando el sembrado. **No prueban
que el backend emita esos tipos con esas extensiones:** eso lo fijan sus tests de integración.
Si el backend renombra `slot-completo`, esta suite sigue verde y la pantalla queda rota.

**Los 11 se verificaron rompiendo el código a mano** (motivos colapsados, días vacíos salteados,
recorte anulado, `slotCompleto` en `false`, las cuatro acciones unificadas, clave regenerada por
click, clave no quemada, `recargar`/`confirmar` vacíos, permiso ignorado). Cada mutación hizo
fallar al test que la afirma; todas revertidas.

**Un defecto real, corregido:** el aviso "lo recortamos y volvimos a pedirla" sobrevivía a la
consulta siguiente y afirmaba un recorte que no ocurrió. `buscar()` no podía limpiarlo —el
reintento automático pasa por ahí después de ponerlo—, así que se limpia en `cambiarDesde` y
`cambiarHasta`.

Corrida: **11 passed**. `npm run test:ci`: 695 unitarias, 87,41 st · 80,28 rama · 85,67 fn ·
88,47 ln. Lint y `format:check` limpios.
