import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { instanteEnPalabras } from './etiquetas-de-atencion';

/**
 * Motivo por el que fallo una operacion de la pantalla de atencion (M14, AKINE-06.01 y 06.02).
 *
 * <p>Se ramifica por `problemType` y <b>nunca</b> por el texto de `detail`, igual que en el resto
 * de las features: `detail` es prosa y cambia cuando alguien corrige una redaccion.
 *
 * <h2>Los cinco errores propios llevan a cinco salidas distintas</h2>
 *
 * <ul>
 *   <li><b>`sesion-ajena`</b> (409): la atencion la esta llevando <b>otro profesional</b>. No es
 *       falta de permiso —dos profesionales de la misma sede tienen el mismo `sesion:register`—
 *       sino <b>propiedad</b> de esa atencion, y por eso el backend responde 409 y no 403.
 *       Decirle "no tenes permiso" a quien si lo tiene lo manda a pedirle a un administrador algo
 *       que ya tiene, y nunca se entera de lo que realmente pasa.</li>
 *   <li><b>`turno-no-atendible`</b> (409): el turno no habilita una atencion. Viaja con `motivo`,
 *       que es lo unico que le dice al profesional que hacer —el turno esta cancelado, la persona
 *       no tiene perfil de paciente, etc.—.</li>
 *   <li><b>`concurrent-modification`</b> (409): otra pestaña guardo antes. <b>No se pierde nada</b>
 *       de lo escrito: la accion es releer la sesion y comparar.</li>
 *   <li><b>`sesion-cerrada`</b> (409): la atencion ya se cerro y el borrador y la evaluacion no la
 *       admiten mas. <b>No es un conflicto que se resuelva reintentando</b>, que es lo que lo
 *       separa del anterior: no hay ninguna version con la que el guardado vaya a pasar. La unica
 *       salida es pasar a modo lectura, y por eso la pantalla lo trata como un estado nuevo y no
 *       como una falla.</li>
 *   <li><b>`validation-error`</b> (400): dolor fuera de la escala 0-10, o lateralidad sin zona.
 *       Ninguno depende de nada que pueda cambiar entre dos peticiones, asi que reintentar no los
 *       arregla: hay que corregir el campo.</li>
 * </ul>
 */
export type CausaAtencion =
  /** 400 validation-error: dolor fuera de 0-10, o lateralidad sin zona. */
  | 'validacion'
  /** 403 missing-tenant-context: hay sesion, pero no hay sede elegida. NUNCA cerrar sesion. */
  | 'sin-contexto'
  /** 403 forbidden: falta `sesion:register` en esta sede. */
  | 'sin-permiso'
  /** 404: la sesion, el turno o la sede no existen, o son de otro tenant. */
  | 'no-encontrado'
  /** 409 `sesion-ajena`: la atiende otro profesional. Es propiedad, no permiso. */
  | 'sesion-ajena'
  /** 409 `turno-no-atendible`: el turno no habilita una atencion. Ver `motivo`. */
  | 'turno-no-atendible'
  /** 409 `concurrent-modification`: otra pestaña guardo antes. Releer y comparar. */
  | 'version-vieja'
  /** 409 `sesion-cerrada`: la atencion ya se cerro. No hay nada que reintentar. */
  | 'sesion-cerrada'
  /** 409 subscription-suspended: lo emite el filtro, antes del controller. */
  | 'suscripcion-suspendida'
  /**
   * 409 `oferta-sin-precio` (DP-17): la deuda es el precio particular y la oferta no tiene uno
   * vigente ese dia. La sesion sigue abierta: se carga el precio y se reintenta. Ver `ofertaId`.
   */
  | 'oferta-sin-precio'
  /** 400 `medicion-fuera-de-rango`: el valor cae fuera del rango vigente. Ver `minimo`/`maximo`. */
  | 'fuera-de-rango'
  /** 400 `medicion-tipo-incompatible`: falta el valor o sobra otro, segun el tipo de la medida. */
  | 'tipo-incompatible'
  /** 409 `medicion-definicion-inactiva`: el test se dio de baja y no admite mediciones nuevas. */
  | 'definicion-inactiva'
  /** 409 `practica-no-utilizable` / `practica-no-habilitada-en-oferta`. */
  | 'practica-no-utilizable'
  /** 400 `parametro-invalido`: un parametro sin tipo, o con unidad sobre algo que no es numero. */
  | 'parametro-invalido'
  /** 409 `enmienda-cambia-practicas`: la enmienda cambiaria el conjunto de practicas realizadas. */
  | 'enmienda-cambia-practicas'
  /** 400 `enmienda-sin-motivo`: una enmienda sin motivo es una correccion silenciosa. */
  | 'enmienda-sin-motivo'
  /** 409 `caso-clinico-cerrado` / `caso-no-activo`: el caso elegido ya no esta activo. */
  | 'caso-no-activo'
  /**
   * 409 `caso-de-atencion-grupal` (AKINE-08.05): la atencion es de un participante de una clase y
   * su caso lo fijo la derivacion. No se cambia.
   */
  | 'caso-de-atencion-grupal'
  /**
   * 409 `caso-clinico-requerido` (RF-M10-007, DP-43): la oferta exige caso clinico para iniciar, para
   * quitarlo y para cerrar presente. Se resuelve eligiendo (o abriendo) un caso y reintentando.
   */
  | 'caso-requerido'
  /** 409 `enmienda-fuera-de-ventana` (DP-43): paso la ventana de enmienda. Ver `enmendableHasta`. */
  | 'enmienda-fuera-de-ventana'
  /** 409 `profesional-no-habilitado-en-oferta` (DP-43): quien atiende no presta esa oferta. */
  | 'profesional-no-habilitado'
  /** 409 `profesional-no-asignable`: el reemplazo no tiene vinculo vigente o no registra sesiones. */
  | 'profesional-no-asignable'
  /** 409 `oferta-no-vigente`: la oferta elegida para atender sin turno no rige hoy. */
  | 'oferta-no-vigente'
  /** 409 `idempotency-key-conflict`: la misma clave con otro pedido. Se reintenta con otra. */
  | 'clave-reusada'
  /** Cualquier otro 409. Gana el `detail` del backend. */
  | 'conflicto'
  /** 429: hay que esperar. */
  | 'limite'
  /** El request nunca llego: sin red, CORS o servidor caido. */
  | 'red'
  | 'otro';

/** Error ya traducido a algo mostrable. */
export interface ErrorAtencion {
  readonly mensaje: string;
  readonly causa: CausaAtencion;
  /** Por que el turno no es atendible. Vacio fuera de `turno-no-atendible`. */
  readonly motivo: string;
  /** Oferta a la que le falta precio. Solo en `oferta-sin-precio`, y si el servidor la mando. */
  readonly ofertaId?: number | null;
  /** Rango vigente de la medida. Solo en `fuera-de-rango`, si el servidor lo mando. */
  readonly minimo?: number | null;
  readonly maximo?: number | null;
  /** Hasta cuando se podia enmendar. Solo en `enmienda-fuera-de-ventana`. */
  readonly enmendableHasta?: string;
}

const MENSAJE_GENERICO = 'No pudimos completar la operación. Volvé a intentar en un momento.';
const MENSAJE_DE_RED =
  'No se pudo contactar al servidor, así que lo último que escribiste todavía no esta guardado. ' +
  'No cierres esta pantalla: revisa la conexion y volvé a guardar.';
const MENSAJE_LIMITE = 'Demasiados intentos seguidos. Espera un momento y volvé a guardar.';

const MENSAJE_SIN_CONTEXTO =
  'Para registrar una atención hay que saber en que sede estas. Eligi una organización y un ' +
  'consultorio, y volvé a entrar. Tu sesión sigue abierta.';

const MENSAJE_SIN_PERMISO =
  'No tenés permiso para registrar atenciones en esta sede. Pediselo a quien administra el centro.';

const MENSAJE_NO_ENCONTRADO =
  'Ese turno o esa atención no existen, o no son de esta sede. Volvé a la agenda y entra de nuevo.';

/**
 * `sesion-ajena` explicado como lo que es: propiedad, no permiso.
 *
 * <p>El texto evita a proposito la palabra "permiso". Quien lee esto <b>si</b> tiene
 * `sesion:register`; lo que no tiene es esta atencion, que es de otro profesional.
 */
const MENSAJE_SESION_AJENA =
  'Esta atención la esta registrando otro profesional. No es un problema de permisos: la atención ' +
  'es de quien la lleva, y solo esa persona puede escribir en ella. Si el turno quedo asignado a ' +
  'quien no corresponde, se corrige desde la agenda.';

const MENSAJE_VERSION_VIEJA =
  'Otra pestaña guardo esta atención después de que vos la abriste. No pisamos nada y no perdimos ' +
  'lo que escribiste.';

/**
 * `sesion-cerrada` no es un fallo que se reintente: es un estado nuevo.
 *
 * <p>El texto tiene que decir las dos cosas que le importan a quien lo lee. Que <b>lo cerrado
 * quedo guardado</b> —el 409 llega al intentar seguir editando, y sin decirlo parece que se
 * perdio algo—, y que corregir una sesion cerrada <b>es una enmienda</b> (AKINE-06.06): con motivo
 * obligatorio y una version nueva que deja la anterior intacta.
 */
const MENSAJE_SESION_CERRADA =
  'Esta atención ya esta cerrada, así que no admite mas cambios. Lo que estaba guardado al ' +
  'cerrarla quedo registrado. Corregir una sesión cerrada es una enmienda: se hace desde la ' +
  'atención cerrada, con un motivo, y deja la versión anterior intacta.';

const MENSAJE_TIPO_INCOMPATIBLE =
  'El valor no corresponde al tipo de esa medida: una numerica pide un número, una de texto un ' +
  'hallazgo y una de si/no una de las dos opciones. Se manda exactamente uno.';

const MENSAJE_DEFINICION_INACTIVA =
  'Esa medida se dio de baja en el catalogo y ya no admite mediciones nuevas. Las ya tomadas ' +
  'siguen legibles.';

const MENSAJE_PRACTICA_NO_UTILIZABLE =
  'Esa práctica no se puede asentar en esta atención: se dio de baja en el catalogo o la oferta ' +
  'del turno no la incluye.';

const MENSAJE_PARAMETRO_INVALIDO =
  'Un parametro no se puede interpretar: cada uno necesita su tipo, y la unidad va solo en los ' +
  'numericos.';

const MENSAJE_ENMIENDA_CAMBIA_PRACTICAS =
  'La enmienda cambiaria las prácticas realizadas en la sesión, y eso no se corrige enmendando: ' +
  'esas prácticas eligieron al cierre que autorización se consumio. Se puede corregir todo lo ' +
  'demas de cada tratamiento.';

const MENSAJE_ENMIENDA_SIN_MOTIVO =
  'Falta el motivo de la enmienda. Sin el, una correccion es indistinguible de un cambio ' +
  'silencioso, que es justamente lo que el historial existe para evitar.';

const MENSAJE_CASO_NO_ACTIVO =
  'El caso elegido ya no esta activo. Elegí otro, o inicia la atención sin caso y reabrilo desde ' +
  'la historia clínica si correspondia.';

const MENSAJE_CASO_DE_ATENCION_GRUPAL =
  'El caso de esta atención no se puede cambiar: es la atención de un participante de una clase, ' +
  'y su caso lo fijo la derivacion clínica. Si correspondia otro caso, cerra esta atención con lo ' +
  'que paso y deriva al participante al caso correcto desde la clase.';

const MENSAJE_SUSCRIPCION_SUSPENDIDA =
  'La suscripción de la organización esta suspendida, así que no se pueden registrar atenciones.';

const MENSAJE_CONFLICTO =
  'El servidor rechazo la operación por un conflicto con lo que ya hay guardado. Volvé a abrir ' +
  'la atención para ver el estado actual.';

/**
 * Por que la deuda de esta sesion es el precio particular, segun el `motivo` de
 * `oferta-sin-precio`. Un motivo desconocido no rompe el mensaje: simplemente no se explica.
 */
const RAZON_PRECIO_PARTICULAR: Readonly<Record<string, string>> = {
  PARTICULAR_POR_RECEPCION: 'la recepción se resolvio como particular',
  OFERTA_SIN_OBRA_SOCIAL: 'la oferta no admite obra social',
  SIN_COBERTURA_APLICABLE: 'el paciente no tiene una cobertura con convenio y arancel aplicables',
};

const MENSAJE_VALIDACION =
  'El servidor rechazo un dato clínico. El dolor va de 0 a 10, y la lateralidad exige una zona: ' +
  '"derecha" de que.';

const MENSAJE_CASO_REQUERIDO =
  'Esta prestación exige un caso clínico: elegí uno de los casos activos del paciente (o abri uno ' +
  'desde su historia clínica) y volvé a intentar. No se registro nada.';

const MENSAJE_PROFESIONAL_NO_HABILITADO =
  'Ese profesional no esta habilitado para prestar esta oferta. Elegí otra oferta u otro ' +
  'profesional, o pedi que lo habiliten en la oferta.';

const MENSAJE_PROFESIONAL_NO_ASIGNABLE =
  'Ese profesional no puede continuar la atención: necesita un vinculo vigente en esta sede y ' +
  'permiso para registrar sesiones.';

const MENSAJE_OFERTA_NO_VIGENTE =
  'Esa oferta no esta vigente hoy en esta sede, así que no se puede atender con ella. Elegí otra.';

const MENSAJE_CLAVE_REUSADA =
  'Ese pedido ya se habia mandado con otros datos. No se abrio otra atención: revisa los datos y ' +
  'volvé a intentar.';

function mensajeFueraDeVentana(error: AkineHttpError): ErrorAtencion {
  const hasta = textoDeExtension(error, 'enmendableHasta');
  const dias = error.numeroDeExtension('ventanaDias');
  const cuando =
    hasta === '' ? '' : ` Se podia enmendar hasta el ${instanteEnPalabras(hasta) || hasta}.`;
  const ventana = dias === null ? '' : ` La organización admite enmiendas durante ${dias} días.`;
  return {
    mensaje:
      'Esta sesión ya no se puede enmendar: paso la ventana desde su cierre.' +
      cuando +
      ventana +
      ' El original queda como esta; si hace falta corregirlo, habla con quien administra el centro.',
    causa: 'enmienda-fuera-de-ventana',
    motivo: '',
    enmendableHasta: hasta,
  };
}

/** Traduce cualquier error de la pantalla de atencion. */
export function traducirErrorAtencion(error: unknown): ErrorAtencion {
  if (!(error instanceof AkineHttpError)) {
    return { mensaje: MENSAJE_GENERICO, causa: 'otro', motivo: '' };
  }

  if (error.esDeRed) {
    return { mensaje: MENSAJE_DE_RED, causa: 'red', motivo: '' };
  }

  if (error.esRateLimited) {
    return { mensaje: MENSAJE_LIMITE, causa: 'limite', motivo: '' };
  }

  switch (error.problemType) {
    case 'missing-tenant-context':
      return { mensaje: MENSAJE_SIN_CONTEXTO, causa: 'sin-contexto', motivo: '' };
    case 'subscription-suspended':
      return {
        mensaje: MENSAJE_SUSCRIPCION_SUSPENDIDA,
        causa: 'suscripcion-suspendida',
        motivo: '',
      };
    case 'sesion-ajena':
      return { mensaje: MENSAJE_SESION_AJENA, causa: 'sesion-ajena', motivo: '' };
    case 'turno-no-atendible':
      return {
        mensaje: conDetalle(error, 'Este turno no habilita una atención.'),
        causa: 'turno-no-atendible',
        motivo: textoDeExtension(error, 'motivo'),
      };
    case 'concurrent-modification':
      return { mensaje: MENSAJE_VERSION_VIEJA, causa: 'version-vieja', motivo: '' };
    case 'oferta-sin-precio':
      return {
        mensaje: mensajeSinPrecio(error),
        causa: 'oferta-sin-precio',
        motivo: '',
        ofertaId: error.numeroDeExtension('ofertaId'),
      };
    case 'sesion-cerrada':
      return { mensaje: MENSAJE_SESION_CERRADA, causa: 'sesion-cerrada', motivo: '' };
    case 'validation-error':
      return { mensaje: conDetalle(error, MENSAJE_VALIDACION), causa: 'validacion', motivo: '' };
    case 'medicion-fuera-de-rango':
      return mensajeFueraDeRango(error);
    case 'medicion-tipo-incompatible':
      return { mensaje: MENSAJE_TIPO_INCOMPATIBLE, causa: 'tipo-incompatible', motivo: '' };
    case 'medicion-definicion-inactiva':
      return { mensaje: MENSAJE_DEFINICION_INACTIVA, causa: 'definicion-inactiva', motivo: '' };
    case 'practica-no-utilizable':
    case 'practica-no-habilitada-en-oferta':
      return {
        mensaje: MENSAJE_PRACTICA_NO_UTILIZABLE,
        causa: 'practica-no-utilizable',
        motivo: '',
      };
    case 'parametro-invalido':
      return {
        mensaje: conDetalle(error, MENSAJE_PARAMETRO_INVALIDO),
        causa: 'parametro-invalido',
        motivo: '',
      };
    case 'enmienda-cambia-practicas':
      return {
        mensaje: MENSAJE_ENMIENDA_CAMBIA_PRACTICAS,
        causa: 'enmienda-cambia-practicas',
        motivo: '',
      };
    case 'enmienda-sin-motivo':
      return { mensaje: MENSAJE_ENMIENDA_SIN_MOTIVO, causa: 'enmienda-sin-motivo', motivo: '' };
    case 'caso-de-atencion-grupal':
      return {
        mensaje: MENSAJE_CASO_DE_ATENCION_GRUPAL,
        causa: 'caso-de-atencion-grupal',
        motivo: '',
      };
    case 'caso-clinico-cerrado':
    case 'caso-no-activo':
      return { mensaje: MENSAJE_CASO_NO_ACTIVO, causa: 'caso-no-activo', motivo: '' };
    case 'caso-clinico-requerido':
      return { mensaje: MENSAJE_CASO_REQUERIDO, causa: 'caso-requerido', motivo: '' };
    case 'enmienda-fuera-de-ventana':
      return mensajeFueraDeVentana(error);
    case 'profesional-no-habilitado-en-oferta':
      return {
        mensaje: MENSAJE_PROFESIONAL_NO_HABILITADO,
        causa: 'profesional-no-habilitado',
        motivo: '',
      };
    case 'profesional-no-asignable':
      return {
        mensaje: conDetalle(error, MENSAJE_PROFESIONAL_NO_ASIGNABLE),
        causa: 'profesional-no-asignable',
        motivo: '',
      };
    case 'oferta-no-vigente':
      return { mensaje: MENSAJE_OFERTA_NO_VIGENTE, causa: 'oferta-no-vigente', motivo: '' };
    case 'idempotency-key-conflict':
      return { mensaje: MENSAJE_CLAVE_REUSADA, causa: 'clave-reusada', motivo: '' };
    default:
      break;
  }

  if (error.status === 403) {
    return { mensaje: MENSAJE_SIN_PERMISO, causa: 'sin-permiso', motivo: '' };
  }

  if (error.status === 404) {
    // Inexistente y de otro tenant responden igual a proposito: distinguirlos permitiria
    // enumerar sedes ajenas probando ids.
    return { mensaje: MENSAJE_NO_ENCONTRADO, causa: 'no-encontrado', motivo: '' };
  }

  if (error.status === 409) {
    return { mensaje: conDetalle(error, MENSAJE_CONFLICTO), causa: 'conflicto', motivo: '' };
  }

  if (error.status === 400) {
    return { mensaje: conDetalle(error, MENSAJE_VALIDACION), causa: 'validacion', motivo: '' };
  }

  return { mensaje: conDetalle(error, MENSAJE_GENERICO), causa: 'otro', motivo: '' };
}

/**
 * Traduce un error del autosave de las notas (`PUT .../borrador`).
 *
 * <p>Desde el contrato 0.102.0 un borrador que la columna JSON no acepta es 400 `validation-error`
 * con `errors.contenido`, y no el 409 generico de integridad que llegaba antes. El mensaje generico
 * de validacion habla de dolor y lateralidad, que no tienen nada que ver con las notas: aca se dice
 * que fueron las notas, lo que respondio el servidor, y que lo escrito no se perdio. Cualquier otro
 * error se traduce como el resto de la pantalla.
 */
export function traducirErrorDeBorrador(error: unknown): ErrorAtencion {
  if (error instanceof AkineHttpError && error.problemType === 'validation-error') {
    const contenido = error.erroresPorCampo['contenido'];
    if (contenido) {
      return {
        mensaje:
          `Las notas no se guardaron: ${contenido}. Lo que escribiste sigue en pantalla y no se ` +
          'perdio; revisalo y volvé a guardar.',
        causa: 'validacion',
        motivo: '',
      };
    }
  }
  return traducirErrorAtencion(error);
}

/**
 * `oferta-sin-precio` explicado: toda prestacion cerrada genera deuda (DP-17), y la de esta es el
 * precio particular, que la oferta no tiene cargado para ese dia. Lo que importa decir es que no
 * se perdio nada —la sesion sigue abierta— y cual es la salida: cargar el precio y volver a cerrar.
 */
function mensajeSinPrecio(error: AkineHttpError): string {
  const razon = RAZON_PRECIO_PARTICULAR[textoDeExtension(error, 'motivo')];
  const dia = fechaLegible(textoDeExtension(error, 'dia'));
  return (
    'No se pudo cerrar la atención: el paciente debe el precio particular' +
    (razon ? ` porque ${razon}` : '') +
    ', y la oferta no tiene un precio vigente' +
    (dia ? ` para el ${dia}` : ' para ese día') +
    '. La atención sigue abierta y no se perdio nada: carga el precio de la oferta y volvé a ' +
    'cerrarla.'
  );
}

/**
 * `medicion-fuera-de-rango` con el rango que el servidor mando. El rango se valida contra la version
 * vigente del catalogo en este momento: decirlo evita que el profesional crea que la medida vieja
 * quedo invalida.
 */
function mensajeFueraDeRango(error: AkineHttpError): ErrorAtencion {
  const minimo = error.numeroDeExtension('minimo');
  const maximo = error.numeroDeExtension('maximo');
  const rango =
    minimo !== null && maximo !== null
      ? ` El catalogo admite de ${minimo} a ${maximo}.`
      : minimo !== null
        ? ` El catalogo admite desde ${minimo}.`
        : maximo !== null
          ? ` El catalogo admite hasta ${maximo}.`
          : '';
  return {
    mensaje: `El valor esta fuera del rango de esa medida.${rango} Revisa la unidad y volvé a cargarlo.`,
    causa: 'fuera-de-rango',
    motivo: '',
    minimo,
    maximo,
  };
}

/** `2026-10-08` -> `08/10/2026`. Cualquier otra cosa se devuelve tal cual. */
function fechaLegible(iso: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return partes === null ? iso : `${partes[3]}/${partes[2]}/${partes[1]}`;
}

/**
 * Extension de texto, o cadena vacia.
 *
 * <p>`extension()` devuelve `unknown` a proposito: el contrato no tipa estas claves. Validar en
 * vez de confiar evita que un `motivo` numerico termine impreso como `[object Object]`.
 */
function textoDeExtension(error: AkineHttpError, clave: string): string {
  const valor = error.extension(clave);
  return typeof valor === 'string' ? valor : '';
}

/** El mensaje del backend, o el de respaldo si el cuerpo no traia `ProblemDetail`. */
function conDetalle(error: AkineHttpError, respaldo: string): string {
  return error.problem === null ? respaldo : error.mensaje;
}
