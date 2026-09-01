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

import { ClinicalApi } from '../../services/clinical-api';
import { ErrorAtencion, traducirErrorAtencion } from '../../models/atencion-errors';
import { GuardarEvaluacion } from '../../../../api/generated/model/guardar-evaluacion';
import {
  GuardarEvaluacionDolorLateralidadEnum,
  GuardarEvaluacionEvolucionEnum,
  GuardarEvaluacionModoEnum,
} from '../../../../api/generated/model/guardar-evaluacion';
import { Sesion } from '../../../../api/generated/model/sesion';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import {
  ESCALA_EVA,
  EVOLUCIONES,
  LATERALIDADES,
  ZONAS_SUGERIDAS,
  comoEvolucion,
  comoLateralidad,
  comoModo,
  instanteEnPalabras,
  resumenDePrevia,
} from '../../models/etiquetas-de-atencion';

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
 * <h2>Lo que esta pantalla NO tiene</h2>
 *
 * <p><b>No hay boton de cerrar la atencion</b>: AKINE-06.05 no existe todavia y el contrato no
 * publica el endpoint. Tampoco hay Historia Clinica: la sesion trae su `historiaClinicaId`, pero
 * no hay ninguna operacion HTTP que la lea.
 */
@Component({
  selector: 'app-atencion-page',
  imports: [RouterLink],
  templateUrl: './atencion-page.html',
  styleUrl: '../../atencion.css',
})
export class AtencionPage {
  private readonly api = inject(ClinicalApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly destroyRef = inject(DestroyRef);

  /** De la ruta. `withComponentInputBinding` lo liga solo. */
  readonly turnoId = input.required<string>();

  protected readonly escala = ESCALA_EVA;
  protected readonly evoluciones = EVOLUCIONES;
  protected readonly lateralidades = LATERALIDADES;
  protected readonly zonas = ZONAS_SUGERIDAS;
  protected readonly instanteEnPalabras = instanteEnPalabras;

  protected readonly sesion = signal<Sesion | null>(null);
  protected readonly abriendo = signal(false);
  protected readonly guardando = signal(false);
  protected readonly error = signal<ErrorAtencion | null>(null);
  protected readonly guardadoEn = signal('');

  /** Version que se leyo. Es lo que viaja en cada escritura. */
  private readonly version = signal(0);

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
    const turnoId = this.numeroDeTurno();
    if (consultorioId === null || turnoId === null) {
      return;
    }

    this.cancelarAutosave();
    this.abriendo.set(true);
    this.error.set(null);
    this.notasDelServidor.set(null);

    this.api.iniciar(consultorioId, turnoId).subscribe({
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

  /**
   * Toma la sesion del servidor como estado inicial del editor.
   *
   * <p>Solo se llama en la apertura. Despues de eso el editor es del profesional y ninguna
   * respuesta lo pisa: para eso esta {@link adoptarSoloVersion}.
   */
  private adoptar(sesion: Sesion): void {
    this.sesion.set(sesion);
    this.version.set(sesion.version ?? 0);
    this.notas.set(sesion.borrador ?? '');

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
    this.cancelarAutosave();
    this.temporizador = setTimeout(() => {
      this.temporizador = null;
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

    this.api.guardarBorrador(consultorioId, sesionId, this.notas(), this.version()).subscribe({
      next: (sesion) => {
        this.guardando.set(false);
        this.adoptarSoloVersion(sesion);
      },
      error: (error: unknown) => this.fallo(error),
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
        this.notasDelServidor.set(sesion.borrador ?? '');
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

  private fallo(error: unknown): void {
    this.guardando.set(false);
    this.cancelarAutosave();
    this.error.set(traducirErrorAtencion(error));
  }

  private cancelarAutosave(): void {
    if (this.temporizador !== null) {
      clearTimeout(this.temporizador);
      this.temporizador = null;
    }
  }

  private numeroDeTurno(): number | null {
    const id = Number(this.turnoId());
    return Number.isFinite(id) && id > 0 ? id : null;
  }
}

/** Texto recortado, o `undefined` para que la clave no viaje. */
function textoOAusente(valor: string): string | undefined {
  const limpio = valor.trim();
  return limpio === '' ? undefined : limpio;
}
