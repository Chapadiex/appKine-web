# E2E contra el backend real, en el CI y al costado del entorno de desarrollo (AKINE G-9)

## Que corre en el CI

Job `e2e` de `.github/workflows/ci.yml`:

1. Clona `Chapadiex/appKine-api` en la **misma rama** que el PR, o `main` si no existe.
2. Levanta MySQL y Mailpit con el `compose.yaml` del backend (`-p akine`, red `akine_default`,
   contenedor `akine-mysql`, el que usan los specs viejos para sembrar por SQL).
3. Construye la imagen del backend con su `Dockerfile` (cache de capas de Actions) y la arranca
   con el perfil `local` y `AKINE_BOOTSTRAP_ADMIN_EMAIL=plataforma.e2e@ejemplo.test`.
4. Corre `--project=agenda --project=chromium`, sin el smoke de version de contrato (lo cubre
   el job `contrato`). Al fallar publica `e2e-report`: reporte HTML, trazas, capturas, videos y el
   log del backend.

## El catalogo global en una base nueva

Toda oferta cuelga de un servicio del catalogo global, y crearlo exige rol de plataforma. El
sembrado de `agenda-setup` (`e2e/support/sembrado.ts`, `servicioAgendable`):

- si el catalogo ya tiene un servicio activo (la base de desarrollo de siempre), usa el primero;
- si esta vacio, ingresa como admin de plataforma con `AKINE_E2E_PLATAFORMA_EMAIL`
  (default `plataforma.e2e@ejemplo.test`). Si la cuenta todavia no tiene contrasena, lee de
  Mailpit el enlace que encolo el bootstrap de DP-14 (o pide el reenvio publico), la activa
  fijando la contrasena de los E2E, y da de alta `E2E_KINESIOLOGIA`. Un 409 de codigo repetido
  es otra corrida que ya lo creo.

La casilla tiene que ser la misma en el backend (`AKINE_BOOTSTRAP_ADMIN_EMAIL`) y en el sembrado.

## Correr una pila aislada en la maquina

Sin tocar `akine-mysql`, `akine-mailpit` ni los puertos 8080/4200 de quien este trabajando:

```bash
docker network create g9net
docker run -d --name g9-mysql --network g9net --network-alias mysql -p 3318:3306 \
  -e MYSQL_DATABASE=akine_local -e MYSQL_USER=akine -e MYSQL_PASSWORD=akine \
  -e MYSQL_ROOT_PASSWORD=root -e TZ=UTC mysql:8.4 \
  --character-set-server=utf8mb4 --collation-server=utf8mb4_0900_ai_ci \
  --default-time-zone=+00:00 --log-bin-trust-function-creators=1
docker run -d --name g9-mailpit --network g9net --network-alias mailpit -p 8036:8025 \
  -e MP_SMTP_AUTH_ACCEPT_ANY=true -e MP_SMTP_AUTH_ALLOW_INSECURE=true axllent/mailpit:v1.21.8
(cd ../appKine-api && docker build -t akine-api:e2e .)
docker run -d --name g9-api --network g9net -p 8090:8080 -e SPRING_PROFILES_ACTIVE=local \
  -e 'AKINE_DB_URL=jdbc:mysql://mysql:3306/akine_local?useUnicode=true&characterEncoding=UTF-8&serverTimezone=UTC' \
  -e AKINE_DB_USER=akine -e AKINE_DB_PASSWORD=akine -e AKINE_MAIL_HOST=mailpit \
  -e AKINE_BOOTSTRAP_ADMIN_EMAIL=plataforma.e2e@ejemplo.test \
  -e AKINE_CORS_ORIGINS=http://localhost:4210 akine-api:e2e
```

Un `proxy.conf.json` copiado con `localhost:8090` como destino, y el frontend en otro puerto:

```bash
npx ng serve --port 4210 --proxy-config <copia-del-proxy>.json
AKINE_E2E_WEB=http://localhost:4210 AKINE_E2E_API=http://localhost:8090 \
AKINE_E2E_MAILPIT=http://localhost:8036 AKINE_E2E_MYSQL_CONTAINER=g9-mysql \
  npx playwright test --project=agenda --project=chromium --workers=1
```

Al terminar: `docker rm -f g9-api g9-mysql g9-mailpit && docker network rm g9net`.

| Variable | Default | Para que |
|---|---|---|
| `AKINE_E2E_WEB` | `http://localhost:4200` | `baseURL` y servidor de Playwright |
| `AKINE_E2E_API` | `http://localhost:8080` | Backend directo del sembrado |
| `AKINE_E2E_MAILPIT` | `http://localhost:8025` | API de Mailpit |
| `AKINE_E2E_MYSQL_CONTAINER` | `akine-mysql` | Contenedor del sembrado por SQL de los specs de 01.02 |
| `AKINE_E2E_PLATAFORMA_EMAIL` | `plataforma.e2e@ejemplo.test` | Admin de plataforma del bootstrap |

## Cuenta y cobertura de punta a punta (AKINE A-6, B-6)

`e2e/cuenta-ciclo-real.spec.ts` y `e2e/cobertura-autorizacion.spec.ts` corren en el proyecto
`chromium`, asi que entran solos en el job `e2e`. No siembran por SQL: las cuentas se activan y la
contrasena se restablece con el enlace real que el backend manda a Mailpit, leido por asunto con
`enlaceDelCorreo` (`e2e/support/cuentas.ts`).

- Del enlace se usa la **ruta** y no el origen: el origen lo fija `AKINE_PUBLIC_BASE_URL` del
  backend (default `http://localhost:4200`), que en una pila aislada no es el puerto del frontend
  bajo prueba. Navegar la ruta contra el `baseURL` es abrir el mismo enlace en el frontend que se
  prueba.
- Los `problemType` se afirman con la URI completa (`esperarProblema(respuesta, 409,
  'https://akine.app/problems/...')`), que es la forma que `npm run api:check` contrasta contra el
  contrato.
- Los hechos de auditoria de identidad (activacion, login, restablecimiento) se graban sin
  `organization_id` y ninguna API los lee: el spec de A-6 los consulta en `audit_event` por el
  contenedor de `AKINE_E2E_MYSQL_CONTAINER`, en modo lectura. Los del tenant van por la API y por
  la pantalla de Auditoria.
- Para no compartir los archivos de coordinacion (`akine-e2e-registros.json`, el centro de
  agenda) con otra corrida en la misma maquina, apunta `TEMP`/`TMP` a un directorio propio.

## Las verticales del 07/10 (`e2e/flujo-*.spec.ts`)

Corren en el proyecto `agenda` —el CI ya lo invoca— porque usan el mismo centro sembrado: un
segundo centro serian dos altas mas contra el limite de 4 por minuto.

| Spec | Que recorre | Error real que afirma |
|---|---|---|
| `flujo-caja` | Abrir, movimiento manual, revertir, cerrar con arqueo y faltante; cobro en efectivo de una sesion cerrada que entra a la caja | `caja-saldo-insuficiente`, `caja-saldo-cambio`, `caja-no-abierta` |
| `flujo-presentaciones` | Deuda del financiador (convenio + arancel + cobertura, sesion cerrada) → borrador → agregar → revisar → confirmar → factura → pago → conciliar | `obligacion-no-presentable`, `presentacion-no-concilia` |
| `flujo-series` | Alta con previsualizacion → bandeja `/agenda/series` → detalle → cancelar "este y los siguientes" | `turno-transicion-no-permitida` |
| `flujo-prepago` | Oferta que exige prepago: PENDIENTE antes del check-in → registrar el anticipo → REGISTRADO | `prepago-ya-registrado`, `prepago-no-admitido` |

Tres cosas que el sembrado tiene que saber y que no son obvias:

- **La sesion la cierra la profesional, no la administradora.** `sesion:register` es exclusivo del
  rol PROFESIONAL y no se puede otorgar como grant, y la sesion es de quien atiende el turno
  (`turno-no-atendible` / `sesion-ajena`). Por eso `agenda-setup` activa tambien la cuenta de la
  profesional, y `comoProfesional` ingresa por la API eligiendo el contexto del centro (tiene ademas
  el de su consultorio propio).
- **Sin precio no hay deuda, y no lo avisa nadie.** El devengado sin precio vigente no crea la
  obligacion y solo deja un `log.warn`. `fijarPrecio` carga un precio particular desde hoy.
- **La caja es una por sede.** Los dos tests que la abren viven en `flujo-caja.spec.ts`, corren en
  orden (`mode: 'default'`) y arrancan cerrando lo que haya quedado abierto. El prepago y el pago
  del financiador van por transferencia para no tocar el cajon.
