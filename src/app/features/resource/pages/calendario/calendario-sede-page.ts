import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { CalendarioDeSedeService } from '../../../../api/generated/api/calendario-de-sede.service';
import { CalendarioSedeResponse } from '../../../../api/generated/model/calendario-sede-response';
import { ImpactoDisponibilidadResponse } from '../../../../api/generated/model/impacto-disponibilidad-response';
import { formatearInstante } from '../../../../shared/utils/instantes';
import { avisoDeHorarioDeSede, notaDeListaRecortada } from '../../models/turnos-afectados';
import { EstadoDeListado, vistaDeListado } from '../../../../shared/utils/estado-de-listado';
import { FeriadoResponse } from '../../../../api/generated/model/feriado-response';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTAS_HORARIOS } from '../../models/rutas-de-horarios';
import {
  ParametrosDeHorarios,
  SIN_PARAMETROS,
  leerParametrosDeHorarios,
} from '../../models/parametros-de-horarios';
import { TEXTO_MODO_LECTURA, modoLectura, puedeGestionar } from '../../models/modo-lectura';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { etiquetaDeTipoDeFeriado } from '../../models/tipos-de-feriado';
import { traducirErrorExcepcion } from '../../models/excepcion-errors';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { EditorDeFranjas } from '../../../../shared/components/editor-de-franjas/editor-de-franjas';
import { etiquetaDeDia } from '../../../../shared/utils/dias-de-la-semana';
import { rangoHorario } from '../../../../shared/utils/horas-de-pared';
import {
  FranjaSemanal,
  crearFranjasForm,
  erroresDeFranjasDelServidor,
  franjasDelFormulario,
  reemplazarFranjas,
} from '../../../../shared/utils/franjas-semanales';
import {
  MAXIMO_DIAS_VENTANA,
  diasEntre,
  esFechaDeCalendario,
  etiquetaDeFecha,
  hoyLocal,
  sumarDias,
} from '../../models/ventana-de-fechas';

/** Ventana propuesta al entrar: el año que viene, que es donde estan los feriados que importan. */
const DIAS_PROPUESTOS = 365;

/**
 * Politica de feriados de la sede y feriados de la ventana (M05, AKINE-02.04).
 *
 * <p>Responde una sola pregunta de negocio —<b>¿esta sede cierra los feriados de su pais?</b>—
 * y muestra al lado cuales son esos feriados, porque una politica sin la lista que la ejecuta
 * es un interruptor a ciegas.
 *
 * <h2>Lo que esta pantalla no puede aplanar</h2>
 *
 * <p><b>1. Apagar el interruptor no es "no hacer nada".</b> Con `cierraPorFeriado` en false la
 * sede pasa a <b>atender los feriados</b>, hacia adelante y hacia atras, salvo que exista un
 * cierre explicito. Un switch pelado deja al administrador adivinando que acaba de cambiar, asi
 * que la consecuencia se dice en pantalla —antes y despues de guardar— con esas palabras.
 *
 * <p><b>2. La edicion tiene semantica de PATCH aunque el verbo sea PUT.</b> Un campo omitido
 * queda como estaba. Por eso el guardado manda <b>solo</b> `cierraPorFeriado`: mandar `pais` de
 * paso convertiria un cambio de politica en un cambio de calendario nacional.
 *
 * <p><b>3. El PUT devuelve la lista de feriados VACIA</b>, y vacia significa "no se pregunto",
 * nunca "no hay feriados": el PUT no tiene ventana. Si la respuesta del guardado pisara la
 * lista, la pantalla se quedaria sin feriados justo despues de tocar la politica que los rige.
 * Aca el guardado actualiza la politica y <b>no toca</b> la lista.
 *
 * <p><b>4. No hay control de concurrencia.</b> La fila se crea a demanda y la edicion no lleva
 * `version`: dos administradores que guardan a la vez no producen conflicto y gana el segundo.
 * La `version` se muestra igual, porque es lo unico que permite notar que alguien mas la
 * cambio.
 */
@Component({
  selector: 'app-calendario-sede-page',
  imports: [ReactiveFormsModule, RouterLink, PermisoDirective, EditorDeFranjas],
  templateUrl: './calendario-sede-page.html',
  styleUrl: '../../resource.css',
})
export class CalendarioSedePage {
  private readonly calendario = inject(CalendarioDeSedeService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly formBuilder = inject(FormBuilder);
  private readonly permisos = inject(PermissionsStore);

  /** La ventana del enlace que trajo hasta aca, si vino de uno. Se consume una sola vez. */
  private parametros: ParametrosDeHorarios = leerParametrosDeHorarios(
    inject(ActivatedRoute).snapshot.queryParamMap,
  );

  protected readonly permisoManage = PERMISO_CONSULTORIO_MANAGE;
  protected readonly rutas = RUTAS_HORARIOS;
  protected readonly textoModoLectura = TEXTO_MODO_LECTURA;
  protected readonly etiquetaDeTipoDeFeriado = etiquetaDeTipoDeFeriado;

  /**
   * Modo lectura: consta que falta `consultorio:manage`.
   *
   * <p>Esta pantalla es la unica de las cuatro donde ocultar el boton <b>no alcanza</b>. La
   * casilla `cierraPorFeriado` no es una accion: es el <b>dato</b>, y por eso tiene que seguir
   * viendose. Pero si queda viva, quien no puede guardar la marca, lee "La sede pasa a atender
   * los feriados" y "Hay un cambio sin guardar" —dos afirmaciones falsas— y no tiene ningun
   * boton con el que resolverlo. Por eso la casilla se <b>deshabilita</b> y el cartel explica
   * que falta.
   */
  protected readonly modoLectura = modoLectura(this.permisos);

  /** `true` solo cuando consta que el permiso esta. Con permisos desconocidos, `false`. */
  protected readonly puedeGestionar = puedeGestionar(this.permisos);
  protected readonly maximoDias = MAXIMO_DIAS_VENTANA;
  protected readonly etiquetaDeFecha = etiquetaDeFecha;

  protected readonly nombreDeLaSede = computed(
    () => this.tenantContext.context()?.consultorioName ?? 'la sede activa',
  );

  /** La politica tal como la devolvio el backend. Nunca se pisa con la respuesta del PUT. */
  protected readonly politica = signal<CalendarioSedeResponse | null>(null);

  protected readonly estado = signal<EstadoDeListado<{ readonly content: FeriadoResponse[] }>>({
    tipo: 'inicial',
  });

  private readonly vista = vistaDeListado<FeriadoResponse>(this.estado);
  protected readonly feriados = this.vista.filas;
  protected readonly mensajeError = this.vista.mensajeError;
  protected readonly faltaContexto = this.vista.faltaContexto;

  protected readonly ventanaConsultada = signal<{
    readonly desde: string;
    readonly hasta: string;
  } | null>(null);

  protected readonly errorVentana = signal<string | null>(null);
  protected readonly guardando = signal(false);
  protected readonly errorPolitica = signal<string | null>(null);
  protected readonly exito = signal<string | null>(null);

  protected readonly formularioVentana = this.formBuilder.nonNullable.group({
    desde: ['', [Validators.required]],
    hasta: ['', [Validators.required]],
  });

  /**
   * Arranca <b>deshabilitada</b> y la habilita el `effect` del constructor cuando consta el
   * permiso. Al reves —viva y deshabilitandose despues— existiria una ventana, corta pero real,
   * en la que un profesional puede marcarla antes de que lleguen los permisos.
   */
  protected readonly formularioPolitica = this.formBuilder.nonNullable.group({
    cierraPorFeriado: [{ value: true, disabled: true }],
  });

  /**
   * Horario general de la sede (A-8, RF-M03-003): la lista que se edita.
   *
   * <p>Es <b>informativo</b>: la agenda ofrece turnos con la disponibilidad de cada profesional,
   * no con esto (RN-M03-004). La pantalla lo dice, porque un horario general "de 9 a 18" invita a
   * creer que fuera de esa franja no se puede reservar.
   */
  protected readonly formularioHorario = crearFranjasForm();
  /** Envoltorio para el `<form>`: `ngSubmit` es de `FormGroupDirective`, no de un `FormArray`. */
  protected readonly formularioHorarioGrupo = this.formBuilder.group({
    franjas: this.formularioHorario,
  });
  protected readonly guardandoHorario = signal(false);
  protected readonly intentosHorario = signal(0);
  protected readonly errorHorario = signal<string | null>(null);
  protected readonly erroresFranja = signal<ReadonlyMap<number, string>>(new Map());
  protected readonly exitoHorario = signal<string | null>(null);

  /**
   * Turnos pendientes que el ultimo guardado del horario dejo fuera (A-8b, DP-19), o `null`
   * cuando no dejo ninguno: en cero no se muestra nada. No se cancelan, solo se informan.
   */
  protected readonly impactoHorario = signal<ImpactoDisponibilidadResponse | null>(null);
  protected readonly avisoImpactoHorario = computed(() =>
    avisoDeHorarioDeSede(this.impactoHorario()),
  );
  protected readonly turnosImpactoHorario = computed(() => this.impactoHorario()?.turnos ?? []);
  protected readonly notaImpactoHorario = computed(() => {
    const impacto = this.impactoHorario();
    return impacto === null ? null : notaDeListaRecortada(impacto);
  });
  protected readonly formatearInstante = formatearInstante;

  /** El horario guardado, redactado: lo que ve quien no puede editarlo. */
  protected readonly horarioGuardado = computed(() =>
    (this.politica()?.horarioGeneral ?? []).map(
      (franja) =>
        `${etiquetaDeDia(franja.diaSemana)}: ${rangoHorario(franja.horaDesde, franja.horaHasta)}`,
    ),
  );

  /**
   * `true` mientras la casilla esta desmarcada, haya guardado o no.
   *
   * <p>Es lo que enciende la explicacion de la consecuencia: se muestra <b>antes</b> de guardar
   * —para que la decision se tome sabiendo que implica— y sigue visible despues, porque
   * describe el estado en el que quedo la sede.
   */
  protected quedaAbiertoEnFeriados(): boolean {
    return this.formularioPolitica.controls.cierraPorFeriado.value !== true;
  }

  /** `true` cuando lo que muestra la casilla difiere de lo guardado. */
  protected hayCambioSinGuardar(): boolean {
    const guardado = this.politica()?.cierraPorFeriado;
    if (guardado === undefined) {
      return false;
    }
    return guardado !== this.formularioPolitica.controls.cierraPorFeriado.value;
  }

  constructor() {
    // La casilla sigue al permiso, en los dos sentidos: un cambio de contexto puede quitarlo
    // tanto como darlo. `emitEvent: false` porque esto no es una edicion del usuario y no tiene
    // por que ensuciar el estado del formulario.
    effect(() => {
      const control = this.formularioPolitica.controls.cierraPorFeriado;
      if (this.puedeGestionar()) {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
    });

    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        // La ventana del enlace vale para la primera carga y se consume ahi. Ver
        // `parametros-de-horarios.ts`: el horario efectivo explica un dia cerrado por feriado y
        // ofrece venir a mirarlo, y con la ventana por defecto —un año desde hoy— un feriado ya
        // pasado no aparece en la lista a la que acaba de mandar.
        const inicial = this.parametros;
        this.parametros = SIN_PARAMETROS;

        this.politica.set(null);
        this.exito.set(null);
        this.errorPolitica.set(null);
        // El horario de la sede anterior no puede quedar en el editor bajo la sede nueva.
        reemplazarFranjas(this.formularioHorario, []);
        this.intentosHorario.set(0);
        this.limpiarAvisosDeHorario();
        this.proponerVentana(inicial);
        this.consultar();
      });
    });
  }

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
      this.errorVentana.set(
        'El fin de la ventana tiene que ser posterior al inicio, y es exclusivo: un feriado que cae justo ese dia no aparece.',
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

    this.calendario
      .getCalendarioSede({ consultorioId, desde, hasta })
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

        // Cambiar la ventana de feriados vuelve a leer la politica entera. Si el horario tiene
        // cambios sin guardar, no se pisan: la ventana no tiene nada que ver con el horario.
        // Se mide ANTES de pisar la politica, que es contra lo que se compara.
        const habiaCambios = this.hayCambiosEnHorario();
        this.politica.set(respuesta);
        // La casilla refleja lo guardado. `cierraPorFeriado` puede no venir: el default de una
        // sede sin fila propia es cerrar, que es lo conservador.
        this.formularioPolitica.setValue({
          cierraPorFeriado: respuesta.cierraPorFeriado !== false,
        });
        if (!habiaCambios) {
          this.cargarHorario(respuesta.horarioGeneral);
        }
        this.estado.set({ tipo: 'listo', pagina: { content: respuesta.feriados ?? [] } });
      });
  }

  /**
   * Guarda la politica.
   *
   * <p>Manda <b>solo</b> `cierraPorFeriado` —omitir un campo lo deja como estaba— y al volver
   * actualiza la politica sin tocar la lista de feriados, que en la respuesta del `PUT` viene
   * vacia porque el `PUT` no tiene ventana.
   */
  protected guardar(): void {
    // El boton vive detras de `*akinePermiso`, pero un formulario tambien se envia con Enter y
    // el `submit` no pasa por ningun boton. Sin esta guarda, el modo lectura dependeria de que
    // el usuario use el mouse.
    if (!this.puedeGestionar()) {
      return;
    }

    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null || this.guardando()) {
      return;
    }

    const cierraPorFeriado = this.formularioPolitica.getRawValue().cierraPorFeriado;

    this.guardando.set(true);
    this.errorPolitica.set(null);
    this.exito.set(null);

    this.calendario
      .updateCalendarioSede({ consultorioId, updateCalendarioRequest: { cierraPorFeriado } })
      .subscribe({
        next: (respuesta) => {
          this.guardando.set(false);
          // Se conserva la lista que ya estaba: la del PUT viene vacia y vacia significa "no se
          // pregunto", nunca "no hay feriados".
          this.politica.set({ ...respuesta, feriados: this.politica()?.feriados ?? [] });
          this.exito.set(
            cierraPorFeriado
              ? 'Listo: la sede vuelve a cerrar los feriados de su calendario.'
              : 'Listo: la sede pasa a atender los feriados. El horario habitual se aplica tambien esos dias, salvo que cargues un cierre explicito.',
          );
        },
        error: (error: unknown) => {
          this.guardando.set(false);
          this.errorPolitica.set(traducirErrorExcepcion(error).mensaje);
        },
      });
  }

  /** `true` cuando las franjas del editor difieren de las guardadas. */
  protected hayCambiosEnHorario(): boolean {
    const guardadas = normalizar(this.politica()?.horarioGeneral ?? []);
    return (
      JSON.stringify(franjasDelFormulario(this.formularioHorario)) !== JSON.stringify(guardadas)
    );
  }

  /**
   * Reemplaza el horario general por el del editor.
   *
   * <p>El `PUT` manda <b>solo</b> `horarioGeneral`: omitir `pais` y `cierraPorFeriado` los deja
   * como estaban. Una lista REEMPLAZA el horario entero —lo anterior queda como historia del
   * lado del backend—, y una lista vacia lo borra. Por eso guardar con el editor vacio es lo
   * mismo que {@link borrarHorario}.
   */
  protected guardarHorario(): void {
    this.intentosHorario.update((valor) => valor + 1);
    if (this.formularioHorario.invalid) {
      this.formularioHorario.markAllAsTouched();
      return;
    }
    this.enviarHorario(franjasDelFormulario(this.formularioHorario));
  }

  /** Borra el horario general: `[]` explicito, que no es lo mismo que omitir el campo. */
  protected borrarHorario(): void {
    this.enviarHorario([]);
  }

  private enviarHorario(horarioGeneral: FranjaSemanal[]): void {
    // Misma guarda que `guardar()`: los botones viven detras del permiso, pero Enter no.
    if (!this.puedeGestionar()) {
      return;
    }
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null || this.guardandoHorario()) {
      return;
    }

    this.guardandoHorario.set(true);
    this.limpiarAvisosDeHorario();

    this.calendario
      .updateCalendarioSede({ consultorioId, updateCalendarioRequest: { horarioGeneral } })
      .subscribe({
        next: (respuesta) => {
          this.guardandoHorario.set(false);
          this.intentosHorario.set(0);
          // Igual que en `guardar()`: la lista de feriados del PUT viene vacia y no se pisa.
          this.politica.set({ ...respuesta, feriados: this.politica()?.feriados ?? [] });
          // El backend devuelve el horario ordenado por dia y hora: el editor queda como quedo
          // guardado, no como se tipeo.
          this.cargarHorario(respuesta.horarioGeneral);
          this.exitoHorario.set(
            horarioGeneral.length === 0
              ? 'Listo: la sede ya no tiene horario general declarado.'
              : 'Listo: el horario general quedo guardado. Desde ahora la agenda no ofrece turnos fuera de el.',
          );
          const impacto = respuesta.impactoDelHorario ?? null;
          this.impactoHorario.set((impacto?.turnosAfectados ?? 0) > 0 ? impacto : null);
        },
        error: (error: unknown) => {
          this.guardandoHorario.set(false);
          this.errorHorario.set(traducirErrorExcepcion(error).mensaje);
          if (error instanceof AkineHttpError) {
            this.erroresFranja.set(erroresDeFranjasDelServidor(error.erroresPorCampo));
          }
        },
      });
  }

  private cargarHorario(horario: CalendarioSedeResponse['horarioGeneral']): void {
    reemplazarFranjas(this.formularioHorario, normalizar(horario ?? []));
  }

  private limpiarAvisosDeHorario(): void {
    this.errorHorario.set(null);
    this.erroresFranja.set(new Map());
    this.exitoHorario.set(null);
    this.impactoHorario.set(null);
  }
}

/** Las franjas de la respuesta —todos sus campos son opcionales en el contrato— como filas. */
function normalizar(
  horario: NonNullable<CalendarioSedeResponse['horarioGeneral']>,
): FranjaSemanal[] {
  return horario.map((franja) => ({
    diaSemana: franja.diaSemana ?? 1,
    horaDesde: franja.horaDesde ?? '',
    horaHasta: franja.horaHasta ?? '',
  }));
}
