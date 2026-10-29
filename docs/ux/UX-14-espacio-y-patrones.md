# UX-14 · Uso del espacio y patrones únicos de pantalla (29/10/2026)

> Pedido del usuario del 29/10/2026: revisar **todas** las pantallas para que AKINE se sienta una
> aplicación de gestión profesional. No es un cambio de estilos: es cómo cada pantalla usa el
> ancho, el alto y la jerarquía. Un usuario que recorre AKINE encuentra siempre los mismos
> patrones.

## 0. Lo que ya resuelve la base (no se reescribe en cada pantalla)

| Pieza                 | Dónde                                                             | Qué hace                                                                                                                                                  |
| --------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ancho completo        | `app.css` `.contenido`                                            | Sin tope de 96 rem: todo el ancho entre barra lateral y borde, con 24 px de margen.                                                                       |
| Grilla de 12 columnas | `design-system.css`                                               | `form`, `fieldset` de un form, `.grilla-12` y `.grilla-campos`. Cada `.campo` hijo directo ocupa lo que pide su dato (ver §2). Responsive por contenedor. |
| Cabecera de pantalla  | `app-cabecera-de-pagina`                                          | Título (?) estado … acción principal a la derecha; pestañas debajo.                                                                                       |
| Ruta de navegación    | barra superior (UX-13)                                            | No se repite el título en la página.                                                                                                                      |
| Toolbar de tabla      | `app-filtros`                                                     | `[Buscar…] [frecuentes] [Filtros N]  37 resultados`, en una fila; panel de avanzados debajo con "Limpiar filtros".                                        |
| Orden                 | `th[appOrdenable]`                                                | ↕ sin orden, ↑ / ↓ con orden; `aria-sort`.                                                                                                                |
| Pie de tabla          | `app-pie-de-tabla` (lista completa) · `app-paginacion` (servidor) | `Mostrando 1–10 de 87 · Filas por página [10 ▾] · ‹ 1 2 3 … 9 ›`. 10 por defecto; 10/25/50/100.                                                           |
| Estado vacío          | `app-estado-vacio`                                                | Título, texto y acción. Dos casos: "todavía no hay" (acción de alta) y "no hay con estos filtros" (`Limpiar filtros`).                                    |
| Alto de tabla         | `.tabla-scroll`                                                   | Usa el alto disponible; si no entra, scrollea la tabla con encabezado fijo, no la página.                                                                 |
| Acciones de fila      | `app-acciones-de-fila`                                            | Una acción frecuente visible (`principal`) y el resto en "⋯".                                                                                             |
| Paneles laterales     | `app-panel-lateral`                                               | 34 rem (≈544 px); `ancho="amplio"` 46 rem (≈736 px) para formularios de varias columnas o más de 10 campos.                                               |

## 1. Listados — patrón obligatorio

```
Título (?)                                         [+ Acción principal]   ← app-cabecera-de-pagina

┌ tarjeta ──────────────────────────────────────────────────────────────┐
│ [🔍 Buscar…........] [Frecuente ▾] [Filtros 2]          37 resultados │ ← app-filtros
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ Columna ↕   Columna ↕   Estado ↕                         [Ver] ⋯ │ │ ← tabla
│ └──────────────────────────────────────────────────────────────────┘ │
│ Mostrando 1–10 de 37      Filas por página [10 ▾]      ‹ 1 2 3 4 ›   │ ← pie
└───────────────────────────────────────────────────────────────────────┘
```

```html
<section class="tarjeta" aria-label="Sedes">
  <app-filtros
    [activos]="filtrosActivos()"
    [resultados]="estado().tipo === 'listo' ? total() : null"
    [unidad]="['sede', 'sedes']"
    limpiable
    (limpiar)="limpiarFiltros()"
  >
    <div class="campo" filtro-principal>…búsqueda con .campo-busqueda…</div>
    <div class="campo" filtro-frecuente>…solo si se usa todos los días…</div>
    <div class="campo">…avanzado…</div>
  </app-filtros>

  @switch (estado().tipo) {
    @case ('cargando') { <p class="estado estado--cargando">Cargando…</p> }
    @case ('error') { <app-alerta …> }
    @case ('listo') {
      @if (total() === 0 && !hayFiltros()) {
        <app-estado-vacio titulo="No hay sedes todavía" texto="Abrí la primera para empezar.">
          <a class="boton" routerLink="…">Abrir una sede</a>
        </app-estado-vacio>
      } @else if (total() === 0) {
        <app-estado-vacio titulo="No encontramos sedes" texto="Probá con otra búsqueda o filtros.">
          <button type="button" class="boton boton--secundario" (click)="limpiarFiltros()">Limpiar filtros</button>
        </app-estado-vacio>
      } @else {
        <div class="tabla-scroll" tabindex="0" role="region" aria-label="Listado de sedes">
          <table class="tabla">… <th appOrdenable …> … <td class="tabla__acciones"><app-acciones-de-fila>…</td></table>
        </div>
        <app-pie-de-tabla [tabla]="tabla" etiqueta="Páginas de sedes" />
      }
    }
  }
</section>
```

Reglas:

1. **Todo `<table class="tabla">`** tiene: columnas ordenables (`appOrdenable`) en lo que tenga sentido
   ordenar, pie estándar (`app-pie-de-tabla` o `app-paginacion` con `total` y `porPagina`),
   estado vacío (`app-estado-vacio`) y acciones de fila en `app-acciones-de-fila`.
2. **Búsqueda + Filtros + resultados** en `app-filtros`, dentro de la **misma tarjeta** que la
   tabla, inmediatamente arriba. Nunca en otra tarjeta, nunca centrados, nunca separados del
   contador. El contador va en `[resultados]`, no en un párrafo suelto ni al pie ("N sedes con el
   filtro elegido" se borra).
3. Una lista de entidades que puede crecer (personas, sedes, ofertas, cobros…) tiene búsqueda.
   Una tabla interna de pocas filas fijas (días de la semana, versiones de un detalle) puede no
   tener búsqueda ni filtros, pero sí orden, pie y vacío.
4. **Lista completa** (llega toda del servidor): `tablaLocal(filas, { columnas })` (10 por página
   por defecto) + `app-pie-de-tabla`. **Lista paginada por el servidor**: una señal `porPagina`
   (empieza en `FILAS_POR_PAGINA_INICIAL`, de `shared/components/paginacion/paginacion`) que va
   como `size` al servicio, `app-paginacion` con `[total]` (`totalElements`), `[porPagina]` y
   `(cambioDePorPagina)` que vuelve a la página 0 y recarga.
5. **Sin título duplicado**: la tarjeta del listado no repite el título de la pantalla en un `h2`
   ("Sedes" / "Sedes de la organización"). Si hace falta un nombre para el lector, `aria-label` en
   la `section`.
6. **Acción principal** (`+ Nueva …`) siempre en `cabeceraAcciones` de `app-cabecera-de-pagina`,
   arriba a la derecha. No dentro de la tarjeta ni al pie.
7. **Acciones de fila**: la frecuente visible ("Ver", "Editar"), las demás en "⋯". Nunca tres o más
   botones sueltos por fila.
8. **Tablas responsive**: columnas secundarias con la clase `tabla__col--secundaria` se esconden
   bajo 64 rem (tablet); el dato sigue en el detalle/panel.

## 2. Formularios

- **Nunca una columna infinita.** Los `.campo` hijos directos de `form` (o de un `fieldset`, o de
  `.grilla-12` / `.grilla-campos`) se acomodan solos en 12 columnas:

  | Dato                                       | Columnas | Cómo                                                               |
  | ------------------------------------------ | -------- | ------------------------------------------------------------------ |
  | Por defecto (nombre, apellido, select)     | 3        | —                                                                  |
  | Fecha, hora, número, DNI, código           | 2        | automático para `date/time/number`; `.campo--2` para DNI/código/CP |
  | CUIT, teléfono, fecha y hora               | 3        | `.campo--3`                                                        |
  | Email                                      | 4        | automático                                                         |
  | Select con textos largos, nombre comercial | 4        | `.campo--4`                                                        |
  | Dirección, nombre largo                    | 6        | `.campo--6`                                                        |
  | Observaciones, motivo, texto libre         | 12       | automático para `textarea`; `.campo--12`                           |

  En un panel lateral o columna angosta cada campo duplica su ancho (dos por fila); en teléfono,
  uno por fila. No hace falta media query en la pantalla.

- **No envolver campos en `div` sin clase** (rompen la grilla). Si un grupo necesita contenedor,
  `fieldset` (con `legend`) o `div.grilla-12`.
- **Borrar las grillas propias** de cada feature (`grid-template-columns` en `*.css` de la feature)
  que pisan la global para formularios. Quedan solo las que son de otra cosa (calendario, tablero).
- **Agrupar por significado** con `<h3 class="formulario__seccion">Contacto</h3>` (o `fieldset` +
  `legend`), no con tarjetas dentro de tarjetas.
- **Opcionales y poco usados** en `details.mas-opciones` ("Más opciones").
- **Acciones**: `Cancelar · Guardar` a la derecha (ya global); barra fija al pie si scrollea (ya
  global en `.tarjeta form > .acciones:last-child` y en los paneles).
- **Drawers** con más de 10 campos: `ancho="amplio"`; si sigue siendo largo, secciones o página
  propia.
- **Formularios largos o de configuración**: secciones plegables (`.seccion-plegable`) o pestañas
  internas, lo más usado primero. Wizard solo para altas de varios pasos (ya existe en sedes).

## 3. Pantallas operativas (agenda, recepción, caja, asistencia, liquidación)

- Controles frecuentes a la vista (fecha ‹ › Hoy, profesional, estado) en `cabeceraContexto` o
  como `filtro-frecuente`; el resto en Filtros.
- Los datos ocupan la mayor parte del viewport: nada de tarjetas decorativas alrededor de cada
  bloque; listados con el patrón de §1.

## 4. Densidad

- Escala de espacios: 4 / 8 / 12 / 16 / 24 / 32 px (`--esp-2`, `--esp-4`, `--esp-5`, `--esp-6`,
  `--esp-8`, `--esp-9`). Nada de 40 px de padding ni 30 px entre inputs.
- Inputs de 40 px de alto (global). No achicar fuentes ni objetivos de toque.
- Tarjetas dentro de tarjetas: no. Secciones enormes para poca información: no.

## 5. Checklist por pantalla

- [ ] ¿Hay espacio horizontal vacío que se pueda usar? ¿Campos demasiado anchos?
- [ ] ¿Scroll vertical innecesario? ¿Tarjetas altas para poca información?
- [ ] Tablas: búsqueda, Filtros, resultados, orden, pie con filas por página, vacío, acciones ⋯.
- [ ] Formularios: 12 columnas semánticas, grupos, opcionales plegados, acciones a la derecha.
- [ ] Título una sola vez; acción principal arriba a la derecha.
