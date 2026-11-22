import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';

import { publicarMetadatosDeLanding } from './models/metadatos-de-landing';

import { RUTA_LOGIN } from '../../core/models/rutas';
import { Icono, NombreDeIcono } from '../../shared/components/icono/icono';
import { AgendaDeMuestra } from './components/agenda-de-muestra/agenda-de-muestra';
import { ArmadorDePlan } from './components/armador-de-plan/armador-de-plan';
import { PedidoDePrueba } from './components/pedido-de-prueba/pedido-de-prueba';
import { MapaDeSedes } from './components/mapa-de-sedes/mapa-de-sedes';
import { SeccionIa } from './components/seccion-ia/seccion-ia';
import { PieDeLanding } from './components/pie-de-landing/pie-de-landing';
import { EleccionDelArmador } from './models/eleccion-del-armador';

interface Beneficio {
  readonly icono: NombreDeIcono;
  readonly titulo: string;
  readonly texto: string;
}

interface Servicio {
  readonly clave: 'kine' | 'actividades';
  readonly etiqueta: string;
  readonly titulo: string;
  readonly para: string;
  readonly icono: NombreDeIcono;
  readonly beneficios: readonly Beneficio[];
  readonly ia: string;
}

interface Momento {
  readonly hora: string;
  readonly icono: NombreDeIcono;
  readonly titulo: string;
  readonly texto: string;
  /** Lo que se vería en pantalla en ese momento (dato inventado). */
  readonly dato: string;
  readonly ia?: boolean;
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

/**
 * Landing pública de AKINE, en `/` (`appKine-api/docs/diseno/AKINE-landing-y-ofertas.md` §4).
 * Sin datos del backend ni precios: todo el texto vive acá. Quien tiene sesión no la ve: lo manda
 * a su inicio `landingGuard`.
 */
@Component({
  selector: 'app-landing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    Icono,
    AgendaDeMuestra,
    ArmadorDePlan,
    MapaDeSedes,
    SeccionIa,
    PedidoDePrueba,
    PieDeLanding,
  ],
  templateUrl: './landing-page.html',
  styleUrls: ['./landing-comun.css', './landing-page.css'],
  providers: [EleccionDelArmador],
})
export class LandingPage {
  protected readonly rutaLogin = RUTA_LOGIN;

  constructor() {
    publicarMetadatosDeLanding(inject(Meta), inject(DOCUMENT), inject(DestroyRef));
  }

  protected readonly servicios: readonly Servicio[] = [
    {
      clave: 'kine',
      etiqueta: 'Salud',
      titulo: 'Kinesiología y rehabilitación',
      para: 'Para el consultorio y el centro de rehabilitación.',
      icono: 'pacientes',
      beneficios: [
        {
          icono: 'documento',
          titulo: 'Historia clínica completa',
          texto: 'Casos, plan de tratamiento y evolución de cada persona en un solo lugar.',
        },
        {
          icono: 'operacion',
          titulo: 'Evaluación en la tablet',
          texto: 'Examen, mediciones y escalas sesión a sesión, sin papel.',
        },
        {
          icono: 'contratacion',
          titulo: 'Obras sociales sin planillas',
          texto: 'Convenios y aranceles; las autorizaciones se descuentan solas.',
        },
        {
          icono: 'economia',
          titulo: 'Presentaciones listas',
          texto: 'La liquidación de cada financiador, con débitos y reparos.',
        },
      ],
      ia: 'La IA sigue la evolución de cada caso y te avisa cuándo conviene revisar el plan.',
    },
    {
      clave: 'actividades',
      etiqueta: 'Movimiento',
      titulo: 'Actividades',
      para: 'Para el gimnasio y el estudio de yoga, pilates o danza.',
      icono: 'actividades',
      beneficios: [
        {
          icono: 'calendario',
          titulo: 'Clases semanales',
          texto: 'Cupo, inscripciones y lista de espera que se corre sola.',
        },
        {
          icono: 'exito',
          titulo: 'Asistencia en un toque',
          texto: 'La clase entera en una sola pantalla, desde la tablet.',
        },
        {
          icono: 'capas',
          titulo: 'Pases y abonos',
          texto: 'Packs de clases con renovación y vencimiento automáticos.',
        },
        {
          icono: 'economia',
          titulo: 'Honorarios por clase',
          texto: 'Lo que le corresponde a cada instructor, sin cuentas a mano.',
        },
      ],
      ia: 'Preguntale a la IA quién dejó de venir este mes y qué clases se llenan primero.',
    },
  ];

  protected readonly dia: readonly Momento[] = [
    {
      hora: '07:45',
      icono: 'economia',
      titulo: 'Abre la caja',
      texto: 'Cada sede abre su caja, registra los movimientos y la cierra con arqueo.',
      dato: 'Caja abierta · Sede Centro',
    },
    {
      hora: '08:00',
      icono: 'calendario',
      titulo: 'La agenda del día',
      texto: 'Por profesional o por box, con turnos sueltos o en serie y el horario de cada sede.',
      dato: '24 turnos · 3 profesionales',
    },
    {
      hora: '08:55',
      icono: 'exito',
      titulo: 'Llega el primero',
      texto: 'Recepción marca llegada y espera, y avisa si a la cobertura le falta la orden.',
      dato: 'Julián Ríos · En espera',
    },
    {
      hora: '10:30',
      icono: 'operacion',
      titulo: 'Desde la tablet',
      texto: 'Pantallas al dedo para atender con la persona adelante, no con la vista en la PC.',
      dato: 'Sesión 4 de 10 · Lucía Benítez',
    },
    {
      hora: '13:00',
      icono: 'contratacion',
      titulo: 'Se cobra',
      texto: 'La deuda nace de la atención y el cobro la salda. Siempre sabés qué se debe.',
      dato: 'Coseguro cobrado · Saldo 0',
    },
    {
      hora: '20:00',
      icono: 'chispa',
      titulo: 'La IA te cuenta el día',
      texto: 'Turnos, asistencia, cobros y rentabilidad. Y si algo no cierra, se lo preguntás.',
      dato: '«Hoy hubo 2 ausentes y la caja cerró sin diferencias»',
      ia: true,
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
