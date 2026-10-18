# Imagen Docker del frontend (G-3)

La SPA se sirve como estatico desde una imagen nginx sin privilegios. Es el espejo de la imagen
del backend (`appKine-api/Dockerfile`, PR #29): dos etapas, sin secretos ni URLs de entorno
dentro de la imagen, SBOM CycloneDX embebido y job `imagen` en el CI que la construye sin
publicarla.

## Construir y correr

```bash
docker build -t akine-web:local .

# Contra un backend corriendo en la maquina (./mvnw spring-boot:run en appKine-api):
docker run --rm -p 4200:8080 -e AKINE_API_URL=http://host.docker.internal:8080 akine-web:local
```

Frontend en `http://localhost:4200`. En `docker compose`, con el backend como servicio
`akine-api` en la misma red, no hace falta pasar nada: es el default de `AKINE_API_URL`.

## Como llega la URL del backend: en runtime, no en el build

El bundle hace peticiones **relativas** (`/api/...`): `environment.apiBaseUrl` esta vacio a
proposito (AGENT.md §9). En desarrollo las resuelve `proxy.conf.json`; en la imagen, **nginx hace
de proxy inverso** de `/api/` hacia `AKINE_API_URL`. Consecuencias:

- **Un solo bundle para todos los entornos.** Cambiar de backend es cambiar una variable al
  arrancar el contenedor, no recompilar. No hubo que tocar codigo de la app ni los tests.
- **Mismo origen.** Sin CORS entre frontend y backend, y la cookie de refresh viaja como
  first-party, igual que en desarrollo.
- El backend se resuelve **en cada peticion**, no al arrancar: el contenedor levanta aunque el
  backend todavia no exista, y `/api` responde 502 hasta que aparece.
- `/actuator` y `/v3/api-docs` **no** se exponen a traves del frontend.

| Variable        | Default                 | Para que                                                             |
| --------------- | ----------------------- | -------------------------------------------------------------------- |
| `AKINE_API_URL` | `http://akine-api:8080` | Backend al que se reenvia `/api/`. Esquema + host + puerto, sin path |

## Que hace el nginx

Configuracion en `docker/nginx/`: `default.conf.template` (plantilla que el entrypoint oficial
procesa con `envsubst` al arrancar) y `security-headers.conf`.

- **Fallback de SPA**: toda ruta que no es un archivo recibe `index.html`.
- **Cache**: archivos con hash en el nombre (`chunk-XXXXXXXX.js`, `styles-XXXXXXXX.css`) un anio
  e `immutable`; si no existen, 404 —nunca `index.html` servido como JavaScript—. `index.html`
  con `no-store` y sin `ETag` ni `Last-Modified`: apunta a los hashes del despliegue vigente y
  lleva el nonce de la CSP, que cambia en cada respuesta (ver abajo).
- **Compresion**: JavaScript y CSS van **precomprimidos desde el build** (ver abajo); el resto
  (`index.html`, SVG, JSON de `/api`) se comprime al vuelo con gzip.
- **Cabeceras**: CSP con nonce y sin `'unsafe-inline'`, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` (todo lo que AKINE no usa, apagado),
  `Cross-Origin-Opener-Policy` y `Cross-Origin-Resource-Policy`. **HSTS no**: lo pone quien
  termina TLS delante del contenedor.
- **Healthcheck**: `GET /healthz` responde `ok` sin tocar el backend.
- Corre como UID 101 (`nginx`) y escucha en **8080**.

### Brotli sin el modulo de Brotli (AKINE-LCP)

`nginx-unprivileged` no trae `ngx_brotli`, y compilarlo cambiaria la imagen base. En su lugar,
`npm run build` (`scripts/build-produccion.mjs`) deja junto a cada `.js` y `.css` un `.br`
(calidad 11) y un `.gz` (nivel 9), y nginx los sirve como archivos estaticos:

- `map $http_accept_encoding $akine_br` vale `.br` si el pedido anuncia `br`, y el location de
  los archivos con hash hace `try_files $uri$akine_br $uri`.
- `types { application/javascript js br; }` (y el de CSS) para que el `.br` salga con el
  Content-Type de su extension original.
- `Content-Encoding: br` sale de `map $request_filename`: mira el archivo **elegido**, no el
  pedido. Si un `.br` faltara, se sirve el original sin anunciar una codificacion que no tiene.
- Sin `br` en el pedido, `gzip_static` sirve el `.gz`; sin ninguna, el original. La compresion al
  vuelo se apaga en esos locations, y `Vary: Accept-Encoding` va siempre (snippet
  `docker/nginx/precomprimido.conf`).

El `main` pasa de 99,7 KB (gzip 5 al vuelo) a **86 KB** con Brotli. El job `imagen` del CI
verifica las tres variantes, el Content-Type, la CSP y el `Vary`.

### Manifiesto de precarga de cada pantalla (AKINE-LCP)

Cada pantalla es un chunk perezoso que importa de forma estatica chunks compartidos
(formularios, servicios del cliente generado, componentes de `shared/`), que el navegador recien
descubre al analizarlo. El build escribe en el `index.html` un bloque
`<script type="application/json" id="akine-precarga">` con, para cada chunk de pantalla, el
cierre de sus dependencias; `core/services/precarga-de-modulos.ts` agrega un
`<link rel="modulepreload">` por cada una cuando el router empieza a bajar la pantalla. Es un
bloque de datos: no se ejecuta, y la CSP no necesita ningun cambio.

### La CSP con nonce (AKINE-09.02)

Hasta 09.02 la CSP tenia `style-src 'unsafe-inline'` —Angular inyecta los estilos de cada
componente en elementos `<style>`— y `'unsafe-hashes'` con el hash del
`<link media="print" onload="this.media='all'">` con el que carga la hoja diferida. La primera
dejaba aplicarse cualquier `<style>` que un XSS lograra inyectar.

Ahora no hay ninguna de las dos. `src/index.html` declara
`<app-root ngCspNonce="AKINE_CSP_NONCE">`, y con eso:

- **el build** le pone `nonce="AKINE_CSP_NONCE"` al CSS critico inlineado y reemplaza el
  `onload` de la hoja diferida por un `<script nonce>` que hace lo mismo;
- **Angular**, en runtime, lee `ngCspNonce` y se lo pone a cada `<style>` que inyecta;
- **nginx** (`location = /index.html`) reemplaza el marcador por `$request_id` —128 bits
  aleatorios por pedido— con `sub_filter`, y manda la cabecera con
  `script-src 'self' 'nonce-$request_id'; style-src 'self' 'nonce-$request_id'`.

Por eso `index.html` va con `no-store` y sin validadores: un 304 traeria la cabecera con el nonce
nuevo y el navegador reusaria el cuerpo con el viejo. En el dev server no hay CSP y el marcador
viaja tal cual, sin efecto.

Los `[style.x]` de las plantillas siguen funcionando (Angular los aplica por CSSOM, que la CSP no
restringe); un atributo `style="..."` **estatico** en una plantilla quedaria bloqueado.

El job `imagen` del CI **falla** si el `index.html` construido trae un handler `on...=`, un
`<style>` o un `<script>` inline sin el marcador, o si pierde `ngCspNonce`; y con el contenedor
arriba comprueba que el nonce de la cabecera es el del cuerpo, que cambia entre pedidos y que la
CSP no admite `unsafe-*`. Verificado en Chromium contra la imagen el 16/10/2026: la app pinta con
estilos, sin violaciones de CSP, y un `<style>` inyectado sin nonce queda bloqueado.

## SBOM

`@cyclonedx/cyclonedx-npm` (version fijada en el `Dockerfile`) genera en la etapa de build un
SBOM CycloneDX 1.6 de las dependencias de **runtime** (`--omit dev`): lo que termina en el
bundle. Queda en la imagen en `/usr/share/akine/sbom/akine-web.cdx.json`, **fuera de la raiz
web**. Para extraerlo a mano:

```bash
id=$(docker create akine-web:local)
docker cp "$id:/usr/share/akine/sbom/akine-web.cdx.json" .
docker rm "$id"
```

## En el CI

El job `imagen` de `.github/workflows/ci.yml` construye la imagen, extrae el SBOM, verifica la
CSP contra el `index.html` construido, arranca el contenedor y prueba ruta profunda, cache,
cabeceras y usuario no-root, y publica el SBOM como artifact `akine-web-sbom` (90 dias).
**No hace push a ningun registry.**
