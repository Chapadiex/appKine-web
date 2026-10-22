import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';

import { ClinicalApi } from '../../services/clinical-api';
import { MedicionesDeSesion } from '../../components/mediciones-de-sesion/mediciones-de-sesion';
import { TratamientosDeSesion } from '../../components/tratamientos-de-sesion/tratamientos-de-sesion';
import { CasoAdministrativoResponse } from '../../../../api/generated/model/caso-administrativo-response';
import {
  ErrorAtencion,
  traducirErrorAtencion,
  traducirErrorDeBorrador,
} from '../../models/atencion-errors';
import {
  CerrarSesion,
  CerrarSesionAsistenciaEnum,
  CerrarSesionProximaConductaEnum,
  CerrarSesionToleranciaEnum,
} from '../../../../api/generated/model/cerrar-sesion';
import { GuardarEvaluacion } from '../../../../api/generated/model/guardar-evaluacion';
import {
  GuardarEvaluacionDolorLateralidadEnum,
  GuardarEvaluacionEvolucionEnum,
  GuardarEvaluacionModoEnum,
} from '../../../../api/generated/model/guardar-evaluacion';
import { Sesion } from '../../../../api/generated/model/sesion';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { PERMISO_SESION_REASSIGN } from '../../../../core/models/permisos';
import { ProfesionalElegible } from '../../services/clinical-api';
import {
  ASISTENCIAS,
  CONDUCTAS,
  ESCALA_EVA,
  EVOLUCIONES,
  LATERALIDADES,
  TOLERANCIAS,
  ZONAS_SUGERIDAS,
  comoEvolucion,
  comoLateralidad,
  comoModo,
  etiquetaDe,
  borradorDeNotas,
  instanteEnPalabras,
  notasDelBorrador,
  resumenDePrevia,
  rotuloDeCaso,
} from '../../models/etiquetas-de-atencion';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';

/** Milisegundos de quietud antes de que el autosave dispare. */
const ESPERA_AUTOSAVE = 1_500;

/**
 * Pantalla de atencion clinica (M14, AKINE-06.01 y 06.02).
 *
 * <p>Monta sobre el <b>turno</b> y no sobre la sesion, y esa es la primera decision: iniciar es
 * idempotente —si ya habia una atencion abierta devuelve esa—, asi que recargar la URL vuelve a
 * la misma atencion sin preguntar nada. La alternativa, redirigir a `/atencion/{sesionId}`, pedia
 * una segunda ruta y una segunda lectura para no ganar nada.
 *
 * <h2>1. El autosave no puede perder lo que el profesional escribio</h2>
 *
 * <p>Es el corazon del encargo. Toda escritura manda la `version` que se leyo. Un 409
 * `concurrent-modification` significa que otra pestaña del mismo profesional guardo antes.
 *
 * <p>Lo que esta pantalla <b>no</b> hace al recibir ese 409: no reintenta con la version del
 * servidor —eso es pisar en silencio lo que guardo la otra pestaña— y no releé para refrescar los
 * campos —eso es descartar lo que el profesional acaba de tipear—. Lo que hace es <b>frenar el
 * autosave</b>, decir que hubo conflicto y ofrecer releer. Al releer, lo del servidor se muestra
 * <b>al lado</b> en un panel de solo lectura y el editor queda intacto: el profesional ve las dos
 * versiones, se queda con lo que corresponde y vuelve a guardar con la version fresca.
 *
 * <p>Frenar el autosave es parte del arreglo: si siguiera corriendo, cada pulsacion produciria
 * otro 409 y el cartel de conflicto parpadearia sin que nada avance.
 *
 * <h2>2. La previa va al lado del campo de dolor</h2>
 *
 * <p>Y no en una seccion "sesiones anteriores". Es lo que hace que se cargue una evolucion real y
 * no la que se recuerda. Sin previa la pantalla lo dice: es la primera sesion, que es una
 * afirmacion clinica y no un espacio en blanco.
 *
 * <h2>3. Ningun campo clinico es obligatorio</h2>
 *
 * <p>"Seguimiento no exige examen completo". No hay una sola validacion de requerido en esta
 * pantalla: el backend no las tiene, y agregarlas obligaria a inventar datos clinicos para poder
 * guardar. Lo unico que se rechaza es lo que seria falso —dolor fuera de 0-10, lateralidad sin
 * zona—, y eso lo decide el servidor con un 400 que aca se traduce.
 *
 * <h2>4. RAPIDA y COMPLETA es cuanto se muestra, no que hace falta</h2>
 *
 * <p>El modo viaja al servidor como dato de la evaluacion, pero no condiciona ningun campo: un
 * profesional que empieza en rapida y necesita anotar una cosa mas cambia de modo en medio de la
 * atencion sin perder nada de lo cargado.
 *
 * <h2>5. El cierre pide dos campos, y no cinco (AKINE-06.05)</h2>
 *
 * <p>Obligatorios son <b>la asistencia</b> y, <b>solo si el paciente vino</b>, la nota de cierre.
 * Nada mas. Tolerancia, respuesta, indicaciones y proxima conducta se ofrecen y se rotulan como
 * opcionales: exigirlas obligaria a completar campos para poder cerrar una sesion que ya termino,
 * y lo que se completa por obligacion es exactamente lo que despues no se puede leer como dato
 * clinico. Con `AUSENTE` no se pide absolutamente nada mas: pedir el resultado de una atencion que
 * no ocurrio seria pedir que se invente.
 *
 * <p><b>Cerrar dos veces es el caso normal y la pantalla no lo estorba.</b> El backend es
 * idempotente —mismo `numeroSesion`, sin renumerar— asi que aca no hay ninguna guarda contra el
 * segundo click ni ninguna rama de error para "ya estaba cerrada". El unico bloqueo es el del
 * envio en vuelo, que es otra cosa.
 *
 * <p><b>Una sesion cerrada no se edita, y la pantalla lo hace cierto.</b> Al cerrar —o al recibir
 * un 409 `sesion-cerrada` porque la cerraron desde otra pestaña— los campos <b>desaparecen</b> y
 * queda una vista de solo lectura. Dejarlos editables seria ofrecer un guardado que el backend
 * rechaza siempre: el usuario escribe, aprieta y recibe un error por hacer lo que la pantalla le
 * mostraba como posible. Corregir una sesion cerrada es una enmienda (AKINE-06.06): tiene su
 * propia pantalla, con motivo obligatorio, y la de versiones muestra lo que cambio.
 *
 * <h2>6. Examen fisico y tratamientos (AKINE-06.03 y 06.04)</h2>
 *
 * <p>Son dos bloques propios ({@link MedicionesDeSesion}, {@link TratamientosDeSesion}). Las
 * mediciones no tocan la version de la sesion; los tratamientos si, y por eso la reciben de esta
 * pantalla y le devuelven la nueva: <b>hay una sola version</b>, la que tambien sostiene el
 * autosave. Un conflicto, un cierre o una atencion ajena detectados por un bloque se resuelven
 * aca, con el mismo panel que ya protege lo tipeado.
 *
 * <h2>7. El caso clinico se elige antes de iniciar, y se corrige con la atencion abierta (04.03)</h2>
 *
 * <p>Iniciar es idempotente y <b>la idempotencia manda sobre el caso</b>: `iniciar` solo toma el
 * `casoId` al crear la sesion. Por eso, si el paciente tiene casos activos, la pantalla pregunta
 * <b>antes</b> de iniciar —sugiriendo el de la misma oferta— y si no tiene ninguno inicia sola,
 * como siempre. Sin caso es una respuesta valida (RF-M14-002); exigirlo es RF-M10-007 y es una
 * decision pendiente.
 *
 * <p>Desde el contrato 0.102.0 el caso <b>se cambia mientras la atencion siga abierta</b>
 * (`cambiarCasoDeSesion`): asociar uno que no se eligio, cambiarlo o quitarlo. Es una escritura
 * mas sobre la misma version de la sesion, asi que el autosave la espera igual que espera a un
 * tratamiento. Cerrada, no: el cierre numera dentro del caso que la sesion tenga en ese momento.
 *
 * <p><b>El `numeroSesion` se muestra</b> porque es lo que el profesional cuenta: "la sesion numero
 * 8 de este paciente". Es un correlativo por historia clinica, no un id de base.
 *
 * <h2>Lo que esta pantalla NO tiene</h2>
 *
 * <p><b>Nada de plata.</b> Cerrar no cobra (DP-06): el cierre clinico no depende del pago y no
 * crea ninguna obligacion. Un importe en esta pantalla —aunque fuera informativo— sugeriria que
 * una atencion no se puede cerrar hasta que alguien pague, y ese es el ruido administrativo que
 * `plan_sesiones.txt` pide mantener fuera de la pantalla clinica. La deuda se mira en la cuenta
 * corriente del paciente.
 *
 * <p>Tampoco hay Historia Clinica: la sesion trae su `historiaClinicaId`, pero no hay ninguna
 * operacion HTTP que la lea.
 */
@Component({
  selector: 'app-atencion-page',
  imports: [Ayuda, RouterLink, MedicionesDeSesion, TratamientosDeSesion, ConfirmacionConMotivo],
  templateUrl: './atencion-page.html',
  styleUrl: '../../atencion.css',
})
export class AtencionPage {
  private readonly api = inject(ClinicalApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly permisos = inject(PermissionsStore);

  /**
   * De la ruta. `withComponentInputBinding` lo liga solo. Viene uno de los dos: `turnoId` en la
   * atencion de un turno, que se inicia al entrar, y `sesionId` en la de un participante de una
   * clase (AKINE-08.05), que ya se inicio desde el panel de la clase y aca solo se lee.
   */
  readonly turnoId = input<string>();
  readonly sesionId = input<string>();

  protected readonly escala = ESCALA_EVA;
  protected readonly evoluciones = EVOLUCIONES;
  protected readonly lateralidades = LATERALIDADES;
  protected readonly zonas = ZONAS_SUGERIDAS;
  protected readonly asistencias = ASISTENCIAS;
  protected readonly tolerancias = TOLERANCIAS;
  protected readonly conductas = CONDUCTAS;
  protected readonly instanteEnPalabras = instanteEnPalabras;
  protected readonly notasDelBorrador = notasDelBorrador;

  protected readonly sesion = signal<Sesion | null>(null);
  protected readonly abriendo = signal(false);
  protected readonly guardando = signal(false);
  protected readonly error = signal<ErrorAtencion | null>(null);
  protected readonly guardadoEn = signal('');

  /** Version que se leyo. Es lo que viaja en cada escritura, propia o de los tratamientos. */
  protected readonly version = signal(0);

  protected readonly consultorioId = this.tenantContext.consultorioId;
  protected readonly organizationId = this.tenantContext.organizationId;

  // --- Caso clinico (04.03) ---------------------------------------------------------------
  /** Casos activos del paciente. Vacio si no tiene, o si no se pudieron leer. */
  protected readonly casos = signal<readonly CasoAdministrativoResponse[]>([]);
  /** `true` mientras la pantalla pregunta a que caso asociar la atencion, antes de iniciarla. */
  protected readonly eligiendoCaso = signal(false);
  protected readonly casoElegido = signal<number | null>(null);
  /** La atencion ya existia con otro caso: la idempotencia manda sobre lo elegido. */
  protected readonly casoIgnorado = signal(false);
  /** Lo elegido en el selector de la atencion abierta. `null` es "sin caso". */
  protected readonly casoNuevo = signal<number | null>(null);
  /** `true` mientras el cambio de caso viaja con la version de la sesion. */
  protected readonly cambiandoCaso = signal(false);
  protected readonly avisoCaso = signal('');

  /**
   * `true` cuando la oferta exige caso clinico (RF-M10-007, DP-43): no se ofrece "Sin caso", porque
   * iniciar, quitarlo o cerrar presente sin el es 409 `caso-clinico-requerido`. Se lee de la oferta
   * al abrir la atencion y se fija tambien al recibir ese 409; la autoridad es el backend.
   */
  protected readonly requiereCaso = signal(false);
  private ofertaConsultada: number | null = null;
  /** Paciente del turno, para enlazar a su historia cuando hace falta abrir un caso. */
  protected readonly personaDelTurno = signal<number | null>(null);

  // --- Reemplazo del profesional (DP-43, U-24) -------------------------------------------
  /** Solo el `CONSULTORIO_ADMIN` lo tiene. Ocultar el boton es UX: el backend responde 403. */
  protected readonly puedeReasignar = computed(() => this.permisos.tiene(PERMISO_SESION_REASSIGN));
  protected readonly reemplazando = signal(false);
  protected readonly enviandoReemplazo = signal(false);
  protected readonly profesionales = signal<readonly ProfesionalElegible[]>([]);
  protected readonly profesionalNuevo = signal<number | null>(null);
  protected readonly avisoReemplazo = signal('');
  protected readonly reemplazoSinDestino = computed(
    () =>
      this.profesionalNuevo() === null || this.profesionalNuevo() === this.sesion()?.profesionalId,
  );

  /**
   * `true` si hay algo que elegir: casos activos, o un caso asociado que se puede quitar. Sin
   * ninguno de los dos el selector solo ofreceria "Sin caso", que es lo que ya hay.
   */
  protected readonly puedeCambiarCaso = computed(
    () => !this.esGrupal() && (this.casos().length > 0 || this.sesion()?.casoId !== undefined),
  );

  /**
   * `true` si la atencion es de un participante de una clase (AKINE-08.05). Su caso lo fijo la
   * derivacion y no se cambia —el backend responde 409 `caso-de-atencion-grupal`—, asi que el
   * selector de caso no se ofrece y la pantalla dice de que clase viene.
   */
  protected readonly esGrupal = computed(() => {
    const sesion = this.sesion();
    return sesion?.derivacionId !== undefined || sesion?.claseId !== undefined;
  });

  /** Panel de la clase de la que viene la atencion grupal, o `null`. */
  protected readonly rutaDeLaClase = computed(() => {
    const claseId = this.sesion()?.claseId;
    return claseId === undefined ? null : `/atencion/clases/${claseId}`;
  });

  /** El caso asociado cuando ya no esta entre los activos (se cerro despues de asociarlo). */
  protected readonly casoActualFueraDeLista = computed(() => {
    const casoId = this.sesion()?.casoId;
    return casoId !== undefined && !this.casos().some((caso) => caso.id === casoId) ? casoId : null;
  });

  protected readonly casoSinCambios = computed(
    () => this.casoNuevo() === (this.sesion()?.casoId ?? null),
  );

  /** `true` mientras un tratamiento se escribe con la version de la sesion. */
  protected readonly tratamientoEnVuelo = signal(false);

  // --- Lo que el profesional escribio. Ninguno se pisa nunca desde el servidor. ------------
  protected readonly modo = signal<GuardarEvaluacionModoEnum>(GuardarEvaluacionModoEnum.RAPIDA);
  protected readonly dolorEva = signal<number | null>(null);
  protected readonly dolorZona = signal('');
  protected readonly dolorLateralidad = signal<GuardarEvaluacionDolorLateralidadEnum | null>(null);
  protected readonly evolucion = signal<GuardarEvaluacionEvolucionEnum | null>(null);
  protected readonly objetivoSesion = signal('');
  protected readonly motivoClinico = signal('');
  protected readonly limitacionFuncional = signal('');
  protected readonly notas = signal('');

  /**
   * Lo que guardo la otra pestaña, mostrado al lado sin tocar el editor.
   *
   * <p>Solo se llena al resolver un conflicto. Es la unica forma honesta de "recargar" sin
   * descartar lo tipeado.
   */
  protected readonly notasDelServidor = signal<string | null>(null);

  // --- Cierre de la atencion (AKINE-06.05) ------------------------------------------------
  protected readonly asistencia = signal<CerrarSesionAsistenciaEnum | null>(null);
  protected readonly notaDeCierre = signal('');
  protected readonly indicaciones = signal('');
  protected readonly respuestaTratamiento = signal('');
  protected readonly tolerancia = signal<CerrarSesionToleranciaEnum | null>(null);
  protected readonly proximaConducta = signal<CerrarSesionProximaConductaEnum | null>(null);
  protected readonly cerrando = signal(false);

  /**
   * Por que el cierre no salio, cuando el motivo es de esta pantalla y no del servidor.
   *
   * <p>Es el unico requerido que se valida aca, y se valida para poder senalar el campo exacto en
   * vez de gastar un 400 para decir algo que ya se sabe. La autoridad sigue siendo el backend.
   */
  protected readonly avisoCierre = signal<string | null>(null);

  /**
   * `true` cuando la atencion ya se cerro.
   *
   * <p>Se decide por `numeroSesion` y no por una bandera propia: el contrato dice que el
   * correlativo esta <b>ausente mientras la sesion siga abierta</b> y que es lo que la marca como
   * cerrada. Derivarlo del dato del servidor —y no de "aprete cerrar hace un rato"— hace que la
   * pantalla tambien entre en modo lectura cuando la cerraron desde otra pestaña.
   */
  protected readonly cerrada = computed(() => this.sesion()?.numeroSesion !== undefined);

  protected readonly presente = computed(
    () => this.asistencia() === CerrarSesionAsistenciaEnum.PRESENTE,
  );

  /**
   * `true` cuando el paciente vino y todavia no hay nota.
   *
   * <p>Es el unico campo condicionalmente obligatorio del cierre: el backend la exige con el
   * paciente presente aunque haya tratamientos estructurados (AKINE-06.04), porque es el resumen
   * de lo que se hizo. Con `AUSENTE` no aplica, y por eso se calcula contra {@link presente}.
   */
  protected readonly faltaNota = computed(
    () => this.presente() && this.notaDeCierre().trim() === '',
  );

  /** Lo que los bloques de examen y tratamientos necesitan: sede y sesion, o nada. */
  protected readonly bloques = computed(() => {
    const consultorioId = this.consultorioId();
    const sesion = this.sesion();
    return consultorioId === null || sesion?.id === undefined
      ? null
      : { consultorioId, sesionId: sesion.id, ofertaId: sesion.ofertaId };
  });

  protected readonly completa = computed(() => this.modo() === GuardarEvaluacionModoEnum.COMPLETA);
  protected readonly previa = computed(() => resumenDePrevia(this.sesion()?.previa));
  protected readonly hayPrevia = computed(() => this.sesion()?.previa !== undefined);
  protected readonly hayConflicto = computed(() => this.error()?.causa === 'version-vieja');

  /**
   * `true` cuando hay lateralidad y no hay zona.
   *
   * <p><b>No bloquea el guardado</b>: es un aviso, porque la regla es del backend —400
   * `validation-error`— y duplicarla como validacion de formulario la dejaria divergir. Lo que
   * hace es que el profesional entienda el rechazo antes de recibirlo.
   */
  protected readonly faltaZona = computed(
    () => this.dolorLateralidad() !== null && this.dolorZona().trim() === '',
  );

  private temporizador: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      // Depende de la ruta y del contexto: cambiar de sede invalida el turno, que es de la
      // sede anterior.
      this.turnoId();
      this.sesionId();
      this.tenantContext.contextEpoch();
      untracked(() => this.abrir());
    });

    this.destroyRef.onDestroy(() => this.cancelarAutosave());
  }

  // -------------------------------------------------------------------------------------
  // Apertura
  // -------------------------------------------------------------------------------------

  /**
   * Abre la atencion del turno.
   *
   * <p>Es un POST y se dispara solo al entrar, que en cualquier otra pantalla seria un error.
   * Aca es correcto: la operacion es idempotente por contrato y abrir dos veces es el caso
   * normal —un doble click, una recarga, volver desde otra pestaña—. La pantalla no pregunta ni
   * distingue, que es justamente lo que el backend se propuso evitarle.
   */
  protected abrir(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const sesionId = this.numeroDeSesion();
    const turnoId = this.numeroDeTurno();
    if (consultorioId === null) {
      return;
    }
    if (sesionId !== null) {
      this.limpiarApertura();
      this.abrirSesion(consultorioId, sesionId);
      return;
    }
    if (turnoId === null) {
      return;
    }

    this.limpiarApertura();
    this.api.casosDelTurno(consultorioId, turnoId).subscribe(({ ofertaId, personaId, casos }) => {
      this.casos.set(casos);
      this.personaDelTurno.set(personaId ?? null);
      if (casos.length === 0) {
        this.iniciar();
        return;
      }
      // Se sugiere el caso de la misma oferta solo si es uno: con dos, elegir por el profesional
      // seria adivinar de cual de los dos tratamientos es esta sesion.
      const deLaOferta = casos.filter((caso) => caso.ofertaId === ofertaId);
      this.casoElegido.set(deLaOferta.length === 1 ? (deLaOferta[0].id ?? null) : null);
      this.abriendo.set(false);
      this.eligiendoCaso.set(true);
    });
  }

  /**
   * Abre por su id una atencion que ya existe (AKINE-08.05): la de un participante de una clase.
   * La inicio el panel de la clase, que es donde se elige la derivacion —y con ella el caso—, asi
   * que aca no hay nada que iniciar ni que preguntar.
   */
  private abrirSesion(consultorioId: number, sesionId: number): void {
    this.api.ver(consultorioId, sesionId).subscribe({
      next: (sesion) => {
        this.abriendo.set(false);
        this.adoptar(sesion);
      },
      error: (error: unknown) => {
        this.abriendo.set(false);
        this.sesion.set(null);
        this.error.set(traducirErrorAtencion(error));
      },
    });
  }

  /** Deja la pantalla como recien entrada: nada de la atencion anterior queda a la vista. */
  private limpiarApertura(): void {
    this.cancelarAutosave();
    this.abriendo.set(true);
    this.error.set(null);
    this.notasDelServidor.set(null);
    this.avisoCierre.set(null);
    // El cierre arranca vacio en cada apertura. Arrastrar la asistencia de la atencion anterior
    // -otro turno, otro paciente- seria proponer un hecho clinico que nadie afirmo.
    this.asistencia.set(null);
    this.notaDeCierre.set('');
    this.indicaciones.set('');
    this.respuestaTratamiento.set('');
    this.tolerancia.set(null);
    this.proximaConducta.set(null);
    this.casos.set([]);
    this.eligiendoCaso.set(false);
    this.casoElegido.set(null);
    this.casoIgnorado.set(false);
    this.avisoCaso.set('');
    this.requiereCaso.set(false);
    this.ofertaConsultada = null;
    this.personaDelTurno.set(null);
    this.reemplazando.set(false);
    this.avisoReemplazo.set('');
  }

  protected elegirCaso(valor: string): void {
    const id = Number(valor);
    this.casoElegido.set(Number.isFinite(id) && id > 0 ? id : null);
  }

  /**
   * Inicia (o retoma) la atencion, con el caso elegido si hay uno.
   *
   * <p>Si la sesion ya existia vuelve con el caso que tenia: se avisa, para que nadie crea que la
   * asocio al que eligio.
   */
  protected iniciar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const turnoId = this.numeroDeTurno();
    if (consultorioId === null || turnoId === null) {
      return;
    }
    const casoId = this.eligiendoCaso() ? (this.casoElegido() ?? undefined) : undefined;
    this.eligiendoCaso.set(false);
    this.abriendo.set(true);
    this.error.set(null);

    this.api.iniciar(consultorioId, turnoId, casoId).subscribe({
      next: (sesion) => {
        this.abriendo.set(false);
        this.casoIgnorado.set(casoId !== undefined && sesion.casoId !== casoId);
        this.adoptar(sesion);
      },
      error: (error: unknown) => {
        this.abriendo.set(false);
        this.sesion.set(null);
        const traducido = traducirErrorAtencion(error);
        this.error.set(traducido);
        // Un caso que se cerro mientras se elegia: se vuelve a preguntar en vez de dejar la
        // pantalla sin salida.
        if (traducido.causa === 'caso-no-activo') {
          this.eligiendoCaso.set(true);
        }
        // La oferta exige caso (DP-43): con casos activos se vuelve a preguntar, ya sin "Sin caso";
        // sin ninguno, el mensaje enlaza a la historia para abrir uno.
        if (traducido.causa === 'caso-requerido') {
          this.requiereCaso.set(true);
          if (this.casos().length > 0) {
            this.eligiendoCaso.set(true);
          }
        }
      },
    });
  }

  /** "Caso 2", o vacio si la atencion no tiene caso. */
  protected numeroDeCaso(casoId: number | undefined): string {
    if (casoId === undefined) {
      return '';
    }
    const numero = this.casos().find((caso) => caso.id === casoId)?.numeroCaso;
    return numero === undefined ? 'Caso clínico asociado' : `Caso ${numero}`;
  }

  protected readonly rotuloDeCaso = rotuloDeCaso;

  protected elegirCasoNuevo(valor: string): void {
    const id = Number(valor);
    this.casoNuevo.set(valor !== '' && Number.isFinite(id) && id > 0 ? id : null);
    this.avisoCaso.set('');
  }

  /**
   * Asocia, cambia o quita el caso de la atencion abierta.
   *
   * <p>La respuesta es la sesion entera y se toma <b>solo su version y sus metadatos</b>: el editor
   * sigue siendo del profesional. No marca "Ultimo guardado", que es de las notas y no se mandaron. Un caso que se cerro mientras
   * se elegia es 409 `caso-clinico-cerrado` y va al mismo cartel que cualquier otro problema.
   */
  protected cambiarCaso(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const sesionId = this.sesion()?.id;
    if (consultorioId === null || sesionId === undefined || this.casoSinCambios()) {
      return;
    }
    const casoId = this.casoNuevo();
    this.cambiandoCaso.set(true);
    this.error.set(null);
    this.avisoCaso.set('');

    this.api.cambiarCaso(consultorioId, sesionId, casoId, this.version()).subscribe({
      next: (sesion) => {
        this.cambiandoCaso.set(false);
        this.casoIgnorado.set(false);
        this.sesion.set(sesion);
        this.version.set(sesion.version ?? 0);
        this.casoNuevo.set(sesion.casoId ?? null);
        this.avisoCaso.set(
          sesion.casoId === undefined
            ? 'La atención quedo sin caso.'
            : `La atención quedo asociada al ${this.numeroDeCaso(sesion.casoId)}.`,
        );
      },
      error: (error: unknown) => {
        this.cambiandoCaso.set(false);
        this.casoNuevo.set(this.sesion()?.casoId ?? null);
        this.fallo(error);
      },
    });
  }

  // -------------------------------------------------------------------------------------
  // Bloques de examen y tratamientos
  // -------------------------------------------------------------------------------------

  /** Un tratamiento hizo avanzar la version de la sesion: es la que viaja de aca en adelante. */
  protected adoptarVersion(version: number): void {
    this.version.set(version);
  }

  /** Un bloque encontro un conflicto, un cierre o una atencion ajena: se resuelve aca. */
  protected problemaDeBloque(error: unknown): void {
    this.fallo(error);
  }

  /**
   * Toma la sesion del servidor como estado inicial del editor.
   *
   * <p>Solo se llama en la apertura. Despues de eso el editor es del profesional y ninguna
   * respuesta lo pisa: para eso esta {@link adoptarSoloVersion}.
   */
  /** Lee una sola vez por oferta si exige caso. Silencioso: si falla, decide el backend. */
  private consultarSiRequiereCaso(sesion: Sesion): void {
    const consultorioId = this.tenantContext.consultorioId();
    const ofertaId = sesion.ofertaId;
    if (
      consultorioId === null ||
      ofertaId === undefined ||
      sesion.claseId !== undefined ||
      this.ofertaConsultada === ofertaId
    ) {
      return;
    }
    this.ofertaConsultada = ofertaId;
    this.api
      .requiereCasoClinico(consultorioId, ofertaId)
      .subscribe((requiere) => this.requiereCaso.update((antes) => antes || requiere));
  }

  // -------------------------------------------------------------------------------------
  // Reemplazo del profesional (DP-43, U-24)
  // -------------------------------------------------------------------------------------

  protected abrirReemplazo(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const organizationId = this.tenantContext.organizationId();
    if (consultorioId === null || organizationId === null) {
      return;
    }
    this.reemplazando.set(true);
    this.avisoReemplazo.set('');
    this.profesionalNuevo.set(null);
    this.api
      .profesionalesParaReemplazo(organizationId, consultorioId, this.sesion()?.ofertaId)
      .subscribe((profesionales) => this.profesionales.set(profesionales));
  }

  protected cancelarReemplazo(): void {
    this.reemplazando.set(false);
  }

  protected elegirProfesional(valor: string): void {
    const id = Number(valor);
    this.profesionalNuevo.set(Number.isFinite(id) && id > 0 ? id : null);
  }

  /** Manda el reemplazo con la version leida. El motivo lo valida `ConfirmacionConMotivo`. */
  protected reemplazar(motivo: string): void {
    const consultorioId = this.tenantContext.consultorioId();
    const sesionId = this.sesion()?.id;
    const profesionalId = this.profesionalNuevo();
    if (
      consultorioId === null ||
      sesionId === undefined ||
      profesionalId === null ||
      this.reemplazoSinDestino()
    ) {
      return;
    }
    this.enviandoReemplazo.set(true);
    this.error.set(null);
    this.api
      .reemplazarProfesional(consultorioId, sesionId, {
        profesionalId,
        motivo,
        version: this.version(),
      })
      .subscribe({
        next: (sesion) => {
          this.enviandoReemplazo.set(false);
          this.reemplazando.set(false);
          this.sesion.set(sesion);
          this.version.set(sesion.version ?? 0);
          const nombre = this.nombreDelProfesional(sesion.profesionalId);
          this.avisoReemplazo.set(
            'La atención ahora la continua ' +
              nombre +
              '. Desde acá solo ese profesional puede guardarla; el anterior va a ver que la ' +
              'atención es de otro profesional.',
          );
        },
        error: (error: unknown) => {
          this.enviandoReemplazo.set(false);
          this.fallo(error);
        },
      });
  }

  protected nombreDelProfesional(membershipId: number | undefined): string {
    if (membershipId === undefined) {
      return 'Sin registrar';
    }
    return (
      this.profesionales().find((p) => p.membershipId === membershipId)?.nombre ??
      'Profesional #' + membershipId
    );
  }

  private adoptar(sesion: Sesion): void {
    this.sesion.set(sesion);
    this.consultarSiRequiereCaso(sesion);
    this.version.set(sesion.version ?? 0);
    this.casoNuevo.set(sesion.casoId ?? null);
    this.notas.set(notasDelBorrador(sesion.borrador));

    const evaluacion = sesion.evaluacion;
    this.modo.set(comoModo(evaluacion?.modo));
    this.dolorEva.set(evaluacion?.dolorEva ?? null);
    this.dolorZona.set(evaluacion?.dolorZona ?? '');
    this.dolorLateralidad.set(comoLateralidad(evaluacion?.dolorLateralidad));
    this.evolucion.set(comoEvolucion(evaluacion?.evolucion));
    this.objetivoSesion.set(evaluacion?.objetivoSesion ?? '');
    this.motivoClinico.set(evaluacion?.motivoClinico ?? '');
    this.limitacionFuncional.set(evaluacion?.limitacionFuncional ?? '');
  }

  /**
   * Toma de la respuesta la version y los metadatos, y <b>nada mas</b>.
   *
   * <p>Es lo que se usa despues de cada guardado exitoso. Copiar tambien el contenido dejaria al
   * profesional mirando como el cursor salta mientras escribe: entre que salio el request y volvio
   * la respuesta ya tipeo otras palabras, y esas son las buenas.
   */
  private adoptarSoloVersion(sesion: Sesion): void {
    this.sesion.set(sesion);
    this.version.set(sesion.version ?? 0);
    this.guardadoEn.set(instanteEnPalabras(new Date().toISOString()));
  }

  // -------------------------------------------------------------------------------------
  // Autosave del contenido libre
  // -------------------------------------------------------------------------------------

  /**
   * Registra lo tipeado y programa el autosave.
   *
   * <p>Con un conflicto abierto <b>no se programa nada</b>: el texto se guarda igual en el estado
   * de la pantalla —no se pierde—, pero mandarlo produciria otro 409 y el cartel parpadearia sin
   * que nada avance. El autosave vuelve cuando el conflicto se resuelve.
   */
  protected escribirNotas(texto: string): void {
    this.notas.set(texto);
    if (this.hayConflicto()) {
      return;
    }
    this.programarAutosave();
  }

  /**
   * Programa el autosave. Si al vencer la espera hay un tratamiento o un cambio de caso
   * escribiendose, espera otra vuelta: los dos mandan la misma version y el segundo comeria un 409
   * que nadie provoco.
   */
  private programarAutosave(): void {
    this.cancelarAutosave();
    this.temporizador = setTimeout(() => {
      this.temporizador = null;
      if (this.tratamientoEnVuelo() || this.cambiandoCaso()) {
        this.programarAutosave();
        return;
      }
      this.guardarBorrador();
    }, ESPERA_AUTOSAVE);
  }

  /** Guarda el contenido libre ya mismo. Es el boton, y tambien el final de la espera. */
  protected guardarBorrador(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const sesionId = this.sesion()?.id;
    if (consultorioId === null || sesionId === undefined) {
      return;
    }

    this.cancelarAutosave();
    this.guardando.set(true);
    this.error.set(null);

    this.api
      .guardarBorrador(consultorioId, sesionId, borradorDeNotas(this.notas()), this.version())
      .subscribe({
        next: (sesion) => {
          this.guardando.set(false);
          this.adoptarSoloVersion(sesion);
        },
        error: (error: unknown) => this.fallo(error, traducirErrorDeBorrador),
      });
  }

  // -------------------------------------------------------------------------------------
  // Evaluacion tipada
  // -------------------------------------------------------------------------------------

  /**
   * Guarda la evaluacion base.
   *
   * <p>Los campos vacios <b>no viajan</b>. Mandar `''` guardaria una cadena vacia como si fuera un
   * dato cargado, y "no lo cargue" tiene que seguir siendo distinguible de "lo cargue vacio"
   * —que es el mismo motivo por el que `NO_APLICA` existe—.
   */
  protected guardarEvaluacion(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const sesionId = this.sesion()?.id;
    if (consultorioId === null || sesionId === undefined) {
      return;
    }

    this.cancelarAutosave();
    this.guardando.set(true);
    this.error.set(null);

    const cuerpo: GuardarEvaluacion = {
      version: this.version(),
      modo: this.modo(),
      dolorEva: this.dolorEva() ?? undefined,
      dolorZona: textoOAusente(this.dolorZona()),
      dolorLateralidad: this.dolorLateralidad() ?? undefined,
      evolucion: this.evolucion() ?? undefined,
      objetivoSesion: textoOAusente(this.objetivoSesion()),
      motivoClinico: textoOAusente(this.motivoClinico()),
      limitacionFuncional: textoOAusente(this.limitacionFuncional()),
    };

    this.api.evaluar(consultorioId, sesionId, cuerpo).subscribe({
      next: (sesion) => {
        this.guardando.set(false);
        this.adoptarSoloVersion(sesion);
      },
      error: (error: unknown) => this.fallo(error),
    });
  }

  // -------------------------------------------------------------------------------------
  // Cierre de la atencion (AKINE-06.05)
  // -------------------------------------------------------------------------------------

  /** Rotulo visible de lo que quedo registrado en el cierre. Vacio si el campo no se cargo. */
  protected etiquetaDeTolerancia(valor: string | undefined): string {
    return etiquetaDe(TOLERANCIAS, valor);
  }

  protected etiquetaDeConducta(valor: string | undefined): string {
    return etiquetaDe(CONDUCTAS, valor);
  }

  protected etiquetaDeAsistencia(valor: string | undefined): string {
    return etiquetaDe(ASISTENCIAS, valor);
  }

  protected elegirAsistencia(valor: string): void {
    this.asistencia.set(
      valor === CerrarSesionAsistenciaEnum.AUSENTE
        ? CerrarSesionAsistenciaEnum.AUSENTE
        : CerrarSesionAsistenciaEnum.PRESENTE,
    );
    this.avisoCierre.set(null);
  }

  protected elegirTolerancia(valor: string): void {
    this.tolerancia.set(TOLERANCIAS.find((opcion) => opcion.valor === valor)?.valor ?? null);
  }

  protected elegirConducta(valor: string): void {
    this.proximaConducta.set(CONDUCTAS.find((opcion) => opcion.valor === valor)?.valor ?? null);
  }

  /**
   * Cierra la atencion.
   *
   * <p>Solo se frena por lo que el contrato declara obligatorio: la asistencia siempre, y la nota
   * cuando el paciente vino. Todo lo demas viaja si esta y se omite si no —{@link textoOAusente}
   * otra vez—, porque una cadena vacia guardada es indistinguible de un campo cargado en blanco.
   *
   * <p><b>No hay ninguna guarda contra cerrar dos veces</b>: el backend es idempotente y devuelve
   * el mismo `numeroSesion`, asi que un segundo cierre no es un error que la pantalla tenga que
   * interceptar. Lo unico que se bloquea es el envio mientras hay uno en vuelo.
   */
  protected cerrar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const sesionId = this.sesion()?.id;
    const asistencia = this.asistencia();
    if (consultorioId === null || sesionId === undefined) {
      return;
    }

    if (asistencia === null) {
      this.avisoCierre.set(
        'Falta decir si el paciente vino. Sin eso no se sabe si hubo prestación, y es lo unico ' +
          'que el cierre siempre necesita.',
      );
      return;
    }

    if (this.faltaNota()) {
      this.avisoCierre.set(
        'El paciente vino, así que hace falta la nota de cierre: es lo unico que registra que se ' +
          'hizo en la sesión.',
      );
      return;
    }

    const cuerpo: CerrarSesion = {
      version: this.version(),
      asistencia,
      notaDeCierre: textoOAusente(this.notaDeCierre()),
      indicaciones: textoOAusente(this.indicaciones()),
      respuestaTratamiento: textoOAusente(this.respuestaTratamiento()),
      tolerancia: this.tolerancia() ?? undefined,
      proximaConducta: this.proximaConducta() ?? undefined,
    };

    this.cancelarAutosave();
    this.cerrando.set(true);
    this.avisoCierre.set(null);
    this.error.set(null);

    this.api.cerrar(consultorioId, sesionId, cuerpo).subscribe({
      next: (sesion) => {
        this.cerrando.set(false);
        this.adoptarCerrada(sesion);
      },
      error: (error: unknown) => {
        this.cerrando.set(false);
        this.fallo(error);
      },
    });
  }

  /**
   * Pasa la pantalla a modo lectura con lo que devolvio el servidor.
   *
   * <p>Aca si se adopta la respuesta entera —a diferencia de {@link adoptarSoloVersion}— y es
   * correcto: una sesion cerrada no admite mas escritura, asi que no hay nada tipeado que
   * proteger. Lo que la respuesta trae es justamente lo que hay que mostrar: el `numeroSesion`, el
   * cierre y el momento.
   */
  private adoptarCerrada(sesion: Sesion): void {
    this.cancelarAutosave();
    this.sesion.set(sesion);
    this.version.set(sesion.version ?? 0);
    this.notasDelServidor.set(null);
  }

  // -------------------------------------------------------------------------------------
  // Conflicto de version
  // -------------------------------------------------------------------------------------

  /**
   * Resuelve el conflicto releyendo la sesion, <b>sin tocar el editor</b>.
   *
   * <p>Trae la version fresca —que es lo que destraba el proximo guardado— y deja lo que guardo
   * la otra pestaña en un panel aparte. Lo tipeado sigue donde estaba: quien decide con que
   * quedarse es el profesional, no la pantalla.
   */
  protected releerParaComparar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const sesionId = this.sesion()?.id;
    if (consultorioId === null || sesionId === undefined) {
      return;
    }

    this.guardando.set(true);
    this.api.ver(consultorioId, sesionId).subscribe({
      next: (sesion) => {
        this.guardando.set(false);
        this.version.set(sesion.version ?? 0);
        this.notasDelServidor.set(notasDelBorrador(sesion.borrador));
        this.sesion.set({ ...sesion, borrador: this.sesion()?.borrador });
        this.error.set(null);
      },
      error: (error: unknown) => this.fallo(error),
    });
  }

  /** Cierra el panel de comparacion una vez que el profesional decidio. */
  protected descartarComparacion(): void {
    this.notasDelServidor.set(null);
  }

  // -------------------------------------------------------------------------------------
  // Campos
  // -------------------------------------------------------------------------------------

  /** El mismo valor de dolor apretado dos veces lo borra: cargarlo no puede ser irreversible. */
  protected elegirDolor(valor: number): void {
    this.dolorEva.set(this.dolorEva() === valor ? null : valor);
  }

  /** Igual que el dolor: volver a apretar el chip elegido lo deja sin cargar. */
  protected elegirEvolucion(valor: GuardarEvaluacionEvolucionEnum): void {
    this.evolucion.set(this.evolucion() === valor ? null : valor);
  }

  protected elegirLateralidad(valor: string): void {
    this.dolorLateralidad.set(comoLateralidad(valor));
  }

  protected cambiarModo(completa: boolean): void {
    this.modo.set(completa ? GuardarEvaluacionModoEnum.COMPLETA : GuardarEvaluacionModoEnum.RAPIDA);
  }

  // -------------------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------------------

  /**
   * Traduce el error y, si la atencion resulto estar cerrada, pasa a modo lectura.
   *
   * <p>El 409 `sesion-cerrada` llega cuando la cerraron desde otra pestaña: no es un conflicto que
   * se resuelva reintentando, porque no hay ninguna version con la que el guardado vaya a pasar.
   * Se relee para que la pantalla muestre lo que efectivamente quedo registrado —con su
   * `numeroSesion`— en vez de dejar campos que ya no admiten nada. El cartel del error se
   * mantiene: el modo lectura solo se explica si se dice por que aparecio.
   *
   * <p>Si la relectura falla no se toca nada. Quedarse con el cartel y la pantalla como estaba es
   * peor que nada, pero es honesto; borrarla seria afirmar un estado que no se pudo confirmar.
   */
  private fallo(
    error: unknown,
    traducir: (error: unknown) => ErrorAtencion = traducirErrorAtencion,
  ): void {
    this.guardando.set(false);
    this.cancelarAutosave();
    const traducido = traducir(error);
    this.error.set(traducido);
    if (traducido.causa === 'caso-requerido') {
      this.requiereCaso.set(true);
    }

    if (traducido.causa !== 'sesion-cerrada') {
      return;
    }

    const consultorioId = this.tenantContext.consultorioId();
    const sesionId = this.sesion()?.id;
    if (consultorioId === null || sesionId === undefined) {
      return;
    }

    this.api.ver(consultorioId, sesionId).subscribe({
      next: (sesion) => this.adoptarCerrada(sesion),
      error: () => undefined,
    });
  }

  private cancelarAutosave(): void {
    if (this.temporizador !== null) {
      clearTimeout(this.temporizador);
      this.temporizador = null;
    }
  }

  private numeroDeTurno(): number | null {
    return idPositivo(this.turnoId());
  }

  private numeroDeSesion(): number | null {
    return idPositivo(this.sesionId());
  }
}

/** El id de la ruta, o `null` si falta o no es un entero positivo. */
function idPositivo(valor: string | undefined): number | null {
  const id = Number(valor);
  return valor !== undefined && Number.isInteger(id) && id > 0 ? id : null;
}

/** Texto recortado, o `undefined` para que la clave no viaje. */
function textoOAusente(valor: string): string | undefined {
  const limpio = valor.trim();
  return limpio === '' ? undefined : limpio;
}
