# Clases — semana, lista y mes (10/11/2026)

Pantalla `/clases` (`features/activity/pages/clases-de-la-semana`). Rediseño pedido por el usuario
el 10/11/2026 con un boceto: tres vistas, semana por defecto.

## 1. Objetivo

Quien atiende el mostrador o coordina las clases necesita ver **qué clases hay, cuándo, con quién,
dónde y cuánto lugar queda**, y llegar en un clic a una clase para inscribir o tomar asistencia.

## 2. Problemas de la pantalla anterior

| #   | Problema                                                                                        | Nivel | Heurística (Nielsen)              |
| --- | ----------------------------------------------------------------------------------------------- | ----- | --------------------------------- |
| 1   | La semana era una tabla: para ver qué pasa el jueves había que leer las filas de todos los días | ALTO  | 6 · reconocer antes que recordar  |
| 2   | Sin vista del mes: planificar o contestar "¿hay yoga el 25?" obligaba a pasar semana por semana | ALTO  | 7 · flexibilidad y eficiencia     |
| 3   | No se podía filtrar por profesional, actividad ni lugar; sólo por texto y por estado            | MEDIO | 7 · flexibilidad y eficiencia     |
| 4   | La ocupación era una frase ("3 de 10 lugares ocupados") difícil de comparar de un vistazo       | MEDIO | 8 · estética y diseño minimalista |
| 5   | "Ir a la semana de" vivía escondido en el panel de filtros                                      | BAJO  | 3 · control y libertad            |

## 3. Jerarquía y flujo

1. Cabecera: título, "?" y **Programar clase**, siempre a la derecha.
2. Barra de la vista: `‹ Semana del lunes 09/11 al domingo 15/11 › Hoy` a la izquierda, y el
   selector **Semana · Lista · Mes** a la derecha. El rango abre el calendario para saltar a una
   fecha.
3. Filtros: un buscador, los filtros rápidos por estado y, detrás del embudo, profesional,
   actividad y lugar (regla del 21/10). Valen para las tres vistas.
4. El contenido de la vista.

## 4. Las tres vistas

- **Semana** (por defecto): siete columnas, una por día, con el día y la cantidad de clases arriba.
  Cada clase es una tarjeta compacta, ordenada por hora: nombre, horario, profesional, lugar,
  ocupación (`5/10`) y estado. Toda la tarjeta lleva al detalle de la clase, que ya resuelve
  inscripciones y asistencia según los permisos. Hoy se marca. Con poco ancho, los días se apilan.
- **Lista**: la tabla de antes, con búsqueda, orden y paginado, sobre la semana elegida.
- **Mes**: calendario de lunes a domingo. Cada día muestra cuántas clases tiene y hasta tres con su
  hora y su color; un clic abre esa semana.

## 5. Decisiones

- **Color por actividad, no por estado.** La actividad es la oferta (`ofertaId`): seis tonos
  con su versión oscura, asignados por el id para que no cambien de una semana a otra. El color
  acompaña: el nombre de la actividad siempre está escrito.
- **El estado se lee en texto** en cada tarjeta. La cancelada además se tacha y se atenúa.
- **La clase completa** se marca en la ocupación ("Completa"), no sólo con color.
- **Sin resumen al pie** del boceto: repetía los conteos que ya están en cada día y en la barra
  de filtros.
- **El mes pide una sola ventana** de seis semanas: el backend admite hasta 62 días.
- **La vista y la semana viven en la URL** (`?vista=mes&semana=2026-11-09`).

## 6. Sin cambios funcionales

Mismo contrato y mismo listado (`GET /clases?desde&hasta`). Los filtros por profesional, actividad
y lugar se arman con lo que llega en la ventana, sin pedidos nuevos.
