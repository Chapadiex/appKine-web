# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Recepción y administración del centro (uso principal).** Trabaja todo el día en una PC de
  escritorio o una notebook: da turnos, recibe a los pacientes, registra cobros, opera la caja y
  arma las presentaciones a los financiadores. Abre las mismas pantallas cientos de veces por día.
- **Profesional (kinesiólogo, fisioterapeuta).** Usa una tablet durante la atención: abre la
  sesión, registra examen, mediciones y tratamientos, y consulta la historia clínica.
- **Administrador de la organización (`ORG_ADMIN`).** Configura sedes, espacios, servicios,
  convenios, aranceles y colaboradores; entra una vez por semana o por mes.
- **Administrador de la plataforma (`PLATFORM_ADMIN`).** Atiende solicitudes y el catálogo global.

## Product Purpose

AKINE es un SaaS multi-tenant para centros de kinesiología, fisioterapia, rehabilitación y
actividades de salud y bienestar. Cubre el circuito clínico, administrativo y económico completo
de un centro. Funciona bien cuando la recepción completa su tarea sin interpretar la pantalla, el
profesional registra la atención sin perder tiempo con el paciente adelante, y cada peso cobrado
se puede rastrear desde el turno hasta la caja y la presentación al financiador.

## Positioning

- **Circuito completo en una sola aplicación:** turno → recepción → sesión → historia clínica →
  deuda → cobro → caja → presentación al financiador.
- **Obras sociales y prepagas argentinas como parte del modelo:** coberturas, convenios,
  aranceles, órdenes, autorizaciones con consumo y presentaciones con débitos y reparos.
- **Reglas clínicas y económicas estrictas:** Turno ≠ Sesión, Persona ≠ Paciente,
  Obligación ≠ Cobro ≠ Caja. Todo acceso clínico declara un motivo y queda auditado.
- **Multi-organización y multi-sede:** una organización con varias sedes, roles y permisos por sede.

## Operating Context

- El día de un centro ordena la frecuencia de uso: mostrador (agenda, recepción del día, cobros)
  → paciente → atención → caja y economía → configuración → actividades grupales → reportes.
- Mostrador y administración se diseñan para escritorio (≥ 1280 px) y notebook (1024–1279 px).
  Las pantallas clínicas tienen como objetivo la tablet (768–1023 px). El teléfono (375 px) no
  puede desbordar, pero no se rediseña.
- Fechas y horas siempre en la zona horaria de la sede, no en la del navegador.

## Capabilities and Constraints

- Frontend Angular 21 zoneless con signals. Cliente TypeScript generado desde el contrato OpenAPI
  del backend (`appKine-api`); no se escriben DTO a mano.
- Un cambio de UX no modifica reglas de negocio, validaciones, servicios ni el cliente generado sin
  decisión previa del usuario (`docs/ux/00-plan-refactor-ux-ui.md` §2.5).
- Los nombres accesibles, labels y roles que usan los E2E no cambian sin actualizar el E2E en el
  mismo PR.
- Los textos de error del backend se muestran tal cual llegan.
- Glosario fijo: Persona, Paciente, Turno, Sesión, Atención, Historia clínica, Caso, Plan de
  tratamiento, Obligación, Cobro, Caja, Financiador, Cobertura, Convenio, Arancel, Presentación,
  Sede, Consultorio, Box, Oferta, Servicio.

## Brand Commitments

- Nombre: **AKINE**.
- **Español rioplatense con voseo** en toda la interfaz ("Ingresá", "Elegí", "podés").
- **Uso diario sin cansar:** sobrio, denso y sin decoración. Las explicaciones van detrás de un
  "?", los filtros detrás de un embudo, y nada se convierte en tarjeta porque sí. Las reglas que
  fijó el usuario están en `docs/ux/00-plan-refactor-ux-ui.md` §3.
- **Proyecto de tesis final** de Ingeniería en Sistemas de Información, UTN FRC: se presenta ante
  un tribunal y tiene que verse como un producto terminado y profesional, no como un prototipo.

## Evidence on Hand

- Especificación funcional canónica: `../appKine-api/docs/producto/AKINE_Requerimientos_Integrados.md`.
- Plan y análisis UX: `docs/ux/` (plan por etapas, auditoría heurística del 21/10/2026, UX-01 y
  UX-11 a UX-14).
- Sin logo ni imágenes de marca: el único recurso gráfico es `public/favicon.ico`. No inventar
  logos, testimonios, clientes, métricas ni precios.
- Datos de prueba sintéticos únicamente. Jamás datos reales de pacientes.

## Product Principles

1. **La tarea frecuente manda.** Lo que la recepción hace cien veces al día va primero y con el
   menor esfuerzo; lo que se configura una vez al mes puede pedir un paso más.
2. **El modelo se respeta en pantalla.** Ninguna pantalla mezcla Turno con Sesión, Persona con
   Paciente, ni deuda con cobro o caja.
3. **Menos a la vista, en el momento correcto.** Lo que explica se pliega; lo que es dato, estado,
   advertencia irreversible o paso obligatorio queda visible.
4. **Nada queda sin respuesta.** Toda acción tiene carga, éxito, error y estado vacío, con una
   salida.

## Accessibility & Inclusion

WCAG 2.1 AA es un gate del CI: contraste de texto en tema claro, oscuro y a 375 px
(`npm run a11y:contraste`), contraste no textual 3:1 en bordes de control y foco, navegación por
teclado, anillo de foco global y reglas de accesibilidad de plantilla en el lint.
