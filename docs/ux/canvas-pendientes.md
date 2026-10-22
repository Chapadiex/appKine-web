# Canvas "AKINE · Pantallas": lo que el diseño muestra y la app no tiene

> 21/10/2026. Las diez secciones del canvas se aplicaron solo como cambio de presentación
> (rama `akine-web-ux-01-shell`). Lo de abajo quedó afuera a propósito: o no hay datos en el
> contrato, o sería comportamiento nuevo. Cada ítem espera una decisión del usuario.

## Necesita backend

| Sección | Qué falta |
|---|---|
| Acceso | Perfil propio (`/me`: nombre y rol de quien ingresó) |
| Agenda | Listado de turnos por rango de fechas, para el calendario semanal de turnos reservados con panel de detalle |
| Recepción | Totales de copago del día y filtro por profesional |
| Turnos | Pasos "Llegó / En atención / Atendido" en un solo dato; alertas del paciente; aviso por WhatsApp; pausar o editar el patrón de una serie |
| Atención | Alertas clínicas, técnicas bloqueadas por contraindicación, avance del objetivo, resumen de la sesión anterior, EVA al alta, firma de la enmienda y PDF |
| Paciente 360 | Problemas, medicación, signos y escalas, estudios, próximos turnos (además, casi todo es contenido clínico que la ficha no debe mostrar) |
| Pacientes | Indicadores de la cuenta corriente y total de cobros; búsqueda y período en cobros; evaluación, sesiones y objetivos en el caso |
| Actividades | Series semanales de clases, lista de espera, precio; "Revisar y firmar"; duración, congelamiento y precio por clase de un producto de pack |
| Economía | Indicadores de caja, egresos y liquidación; búsqueda por texto en egresos y presentaciones; ajustes y factura C; historial del egreso; serie temporal para el gráfico de reportes; orden y paginado del servidor en egresos (hoy corta en 50) |
| Organización | Datos fiscales y logo; cambio de plan, medio de pago, facturas, cupo de WhatsApp; último acceso y matrícula de colaboradores; IP, antes/después y exportación en auditoría; matriz de canales por rol |
| Espacios y horarios | Color, equipamiento y prestaciones del espacio; línea de ocupación; vista semanal del horario efectivo con "de dónde sale"; decisión por feriado (cerrado / abre igual) e importar feriados |
| Servicios | Marcas de oferta completa o incompleta y la columna "qué falta"; estado "Publicada"; pestañas de Diagnósticos, Técnicas y Escalas; historial de precios; packs y descuentos |
| Contratación | Estado del convenio "Vigente / Por vencer / Vencido"; columnas de tope, autorización y nomenclador; pacientes por plan; historial del arancel; pasos de derivación del arancel efectivo |
| Plataforma | Latencia por servicio, entorno, sesión y hora de actualización en `/estado`; conteos por estado |
| Transversal | Búsqueda por texto en ~18 listados y parámetro `sort` en las 16 operaciones paginadas |

## Cambio funcional, a decidir

- Acceso: "mantener sesión", casilla de términos, medidor de fuerza de contraseña, "cerrar sesión en otros equipos", matrícula en la invitación, reingreso en línea al vencer la sesión, selector de sede en dos pasos.
- Menú "⋯" por fila en lugar de la columna de botones (hallazgo A1 de la auditoría). Toca casi todos los E2E.
- Botón "Nuevo turno" que empiece una reserva sin elegir antes un horario.
- Editor semanal de horario con un único Guardar (hoy se guarda bloque por bloque).
- Paneles laterales de detalle: auditoría, financiadores, cierres y aperturas, aranceles.
- Asistentes por pasos: importar aranceles, alta de sede con espacios y horarios por separado.
- Filtros rápidos con conteo (Todos / Individuales / Grupales, categorías, estados).
- "Marcar todos presentes", "Copiar", "Exportar", "Importar padrón", "Portal de autorizaciones", "Asignar a", "Ajuste manual", "Cargar nueva vigencia".
- Usar el nombre de la oferta o del convenio como título de la página (los E2E afirman los títulos actuales).

## Deuda que dejó esta pasada

- La ruta de navegación (`.migas`) existe en seis CSS de feature con marcado distinto: llevarla a `design-system.css` con un solo marcado.
- La cabecera de la persona (`app-cabecera-de-persona`) existe en cuatro copias porque los features no se importan entre sí: candidata a `shared/` como componente de presentación con entradas.
- Tests unitarios que afirman textos sin tilde o la estructura vieja (clases de la semana, detalle de clase, billing, reportes, contratación): no se corrieron, por pedido del usuario.
