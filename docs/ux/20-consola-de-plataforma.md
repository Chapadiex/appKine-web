# Rediseño de la consola de plataforma (19/11/2026)

Primera etapa del rediseño integral pedido por el usuario el 19/11/2026: la consola de plataforma,
que es lo que más lejos estaba de parecer el mismo producto. Metodología: `refactor-ux-ui` (§22).

## 1. Objetivo

Quien administra la plataforma entra, entiende en segundos el estado general (cuántos centros, en
qué situación, qué necesita atención) y ejecuta lo habitual —dar de alta un centro, aprobar o
descartar un pedido, gestionar una suscripción, revisar el catálogo— sin recorrer pantallas.

## 2. Problemas detectados

| #   | Problema                                                                                                                                                                                                                                     | Nivel   | Heurística                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------- |
| 1   | La consola no tenía barra lateral: la barra sólo se dibujaba con un centro elegido, y la plataforma trabaja sin centro. Se navegaba por una fila de pestañas que mezclaba centros y catálogo, y por dos enlaces sueltos en la barra superior | Crítico | 3 (control y libertad), 4 (consistencia) |
| 2   | No había Inicio: `/plataforma` llevaba a "Solicitudes de catálogo". Nada mostraba el estado general ni lo que pide atención                                                                                                                  | Alto    | 1 (visibilidad del estado)               |
| 3   | El listado de centros no decía cuánto le queda a una prueba ni si una prueba ya venció (se veía "En prueba" aunque estuviera en solo lectura)                                                                                                | Alto    | 1, 2 (correspondencia con el mundo real) |
| 4   | El catálogo clínico (`/catalogo`) exige un centro elegido: la plataforma no puede abrirlo, y nada en la consola lleva al catálogo de servicios, que sí puede abrir                                                                           | Alto    | 7 (flexibilidad), 3                      |
| 5   | "Dar de alta un centro" es una columna angosta y larga con scroll hasta la acción                                                                                                                                                            | Medio   | 8 (diseño minimalista)                   |
| 6   | Tablas con patrones distintos (con y sin orden, con y sin `tablaLocal`), insignias propias                                                                                                                                                   | Medio   | 4                                        |
| 7   | El estado del listado de centros estaba detrás de un embudo, aunque es el único filtro                                                                                                                                                       | Medio   | 6 (reconocer antes que recordar)         |

## 3. Jerarquía y flujo propuestos

- **Barra lateral de plataforma**: Inicio; Centros (Centros y suscripciones, Pedidos de prueba,
  Dar de alta un centro); Catálogo (Solicitudes de catálogo, Catálogo de servicios, Catálogo de
  financiadores). Contadores en las entradas que tienen pendientes.
- **Inicio** (`/plataforma/inicio`): fila de indicadores que abren su listado ya filtrado; debajo,
  dos columnas: lo que necesita atención (pruebas vencidas o que terminan en 30 días, cuentas
  bloqueadas) y la actividad (últimos pedidos, centros recientes, cambios de suscripción).
- **Centros y suscripciones**: activos por defecto, estado a la vista, insignia de plan con color,
  columna de IA, plazo de la prueba y "Gestionar" en la fila.
- **Pestañas por grupo**: centros por un lado, catálogo por otro.

## 4. Lo que no se muestra y por qué

El pedido incluía suscripciones que vencen en 3 y 6 meses, importes, renovaciones y mensajes sin
responder. **El modelo no los tiene**: una suscripción activa no tiene fecha de fin, los precios
quedaron fuera (decisión "Sin precios" del 18/11) y no existe un módulo de mensajes. Mostrarlos
sería inventar datos; quedan para cuando el negocio los defina.

## 5. Backend que lo sostiene (contrato 0.179.0)

- `GET /api/v1/platform/resumen`: centros por estado, pedidos pendientes, pruebas que terminan y
  los últimos centros, pedidos y cambios de suscripción.
- `GET /api/v1/platform/resumen/cuentas`: cuentas activas, sin activar y bloqueadas.
- `PlatformOrganizationResponse` suma `pruebaHasta` e `ia` (aditivo).

## 6. Pendiente para las etapas siguientes

- Llevar los mismos patrones al resto de los módulos (inventario en la conversación del 19/11:
  cabeceras a mano, tres navegadores de fecha distintos, botones con clase propia, badges propios,
  formularios largos sin grilla, rutas fuera del menú como `/servicios/ofertas`, `/productos` y
  `/espacios/disponibilidad`).
- Decidir si la plataforma administra el catálogo clínico global sin elegir un centro (hoy
  `contextGuard` en `/catalogo`): es un cambio de permisos, no sólo de pantalla.
