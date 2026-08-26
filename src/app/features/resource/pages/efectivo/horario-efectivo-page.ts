import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { ColaboradoresService } from '../../../../api/generated/api/colaboradores.service';
import { DiaEfectivoResponse } from '../../../../api/generated/model/dia-efectivo-response';
import { DisponibilidadProfesionalService } from '../../../../api/generated/api/disponibilidad-profesional.service';
import { EstadoDeListado, vistaDeListado } from '../../../../shared/utils/estado-de-listado';
import { FranjaResueltaResponse } from '../../../../api/generated/model/franja-resuelta-response';
import { MembershipResponse } from '../../../../api/generated/model/membership-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { traducirErrorHorarioEfectivo } from '../../models/horario-efectivo-errors';
import {
  TOPE_DE_VINCULOS,
  atiendeEn,
  nombreDeVinculo,
} from '../../models/profesionales-de-la-sede';
import {
  MAXIMO_DIAS_VENTANA,
  diasEntre,
  esFechaDeCalendario,
  etiquetaDeFecha,
  hoyLocal,
  sumarDias,
} from '../../models/ventana-de-fechas';
import {
  ExplicacionDeVacio,
  etiquetaDeOrigen,
  explicacionDeVacio,
  rangoDeFranja,
  textoDeRecorte,
} from '../../models/horario-efectivo';

/** Una semana: es la ventana que se mira para responder "por que el martes esta vacio". */
const DIAS_PROPUESTOS = 7;

/**
 * Horario efectivo de un profesional en la sede activa (M05, AKINE-02.04).
 *
 * <p><b>Esta pantalla es el criterio de aceptacion de la etapa hecho visible.</b> El criterio
 * dice que la disponibilidad efectiva es determinista <b>y explica que regla la afecto</b>. El
 * backend carga esa explicacion en cada respuesta -`origen` y `recortadoPor` en cada franja,
 * `razonVacio` en cada dia sin atencion-, pero mientras nadie la dibuje vive solo en el JSON y
 * ningun administrador la ve. Una pantalla que pintara las franjas y descartara esos tres campos
 * dejaria sin respuesta la unica pregunta que se hace de verdad aca: <b>por que el martes esta
 * vacio</b>.
 *
 * <p><b>No es el horario semanal.</b> `/horarios` muestra y edita las <b>reglas</b>; esto
 * muestra el <b>resultado</b> de aplicarlas todas juntas -vigencia de cada bloque, excepciones
 * de la sede, excepciones del profesional, vigencia del vinculo y politica de feriados-. Las dos
 * conviven a proposito, y tampoco es la disponibilidad de un box (`pages/disponibilidad/`, M04).
 *
 * <h2>Lo que esta pantalla no puede aplanar</h2>
 *
 * <p><b>1. "No trabaja ese dia" y "ya no trabaja aca" son dos carteles distintos.</b>
 * `razonVacio` tiene cuatro estados y confundir `VINCULO` con `null` manda al administrador a
 * revisar un horario que esta perfecto cuando el problema es la fecha de alta o de baja del
 * vinculo. Los textos viven en `models/horario-efectivo.ts`, en un solo lugar, porque el cliente
 * generado los tipa `string | null` y el compilador no chequea ninguno.
 *
 * <p><b>2. Ningun dia de la ventana se omite</b>, ni siquiera si el profesional ya no trabaja en
 * el centro. La respuesta trae los dias completos a proposito: un dia faltante correria la
 * grilla y se leeria el horario del jueves creyendo que es el del miercoles.
 *
 * <p><b>3. Las franjas viajan en instantes UTC, no en horas de pared.</b> `timezone` viaja
 * aparte para poder rotularlas; formatearlas con la zona del navegador mostraria el horario de
 * la sede corrido segun donde este parado quien mira. La conversion vive en `rangoDeFranja`.
 *
 * <p><b>4. Solo lee.</b> No hay ninguna mutacion, asi que no hay nada detras de
 * `*akinePermiso`: el permiso que hace falta es `colaborador:read`, el mismo del horario
 * semanal, y lo pide el guard de la ruta.
 *
 * <p><b>Reacciona a `contextEpoch`.</b> Cambiar de sede sin recargar dejaria en pantalla el
 * horario resuelto en la sede anterior, que es justo el resultado que depende de la sede.
 */
@Component({
  selector: 'app-horario-efectivo-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './horario-efectivo-page.html',
  styleUrl: '../../resource.css',
})
export class HorarioEfectivoPage {
  private readonly disponibilidad = inject(DisponibilidadProfesionalService);
  private readonly colaboradores = inject(ColaboradoresService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly maximoDias = MAXIMO_DIAS_VENTANA;
  protected readonly etiquetaDeFecha = etiquetaDeFecha;
  protected readonly etiquetaDeOrigen = etiquetaDeOrigen;
  protected readonly textoDeRecorte = textoDeRecorte;

  protected readonly nombreDeLaSede = computed(
    () => this.tenantContext.context()?.consultorioName ?? 'la sede activa',
  );

  // --- Selector de profesional -------------------------------------------------------

  protected readonly profesionales = signal<readonly MembershipResponse[]>([]);
  protected readonly errorProfesionales = signal<string | null>(null);
  protected readonly membershipElegido = signal<number | null>(null);

  protected readonly nombreDelProfesional = computed(() =>
    nombreDeVinculo(
      this.profesionales().find((candidato) => candidato.id === this.membershipElegido()),
    ),
  );

  // --- Resultado ----------------------------------------------------------------------

  /**
   * Estado de la consulta.
   *
   * <p>Arranca en `inicial` y no en `cargando`: sin profesional elegido no hay ninguna peticion
   * que hacer, y a diferencia del calendario de la sede la pregunta esta incompleta hasta que
   * alguien diga de quien.
   *
   * <p>La respuesta no es una pagina: se envuelve en `{ content }` para reusar
   * `vistaDeListado`, que deriva filas, mensaje de error y falta de contexto en todos los
   * listados del repo. La forma envuelta no viaja por la red.
   */
  protected readonly estado = signal<EstadoDeListado<{ readonly content: DiaEfectivoResponse[] }>>({
    tipo: 'inicial',
  });

  private readonly vista = vistaDeListado<DiaEfectivoResponse>(this.estado);
  protected readonly dias = this.vista.filas;
  protected readonly mensajeError = this.vista.mensajeError;
  protected readonly faltaContexto = this.vista.faltaContexto;

  /** Zona con la que el backend convirtio las horas de pared. Se rotula, no se adivina. */
  protected readonly timezone = signal<string | null>(null);

  protected readonly ventanaConsultada = signal<{
    readonly desde: string;
    readonly hasta: string;
  } | null>(null);

  protected readonly errorVentana = signal<string | null>(null);

  protected readonly formularioVentana = this.formBuilder.nonNullable.group({
    desde: ['', [Validators.required]],
    hasta: ['', [Validators.required]],
  });

  /** Cuantos dias de la ventana tienen al menos una franja. */
  protected readonly diasConAtencion = computed(
    () => this.dias().filter((dia) => (dia.franjas ?? []).length > 0).length,
  );

  constructor() {
    effect(() => {
      // Dependencia explicita: cambiar de sede invalida el resultado entero, no solo la lista.
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.membershipElegido.set(null);
        this.timezone.set(null);
        this.ventanaConsultada.set(null);
        this.estado.set({ tipo: 'inicial' });
        this.proponerVentana();
        this.cargarProfesionales();
      });
    });
  }

  private proponerVentana(): void {
    const desde = hoyLocal();
    this.formularioVentana.reset({ desde, hasta: sumarDias(desde, DIAS_PROPUESTOS) });
    this.errorVentana.set(null);
  }

  /**
   * Profesionales que pueden atender en <b>esta</b> sede.
   *
   * <p>Mismo filtro que el editor del horario semanal, y por eso vive en
   * `models/profesionales-de-la-sede.ts`: si cada pantalla filtrara por su cuenta, una ofreceria
   * a alguien que la otra no.
   */
  protected cargarProfesionales(): void {
    const orgId = this.tenantContext.organizationId();
    const consultorioId = this.tenantContext.consultorioId();

    if (orgId === null || consultorioId === null) {
      this.profesionales.set([]);
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }

    this.errorProfesionales.set(null);

    this.colaboradores
      .listMemberships({ orgId, page: 0, size: TOPE_DE_VINCULOS })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          this.profesionales.set([]);
          this.errorProfesionales.set(traducirErrorHorarioEfectivo(respuesta).mensaje);
          return;
        }
        this.profesionales.set(
          (respuesta.content ?? []).filter((vinculo) => atiendeEn(vinculo, consultorioId)),
        );
      });
  }

  protected elegirProfesional(valor: string): void {
    const membershipId = Number(valor);

    if (valor === '' || !Number.isFinite(membershipId)) {
      this.membershipElegido.set(null);
      this.estado.set({ tipo: 'inicial' });
      return;
    }

    this.membershipElegido.set(membershipId);
    this.consultar();
  }

  /**
   * Resuelve la ventana para el profesional elegido.
   *
   * <p>El tope de {@link MAXIMO_DIAS_VENTANA} dias se valida antes de salir: el backend lo
   * rechaza igual con `ventana-demasiado-amplia`, pero gastar el viaje para decir algo que ya se
   * sabe deja al usuario sin saber cual de los dos campos corregir. El traductor <b>igual</b>
   * maneja ese problem type, porque el backend puede mover el tope sin que este cliente se
   * entere.
   */
  protected consultar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const membershipId = this.membershipElegido();

    if (consultorioId === null) {
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }
    if (membershipId === null) {
      this.errorVentana.set('Eligi un profesional para resolver su horario.');
      this.estado.set({ tipo: 'inicial' });
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
        'El fin de la ventana tiene que ser posterior al inicio, y es exclusivo: el dia que ' +
          'escribas en "hasta" no se resuelve.',
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

    this.disponibilidad
      .getDisponibilidadEfectiva({ consultorioId, membershipId, desde, hasta })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          const traducido = traducirErrorHorarioEfectivo(respuesta);
          this.timezone.set(null);
          this.estado.set({
            tipo: 'error',
            mensaje: traducido.mensaje,
            faltaContexto: traducido.causa === 'sin-contexto',
          });
          return;
        }

        this.timezone.set(respuesta.timezone ?? null);
        this.estado.set({ tipo: 'listo', pagina: { content: respuesta.dias ?? [] } });
      });
  }

  // --- Lectura de un dia ---------------------------------------------------------------

  /** `true` si el dia tiene al menos una franja de atencion. */
  protected atiende(dia: DiaEfectivoResponse): boolean {
    return (dia.franjas ?? []).length > 0;
  }

  /**
   * Por que este dia quedo vacio.
   *
   * <p>Es un <b>metodo</b> y no un `computed()` a proposito: depende del dia que se este
   * pintando, y un `computed` por fila no existe. El nombre del profesional sale de signals, asi
   * que la plantilla lo reevalua cuando cambia.
   */
  protected porQueVacio(dia: DiaEfectivoResponse): ExplicacionDeVacio {
    return explicacionDeVacio(dia, this.nombreDelProfesional());
  }

  /** La franja en hora de pared de la sede, con `24:00` cuando llega al fin del dia. */
  protected rango(dia: DiaEfectivoResponse, franja: FranjaResueltaResponse): string {
    return rangoDeFranja(franja, dia.fecha, this.timezone() ?? undefined);
  }
}
