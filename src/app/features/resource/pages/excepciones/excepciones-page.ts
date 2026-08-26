import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { CalendarioDeSedeService } from '../../../../api/generated/api/calendario-de-sede.service';
import { ColaboradoresService } from '../../../../api/generated/api/colaboradores.service';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import {
  CreateExcepcionRequest,
  CreateExcepcionRequestMotivoEnum,
  CreateExcepcionRequestTipoEnum,
} from '../../../../api/generated/model/create-excepcion-request';
import { EstadoDeListado, vistaDeListado } from '../../../../shared/utils/estado-de-listado';
import {
  ExcepcionResponse,
  ExcepcionResponseTipoEnum,
} from '../../../../api/generated/model/excepcion-response';
import { ExcepcionesDeDisponibilidadService } from '../../../../api/generated/api/excepciones-de-disponibilidad.service';
import { FeriadoResponse } from '../../../../api/generated/model/feriado-response';
import { MembershipResponse } from '../../../../api/generated/model/membership-response';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTAS_HORARIOS } from '../../models/rutas-de-horarios';
import {
  ParametrosDeHorarios,
  SIN_PARAMETROS,
  leerParametrosDeHorarios,
} from '../../models/parametros-de-horarios';
import { TEXTO_MODO_LECTURA, modoLectura } from '../../models/modo-lectura';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { CausaExcepcion, traducirErrorExcepcion } from '../../models/excepcion-errors';
import {
  PATRON_HORA,
  esHoraDePared,
  minutosDeHora,
  rangoHorario,
} from '../../models/horas-de-pared';
import {
  TOPE_DE_VINCULOS,
  atiendeEn,
  nombreDeVinculo,
  textoDeProfesionales,
} from '../../models/profesionales-de-la-sede';
import {
  MAXIMO_DIAS_VENTANA,
  diasEntre,
  esFechaDeCalendario,
  etiquetaDeFecha,
  hoyLocal,
  sumarDias,
} from '../../models/ventana-de-fechas';

/** Cuantos dias de ventana se proponen al entrar. Un trimestre es lo que se planifica. */
const DIAS_PROPUESTOS = 90;

/**
 * Lo que se dice cuando no se sabe quienes son los profesionales de la sede.
 *
 * <p>No es un "reintenta": nombra <b>que se iba a guardar</b>. La opcion que queda viva cuando
 * la lista de vinculos no llega es la de mayor alcance que existe en esta pantalla, y la unica
 * que no se puede acotar despues sin dar de baja lo cargado.
 */
const MENSAJE_ALCANCE_DESCONOCIDO =
  'No pudimos leer los profesionales de la sede, asi que no podemos ofrecerte a quien alcanza ' +
  'la excepcion. Lo unico que quedaria elegible es "toda la sede", que alcanza a todos: no se ' +
  'guarda nada hasta que la lista cargue. Volve a intentar con el boton de arriba.';

/**
 * El aviso que frena una apertura de sede antes de guardarla.
 *
 * <p>`verificado` distingue "consultamos el calendario y hay feriados" de "no pudimos
 * consultarlo". Los dos frenan el guardado, pero dicen cosas distintas: en el segundo caso la
 * pantalla <b>no sabe</b> si la apertura pisa un feriado, y presentarlo como si lo supiera
 * seria mentir en el unico cartel que existe para evitar un destrozo.
 */
interface AvisoDeApertura {
  readonly verificado: boolean;
  readonly feriados: readonly FeriadoResponse[];
}

/** Los seis motivos de la lista cerrada del contrato, con el rotulo que ve el usuario. */
const MOTIVOS: readonly {
  readonly valor: CreateExcepcionRequestMotivoEnum;
  readonly etiqueta: string;
}[] = [
  { valor: CreateExcepcionRequestMotivoEnum.AUSENCIA, etiqueta: 'Ausencia' },
  { valor: CreateExcepcionRequestMotivoEnum.LICENCIA, etiqueta: 'Licencia' },
  { valor: CreateExcepcionRequestMotivoEnum.FERIADO, etiqueta: 'Feriado' },
  { valor: CreateExcepcionRequestMotivoEnum.BLOQUEO, etiqueta: 'Bloqueo' },
  { valor: CreateExcepcionRequestMotivoEnum.AMPLIACION, etiqueta: 'Ampliacion' },
  { valor: CreateExcepcionRequestMotivoEnum.OTRO, etiqueta: 'Otro' },
];

/**
 * Cierres y aperturas puntuales de la sede activa (M05, RF-M05-004, AKINE-02.04).
 *
 * <p>Un <b>cierre</b> recorta disponibilidad —una ausencia, una licencia, un bloqueo— y una
 * <b>apertura</b> la habilita donde no la habia: es como un centro declara que atiende un
 * feriado o que suma una banda un sabado puntual. La apertura no es el caso raro.
 *
 * <h2>Las cuatro cosas que esta pantalla no puede aplanar</h2>
 *
 * <p><b>1. Sin profesional NO es un dato faltante: es el alcance.</b> Una excepcion sin
 * `membershipId` rige sobre <b>toda la sede</b> y por lo tanto sobre todos sus profesionales.
 * Por eso el alcance se elige en un campo con dos opciones explicitas y el listado lo dice con
 * palabras en cada fila, en vez de dejar una columna vacia que se lee como "falta cargar".
 *
 * <p><b>2. Una APERTURA de sede en un feriado que la sede cierra le cambia el dia a todo el
 * mundo.</b> Ese dia se descarta el horario base de <b>cada</b> profesional y queda en pie solo
 * la apertura. Es la regla correcta —declarar "este feriado abrimos de 10 a 14" tiene que
 * significar que la apertura <i>es</i> el dia, si no seria un agregado inutil al horario
 * normal—, pero una apertura mal cargada recorta la agenda de todos. Por eso el guardado se
 * frena y el aviso dice <b>a cuanta gente</b> le cambia el dia. Ver {@link avisoDeApertura}.
 *
 * <p><b>3. No hay 409 por solapamiento, y es deliberado.</b> Dos excepciones que se pisan sin
 * ser identicas son las dos legitimas: una ausencia de una tarde dentro de una licencia mas
 * larga es un hecho corriente, no un conflicto. La pantalla no valida solapamientos ni local ni
 * contra el servidor.
 *
 * <p><b>4. El listado responde distinto segun el filtro.</b> Sin profesional trae SOLO las de
 * alcance sede —es la vista del centro—; con un profesional trae las suyas MAS las de la sede,
 * porque un cierre del centro tambien le aplica a el. Las dos poblaciones estan rotuladas.
 *
 * <p><b>La hora de fin y la fecha de fin son las dos EXCLUSIVAS.</b> Un cierre de un solo dia
 * es `[D, D+1)`, y una franja hasta el final del dia termina en `24:00`.
 */
@Component({
  selector: 'app-excepciones-page',
  imports: [ReactiveFormsModule, RouterLink, PermisoDirective, ConfirmacionConMotivo],
  templateUrl: './excepciones-page.html',
  styleUrl: '../../resource.css',
})
export class ExcepcionesPage {
  private readonly excepciones = inject(ExcepcionesDeDisponibilidadService);
  private readonly calendario = inject(CalendarioDeSedeService);
  private readonly colaboradores = inject(ColaboradoresService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly injector = inject(Injector);

  /**
   * De quien y de que dia hablaba el enlace que trajo hasta aca, si vino de uno.
   *
   * <p>Se lee del snapshot y se consume <b>una sola vez</b>: son las condiciones iniciales de
   * esta visita, no un filtro pegado a la URL. Despues de aplicarlos, cambiar de sede o volver a
   * consultar tiene que partir de lo que el usuario ve en los campos, no de lo que decia una
   * query string que ya nadie mira.
   */
  private parametros: ParametrosDeHorarios = leerParametrosDeHorarios(
    inject(ActivatedRoute).snapshot.queryParamMap,
  );

  protected readonly permisoManage = PERMISO_CONSULTORIO_MANAGE;
  protected readonly rutas = RUTAS_HORARIOS;
  protected readonly textoModoLectura = TEXTO_MODO_LECTURA;
  protected readonly modoLectura = modoLectura(inject(PermissionsStore));
  protected readonly patronHora = PATRON_HORA;
  protected readonly motivos = MOTIVOS;
  protected readonly maximoDias = MAXIMO_DIAS_VENTANA;
  protected readonly etiquetaDeFecha = etiquetaDeFecha;
  protected readonly rangoHorario = rangoHorario;

  protected readonly nombreDeLaSede = computed(
    () => this.tenantContext.context()?.consultorioName ?? 'la sede activa',
  );

  // --- Profesionales de la sede --------------------------------------------------------

  protected readonly profesionales = signal<readonly MembershipResponse[]>([]);
  protected readonly errorProfesionales = signal<string | null>(null);

  /**
   * Si la lista de profesionales de la sede es <b>conocida</b>.
   *
   * <p>Arranca en `false`: mientras la consulta no volvio, no sabemos a cuantos alcanza una
   * excepcion de sede. Un fallo de `GET /memberships` la deja en `false` con la lista vacia,
   * que <b>no</b> es lo mismo que una sede sin profesionales.
   */
  protected readonly profesionalesConocidos = signal(false);

  /**
   * Cuantos profesionales quedan afectados por una excepcion de sede, o `null` si no se sabe.
   *
   * <p>Es el numero del aviso, y sale de la misma lista que alimenta el selector de alcance
   * para que el cartel no pueda decir un numero distinto del que muestra el campo de al lado.
   *
   * <p><b>`null` no se degrada a cero.</b> Si el listado de vinculos fallo, imprimir "ningun
   * profesional" convierte la advertencia en una tranquilidad falsa —el admin lee "esto no
   * afecta a nadie" y confirma— sobre el unico caso que este aviso existe para frenar. Un dato
   * que no se pudo obtener se dice en voz alta; nunca se rellena con un valor que suena
   * tranquilizador. Es la misma disciplina que ya se aplica cuando falla la consulta del
   * calendario.
   */
  protected readonly cantidadAfectada = computed<number | null>(() =>
    this.profesionalesConocidos() ? this.profesionales().length : null,
  );

  /** El numero redactado. Solo se lee cuando {@link cantidadAfectada} es mayor que cero. */
  protected readonly textoAfectados = computed(() =>
    textoDeProfesionales(this.cantidadAfectada() ?? 0),
  );

  /** Filtro del listado. `''` = alcance sede; un id = ese profesional MAS las de la sede. */
  protected readonly filtroMembership = signal<number | null>(null);

  // --- Listado --------------------------------------------------------------------------

  protected readonly estado = signal<EstadoDeListado<{ readonly content: ExcepcionResponse[] }>>({
    tipo: 'inicial',
  });

  private readonly vista = vistaDeListado<ExcepcionResponse>(this.estado);
  protected readonly mensajeError = this.vista.mensajeError;
  protected readonly faltaContexto = this.vista.faltaContexto;
  protected readonly vigentes = this.vista.filas;

  /** La ventana efectivamente consultada, para encabezar el resultado. */
  protected readonly ventanaConsultada = signal<{
    readonly desde: string;
    readonly hasta: string;
  } | null>(null);

  protected readonly errorVentana = signal<string | null>(null);

  // --- Alta y baja -----------------------------------------------------------------------

  protected readonly altaAbierta = signal(false);
  protected readonly bajaAbierta = signal<number | null>(null);
  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaExcepcion | null>(null);
  protected readonly exito = signal<string | null>(null);
  protected readonly intentos = signal(0);

  /**
   * Aviso pendiente de confirmacion de una apertura de sede sobre un feriado.
   *
   * <p>Mientras esta puesto, el alta <b>no salio a la red</b>: lo unico que se consulto es el
   * calendario. El cuerpo ya armado espera en {@link pendiente}.
   */
  protected readonly avisoDeApertura = signal<AvisoDeApertura | null>(null);
  private readonly pendiente = signal<CreateExcepcionRequest | null>(null);

  /** Errores que solo se resuelven releyendo la ventana. */
  protected readonly hayQueRecargar = computed(() => {
    const causa = this.causaAccion();
    return causa === 'no-encontrado' || causa === 'ya-inactiva';
  });

  protected readonly formularioVentana = this.formBuilder.nonNullable.group({
    desde: ['', [Validators.required]],
    hasta: ['', [Validators.required]],
  });

  protected readonly formularioAlta = this.formBuilder.nonNullable.group(
    {
      tipo: [String(CreateExcepcionRequestTipoEnum.CIERRE), [Validators.required]],
      motivo: [String(CreateExcepcionRequestMotivoEnum.AUSENCIA), [Validators.required]],
      alcance: [''],
      fechaDesde: ['', [Validators.required]],
      fechaHasta: ['', [Validators.required]],
      diaCompleto: [true],
      horaDesde: ['', [validadorDeHora]],
      horaHasta: ['', [validadorDeHora]],
      notes: [''],
    },
    { validators: [validadorDeExcepcion] },
  );

  constructor() {
    effect(() => {
      // Cambiar de sede invalida todo: las excepciones, los profesionales y cualquier panel
      // abierto apuntando a una fila que en la sede nueva no existe.
      this.tenantContext.contextEpoch();
      untracked(() => {
        // Los parametros del enlace valen para la PRIMERA carga y se consumen ahi: si despues
        // el usuario cambia de sede, lo que corresponde es la ventana por defecto y todas las
        // excepciones de la sede nueva, no el dia de una explicacion de la sede anterior.
        const inicial = this.parametros;
        this.parametros = SIN_PARAMETROS;

        this.cerrarAlta();
        this.bajaAbierta.set(null);
        this.exito.set(null);
        this.filtroMembership.set(inicial.membershipId);
        this.proponerVentana(inicial);
        this.cargarProfesionales();
        this.consultar();
      });
    });
  }

  // =====================================================================================
  // Carga
  // =====================================================================================

  /** La ventana del enlace si vino una, y si no un trimestre desde hoy. */
  private proponerVentana(inicial: ParametrosDeHorarios = SIN_PARAMETROS): void {
    if (inicial.desde !== null && inicial.hasta !== null) {
      this.formularioVentana.reset({ desde: inicial.desde, hasta: inicial.hasta });
      this.errorVentana.set(null);
      return;
    }
    const desde = hoyLocal();
    this.formularioVentana.reset({ desde, hasta: sumarDias(desde, DIAS_PROPUESTOS) });
    this.errorVentana.set(null);
  }

  protected cargarProfesionales(): void {
    const orgId = this.tenantContext.organizationId();
    const consultorioId = this.tenantContext.consultorioId();

    if (orgId === null || consultorioId === null) {
      this.profesionales.set([]);
      this.profesionalesConocidos.set(false);
      return;
    }

    this.errorProfesionales.set(null);

    this.colaboradores
      .listMemberships({ orgId, page: 0, size: TOPE_DE_VINCULOS })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          // Vacia y DESCONOCIDA: sin esta distincion el aviso diria "ningun profesional".
          this.profesionales.set([]);
          this.profesionalesConocidos.set(false);
          this.errorProfesionales.set(traducirErrorExcepcion(respuesta).mensaje);
          return;
        }
        this.profesionales.set(
          (respuesta.content ?? []).filter((vinculo) => atiendeEn(vinculo, consultorioId)),
        );
        this.profesionalesConocidos.set(true);
      });
  }

  /**
   * El rotulo del motivo, nunca su codigo.
   *
   * <p>`AUSENCIA` es un valor del contrato, no una palabra de la aplicacion: la misma tabla que
   * arma el selector del alta es la que rotula la fila del listado, para que las dos no se
   * puedan despegar.
   */
  protected etiquetaDeMotivo(motivo: string | undefined): string {
    if (motivo === undefined || motivo === null) {
      return '-';
    }
    // Un motivo que el backend agregue antes de que este repo regenere el cliente se muestra
    // crudo: feo, pero visible. Un guion escondería que la excepcion tiene un motivo declarado.
    return MOTIVOS.find((candidato) => candidato.valor === motivo)?.etiqueta ?? motivo;
  }

  /** Nombre del profesional de una excepcion, o el rotulo del alcance de sede. */
  protected alcanceDe(excepcion: ExcepcionResponse): string {
    const membershipId = excepcion.membershipId;
    if (membershipId === undefined || membershipId === null) {
      return 'Toda la sede';
    }
    const vinculo = this.profesionales().find((candidato) => candidato.id === membershipId);
    // Un profesional desvinculado se sigue pudiendo consultar (RN-M05-003) pero ya no esta en
    // el selector: mostrar su id es mas honesto que "el profesional" a secas.
    return vinculo === undefined ? `Profesional #${membershipId}` : nombreDeVinculo(vinculo);
  }

  /** `true` para la excepcion que le cambia el dia a toda la sede si cae en un feriado. */
  protected esAperturaDeSede(excepcion: ExcepcionResponse): boolean {
    const sinProfesional = excepcion.membershipId === undefined || excepcion.membershipId === null;
    return sinProfesional && excepcion.tipo === ExcepcionResponseTipoEnum.APERTURA;
  }

  protected esDiaCompleto(excepcion: ExcepcionResponse): boolean {
    return excepcion.horaDesde === undefined || excepcion.horaDesde === null;
  }

  /** Ultimo dia realmente cubierto. `fechaHasta` es exclusiva y confunde a todo el mundo. */
  protected ultimoDiaCubierto(excepcion: ExcepcionResponse): string {
    return etiquetaDeFecha(sumarDias(excepcion.fechaHasta ?? '', -1));
  }

  protected cambiarFiltro(valor: string): void {
    this.filtroMembership.set(valor === '' ? null : Number(valor));
    this.exito.set(null);
    this.consultar();
  }

  protected consultar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }

    this.errorVentana.set(null);

    const { desde, hasta } = this.formularioVentana.getRawValue();
    const dias = diasEntre(desde, hasta);

    if (!esFechaDeCalendario(desde) || !esFechaDeCalendario(hasta) || dias === null) {
      this.errorVentana.set('Completa las dos fechas de la ventana para consultar.');
      return;
    }
    if (dias <= 0) {
      // `hasta == desde` es 400 y no "un dia": el fin es exclusivo.
      this.errorVentana.set(
        'El fin de la ventana tiene que ser posterior al inicio. Es exclusivo: para mirar un solo dia, poné el dia siguiente.',
      );
      return;
    }
    if (dias > MAXIMO_DIAS_VENTANA) {
      this.errorVentana.set(
        `La ventana no puede superar los ${MAXIMO_DIAS_VENTANA} dias. Acorta el periodo y volve a consultar.`,
      );
      return;
    }

    this.estado.set({ tipo: 'cargando' });
    this.ventanaConsultada.set({ desde, hasta });

    const membershipId = this.filtroMembership();

    this.excepciones
      .listExcepciones({
        consultorioId,
        desde,
        hasta,
        ...(membershipId === null ? {} : { membershipId }),
      })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          const traducido = traducirErrorExcepcion(respuesta);
          this.estado.set({
            tipo: 'error',
            mensaje: traducido.mensaje,
            faltaContexto: traducido.causa === 'sin-contexto',
          });
          return;
        }
        this.estado.set({ tipo: 'listo', pagina: { content: respuesta } });
      });
  }

  // =====================================================================================
  // Alta
  // =====================================================================================

  protected abrirAlta(): void {
    this.bajaAbierta.set(null);
    this.exito.set(null);
    const desde = this.formularioVentana.getRawValue().desde || hoyLocal();
    this.formularioAlta.reset({
      tipo: String(CreateExcepcionRequestTipoEnum.CIERRE),
      motivo: String(CreateExcepcionRequestMotivoEnum.AUSENCIA),
      alcance: '',
      fechaDesde: desde,
      // Un solo dia, que es el caso frecuente, ya escrito con el fin exclusivo.
      fechaHasta: sumarDias(desde, 1),
      diaCompleto: true,
      horaDesde: '',
      horaHasta: '',
      notes: '',
    });
    this.limpiarEnvio();
    this.altaAbierta.set(true);
    afterNextRender(() => this.enfocar('#alta-excepcion-tipo'), { injector: this.injector });
  }

  protected cerrarAlta(): void {
    this.altaAbierta.set(false);
    this.limpiarEnvio();
  }

  protected mostrarError(campo: 'fechaDesde' | 'fechaHasta' | 'horaDesde' | 'horaHasta'): boolean {
    const control = this.formularioAlta.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  /** Si el formulario tiene un error de grupo ya mostrable. */
  protected errorDeGrupo(clave: 'rangoFechas' | 'rangoHoras' | 'franjaIncompleta'): boolean {
    return this.formularioAlta.errors?.[clave] === true && this.intentos() > 0;
  }

  protected esApertura(): boolean {
    return this.formularioAlta.controls.tipo.value === CreateExcepcionRequestTipoEnum.APERTURA;
  }

  protected esDeSede(): boolean {
    return this.formularioAlta.controls.alcance.value === '';
  }

  /**
   * Arma el cuerpo y decide si hace falta avisar antes de guardar.
   *
   * <p>Una apertura de <b>sede</b> puede reemplazar el horario de todos los profesionales ese
   * dia, asi que antes de crearla se consulta el calendario de la ventana de la excepcion. Si
   * la sede cierra por feriado y hay alguno adentro, no se guarda nada todavia: se muestra el
   * aviso con el numero de afectados y se espera una confirmacion explicita.
   */
  protected enviarAlta(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null || this.enviando()) {
      return;
    }

    if (!this.profesionalesConocidos()) {
      // Sin la lista de vinculos, el selector de alcance colapsa a su unica opcion fija: "toda
      // la sede". Quien abrio el alta para cerrarle la semana a UNA persona no encuentra su
      // nombre, no necesariamente registra por que, y confirma un cierre de TODO el centro por
      // todo el rango. El aviso de apertura no lo frena: solo cubre APERTURA + sede.
      this.errorAccion.set(MENSAJE_ALCANCE_DESCONOCIDO);
      this.causaAccion.set(null);
      return;
    }

    this.intentos.update((valor) => valor + 1);
    if (this.formularioAlta.invalid) {
      this.formularioAlta.markAllAsTouched();
      this.enfocar('#alta-excepcion-desde');
      return;
    }

    const cuerpo = this.armarCuerpo();
    this.pendiente.set(cuerpo);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);

    if (
      cuerpo.tipo === CreateExcepcionRequestTipoEnum.APERTURA &&
      cuerpo.membershipId === undefined
    ) {
      this.verificarFeriados(consultorioId, cuerpo);
      return;
    }

    this.crear(consultorioId, cuerpo);
  }

  /**
   * Confirmacion explicita del aviso: recien aca sale el alta a la red.
   *
   * <p><b>Se vuelve a leer el formulario.</b> El aviso se muestra con el formulario vivo
   * debajo, y lo primero que hace quien lo lee es corregir lo que el aviso le acaba de
   * senalar: acota el alcance a una persona, o corre las fechas. Postear el cuerpo capturado
   * al enviar crearia una apertura de <b>sede</b> mientras la pantalla muestra una de un
   * profesional —el peor final posible para el cartel que existe justamente para evitarlo—.
   *
   * <p>Se eligio releer y revalidar en vez de deshabilitar los controles mientras el aviso
   * esta abierto: corregir el alcance <b>es</b> la reaccion correcta al aviso, y apagar los
   * campos obligaria a cancelar y volver a escribir todo para hacer exactamente lo que el
   * aviso pide. Si lo que dice el formulario ya no es lo confirmado, no se guarda: se vuelve a
   * pasar por {@link enviarAlta}, que revalida y —si sigue siendo una apertura de sede— vuelve
   * a consultar los feriados de la <b>nueva</b> ventana y avisa de nuevo.
   */
  protected confirmarApertura(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const confirmado = this.pendiente();
    if (consultorioId === null || confirmado === null || this.enviando()) {
      return;
    }

    if (this.formularioAlta.invalid || !mismoCuerpo(this.armarCuerpo(), confirmado)) {
      this.avisoDeApertura.set(null);
      this.pendiente.set(null);
      this.enviarAlta();
      return;
    }

    this.avisoDeApertura.set(null);
    this.crear(consultorioId, confirmado);
  }

  protected descartarAviso(): void {
    this.avisoDeApertura.set(null);
    this.pendiente.set(null);
    this.enfocar('#alta-excepcion-alcance');
  }

  private verificarFeriados(consultorioId: number, cuerpo: CreateExcepcionRequest): void {
    this.enviando.set(true);

    this.calendario
      .getCalendarioSede({ consultorioId, desde: cuerpo.fechaDesde, hasta: cuerpo.fechaHasta })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        this.enviando.set(false);

        if (respuesta instanceof Error) {
          // No se pudo saber si hay feriados. Se frena igual y se dice que NO se pudo
          // verificar: seguir de largo guardaria en silencio justo el caso que este aviso
          // existe para frenar.
          this.avisoDeApertura.set({ verificado: false, feriados: [] });
          this.enfocarAviso();
          return;
        }

        const feriados = respuesta.feriados ?? [];
        if (respuesta.cierraPorFeriado === true && feriados.length > 0) {
          this.avisoDeApertura.set({ verificado: true, feriados });
          this.enfocarAviso();
          return;
        }

        // Sin feriados que la sede cierre, la apertura solo suma disponibilidad: no descarta
        // el horario de nadie y no hay nada que advertir.
        this.crear(consultorioId, cuerpo);
      });
  }

  private crear(consultorioId: number, cuerpo: CreateExcepcionRequest): void {
    this.enviando.set(true);

    this.excepciones.createExcepcion({ consultorioId, createExcepcionRequest: cuerpo }).subscribe({
      next: () => {
        // El alta responde 201 o 200 —es idempotente sin `Idempotency-Key`— y los dos son
        // exito: un reintento de red que devuelve 200 igual dejo la excepcion cargada.
        this.cerrarAlta();
        this.exito.set(
          cuerpo.tipo === CreateExcepcionRequestTipoEnum.APERTURA
            ? 'La apertura quedo cargada.'
            : 'El cierre quedo cargado.',
        );
        this.consultar();
      },
      error: (error: unknown) => this.fallar(error),
    });
  }

  private armarCuerpo(): CreateExcepcionRequest {
    const valores = this.formularioAlta.getRawValue();

    const cuerpo: CreateExcepcionRequest = {
      tipo: valores.tipo as CreateExcepcionRequestTipoEnum,
      motivo: valores.motivo as CreateExcepcionRequestMotivoEnum,
      fechaDesde: valores.fechaDesde,
      fechaHasta: valores.fechaHasta,
    };

    // Omitir `membershipId` significa SEDE ENTERA. No se manda vacio ni cero: eso seria un
    // dato faltante, y esto es una decision.
    if (valores.alcance !== '') {
      cuerpo.membershipId = Number(valores.alcance);
    }

    // Las dos horas viajan juntas o no viaja ninguna. Sin ellas la excepcion es de dia
    // completo, que es cosa distinta de una franja de 00:00 a 24:00 solo en la intencion,
    // pero el contrato las distingue y conviene no inventar horas.
    if (!valores.diaCompleto) {
      cuerpo.horaDesde = valores.horaDesde.trim();
      cuerpo.horaHasta = valores.horaHasta.trim();
    }

    const notes = valores.notes.trim();
    if (notes !== '') {
      cuerpo.notes = notes;
    }

    return cuerpo;
  }

  // =====================================================================================
  // Baja
  // =====================================================================================

  protected abrirBaja(excepcion: ExcepcionResponse): void {
    const id = excepcion.id;
    if (id === undefined) {
      return;
    }
    this.cerrarAlta();
    this.exito.set(null);
    this.bajaAbierta.set(id);
  }

  protected cerrarBaja(): void {
    this.bajaAbierta.set(null);
    this.limpiarEnvio();
  }

  protected enviarBaja(motivo: string): void {
    const consultorioId = this.tenantContext.consultorioId();
    const excepcionId = this.bajaAbierta();
    if (consultorioId === null || excepcionId === null || this.enviando()) {
      return;
    }

    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);

    this.excepciones
      .deactivateExcepcion({
        consultorioId,
        excepcionId,
        deactivateExcepcionRequest: { reason: motivo },
      })
      .subscribe({
        next: () => {
          this.cerrarBaja();
          this.exito.set(
            'La excepcion quedo dada de baja. La fila no se borra: sobrevive con sus fechas, su ' +
              'motivo y su autor.',
          );
          this.consultar();
        },
        error: (error: unknown) => this.fallar(error),
      });
  }

  // =====================================================================================
  // Auxiliares
  // =====================================================================================

  private fallar(error: unknown): void {
    const traducido = traducirErrorExcepcion(error);
    this.enviando.set(false);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);
  }

  private limpiarEnvio(): void {
    this.enviando.set(false);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.avisoDeApertura.set(null);
    this.pendiente.set(null);
    this.intentos.set(0);
  }

  private enfocarAviso(): void {
    afterNextRender(() => this.enfocar('#aviso-apertura-confirmar'), { injector: this.injector });
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}

/**
 * `true` si los dos cuerpos piden exactamente la misma excepcion.
 *
 * <p>Compara <b>todas</b> las claves de los dos, no solo las del primero: una clave que
 * <i>desaparece</i> —`membershipId`, que al omitirse cambia el alcance a toda la sede— es el
 * cambio mas grave que puede sufrir este cuerpo, y una comparacion en un solo sentido no lo ve.
 */
function mismoCuerpo(uno: CreateExcepcionRequest, otro: CreateExcepcionRequest): boolean {
  const claves = new Set([...Object.keys(uno), ...Object.keys(otro)]);
  const izquierda = uno as unknown as Record<string, unknown>;
  const derecha = otro as unknown as Record<string, unknown>;
  return [...claves].every((clave) => izquierda[clave] === derecha[clave]);
}

/** Mismo criterio que en el horario semanal: el patron admite `24:00`. */
function validadorDeHora(control: AbstractControl): ValidationErrors | null {
  const valor = typeof control.value === 'string' ? control.value.trim() : '';
  if (valor === '') {
    return null;
  }
  return esHoraDePared(valor) ? null : { hora: true };
}

/**
 * Las tres reglas del formulario que el backend rechazaria con un `400`.
 *
 * <p>No valida solapamientos: dos excepciones que se pisan son legitimas y el backend las
 * acepta a proposito.
 */
function validadorDeExcepcion(grupo: AbstractControl): ValidationErrors | null {
  const valores = grupo.value as {
    fechaDesde?: string;
    fechaHasta?: string;
    diaCompleto?: boolean;
    horaDesde?: string;
    horaHasta?: string;
  };

  const errores: ValidationErrors = {};

  const dias = diasEntre(valores.fechaDesde ?? '', valores.fechaHasta ?? '');
  if (dias !== null && dias <= 0) {
    errores['rangoFechas'] = true;
  }

  if (valores.diaCompleto !== true) {
    const desde = (valores.horaDesde ?? '').trim();
    const hasta = (valores.horaHasta ?? '').trim();
    if (desde === '' || hasta === '') {
      errores['franjaIncompleta'] = true;
    } else {
      const inicio = minutosDeHora(desde);
      const fin = minutosDeHora(hasta);
      if (inicio !== null && fin !== null && fin <= inicio) {
        errores['rangoHoras'] = true;
      }
    }
  }

  return Object.keys(errores).length === 0 ? null : errores;
}
