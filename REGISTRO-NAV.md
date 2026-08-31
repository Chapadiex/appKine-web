# Navegacion principal — registro

Rama `akine-navegacion`, worktree `.worktrees/web-nav`. Un solo commit.

**Que se construyo.** `src/app/layout/navegacion-principal/` — un `<nav aria-label="Secciones de
AKINE">` en la cabecera del layout raiz, con las siete secciones montadas, el indicador de
contexto activo (organizacion · sede) y su enlace a `/seleccionar-contexto`. Va en `layout/` y no
en `shared/`: sabe que es un Turno y que es un Paciente, y `shared/` no puede saber de dominio.

**Permiso por seccion.** El dato sale del `canActivate` de la ruta que cada enlace abre, no de
adivinar: Agenda, Pacientes, Espacios, Catalogo, Servicios y Organizacion **no llevan
`permissionGuard`** —el backend las autoriza por pertenencia—, y Horarios es la unica con
`permissionGuard(PERMISO_COLABORADOR_READ)` en las cuatro rutas de `horarios.routes.ts`. La tabla
completa, con la cita de cada archivo, esta en el javadoc de `secciones.ts`. Esconder no es
autorizar: esto es UX y quien decide sigue siendo el backend.

**Tres estados, no dos.** Anonimo no ve nada (esta en el login, no tiene a donde ir); autenticado
sin contexto ve un unico enlace al selector (con token `pre_context` el backend corta todo
endpoint de negocio); con contexto ve el menu. El filtrado se hace en TypeScript y no con
`*akinePermiso`: la directiva devuelve `false` con lista vacia, asi que una seccion sin permiso
quedaria escondida para todos. A cambio, el componente pide los permisos por su cuenta.

**La ruta `''`.** Redirige a `/agenda`, y el baseline tecnico se muda a `/estado`. Antes `''`
montaba el baseline —version del backend y del contrato—: un informe de conectividad como pantalla
de bienvenida, sin enlace a ningun lado. Se redirige en vez de construir un tablero porque un
inicio de verdad —turnos de hoy, pendientes— es una pantalla con datos y endpoints propios, y esto
es navegacion. La agenda ya cumple ese rol para recepcion. Los guards del destino resuelven los
bordes solos: anonimo al login, sin contexto al selector. `e2e/smoke.spec.ts` se movio a `/estado`.

**Accesibilidad.** `aria-current="page"` ademas de la clase; la seccion actual se marca por
subrayado y peso, no solo por color; area de toque de 44 px; axe sin violaciones. Verificado en
Chromium real (`scripts/mirar-navegacion.mjs`): el primer Tab cae en el skip link con el menu
montado, y los siete enlaces se recorren despues. Sin desborde a 1280, 768 ni 390 px —la barra
envuelve a dos filas—; el desborde que se ve a 390 en `/pacientes` es su tabla, preexistente.

**Color.** Dos tokens nuevos (`--color-marca-superficie-activa`, `--color-marca-borde`), definidos
en `:root` y en el bloque oscuro. `grep -rnE '#[0-9a-fA-F]{3,8}' --include=*.css src/` fuera de
`design-system.css` no devuelve nada.

**Suite.** `npm run test:ci`: 695 tests en 80 archivos, todo verde. Cobertura
**87,42 % st · 80,28 % rama · 85,67 % fn · 88,49 % ln** — los cuatro gates de 80 % pasan, y la
rama subio de 80,21. Lint limpio y `npm run build` OK.
