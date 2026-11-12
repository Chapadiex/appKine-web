# Biblioteca del centro (frontend) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pantalla `/biblioteca` para que el `ORG_ADMIN` cargue, administre y pruebe la biblioteca de libros PDF de su organización (M30), sobre el contrato 0.164.0.

**Architecture:** Feature nueva `src/app/features/biblioteca/`, montada con `children` y pantallas perezosas (`loadComponent`). Una fachada `BibliotecaApi` sobre el cliente generado y un traductor de errores por `problemType`. La pantalla de la lista lleva el panel lateral "Probar búsqueda", y el libro tiene su propia pantalla de detalle con la edición. El estado vive en signals: la app es zoneless con `OnPush` real.

**Tech Stack:** Angular 22 (zoneless, signals, `OnPush`), cliente `typescript-angular` de openapi-generator, Vitest.

**Spec:** `../wt-API-RAG/docs/diseno/AKINE-biblioteca-rag.md` §4 (pantalla), §5.2 (permisos) y §12 (registro de avance), en la rama `akine-biblioteca-rag` de `appKine-api`. Los requisitos son RF-M30-001…011 de `../wt-API-RAG/docs/producto/AKINE_Requerimientos_Integrados.md` (M30).

## Global Constraints

- **Rama y worktree:** `akine-biblioteca-web` en `C:\Users\santo\Desktop\AKINE\wt-WEB-RAG`. Commits locales en prosa normal, terminados con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Sin push, PR ni merge hasta que el usuario lo pida.
- **Cliente:** `0.164.0`, generado desde `../wt-API-RAG/openapi/akine-api.yaml`. El backend todavía no está en `main`. El cliente generado no se edita, y no hay DTO manuales.
- **`api:check` en local:** lee `../appKine-api/openapi/akine-api.yaml` (el checkout de `main`, en 0.162.0) y va a fallar por desalineación. Es esperado: en el CI los dos repos van en la misma rama. No se toca el script.
- **Estado y render:** signals, siempre. Mutar un objeto no re-renderiza.
- **Bundle:** el bundle inicial no puede crecer. El tope de error es 448 kB (`angular.json`). Las pantallas van con `loadComponent`, y el archivo de rutas no importa componentes de forma estática.
- **Norma de pantalla:** `docs/ux/00-plan-refactor-ux-ui.md` §3.2/§3.4 y `DESIGN.md`:
  - el alta va en el título;
  - buscador más embudo;
  - tabla ordenable y paginada por el servidor;
  - menú "⋯" con 3 o más acciones;
  - "?" para lo explicativo;
  - tokens de color, sin colores sueltos;
  - WCAG AA.
- **Textos de pantalla:** en castellano rioplatense con tildes. Los mensajes de error los decide el `problemType`, nunca el texto del backend, salvo como último recurso (patrón `egreso-errors.ts`).
- **URL sin `:orgId`:** la organización es la del contexto (`TenantContextStore.organizationId()`).
- **Permiso:** `biblioteca:manage`, que es sólo del `ORG_ADMIN`. El guard y la navegación son UX: la autoridad es el backend.
- **Tests:** pocos y después del código. Van para la traducción de errores, el polling y el corte de la búsqueda. Se corre sólo lo de la feature: `npx ng test --watch=false --no-coverage --include "src/app/features/biblioteca/**/*.spec.ts"`. Los E2E están en pausa y no se escriben.
- **Problem types** que la pantalla traduce:
  - `biblioteca-deshabilitada`
  - `libro-no-encontrado`
  - `libro-duplicado`
  - `libro-archivo-no-aceptado`
  - `libro-en-proceso`
  - `concurrent-modification`
  - `validation-error`
  - `forbidden`, o el que use el 403 del proyecto: copiar el de `egreso-errors.ts`

  `npm run api:check` (`check-problem-types.mjs`) falla si se usa un `problemType` que el contrato no declara.

## Review Focus

1. **La biblioteca apagada.** `akine.biblioteca.enabled` está en `false` por defecto, así que en cualquier entorno donde no se prendió, toda operación responde 409 `biblioteca-deshabilitada`. La pantalla tiene que mostrar un estado vacío explicativo, sin error rojo ni reintento en bucle, y el panel de búsqueda queda deshabilitado. Test en la Tarea 2.
2. **El polling que no se detiene.** Con libros en `PENDIENTE` o `PROCESANDO` se relee cada 5 s. El polling para cuando no queda ninguno, cuando se sale de la pantalla y mientras la pestaña está oculta (`document.visibilityState`). Una relectura que falla no apila otra. Test en la Tarea 2.
3. **Un PDF de 100 MB.** La subida muestra el progreso real (`reportProgress`, `observe: 'events'`), y el botón queda bloqueado mientras sube, para evitar el doble envío. Un 413 se traduce a "El archivo supera el tamaño máximo permitido". Test de traducción en la Tarea 1.
4. **Editar algo que otro cambió.** `PUT` con `version` vieja da 409 `concurrent-modification`. Se muestra el aviso y se ofrece recargar, sin perder lo tipeado en el formulario. Test en la Tarea 4.
5. **El reemplazo pendiente.** Una fila con `reemplazaLibroId` es el archivo nuevo de otro libro. Se rotula "Reemplazo de «título»" y desde ella no se ofrecen "Reemplazar archivo" ni "Desactivar". Si de todos modos llega un 409 `libro-en-proceso`, se traduce a "Hay un reemplazo en curso: esperá a que termine". Lo cubre la Tarea 2, con la traducción en la Tarea 1.

---

### Tarea 1: Cliente 0.164.0, permiso, ruta, navegación, fachada y errores

**Files:**
- Regenerar: `src/app/api/generated/**`
- Modify:
  - `src/environments/environment.ts`: `contractVersion: '0.164.0'`
  - `src/environments/environment.*.ts`, si declaran `contractVersion`
- Modify: `src/app/core/models/permisos.ts`. Agregar `PERMISO_BIBLIOTECA_MANAGE = 'biblioteca:manage'` con su JSDoc, y sumarlo al arreglo de permisos conocidos si existe.
- Modify: `src/app/app.routes.ts`. Montar `{ path: 'biblioteca', canActivate: [authGuard, contextGuard], children: rutasBiblioteca }`.
- Create: `src/app/features/biblioteca/biblioteca.routes.ts`. Rutas:
  - `''`: lista;
  - `':libroId'`: detalle.

  Las dos con `permissionGuard(PERMISO_BIBLIOTECA_MANAGE)`, `loadComponent` y `title` del tipo "AKINE - Biblioteca". La lista con `data: { [DATA_ANCHO]: ANCHO_AMPLIO }`.
- Modify: `src/app/layout/navegacion-principal/secciones.ts`. Agregar `{ etiqueta: 'Biblioteca', ruta: '/biblioteca', permisos: [PERMISO_BIBLIOTECA_MANAGE] }` al grupo "Configuración", después de "Suscripción", y sumar la línea al JSDoc de "De dónde sale el permiso".
- Create: `src/app/features/biblioteca/services/biblioteca-api.ts`
- Create: `src/app/features/biblioteca/models/biblioteca-errors.ts` y su `.spec.ts`
- Create: `src/app/features/biblioteca/models/etiquetas-de-biblioteca.ts`

**Interfaces:**
- Produces (`BibliotecaApi`, `providedIn: 'root'`; no transforma nada; el `orgId` lo recibe cada método):
  - `listar(orgId: number, filtro: FiltroDeLibros): Observable<LibroPageResponse>`, con `FiltroDeLibros { q?, area?, estado?, page?, size?, sort? }`. Los tipos de `estado` y `sort` son los enums generados.
  - `ver(orgId, id): Observable<LibroDetalleResponse>`
  - `subir(orgId, datos: DatosDeSubida, archivo: File): Observable<HttpEvent<LibroResponse>>`, con `observe: 'events'` y `reportProgress: true`. `DatosDeSubida { titulo, autores?, edicion?, area?, declaracionDerechos: true }`.
  - `reemplazar(orgId, id, archivo: File, declaracionDerechos: true): Observable<HttpEvent<LibroResponse>>`, igual.
  - `editar(orgId, id, datos: LibroDatosRequest): Observable<LibroResponse>`
  - `reprocesar`, `activar`, `desactivar`, `eliminar(orgId, id)`. Son los cuatro del contrato; el tipo de retorno es el del cliente generado.
  - `buscar(orgId, consulta: string, k = 5): Observable<BibliotecaBusquedaResponse>`
- Produces (`biblioteca-errors.ts`):
  - `traducirErrorBiblioteca(e: unknown): ErrorBiblioteca`;
  - `ErrorBiblioteca { mensaje: string; causa: CausaBiblioteca; recargar: boolean; libroId?: number }`;
  - `CausaBiblioteca`:
    - `'deshabilitada'`
    - `'no-encontrado'`
    - `'duplicado'`
    - `'archivo-no-aceptado'`
    - `'demasiado-grande'`
    - `'en-proceso'`
    - `'version-vieja'`
    - `'datos-invalidos'`
    - `'sin-permiso'`
    - `'red'`
    - `'otro'`

  `libroId` sale del problem de `libro-duplicado`, si viene.
- Produces (`etiquetas-de-biblioteca.ts`):
  - `estadoDeLibroEnPalabras(estado)`: "En cola", "Procesando", "Listo", "Con error" o "Inactivo";
  - `claseDeEstadoDeLibro(estado)`: la clase de pastilla existente que use `etiquetas-de-egreso.ts`;
  - `ESTADOS_DE_LIBRO`.

- [ ] **Paso 1:** Generar el cliente. Hacerlo desde `../wt-API-RAG/openapi/akine-api.yaml`, no desde el script `api:generate`, que apunta a `../appKine-api`:

  ```bash
  npx openapi-generator-cli generate -i ../wt-API-RAG/openapi/akine-api.yaml -g typescript-angular -o src/app/api/generated -c openapi-generator.json
  ```

  Poner `contractVersion: '0.164.0'`. Verificar que `git diff --stat src/app/api/generated` muestre sólo archivos de biblioteca, `permission-code` y `problem-type`. Si muestra cambios en otros modelos, el YAML no es el de la rama y hay que parar.
- [ ] **Paso 2:** Permiso, ruta, navegación, fachada y etiquetas, según **Files** e **Interfaces**. La fachada sigue el criterio de `egresos-api.ts`: métodos de nombre propio y nada de lógica.
- [ ] **Paso 3:** `biblioteca-errors.ts`, con el patrón de `egreso-errors.ts` (`AkineHttpError`, `problemType`).
  - Mensajes:
    - `deshabilitada`: "La biblioteca no está habilitada en este entorno."
    - `duplicado`: "Ese PDF ya está en la biblioteca.", con `libroId` si viene.
    - `archivo-no-aceptado`: "El archivo no es un PDF válido."
    - `demasiado-grande`: "El archivo supera el tamaño máximo permitido." Sale del status 413, sin `problemType`.
    - `en-proceso`: "Hay un procesamiento o reemplazo en curso: esperá a que termine."
    - `version-vieja`: "Otra persona cambió este libro. Recargá para ver la versión actual."
  - `recargar` es `true` para `version-vieja` y `no-encontrado`.
- [ ] **Paso 4:** Test `biblioteca-errors.spec.ts`: un `it` por causa, construyendo el `AkineHttpError` como en `egreso-errors.spec.ts`. Cubre el 413 sin `problemType` → `demasiado-grande`, y `libro-duplicado` con `libroId: 7` → `libroId === 7`.
- [ ] **Paso 5:** Correr:

  ```bash
  npx ng test --watch=false --no-coverage --include "src/app/features/biblioteca/**/*.spec.ts"
  ```

  En verde. `npx ng build` compila. `node scripts/check-problem-types.mjs` pasa, porque lee el contrato generado y no el hermano. Si no lo lee así, anotarlo y seguir.
- [ ] **Paso 6:** Commit: "Biblioteca: cliente 0.164.0, permiso, ruta y fachada".

### Tarea 2: Lista de libros, acciones de fila y polling

**Files:**
- Create: `src/app/features/biblioteca/pages/biblioteca/biblioteca-page.ts`, `.html`, `.css` y `.spec.ts`

**Interfaces:**
- Consumes: `BibliotecaApi`, `traducirErrorBiblioteca` y las etiquetas de la Tarea 1.
- Consumes (shared):
  - `CabeceraDePagina`
  - `Filtros`
  - `Paginacion`
  - `EstadoVacio`
  - `AccionesDeFila`
  - `ColumnaOrdenable` (`th[appOrdenable]`) con `orden-de-servidor.ts`
  - `Alerta`
  - `Ayuda`
  - `AvisosStore`
- Produces: en la plantilla, un hueco donde la Tarea 3 monta el diálogo de subida/reemplazo y la Tarea 5 el panel `app-panel-lateral` de búsqueda. Dos signals públicos para la plantilla:
  - `dialogo: signal<{ modo: 'subir' } | { modo: 'reemplazar'; libro: LibroResponse } | null>`
  - `panelBusquedaAbierto: signal<boolean>`

  Y el método `recargar(): void`, que relee la página actual.

- [ ] **Paso 1:** Estado de la pantalla, como unión discriminada al estilo de `egresos-page.ts`: `cargando`, `listo { pagina: LibroPageResponse }`, `deshabilitada` o `error { error: ErrorBiblioteca }`. `deshabilitada` sale de la causa `'deshabilitada'`.
- [ ] **Paso 2:** Cabecera, buscador y embudo.
  - Cabecera:
    - título "Biblioteca";
    - subtítulo con `totalElements`, del tipo "12 libros";
    - en el título, el botón "Subir libro", que pone `dialogo.set({ modo: 'subir' })`;
    - el botón "Probar búsqueda", que abre el panel;
    - un "?" que explica para qué sirve la biblioteca: la usan después la sugerencia de tratamiento y la evaluación de evolución, y los pedazos sospechosos quedan fuera de la búsqueda.
  - Buscador `q`, con debounce de 300 ms y vuelta a la página 0.
  - Embudo: área (texto libre) y estado (select de `ESTADOS_DE_LIBRO`).
  - Orden por servidor en Título, Agregado (`creadoEn`) y Estado, con los valores del enum `sort`. El tamaño de página arranca en `FILAS_POR_PAGINA_INICIAL`.
- [ ] **Paso 3:** Tabla con las columnas título (con autor debajo), edición, área, páginas, estado y "⋯".
  - Estado:
    - pastilla con `estadoDeLibroEnPalabras`;
    - `PROCESANDO` agrega el porcentaje de `progreso`;
    - `ERROR` muestra `motivoError` en texto chico debajo.
  - Una fila con `reemplazaLibroId` lleva "Reemplazo de «título»". El título del original sale de la misma página, si está en ella. Si no, "Reemplazo de otro libro".
  - Título enlazado a `/biblioteca/:id`.
- [ ] **Paso 4:** Acciones de fila (`AccionesDeFila`):
  - Ver detalle.
  - Reemplazar archivo: abre el diálogo en modo reemplazar.
  - Reprocesar: sólo en `ERROR` o `LISTO`.
  - Desactivar o Activar, según el estado: `INACTIVO` ofrece Activar.
  - Eliminar.

  Las filas con `reemplazaLibroId` no ofrecen ni Reemplazar ni Desactivar.

  Eliminar pide confirmación con el título del libro y la advertencia "Se borra el archivo y sus pedazos; no se puede deshacer". Usar el diálogo de confirmación que ya use el proyecto (buscar `confirm` en `shared/`). Si no hay ninguno, un `<dialog>` propio, sin `window.confirm`.

  Cada acción, al terminar, avisa por `AvisosStore` y llama a `recargar()`. Un error se muestra con `Alerta` y, si `recargar` es `true`, relee.
- [ ] **Paso 5:** Polling. Un `effect` que, si la página tiene algún libro en `PENDIENTE` o `PROCESANDO`, programa con `setTimeout` una relectura a los 5000 ms, encadenada: la próxima se agenda recién cuando volvió la anterior, así no se apilan.
  - Se cancela:
    - en `DestroyRef.onDestroy`;
    - si ya no queda ninguno pendiente;
    - mientras `document.visibilityState === 'hidden'`, retomando en `visibilitychange`.
  - La relectura del polling no pone el estado en `cargando`, para que la tabla no parpadee: reemplaza la página en sitio.
  - Constante `RELECTURA_MS = 5000`.
- [ ] **Paso 6:** Estado `deshabilitada`: `EstadoVacio`.
  - Título: "La biblioteca no está habilitada".
  - Texto: "El administrador de la plataforma tiene que activarla en este entorno."
  - "Subir libro" y "Probar búsqueda" deshabilitados.
  - Sin polling.
- [ ] **Paso 7:** `biblioteca-page.spec.ts`, con `HttpTestingController` y timers falsos de Vitest. Tres `it`:
  1. **Polling que para:** la primera respuesta trae un libro `PROCESANDO`. Avanzar 5000 ms → sale exactamente una relectura; responde con el libro `LISTO`. Avanzar 10000 ms → no sale ninguna más.
  2. **Deshabilitada:** el 409 con `problemType` `biblioteca-deshabilitada` muestra el texto "La biblioteca no está habilitada", y el botón "Subir libro" tiene `disabled`.
  3. **Reemplazo pendiente:** una fila con `reemplazaLibroId` no ofrece "Reemplazar archivo" en el menú.
- [ ] **Paso 8:** Correr los tests de la feature, en verde. Commit: "Biblioteca: lista de libros con acciones y relectura mientras se procesa".

### Tarea 3: Diálogo de subida y de reemplazo

**Files:**
- Create: `src/app/features/biblioteca/components/subir-libro/subir-libro.ts`, `.html`, `.css` y `.spec.ts`
- Modify: `biblioteca-page.html` y `.ts`, para montarlo según `dialogo()`.

**Interfaces:**
- Consumes: `BibliotecaApi.subir`, `BibliotecaApi.reemplazar` y `traducirErrorBiblioteca`.
- Produces: `<app-subir-libro [modo]="'subir' | 'reemplazar'" [libro]="LibroResponse | null" (listo)="…" (cancelar)="…">`.
  - `listo` emite el `LibroResponse` creado.
  - La página, al recibirlo, cierra el diálogo, avisa "Libro en cola para procesar" y recarga.

- [ ] **Paso 1:** Formulario reactivo dentro de un `<dialog>` modal, con el foco en el primer campo y Escape para cerrar, como los diálogos existentes (ver `ayuda` y `panel-lateral` para el manejo de foco).
  - Campos:
    - archivo PDF, con `<input type="file" accept="application/pdf,.pdf">` (el `accept` es sólo una pista: el backend decide);
    - título (obligatorio, máximo 300);
    - autores (500);
    - edición (100);
    - área (100);
    - casilla obligatoria "Declaro que el centro tiene derecho a usar este material".
  - En modo reemplazar sólo van el archivo y la casilla, con el título del libro en el encabezado: "Reemplazar el archivo de «título»".
  - Un párrafo explica que el libro anterior sigue disponible hasta que el nuevo termine de procesarse.
- [ ] **Paso 2:** Envío.
  - Mientras sube:
    - barra de progreso (`<progress>`), con `loaded/total` del `HttpEventType.UploadProgress`;
    - los botones bloqueados;
    - el texto "Subiendo… N %".
  - `HttpEventType.Response` emite `listo`.
  - Un error se muestra con `Alerta` dentro del diálogo, sin cerrarlo y conservando lo cargado. Con `duplicado` y `libroId`, el mensaje lleva el enlace "Ver el libro" a `/biblioteca/:libroId`.
  - No se valida el tamaño en el cliente: el máximo lo fija cada despliegue y un 413 se traduce.
- [ ] **Paso 3:** `subir-libro.spec.ts`, un `it`: sin marcar la casilla, "Subir" no envía nada (`httpMock.expectNone`) y se ve el error de la casilla. Marcándola, sale un `POST` multipart con `declaracionDerechos=true` en la query.
- [ ] **Paso 4:** Tests de la feature en verde. Commit: "Biblioteca: diálogo para subir y reemplazar el PDF".

### Tarea 4: Detalle y edición de un libro

**Files:**
- Create: `src/app/features/biblioteca/pages/libro-detalle/libro-detalle-page.ts`, `.html`, `.css` y `.spec.ts`

**Interfaces:**
- Consumes: `BibliotecaApi.ver`, `BibliotecaApi.editar`, `traducirErrorBiblioteca` y las etiquetas.
- Consumes (shared): `CabeceraDePagina`, con las migas Biblioteca › título; `Alerta`; `Ayuda`.

- [ ] **Paso 1:** Lectura de `:libroId`.
  - Cabecera con el título y la pastilla de estado. En `ERROR`, `motivoError` en una `Alerta` de advertencia.
  - Datos: autores, edición, área, páginas.
  - **Indexado:** `fragmentos` pedazos, de los cuales `fragmentosConVector` ya tienen vector. Si `fragmentosConVector < fragmentos`, se muestra "Indexando N %", con N redondeado.
  - **Sospechosos:** la cantidad y una lista con la página y el extracto de cada uno. El extracto va en `<blockquote>`, como texto plano: nunca `innerHTML`.
  - Un "?" explica que se excluyen de la búsqueda porque parecen instrucciones o texto corrupto, y que conviene revisar esas páginas del PDF.
  - Mientras esté `PENDIENTE` o `PROCESANDO`, se usa el mismo polling de 5 s de la Tarea 2. Si hace falta, extraerlo a una función en `features/biblioteca/models/relectura.ts`, usada por las dos pantallas.
- [ ] **Paso 2:** Edición en sitio. "Editar datos" pasa los campos a un formulario con título (obligatorio), autores, edición y área. Guardar manda `editar` con la `version` leída.
  - En 409 `version-vieja`: `Alerta` con el mensaje y el botón "Recargar". Al recargar se relee el libro y se conserva lo tipeado en el formulario, para que la persona lo reaplique.
- [ ] **Paso 3:** `libro-detalle-page.spec.ts`, un `it`: con un `PUT` respondido 409 `concurrent-modification`, el formulario sigue abierto con el título tipeado y aparece el botón "Recargar".
- [ ] **Paso 4:** Tests de la feature en verde. Commit: "Biblioteca: detalle del libro con pedazos sospechosos y edición".

### Tarea 5: Panel "Probar búsqueda"

**Files:**
- Create: `src/app/features/biblioteca/components/probar-busqueda/probar-busqueda.ts`, `.html`, `.css` y `.spec.ts`
- Modify: `biblioteca-page.html` y `.ts`, para montarlo dentro de `<app-panel-lateral titulo="Probar búsqueda" ancho="amplio">` cuando `panelBusquedaAbierto()`.

**Interfaces:**
- Consumes: `BibliotecaApi.buscar` (k = 5, el valor por defecto) y `traducirErrorBiblioteca`.

- [ ] **Paso 1:** Textarea de consulta (máximo 600, con contador) y botón "Buscar". Consulta en blanco: no envía.
- [ ] **Paso 2:** Resultado.
  - Encabezado:
    - si `alcanza`: "La biblioteca tiene material para esta pregunta";
    - si no: "La biblioteca no alcanza para esta pregunta" (al menos 2 pasajes sobre el corte).
  - Con `camino === 'PALABRAS'`, una nota: "Búsqueda por palabras: el modelo no está disponible o los libros todavía se están indexando".
  - Lista de pasajes, cada uno con:
    - título del libro, enlazado a `/biblioteca/:libroId`;
    - "pág. X" o "págs. X–Y";
    - el texto como texto plano;
    - el puntaje con dos decimales.
  - Los pasajes con `superaCorte === false` se atenúan con un token de color de texto secundario y llevan la etiqueta "debajo del corte". No se atenúan sólo con opacidad: el contraste AA se tiene que mantener.
  - Sin pasajes: "No se encontró nada en la biblioteca".
  - Un "?" explica qué es el corte: el puntaje mínimo para que un pasaje cuente como respaldo.
- [ ] **Paso 3:** `probar-busqueda.spec.ts`, un `it`: la respuesta con dos pasajes, uno con `superaCorte: false`, muestra "debajo del corte" exactamente una vez, y el encabezado dice "no alcanza".
- [ ] **Paso 4:** Tests de la feature en verde. Commit: "Biblioteca: panel para probar la búsqueda".

### Tarea 6: Verificación en la pila y cierre

**Files:**
- Modify: `CLAUDE.md` §7. Agregar un renglón: la biblioteca en la rama `akine-biblioteca-web`, cliente 0.164.0, a la espera del backend.

- [ ] **Paso 1:** `npx ng build`. Anotar el tamaño del bundle inicial antes y después. Tiene que seguir igual, salvo los pocos bytes de la ruta y la entrada de navegación, y por debajo de 448 kB.
- [ ] **Paso 2:** Levantar el backend de `wt-API-RAG` en un puerto propio, con estas propiedades:

  ```
  akine.biblioteca.enabled=true
  akine.biblioteca.worker.enabled=true
  akine.biblioteca.modelo.tipo=prueba
  ```

  Levantar el frontend del worktree apuntando a ese backend, con una configuración nueva en `.claude/launch.json` y puertos libres (por ejemplo, API 8095 y web 4295). Entrar con la cuenta `ORG_ADMIN` de `appKine-api/.claude/qa-config.md` y recorrer:
  1. Subir un PDF sintético. Se puede generar con PDFBox desde un test del backend, o usar uno de `src/test/resources` de `wt-API-RAG`.
  2. Ver cómo pasa de "En cola" a "Listo" sin recargar la página.
  3. Abrir el detalle.
  4. Editar el título.
  5. Probar una búsqueda.
  6. Desactivarlo y activarlo.
  7. Eliminarlo.

  Mirar la consola sin errores y sacar una captura de la lista y otra del panel de búsqueda. Repetir con `akine.biblioteca.enabled=false` y ver el estado "no está habilitada".
- [ ] **Paso 3:** Al terminar, bajar las dos pilas. Si se creó un enlace de `node_modules`, no borrar el worktree: sólo dejar anotado que es un enlace.
- [ ] **Paso 4:** Commit: "Biblioteca: estado del frontend".

## Design challenge (`CLAUDE.md` §3)

1. **Contrato.** Todo sale del cliente 0.164.0, salvo "Indexando N %" en la lista: `LibroResponse` no trae `fragmentosConVector`, así que el dato se muestra sólo en el detalle. No hay DTO manual.
2. **Ubicación.** Todo vive en `features/biblioteca/`, y `shared/` sólo se consume. La relectura con polling queda en la feature (`models/relectura.ts`), no en `shared/`.
3. **Zoneless/OnPush.** El estado son signals, y la página se reemplaza entera en cada relectura, sin mutar en sitio.
4. **Tenant.** El `orgId` se lee de `TenantContextStore` en cada llamada. Cambiar de organización pasa por el selector, que recrea la pantalla. No queda estado viejo: las pantallas no guardan caché fuera del componente.
5. **Permisos.** El guard y la entrada de navegación son UX. Un `PROFESIONAL` que llegue por URL recibe el 403 del backend, traducido a `sin-permiso`.
6. **Reglas maestras.** No aplica: la pantalla no toca turno, sesión, HC ni dinero.
7. **Accesibilidad.**
   - Diálogo modal con foco atrapado y Escape para cerrar.
   - `<label>` real en cada campo.
   - `<progress>` con texto.
   - "Debajo del corte" se muestra con un token de color AA más una etiqueta, nunca sólo con opacidad.
   - El extracto sospechoso va como texto plano, nunca como HTML.
8. **El caso que rompe la pantalla.**
   - **Biblioteca apagada en producción:** es el estado por defecto, y se resuelve con el estado vacío de la Tarea 2.
   - **PDF de 100 MB por una red lenta:** se resuelve con el progreso y el bloqueo del envío de la Tarea 3.
   - **Cien libros procesándose:** el polling relee sólo la página visible, una relectura por vez.

## Decisiones del plan

- **Ruta `/biblioteca`, no `/configuracion/biblioteca`.** No existe el prefijo `/configuracion`: las pantallas del grupo "Configuración" cuelgan de `/organizacion` o de su propia raíz.
- **"Indexando N %" va sólo en el detalle.** `LibroResponse`, el de la lista, no trae `fragmentosConVector`. Mostrarlo en la tabla exige ampliar el contrato.
- **Detalle en pantalla propia y no en panel**, porque el panel lateral ya lo ocupa "Probar búsqueda" (la opción B del usuario).
- **`accept="application/pdf"` como pista del selector de archivos**, apartándose de `nuevo-adjunto.ts`, que no lo pone. La biblioteca sólo acepta PDF, así que la pista ahorra un viaje sin duplicar la regla: igual decide el backend.
- **Polling cada 5 s, encadenado y pausado con la pestaña oculta.** Es la lectura de "cada pocos segundos" del §4 del diseño.
