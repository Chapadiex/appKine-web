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

| Variable | Default | Para que |
|---|---|---|
| `AKINE_API_URL` | `http://akine-api:8080` | Backend al que se reenvia `/api/`. Esquema + host + puerto, sin path |

## Que hace el nginx

Configuracion en `docker/nginx/`: `default.conf.template` (plantilla que el entrypoint oficial
procesa con `envsubst` al arrancar) y `security-headers.conf`.

- **Fallback de SPA**: toda ruta que no es un archivo recibe `index.html`.
- **Cache**: archivos con hash en el nombre (`chunk-XXXXXXXX.js`, `styles-XXXXXXXX.css`) un anio
  e `immutable`; si no existen, 404 —nunca `index.html` servido como JavaScript—. `index.html`
  con `no-cache`, porque es el que apunta a los hashes del despliegue vigente.
- **Cabeceras**: CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`, `Cross-Origin-Opener-Policy`. **HSTS no**: lo pone quien termina TLS
  delante del contenedor.
- **Healthcheck**: `GET /healthz` responde `ok` sin tocar el backend.
- Corre como UID 101 (`nginx`) y escucha en **8080**.

### La CSP y el onload de Angular

Angular inlinea el CSS critico y carga la hoja completa con
`<link media="print" onload="this.media='all'">`. Con `script-src 'self'` el navegador bloquea
ese handler y **la app queda sin estilos sin otro sintoma**. La CSP lo permite por hash
(`'unsafe-hashes' 'sha256-...'`), que habilita ese texto exacto y ningun otro inline.

Si una version de Angular cambia el texto del handler, el hash deja de coincidir. El job
`imagen` del CI extrae el `index.html` de la imagen, calcula el hash de cada `onload` y **falla**
si alguno no esta en `security-headers.conf`. Para actualizarlo:

```bash
printf '%s' "this.media='all'" | openssl dgst -sha256 -binary | base64
```

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
