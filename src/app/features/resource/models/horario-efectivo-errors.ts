import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Motivo por el que fallo la consulta de la <b>disponibilidad efectiva</b> (M05, AKINE-02.04).
 *
 * <p><b>Por que un traductor propio y no `traducirErrorExcepcion`.</b> Esta pantalla no muta
 * nada: solo lee. Los dos traductores que ya existen redactan sus mensajes desde la mutacion
 * -"no tenes permiso para <b>administrar</b> los cierres", "no admite horarios nuevos"- y en una
 * pantalla que no ofrece ningun boton de guardar eso manda a pedir un permiso que no se
 * necesita. Aca falta `colaborador:read`, no `consultorio:manage`, y decirlo mal hace que quien
 * administre el centro otorgue el permiso equivocado.
 *
 * <p>Por lo mismo <b>no ramifica</b> los conflictos de las mutaciones: `bloque-solapado`,
 * `bloque-already-inactive`, `excepcion-already-inactive` y el `409` de concurrencia no los
 * puede producir un `GET`. Escribirlos aca seria codigo muerto para siempre.
 *
 * <p>Lo que si conserva es `ventana-demasiado-amplia` con su `maximoDias`: la ventana la elige el
 * usuario y el tope lo publica el backend, que puede moverlo sin que este cliente se entere.
 *
 * <p>Se ramifica por `problemType` y <b>nunca</b> por el texto de `detail`, que es prosa para
 * humanos y cambia cuando alguien corrige una redaccion.
 */
export type CausaHorarioEfectivo =
  /** 403 missing-tenant-context: hay sesion, pero no hay sede elegida. NUNCA cerrar sesion. */
  | 'sin-contexto'
  /** 403 forbidden: falta `colaborador:read` sobre esa sede. */
  | 'sin-permiso'
  /** 404: la sede o el profesional no existen, o son de otro tenant. */
  | 'no-encontrado'
  /** 400 ventana-demasiado-amplia: la ventana pedida supera el tope. Ver `maximoDias`. */
  | 'ventana-amplia'
  /** 400 validation-error: la ventana falta, esta invertida o es vacia. */
  | 'validacion'
  /** 429: hay que esperar. Ver `segundosDeEspera`. */
  | 'limite'
  /** El request nunca llego: sin red, CORS o servidor caido. */
  | 'red'
  | 'otro';

/** Error ya traducido a algo mostrable. */
export interface ErrorHorarioEfectivo {
  readonly mensaje: string;
  readonly causa: CausaHorarioEfectivo;
  /** Segundos a esperar antes de reintentar. 0 fuera de `limite`. */
  readonly segundosDeEspera: number;
  /** Tope de dias que el backend acepta. Solo en `ventana-amplia`; 0 en el resto. */
  readonly maximoDias: number;
}

const MENSAJE_GENERICO = 'No pudimos resolver el horario. Volve a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa tu conexion y volve a intentar.';
const MENSAJE_LIMITE_SIN_PLAZO =
  'Demasiadas consultas. Espera un momento antes de volver a intentar.';

const MENSAJE_SIN_CONTEXTO =
  'El horario efectivo se resuelve en una sede concreta y todavia no elegiste ninguna. Eligi un ' +
  'consultorio para ver que dias y horas atiende el profesional.';

const MENSAJE_SIN_PERMISO =
  'No tenes permiso para ver el horario de los profesionales de esta sede. Se necesita ' +
  'colaborador:read, que es el mismo permiso con el que se lee el horario semanal; pediselo a ' +
  'quien administra la sede.';

const MENSAJE_NO_ENCONTRADO =
  'Ese profesional o esa sede ya no existen, o el vinculo pertenece a otra sede. Volve a elegir ' +
  'el profesional en la lista.';

/** Traduce cualquier error de la consulta de disponibilidad efectiva. */
export function traducirErrorHorarioEfectivo(error: unknown): ErrorHorarioEfectivo {
  if (!(error instanceof AkineHttpError)) {
    return base(MENSAJE_GENERICO, 'otro');
  }

  if (error.esDeRed) {
    return base(MENSAJE_DE_RED, 'red');
  }

  if (error.esRateLimited) {
    const segundos = segundosDeEspera(error);
    return {
      ...base(
        segundos > 0
          ? `Demasiadas consultas. Espera ${segundos} segundos y volve a intentar.`
          : MENSAJE_LIMITE_SIN_PLAZO,
        'limite',
      ),
      segundosDeEspera: segundos,
    };
  }

  if (error.problemType === 'missing-tenant-context') {
    return base(MENSAJE_SIN_CONTEXTO, 'sin-contexto');
  }

  if (error.problemType === 'ventana-demasiado-amplia') {
    const maximo = error.numeroDeExtension('maximoDias') ?? 0;
    return { ...base(mensajeDeVentana(maximo), 'ventana-amplia'), maximoDias: maximo };
  }

  if (error.status === 403) {
    return base(MENSAJE_SIN_PERMISO, 'sin-permiso');
  }

  if (error.status === 404) {
    // Inexistente, de otra sede y de otro tenant responden igual: distinguirlos permitiria
    // reconstruir la nomina de cualquier centro probando ids.
    return base(MENSAJE_NO_ENCONTRADO, 'no-encontrado');
  }

  if (error.status === 400) {
    // El backend nombra el campo concreto; su texto es mas util que cualquier generico.
    return base(conDetalle(error, MENSAJE_GENERICO), 'validacion');
  }

  return base(conDetalle(error, MENSAJE_GENERICO), 'otro');
}

/**
 * La ventana pedida es mas larga de lo que el backend acepta.
 *
 * <p>El tope viaja en la extension `maximoDias` justamente para que la pantalla pueda decirlo en
 * vez de dejar al usuario acortando a ciegas. Sin la extension se degrada a un texto sin numero:
 * inventar uno seria peor que no decirlo.
 */
function mensajeDeVentana(maximoDias: number): string {
  if (maximoDias <= 0) {
    return 'La ventana que pediste es demasiado larga. Consulta un periodo mas corto.';
  }
  return (
    `La ventana que pediste es demasiado larga: el maximo es de ${maximoDias} dias. ` +
    'Acorta el periodo y volve a consultar.'
  );
}

function base(mensaje: string, causa: CausaHorarioEfectivo): ErrorHorarioEfectivo {
  return { mensaje, causa, segundosDeEspera: 0, maximoDias: 0 };
}

/** El mensaje del backend, o el de respaldo si el cuerpo no traia `ProblemDetail`. */
function conDetalle(error: AkineHttpError, respaldo: string): string {
  return error.problem === null ? respaldo : error.message;
}

/** Espera declarada en `Retry-After`, o `0`. Sin header no se inventa un numero. */
function segundosDeEspera(error: AkineHttpError): number {
  const segundos = error.reintentarEnSegundos;
  if (segundos === null || !Number.isFinite(segundos) || segundos <= 0) {
    return 0;
  }
  return Math.ceil(segundos);
}
