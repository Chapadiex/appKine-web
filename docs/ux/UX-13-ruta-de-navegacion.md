# UX-13 · Ruta de navegación en la barra superior (29/10/2026)

> Pedido del usuario del 29/10/2026: que todas las pantallas digan en la barra superior dónde
> está el usuario y le dejen volver. Hasta acá la barra mostraba solo el título de la ruta y 19
> pantallas (más la banda de la persona) dibujaban sus propias migas dentro del contenido, cada
> una en un lugar distinto.

## 1. Qué se ve

| Pantalla                                         | Barra superior                                       |
| ------------------------------------------------ | ---------------------------------------------------- |
| Una sección del menú (Agenda, Caja, Padrón…)     | Solo el título, como antes. Un paso no es una ruta.  |
| Hija de una sección, sin migas propias           | `Egresos / Detalle del egreso`                       |
| Con migas propias (nombres que solo ella conoce) | `Padrón / Pérez, Ana / Coberturas del paciente`      |
| Teléfono (< 40 rem)                              | Solo el paso anterior, como "volver": `‹ Pérez, Ana` |

- Los pasos siguen la **jerarquía**, no el historial: volver sube un nivel. El botón Atrás del
  navegador sigue haciendo lo suyo.
- Las pestañas (`app-pestanas`) son hermanas, no niveles: la ruta termina en la pestaña activa.
- Accesibilidad: `nav` con nombre "Ubicación", lista ordenada, `aria-current="page"` en la
  pantalla actual (que no es enlace) y separadores dibujados por CSS que el lector no lee.
- Una sección que la sesión no puede abrir no se ofrece como paso (llevaría a "sin permiso").

## 2. De dónde sale cada paso

1. **El último** (la pantalla): el `title` de la ruta, sin "AKINE - ". Si la pantalla publica un
   último paso sin `ruta`, ese nombre manda.
2. **Los anteriores**: si la pantalla publicó pasos con `ruta`, son esos y en ese orden (la
   pantalla conoce su jerarquía y los nombres propios). Si no publicó nada, la sección del menú
   que contiene la URL (`seccionDe`, la misma que marca el menú lateral).
3. Se descartan los pasos que repiten la URL actual o una etiqueta ya puesta.

## 3. Cómo publica una pantalla

```ts
import { publicarMigas } from '../../../../core/services/migas.store';

export class PlanesDelFinanciadorPage {
  private readonly migasDeLaBarra = publicarMigas(() => [
    { etiqueta: 'Financiadores', ruta: '/contratacion/financiadores' },
    { etiqueta: 'Planes' }, // opcional: el nombre de la pantalla actual
  ]);
}
```

- Se llama en el contexto de inyección (un campo). Lee signals: si el nombre llega del backend
  después, se republica solo. Al destruirse la pantalla se retira; si la siguiente ya publicó,
  no la pisa.
- **Una sola publicación por pantalla.** Las pantallas con banda de persona
  (`cabeceraDePersona`) ya publican `Padrón / <nombre>`; si necesitan un paso más lo pasan en
  `masMigas` (Cobros registrados: `… / Cuenta corriente`).
- Una pantalla que es sección del menú **no** publica: es raíz.

## 4. Qué se fue

- `shared/components/migas` (`app-migas`) y sus estilos de `design-system.css`.
- Las migas dentro de `app-cabecera-de-ficha` y las 19 de cada pantalla.
- Los "Volver a…" de arriba de la pantalla que solo subían un nivel (detalle y alta de clase,
  asistencia de una clase, política de enmienda, atención clínica, atención grupal, enmienda y
  versiones): ahora son el paso anterior de la barra. Se quedan los que son parte de un flujo
  ("Volver a la recepción del día" del cobro, "Volver a revisar los datos").
- Egresos ya no aparece antes de "Honorarios": son hermanas en el menú.

## 5. Con la cabecera de pantalla única (#143)

- `app-cabecera-de-pagina` ya no tiene ranura de migas: la fila del título empieza siempre por el
  título.
- En las hermanas de la ficha (`app-cabecera-de-ficha` con `titulo`), la persona y su documento
  quedan junto al título como dato ("Pases · Sosa, Eva · Sin documento"); la ruta "Padrón / Sosa,
  Eva / …" está en la barra. `migasDeSeccion` pasó a ser `masMigas` de `cabeceraDePersona`.
- Las migas en línea que #143 había puesto en las pantallas de agenda, series, asistencia, clases
  y atención sin turno no se publican: la sección del menú ya es su paso anterior.
