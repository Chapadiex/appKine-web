/**
 * Catalogo de permisos granulares de AKINE — Fase 1.
 *
 * <p>Copia literal de los codigos marcados **F1** en
 * `appKine-api/docs/seguridad/matriz-permisos-minima.md` (seccion 5), que a su vez sale de
 * la seccion 32 de `AKINE_Requerimientos_Integrados.md`. La matriz es el documento
 * vinculante: <b>los nombres se copian, no se inventan</b>. Un codigo mal escrito no falla
 * en ningun lado — simplemente esconde para siempre el boton que deberia mostrar.
 *
 * <p>Estos son <b>identificadores</b>, no reglas: aca no vive ninguna decision sobre quien
 * tiene que permiso. Esa evaluacion es del backend (rol base + grants de la membership,
 * acotado por alcance y por habilitacion vigente), y lo que el frontend recibe por
 * `GET /me/permissions` es el resultado ya calculado para el contexto activo.
 *
 * <p>Vive en `core/models` y no en `shared/`: `shared/` no puede saber de dominio, y por
 * eso la directiva `*akinePermiso` recibe un string cualquiera y nunca importa este
 * archivo. Lo importan las pantallas de `features/`, que si saben que estan pidiendo.
 *
 * <p>Los permisos de fases posteriores (`hc:read`, `sesion:register`, `cobro:register`…)
 * se agregan cuando su etapa los implemente: declararlos antes solo genera constantes que
 * el backend nunca va a emitir.
 */
export const PERMISO_TENANT_MANAGE = 'tenant:manage';
export const PERMISO_TENANT_READ = 'tenant:read';
export const PERMISO_CONSULTORIO_MANAGE = 'consultorio:manage';
export const PERMISO_COLABORADOR_MANAGE = 'colaborador:manage';
export const PERMISO_COLABORADOR_READ = 'colaborador:read';
export const PERMISO_AUDITORIA_READ = 'auditoria:read';
export const PERMISO_AUDITORIA_READ_CLINICA = 'auditoria:read-clinica';

/**
 * Gestionar paciente (F3, etapa AKINE-03.01).
 *
 * <p>Gobierna las MUTACIONES del padron: dar de alta una persona, editarla y activarle el perfil
 * clinico. <b>No hay permiso de lectura</b>: consultar el padron se autoriza por pertenencia, y
 * por eso ninguna pantalla pregunta por un `paciente:read` que la matriz no declara.
 *
 * <p>Esta fuera de {@link PERMISOS_F1} a proposito: esa lista es la de la Fase 1 y este codigo es
 * de F3. Que no este ahi no cambia nada para la directiva `*akinePermiso`, que recibe un string
 * cualquiera; la lista es documental.
 */
export const PERMISO_PACIENTE_MANAGE = 'paciente:manage';

/**
 * Permisos que el frontend conoce hoy.
 *
 * <p>El backend puede devolver codigos que no esten aca -de una fase posterior, o de un
 * grant nuevo- y eso <b>no es un error</b>: el store guarda el `Set` tal cual lo recibe y
 * lo desconocido simplemente no lo pregunta nadie. Esta lista es para que las pantallas se
 * escriban con constantes, no para validar la respuesta.
 */
export const PERMISOS_F1 = [
  PERMISO_TENANT_MANAGE,
  PERMISO_TENANT_READ,
  PERMISO_CONSULTORIO_MANAGE,
  PERMISO_COLABORADOR_MANAGE,
  PERMISO_COLABORADOR_READ,
  PERMISO_AUDITORIA_READ,
  PERMISO_AUDITORIA_READ_CLINICA,
] as const;

/** Union de los permisos conocidos. No restringe lo que el store puede almacenar. */
export type PermisoF1 = (typeof PERMISOS_F1)[number];

/**
 * Administrar financiadores, planes, convenios y aranceles (F3, etapas AKINE-03.03 y 03.05).
 *
 * <p>Gobierna las MUTACIONES de la configuracion economica: el catalogo de financiadores y sus
 * planes —que son de la ORGANIZACION— y los convenios y aranceles —que son de la SEDE—.
 * <b>No hay permiso de lectura</b>: consultar el catalogo se autoriza por pertenencia, y por eso
 * ninguna pantalla pregunta por un `convenio:read` que la matriz no declara.
 *
 * <p><b>Se evalua siempre con una sede, aunque el financiador no sea de ninguna.</b> Es la misma
 * asimetria que `paciente:manage` y `cobro:register`: la ficha vive en la organizacion, pero
 * quien la administra lo hace parado en un mostrador, y sin sede el evaluador deja afuera al
 * `CONSULTORIO_ADMIN` —que es el rol al que 03.03 le dio la asignacion base junto con
 * `ORG_ADMIN`—. Consecuencia para las pantallas: exigen contexto completo, no solo organizacion.
 *
 * <p><b>Y para los convenios la sede que manda es la de la RUTA, no la del contexto.</b> El
 * backend evalua sobre `{consultorioId}` para que nadie con el permiso en la sede A toque los
 * convenios de la B. Como las pantallas arman la URL con la sede del contexto, las dos coinciden
 * siempre; la distincion importa el dia que alguien agregue un selector de sede.
 */
export const PERMISO_CONVENIO_MANAGE = 'convenio:manage';

/**
 * Consultar la agenda (F5, etapa AKINE-05.01).
 *
 * <p>Gobierna la LECTURA de slots de una oferta. Es de la sede del contexto: la agenda es de un
 * consultorio, no de la organizacion.
 */
export const PERMISO_TURNO_READ = 'turno:read';

/**
 * Reservar y confirmar turnos (F5, etapa AKINE-05.02).
 *
 * <p>Gobierna las MUTACIONES de la agenda. <b>No hay cancelar ni reprogramar</b>: AKINE-05.03
 * quedo fuera de alcance por DP-10 y esos endpoints no existen todavia.
 */
export const PERMISO_TURNO_MANAGE = 'turno:manage';

/**
 * Cuenta corriente y cobros (F7, etapa AKINE-07.01).
 *
 * <p>Gobierna la lectura de la deuda de un paciente <b>y</b> su anulacion. No hay un
 * `obligacion:read` aparte: el contrato autoriza las dos con el mismo codigo, y declarar uno que
 * el backend nunca emite solo esconderia la pantalla para todos.
 *
 * <p><b>Se evalua con la sede del contexto aunque la deuda sea de la organizacion.</b> Es la misma
 * asimetria que `paciente:manage`: la deuda de un paciente es una sola aunque se haya generado en
 * dos sedes, pero quien la mira lo hace parado en un mostrador.
 */
export const PERMISO_COBRO_REGISTER = 'cobro:register';
