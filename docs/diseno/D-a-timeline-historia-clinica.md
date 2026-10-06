# D-a — Timeline de la Historia Clínica (diseño)

> Paquete **D-a** del grupo **G3** (`../appKine-api/docs/fases/01-trabajo-en-paralelo.md`).
> Ficha: `../appKine-api/docs/fases/F4-dominio-clinico.md`, ítem "Timeline filtrable con
> paginación por cursor, entradas clínicas y adjuntos con preview seguro".
> Escrito el 06/10/2026 sobre `appKine-web` `481fa13` y `appKine-api` `8d05593` (contrato 0.46.0).
> Sin cambio de contrato: todo lo que usa la pantalla ya está publicado.

## 1. Qué se entrega

Una pantalla `/historia-clinica/personas/:personaId` que muestra la Historia Clínica de una persona:

1. **Cabecera**: nombre, documento, resumen clínico y antecedentes vigentes (RF-M09-001/002).
2. **Timeline** de hechos clínicos, del más nuevo al más viejo, paginado por **cursor** con
   "Cargar más" (RF-M09-003). Filtro opcional por **Caso Clínico** (el único filtro que el backend
   acepta; filtrar en el cliente una lista paginada mentiría).
3. **Detalle de un hecho** al elegirlo:
   - Entrada clínica: cuerpo, tipo, versión, si está enmendada, **historial de versiones** y
     **enmienda con motivo** (RN-M09-004: corregir es versionar, nunca pisar).
   - Adjunto clínico: título, categoría y **vista previa segura** (§3).
   - Antecedente: su descripción, tomada de la cabecera.
   - Sesión cerrada: sólo el índice. El detalle de una sesión vive en la atención.
4. **Registrar una entrada clínica** y **subir un adjunto** (RF-M09-003, RF-M25).
5. Si la persona **no tiene historia**, la pantalla lo dice y ofrece abrirla (PUT idempotente).

**Fuera de alcance, a propósito:** el enlace desde el Paciente 360 (es **D-e**), casos (D-b),
plan (D-c), baja de entradas y de adjuntos, reclasificar adjuntos y editar antecedentes. Ninguno
bloquea el timeline y cada uno tiene su paquete o queda para cuando haya pedido.

## 2. Acceso clínico justificado (DP-03)

El backend decide si hace falta motivo: con relación asistencial no lo pide; sin ella responde
**403 con `requiereJustificacion: true`**. La pantalla:

1. Pide la historia **sin** motivo.
2. Si el 403 trae `requiereJustificacion`, muestra un formulario con un único campo obligatorio
   y explica que el acceso queda auditado.
3. Reintenta con el header `X-Justificacion-Acceso`, y **reusa el mismo motivo en cada pedido de
   esta visita** (timeline, entradas, adjuntos): cada lectura se audita por separado.
4. El motivo vive **sólo en memoria** de la página. Recargar o volver a entrar lo vuelve a pedir:
   guardarlo convertiría el control en un formalismo, que es justamente lo que DP-03 evita.

Un 403 **sin** `requiereJustificacion` es falta de permiso (`hc:read`) y se informa como tal.

## 3. Vista previa segura de adjuntos

El archivo se baja como binario con el mismo motivo de acceso. Reglas:

- **Lista blanca de tipos** para mostrar en pantalla: `image/png`, `image/jpeg`, `image/webp`,
  `image/gif` como `<img>`, y `application/pdf` en un `<iframe>`. **Nada más se renderiza**:
  ni HTML, ni SVG, ni texto. El resto sólo se descarga.
- El `Blob` se **reconstruye con el tipo de la lista blanca**, nunca con uno que el navegador
  pueda adivinar. El tipo lo decide el backend por los bytes (03.02), y el cliente no lo amplía.
- La URL del blob se revoca al cerrar la vista previa y al destruir la pantalla: no quedan
  copias de un documento clínico colgando en memoria.
- La descarga pone el nombre del archivo y nunca abre el contenido en la misma pestaña.

## 4. Estructura

```
features/clinical/
├── historia-clinica.routes.ts         # monta personas/:personaId (contextGuard)
├── services/historia-clinica-api.ts   # única fachada sobre el cliente generado; lleva el motivo
├── models/historia-errors.ts          # traduce AkineHttpError a causas de esta pantalla
├── models/vista-previa.ts             # lista blanca y armado del Blob seguro
└── pages/historia-clinica/
    ├── historia-clinica-page.*        # cabecera, justificación, abrir HC, compone lo demás
    └── components/
        ├── timeline-clinico.*         # lista, cursor, filtro por caso, selección
        ├── detalle-de-entrada.*       # cuerpo, versiones, enmienda
        ├── visor-de-adjunto.*         # descarga y vista previa segura
        ├── nueva-entrada.*            # formulario de registro
        └── nuevo-adjunto.*            # formulario de subida
```

`app.routes.ts` suma la raíz `historia-clinica` con `authGuard`, igual que `atencion`.
Estados con unión discriminada (ADR-0005): `cargando`, `requiere-justificacion`, `sin-historia`,
`lista`, `error`.

## 5. Pruebas

Pocas y elegidas (preferencia del usuario):

- **Unitarias**: el flujo de justificación (403 → formulario → reintento con header y reuso del
  motivo), la paginación por cursor (la segunda página manda el cursor y concatena), y la lista
  blanca de la vista previa (un `text/html` no se renderiza).
- **E2E contra el backend real**: alta de organización, paciente, historia, una entrada y un
  adjunto por API; la pantalla muestra el timeline, abre la entrada, la enmienda y ve la versión
  2, y previsualiza el adjunto.

## 6. Design challenge (las ocho preguntas de `CLAUDE.md` §3)

1. **Contrato.** Todo existe en el cliente 0.46.0: historia por persona, timeline con cursor y
   filtro por caso, entradas con versiones y enmienda, adjuntos con descarga binaria y casos para
   el filtro. Ningún DTO a mano. Lo único que el evento no trae —nombre y tipo del archivo— viene
   a propósito en los headers de la descarga.
2. **Ubicación.** Todo en `features/clinical`. `shared/` no se toca: la lista blanca de la vista
   previa sabe qué es un adjunto clínico, así que es dominio.
3. **Zoneless / OnPush.** Estado en signals; las listas se reemplazan (`set`, `update` con
   spread), nunca se mutan. Los estados son uniones discriminadas (ADR-0005).
4. **Contexto tenant.** La página escucha `contextEpoch`: cambiar de organización o de sede
   descarta historia, selección y **motivo**, y vuelve a pedir. Nada queda en memoria de otra
   organización.
5. **Permisos.** Sin `permissionGuard`: `hc:read` solo no alcanza, sin relación asistencial hace
   falta motivo, y eso lo decide el backend con el 403 `requiereJustificacion`.
6. **Reglas maestras.** HC ≠ Caso ≠ Sesión: el timeline es de la HC, el caso es sólo un filtro y
   la sesión aparece como hecho sin editarse acá. Nada se borra: la enmienda versiona.
7. **Accesibilidad.** Labels reales, `aria-live` en los avisos, `role="alert"` en errores,
   `aria-pressed` además del color para el hecho elegido, `details`/`summary` nativos para los
   formularios y foco visible en todo. axe sin violaciones en el spec de la página.
8. **El caso que rompe la pantalla.** Un adjunto HTML con un script subido como `.pdf`. El
   backend lo clasifica por sus bytes y lo entrega como `text/html`; la lista blanca no lo
   contiene, así que **sólo se ofrece descargar**, como `application/octet-stream`. Si el servidor
   mintiera el tipo, el Blob se arma con el tipo de la lista blanca, no con el que el navegador
   olfatee. Segundo caso: alguien registra una entrada mientras se pagina. El cursor es keyset
   descendente, así que la página 2 no repite ni saltea; la entrada nueva aparece al recargar el
   timeline, que es lo que pasa después de registrar desde esta pantalla. Tercer caso: el cursor
   vence o se corrompe; el 400 `cursor-invalido` reinicia desde la primera página.

## 7. Verificación

- **E2E contra el backend real** (`e2e/historia-clinica.spec.ts`, 4 escenarios, verdes el
  06/10/2026): motivo obligatorio y auditado en `audit_event`, enmienda con dos filas en
  `entrada_clinica_version`, vista previa de imagen por blob y registro de una entrada nueva.
- **Unitarias**: 11 en 3 archivos. Suite completa: 1.218 tests; cobertura st 89,49 % · rama
  82,02 % · fn 84,66 % · ln 90,51 %, sobre el piso de 80 %. La rama bajó de 83,61 % porque los
  formularios y el visor los cubre el E2E y no un unitario, por la preferencia de pocos tests.
