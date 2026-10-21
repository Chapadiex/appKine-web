---
name: refactor-ux-ui
description: Refactor UX/UI progresivo del frontend de AKINE. Usar antes de rediseñar cualquier pantalla. Impone análisis previo (objetivo, problemas clasificados, jerarquía, flujo, qué mantener/modificar/ocultar, componentes, propuesta visual) y recién después implementar. No modifica reglas de negocio ni contratos. El plan por etapas vive en docs/ux/00-plan-refactor-ux-ui.md.
---

# Refactor UX/UI Frontend de AKINE

> Pegado por el usuario el 21/10/2026. El plan por etapas, el diagnóstico transversal y los
> criterios comunes de diseño están en `docs/ux/00-plan-refactor-ux-ui.md`; esta skill es la
> metodología que cada etapa aplica.

## Objetivo

La aplicación AKINE se encuentra funcionalmente terminada. Las reglas de negocio, validaciones,
campos y procesos principales ya están implementados.

Sin embargo, el frontend fue construido principalmente para cumplir funcionalmente con los
requerimientos, colocando campos, botones y datos en pantalla sin un diseño integral de
experiencia de usuario.

El objetivo de este skill es analizar y refactorizar progresivamente toda la aplicación a nivel
frontend para transformarla en una aplicación moderna, profesional, intuitiva, simple y agradable
de utilizar.

El refactor NO debe modificar reglas de negocio ni comportamiento funcional salvo que sea
estrictamente necesario para mejorar la interacción.

## Principios generales

Toda propuesta debe priorizar: usabilidad, simplicidad, claridad, consistencia, baja carga
cognitiva, facilidad de aprendizaje, velocidad de operación, jerarquía visual, accesibilidad,
diseño moderno pero sobrio, aprovechamiento correcto del espacio, escalabilidad visual.

La aplicación debe sentirse como un producto terminado y no como un conjunto de formularios
administrativos colocados uno debajo del otro.

## 1. Análisis previo obligatorio

Antes de modificar una pantalla, realizar un análisis UX/UI. Analizar:

- Objetivo principal de la pantalla y qué tarea intenta realizar el usuario.
- Qué información necesita para realizarla y cuál es secundaria.
- Qué acciones son principales y cuáles secundarias.
- Qué elementos generan ruido y cuáles pueden eliminarse visualmente.
- Qué información puede agruparse o mostrarse progresivamente.
- Qué campos deberían estar juntos y cuáles tienen dependencias entre sí.
- Qué información debería aparecer primero y cuál solo cuando sea necesaria.
- Qué elementos pueden generar errores o confusión; qué pasos pueden simplificarse.
- Qué información se está mostrando innecesariamente al mismo tiempo.

No comenzar directamente modificando componentes sin entender primero el flujo de uso.

## 2. Reducir carga cognitiva

Evitar pantallas con exceso de información simultánea. No mostrar todos los campos simplemente
porque existen. Utilizar cuando corresponda: secciones, agrupaciones lógicas, acordeones, tabs,
stepper, progressive disclosure, paneles laterales, modales, secciones expandibles, campos
condicionales, resúmenes, vistas detalle. La solución elegida depende del flujo; no usar estos
componentes indiscriminadamente.

El usuario debe poder identificar rápidamente: dónde está, qué información está viendo, qué
tiene que completar, qué acción debe realizar después.

## 3. Jerarquía visual

Debe existir una diferencia visual evidente entre: título de pantalla, descripción o contexto,
secciones, subsecciones, labels, valores, información auxiliar, advertencias, errores, acciones
principales y acciones secundarias. Evitar interfaces donde todos los elementos tengan el mismo
peso visual.

## 4. Organización de formularios

Analizar: orden lógico de carga, agrupación de campos relacionados, dependencias, obligatoriedad,
frecuencia de uso, valores por defecto, campos avanzados y poco frecuentes.

No utilizar formularios extremadamente largos si pueden dividirse lógicamente. No utilizar una
columna única interminable si existen grupos naturales de información. Tampoco utilizar múltiples
columnas simplemente para ocupar espacio. Priorizar legibilidad y flujo de lectura.

## 5. Campos condicionales

Los campos necesarios solo bajo determinadas condiciones no deben mostrarse permanentemente. Si
seleccionar una opción habilita cinco parámetros adicionales, esos parámetros aparecen únicamente
cuando esa opción se selecciona.

## 6. Acciones principales

Cada pantalla tiene claramente identificada su acción principal (Continuar, Guardar, Confirmar,
Crear, Ejecutar, Finalizar). Las secundarias no compiten visualmente con la principal. Evitar
pantallas con numerosos botones de igual importancia visual.

## 7. Estados de la interfaz

Toda pantalla contempla: carga, éxito, error, advertencia, información, estado vacío, datos
incompletos, acciones deshabilitadas, procesamiento, confirmación. Nunca dejar al usuario sin
feedback luego de realizar una acción.

## 8. Validaciones

Mantener todas las validaciones existentes y mejorar cómo se comunican. Los errores: cerca del
campo relacionado; indican claramente qué ocurrió; explican cómo corregirlo cuando corresponde;
evitan mensajes técnicos; no dependen exclusivamente del color. Los errores generales del proceso
se muestran de manera claramente visible.

## 9. Navegación y orientación

El usuario siempre entiende en qué parte de la aplicación está. Revisar navegación principal y
secundaria, breadcrumbs si hicieran falta, títulos, pasos de procesos, retorno a pantallas
anteriores, continuidad entre operaciones. Evitar navegación innecesariamente profunda.

## 10. Consistencia visual

Un lenguaje visual único. Definir o respetar un Design System para colores, tipografía, tamaños,
espaciado, bordes, radios, botones, inputs, selects, tablas, modales, tarjetas, alerts, badges,
tooltips, iconografía. Un mismo tipo de acción se ve y se comporta igual en toda la aplicación.

## 11. Diseño moderno sin sobrecarga

"Moderno" NO significa agregar indiscriminadamente cards, sombras, gradientes, colores,
animaciones, iconos, bordes, efectos. Evitar convertir cada sección en una tarjeta. Evitar
diseños tipo dashboard cuando la pantalla no es un dashboard. Evitar el overdesign. Priorizar
espacios bien utilizados, separación, tipografía, alineación, jerarquía, simplicidad. La interfaz
debe poder utilizarse diariamente sin resultar visualmente cansadora.

## 12. Uso del espacio

Evitar grandes zonas vacías sin intención, campos excesivamente anchos, contenido amontonado,
demasiada información horizontal, formularios interminables, elementos desalineados. El espacio
en blanco separa y organiza.

## 13. Tablas

Priorizar las columnas importantes; evitar información innecesaria; acciones claramente
identificables; estados visuales cuando corresponda; filtros, búsqueda, ordenamiento, paginación
cuando sea necesaria; detalles expandibles cuando haya demasiada información. No intentar poner
toda la información de una entidad en una tabla.

## 14. Responsive

Como mínimo desktop, notebook y tablet. Si el sistema requiere mobile, adaptar también esa
experiencia. Responsive no es comprimir componentes: reorganizar la información cuando la
resolución lo requiera.

## 15. Accesibilidad

Contraste adecuado, labels claros, navegación por teclado, foco visible, estados accesibles,
tamaño apropiado de áreas clickeables, no transmitir información únicamente mediante colores,
HTML semántico, atributos ARIA cuando sean necesarios.

## 16. Microinteracciones

Solo cuando ayudan a comprender el estado del sistema: feedback de guardado, loading, transición
de pasos, expansión de secciones, confirmaciones. Evitar animaciones decorativas.

## 17. Prevención de errores

Analizar valores por defecto, campos incompatibles, acciones destructivas, confirmaciones,
dependencias, acciones irreversibles. No pedir confirmación para absolutamente todo: solo cuando
exista un riesgo real.

## 18. No modificar innecesariamente la lógica existente

No modificar reglas de negocio, APIs, contratos, validaciones funcionales, modelos ni procesos
existentes salvo razón técnica concreta. Separar claramente **CAMBIO UX/UI** de **CAMBIO
FUNCIONAL**. Si una mejora UX requiere modificar comportamiento funcional, explicarlo antes de
implementarlo.

## 19. Reutilización de componentes

Detectar patrones repetidos y crear componentes reutilizables con responsabilidad clara
(PageHeader, Section, FormField, StatusBadge, EmptyState, ConfirmDialog, LoadingState,
ErrorState, SearchBar, FilterPanel, DataTable), adaptados al framework y la arquitectura
existentes. Evitar componentes extremadamente genéricos o difíciles de mantener.

## 20. Refactor progresivo

No rediseñar toda la aplicación simultáneamente. Para cada pantalla: analizar, detectar
problemas, definir prioridades, proponer nueva estructura, implementar, revisar consistencia,
continuar con la siguiente. Cada pantalla refactorizada usa patrones reutilizables después.

## 21. Clasificación de problemas

- **CRÍTICO:** impide o dificulta considerablemente completar una operación.
- **ALTO:** genera confusión, errores o mucho esfuerzo.
- **MEDIO:** afecta claridad, velocidad o comodidad.
- **BAJO:** mejora estética o de consistencia.

Priorizar problemas de interacción antes que los puramente cosméticos.

## 22. Formato de análisis antes de implementar

Para cada pantalla entregar primero, en `docs/ux/<etapa>-<pantalla>.md`:

1. **Objetivo de la pantalla**: qué intenta realizar el usuario.
2. **Problemas detectados**: listado concreto, clasificado según §21.
3. **Jerarquía propuesta**: cómo debería organizarse la información.
4. **Flujo propuesto**: cómo debería interactuar el usuario.
5. **Elementos a mantener**: qué funciona correctamente.
6. **Elementos a modificar**: qué debe cambiar.
7. **Elementos a ocultar o mostrar progresivamente**.
8. **Componentes reutilizables**: qué puede extraerse.
9. **Propuesta visual**: descripción concreta de la nueva distribución.
10. **Implementación**: recién después del análisis.

## 23. Criterio principal

No rediseñar solamente para que "se vea más lindo". Cada modificación responde al menos a uno de
estos objetivos: reducir esfuerzo, reducir errores, facilitar comprensión, reducir información
visible, mejorar jerarquía, mejorar velocidad de operación, mejorar consistencia, mejorar
accesibilidad, mejorar navegación. Si solo agrega decoración, probablemente no sea necesario.

## Resultado esperado

AKINE debe pasar de una interfaz funcional construida alrededor de campos y validaciones a
sentirse como una aplicación profesional. La interfaz guía al usuario en lugar de obligarlo a
interpretar la pantalla. **Menos elementos visibles, mejor organizados, en el momento correcto y
con una interacción clara.**
