import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Motivo por el que fallo una operacion sobre el padron de personas (M07, AKINE-03.01).
 *
 * <p>Se ramifica por `problemType` y <b>nunca</b> por el texto de `detail`, por lo mismo que en
 * espacios, catalogo y ofertas: `detail` es prosa y cambia cuando alguien corrige una redaccion.
 *
 * <h2>Los dos rechazos del alta son distintos y la pantalla los trata distinto</h2>
 *
 * <p>Es la unica parte de este archivo que no se parece a la de las otras features, y es la razon
 * por la que existe:
 *
 * <ul>
 *   <li><b>`persona-documento-taken`</b> es un invariante DURO. Ya hay alguien vigente con ese
 *       documento en la organizacion. No se puede confirmar ni saltear, y el remedio del operador
 *       es abrir la ficha que ya existe — por eso el error viaja con `personaExistenteId` cuando
 *       el backend lo pudo determinar.</li>
 *   <li><b>`persona-posible-duplicado`</b> es una ADVERTENCIA. Coincide el nombre completo o el
 *       telefono. Viene con `candidatos`, y el operador decide: abre una de esas fichas, o
 *       reenvia el alta declarando que es otra persona. <b>Es RN-M07-001 hecho cumplir por el
 *       backend</b>, no por el formulario.</li>
 * </ul>
 *
 * <p>Meterlos a los dos en un `conflicto` generico seria perder exactamente lo que los hace
 * utiles: en el primero hay una ficha concreta que abrir, y en el segundo hay una decision que el
 * operador puede tomar sin salir de la pantalla.
 *
 * <h2>El 409 de concurrencia llega como `concurrent-modification` (DP-21)</h2>
 *
 * <p>Desde el contrato 0.80.0 toda version vieja responde `concurrent-modification` en todos los
 * modulos, y `conflict` queda solo para conflictos de negocio: cae en `conflicto`, con el
 * `detail` del servidor.
 */
export type CausaPersona =
  /** 403 missing-tenant-context: hay sesion, pero no hay contexto de trabajo. NUNCA cerrar sesion. */
  | 'sin-contexto'
  /** 403 forbidden: falta `paciente:manage`. Leer el padron si se puede. */
  | 'sin-permiso'
  /** 400 validation-error. El backend nombra el campo. */
  | 'validacion'
  /** 404: no existe, o es de otra organizacion. Los dos responden igual a proposito. */
  | 'no-encontrado'
  /** 409 persona-documento-taken. Invariante duro: ver `personaExistenteId`. */
  | 'documento-en-uso'
  /** 409 persona-posible-duplicado. Advertencia confirmable: ver `candidatos`. */
  | 'posible-duplicado'
  /** 409 persona-inactiva: la ficha esta dada de baja y no admite la operacion. */
  | 'persona-inactiva'
  /**
   * 409 persona-sin-perfil-paciente: la ficha existe y no es paciente.
   *
   * <p>Es RF-M07-010 sostenido desde M08 y M17, y <b>el mismo `type` que ya declaraba 05.02</b>:
   * cargarle una cobertura, una orden o una autorizacion a alguien que no es paciente no significa
   * nada. La salida siempre es la misma —activarle el perfil— y por eso la pantalla la ofrece en
   * vez de dejar el conflicto como un callejon.
   */
  | 'sin-perfil-paciente'
  /**
   * 400 archivo-no-aceptado: el tipo real o el tamano del archivo.
   *
   * <p>Los dos motivos —`TIPO_NO_PERMITIDO` y `DEMASIADO_GRANDE`— llevan al mismo desenlace
   * —elegir otro archivo— pero a mensajes distintos, y por eso el motivo viaja en la extension y
   * no se adivina del `detail`.
   */
  | 'archivo-no-aceptado'
  /** 409 adjunto-inactivo: el adjunto esta dado de baja. Se descarga igual; no se modifica. */
  | 'adjunto-inactivo'
  /**
   * 409 adjunto-no-disponible: la metadata existe y el almacenamiento perdio el binario.
   *
   * <p>Es 409 y no 404 a proposito: la fila existe y quien pregunta la esta viendo en la lista.
   * Un 404 le diria al operador que el documento nunca existio, que es falso y lo llevaria a
   * subirlo de nuevo pensando que se equivoco.
   */
  | 'adjunto-no-disponible'
  /**
   * 409 plan-no-seleccionable: ese plan no se podia elegir el dia en que la cobertura empieza.
   *
   * <p><b>Las cinco causas responden igual</b> —no existe, es de otro tenant, esta dado de baja,
   * su financiador esta dado de baja, o la fecha cae fuera de su vigencia— para no convertir el
   * alta en un oraculo del catalogo ajeno. La pantalla no puede desambiguarlas y no lo intenta.
   */
  | 'plan-no-seleccionable'
  /** 409 cobertura-superpuesta: ya hay una del mismo plan pisando ese periodo. */
  | 'cobertura-superpuesta'
  /**
   * 409 cobertura-principal-superpuesta: ya hay una principal vigente en ese periodo.
   *
   * <p>Viaja con `coberturaPrincipalId`, y sin ese id el error seria inutil: marcar principal no
   * desmarca a la otra en silencio —un click que cambia dos coberturas deja una que despues nadie
   * puede explicar— asi que lo unico accionable es senalar cual es la que hay que finalizar o
   * desmarcar primero.
   */
  | 'cobertura-principal-superpuesta'
  /** 409 cobertura-inactiva: dada de baja, no se edita ni se marca principal. */
  | 'cobertura-inactiva'
  /** 409 cobertura-already-inactive: ya estaba dada de baja. El estado buscado ya esta. */
  | 'cobertura-ya-inactiva'
  /** 409 orden-inactiva: la orden esta dada de baja. Una VENCIDA si se edita. */
  | 'orden-inactiva'
  /** 409 orden-already-inactive: ya estaba dada de baja. */
  | 'orden-ya-inactiva'
  /** 409 autorizacion-inactiva: dada de baja. Rechazada y vencida son otra cosa. */
  | 'autorizacion-inactiva'
  /** 409 autorizacion-already-inactive: ya estaba dada de baja. */
  | 'autorizacion-ya-inactiva'
  /** 409 autorizacion-superpuesta: dos aprobadas de la misma practica contarian dos veces. */
  | 'autorizacion-superpuesta'
  /**
   * 409 autorizacion-transicion-no-permitida: APROBADA y RECHAZADA son terminales.
   *
   * <p>Viaja con `estadoActual` y `accion`. Es tambien la respuesta a la aprobacion concurrente:
   * el segundo en llegar encuentra la autorizacion ya resuelta y recibe esto, no un 200 que
   * aprueba dos veces.
   */
  | 'transicion-no-permitida'
  /** 409 documento-numero-taken: ya hay una orden o autorizacion vigente con ese numero. */
  | 'numero-en-uso'
  /** 409 concurrent-modification: la `expectedVersion` enviada quedo vieja (DP-21). */
  | 'concurrencia'
  /** 409 subscription-suspended: lo emite el filtro, antes del controller. */
  | 'suscripcion-suspendida'
  /** Cualquier otro 409. Gana el `detail` del backend. */
  | 'conflicto'
  /** 429: hay que esperar. Ver `segundosDeEspera`. */
  | 'limite'
  /** El request nunca llego: sin red, CORS o servidor caido. */
  | 'red'
  | 'otro';

/** Error ya traducido a algo mostrable. */
export interface ErrorPersona {
  readonly mensaje: string;
  readonly causa: CausaPersona;
  /** Segundos a esperar antes de reintentar. 0 fuera de `limite`. */
  readonly segundosDeEspera: number;
  /**
   * Ids que coinciden con el alta rechazada. Vacio fuera de `posible-duplicado`.
   *
   * <p>Sin esto el 409 seria un callejon: el operador sabe que "hay alguien parecido" y no puede
   * verlo, asi que tendria que salir de la pantalla y buscar a mano.
   */
  readonly candidatos: readonly number[];
  /** Ficha que ya tiene ese documento, o `null`. Solo en `documento-en-uso`. */
  readonly personaExistenteId: number | null;
  /**
   * Fila que provoco el rechazo, cuando el backend la pudo nombrar.
   *
   * <p>Es la cobertura que ya es principal, la cobertura del mismo plan que se pisa, o la
   * autorizacion aprobada que se solapa. <b>Un solo campo para las tres</b> y no tres opcionales:
   * ningun rechazo trae dos a la vez, y la pantalla lo unico que hace con el id es resaltar esa
   * fila para que el operador la vea sin buscarla.
   */
  readonly referenciaId: number | null;
  /**
   * Por que se rechazo el archivo. `null` fuera de `archivo-no-aceptado`.
   *
   * <p>Sale de la extension y no del `detail`: "elegi otro formato" y "elegi un archivo mas chico"
   * son dos instrucciones distintas, y ramificar por prosa las hace depender de que nadie corrija
   * una redaccion del backend.
   */
  readonly motivoDelArchivo: MotivoDeRechazoDeArchivo | null;
}

/** Los dos motivos por los que el backend rechaza un archivo. Son los del contrato. */
export type MotivoDeRechazoDeArchivo = 'TIPO_NO_PERMITIDO' | 'DEMASIADO_GRANDE';

const MENSAJE_GENERICO = 'No pudimos completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa tu conexion y volve a intentar.';
const MENSAJE_LIMITE_SIN_PLAZO =
  'Demasiados intentos. Espera un momento antes de volver a intentar.';

/**
 * `403` por falta de contexto.
 *
 * <p>Dice explicitamente que la sesion sigue abierta, porque el reflejo del usuario ante un
 * rechazo es pensar que se deslogueo. El padron es de la organizacion, pero <b>dar de alta o
 * editar exige ademas tener una sede elegida</b>: el permiso se evalua con la sede del contexto.
 */
const MENSAJE_SIN_CONTEXTO =
  'Para trabajar con el padron hay que saber en que centro estas. Eligi una organizacion y un ' +
  'consultorio, y volve a entrar. Tu sesion sigue abierta.';

const MENSAJE_SIN_PERMISO =
  'No podes dar de alta ni editar personas: hace falta el permiso de gestion de pacientes. ' +
  'Pediselo a quien administra el centro. Consultar el padron si podes, y por eso el listado se ' +
  'sigue viendo.';

const MENSAJE_NO_ENCONTRADO =
  'Esa persona ya no existe, o no es de esta organizacion. Recarga el listado para ver el padron ' +
  'actual.';

/**
 * Documento repetido: el invariante duro.
 *
 * <p>No ofrece ninguna salida que no sea mirar la ficha que ya existe, porque no la hay: dos
 * personas con el mismo documento en la misma organizacion son un error de carga, siempre.
 */
const MENSAJE_DOCUMENTO_EN_USO =
  'Ya hay una persona registrada con ese documento en esta organizacion. Buscala en el padron ' +
  'antes de crear una ficha nueva: si es la misma persona, editala en vez de duplicarla.';

/**
 * Posible duplicado: la advertencia.
 *
 * <p>Tiene que decir las tres cosas: que <b>no se creo nada</b>, que hay fichas parecidas para
 * mirar, y que si de verdad es otra persona se puede confirmar y seguir. Sin la tercera, el
 * operador con dos pacientes homonimos queda trabado.
 */
const MENSAJE_POSIBLE_DUPLICADO =
  'No creamos la ficha todavia: hay personas registradas que coinciden en el nombre completo o en ' +
  'el telefono. Revisalas abajo. Si es una de ellas, abrila; si es otra persona distinta, ' +
  'confirmalo y la damos de alta.';

const MENSAJE_PERSONA_INACTIVA =
  'Esa persona esta dada de baja, asi que no admite cambios. Su ficha se sigue pudiendo ' +
  'consultar: los historicos no se borran.';

const MENSAJE_CONCURRENCIA =
  'Alguien mas modifico esta ficha mientras la estabas editando, asi que no guardamos tus cambios ' +
  'para no pisar los suyos. Volvimos a leer los datos actuales: revisalos y confirma de nuevo si ' +
  'seguis queriendo el cambio.';

const MENSAJE_SUSCRIPCION_SUSPENDIDA =
  'La suscripcion de la organizacion esta suspendida, asi que no se pueden registrar cambios. Se ' +
  'resuelve desde la pantalla de suscripcion.';

const MENSAJE_CONFLICTO =
  'El servidor rechazo el cambio por un conflicto con lo que ya hay guardado. Recarga el listado ' +
  'para ver el estado actual y volve a intentar.';

/**
 * La persona existe y no es paciente.
 *
 * <p>Dice la salida concreta —activar el perfil— porque sin eso el operador lee "no se pudo" sobre
 * una ficha que ve en pantalla y no tiene forma de deducir que le falta un paso que existe.
 */
const MENSAJE_SIN_PERFIL =
  'Esta persona todavia no es paciente, asi que no se le puede cargar esto. Activale el perfil de ' +
  'paciente desde su ficha y volve a intentar. Activarlo no le crea historia clinica.';

const MENSAJE_ARCHIVO_TIPO =
  'Ese archivo no se puede subir: solo se aceptan PDF, PNG y JPEG. El tipo se verifica por el ' +
  'contenido y no por la extension, asi que renombrarlo no cambia nada. Volve a exportarlo o ' +
  'escanealo en uno de esos formatos.';

const MENSAJE_ARCHIVO_TAMANO =
  'Ese archivo pesa mas de lo que se admite. Escanealo con menos resolucion, o subilo partido en ' +
  'varios documentos.';

const MENSAJE_ADJUNTO_INACTIVO =
  'Ese documento esta dado de baja, asi que no se puede modificar. Se sigue pudiendo descargar: ' +
  'los documentos dados de baja no se borran. Si necesitas otra version, subi el archivo nuevo.';

/**
 * La metadata existe y el binario no.
 *
 * <p>Dice explicitamente que el registro sigue estando, porque el reflejo ante "no se pudo
 * descargar" es volver a subirlo, y eso deja dos filas para el mismo documento.
 */
const MENSAJE_ADJUNTO_NO_DISPONIBLE =
  'El registro de ese documento existe, pero su contenido no esta disponible en el almacenamiento. ' +
  'No lo vuelvas a subir sobre esta fila: avisale a quien administra el sistema, y si tenes el ' +
  'archivo original cargalo como documento nuevo.';

/**
 * Plan que no se puede elegir. <b>No dice cual de las cinco causas es</b>, y no puede.
 *
 * <p>Distinguir "no existe" de "es de otra organizacion" convertiria el alta en una forma de medir
 * el catalogo ajeno probando ids. Lo que si dice es contra que fecha se evaluo, que es el unico
 * dato que el operador puede corregir por su cuenta.
 */
const MENSAJE_PLAN_NO_SELECCIONABLE =
  'Ese plan no se puede elegir para la fecha en que la cobertura empieza a valer. Puede estar dado ' +
  'de baja, tener otra vigencia, o pertenecer a un financiador dado de baja. Revisa la fecha de ' +
  'inicio y el plan en el catalogo de financiadores.';

const MENSAJE_COBERTURA_SUPERPUESTA =
  'El paciente ya tiene una cobertura de ese mismo plan vigente en ese periodo, y dos que se pisan ' +
  'son un duplicado. Si cambio de plan, finaliza la vigencia de la anterior y despues carga la ' +
  'nueva. Dos coberturas de financiadores distintos si pueden convivir.';

const MENSAJE_PRINCIPAL_SUPERPUESTA =
  'El paciente ya tiene una cobertura principal vigente en ese periodo. No la desmarcamos solas: un ' +
  'click que cambia dos coberturas deja una que despues nadie puede explicar. Desmarca o finaliza ' +
  'la que esta marcada y volve a intentar.';

const MENSAJE_COBERTURA_INACTIVA =
  'Esa cobertura esta dada de baja, asi que no admite cambios. Se sigue leyendo, porque es lo que ' +
  'explica con que cobertura se atendio al paciente antes. Si la cobertura vuelve, es un alta nueva.';

const MENSAJE_COBERTURA_YA_INACTIVA =
  'Esa cobertura ya estaba dada de baja. No hicimos nada: el estado que buscabas ya es el que hay.';

const MENSAJE_ORDEN_INACTIVA =
  'Esa orden esta dada de baja, asi que no admite cambios. Ojo que dada de baja no es lo mismo que ' +
  'vencida: una orden vencida se sigue listando y se sigue pudiendo corregir.';

const MENSAJE_ORDEN_YA_INACTIVA =
  'Esa orden ya estaba dada de baja. No hicimos nada: el estado que buscabas ya es el que hay.';

const MENSAJE_AUTORIZACION_INACTIVA =
  'Esa autorizacion esta dada de baja, asi que no admite cambios. Dar de baja no es rechazar ni ' +
  'vencer: una rechazada sigue viva y explica por que no se pudo atender.';

const MENSAJE_AUTORIZACION_YA_INACTIVA =
  'Esa autorizacion ya estaba dada de baja. No hicimos nada: el estado que buscabas ya es el que hay.';

const MENSAJE_AUTORIZACION_SUPERPUESTA =
  'El paciente ya tiene una autorizacion aprobada de esa practica vigente en ese periodo, y dos que ' +
  'se pisan contarian el saldo dos veces. Dos consecutivas —renovar— si conviven: revisa las fechas.';

const MENSAJE_NUMERO_EN_USO =
  'Ya hay un documento vigente con ese numero. Revisa si no lo cargaste antes: el numero de uno ' +
  'dado de baja si se puede volver a usar.';

/**
 * Traduce cualquier error de la pantalla del padron.
 *
 * <p><b>No recibe un `ambito`</b>, a diferencia del traductor de `offering`: aca todas las
 * operaciones son sobre lo mismo —una persona— y un 403 significa siempre lo mismo. Partirlo en
 * dos habria sido una simetria vacia.
 */
export function traducirErrorPersona(error: unknown): ErrorPersona {
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
          ? `Demasiados intentos. Espera ${segundos} segundos y volve a intentar.`
          : MENSAJE_LIMITE_SIN_PLAZO,
        'limite',
      ),
      segundosDeEspera: segundos,
    };
  }

  switch (error.problemType) {
    case 'missing-tenant-context':
      return base(MENSAJE_SIN_CONTEXTO, 'sin-contexto');
    case 'subscription-suspended':
      return base(MENSAJE_SUSCRIPCION_SUSPENDIDA, 'suscripcion-suspendida');
    case 'persona-documento-taken':
      return {
        ...base(MENSAJE_DOCUMENTO_EN_USO, 'documento-en-uso'),
        personaExistenteId: error.numeroDeExtension('personaExistenteId'),
      };
    case 'persona-posible-duplicado':
      return { ...base(MENSAJE_POSIBLE_DUPLICADO, 'posible-duplicado'), candidatos: idsDe(error) };
    case 'persona-inactiva':
      return base(MENSAJE_PERSONA_INACTIVA, 'persona-inactiva');
    case 'persona-sin-perfil-paciente':
      return base(MENSAJE_SIN_PERFIL, 'sin-perfil-paciente');
    case 'archivo-no-aceptado': {
      const motivo = motivoDelArchivo(error);
      return {
        ...base(
          motivo === 'DEMASIADO_GRANDE' ? MENSAJE_ARCHIVO_TAMANO : MENSAJE_ARCHIVO_TIPO,
          'archivo-no-aceptado',
        ),
        motivoDelArchivo: motivo,
      };
    }
    case 'adjunto-inactivo':
      return base(MENSAJE_ADJUNTO_INACTIVO, 'adjunto-inactivo');
    case 'adjunto-no-disponible':
      return base(MENSAJE_ADJUNTO_NO_DISPONIBLE, 'adjunto-no-disponible');
    case 'plan-no-seleccionable':
      return base(MENSAJE_PLAN_NO_SELECCIONABLE, 'plan-no-seleccionable');
    case 'cobertura-superpuesta':
      return {
        ...base(MENSAJE_COBERTURA_SUPERPUESTA, 'cobertura-superpuesta'),
        referenciaId: error.numeroDeExtension('coberturaExistenteId'),
      };
    case 'cobertura-principal-superpuesta':
      return {
        ...base(MENSAJE_PRINCIPAL_SUPERPUESTA, 'cobertura-principal-superpuesta'),
        referenciaId: error.numeroDeExtension('coberturaPrincipalId'),
      };
    case 'cobertura-inactiva':
      return base(MENSAJE_COBERTURA_INACTIVA, 'cobertura-inactiva');
    case 'cobertura-already-inactive':
      return base(MENSAJE_COBERTURA_YA_INACTIVA, 'cobertura-ya-inactiva');
    case 'orden-inactiva':
      return base(MENSAJE_ORDEN_INACTIVA, 'orden-inactiva');
    case 'orden-already-inactive':
      return base(MENSAJE_ORDEN_YA_INACTIVA, 'orden-ya-inactiva');
    case 'autorizacion-inactiva':
      return base(MENSAJE_AUTORIZACION_INACTIVA, 'autorizacion-inactiva');
    case 'autorizacion-already-inactive':
      return base(MENSAJE_AUTORIZACION_YA_INACTIVA, 'autorizacion-ya-inactiva');
    case 'autorizacion-superpuesta':
      return {
        ...base(MENSAJE_AUTORIZACION_SUPERPUESTA, 'autorizacion-superpuesta'),
        referenciaId: error.numeroDeExtension('autorizacionExistenteId'),
      };
    case 'autorizacion-transicion-no-permitida':
      // Gana el `detail` del backend: nombra el estado actual y la accion pedida, que es
      // exactamente lo que hace entendible el rechazo, y redactarlo aca seria repetir en
      // castellano una tabla de transiciones que vive del otro lado.
      return base(conDetalle(error, MENSAJE_CONFLICTO), 'transicion-no-permitida');
    case 'documento-numero-taken':
      return base(MENSAJE_NUMERO_EN_USO, 'numero-en-uso');
    case 'concurrent-modification':
      return base(MENSAJE_CONCURRENCIA, 'concurrencia');
    default:
      break;
  }

  if (error.status === 403) {
    return base(MENSAJE_SIN_PERMISO, 'sin-permiso');
  }

  if (error.status === 404) {
    // Inexistente y de otra organizacion responden igual: distinguirlos permitiria medir el
    // padron ajeno probando ids, que es el dato mas sensible despues de la historia clinica.
    return base(MENSAJE_NO_ENCONTRADO, 'no-encontrado');
  }

  if (error.status === 409) {
    return base(conDetalle(error, MENSAJE_CONFLICTO), 'conflicto');
  }

  if (error.status === 400) {
    return base(conDetalle(error, MENSAJE_GENERICO), 'validacion');
  }

  return base(conDetalle(error, MENSAJE_GENERICO), 'otro');
}

/**
 * `true` cuando lo unico que resuelve el error es releer el listado.
 *
 * <p>Las tres bajas idempotentes entran aca y no en el grupo generico: "ya estaba dado de baja" no
 * es una falla que convenga reintentar —el estado buscado ya es el que hay— y lo que le falta al
 * operador es ver la fila como quedo. Ofrecerle "reintentar" lo mandaria a repetir una operacion
 * que va a volver a responder lo mismo.
 */
export function hayQueRecargar(causa: CausaPersona | null): boolean {
  return (
    causa === 'no-encontrado' ||
    causa === 'conflicto' ||
    causa === 'concurrencia' ||
    causa === 'cobertura-ya-inactiva' ||
    causa === 'orden-ya-inactiva' ||
    causa === 'autorizacion-ya-inactiva' ||
    causa === 'transicion-no-permitida'
  );
}

function base(mensaje: string, causa: CausaPersona): ErrorPersona {
  return {
    mensaje,
    causa,
    segundosDeEspera: 0,
    candidatos: [],
    personaExistenteId: null,
    referenciaId: null,
    motivoDelArchivo: null,
  };
}

/**
 * El motivo del rechazo del archivo, validado contra los dos valores del contrato.
 *
 * <p>Se valida en vez de castear: un `motivo` desconocido —porque el backend agrego uno tercero—
 * tiene que caer en el mensaje de tipo no permitido, que es el mas frecuente, y no producir una
 * rama que nadie escribio.
 */
function motivoDelArchivo(error: AkineHttpError): MotivoDeRechazoDeArchivo | null {
  const crudo = error.extension('motivo');
  return crudo === 'DEMASIADO_GRANDE' || crudo === 'TIPO_NO_PERMITIDO' ? crudo : null;
}

/**
 * Los ids de `candidatos`, filtrando lo que no sea un numero.
 *
 * <p>Sale de `extension()`, que ya busca la clave <b>en la raiz y bajo `properties`</b>: Spring
 * serializa las extensiones de `setProperty(...)` como claves de primer nivel y el contrato las
 * declara anidadas, asi que hay que mirar las dos. Escribir el acceso a mano aca habria
 * funcionado con la forma de hoy y roto con la del contrato.
 *
 * <p>`extension()` devuelve `unknown` a proposito, asi que esto <b>valida en vez de confiar</b>:
 * un `candidatos` con un `null` adentro convertiria el listado de coincidencias en un
 * `GET /personas/null`.
 */
function idsDe(error: AkineHttpError): readonly number[] {
  const crudo = error.extension('candidatos');
  if (!Array.isArray(crudo)) {
    return [];
  }
  return crudo.filter(
    (valor): valor is number => typeof valor === 'number' && Number.isFinite(valor),
  );
}

/** El mensaje del backend, o el de respaldo si el cuerpo no traia `ProblemDetail`. */
function conDetalle(error: AkineHttpError, respaldo: string): string {
  return error.problem === null ? respaldo : error.mensaje;
}

/** Espera declarada en `Retry-After`, o `0`. Sin header no se inventa un numero. */
function segundosDeEspera(error: AkineHttpError): number {
  const segundos = error.reintentarEnSegundos;
  if (segundos === null || !Number.isFinite(segundos) || segundos <= 0) {
    return 0;
  }
  return Math.ceil(segundos);
}
