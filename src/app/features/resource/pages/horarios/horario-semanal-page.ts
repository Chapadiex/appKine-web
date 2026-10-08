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

import { BloqueResponse } from '../../../../api/generated/model/bloque-response';
import { ColaboradoresService } from '../../../../api/generated/api/colaboradores.service';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { CreateBloqueRequest } from '../../../../api/generated/model/create-bloque-request';
import { DisponibilidadProfesionalService } from '../../../../api/generated/api/disponibilidad-profesional.service';
import { EstadoDeListado, vistaDeListado } from '../../../../shared/utils/estado-de-listado';
import { MembershipResponse } from '../../../../api/generated/model/membership-response';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTAS_HORARIOS } from '../../models/rutas-de-horarios';
import { leerParametrosDeHorarios } from '../../models/parametros-de-horarios';
import { traducirErrorHorarioEfectivo } from '../../models/horario-efectivo-errors';
import { TEXTO_MODO_LECTURA, modoLectura } from '../../models/modo-lectura';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { UpdateBloqueRequest } from '../../../../api/generated/model/update-bloque-request';
import { BloqueEnConflicto, CausaBloque, traducirErrorBloque } from '../../models/bloque-errors';
import { DIAS_DE_LA_SEMANA, etiquetaDeDia } from '../../../../shared/utils/dias-de-la-semana';
import { avisoDeTurnosAfectados } from '../../models/turnos-afectados';
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
  imports: [ReactiveFormsModule, RouterLink, PermisoDirective, ConfirmacionConMotivo],
  templateUrl: './horario-semanal-page.html',
  styleUrl: '../../resource.css',
})
export class HorarioSemanalPage {
  private readonly disponibilidad = inject(DisponibilidadProfesionalService);
  private readonly colaboradores = inject(ColaboradoresService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly injector = inject(Injector);

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

  protected readonly permisoManage = PERMISO_CONSULTORIO_MANAGE;
  protected readonly rutas = RUTAS_HORARIOS;
  protected readonly textoModoLectura = TEXTO_MODO_LECTURA;
  protected readonly textoListaIncompleta = TEXTO_LISTA_INCOMPLETA;
  protected readonly modoLectura = modoLectura(inject(PermissionsStore));
  protected readonly patronHora = PATRON_HORA;
  protected readonly horaMedianoche = HORA_MEDIANOCHE;
  protected readonly dias = DIAS_DE_LA_SEMANA;
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

  /** Bloque tal como lo devolvio el backend: es de donde sale la `version` del `PUT`. */
  private readonly original = signal<BloqueResponse | null>(null);

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaBloque | null>(null);
  protected readonly exito = signal<string | null>(null);
  protected readonly intentos = signal(0);

  /**
   * Turnos que la ultima edicion o baja pudo dejar fuera de horario, ya redactado, o `null`.
   *
   * <p>Vive al lado de {@link exito} y se limpia con el: es la otra mitad del mismo resultado.
   * Ver `turnos-afectados.ts` por que el texto dice "hasta".
   */
  protected readonly avisoTurnos = signal<string | null>(null);

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

  /** Errores que solo se resuelven releyendo el horario. */
  protected readonly hayQueRecargar = computed(() => {
    const causa = this.causaAccion();
    return causa === 'no-encontrado' || causa === 'ya-inactivo' || causa === 'concurrencia';
  });

  protected readonly formularioAlta = this.nuevoFormulario();
  protected readonly formularioEdicion = this.nuevoFormulario();

  constructor() {
    effect(() => {
      // Dependencia explicita: cualquier cambio de contexto invalida todo lo que hay abierto.
      this.tenantContext.contextEpoch();
      untracked(() => {
        const inicial = this.membershipInicial;
        this.membershipInicial = null;

        this.cerrarPanel();
        this.altaAbierta.set(false);
        this.exito.set(null);
        this.avisoTurnos.set(null);
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
    this.exito.set(null);
    this.avisoTurnos.set(null);

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

  // =====================================================================================
  // Paneles
  // =====================================================================================

  protected abrirAlta(): void {
    this.cerrarPanel();
    this.exito.set(null);
    this.avisoTurnos.set(null);
    this.formularioAlta.reset({
      diaSemana: '1',
      horaDesde: '',
      horaHasta: '',
      vigenciaDesde: '',
      vigenciaHasta: '',
      limpiarVigenciaHasta: false,
    });
    this.altaAbierta.set(true);
    // El foco se va con el panel: sin esto, quien navega por teclado aprieta "Agregar" y el
    // foco se queda en el boton, con el formulario reciente varios saltos mas abajo.
    afterNextRender(() => this.enfocar('#alta-bloque-dia'), { injector: this.injector });
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
    this.exito.set(null);
    this.avisoTurnos.set(null);
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
  }

  protected cerrarAlta(): void {
    this.altaAbierta.set(false);
    this.enviando.set(false);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.conflicto.set(null);
    this.intentos.set(0);
  }

  /** Si el campo de un formulario tiene que mostrar su error. */
  protected mostrarError(alta: boolean, campo: 'diaSemana' | 'horaDesde' | 'horaHasta'): boolean {
    const control = (alta ? this.formularioAlta : this.formularioEdicion).controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  /** Si el rango horario del formulario esta invertido o vacio. */
  protected rangoInvertido(alta: boolean): boolean {
    const formulario = alta ? this.formularioAlta : this.formularioEdicion;
    return formulario.errors?.['rango'] === true && this.intentos() > 0;
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
    const cuerpo: CreateBloqueRequest = {
      diaSemana: Number(valores.diaSemana),
      // Los strings van tal cual: `24:00` es el valor del contrato, no un error de carga.
      horaDesde: valores.horaDesde.trim(),
      horaHasta: valores.horaHasta.trim(),
    };
    // Omitir `vigenciaDesde` significa HOY, que es lo que quiere quien carga el horario de
    // alguien que ya esta atendiendo. Mandar una fecha vacia seria un 400.
    if (valores.vigenciaDesde !== '') {
      cuerpo.vigenciaDesde = valores.vigenciaDesde;
    }
    if (valores.vigenciaHasta !== '') {
      cuerpo.vigenciaHasta = valores.vigenciaHasta;
    }

    this.empezarEnvio();

    this.disponibilidad
      .createBloqueDisponibilidad({ consultorioId, membershipId, createBloqueRequest: cuerpo })
      .subscribe({
        next: () => {
          this.cerrarAlta();
          this.exito.set('El bloque quedo cargado en el horario semanal.');
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

    this.empezarEnvio();

    this.disponibilidad
      .updateBloqueDisponibilidad({
        consultorioId,
        membershipId,
        bloqueId: panel.id,
        updateBloqueRequest: cambios,
      })
      .subscribe({
        next: (bloque) => {
          this.cerrarPanel();
          this.exito.set('Los cambios del bloque quedaron guardados.');
          this.avisoTurnos.set(avisoDeTurnosAfectados(bloque.turnosAfectados));
          this.cargar();
        },
        error: (error: unknown) => this.fallar(error),
      });
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

    this.empezarEnvio();

    this.disponibilidad
      .deactivateBloqueDisponibilidad({
        consultorioId,
        membershipId,
        bloqueId: panel.id,
        deactivateBloqueRequest: { reason: motivo },
      })
      .subscribe({
        next: (bloque) => {
          this.cerrarPanel();
          this.exito.set(
            'El bloque quedo dado de baja. La fila no se borra: sobrevive con su motivo y su ' +
              'autor en la auditoria.',
          );
          this.avisoTurnos.set(avisoDeTurnosAfectados(bloque.turnosAfectados));
          this.cargar();
        },
        error: (error: unknown) => this.fallar(error),
      });
  }

  private armarCambios(): UpdateBloqueRequest | null {
    const original = this.original();
    const version = original?.version;
    if (original === null || version === undefined) {
      // Sin `version` no hay edicion posible: mandar `0` pisaria el cambio de otro, que es
      // exactamente lo que el control de concurrencia optimista existe para impedir.
      this.errorAccion.set(
        'No pudimos leer la version de este bloque. Cerra el panel, recarga el horario y volve a intentar.',
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

  private empezarEnvio(): void {
    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.conflicto.set(null);
    this.exito.set(null);
    this.avisoTurnos.set(null);
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
