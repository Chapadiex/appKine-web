# Formulario de servicio del catálogo (alta y edición) — análisis UX

> 10/11/2026. Pantalla: `/servicios/catalogo`, panel lateral de alta y de edición
> (`features/offering/pages/catalogo-de-servicios`). Pedido del usuario: rediseño integral.

## 1. Objetivo

Dar de alta (o corregir) un servicio del catálogo: identificarlo, clasificarlo, decir si es
individual o grupal y proponer sus valores clínicos por defecto. Después, ofrecerlo en una sede.

## 2. Problemas detectados

| # | Problema | Nivel | Heurística |
|---|---|---|---|
| 1 | Naturaleza y modalidad son `select` con la explicación metida en la opción: hay que abrir cada uno para comparar, y el valor elegido se corta | ALTO | Reconocer antes que recordar |
| 2 | Alta y edición son dos formularios distintos (orden, textos y ayudas diferentes) | ALTO | Consistencia y estándares |
| 3 | Cerrar con X, Escape o Cancelar tira lo cargado sin avisar | ALTO | Prevención de errores |
| 4 | Después del alta no hay camino a la oferta, que es lo único que lo vuelve usable | ALTO | Control y libertad / visibilidad del estado |
| 5 | La descripción va después de la clasificación, separada de código y nombre | MEDIO | Correspondencia con el mundo real |
| 6 | Casillas clínicas con rótulos largos ("Por defecto, requiere…") que parten mal y no explican qué hacen | MEDIO | Ayuda y documentación |
| 7 | Errores genéricos ("El código es obligatorio") y sin límite de largo visible (backend: 64 / 160 / 280) | MEDIO | Ayudar a reconocer y corregir errores |
| 8 | "Clave estable: no se renombra" es jerga | BAJO | Lenguaje del usuario |

## 3. Jerarquía propuesta

Compactada el 10/11/2026 a pedido del usuario: el formulario entero entra en el panel amplio sin
desplazarse en un escritorio de 1366 × 768 (583 px de formulario, antes 953).

1. **Información del servicio:** Código (30 %) + Nombre (70 %) en una fila; la aclaración del código
   detrás de su "?". Descripción en un renglón que crece con el texto (`field-sizing: content`),
   con el contador en la fila del rótulo.
2. **Clasificación y modalidad:** las cuatro naturalezas en una fila (dos por fila en un teléfono),
   con un resumen breve y la explicación completa en el "?" de "Naturaleza"; Individual y Grupal
   en otra. La nota de capacidad y la de edición pasan al "?" de "Modalidad".
3. **Seguimiento clínico:** las dos casillas en una fila de 40 px; qué implica cada una, detrás de su
   "?" y como descripción accesible. "Se proponen por defecto…" va en el "?" del título.
4. **Pie fijo:** Cancelar · Crear servicio / Guardar cambios.

Espaciado del panel en este formulario: 16 px arriba y 20 a los costados, 8–12 px entre campos,
títulos de sección en `--tipo-sm` sin línea separadora.

## 4. Flujo

Identificar → clasificar → configurar → guardar. El código se sugiere desde el nombre mientras el
usuario no lo toque. Al crear: aviso verde con "Crear oferta", que abre el alta de oferta con el
servicio ya elegido. Cerrar con cambios pide confirmar en el pie, sin otro diálogo.

## 5. Se mantiene

Contrato, enumerados, validaciones del backend, errores de duplicado junto a los campos, `version`
de la edición, foco al abrir, panel lateral compartido.

## 6. Se modifica

Selects → tarjetas de opción (radios nativos); orden; textos; un solo formulario para los dos modos
(en edición el código se muestra fijo); mensajes por campo; ancho `amplio` (46 rem ≈ 736 px).

## 7. Progresivo

La nota de capacidad y la explicación de que la naturaleza sólo clasifica
(RN-M06-005) va detrás del "?".

## 8. Componentes reutilizables

`app-opciones-en-tarjetas` (`shared/components/opciones-en-tarjetas`): grupo de opción única con
`fieldset` + radios nativos, ControlValueAccessor, 1 o 2 columnas, ícono opcional y error asociado.
Sirve para cualquier enumerado chico con explicación.

## 9. Decisiones de contenido verificadas

- Clínico vs. Terapéutico: la especificación no los define más allá del enumerado (RN-M06-005); se
  conserva el sentido de los textos actuales, acortados. "Evaluación y diagnóstico" angostaba
  Clínico y no se usó.
- La capacidad es de la oferta (`OfertaServicioConsultorio.capacidad`): el catálogo no la pide.
- Las dos casillas son independientes en el dominio (`Servicio`): no se acoplan en pantalla.
