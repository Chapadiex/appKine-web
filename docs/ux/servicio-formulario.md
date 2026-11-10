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

1. **Información del servicio:** Código (30 %) + Nombre (70 %), ayuda del código; Descripción (área de dos líneas con contador).
2. **Clasificación y modalidad:** naturaleza en 4 tarjetas (2 × 2), modalidad en 2 tarjetas; si es grupal, nota de capacidad.
3. **Seguimiento clínico:** una casilla por fila, título + qué implica.
4. **Pie fijo:** Cancelar · Crear servicio / Guardar cambios.

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

La nota de capacidad aparece sólo con "Grupal". La explicación de que la naturaleza sólo clasifica
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
