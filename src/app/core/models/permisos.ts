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
/**
 * Editar los datos de la organizacion (`updateOrganization`, contrato 0.143.0), del `ORG_ADMIN`.
 * Hoy ninguna pantalla edita la organizacion: la constante queda para gatearla cuando exista.
 */
export const PERMISO_TENANT_UPDATE = 'tenant:update';
export const PERMISO_CONSULTORIO_MANAGE = 'consultorio:manage';
export const PERMISO_COLABORADOR_MANAGE = 'colaborador:manage';
export const PERMISO_COLABORADOR_READ = 'colaborador:read';
export const PERMISO_AUDITORIA_READ = 'auditoria:read';
export const PERMISO_AUDITORIA_READ_CLINICA = 'auditoria:read-clinica';

/**
 * Gestionar paciente (F3, etapa AKINE-03.01).
 *
 * <p>Gobierna las MUTACIONES del padron: dar de alta una persona, editarla y activarle el perfil
 * clinico. La lectura es {@link PERMISO_PACIENTE_READ}.
 *
 * <p>Esta fuera de {@link PERMISOS_F1} a proposito: esa lista es la de la Fase 1 y este codigo es
 * de F3. Que no este ahi no cambia nada para la directiva `*akinePermiso`, que recibe un string
 * cualquiera; la lista es documental.
 */
export const PERMISO_PACIENTE_MANAGE = 'paciente:manage';

/**
 * Consultar el padron de personas (DU-6 / DP-22, contrato 0.80.0).
 *
 * <p>Hasta DP-22 la lectura del padron se autorizaba por pertenencia, y una membership con rol
 * `PACIENTE` leia el padron entero de su organizacion. Ahora toda lectura de personas exige
 * `paciente:read`: el staff lo tiene y el paciente no. En el frontend es UX —esconde la seccion
 * y los enlaces a la ficha—; el backend rechaza igual a quien llegue por URL.
 */
export const PERMISO_PACIENTE_READ = 'paciente:read';

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
  PERMISO_TENANT_UPDATE,
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
 * La lectura es {@link PERMISO_CONVENIO_READ}.
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
 * Consultar financiadores, planes, convenios, aranceles y el arancel efectivo (DP-36 / U-07,
 * contrato 0.130.0).
 *
 * <p>Repite DP-22 en `contracting`: hasta DP-36 la lectura de la configuracion economica se
 * autorizaba por pertenencia y un `PACIENTE` la leia entera. Ahora la tiene el personal
 * —`ORG_ADMIN` en la organizacion; `CONSULTORIO_ADMIN`, `PROFESIONAL` y `ADMINISTRATIVO` en la
 * sede— y se evalua con la sede del contexto. No es otorgable por grant.
 */
export const PERMISO_CONVENIO_READ = 'convenio:read';

/**
 * Consultar el catalogo clinico, sus vigencias, los tipos de medicion y los pedidos de alta
 * (DP-36 / U-08, contrato 0.130.0).
 *
 * <p>Reemplaza la autorizacion interina por pertenencia: un `PACIENTE` recibe 403. Lo tiene el
 * personal de la sede y la plataforma (alcance GLOBAL, que igual no ve conceptos de un tenant).
 */
export const PERMISO_CATALOGO_READ = 'catalogo:read';

/**
 * Dar de alta, editar y dar de baja conceptos del catalogo clinico y sus vigencias, y pedir altas
 * a la plataforma (DP-36 / U-08). Reemplaza al `consultorio:manage` interino; lo tienen
 * `ORG_ADMIN`, `CONSULTORIO_ADMIN` y la plataforma.
 */
export const PERMISO_CATALOGO_MANAGE = 'catalogo:manage';

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

/**
 * Operar la caja diaria de la sede (F7, etapa AKINE-07.03, M20).
 *
 * <p>Gobierna abrir y cerrar la jornada, registrar y revertir movimientos manuales y consultar la
 * operatoria. El contrato no declara un `caja:read` aparte: quien arquea es quien mira.
 *
 * <p><b>Es de la sede, no de la organizacion.</b> La caja es un cajon fisico en un mostrador:
 * cada consultorio tiene la suya y el backend evalua el permiso contra `{consultorioId}`.
 */
export const PERMISO_CAJA_OPERATE = 'caja:operate';

/**
 * Ver reportes de la sede (F8, M23, AKINE-07.06; repartido por DP-15 / G-1).
 *
 * <p>Abre la pantalla; <b>no</b> decide que se ve adentro. Cada seccion del reporte pide ademas el
 * permiso de su fuente, y la que falta llega declarada en `omitidas`. Al `PROFESIONAL` el backend
 * se lo da con alcance de actividad propia y lo avisa con una advertencia.
 */
export const PERMISO_REPORTE_READ = 'reporte:read';

/**
 * Lectura de la Historia Clinica (M09, AKINE-04.01).
 *
 * <p>Solo decide si se OFRECE el enlace a la historia. No alcanza para leerla: sin relacion
 * asistencial el backend pide ademas un motivo declarado (DP-03), y eso lo resuelve la pantalla de
 * la historia. Por eso no se usa en un `permissionGuard`.
 */
export const PERMISO_HC_READ = 'hc:read';

/**
 * Escritura en la Historia Clinica (M09). Solo decide si se OFRECE derivar a un participante de una
 * clase a un Caso (AKINE-08.04): el contrato exige ademas `inscripcion:read` —que ya pide la ruta
 * del panel— y, sin relacion asistencial, un motivo declarado, que resuelve la pantalla.
 */
export const PERMISO_HC_WRITE = 'hc:write';

/**
 * Registrar atenciones clinicas (M14). Solo decide si se OFRECE el enlace a la atencion clinica de
 * una clase (AKINE-08.05): escribir en una atencion es ademas de quien la lleva, y eso lo decide el
 * backend (409 `sesion-ajena`).
 */
export const PERMISO_SESION_REGISTER = 'sesion:register';

/**
 * Enmendar una sesion cerrada (DP-43, U-25). Base del `PROFESIONAL` en su sede, no otorgable; la
 * propiedad sigue mandando: enmendar la ajena es 409 `sesion-ajena`, no 403.
 */
export const PERMISO_SESION_AMEND = 'sesion:amend';

/**
 * Reemplazar al profesional de una atencion abierta (DP-43, U-24). Base <b>solo</b> del
 * `CONSULTORIO_ADMIN`, no otorgable. No habilita a escribir en la atencion ajena.
 */
export const PERMISO_SESION_REASSIGN = 'sesion:reassign';

/**
 * Clases grupales (M28, AKINE-08.01). `clase:read` mira la grilla y los cupos —que no nombran a
 * nadie—; `clase:manage` programa, reprograma y cancela. Son codigos propios y no `turno:*`
 * (decision pendiente 9 del backend): una clase no es N turnos.
 */
export const PERMISO_CLASE_READ = 'clase:read';
export const PERMISO_CLASE_MANAGE = 'clase:manage';

/**
 * Inscripciones a clases (M28, AKINE-08.02). <b>`inscripcion:read` no es `clase:read`</b>: la lista
 * de participantes es la unica respuesta de M28 que lleva nombre y documento. `inscripcion:manage`
 * inscribe, confirma y da de baja.
 */
export const PERMISO_INSCRIPCION_READ = 'inscripcion:read';
export const PERMISO_INSCRIPCION_MANAGE = 'inscripcion:manage';

/**
 * Asistencia de clases (F9, AKINE-08.03). Copiados de `activity.domain.PermissionCodes`.
 *
 * <p>Tres codigos y no uno, porque el backend los separa: tomar lista es `asistencia:manage`, ver
 * quien esta anotado es `inscripcion:read` —que no es `clase:read`: quien mira la grilla del dia
 * no necesita saber quien esta inscripto— e iniciar o cerrar la clase es `clase:manage`.
 */
export const PERMISO_ASISTENCIA_MANAGE = 'asistencia:manage';

/**
 * Productos de pack y pases (F9, M29, AKINE-08.06). Copiados de `activity.domain.PermissionCodes`.
 *
 * <p>La matriz §32 no tiene fila de productos ni de pases; el backend tomo las mas cercanas:
 * `producto:manage` como `convenio:manage` (ORG_ADMIN y CONSULTORIO_ADMIN), `pase:manage` como
 * `cobro:register` (tambien ADMINISTRATIVO). <b>El PROFESIONAL no tiene ninguno</b>: el precio y el
 * saldo son datos comerciales. El consumo de un credito no tiene permiso propio: lo dispara tomar
 * lista, que pide `asistencia:manage`.
 */
export const PERMISO_PRODUCTO_READ = 'producto:read';
export const PERMISO_PRODUCTO_MANAGE = 'producto:manage';
export const PERMISO_PASE_READ = 'pase:read';
export const PERMISO_PASE_MANAGE = 'pase:manage';
/**
 * Ajustar el saldo de un pase o anularlo (AKINE-08.07). Reforzado: ORG_ADMIN y CONSULTORIO_ADMIN,
 * no el mostrador (el ADMINISTRATIVO vende pero no corrige saldos).
 */
export const PERMISO_PASE_ADJUST = 'pase:adjust';
