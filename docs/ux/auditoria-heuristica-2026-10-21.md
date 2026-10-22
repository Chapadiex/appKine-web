# Auditoría heurística — 21/10/2026

> Hecha con la skill **`ui-ux-design-guide`** del catálogo de la organización (Skill Hub, por MCP),
> siguiendo su flujo de "Design review / UX audit": las **diez heurísticas de Nielsen**
> (página *Jakob's Ten Usability Heuristics*), **carga cognitiva** y **fricción de uso** con sus
> recomendaciones, más **accesibilidad**.
>
> Material: capturas a 1366 × 768 de padrón, colaboradores, catálogo de servicios, financiadores,
> recepción del día, caja y espacios, tomadas sobre la rama `akine-web-ux-01-shell` **después** de
> los cambios de UX-01: barra lateral, "?", embudo, tablas y alta en el título. Más lectura del código
> para confirmar lo que la captura sugiere. Severidad con la escala de la skill `refactor-ux-ui` §21.

## Resumen

El marco ya está bien: navegación agrupada, títulos limpios, explicaciones plegadas, buscador
único, acción principal arriba a la derecha y tipografía nueva. **Lo que más queda es el contenido
de cada pantalla**:

- acciones por fila apiladas;
- fechas crudas;
- formularios a todo el ancho;
- estados vacíos sin salida;
- pestañas con dos estilos distintos;
- notas que la migración no alcanzó;
- **no hay forma de cerrar sesión**.

| Severidad | Cantidad |
|---|---|
| CRÍTICO | 1 |
| ALTO | 6 |
| MEDIO | 6 |
| BAJO | 3 |

## Hallazgos

### CRÍTICO

**C1 · No hay "Cerrar sesión" en ninguna pantalla.** La sesión se puede cerrar en el código
(`SessionService`), pero ningún botón lo ofrece. En el mostrador de un centro de salud, con varias
personas en la misma computadora, eso deja la sesión de otro abierta con acceso a pacientes.
— *Heurística 3, control y libertad del usuario ("salida de emergencia claramente marcada")*.
**Propuesta:** menú de cuenta en la barra superior, a la derecha: nombre de la cuenta, "Cambiar de
centro" y "Cerrar sesión".

### ALTO

**A1 · Acciones por fila apiladas y cortadas.** En colaboradores cada fila tiene cuatro botones
verticales ("Cambiar rol…", "Suspender", "Revocar", "Permisos…") que **se cortan** contra el borde
de la tabla. En el padrón se mezclan enlaces subrayados y un botón con borde, con el mismo peso.
— *H8, diseño estético y minimalista*; *H4, consistencia*; *fricción: "Overload"*.
**Propuesta:** una acción visible por fila (la frecuente: "Ver ficha" / "Editar") y el resto en un
menú "⋯" (`app-menu-de-fila`, ya previsto en el plan para UX-03). Las destructivas ("Revocar",
"Suspender") siempre dentro del menú y con confirmación.

**A2 · Fechas en formato de máquina.** Vigencia de colaboradores: `2026-10-21T15:42:22.363424Z`.
— *H2, correspondencia con el mundo real ("palabras y conceptos familiares, no jerga interna")*.
**Propuesta:** pipe `fecha` compartido ("21 oct 2026", "21 oct 2026, 12:42") y barrido de todas
las tablas.

**A3 · Dos estilos de navegación secundaria.** La agenda usa pestañas subrayadas (`app-pestanas`).
Contratación ("Convenios de la sede · Financiadores · Consultar un arancel"), servicios ("Catálogo
de servicios · Ofertas de la sede") y espacios ("Ver que espacios estan en servicio") usan **botones
con borde** que parecen acciones. — *H4, consistencia y estándares*.
**Propuesta:** todas las pantallas hermanas con `app-pestanas`. Los enlaces que no son pantallas
hermanas ("Agregar desde el catálogo") van como acción secundaria en la fila del título.

**A4 · Recepción del día: el día ocupa la pantalla.** Una tarjeta entera para elegir la fecha: el
input mide 1.000 px, lleva ayuda ("Es la fecha local de la sede…"), una línea con la zona horaria y
un botón "Actualizar la lista". La lista del día, que es lo que se mira, arranca a 500 px.
— *H8*; *carga cognitiva extrínseca*; *fricción: "Waste"*.
**Propuesta:** selector compacto en la fila del título: "◀ Hoy, miércoles 21 oct ▶" y el
calendario al tocar la fecha. La zona horaria, en el "?".

**A5 · Formularios a todo el ancho.** Caja: "Saldo inicial contado" mide 1.000 px para un número;
"Moneda (ISO 4217)" pide un código de norma. — *H2* (jerga: "ISO 4217"); *grilla* (la guía:
"Grid system — alignment and proximity"); *fricción: "Data Entry"*.
**Propuesta:** grilla de campos con anchos por tipo (plan §3.3): importe y moneda en la misma fila,
3 + 2 columnas. "Moneda" como select con ARS por defecto, sin la norma en el rótulo.

**A6 · Botón deshabilitado sin motivo.** "Abrir la caja" aparece gris y no dice por qué. Le falta el
importe. — *H1, visibilidad del estado del sistema*; *H9, reconocer y recuperarse de errores*.
**Propuesta:** el botón queda habilitado. Al enviar, si falta el importe, el error aparece junto al
campo. Si se mantiene deshabilitado, al lado va una línea que diga qué falta.

### MEDIO

**M1 · Notas que la migración no alcanzó.** Espacios todavía muestra "Activo no es lo mismo que en
servicio" a la vista: usa la clase `nota-servicio`. Lo mismo pasa en unas 8 pantallas con otras
variantes de `tarjeta nota-*`: catálogos, solicitudes, vigencias, invitaciones, disponibilidad,
excepciones y horario semanal. También en las del padrón que no son de pantalla.
— *H8*; regla del "?" del plan §3.2.
**Propuesta:** pasarlas al "?" con las mismas excepciones (estado y advertencias quedan a la vista).

**M2 · Estados vacíos sin salida.** "No hay financiadores que coincidan con lo que estas buscando"
y un párrafo explicativo, sin acción. En espacios dice "con este filtro" aunque no hay ningún
espacio cargado. — *H1*; *H9* ("sugerir una solución constructiva")*; *H10*.
**Propuesta:** componente `app-estado-vacio`: ícono, una frase que diga qué pasa ("Todavía no hay
financiadores") y la acción que lo resuelve ("Dar de alta el primero"). Además, distinguir "no hay
ninguno" de "ninguno coincide con el filtro".

**M3 · Marcas de estado con tres estilos.** "Activo" como pastilla oscura con borde (servicios),
"Activa" como pastilla verde (colaboradores) y "Activa" como texto plano (padrón).
— *H4*; *accesibilidad: no transmitir solo con color*.
**Propuesta:** `app-marca-estado` con niveles (vigente, pendiente, baja) y texto siempre presente.

**M4 · Datos secundarios a la vista en la tabla.** El e-mail completo debajo del nombre (50
caracteres), y "Fundador" como pastilla. — *H8*; *carga cognitiva: priorizar contenido*.
**Propuesta:** e-mail en `title` / en el detalle; "Fundador" junto al rol.

**M5 · Contadores con tres formatos.** "2 persona(s) en el padron segun los filtros aplicados"
centrado arriba de la tabla. "2 vinculos en total, incluidos los suspendidos…" arriba a la
izquierda. "1 servicios" abajo, en el pie nuevo. — *H4*; *microcopy* (la guía: "claro y conciso").
**Propuesta:** todos en el pie de la tabla ("2 personas") con plural correcto. La aclaración, en el
"?" de la sección.

**M6 · Ortografía sin tildes en toda la interfaz.** "Padron", "Operacion", "Economia",
"Configuracion", "Catalogo", "Recepcion del dia", "Contrasena". — *H2*; *microcopy: tono
profesional*. Es lo primero que hace ver la app "sin terminar".
**Propuesta:** barrido de tildes y eñes en textos visibles. **Rompe E2E** que buscan por nombre
accesible ("Contratacion", "Recepcion"): el mismo cambio actualiza los E2E (plan §3.6).

### BAJO

**B1 · Embudo huérfano.** En listados sin buscador (espacios), el botón "Filtros" queda solo, a la
derecha, sobre un estado vacío. — *H8*.
**Propuesta:** ponerlo en la fila del título de la sección.

**B2 · Barra lateral sin cierre.** Debajo de los grupos queda una columna vacía de 400 px. — *H8*.
**Propuesta:** la cuenta del usuario y "Cerrar sesión" al pie de la barra, o en la barra superior
(C1).

**B3 · Barra superior con poco contenido.** Muestra el centro y "Cambiar" y nada más; el nombre de
la sede se repite con el centro en el demo. — *H1*.
**Propuesta:** el menú de cuenta de C1 equilibra la fila.

## Lo que ya cumple, por heurística

| Heurística | Qué la cumple ahora |
|---|---|
| H1 Visibilidad del estado | Sección actual marcada en la barra y en las pestañas; contador de filtros aplicados en el embudo |
| H3 Control y libertad | La ayuda se cierra con Escape o tocando afuera; el filtro se cambia sin perder la búsqueda |
| H4 Consistencia | Un solo patrón de título, "?", buscador + embudo y alta a la derecha en toda la app |
| H6 Reconocer antes que recordar | Todas las secciones visibles en la barra; pestañas para las pantallas hermanas |
| H8 Minimalismo | 75 descripciones y 35 aclaraciones fuera de la vista, sin borrar nada |
| H10 Ayuda | La explicación está a un clic, junto al título al que pertenece |

## Orden sugerido

1. **C1 · cerrar sesión** y menú de cuenta. Es el único con riesgo real.
2. **M1** notas que faltan y **M6** tildes: barridos mecánicos, alto impacto visual.
3. **A1** menú de fila, **A2** fechas, **M3** marcas de estado, **M5** contadores: cuatro
   componentes chicos de `shared/` que mejoran las 50 tablas a la vez.
4. **A3** pestañas en contratación, servicios y espacios.
5. **A4** recepción y **A5/A6** caja: las dos pantallas de más uso del mostrador, como piloto de
   UX-02/UX-03.
6. **M2** estados vacíos con acción, **B1–B3**.
