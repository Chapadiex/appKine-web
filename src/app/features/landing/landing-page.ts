import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { RUTA_LOGIN } from '../../core/models/rutas';
import { Icono, NombreDeIcono } from '../../shared/components/icono/icono';
import { AgendaDeMuestra } from './components/agenda-de-muestra/agenda-de-muestra';
import { ArmadorDePlan } from './components/armador-de-plan/armador-de-plan';
import { MapaDeSedes } from './components/mapa-de-sedes/mapa-de-sedes';
import { SeccionIa } from './components/seccion-ia/seccion-ia';

interface Servicio {
  readonly titulo: string;
  readonly para: string;
  readonly icono: NombreDeIcono;
  readonly beneficios: readonly string[];
}

interface Momento {
  readonly hora: string;
  readonly titulo: string;
  readonly texto: string;
}

interface Rasgo {
  readonly icono: NombreDeIcono;
  readonly titulo: string;
  readonly texto: string;
}

interface Pregunta {
  readonly pregunta: string;
  readonly respuesta: string;
}

/** Placeholder hasta el formulario del pedido de prueba (etapa 4 del plan de la landing). */
export const MAILTO_PRUEBA = 'mailto:hola@akine.app?subject=Prueba%20gratis%20de%2030%20d%C3%ADas';

/**
 * Landing pública de AKINE, en `/` (`appKine-api/docs/diseno/AKINE-landing-y-ofertas.md` §4).
 * Sin datos del backend ni precios: todo el texto vive acá. Quien tiene sesión no la ve: lo manda
 * a su inicio `landingGuard`.
 */
@Component({
  selector: 'app-landing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icono, AgendaDeMuestra, ArmadorDePlan, MapaDeSedes, SeccionIa],
  templateUrl: './landing-page.html',
  styleUrls: ['./landing-comun.css', './landing-page.css'],
})
export class LandingPage {
  protected readonly rutaLogin = RUTA_LOGIN;
  protected readonly mailtoPrueba = MAILTO_PRUEBA;

  protected readonly servicios: readonly Servicio[] = [
    {
      titulo: 'Kinesiología y rehabilitación',
      para: 'Para el consultorio y el centro de rehabilitación.',
      icono: 'pacientes',
      beneficios: [
        'Historia clínica por persona, con casos y plan de tratamiento.',
        'Sesión de evaluación con examen, mediciones y escalas, pensada para la tablet.',
        'Coberturas, convenios y aranceles; las autorizaciones se descuentan solas en cada sesión.',
        'Presentaciones a obras sociales y prepagas, con débitos y reparos.',
      ],
    },
    {
      titulo: 'Actividades',
      para: 'Para el gimnasio y el estudio de yoga, pilates o danza.',
      icono: 'actividades',
      beneficios: [
        'Clases semanales con cupo, inscripciones y lista de espera.',
        'La asistencia de la clase entera en una sola pantalla.',
        'Pases, abonos y packs de clases, con renovación y vencimiento.',
        'Honorarios por clase para cada instructor.',
      ],
    },
  ];

  protected readonly dia: readonly Momento[] = [
    {
      hora: '07:45',
      titulo: 'Abre la caja',
      texto: 'Cada sede abre su caja, registra los movimientos y la cierra con arqueo.',
    },
    {
      hora: '08:00',
      titulo: 'La agenda del día',
      texto: 'Por profesional o por box, con turnos sueltos o en serie y el horario de cada sede.',
    },
    {
      hora: '08:55',
      titulo: 'Llega el primero',
      texto: 'Recepción marca llegada y espera, y avisa si a la cobertura le falta la orden.',
    },
    {
      hora: '10:30',
      titulo: 'Desde la tablet',
      texto: 'Pantallas al dedo para atender con la persona adelante, no con la vista en la PC.',
    },
    {
      hora: '13:00',
      titulo: 'Se cobra',
      texto: 'La deuda nace de la atención y el cobro la salda. Siempre sabés qué se debe.',
    },
    {
      hora: '20:00',
      titulo: 'Se mira el día',
      texto: 'Turnos, asistencia, cobros y rentabilidad por servicio, en pantalla o en CSV.',
    },
  ];

  protected readonly base: readonly Rasgo[] = [
    {
      icono: 'pacientes',
      titulo: 'Un padrón de personas',
      texto: 'Cada persona una sola vez, aunque sea paciente y alumna.',
    },
    {
      icono: 'candado',
      titulo: 'Roles y permisos por sede',
      texto: 'Recepción, profesionales y administración ven lo suyo.',
    },
    {
      icono: 'preferencias',
      titulo: 'Tu marca',
      texto: 'Logo y colores del centro en cada pantalla, en claro y en oscuro.',
    },
  ];

  protected readonly sedes: readonly Rasgo[] = [
    {
      icono: 'pacientes',
      titulo: 'Personas compartidas',
      texto: 'Quien se atiende en una sede puede tomar una clase en otra, con la misma ficha.',
    },
    {
      icono: 'calendario',
      titulo: 'Cada sede con lo suyo',
      texto: 'Agenda, horario, boxes, salas y caja propios.',
    },
    {
      icono: 'economia',
      titulo: 'Reportes por sede y del total',
      texto: 'Comparás sedes o mirás la organización entera.',
    },
    {
      icono: 'organizacion',
      titulo: 'Un equipo, varias sedes',
      texto: 'El profesional que atiende en dos sedes tiene una cuenta y permisos por sede.',
    },
  ];

  protected readonly preguntas: readonly Pregunta[] = [
    {
      pregunta: '¿Qué pasa cuando terminan los 30 días?',
      respuesta:
        'Elegís qué plan y qué servicios contratar. Si no elegís, el centro pasa a sólo lectura: ' +
        'entrás, ves tus datos y los podés exportar. Nunca se borra nada.',
    },
    {
      pregunta: '¿Puedo cambiar los servicios o el plan después?',
      respuesta:
        'Sí. Podés sumar o sacar un servicio, la IA o sedes cuando lo necesites: nos lo pedís y ' +
        'lo cambiamos sin tocar tus datos.',
    },
    {
      pregunta: '¿Dónde quedan mis datos?',
      respuesta:
        'En la instalación de AKINE, separados por organización. La inteligencia artificial ' +
        'corre en esa misma instalación: lo que se escribe en una historia clínica no se manda a ' +
        'servicios externos.',
    },
    {
      pregunta: '¿Sirve para obras sociales y prepagas?',
      respuesta:
        'Sí, es parte del modelo: coberturas por paciente, convenios y aranceles, órdenes y ' +
        'autorizaciones con su consumo, y presentaciones con débitos y reparos.',
    },
    {
      pregunta: '¿Necesito instalar algo?',
      respuesta:
        'No. Se usa desde el navegador, en la PC de la recepción, en una notebook o en la tablet ' +
        'del consultorio.',
    },
    {
      pregunta: '¿Por qué no puedo crear la cuenta yo mismo?',
      respuesta:
        'Porque cada centro arranca configurado: pedís la prueba, armamos tu organización y te ' +
        'llega la invitación por correo para poner tu contraseña.',
    },
  ];
}
