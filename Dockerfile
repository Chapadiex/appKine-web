# syntax=docker/dockerfile:1
#
# Imagen del frontend de AKINE (G-3).
#
#   docker build -t akine-web:local .
#   docker run --rm -p 4200:8080 -e AKINE_API_URL=http://host.docker.internal:8080 akine-web:local
#
# Dos etapas: la primera instala con `npm ci` y compila el bundle de produccion sobre Node 24;
# la segunda sirve el estatico con nginx corriendo como usuario sin privilegios. Lint y tests
# NO corren aca: corren en el job `build` del CI.
#
# La imagen NO lleva la URL del backend: nginx hace de proxy inverso de /api hacia
# AKINE_API_URL, que llega por variable de entorno al arrancar. El bundle sigue haciendo
# peticiones relativas (`environment.apiBaseUrl` vacio, AGENT.md §9), igual que con el proxy del
# dev server, asi que el mismo bundle sirve para cualquier entorno sin recompilar. Ver
# docs/imagen-docker.md.

# ============================================================================================
# Etapa 1 — build
# ============================================================================================
# Version exacta: un `node:24` flotante cambiaria el toolchain debajo del lockfile sin aviso.
FROM node:24.13.0-alpine AS build
WORKDIR /build

# Capa de dependencias: solo cambia cuando cambia el lockfile. Un cambio de codigo reutiliza
# esta capa y no vuelve a bajar node_modules.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# SBOM CycloneDX de las dependencias de RUNTIME (--omit dev): lo que termina dentro del bundle
# que se sirve. Las devDependencies (compilador, linters, test runners) no viajan en la imagen.
# Version de la herramienta fijada por el mismo motivo que la de Node.
RUN mkdir -p /sbom \
	&& npx --yes @cyclonedx/cyclonedx-npm@6.0.1 \
		--omit dev \
		--output-format JSON \
		--output-file /sbom/akine-web.cdx.json \
	&& test -s /sbom/akine-web.cdx.json

# Capa de codigo.
COPY angular.json tsconfig.json tsconfig.app.json ./
COPY public/ public/
COPY src/ src/
RUN npx ng build --configuration production

# ============================================================================================
# Etapa 2 — runtime
# ============================================================================================
# nginx-unprivileged: corre como el usuario `nginx` (UID 101) y escucha en 8080, sin
# capacidades para puertos privilegiados. El proceso nunca corre como root.
FROM nginxinc/nginx-unprivileged:1.30.0-alpine AS runtime

LABEL org.opencontainers.image.title="akine-web" \
	org.opencontainers.image.description="AKINE frontend - SPA Angular servida por nginx" \
	org.opencontainers.image.source="https://github.com/Chapadiex/appKine-web"

# Las modificaciones de /etc/nginx necesitan root; despues se vuelve al usuario sin privilegios.
USER root

# Se reemplaza el server por defecto por el de AKINE. La plantilla la procesa el entrypoint
# oficial (20-envsubst-on-templates.sh) al arrancar y la escribe en /etc/nginx/conf.d/.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY docker/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf

COPY --from=build /build/dist/akine-web/browser/ /usr/share/nginx/html/

# El SBOM queda en la imagen, FUERA de la raiz web: es evidencia para quien inspecciona la
# imagen (el CI lo extrae de aca), no un archivo que se publique a cualquier visitante.
COPY --from=build /sbom/akine-web.cdx.json /usr/share/akine/sbom/akine-web.cdx.json

RUN chown -R nginx:nginx /etc/nginx/conf.d

USER nginx

# AKINE_API_URL: backend al que nginx reenvia /api. Default pensado para docker compose, donde
# el servicio del backend se llama akine-api.
#
# NGINX_ENTRYPOINT_LOCAL_RESOLVERS: el entrypoint oficial expone los resolvers DNS del
# contenedor en NGINX_LOCAL_RESOLVERS. La plantilla los usa para resolver el backend en cada
# peticion y no al arrancar: asi nginx levanta aunque el backend todavia no exista.
#
# NGINX_ENVSUBST_FILTER: envsubst solo reemplaza estas variables. Sin filtro, cualquier variable
# de entorno que coincidiera con una de nginx (`$uri`, `$host`...) romperia la configuracion.
ENV AKINE_API_URL=http://akine-api:8080 \
	NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 \
	NGINX_ENVSUBST_FILTER="^(AKINE_|NGINX_LOCAL_RESOLVERS)"

EXPOSE 8080

# /healthz lo responde nginx sin tocar el backend: un corte del backend no se arregla
# reiniciando el frontend. wget viene en la imagen alpine (busybox).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
