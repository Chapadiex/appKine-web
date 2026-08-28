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
