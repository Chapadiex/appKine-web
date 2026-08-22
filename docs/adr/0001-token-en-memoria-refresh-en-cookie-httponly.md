# ADR-0001 — Access token en memoria, refresh en cookie httpOnly

- **Estado:** Aceptado
- **Fecha:** 2026-08-22
- **Etapa:** AKINE-00.01

## Contexto

AKINE almacena **historia clínica**: diagnósticos, evoluciones, tratamientos y adjuntos de
pacientes reales. El plan decide autenticación JWT con refresh tokens y establece que el
backend es la autoridad de permisos.

Falta decidir dónde vive el token del lado del navegador. La respuesta determina qué pasa
el día que aparezca un XSS —propio, o en cualquiera de las ~570 dependencias transitivas de
npm que el proyecto ya tiene—.

Un XSS puede leer `localStorage` y `sessionStorage` completos. Si el token está ahí, el
atacante lo exfiltra y opera como el usuario: lee historias clínicas, y lo hace desde su
propia máquina, sin dejar rastro en la sesión de la víctima.

No es un escenario hipotético: es la vía de explotación estándar, y el tipo de dato en juego
convierte el incidente en una filtración de datos de salud.

## Decisión

**El access token vive únicamente en memoria**, en un signal dentro de `AuthTokenStore`.
Nunca se escribe en `localStorage`, `sessionStorage`, `IndexedDB` ni cookies legibles por JS.

**El refresh token viaja en una cookie `httpOnly` + `SameSite`**, que JavaScript no puede
leer. Al arrancar la aplicación —o cuando el access token expira— se pide uno nuevo contra
el endpoint de refresh, y el navegador adjunta la cookie automáticamente.

La regla se hace cumplir con ESLint: `no-restricted-globals` prohíbe `localStorage` y
`sessionStorage`, con un mensaje que apunta a este ADR.

El `auth-interceptor` envía `withCredentials: true` **solo a `/api`**: mandar credenciales
a un host de terceros sería filtrarlas. Su contraparte en el backend es
`allowCredentials(true)`, que a su vez obliga a declarar orígenes CORS explícitos en lugar
de comodín.

## Alternativas consideradas

**`localStorage`.** Lo más simple, lo que hace casi todo tutorial, y sobrevive al refresh de
página sin trabajo adicional. Descartada: cualquier XSS lo lee entero. Sobre datos de salud
el costo de esa comodidad es inaceptable.

**`sessionStorage`.** Idénticamente vulnerable a XSS; lo único que gana es que muere al
cerrar la pestaña, lo que reduce la ventana pero no el vector. Mejora marginal sobre el
mismo riesgo de fondo.

**Cookie `httpOnly` también para el access token.** Más simple: el navegador la adjunta sola
y no hay nada que custodiar en memoria. Descartada porque obliga a resolver CSRF en **todos**
los endpoints en lugar de solo en el de refresh, y porque complica escenarios de cliente no
navegador. Es una alternativa defendible: si CSRF se resuelve de forma robusta y general,
vale reconsiderarla.

**Token en memoria sin refresh.** Máxima seguridad, sesión perdida en cada F5. Descartada
por usabilidad: el personal de recepción y los profesionales trabajan sesiones largas y
recargan la página con normalidad.

## Consecuencias

### Positivas

- Un XSS **no puede robar el access token**: no está en ningún almacén accesible desde JS.
- El refresh token es inalcanzable para JavaScript por diseño del navegador.
- El token queda naturalmente acotado a la pestaña, lo que limita el daño de una sesión
  comprometida.

### Negativas

- Al refrescar la página el access token se pierde y hay que pedir uno nuevo: aparece un
  estado de "reconectando" que toda pantalla debe tolerar.
- Requiere soporte de cookies y manejo de CSRF en el backend para el endpoint de refresh.
- El flujo de refresh es más complejo: hay que **encolar** las peticiones concurrentes
  mientras se renueva, para no disparar N refresh en paralelo.
- Si alguna vez hace falta `localStorage` para una preferencia de UI no sensible, habrá que
  agregar una excepción explícita en `eslint.config.js`. Que eso sea una decisión consciente
  y justificada es exactamente el punto.

### Qué obliga a hacer

- **F1/M02:** implementar el endpoint de refresh, reactivar CSRF para ese endpoint en el
  backend, y completar `error.interceptor.ts` con reintento y cola de peticiones ante un 401.
- Toda pantalla maneja el estado "sesión no disponible todavía" sin romperse.
- Ninguna excepción a la regla de ESLint sin justificación escrita en el propio archivo.
