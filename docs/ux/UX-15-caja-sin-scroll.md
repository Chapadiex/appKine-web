# UX-15: caja diaria sin scroll

Pedido del usuario (31/10/2026): "fácil de usar, que todo entre en una pantalla, no quiero
scrollear". Eligió la propuesta B del canvas: tabla primero, operaciones en paneles a pedido.

## 1. Objetivo de la pantalla

El turno de caja de una persona frente al cajón: saber cuánto debería haber, ver lo que entró y
salió, cargar un movimiento manual, corregir un error, contar y cerrar.

## 2. Problemas detectados

Medido a 1366×768 con un solo movimiento: la página mide 1183 px y "Cerrar la caja" arranca en
y = 1075. Con el navegador abierto, en esa notebook entran unos 640 px.

| Nivel | Problema                                                                           | Heurística                   |
| ----- | ---------------------------------------------------------------------------------- | ---------------------------- |
| ALTO  | Cerrar y registrar quedan fuera de la pantalla: hay que scrollear para operar      | Flexibilidad y eficiencia    |
| ALTO  | Siete cifras con el mismo peso: "Debería haber" se ve igual que "Saldo inicial"    | Diseño minimalista           |
| MEDIO | Dos títulos seguidos ("Caja diaria", "Caja abierta") y dos marcas del mismo estado | Diseño minimalista           |
| MEDIO | Actualizar o guardar desmonta toda la pantalla: parpadea y el foco se pierde       | Visibilidad del estado       |
| MEDIO | Un select para elegir entre dos opciones (Ingreso, Egreso)                         | Reconocer antes que recordar |
| BAJO  | La fecha en cada fila repite la de la jornada                                      | Diseño minimalista           |

## 3. Jerarquía propuesta

Cabecera con estado, jornada y acciones → cifra principal y tres de apoyo → totales por medio →
movimientos. Lo demás se abre a pedido.

## 4. Flujo propuesto

- **Registrar:** botón en la cabecera → panel → Enter. Al guardar se cierra y el foco vuelve al botón.
- **Arquear:** botón en la cabecera → panel con la cuenta del cajón → contado → diferencia → cerrar.
- **Revertir:** sin cambios, el panel lateral de la fila.

## 5. Elementos a mantener

Reglas, validaciones, llamadas a la API, claves de idempotencia, `app-panel-lateral`, `tablaLocal`,
10 filas por página, rechazos en la sección donde se hizo la operación.

## 6. Elementos a modificar

- La pantalla ocupa la ventana. Si las filas no entran, se desplaza la tabla y no la página.
- Filas de 34 px (antes 45) y encabezado más bajo.
- Hora sola cuando el movimiento es del día de la jornada; con fecha si no: una jornada puede seguir
  abierta al otro día.
- La relectura después de operar no desmonta la pantalla (cambio de comportamiento acotado a la
  presentación: mismos pedidos). Cambiar de sede sí descarta todo, como antes.

## 7. Elementos a mostrar progresivamente

Formulario de movimiento, arqueo y el detalle entró/salió por medio (nuevo panel "Ver detalle").
"Movimientos" deja de ser una cifra: el total está en el pie de la tabla.

## 8. Componentes reutilizables

El selector `.segmento` y `.tabla--densa` quedan en la hoja de la pantalla. Suben al sistema de
diseño cuando otra pantalla los pida.

## 9. Propuesta visual

Ver el canvas, artboard "B · Tabla primero, paneles a pedido".

## 10. Límites

- En teléfono (menos de 48rem) o con menos de 36rem de alto, la página vuelve a desplazarse: ahí no
  entra.
- El aviso global sale arriba a la derecha, sobre las acciones de la cabecera, unos segundos.
  Es un tema de todas las pantallas (ver `akine-e2e-avisos-ux12`), no se tocó acá.
