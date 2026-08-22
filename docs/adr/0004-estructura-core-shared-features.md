# ADR-0004 — Estructura `core` / `shared` / `features` y contexto multi-tenant

- **Estado:** Aceptado
- **Fecha:** 2026-08-22
- **Etapa:** AKINE-00.01

## Contexto

El frontend debe cubrir 29 módulos funcionales, alineados con los módulos del backend. Sin
una estructura decidida antes del primero, cada feature inventa la suya y en seis meses no
hay dos que se parezcan.

Hay además un requisito que atraviesa toda la aplicación: AKINE es multi-tenant. El usuario
autentica una identidad única y **después** elige Organización y Consultorio (DP-02). Puede
cambiar de contexto sin volver a autenticarse.

Ese cambio de contexto es el punto delicado. Si una pantalla o un servicio conserva datos de
la Organización A cuando el usuario pasa a la B, se muestran datos clínicos de otro tenant.
Es el bug de aislamiento más probable del frontend, y el más grave.

## Decisión

### Estructura

```
src/app/
├── core/          singletons, se cargan una sola vez
│   ├── services/       auth-token.store · tenant-context.store
│   ├── interceptors/   auth · error
│   ├── guards/
│   └── models/
├── shared/        standalone reutilizables — SIN reglas de dominio
├── features/      una carpeta por dominio, lazy loaded
│   └── <dominio>/  pages/ · components/ · services/ · models/
└── api/generated/ cliente generado — no se edita
```

Reglas:

1. **`shared/` no contiene reglas de dominio.** Si un componente sabe qué es un Turno, no
   va en `shared/`.
2. **`core/` se carga una sola vez.** Nada de estado de feature.
3. Cada `feature/` es **lazy loaded**.
4. **Un feature no importa de otro feature.** Lo común sube a `shared/` o `core/`.
5. Los servicios de feature consumen el cliente generado, no `HttpClient` crudo.
6. `features/` se alinea con los módulos del backend.

### Contexto multi-tenant

`TenantContextStore` es la **única fuente** del contexto activo. Expone `contextEpoch`, un
contador que se incrementa en **cada** cambio de contexto, incluido el logout.

Las features observan `contextEpoch` para descartar su estado. Un servicio que cachea datos
y no reacciona a esa señal **es un bug**, no una optimización pendiente.

Se eligió un contador y no el propio contexto porque también debe dispararse al limpiar, y
porque compara barato.

## Alternativas consideradas

**Agrupar por tipo técnico (`components/`, `services/`, `models/` en la raíz).** Familiar y
simple al principio. Descartada porque no escala a 29 dominios: encontrar todo lo de "Turnos"
exige recorrer cinco carpetas, y nada impide que cualquier cosa dependa de cualquier otra.

**Un módulo NgModule por feature.** El patrón clásico de Angular hasta v14. Descartada:
Angular 21 es standalone-first y los NgModule son legado. Agregarían ceremonia sin aportar
aislamiento real.

**Contexto tenant en el `AuthTokenStore`.** Menos servicios. Descartada porque son cosas
distintas con ciclos de vida distintos: el token se renueva sin cambiar de contexto, y el
contexto cambia sin cerrar sesión. Mezclarlos hace imposible reaccionar a uno sin el otro.

**Confiar en que el backend filtre por tenant y no limpiar nada en el frontend.** El backend
efectivamente filtra —es la autoridad—, así que ninguna petición nueva traería datos ajenos.
Descartada porque el problema no son las peticiones nuevas: son los datos **ya en memoria**
de la organización anterior, que siguen en pantalla o en una caché de servicio hasta que
algo los reemplace.

## Consecuencias

### Positivas

- Cada dominio es autocontenido y se puede trabajar sin leer el resto.
- El lazy loading mantiene el bundle inicial acotado.
- `contextEpoch` da un mecanismo **explícito y uniforme** para invalidar estado, en lugar de
  que cada feature invente el suyo.
- La correspondencia con los módulos del backend hace obvio dónde va cada cosa.

### Negativas

- Decidir si algo va en `shared/` o en un feature requiere criterio, y a veces se acierta
  tarde.
- `contextEpoch` es una convención que **nada verifica automáticamente**: un servicio que la
  ignore compila igual. Depende de revisión y de QA.
- La estructura es más ceremoniosa que lo mínimo para las primeras features.

### Qué obliga a hacer

- Todo servicio de feature que cachee datos observa `contextEpoch` y descarta su estado.
- **El QA verifica el cambio de contexto en cada escenario multi-organización**: cambiar de
  Org A a Org B y confirmar que no queda ningún dato de A en pantalla ni en memoria. Está
  documentado en `.claude/qa-config.md`.
- Antes de poner algo en `shared/`, preguntarse si sabe de dominio. Si sí, no va ahí.
- **PENDIENTE(AKINE-00.03):** evaluar una regla de ESLint que prohíba los imports entre
  features. Hoy la regla 4 depende de la revisión, y eso la hace la más frágil de las seis.
