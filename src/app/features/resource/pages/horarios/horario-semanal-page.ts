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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';

import { BloqueResponse } from '../../../../api/generated/model/bloque-response';
import { ColaboradoresService } from '../../../../api/generated/api/colaboradores.service';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { CreateBloquesRequest } from '../../../../api/generated/model/create-bloques-request';
import { DisponibilidadProfesionalService } from '../../../../api/generated/api/disponibilidad-profesional.service';
import { EstadoDeListado, vistaDeListado } from '../../../../shared/utils/estado-de-listado';
import { MembershipResponse } from '../../../../api/generated/model/membership-response';
import {
  PERMISO_AGENDA_EXCEPCIONES,
  PERMISO_AGENDA_HORARIO,
  PERMISO_TURNO_MANAGE,
  PERMISO_TURNO_READ,
} from '../../../../core/models/permisos';
import { PerfilPropioStore } from '../../../../core/services/perfil-propio.store';
import { FlujoDeTurnosStore } from '../../../../core/services/flujo-de-turnos.store';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTAS_HORARIOS } from '../../models/rutas-de-horarios';
import { leerParametrosDeHorarios } from '../../models/parametros-de-horarios';
import { traducirErrorHorarioEfectivo } from '../../models/horario-efectivo-errors';
import { modoLectura, textoDeModoLectura } from '../../models/modo-lectura';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { UpdateBloqueRequest } from '../../../../api/generated/model/update-bloque-request';
import {
  BloqueEnConflicto,
  CausaBloque,
  FranjaFueraDeSede,
  traducirErrorBloque,
} from '../../models/bloque-errors';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { DIAS_DE_LA_SEMANA, etiquetaDeDia } from '../../../../shared/utils/dias-de-la-semana';
import {
  ImpactoPrevio,
  avisoDeTurnosAfectados,
  impactoDelRechazo,
  turnosPrevistos,
} from '../../models/turnos-afectados';
import { ImpactoPrevioPanel } from '../../components/impacto-previo/impacto-previo';
import { SimularEdicionBloqueRequest } from '../../../../api/generated/model/simular-edicion-bloque-request';
import {
  TEXTO_LISTA_INCOMPLETA,
  TOPE_DE_VINCULOS,
  atiendeEn,
  esListaCompleta,
  nombreDeVinculo,
} from '../../models/profesionales-de-la-sede';
import {
  HORA_MEDIANOCHE,
  PATRON_HORA,
  esHoraDePared,
  minutosDeHora,
  rangoHorario,
} from '../../../../shared/utils/horas-de-pared';
import { Icono } from '../../../../shared/components/icono/icono';
import { Pestanas } from '../../../../shared/components/pestanas/pestanas';
import {
  ETIQUETA_PESTANAS_DE_HORARIOS,
  pestanasDeHorarios,
} from '../../models/pestanas-de-horarios';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { AccionesDeFila } from '../../../../shared/components/acciones-de-fila/acciones-de-fila';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import {
  IntervaloDeHora,
  SelectorDeHora,
} from '../../../../shared/components/selector-de-hora/selector-de-hora';
import {
  DIAS_PARA_PASTILLAS,
  MODOS_DE_DIAS,
  ModoDeDias,
  alternarDia,
  describirDias,
  diasDelModo,
} from '../../models/dias-rapidos';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

/** Operacion abierta sobre un bloque. Solo una a la vez, y nunca junto con el alta. */
type TipoAccion = 'editar' | 'baja';

/** Un dia de la semana con los bloques que el profesional tiene cargados en el. */
interface DiaConBloques {
  readonly numero: number;
  readonly etiqueta: string;
  readonly bloques: readonly BloqueResponse[];
}

/**
 * Horario semanal de un profesional en la sede activa (M05, AKINE-02.04).
 *
 * <p>Es la lectura y la edicion de las <b>reglas</b>: que horario tiene cargado el
 * profesional. Que dias y horas concretas termina atendiendo —una vez aplicadas excepciones,
 * feriados y vigencia del vinculo— es la <b>disponibilidad efectiva</b>, que es otra pantalla
 * y otro endpoint. Las dos conviven a proposito.
 *
 * <p><b>Esto no es la disponibilidad de un espacio.</b> `pages/disponibilidad/` responde si un
 * box fisico esta en servicio en una ventana (M04, AKINE-02.02). Aca se responde cuando
 * trabaja una persona. Por eso la ruta es `/horarios` y ninguna clase de esta etapa se llama
 * `Disponibilidad` a secas.
 *
 * <h2>Las tres cosas que esta pantalla no puede aplanar</h2>
 *
 * <p><b>1. Contiguo no es solapado.</b> La hora de fin es EXCLUSIVA: 09:00-12:00 y 12:00-15:00
 * son la manana y la tarde, el horario mas comun que existe, y conviven sin conflicto. Ni la
 * validacion local ni ningun mensaje tratan eso como un error.
 *
 * <p><b>2. La medianoche es el string `24:00`.</b> No es un `partial-time` valido de RFC 3339
 * —`00:00` seria el principio del dia— y por eso los campos son `type="text"` con
 * {@link PATRON_HORA} y no `type="time"`: el control nativo del navegador rechaza `24:00` y
 * vacia el campo sin decir nada. Ver `horas-de-pared.ts`.
 *
 * <p><b>3. El `409` de solapamiento senala los dos bloques.</b> El backend publica el id y el
 * horario del bloque con el que se choca; la pantalla marca esa fila en la grilla y ademas lo
 * nombra en el mensaje. Un "conflicto" a secas obliga a recorrer la semana comparando horas a
 * ojo.
 *
 * <p><b>Reacciona a `contextEpoch`.</b> Cambiar de sede sin recargar dejaria en pantalla el
 * horario del profesional de la sede anterior, y un panel abierto apuntando a un bloque que
 * en la sede nueva no existe.
 */
@Component({
  selector: 'app-horario-semanal-page',
  imports: [
    CabeceraDePagina,

    Alerta,
    PanelLateral,
    AccionesDeFila,
    Ayuda,
    Icono,
    Pestanas,
    ReactiveFormsModule,
    SelectorDeHora,
    RouterLink,
    PermisoDirective,
    ConfirmacionConMotivo,
    ImpactoPrevioPanel,
    EstadoVacio,
    Filtros,
  ],
  templateUrl: './horario-semanal-page.html',
  styleUrl: '../../resource.css',
})
export class HorarioSemanalPage {
  private readonly disponibilidad = inject(DisponibilidadProfesionalService);
  private readonly avisos = inject(AvisosStore);
  private readonly colaboradores = inject(ColaboradoresService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly injector = inject(Injector);
  private readonly flujo = inject(FlujoDeTurnosStore);

  /**
   * El profesional del que hablaba el enlace que trajo hasta aca, si vino de uno.
   *
   * <p>El horario efectivo explica un dia sin atencion con "ninguna regla abre ese dia" y ofrece
   * venir a mirar el horario semanal. Sin este parametro el salto aterriza en "Elegi un
   * profesional" y hay que volver a buscar en la lista a la persona que se venia mirando.
   *
   * <p>Se consume una sola vez: un cambio de sede despues vuelve a dejar la pantalla sin nadie
   * elegido, porque el vinculo elegido puede no existir en la sede nueva.
   */
  private membershipInicial: number | null = leerParametrosDeHorarios(
    inject(ActivatedRoute).snapshot.queryParamMap,
  ).membershipId;

  /** El horario habitual se gestiona con `agenda:horario` desde el contrato 0.154.0. */
  protected readonly permisoManage = PERMISO_AGENDA_HORARIO;
  private readonly permisos = inject(PermissionsStore);
  private readonly perfil = inject(PerfilPropioStore);
  protected readonly permisoVerTurnos = PERMISO_TURNO_READ;
  protected readonly permisoTurnos = PERMISO_TURNO_MANAGE;
  protected readonly rutas = RUTAS_HORARIOS;
  protected readonly pestanas = computed(() =>
    pestanasDeHorarios(this.permisos.tiene(PERMISO_AGENDA_EXCEPCIONES)),
  );
  protected readonly etiquetaDePestanas = ETIQUETA_PESTANAS_DE_HORARIOS;
  /**
   * Con `agenda:horario` recortado a lo propio, el horario de otro profesional se mira y no se toca.
   * Un profesional sin elegir todavia no es ajeno.
   */
  protected readonly ajeno = computed(
    () =>
      this.permisos.soloPropio(PERMISO_AGENDA_HORARIO) &&
      this.membershipElegido() !== null &&
      this.membershipElegido() !== this.perfil.membershipId(),
  );
  protected readonly textoModoLectura = computed(() =>
    this.ajeno()
      ? 'Modo lectura: podés consultar el horario de otros profesionales, pero cambiar solo el tuyo.'
      : textoDeModoLectura(PERMISO_AGENDA_HORARIO),
  );
  protected readonly textoListaIncompleta = TEXTO_LISTA_INCOMPLETA;
  private readonly sinPermisoDeHorario = modoLectura(this.permisos, PERMISO_AGENDA_HORARIO);
  protected readonly modoLectura = computed(() => this.sinPermisoDeHorario() || this.ajeno());
  protected readonly patronHora = PATRON_HORA;
  protected readonly horaMedianoche = HORA_MEDIANOCHE;
  protected readonly dias = DIAS_DE_LA_SEMANA;
  protected readonly modos = MODOS_DE_DIAS;
  protected readonly diasParaPastillas = DIAS_PARA_PASTILLAS;

  /**
   * Cada cuantos minutos ofrece una hora el desplegable (rediseño del 05/11/2026). Es de la
   * pantalla y no del formulario: vale para el alta y la edicion, y no viaja.
   */
  protected readonly intervalo = signal<IntervaloDeHora>(30);
  protected readonly otroIntervalo = computed(() => (this.intervalo() === 30 ? 15 : 30));
  protected readonly etiquetaDeDia = etiquetaDeDia;
  protected readonly rangoHorario = rangoHorario;

  protected readonly nombreDeLaSede = computed(
    () => this.tenantContext.context()?.consultorioName ?? 'la sede activa',
  );

  // --- Selector de profesional -------------------------------------------------------

  protected readonly profesionales = signal<readonly MembershipResponse[]>([]);
  protected readonly cargandoProfesionales = signal(false);

  /**
   * Si la lista recibida cubre <b>toda</b> la organizacion, o solo su primera pagina.
   *
   * <p>`listMemberships` no filtra por sede y el backend recorta la pagina en
   * {@link TOPE_DE_VINCULOS}: en una organizacion grande el selector muestra un recorte por id.
   * Aca importa por dos cosas: que "no hay profesionales con vinculo vigente" no se afirme sobre
   * una lista cortada, y que quien no encuentre a alguien sepa que puede estar faltando en vez
   * de irse a Colaboradores a arreglar un vinculo que esta perfecto.
   */
  protected readonly listaCompleta = signal(false);
  protected readonly errorProfesionales = signal<string | null>(null);
  protected readonly membershipElegido = signal<number | null>(null);

  protected readonly profesionalElegido = computed(() =>
    this.profesionales().find((candidato) => candidato.id === this.membershipElegido()),
  );

  protected readonly nombreDelProfesional = computed(() =>
    nombreDeVinculo(this.profesionalElegido()),
  );

  // --- Horario del profesional elegido -----------------------------------------------

  /**
   * Estado del horario cargado.
   *
   * <p>Arranca en `inicial` y no en `cargando`: la consulta necesita un profesional, asi que
   * antes de elegirlo no hay ninguna peticion que hacer y "cargando" seria mentira.
   *
   * <p>El contrato devuelve un <b>array</b>, no una pagina: no hay paginacion porque una
   * semana tiene siete dias. Se envuelve en `{ content }` para reusar `vistaDeListado`, que es
   * quien deriva filas, mensaje de error y falta de contexto en las cinco pantallas de
   * listado. La forma envuelta no viaja por la red ni la construye ningun servicio.
   */
  protected readonly estado = signal<EstadoDeListado<{ readonly content: BloqueResponse[] }>>({
    tipo: 'inicial',
  });

  private readonly vista = vistaDeListado<BloqueResponse>(this.estado);
  protected readonly mensajeError = this.vista.mensajeError;
  protected readonly faltaContexto = this.vista.faltaContexto;

  /**
   * Los siete dias, siempre los siete, con sus bloques ordenados por hora de inicio.
   *
   * <p><b>Un dia sin bloques no se omite.</b> La grilla es una semana: saltear el miercoles
   * correria los demas y el lector veria el horario del jueves creyendo que es el del
   * miercoles. Ademas "no atiende" es informacion, no ausencia de informacion.
   */
  protected readonly semana = computed<readonly DiaConBloques[]>(() => {
    const bloques = this.vista.filas();
    return DIAS_DE_LA_SEMANA.map((dia) => ({
      numero: dia.numero,
      etiqueta: dia.etiqueta,
      bloques: bloques
        .filter((bloque) => bloque.diaSemana === dia.numero)
        .slice()
        .sort(porHoraDeInicio),
    }));
  });

  protected readonly totalBloques = computed(() => this.vista.filas().length);

  // --- Paneles y envio ----------------------------------------------------------------

  protected readonly altaAbierta = signal(false);
  protected readonly panel = signal<{ readonly id: number; readonly tipo: TipoAccion } | null>(
    null,
  );

  /**
   * El bloque del panel abierto, con su dia. El panel lateral vive fuera de la semana (refactor
   * UX/UI del 28/10/2026), asi que lo busca en los dias en vez de recibirlo del `@for`.
   */
  protected readonly bloqueEnPanel = computed(() => {
    const panel = this.panel();
    if (panel === null) {
      return null;
    }
    for (const dia of this.semana()) {
      const bloque = dia.bloques.find((candidato) => candidato.id === panel.id);
      if (bloque !== undefined) {
        return { bloque, dia };
      }
    }
    return null;
  });

  /** Bloque tal como lo devolvio el backend: es de donde sale la `version` del `PUT`. */
  private readonly original = signal<BloqueResponse | null>(null);

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaBloque | null>(null);
  protected readonly intentos = signal(0);

  /**
   * Consulta previa de impacto del panel abierto (A-11), o `null` si todavia no se pidio.
   *
   * <p>En la baja se pide al abrir el panel: no hay nada que escribir antes. En la edicion se
   * pide al enviar, con los cambios escritos; si no deja ningun turno afuera la edicion sigue
   * de largo, y si deja alguno el panel muestra cuales y espera un segundo "Guardar igual".
   */
  protected readonly impacto = signal<ImpactoPrevio | null>(null);

  /** Los cambios (sin `version`) sobre los que se calculo {@link impacto}, serializados. */
  private claveDelImpacto: string | null = null;

  /** Si la edicion ya mostro su impacto y el proximo envio confirma. */
  protected readonly edicionConImpacto = computed(() => {
    const tipo = this.impacto()?.tipo;
    return tipo === 'listo' || tipo === 'error';
  });

  /**
   * El otro bloque del ultimo solapamiento, o `null`.
   *
   * <p>Es lo que permite marcar <b>la fila</b> del bloque con el que se choca. Se limpia al
   * cerrar el panel y en cada envio nuevo: una marca vieja senalaria un bloque que ya no tiene
   * nada que ver con lo que el usuario esta haciendo.
   */
  protected readonly conflicto = signal<BloqueEnConflicto | null>(null);

  /** `true` para la fila que hay que mirar junto con la que se estaba editando. */
  protected esBloqueEnConflicto(bloque: BloqueResponse): boolean {
    const enConflicto = this.conflicto();
    return enConflicto !== null && enConflicto.id !== null && enConflicto.id === bloque.id;
  }

  /**
   * Solapamiento con otro bloque (UX-12), o franja fuera del horario de la sede (0.162.0): los dos
   * van pegados al día y las horas, no arriba, porque se corrigen ahí.
   */
  protected readonly solapado = computed(
    () => this.causaAccion() === 'solapado' || this.causaAccion() === 'fuera-de-horario-sede',
  );

  /** Los días del último 409 `franja-fuera-del-horario-de-sede`; solo valen con esa causa. */
  private readonly fueraDeHorario = signal<readonly FranjaFueraDeSede[]>([]);

  /** Errores que solo se resuelven releyendo el horario. */
  protected readonly hayQueRecargar = computed(() => {
    const causa = this.causaAccion();
    return causa === 'no-encontrado' || causa === 'ya-inactivo' || causa === 'concurrencia';
  });

  /**
   * El alta carga el mismo horario en VARIOS dias (rediseño del 05/11/2026). `modoDias` es la
   * seleccion rapida; lo que viaja es `diasSemana`. La vigencia se elige por modo y las fechas solo
   * cuentan cuando el modo las pide.
   */
  protected readonly formularioAlta = this.formBuilder.nonNullable.group(
    {
      modoDias: ['lv' as ModoDeDias],
      diasSemana: [[1, 2, 3, 4, 5] as number[], [validadorDeDias]],
      horaDesde: ['', [Validators.required, validadorDeHora]],
      horaHasta: ['', [Validators.required, validadorDeHora]],
      modoInicio: ['hoy' as 'hoy' | 'fecha'],
      vigenciaDesde: [''],
      modoFin: ['sin-fin' as 'sin-fin' | 'fecha'],
      vigenciaHasta: [''],
    },
    { validators: [validadorDeRango, validadorDeVigencia] },
  );
  protected readonly formularioEdicion = this.nuevoFormulario();

  /** Los dias elegidos, como signal: la plantilla marca las pastillas con esto. */
  protected readonly diasElegidos = signal<readonly number[]>([1, 2, 3, 4, 5]);
  private readonly modoDeDias = signal<ModoDeDias>('lv');
  protected readonly diasPersonalizados = computed(() => this.modoDeDias() === 'personalizado');

  constructor() {
    this.formularioAlta.controls.diasSemana.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((dias) => this.diasElegidos.set(dias));
    this.formularioAlta.controls.modoDias.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((modo) => {
        this.modoDeDias.set(modo);
        const fijos = diasDelModo(modo);
        if (fijos !== null) {
          this.formularioAlta.controls.diasSemana.setValue([...fijos]);
        }
      });

    // Lo que se calculo ya no describe lo que esta escrito: el proximo envio vuelve a consultar.
    this.formularioEdicion.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.panel()?.tipo === 'editar' && this.impacto()?.tipo !== 'consultando') {
        this.impacto.set(null);
        this.claveDelImpacto = null;
      }
    });

    effect(() => {
      // Dependencia explicita: cualquier cambio de contexto invalida todo lo que hay abierto.
      this.tenantContext.contextEpoch();
      untracked(() => {
        const inicial = this.membershipInicial;
        this.membershipInicial = null;

        this.cerrarPanel();
        this.altaAbierta.set(false);
        this.membershipElegido.set(inicial);
        this.estado.set({ tipo: 'inicial' });
        this.cargarProfesionales();
        if (inicial !== null) {
          // El horario no espera a la lista de vinculos: son dos peticiones independientes y
          // hacer una en serie despues de la otra solo agregaria una pantalla vacia intermedia.
          this.cargar();
        }
      });
    });
  }

  // =====================================================================================
  // Carga
  // =====================================================================================

  /**
   * Profesionales a los que se les puede cargar horario en <b>esta</b> sede.
   *
   * <p>Se filtra por rol `PROFESIONAL`, por vinculo `ACTIVA` y por alcance: un vinculo acotado
   * a otra sede no habilita a atender aca y el backend responderia `409
   * profesional-no-vinculado`. Ofrecerlo en el selector seria ofrecer un camino que termina
   * siempre en un rechazo.
   */
  protected cargarProfesionales(): void {
    const orgId = this.tenantContext.organizationId();
    const consultorioId = this.tenantContext.consultorioId();

    if (orgId === null || consultorioId === null) {
      this.profesionales.set([]);
      this.cargandoProfesionales.set(false);
      this.listaCompleta.set(false);
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }

    this.cargandoProfesionales.set(true);
    this.errorProfesionales.set(null);

    this.colaboradores
      .listMemberships({ orgId, page: 0, size: TOPE_DE_VINCULOS })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        this.cargandoProfesionales.set(false);

        if (respuesta instanceof Error) {
          this.profesionales.set([]);
          this.listaCompleta.set(false);
          // Lo que fallo es una LECTURA de colaboradores, no una mutacion del horario:
          // `traducirErrorBloque` diria "no tenes permiso para administrar el horario" sobre un
          // 403 que en realidad pide `colaborador:read`, y quien administre el centro terminaria
          // otorgando el permiso equivocado. Es el mismo arreglo que ya tiene el horario
          // efectivo, que consulta exactamente este endpoint.
          this.errorProfesionales.set(traducirErrorHorarioEfectivo(respuesta).mensaje);
          return;
        }

        this.profesionales.set(
          (respuesta.content ?? []).filter((vinculo) => atiendeEn(vinculo, consultorioId)),
        );
        // Una pagina llena no es una nomina completa: ver `esListaCompleta`.
        this.listaCompleta.set(esListaCompleta(respuesta));
      });
  }

  protected elegirProfesional(valor: string): void {
    const membershipId = Number(valor);
    this.cerrarPanel();
    this.altaAbierta.set(false);

    if (valor === '' || !Number.isFinite(membershipId)) {
      this.membershipElegido.set(null);
      this.estado.set({ tipo: 'inicial' });
      return;
    }

    this.membershipElegido.set(membershipId);
    this.cargar();
  }

  protected cargar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const membershipId = this.membershipElegido();

    if (consultorioId === null) {
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }
    if (membershipId === null) {
      this.estado.set({ tipo: 'inicial' });
      return;
    }

    this.estado.set({ tipo: 'cargando' });

    this.disponibilidad
      .listBloquesDisponibilidad({ consultorioId, membershipId })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          const traducido = traducirErrorBloque(respuesta);
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

  protected nuevoTurno(profesionalId: number): void {
    this.flujo.nuevoTurno({ origen: 'PROFESIONAL', profesionalId });
  }

  // =====================================================================================
  // Paneles
  // =====================================================================================

  protected abrirAlta(): void {
    this.cerrarPanel();
    this.formularioAlta.reset({
      modoDias: 'lv',
      diasSemana: [1, 2, 3, 4, 5],
      horaDesde: '',
      horaHasta: '',
      modoInicio: 'hoy',
      vigenciaDesde: '',
      modoFin: 'sin-fin',
      vigenciaHasta: '',
    });
    this.altaAbierta.set(true);
    // El foco se va con el panel: sin esto, quien navega por teclado aprieta "Agregar" y el
    // foco se queda en el boton, con el formulario reciente varios saltos mas abajo.
    afterNextRender(() => this.enfocar('#alta-bloque-desde'), { injector: this.injector });
  }

  /** Marca o desmarca un dia en el modo personalizado. */
  protected alternarDia(dia: number): void {
    const control = this.formularioAlta.controls.diasSemana;
    control.setValue(alternarDia(control.value, dia));
    control.markAsTouched();
  }

  protected alternarIntervalo(): void {
    this.intervalo.set(this.otroIntervalo());
  }

  /** "Seleccioná al menos un día", cuando corresponde mostrarlo. */
  protected faltanDias(): boolean {
    const control = this.formularioAlta.controls.diasSemana;
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected idErrorDeDias(): string | null {
    return this.faltanDias() ? 'alta-bloque-dias-error' : null;
  }

  /** Los días del 409 de solapamiento o de fuera de horario de la sede, para marcar sus pastillas. */
  protected readonly diasEnConflicto = computed<ReadonlySet<number>>(() => {
    if (this.causaAccion() === 'fuera-de-horario-sede') {
      return new Set(this.fueraDeHorario().map((franja) => franja.diaSemana));
    }
    const dia = this.conflicto()?.diaSemana;
    return new Set(dia === undefined || dia === null ? [] : [dia]);
  });

  /**
   * El unico mensaje de la fila de horas: hora invalida, fin antes del inicio, o el 409 de
   * solapamiento tal como lo redacta `bloque-errors.ts`. Uno a la vez y en una linea.
   */
  protected errorDeHoras(alta: boolean): string | null {
    const formulario = alta ? this.formularioAlta : this.formularioEdicion;
    const tocado =
      this.intentos() > 0 ||
      formulario.controls.horaDesde.touched ||
      formulario.controls.horaHasta.touched;
    if (
      tocado &&
      (formulario.controls.horaDesde.invalid || formulario.controls.horaHasta.invalid)
    ) {
      return 'Ingresá una hora válida';
    }
    if (this.intentos() > 0 && formulario.errors?.['rango'] === true) {
      return 'La hora de fin debe ser posterior al inicio';
    }
    if (this.solapado()) {
      return this.errorAccion();
    }
    return null;
  }

  /** El mensaje de la vigencia del alta: fecha que falta, o fin anterior al inicio. */
  protected errorDeVigencia(alta: boolean): string | null {
    if (!alta || this.intentos() === 0) {
      return null;
    }
    const errores = this.formularioAlta.errors;
    if (errores?.['inicio'] === true) {
      return 'Elegí la fecha de inicio';
    }
    if (errores?.['fin'] === true) {
      return 'Elegí la fecha de fin';
    }
    if (errores?.['vigencia'] === true) {
      return 'El fin debe ser posterior al inicio';
    }
    return null;
  }

  protected panelAbierto(id: number | undefined, tipo: TipoAccion): boolean {
    const panel = this.panel();
    return panel !== null && panel.id === id && panel.tipo === tipo;
  }

  protected abrirPanel(bloque: BloqueResponse, tipo: TipoAccion): void {
    const id = bloque.id;
    if (id === undefined) {
      return;
    }

    this.cerrarPanel();
    this.altaAbierta.set(false);
    this.panel.set({ id, tipo });

    if (tipo === 'editar') {
      this.original.set(bloque);
      this.formularioEdicion.reset({
        diaSemana: String(bloque.diaSemana ?? 1),
        // Las horas se cargan tal como llegaron. Un `24:00` reformateado por un control de
        // fecha vuelve como `00:00` y el bloque pasa a durar cero minutos.
        horaDesde: bloque.horaDesde ?? '',
        horaHasta: bloque.horaHasta ?? '',
        vigenciaDesde: bloque.vigenciaDesde ?? '',
        vigenciaHasta: bloque.vigenciaHasta ?? '',
        limpiarVigenciaHasta: false,
      });
      afterNextRender(() => this.enfocar('#editar-bloque-dia'), { injector: this.injector });
    } else {
      this.consultarImpactoDeBaja(id);
    }
  }

  protected cerrarPanel(): void {
    this.panel.set(null);
    this.original.set(null);
    this.enviando.set(false);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.conflicto.set(null);
    this.intentos.set(0);
    this.impacto.set(null);
    this.claveDelImpacto = null;
  }

  protected cerrarAlta(): void {
    this.altaAbierta.set(false);
    this.enviando.set(false);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.conflicto.set(null);
    this.intentos.set(0);
  }

  // =====================================================================================
  // Mutaciones
  // =====================================================================================

  protected enviarAlta(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const membershipId = this.membershipElegido();
    if (consultorioId === null || membershipId === null || this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);
    if (this.formularioAlta.invalid) {
      this.formularioAlta.markAllAsTouched();
      this.enfocar('#alta-bloque-desde');
      return;
    }

    const valores = this.formularioAlta.getRawValue();
    const dias = [...valores.diasSemana].sort((uno, otro) => uno - otro);
    const cuerpo: CreateBloquesRequest = {
      diasSemana: dias,
      // Los strings van tal cual: `24:00` es el valor del contrato, no un error de carga.
      horaDesde: valores.horaDesde.trim(),
      horaHasta: valores.horaHasta.trim(),
    };
    // Omitir `vigenciaDesde` significa HOY, que es lo que quiere quien carga el horario de
    // alguien que ya esta atendiendo. Las fechas solo cuentan si su modo las pide: una fecha que
    // quedo escrita y despues se volvio a "Desde hoy" no viaja.
    if (valores.modoInicio === 'fecha' && valores.vigenciaDesde !== '') {
      cuerpo.vigenciaDesde = valores.vigenciaDesde;
    }
    if (valores.modoFin === 'fecha' && valores.vigenciaHasta !== '') {
      cuerpo.vigenciaHasta = valores.vigenciaHasta;
    }

    this.empezarEnvio();

    // Un solo pedido para todos los dias, atomico en el backend: si un dia se pisa, no se guarda
    // ninguno y el 409 nombra el dia (RF-M05-003, lote desde el contrato 0.159.0).
    this.disponibilidad
      .createBloquesDisponibilidad({ consultorioId, membershipId, createBloquesRequest: cuerpo })
      .subscribe({
        next: (resultado) => {
          this.cerrarAlta();
          const cuando = `${describirDias(dias)} de ${rangoHorario(cuerpo.horaDesde, cuerpo.horaHasta)}`;
          if (resultado.creados === 0) {
            this.avisos.exito('Ese horario ya estaba cargado', {
              descripcion: `${this.nombreDelProfesional()}: ${cuando}`,
            });
          } else {
            const bloques = resultado.creados === 1 ? '1 bloque' : `${resultado.creados} bloques`;
            this.avisos.exito('Horario agregado', {
              descripcion: `${this.nombreDelProfesional()}: ${cuando} (${bloques})`,
            });
          }
          this.cargar();
        },
        error: (error: unknown) => this.fallar(error),
      });
  }

  /**
   * Envia solo lo que cambio, mas la `version`.
   *
   * <p>`version` es obligatoria y se compara ANTES de mutar: si quedo vieja, el backend
   * responde `409 conflict` y no se pisa nada. Los campos omitidos no se tocan, y
   * `limpiarVigenciaHasta` existe porque un `null` no puede expresar la diferencia entre "no
   * toques el fin" y "sacale el fin".
   */
  protected enviarEdicion(): void {
    const panel = this.panel();
    const consultorioId = this.tenantContext.consultorioId();
    const membershipId = this.membershipElegido();
    if (panel === null || consultorioId === null || membershipId === null || this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);
    if (this.formularioEdicion.invalid) {
      this.formularioEdicion.markAllAsTouched();
      this.enfocar('#editar-bloque-desde');
      return;
    }

    const cambios = this.armarCambios();
    if (cambios === null) {
      return;
    }

    const clave = claveDeCambios(cambios);
    if (this.edicionConImpacto() && this.claveDelImpacto === clave) {
      this.guardarEdicion(panel.id, consultorioId, membershipId, cambios);
      return;
    }

    this.consultarImpactoDeEdicion(panel.id, consultorioId, membershipId, cambios, clave);
  }

  /**
   * Consulta sin efectos de la edicion escrita. Si no deja ningun turno afuera, guarda.
   *
   * <p>El cuerpo es el mismo de la edicion sin `version`: la consulta no compara versiones
   * (diseno A-11, decision 3), la mutacion si.
   */
  private consultarImpactoDeEdicion(
    bloqueId: number,
    consultorioId: number,
    membershipId: number,
    cambios: UpdateBloqueRequest,
    clave: string,
  ): void {
    this.empezarEnvio();
    this.impacto.set({ tipo: 'consultando' });
    this.claveDelImpacto = clave;

    this.disponibilidad
      .simularImpactoEdicionBloque({
        consultorioId,
        membershipId,
        bloqueId,
        simularEdicionBloqueRequest: sinVersion(cambios),
      })
      .subscribe({
        next: (impacto) => {
          if (this.panel()?.id !== bloqueId || this.claveDelImpacto !== clave) {
            return;
          }
          this.impacto.set({ tipo: 'listo', impacto });
          if ((impacto.turnosAfectados ?? 0) <= 0) {
            this.guardarEdicion(bloqueId, consultorioId, membershipId, cambios);
            return;
          }
          this.enviando.set(false);
        },
        error: (error: unknown) => {
          if (this.panel()?.id === bloqueId) {
            this.fallarConsulta(error);
          }
        },
      });
  }

  private guardarEdicion(
    bloqueId: number,
    consultorioId: number,
    membershipId: number,
    cambios: UpdateBloqueRequest,
  ): void {
    const previsto = turnosPrevistos(this.impacto());
    const clave = this.claveDelImpacto;
    this.empezarEnvio();

    this.disponibilidad
      .updateBloqueDisponibilidad({
        consultorioId,
        membershipId,
        bloqueId,
        // Ya se mostro que deja turnos afuera y se volvio a enviar: eso es la confirmacion.
        updateBloqueRequest:
          (previsto ?? 0) > 0 ? { ...cambios, confirmaTurnosAfectados: true } : cambios,
      })
      .subscribe({
        next: (bloque) => {
          this.cerrarPanel();
          this.publicarResultado(
            'Cambios del bloque guardados',
            avisoDeTurnosAfectados(bloque.turnosAfectados, previsto),
          );
          this.cargar();
        },
        error: (error: unknown) => {
          if (this.mostrarTurnosDelRechazo(error)) {
            this.claveDelImpacto = clave;
            return;
          }
          this.fallar(error);
        },
      });
  }

  /**
   * Un 409 `bloqueo-con-turnos-afectados`: entro un turno despues de la consulta, o la consulta no se
   * pudo hacer. Se muestra la lista que trae y el proximo envio confirma. Devuelve si era eso.
   */
  private mostrarTurnosDelRechazo(error: unknown): boolean {
    const impacto = impactoDelRechazo(error);
    if (impacto === null) {
      return false;
    }
    this.enviando.set(false);
    this.impacto.set({ tipo: 'listo', impacto });
    this.errorAccion.set(
      'Este cambio deja turnos fuera del horario. Revisalos abajo y confirmá de nuevo para guardarlo igual: los turnos no se cancelan.',
    );
    return true;
  }

  /**
   * Da de baja el bloque del panel abierto.
   *
   * <p>El motivo llega ya validado y recortado desde {@link ConfirmacionConMotivo}: que el
   * campo sea obligatorio, el foco al abrir y el `aria-describedby` del error son de la
   * primitiva, porque no dependen de que lo que se da de baja sea un bloque de horario.
   *
   * <p><b>No hay reactivacion.</b> El contrato no publica ninguna operacion que lo deshaga: un
   * bloque que vuelve es una regla nueva.
   */
  protected enviarBaja(motivo: string): void {
    const panel = this.panel();
    const consultorioId = this.tenantContext.consultorioId();
    const membershipId = this.membershipElegido();
    if (panel === null || consultorioId === null || membershipId === null || this.enviando()) {
      return;
    }

    const previsto = turnosPrevistos(this.impacto());
    this.empezarEnvio();

    this.disponibilidad
      .deactivateBloqueDisponibilidad({
        consultorioId,
        membershipId,
        bloqueId: panel.id,
        deactivateBloqueRequest: {
          reason: motivo,
          confirmaTurnosAfectados: (previsto ?? 0) > 0 ? true : undefined,
        },
      })
      .subscribe({
        next: (bloque) => {
          this.cerrarPanel();
          this.publicarResultado(
            'Bloque dado de baja',
            avisoDeTurnosAfectados(bloque.turnosAfectados, previsto),
            'Sobrevive con su motivo y su autor en la auditoría.',
          );
          this.cargar();
        },
        error: (error: unknown) => {
          if (!this.mostrarTurnosDelRechazo(error)) {
            this.fallar(error);
          }
        },
      });
  }

  /** Consulta sin efectos de la baja, al abrir el panel: no hay nada que escribir antes. */
  private consultarImpactoDeBaja(bloqueId: number): void {
    const consultorioId = this.tenantContext.consultorioId();
    const membershipId = this.membershipElegido();
    if (consultorioId === null || membershipId === null) {
      return;
    }

    this.impacto.set({ tipo: 'consultando' });

    this.disponibilidad
      .simularImpactoBajaBloque({ consultorioId, membershipId, bloqueId })
      .subscribe({
        next: (impacto) => {
          if (this.panelAbierto(bloqueId, 'baja')) {
            this.impacto.set({ tipo: 'listo', impacto });
          }
        },
        error: (error: unknown) => {
          if (this.panelAbierto(bloqueId, 'baja')) {
            this.fallarConsulta(error);
          }
        },
      });
  }

  /**
   * Fallo de una consulta previa.
   *
   * <p>Si la mutacion fallaria por lo mismo —el bloque ya esta dado de baja (`409`), no existe,
   * el cuerpo es invalido, falta contexto o permiso— se informa como el error de la operacion:
   * dejar confirmar algo que ya sabemos que va a rebotar es gastarle un viaje al usuario.
   * Cualquier otra falla no frena: se dice que no se pudo calcular y se deja confirmar igual,
   * porque la consulta informa y no decide (ADR-0011).
   */
  private fallarConsulta(error: unknown): void {
    if (FRENAN_LA_MUTACION.has(traducirErrorBloque(error).causa)) {
      this.impacto.set(null);
      this.claveDelImpacto = null;
      this.fallar(error);
      return;
    }
    this.enviando.set(false);
    this.impacto.set({ tipo: 'error' });
  }

  private armarCambios(): UpdateBloqueRequest | null {
    const original = this.original();
    const version = original?.version;
    if (original === null || version === undefined) {
      // Sin `version` no hay edicion posible: mandar `0` pisaria el cambio de otro, que es
      // exactamente lo que el control de concurrencia optimista existe para impedir.
      this.errorAccion.set(
        'No pudimos leer la versión de este bloque. Cerra el panel, recarga el horario y volvé a intentar.',
      );
      return null;
    }

    const valores = this.formularioEdicion.getRawValue();
    const cambios: UpdateBloqueRequest = { version };

    const dia = Number(valores.diaSemana);
    if (dia !== original.diaSemana) {
      cambios.diaSemana = dia;
    }

    const desde = valores.horaDesde.trim();
    if (desde !== (original.horaDesde ?? '')) {
      cambios.horaDesde = desde;
    }

    const hasta = valores.horaHasta.trim();
    if (hasta !== (original.horaHasta ?? '')) {
      cambios.horaHasta = hasta;
    }

    if (valores.vigenciaDesde !== '' && valores.vigenciaDesde !== (original.vigenciaDesde ?? '')) {
      cambios.vigenciaDesde = valores.vigenciaDesde;
    }

    if (valores.limpiarVigenciaHasta) {
      // Con la bandera puesta el backend IGNORA `vigenciaHasta`: mandarlo igual solo
      // confundiria a quien lea el request en un log.
      cambios.limpiarVigenciaHasta = true;
    } else if (
      valores.vigenciaHasta !== '' &&
      valores.vigenciaHasta !== (original.vigenciaHasta ?? '')
    ) {
      cambios.vigenciaHasta = valores.vigenciaHasta;
    }

    return cambios;
  }

  /**
   * Resultado de una edicion o una baja (UX-12): el exito y, si la mutacion dejo turnos fuera de
   * horario, un aviso de atencion que queda hasta que lo cierren. Es la otra mitad del mismo
   * resultado y el numero es el de la respuesta de la mutacion, no el de la consulta previa: ver
   * `turnos-afectados.ts`.
   */
  private publicarResultado(
    titulo: string,
    turnosParaRevisar: string | null,
    descripcion?: string,
  ): void {
    this.avisos.exito(titulo, { descripcion });
    if (turnosParaRevisar !== null) {
      this.avisos.advertencia('Turnos para revisar', {
        descripcion: turnosParaRevisar,
        duracion: null,
      });
    }
  }

  private empezarEnvio(): void {
    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.conflicto.set(null);
  }

  /**
   * Falla de cualquiera de las tres mutaciones.
   *
   * <p>El solapamiento <b>deja el panel abierto</b> y guarda el bloque en conflicto: cerrarlo
   * obligaria a reescribir todo para leer el mensaje, y la correccion es justamente sobre lo
   * que quedo escrito.
   */
  private fallar(error: unknown): void {
    const traducido = traducirErrorBloque(error);
    this.enviando.set(false);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);
    this.conflicto.set(traducido.conflicto);
    this.fueraDeHorario.set(traducido.fueraDeHorario ?? []);

    if (traducido.causa === 'bloque-inactivo') {
      // Un bloque dado de baja no admite ediciones: el formulario se apaga en vez de dejar al
      // usuario reenviando algo que ya sabemos que va a fallar igual.
      this.formularioEdicion.disable();
    }
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }

  /**
   * Un formulario de bloque: mismo shape para el alta y para la edicion.
   *
   * <p>Las horas son texto y no `type="time"`, y el validador es propio: ver
   * `horas-de-pared.ts`. El validador de grupo comprueba que el fin sea <b>posterior</b> al
   * inicio; que dos bloques distintos se toquen en un extremo no se valida aca ni en ningun
   * lado, porque es legitimo.
   */
  private nuevoFormulario() {
    return this.formBuilder.nonNullable.group(
      {
        diaSemana: ['1', [Validators.required]],
        horaDesde: ['', [Validators.required, validadorDeHora]],
        horaHasta: ['', [Validators.required, validadorDeHora]],
        vigenciaDesde: [''],
        vigenciaHasta: [''],
        limpiarVigenciaHasta: [false],
      },
      { validators: [validadorDeRango] },
    );
  }
}

/** Causas de falla de la consulta previa que la mutacion tendria igual. */
const FRENAN_LA_MUTACION: ReadonlySet<CausaBloque> = new Set<CausaBloque>([
  'bloque-inactivo',
  'ya-inactivo',
  'no-encontrado',
  'validacion',
  'sin-contexto',
  'sin-permiso',
]);

/** El cuerpo de la consulta previa: el de la edicion sin `version`. */
function sinVersion(cambios: UpdateBloqueRequest): SimularEdicionBloqueRequest {
  const simulacion: SimularEdicionBloqueRequest & { version?: number } = { ...cambios };
  delete simulacion.version;
  return simulacion;
}

/** Identidad de lo escrito, para saber si el impacto mostrado sigue describiendolo. */
function claveDeCambios(cambios: UpdateBloqueRequest): string {
  return JSON.stringify(sinVersion(cambios));
}

/** Ordena por hora de inicio. `24:00` compara como 1440, sin ningun caso especial. */
function porHoraDeInicio(uno: BloqueResponse, otro: BloqueResponse): number {
  return (minutosDeHora(uno.horaDesde ?? '') ?? 0) - (minutosDeHora(otro.horaDesde ?? '') ?? 0);
}

/** `Validators.pattern` no serviria: el patron admite `24:00`, que ningun regex de hora tiene. */
function validadorDeHora(control: AbstractControl): ValidationErrors | null {
  const valor = typeof control.value === 'string' ? control.value.trim() : '';
  if (valor === '') {
    return null;
  }
  return esHoraDePared(valor) ? null : { hora: true };
}

/**
 * El fin tiene que ser posterior al inicio.
 *
 * <p>Un bloque nunca cruza al dia siguiente: si el fin es menor o igual que el inicio, lo que
 * el usuario quiso decir no se puede expresar con un solo bloque y el backend lo rechazaria
 * con un `400`. Se avisa antes para no gastar ese rechazo.
 */
function validadorDeRango(grupo: AbstractControl): ValidationErrors | null {
  const valores = grupo.value as { horaDesde?: string; horaHasta?: string };
  const desde = minutosDeHora((valores.horaDesde ?? '').trim());
  const hasta = minutosDeHora((valores.horaHasta ?? '').trim());
  if (desde === null || hasta === null) {
    return null;
  }
  return hasta > desde ? null : { rango: true };
}

/** Al menos un dia: una lista vacia no es un horario. */
function validadorDeDias(control: AbstractControl): ValidationErrors | null {
  const dias = control.value;
  return Array.isArray(dias) && dias.length > 0 ? null : { dias: true };
}

/**
 * La vigencia del alta: una fecha pedida por su modo tiene que estar, y el fin tiene que ser
 * posterior al inicio. Las fechas de un modo que no las pide no se miran: quedaron escritas de
 * antes y no viajan.
 */
function validadorDeVigencia(grupo: AbstractControl): ValidationErrors | null {
  const valores = grupo.value as {
    modoInicio?: string;
    vigenciaDesde?: string;
    modoFin?: string;
    vigenciaHasta?: string;
  };
  const desde = valores.modoInicio === 'fecha' ? (valores.vigenciaDesde ?? '') : '';
  const hasta = valores.modoFin === 'fecha' ? (valores.vigenciaHasta ?? '') : '';
  if (valores.modoInicio === 'fecha' && desde === '') {
    return { inicio: true };
  }
  if (valores.modoFin === 'fecha' && hasta === '') {
    return { fin: true };
  }
  if (desde !== '' && hasta !== '' && hasta <= desde) {
    return { vigencia: true };
  }
  return null;
}
