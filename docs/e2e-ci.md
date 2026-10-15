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

## El navegador corre en otra zona que la sede, a proposito

Los proyectos `agenda` y `chromium` fijan `timezoneId` del navegador (`playwright.config.ts`,
`ZONA_DEL_NAVEGADOR`) en una zona cuyo dia es **otro** que el de la sede al arrancar la corrida:
`Pacific/Kiritimati` desde las 07:00 de Cordoba, `Pacific/Pago_Pago` antes. "Hoy" en AKINE es el
dia de la sede; cualquier `new Date()` que se cuele en una pantalla o en un helper falla siempre, y
no solo entre las 21:00 y las 24:00 de Cordoba, que es cuando un runner en UTC ya esta en el dia
siguiente (asi se cayo el job del PR #42). Para reproducir algo puntual se fija a mano con
`AKINE_E2E_TIMEZONE` (por ejemplo `UTC`); `AKINE_E2E_ZONA_SEDE` cambia la zona de referencia.

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

| Variable                     | Default                       | Para que                                              |
| ---------------------------- | ----------------------------- | ----------------------------------------------------- |
| `AKINE_E2E_WEB`              | `http://localhost:4200`       | `baseURL` y servidor de Playwright                    |
| `AKINE_E2E_API`              | `http://localhost:8080`       | Backend directo del sembrado                          |
| `AKINE_E2E_MAILPIT`          | `http://localhost:8025`       | API de Mailpit                                        |
| `AKINE_E2E_MYSQL_CONTAINER`  | `akine-mysql`                 | Contenedor del sembrado por SQL de los specs de 01.02 |
| `AKINE_E2E_PLATAFORMA_EMAIL` | `plataforma.e2e@ejemplo.test` | Admin de plataforma del bootstrap                     |

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

| Spec                   | Que recorre                                                                                                                                    | Error real que afirma                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `flujo-caja`           | Abrir, movimiento manual, revertir, cerrar con arqueo y faltante; cobro en efectivo de una sesion cerrada que entra a la caja                  | `caja-saldo-insuficiente`, `caja-saldo-cambio`, `caja-no-abierta` |
| `flujo-presentaciones` | Deuda del financiador (convenio + arancel + cobertura, sesion cerrada) → borrador → agregar → revisar → confirmar → factura → pago → conciliar | `obligacion-no-presentable`, `presentacion-no-concilia`           |
| `flujo-series`         | Alta con previsualizacion → bandeja `/agenda/series` → detalle → cancelar "este y los siguientes"                                              | `turno-transicion-no-permitida`                                   |
| `flujo-prepago`        | Oferta que exige prepago: PENDIENTE antes del check-in → registrar el anticipo → REGISTRADO                                                    | `prepago-ya-registrado`, `prepago-no-admitido`                    |

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

## Las pantallas del 08/10 al 11/10 (`e2e/flujo-*.spec.ts`, segunda tanda)

Mismo proyecto `agenda` y mismo centro sembrado. Cada una trabaja sobre lo suyo (su oferta, su
persona, su turno en su propio bloque de `DIAS`); ninguna usa efectivo.

| Spec                          | Que recorre                                                                                                                                                                                                                            | Lo que afirma contra el backend real                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `flujo-colaboradores`         | Cuenta nueva vinculada como admin de sede → el selector de permisos ofrece exactamente `permisos-otorgables` del rol → otorgar → cambiar el rol a Profesional → marca "No vigente con el rol actual" → dar de baja                     | `permiso-no-otorgable-al-rol` al reotorgarlo por la API                                                           |
| `flujo-autorizaciones`        | Autorizacion APROBADA con cobertura, convenio y arancel; la profesional cierra la sesion → saldo y ledger (consumo de la sesion) → anular el coseguro desde la cuenta corriente → alerta "consumo a revisar" → revertir desde el panel | La anulacion no devuelve la unidad; la reversion si, y resuelve la alerta                                         |
| `flujo-notificaciones`        | Persona con correo reserva → `TURNO_RESERVADO` sale a Mailpit → **sembrado declarado: la fila ENVIADA pasa a FALLIDA por SQL** → listado por defecto → reintentar desde la fila → el worker la vuelve a entregar (segundo correo)      | 409 al reintentar una ENVIADA                                                                                     |
| `flujo-cobros-posteriores`    | Anticipo por transferencia → imputarlo despues a la deuda desde la cuenta corriente → anular el cobro (la deuda recupera el saldo) → reintegrar parte de otro anticipo                                                                 | El anulado queda ANULADO por id; con reintegro hecho, "Anular" queda deshabilitado con su motivo                  |
| `flujo-practicas-y-aranceles` | Practicas de una oferta: agregar `KIN_SESION` y `KIN_EVAL`, elegir principal, guardar, quitar una. Importacion: planilla con una fila que se pisa → vista previa la marca → corregir → confirmar 2                                     | `practicaPrincipalId` y la grilla del convenio leidas por la API                                                  |
| `flujo-dia-de-la-sede`        | Navegador en `Pacific/Kiritimati` con el reloj fijado a las 23:30 del ultimo dia del mes anterior en la zona de la sede → `/reportes` y `/contratacion/convenios`                                                                      | Proponen el dia y el MES de la sede. Verificado por mutacion: con `hoy()` devolviendo el dia del navegador, falla |

- **La falla de envio no tiene camino en el producto.** Contra Mailpit, que acepta cualquier
  destinatario, no se puede provocar un fallo permanente del SMTP sin bajar el servidor de correo
  que comparten los demas specs. Por eso `flujo-notificaciones` escribe FALLIDA en la fila ya
  ENVIADA (contenedor de `AKINE_E2E_MYSQL_CONTAINER`); el listado, el reintento y el segundo envio
  son del backend real. Se usa un aviso de turno porque no lleva enlace: uno de activacion o de
  invitacion moriria AGOTADA por enlace consumido.
- **`reservarElPrimeroLibre`**: el CI reintenta dos veces, y el reintento encuentra ocupado el
  horario que reservo el intento anterior. Los specs nuevos reservan el primer slot libre del dia.

## Configuracion y padron (`e2e/flujo-*.spec.ts`, tercera tanda)

Espacios, catalogo, horarios, servicios y padron, en el mismo proyecto `agenda` y sobre el mismo
centro. Los helpers viven en `e2e/support/sembrado-configuracion.ts` (no en `sembrado.ts`, para no
chocar con otros PR que agregan al final), y sus bloques de dias en `DIAS_CONFIGURACION` (110 y
116, despues de los de `DIAS`).

| Spec              | Que recorre                                                                                                                                                                                                                                                        | Lo que afirma contra el backend real                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `flujo-espacios`  | Alta del box por pantalla → turno pendiente en ese box (oferta que exige espacio, habilitada solo ahi) → baja frenada → se cancela el turno → baja con motivo → historico con su motivo                                                                            | `espacio-has-active-references` con `referenceCount: 1`, y el texto "1 turno pendiente"         |
| `flujo-catalogo`  | Especialidad propia del centro (filtro "de este centro" si, "de la plataforma" no). Pedido al catalogo comun → la plataforma lo aprueba en `/plataforma/solicitudes` → el centro lo ve Aprobado con la nota → aparece entre los de la plataforma                   | El ida y vuelta de RF-M06-005 con dos cuentas                                                   |
| `flujo-horarios`  | Profesional PROPIA (no la compartida) → bloque semanal por pantalla en el dia de la semana de un feriado nacional F → turno en F+14 → cierre de la profesional en F+14 con impacto "Turnos afectados: 1" → "Cargar igual" → el feriado en el calendario de la sede | Agenda: F = `FERIADO`, F+7 con sus 3 turnos, F+14 = `CIERRE`; tambien en la grilla de `/agenda` |
| `flujo-servicios` | La plataforma da de alta un servicio global → el centro arma la oferta, habilita a su profesional y le carga un precio particular → la plataforma da de baja el servicio                                                                                           | La oferta sigue ACTIVA, con su precio y sus turnos: la baja no cascadea                         |
| `flujo-padron`    | Alta de persona → activar perfil con el motivo VACIO → editar → baja de la ficha desde el 360                                                                                                                                                                      | El boton del motivo opcional envia (el bug del 30/08); el de la baja, con motivo vacio, no      |

- **Horarios no toca al profesional compartido ni al horario de la sede**: vincula una cuenta nueva
  (un alta self-service mas, dentro del cupo de `esperarCupoDeRegistro`). Los feriados se leen del
  calendario nacional; si la sede no cierra por feriado, el test se saltea diciendolo.
- **Catalogo (la aprobacion) y servicios necesitan la cuenta de plataforma** del bootstrap de DP-14.
  `plataformaDisponible()` la activa por Mailpit si hace falta y, si no puede, el test se saltea con
  el motivo. La plataforma ingresa por pantalla en un navegador aparte, sin contexto de centro.
- El servicio de `flujo-servicios` queda dado de baja: `servicioAgendable` toma el PRIMER servicio
  activo, asi que no cambia las corridas siguientes.
- **Los specs de "hoy" fallan en un dia feriado**: `agenda-recepcion` y `flujo-prepago` reservan
  turnos de HOY, y el 12/10/2026 (feriado nacional) la agenda del dia viene `FERIADO`. No es de esta
  tanda; queda anotado porque se vio al correr la suite entera ese dia.

## Las pantallas del contrato 0.98.0 (`e2e/flujo-*.spec.ts`, cuarta tanda)

Lo que entro con web #74, en el mismo proyecto `agenda` y sobre el mismo centro. Helpers en
`e2e/support/sembrado-pantallas-098.ts`, bloques de dias en `DIAS_PANTALLAS_098` (130 a 136).

| Spec                            | Que recorre                                                                                                                                 | Lo que afirma contra el backend real                                                                                                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flujo-presentacion-csv`        | Deuda del financiador (convenio + arancel + cobertura, sesion cerrada) → lote armado y confirmado por la API → "Exportar CSV" en el detalle | La descarga se llama como dice `Content-Disposition` (`presentacion-<financiador>-<numero>.csv`), el pedido sale con `Accept: text/csv`, el archivo trae cabecera del lote y una fila por la prestacion con `personaId`, y **ni el nombre ni el apellido** del paciente |
| `flujo-cobertura-al-reservar`   | Persona con cobertura FINANCIADA → reserva por pantalla eligiendola en el selector                                                          | El pedido lleva `coberturaId`, el turno reservado la muestra, y releido por la API (`POST .../confirmacion`, idempotente) la tiene guardada                                                                                                                             |
| `flujo-consumos-a-revisar`      | Autorizacion consumida por un cierre → anular el coseguro por la API → revertir el consumo por la API                                       | La fila del listado no tiene marca, despues "1 consumo a revisar", y despues de la reversion vuelve a no tenerla con el saldo devuelto                                                                                                                                  |
| `flujo-historia-administrativa` | La profesional abre historia, antecedente y caso con diagnostico y objetivo de texto unico → cuenta nueva ADMINISTRATIVO en el 360          | Ve el caso, su oferta y el equipo vigente; ningun texto clinico ni en la pantalla ni en `datos-administrativos`; `GET` de la historia clinica le responde 403; una paciente sin historia muestra "todavia no tiene historia clinica"                                    |

- **`GET /turnos/{id}` no publica la cobertura elegida.** `TurnoDelDia` no tiene `coberturaId`; el
  `Turno` entero lo devuelven la reserva y las transiciones. Por eso el spec relee con la
  confirmacion, que es idempotente.
- **Releer una pantalla pasando por otra** tiene que esperar a que la otra se dibuje: con dos
  `navegar` seguidos el router descarta la intermedia, ve la misma URL y no relee.
- **La cuenta ADMINISTRATIVO es un alta self-service mas** (dentro del cupo de
  `esperarCupoDeRegistro`), activada por Mailpit: tiene dos contextos y elige el del centro en el
  selector.

## Inventario de pantallas no clinicas (`e2e/flujo-*.spec.ts`, quinta tanda)

Mismo proyecto `agenda` y mismo centro, salvo `flujo-suscripcion` (organizacion propia: suspenderla
dejaria en solo lectura a los demas). Helpers en `e2e/support/sembrado-inventario.ts`, bloques de
dias en `DIAS_INVENTARIO` (150, 160 y 195: despues de los 90 dias del horizonte con que el backend
simula el impacto de un cambio de horario, asi que no le mueven la cuenta a `flujo-horarios`).

| Spec                              | Que recorre                                                                                                                                                                                                                                                    | Lo que afirma contra el backend real                                                                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flujo-reportes`                  | Dos turnos en un dia propio, uno cancelado → reporte de Turnos de ese dia → "Descargar CSV"                                                                                                                                                                    | 2 turnos, 1 reservado, 1 cancelado en pantalla (con fuente y fecha de corte), en el detalle y en el CSV; el pedido sale con `Accept: text/csv` y los mismos `desde`/`hasta` |
| `flujo-serie-reprogramada`        | Serie de 3 semanas por la API → detalle → "Reprogramar" el segundo con "Este turno y los siguientes" → otro horario del mismo dia                                                                                                                              | Previsualiza 2; el servidor deja el primero donde estaba y los otros dos RESERVADOS en la hora nueva                                                                        |
| `flujo-coberturas-y-aranceles`    | Arancel general por la API → arancel PROPIO de la oferta por la grilla del convenio → 360 → Coberturas por oferta → Consultar un arancel                                                                                                                       | El propio manda sobre el general en las tres pantallas; el 360 enmascara el afiliado; sin oferta rige el general                                                            |
| `flujo-financiadores`             | Alta de obra social → busqueda → plan con copago y autorizacion previa → convenio de la sede con ese plan                                                                                                                                                      | Copago con su moneda y las dos marcas del plan, releidos; el convenio nace con financiador, plan, modalidad y moneda                                                        |
| `flujo-cuenta-corriente-concepto` | Misma persona: sesion con convenio (coseguro) y sesion particular                                                                                                                                                                                              | Fila "Coseguro" con "Convenio X", fila "Particular" sin convenio; la deuda del financiador no aparece en la cuenta de la persona                                            |
| `flujo-suscripcion`               | Organizacion propia → `/organizacion/suscripcion` → la plataforma cambia el plan y suspende con motivo                                                                                                                                                         | Plan, estado y tope de sedes antes y despues; banner con el motivo; el alta de sede responde `subscription-suspended`                                                       |
| `flujo-auditoria-clinica`         | La profesional abre una historia con justificacion de texto unico → la ORG_ADMIN busca esa entidad en Auditoria                                                                                                                                                | Fila `HISTORIA_CLINICA_OPENED` con el motivo `[redactado: exige auditoria:read-clinica]`; el texto esta en `audit_event` (lectura) y no viaja en la respuesta               |
| `flujo-invitaciones`              | Invitar por pantalla → el enlace del correo abre la invitacion sin sesion → cancelar con motivo                                                                                                                                                                | La fila figura en "Las canceladas" con el motivo; el mismo enlace ya no abre nada                                                                                           |
| `flujo-disponibilidad-resuelta`   | `/espacios/disponibilidad` con un espacio que cubre el periodo y otro que vence en el medio; `/horarios/efectivo` de la profesional del centro                                                                                                                 | Solo entra el primero, con su capacidad; los dias con atencion y la zona son los que resuelve el servidor                                                                   |
| `flujo-documentos`                | Subir un PDF a la persona → descargarlo → subir texto con extension `.pdf`                                                                                                                                                                                     | Los mismos bytes de vuelta; el disfrazado lo rechaza el servidor por el contenido (`archivo-no-aceptado`)                                                                   |
| `flujo-reenvio-y-vinculo`         | Cuenta nueva pide otro enlace en `/auth/reenviar-activacion` y se activa con el → desde su consultorio propio vincula a la profesional del centro en `/organizacion/colaboradores/nuevo` (no al centro: su plan BASICO tope 5 miembros y la suite ya lo llena) | Segundo token distinto del primero; vinculo 201 y la fila "Profesional" en el listado                                                                                       |

- **Contratacion redacta los importes como `ARS 12000.00`** (`etiquetas-de-contracting`) y billing y
  coberturas como `$ 12.000,00`: los specs afirman cada uno con su formato.
- **`/espacios/disponibilidad` interpreta el `datetime-local` en la zona del navegador**, no en la de
  la sede (ver el PR). El spec pone las vigencias lejos de los bordes para no depender de eso.

### Lo que sigue sin E2E contra el backend real

| Pantalla                                | Por que                                                                |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `/catalogo/nomencladores/:id/vigencias` | Necesita un nomenclador propio sembrado; queda para la proxima tanda   |
| `/auth/sesion-expirada`                 | Exige vencer el refresh; hoy solo la cubre el unitario                 |
| `/auth/invitacion` (aceptar)            | El spec abre y cancela; aceptar crea una cuenta (un alta mas del cupo) |

## Asistencia de clases (F9, `e2e/flujo-asistencia.spec.ts`)

En el proyecto `agenda`, sobre el mismo centro. Helpers en `e2e/support/sembrado-asistencia.ts`,
bloque de dias en `DIAS_ASISTENCIA` (140). La clase es de una oferta `GRUPAL` sin profesional ni
espacio, y es **futura** a proposito: inscribir a una clase que ya empezo es
`clase-transicion-no-permitida` ("ya empezo"), e iniciar la asistencia no tiene restriccion de hora.

| Spec               | Que recorre                                                                                                                                                                                                                                                  | Lo que afirma contra el backend real                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flujo-asistencia` | Clase con cuatro inscriptas → `/asistencia` con la fecha de la clase → iniciar → con la pantalla abierta se cancela una inscripcion por la API → lote presente/tarde/ausente/cancelada → correccion sin motivo (bloqueada) y con motivo → historial → cerrar | El lote devuelve 3 exitosos y 1 fallido con `inscripcion-transicion-no-permitida`, sin deshacer los demas; la correccion viaja con su motivo; el historial guarda "Ausente a Presente"; el detalle final es `REALIZADA` con 3 presentes y 0 ausentes |

- **La derivacion clinica no tiene E2E** porque el backend no publica API para ella (08.04 sin
  controller). El consumo de un pase si: ver la seccion siguiente.
- **`aceptaListaEspera` va explicito al inscribir:** el contrato lo declara opcional y el backend
  responde 400 si falta (`boolean` primitivo en `InscribirRequest`).

## Pases y productos de pack (F9, `e2e/flujo-pases.spec.ts`)

En el proyecto `agenda`, sobre el mismo centro. Helpers en `e2e/support/sembrado-pases.ts`. La
oferta es `GRUPAL` con `esquemaCobro = POR_PACK` y la clase cae en el primer dia programable de
`DIAS_PASES` (4 a 10 dias desde hoy): **cercana a proposito**, porque el pase vale 60 dias desde hoy
y el consumo exige que este vigente el dia de la clase.

| Spec          | Que recorre                                                                                                                                                            | Lo que afirma contra el backend real                                                                                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flujo-pases` | `/productos`: alta del producto de 2 creditos → `/pacientes/:id/pases`: venta → `/asistencia/:claseId`: iniciar y marcar presente → ledger del pase → cuenta corriente | El alta es 201; la venta es 201 con la deuda `PENDIENTE` y el pase en 2 de 2; el lote devuelve `consumoDeCredito` `CONSUMIDO` con saldo 1; el ledger tiene compra +2 y consumo -1; la deuda sin sesion dice "Venta de pase" |

## Las pantallas de mas riesgo, con centro propio (`e2e/riesgo-*.spec.ts`)

Dinero, permisos y concurrencia. Corren en el proyecto `chromium` (no se llaman `flujo-*`) y **cada
archivo siembra su propio centro** en `beforeAll` con `sembrarCentroPropio`
(`e2e/support/centro-propio.ts`, sobre `altaDeCentro` de `sembrado.ts`): abren y cierran la caja,
anulan lotes y otorgan permisos, que es estado de la SEDE. Sobre el centro compartido le cambiarian
el estado a los `flujo-*`, y sumarle miembros a un centro BASICO lo lleva a `plan-limit-exceeded`.
Son dos altas por archivo dentro del cupo de `esperarCupoDeRegistro`. Ninguno usa `route.fulfill`.

| Spec                                    | Que recorre                                                                                                                                                                          | Lo que afirma contra el backend real                                                                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `riesgo-cobro-efectivo-anulado`         | Cobro en EFECTIVO por pantalla → anularlo desde `/cobros` → arqueo. Despues: anular un cobro en efectivo con la caja cerrada, con la caja vacia y con la plata en el cajon           | La deuda vuelve a PENDIENTE entera, el teorico vuelve al saldo inicial y el arqueo cierra sin diferencia; `cobro-anulado` al repetir; `caja-no-abierta` y `caja-saldo-insuficiente` sin tocar la deuda             |
| `riesgo-presentacion-debito-y-descarte` | Borrador con dos deudas → quitar una → descartar con motivo. Lote presentado → debito excedido → debito total de una → factura → pago → conciliar → borrador nuevo                   | Quitar y descartar liberan la deuda; un lote presentado no se descarta (`presentacion-no-editable`); `validation-error` con `importePresentado`; `item-no-debitable`; la debitada sigue PENDIENTE y re-presentable |
| `riesgo-egreso-concurrente`             | Borrador corregido por otro operador mientras la pantalla lo muestra → guardar. Pago registrado por otro operador → "Anular el egreso" en la pantalla vieja → anular el pago primero | `concurrent-modification` sin pisar lo del otro; `egreso-con-pagos`; la pantalla recargada esconde la anulacion y ofrece anular el pago                                                                            |
| `riesgo-permisos-de-la-plata`           | Una PROFESIONAL del centro: caja, presentaciones, egresos, cobros por la API y por URL; grant `paciente:manage` otorgado y quitado                                                   | `forbidden` en todo lo economico, `/sin-permiso` en cada pantalla, la cuenta corriente dice por que no muestra nada; `caja:operate` no otorgable; el grant vale y deja de valer con el MISMO token                 |
| `riesgo-autorizacion-ultima-unidad`     | Autorizacion de UNA unidad, dos sesiones de la misma practica cerradas a la vez por la profesional                                                                                   | Los dos cierres entran, la autorizacion consume una vez (Consumidas 1, Disponibles 0) y el ledger tiene un solo consumo                                                                                            |

- **Defecto del backend, test en `fixme`:** `riesgo-egreso-concurrente` › "un pago y una anulacion a
  la vez...". Con un pago en efectivo y la anulacion del egreso en paralelo, en 9 de 12 carreras los
  dos responden con exito y el egreso queda `ANULADO` con un pago vigente. El comentario del test
  tiene el pedido, la respuesta y la causa probable (`descontarSaldo` nativo sin `@Version`).
- **El debito parcial** deja hoy la deuda entera pendiente (U-11, conocido y aceptado): el spec
  debita el total, que es la regla que no depende de esa decision.
- **`cobro:register` no es otorgable a PROFESIONAL** (`permisos-otorgables` devuelve `hc:read`,
  `hc:write`, `paciente:manage`), aunque la matriz §2 dice "No por defecto" en esa celda. La §16.1
  no la lista; el spec usa `paciente:manage` y no afirma nada sobre `cobro:register`.

### Inventario de pantallas de riesgo y su E2E contra el backend real (15/10/2026)

| Pantalla                                                        | Cubierta | Spec                                                                                                              |
| --------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `/caja`: apertura, movimiento, reversion, cierre con arqueo     | Si       | `flujo-caja`                                                                                                      |
| `/pacientes/:id/cuenta-corriente`: deudas y anular una deuda    | Si       | `flujo-autorizaciones`, `flujo-cuenta-corriente-concepto`                                                         |
| `/cuenta-corriente/cobrar`                                      | Si       | `flujo-caja`, `flujo-prepago`, `riesgo-cobro-efectivo-anulado`                                                    |
| `/cuenta-corriente/cobros`: anular, reintegrar, imputar         | Si       | `flujo-cobros-posteriores` (transferencia), `riesgo-cobro-efectivo-anulado` (efectivo)                            |
| `/presentaciones` y detalle: armar, confirmar, pagar, conciliar | Si       | `flujo-presentaciones`, `flujo-presentacion-csv`                                                                  |
| `/presentaciones/:id`: quitar, descartar, debito                | Si       | `riesgo-presentacion-debito-y-descarte`                                                                           |
| `/egresos` y detalle: alta, confirmar, pagar, anular el pago    | Si       | `flujo-caja`                                                                                                      |
| `/egresos/:id`: corregir, anular el egreso, dos operadores      | Si       | `riesgo-egreso-concurrente` (la carrera pago/anulacion en `fixme`)                                                |
| `/pacientes/:id/coberturas` y `/autorizaciones`                 | Si       | `cobertura-autorizacion`, `flujo-autorizaciones`, `flujo-consumos-a-revisar`, `riesgo-autorizacion-ultima-unidad` |
| `/historia-clinica/personas/:id`: motivo de acceso              | Si       | `historia-clinica`, `acceso-clinico`, `flujo-auditoria-clinica`                                                   |
| Permisos por rol sobre la plata (PROFESIONAL)                   | Si       | `riesgo-permisos-de-la-plata`                                                                                     |
| Permisos por rol sobre lo clinico (ADMINISTRATIVO)              | Si       | `flujo-historia-administrativa`, `acceso-clinico`                                                                 |
| Permisos adicionales de un colaborador                          | Si       | `flujo-colaboradores`                                                                                             |
| `/catalogo/nomencladores/:id/vigencias`                         | No       | Ver la tabla de la quinta tanda                                                                                   |
| `/auth/sesion-expirada`, aceptar `/auth/invitacion`             | No       | Ver la tabla de la quinta tanda                                                                                   |

La atencion clinica, las clases y los pases/abonos los cubren sus propios PR y no entran aca.
