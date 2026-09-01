# AKINE-06.01 y 06.02 — frontend de la atencion clinica (M14)

Worktree `.worktrees/web-sesion`, rama `akine-06-sesion`. Cliente regenerado y fijado en **0.17.0**
(diff aditivo: `sesiones.service`, cinco modelos, dos `ProblemType` nuevos). `api:check` no corre
desde un worktree —resuelve `../appKine-api`—: la version se verifico a mano contra el YAML.

- **Feature `clinical`, una sola pantalla y una sola ruta**: `/atencion/turnos/:turnoId`, con
  `authGuard` en el padre y `contextGuard` en la hija. **La URL es la del turno y no la de la
  sesion**: iniciar es idempotente, asi que recargar vuelve a la misma atencion sin que el frontend
  distinga "abrir" de "retomar". Sin `permissionGuard`: `sesion:register` no basta para escribir,
  porque la sesion es de quien la lleva.
- **Puerta de entrada**: enlace desde la reserva de turno. No hay listado de turnos en el contrato.
- **El conflicto de version no descarta nada.** Ante `concurrent-modification` la pantalla **frena
  el autosave** —si no, cada tecla produciria otro 409—, avisa, y ofrece "Releer y comparar". Al
  releer toma la **version fresca** y muestra lo del servidor en un panel de solo lectura **al lado**
  del editor, que queda intacto. Un guardado exitoso tampoco pisa el editor: solo adopta la version.
- **La previa va dentro del `fieldset` de dolor**, no en otra seccion. Sin previa dice "primera
  sesion evaluada", que es una afirmacion clinica y no un hueco en blanco.
- **Cero validaciones de requerido.** Los campos vacios no viajan (`undefined`, no `''`), asi que
  "no lo cargue" sigue siendo distinguible. `NO_APLICA` viaja como valor cargado. La lateralidad sin
  zona **avisa pero no bloquea**: la regla es del backend y duplicarla la dejaria divergir.
- **RAPIDA muestra 6 elementos** —dolor, zona, lateralidad, chips de evolucion, objetivo, notas—;
  COMPLETA suma motivo clinico y limitacion funcional. Cambiar de modo no borra nada.
- **Errores por `problemType`, nunca por `detail`**: `sesion-ajena` (habla de propiedad y evita la
  palabra "permiso"), `turno-no-atendible` (muestra `motivo`), `concurrent-modification`,
  `validation-error`; mas 403 / 404 / 409 genericos / 429 / red.
- **Sin boton de cerrar la atencion y sin Historia Clinica**: 06.05 no existe y la HC no tiene
  endpoints.
- **Cero colores literales**: los unicos aciertos del grep son `white-space` y la causa `'red'`
  (sin red). Tokens nuevos: ninguno.
- **`npm run test:ci` verde**: 716 tests en 82 archivos (baseline: 695 en 80). **87,55 st ·
  80,25 rama · 85,57 fn · 88,59 ln**, los cuatro gates al 80 %. Lint limpio. Auditoria axe sobre la pantalla: sin
  violaciones (el contraste sigue sin verificarse: `color-contrast` da `incomplete` bajo jsdom).
- **Sin E2E**, como el resto de las etapas desde 01.02. **Sin QA contra MySQL**: el motor de Docker
  de esta maquina no arranca sin elevacion.
