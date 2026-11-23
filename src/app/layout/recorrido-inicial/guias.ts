import type { NombreDeIcono } from '../../shared/components/icono/icono';

/** Lo que marca un paso: un elemento del contenido, por selector y, si se da, por su texto. */
export interface Objetivo {
  /** Por defecto, enlaces y botones del contenido. */
  readonly selector?: string;
  /** Parte del texto visible del elemento, sin importar mayúsculas. */
  readonly texto?: string;
}

/** Un paso de una guía por tarea. Sin objetivo, la tarjeta queda centrada sobre la pantalla. */
export interface PasoDeGuia {
  readonly titulo: string;
  readonly texto: string;
  /** Pantalla a la que lleva antes de marcar. */
  readonly ruta?: string;
  readonly objetivo?: Objetivo;
}

export interface DefinicionDeGuia {
  readonly id: string;
  readonly titulo: string;
  readonly descripcion: string;
  readonly icono: NombreDeIcono;
  /**
   * Pantalla de arranque. La guía se ofrece sólo si esa pantalla está en el menú de la persona,
   * así respeta sus permisos. `null`: siempre.
   */
  readonly desde: string | null;
  /** `undefined`: la guía del menú, que se arma con el menú que la persona ve. */
  readonly pasos?: readonly PasoDeGuia[];
}

/**
 * Guías de la "Guía rápida" (23/11/2026). La primera es el recorrido del menú del primer ingreso;
 * las demás llevan a cada pantalla de una tarea y marcan dónde tocar. Las tareas no se hacen solas:
 * la guía muestra el camino y la persona lo recorre.
 */
export const GUIAS: readonly DefinicionDeGuia[] = [
  {
    id: 'menu',
    titulo: 'Conocer el menú',
    descripcion: 'Qué hay en cada sección de la barra lateral.',
    icono: 'menu',
    desde: null,
  },
  {
    id: 'turno',
    titulo: 'Dar un turno',
    descripcion: 'Reservar un turno y recibir al paciente cuando llega.',
    icono: 'calendario',
    desde: '/agenda',
    pasos: [
      {
        titulo: 'Abrí el alta del turno',
        texto:
          'Desde la agenda, «Nuevo turno» abre el alta. También podés hacer clic en un horario libre del calendario.',
        ruta: '/agenda',
        objetivo: { texto: 'Nuevo turno' },
      },
      {
        titulo: 'Completá el turno',
        texto:
          'En el panel buscás al paciente (si no existe, lo das de alta ahí mismo), elegís la actividad, el profesional y un horario libre, y confirmás.',
      },
      {
        titulo: 'Cuando llega, en Recepción',
        texto:
          'En Recepción ves los turnos del día: marcás la llegada, validás la cobertura y lo pasás a atención.',
        ruta: '/agenda/recepcion',
        objetivo: { selector: 'app-cabecera-de-pagina' },
      },
    ],
  },
  {
    id: 'cobro',
    titulo: 'Registrar un cobro',
    descripcion: 'Cobrarle a un paciente lo que debe.',
    icono: 'economia',
    desde: '/pacientes',
    pasos: [
      {
        titulo: 'Buscá al paciente',
        texto: 'Buscalo por nombre o documento y abrí su ficha.',
        ruta: '/pacientes',
        objetivo: { selector: '.filtros-barra__principal' },
      },
      {
        titulo: 'Entrá a su cuenta corriente',
        texto: 'En la ficha, «Cuenta corriente» muestra lo que debe por cada atención o venta.',
      },
      {
        titulo: 'Registrá el cobro',
        texto:
          'Con «Registrar un cobro» elegís qué deudas cancela, cuánto y con qué medio de pago. Queda en los cobros del paciente.',
      },
      {
        titulo: 'La caja del día',
        texto:
          'En Caja abrís la caja del día, ves sus movimientos y al cerrarla hacés el arqueo. Los cobros y la caja son cosas distintas: el cobro cancela la deuda, la caja cuenta la plata.',
        ruta: '/caja',
        objetivo: { selector: 'app-cabecera-de-pagina' },
      },
    ],
  },
  {
    id: 'colaborador',
    titulo: 'Sumar un colaborador',
    descripcion: 'Darle acceso a un profesional o a alguien de recepción.',
    icono: 'perfil',
    desde: '/organizacion/colaboradores',
    pasos: [
      {
        titulo: 'Si ya tiene cuenta',
        texto:
          '«Vincular colaborador» lo suma con el correo de su cuenta de AKINE y le da un rol en tu centro.',
        ruta: '/organizacion/colaboradores',
        objetivo: { texto: 'Vincular colaborador' },
      },
      {
        titulo: 'Si todavía no tiene cuenta',
        texto: '«Alta manual» la crea con sus datos para que pueda empezar a trabajar.',
        ruta: '/organizacion/colaboradores',
        objetivo: { texto: 'Alta manual' },
      },
      {
        titulo: 'Rol y sedes',
        texto:
          'Al sumarlo elegís su rol (por ejemplo profesional o recepción) y en qué sedes trabaja: eso decide qué ve en el menú y qué puede hacer.',
      },
    ],
  },
  {
    id: 'obra-social',
    titulo: 'Cargar una obra social',
    descripcion: 'Sumar una obra social o prepaga y sus precios.',
    icono: 'contratacion',
    desde: '/contratacion/financiadores',
    pasos: [
      {
        titulo: 'Lo más rápido: del catálogo',
        texto:
          'El catálogo ya trae las obras sociales y prepagas de Córdoba con sus planes. Elegís la tuya y queda copiada en tu centro.',
        ruta: '/contratacion/financiadores',
        objetivo: { texto: 'Agregar desde el catálogo' },
      },
      {
        titulo: 'Si no está, a mano',
        texto:
          '«Dar de alta un financiador» la carga con su nombre; después le agregás los planes.',
        ruta: '/contratacion/financiadores',
        objetivo: { texto: 'Dar de alta un financiador' },
      },
      {
        titulo: 'Precios del plan',
        texto:
          'En cada plan cargás cuánto paga por cada actividad, para todas las sedes, y si querés un tope de sesiones por mes. El paciente paga la diferencia.',
      },
      {
        titulo: 'Que la actividad la acepte',
        texto:
          'Para atender con obra social, la actividad tiene que tener prendido «Admite obra social» (Servicios → Actividades de la sede).',
      },
    ],
  },
  {
    id: 'actividad',
    titulo: 'Publicar una actividad',
    descripcion: 'Ofrecer un servicio en la sede con su precio.',
    icono: 'actividades',
    desde: '/servicios/ofertas',
    pasos: [
      {
        titulo: 'Publicá un servicio',
        texto:
          '«Publicar un servicio en la sede» abre el alta: elegís el servicio del catálogo y se completan el nombre y la duración.',
        ruta: '/servicios/ofertas',
        objetivo: { texto: 'Publicar un servicio en la sede' },
      },
      {
        titulo: 'Precio, atención y cobro',
        texto:
          'Cargás el precio para particulares, si admite obra social, si es individual o grupal, qué hace falta para atender y cómo se cobra. Lo que no toques queda como viene del servicio.',
      },
    ],
  },
];
