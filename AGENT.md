# AGENT.md — appKine-web

Lineamientos técnicos y de negocio del frontend de AKINE. **Leer completo antes de cualquier tarea.**

---

## 1. Propósito

SPA de AKINE: SaaS multi-tenant para centros de kinesiología, fisioterapia, rehabilitación
y actividades de salud/bienestar. Interfaz para pacientes, profesionales, administrativos
y propietarios de organización.

**Aplicación desplegable separada** que consume **exclusivamente** la API REST de `appKine-api`.
No accede a base de datos ni a ningún otro servicio.

> **El backend es la autoridad.** Permisos, tenant, estados y reglas de negocio se resuelven
> allá. La interfaz **no puede elevar privilegios**: ocultar un botón no es una regla de
> seguridad, es una decisión de UX. Toda acción se valida del lado del servidor.

## 2. Documentación canónica

Vive en el repo del backend (`../appKine-api/docs/producto/`), no en este:

- `../appKine-api/docs/producto/AKINE_Requerimientos_Integrados.md` — **fuente de verdad funcional** M01–M29 + §30–45.
- `../appKine-api/docs/producto/AKINE_IMPLEMENTATION_PLAN.md` — **fuente de verdad de arquitectura y roadmap**, DP-01…DP-09.
- `../appKine-api/docs/producto/arquitectura-java-angular21.md` — referencia de layout Angular 21.
- `../appKine-api/docs/producto/plan_sesiones.txt` — **rediseño clínico/UX de la Sesión de Evaluación (M14).**
  Lectura obligatoria antes de tocar la pantalla de Sesión.
- Documentos históricos (`AKINE_info.txt`, `AkinePN.docx`): antecedente de negocio únicamente.

Convenciones de identificadores: `RF-MXX-NNN`, `RN-MXX-NNN`, `RNF-MXX-NNN`, `CA-MXX-NNN-YY`.

Todo cambio debe trazarse a un RF/CA concreto.

### Retomar el trabajo: `../appKine-api/docs/fases/`

**Antes de tocar una pantalla, leé la ficha de su fase** en `../appKine-api/docs/fases/` (empezá
por `README.md` y `00-orden-recomendado.md`). Sale de la auditoría plan-vs-código del 01/10/2026 y
lista, por fase, qué pantallas y E2E faltan —la mayor deuda del producto: F4 en adelante es casi
todo backend sin UI— junto con lo que falta del lado del backend para que esa pantalla tenga
sentido. Verificá cada faltante contra el código antes de actuar.

## 3. Stack

| Capa | Tecnología |
|---|---|
| Framework | Angular 21 |
| Package manager | npm con `package-lock.json` |
| Change detection | **Zoneless** — sin `zone.js`, signals |
| Componentes | Standalone, `OnPush` por defecto |
| HTTP | `HttpClient` (incluido de fábrica en v21) |
| Cliente API | **Generado** desde `akine-api.yaml` → `src/app/api/generated/` |
| Tests unit | Vitest (default de v21) |
| Tests E2E | Playwright — `e2e/` |
| Accesibilidad | WCAG 2.1 AA |
| CI/CD | GitHub Actions + SonarQube |
| Runtime | Docker |

Cobertura exigida: **≥80 % en código nuevo.**

### Consecuencias de Angular 21 que rompen hábitos de v17/v18

1. **Zoneless por defecto.** El change detection lo manejan los signals. Código que dependía
   del CD implícito de Zone.js deja de actualizarse.
2. **`OnPush` es el default.** Mutar un objeto en lugar de reemplazarlo no dispara re-render.
3. **Vitest reemplaza a Karma** como test runner.
4. **Sin sufijo `.component`** en los nombres de archivo: `app.ts`, no `app.component.ts`.
5. `public/` para assets estáticos, no `src/assets`.

## 4. Arquitectura

```
src/app/
├── core/                  # singletons, se cargan una sola vez
│   ├── services/          # auth, contexto tenant, config
│   ├── interceptors/      # auth-interceptor, error-interceptor
│   ├── guards/            # auth-guard, context-guard, permission-guard
│   └── models/            # interfaces compartidas (NO DTOs de API)
├── shared/                # standalone reutilizables — SIN reglas de dominio
│   ├── components/
│   ├── pipes/
│   └── directives/
├── features/              # una carpeta por dominio, lazy loaded
│   └── <dominio>/
│       ├── pages/
│       ├── components/
│       ├── services/
│       └── models/
└── api/generated/         # cliente TypeScript generado — NO SE EDITA A MANO
```

`features/` se alinea con los módulos backend: `identity`, `organization`, `resource`,
`person`, `contracting`, `clinical`, `scheduling`, `billing`, `offering`, `activity`,
`notification`, `reporting`.

### Reglas de estructura

1. **`shared/` no contiene reglas de dominio.** Si un componente sabe qué es un Turno,
   no va en `shared/`.
2. **`core/` se carga una sola vez.** Nada de estado de feature acá.
3. Cada `feature/` es **lazy loaded**.
4. Un feature no importa de otro feature. Lo común sube a `shared/` o `core/`.
5. Los servicios de feature consumen el **cliente generado**, no `HttpClient` crudo.

## 5. Contrato API — regla dura

- `src/app/api/generated/` se genera desde una **versión explícita y fijada** de
  `akine-api.yaml`, propiedad del repo backend.
- **Nunca se edita a mano.** Si algo falta, falta en el contrato: se pide al backend.
- **Prohibidos los DTO manuales duplicados.** Si escribís una `interface Turno` a mano
  para hablar con la API, está mal.
- La versión del contrato consumida se declara explícitamente en el repo.
- Cambio aditivo del backend → puede llegar antes que el consumidor.
  Cambio incompatible → versión mayor + ventana de compatibilidad.
- **Nunca asumir commits atómicos entre repos.** Ver `../CLAUDE.md`.

## 6. Autenticación y contexto multi-tenant

Flujo (DP-02):

1. Login con identidad única. **Sin selección previa de rol** — no hay pantalla
   "¿sos paciente o profesional?".
2. Después del login, el usuario selecciona **Organización + Consultorio** entre sus
   contextos autorizados.
3. Esa selección emite/renueva un **access token acotado al contexto**.
4. El cambio de contexto autorizado **no requiere nuevo login**, pero sí renueva el token
   y queda auditado del lado del backend.

Implicancias para el frontend:

- El `auth-interceptor` adjunta el token **acotado al contexto activo**, no el de login.
- Hay un servicio de contexto en `core/` que es la única fuente del tenant activo.
- Al cambiar de contexto, **invalidar el estado de features** — los datos de la Org A no
  pueden quedar en pantalla bajo la Org B.
- Los guards de permiso son **UX, no seguridad**. El backend rechaza igual.
- El refresh token se maneja en el interceptor, con cola de requests durante el refresh.

## 7. Reglas funcionales que impactan la UI

De `AKINE_Requerimientos_Integrados.md` §3. Confundirlas produce pantallas incorrectas:

1. Historia Clínica ≠ Caso Clínico ≠ Sesión.
2. Plan de Tratamiento ≠ Turno ≠ Sesión.
3. Las sesiones se numeran **dentro del Caso Clínico**.
4. **Turno es reserva; Sesión es atención realizada.** La agenda muestra Turnos;
   la pantalla clínica registra Sesiones. No son la misma entidad ni la misma pantalla.
5. Obligación económica ≠ Cobro ≠ Caja. Tres vistas distintas.
6. Cobertura del paciente ≠ Convenio del consultorio.
7. Nada se borra: la UI ofrece **baja lógica**, y muestra lo dado de baja cuando corresponde.

**Turno, Check-in/Recepción y Sesión tienen máquinas de estado independientes** (DP-05).
La UI no puede fusionarlas en un único wizard lineal: recepción y atención clínica son
pantallas y roles distintos.

**Sesión (M14)** tiene dos modos, definidos en `../appKine-api/docs/producto/plan_sesiones.txt`:
- **Sesión rápida** — seguimiento normal, mínima fricción.
- **Evaluación completa** — primera sesión o re-evaluación.

Prioridades de ese diseño: velocidad de uso, claridad clínica, jerarquía visual,
reutilización de datos ya existentes (paciente, caso, cobertura, turno),
comparabilidad con sesiones anteriores, mínimo ruido administrativo visible.
**No agregar campos administrativos a la pantalla clínica.**

## 8. Accesibilidad y UX

- **WCAG 2.1 AA** es requisito, no aspiración.
- Contraste, foco visible, navegación por teclado, labels reales en todos los formularios.
- Responsive: el personal de recepción usa desktop; los profesionales, tablet.
- Los errores del backend se muestran con su mensaje real, no con un genérico.

## 9. Seguridad

**Estrategia de token (decidida en AKINE-00.01, implementada en `core/services/auth-token.store.ts`):**

- El **access token vive únicamente en memoria**, en un signal. **Nunca** en `localStorage`
  ni en `sessionStorage`. AKINE maneja historia clínica: un XSS —propio o de cualquier
  dependencia npm— lee todo el storage del navegador, y con ese token accede a datos de
  salud de pacientes reales.
- El **refresh token viaja en una cookie `httpOnly` + `SameSite`** que JavaScript no puede
  leer. Al arrancar la app, se pide un access token nuevo contra el endpoint de refresh.
  Ese endpoint llega en F1 (M02).
- El `auth-interceptor` manda `withCredentials: true` **solo a `/api`**. Mandar el token a
  un host de terceros sería filtrarlo.
- Contraparte en el backend: `allowCredentials(true)` obliga a declarar orígenes CORS
  explícitos — nunca comodín.

**Resto:**

- Sin secretos en el bundle. Nada de credenciales en `environment.ts`.
- `environment.apiBaseUrl` está vacío a propósito: las peticiones son relativas y el proxy
  de dev las resuelve. Así no hay URL de localhost que se pueda commitear por accidente.
- No confiar en ningún dato del cliente para decidir permisos.
- Datos de prueba: **exclusivamente sintéticos.** Nunca datos reales de pacientes.

## 10. Testing

| Tipo | Herramienta | Qué cubre |
|---|---|---|
| Unit | Vitest | Servicios, pipes, lógica de componentes |
| Componente | Vitest + Angular testing utils | Render y comportamiento |
| E2E | Playwright (`e2e/`) | Flujos completos contra backend local |
| Contrato | cliente generado | Se rompe en compilación si el contrato cambió |

Los E2E corren con backend y frontend **en la misma rama**. Ver `.claude/qa-config.md`.

## 11. Estado actual

**AKINE-00.01 completada y verificada.** Angular 21.2.6, build OK, 4 tests unitarios y
5 E2E en verde contra el stack real.

Existe hoy: el shell accesible, la infraestructura de `core/` (token store, contexto tenant,
interceptores), el cliente generado y el pipeline. **No hay pantallas funcionales** — se
construyen en las etapas M01–M29.

Rutas reales, comandos y decisiones: `CLAUDE.md` §7.
