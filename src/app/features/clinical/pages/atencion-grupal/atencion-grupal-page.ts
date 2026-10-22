import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

import {
  AtencionDeParticipante,
  AtencionDeParticipanteEstadoEnum,
} from '../../../../api/generated/model/atencion-de-participante';
import { AtencionGrupal } from '../../../../api/generated/model/atencion-grupal';
import { Clase } from '../../../../api/generated/model/clase';
import {
  DerivacionDeParticipante,
  DerivacionDeParticipanteEstadoEnum,
} from '../../../../api/generated/model/derivacion-de-participante';
import { ParticipanteEnAtencionGrupal } from '../../../../api/generated/model/participante-en-atencion-grupal';
import { ResultadoDeAtencionGrupal } from '../../../../api/generated/model/resultado-de-atencion-grupal';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { PERMISO_HC_WRITE } from '../../../../core/models/permisos';
import { FocoAlMontar } from '../../../../shared/directives/foco-al-montar.directive';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import {
  ErrorAtencionGrupal,
  errorSinContextoGrupal,
  traducirErrorAtencionGrupal,
  traducirFalloDeAtencion,
} from '../../models/atencion-grupal-errors';
import { instanteEnPalabras } from '../../models/etiquetas-de-atencion';
import { AtencionGrupalApi } from '../../services/atencion-grupal-api';
import { DerivarParticipante, ReintentoConMotivo } from './derivar-participante';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';

type EstadoCarga =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'error'; readonly error: ErrorAtencionGrupal }
  | {
      readonly tipo: 'listo';
      readonly panel: AtencionGrupal;
      readonly clase: Clase | null;
    };

/** Un participante del panel, con el nombre que el panel trae del padron. */
export interface FilaDeAtencion {
  readonly inscripcionId: number;
  readonly nombre: string;
  readonly asistencia: string;
  readonly estuvo: boolean;
  readonly atenciones: readonly AtencionDeParticipante[];
}

interface ResultadoDeLote {
  readonly exitosos: number;
  readonly fallos: readonly {
    readonly inscripcionId: number;
    readonly nombre: string;
    readonly mensaje: string;
    /**
     * Solo con `derivacion-ambigua`: las derivaciones vigentes entre las que hay que elegir. Se
     * elige ahi mismo, en el resultado, sin volver a iniciar al participante de a uno.
     */
    readonly derivacionIds: readonly number[];
  }[];
}

type FalloDeLote = ResultadoDeLote['fallos'][number];

interface Derivaciones {
  readonly fila: FilaDeAtencion;
  readonly lista: readonly DerivacionDeParticipante[] | null;
  readonly error: ErrorAtencionGrupal | null;
  /** Por que se abrio: el participante tiene varias derivaciones y hay que elegir una. */
  readonly porAmbiguedad: boolean;
  /**
   * Si se abrio desde un fallo del lote, las derivaciones que ofrecio el backend: la eleccion se
   * muestra en el resultado del lote, no abajo. `null` si se abrio desde la tabla.
   */
  readonly desdeLote: readonly number[] | null;
}

/** Lo que se muestra cuando el padron no resolvio el nombre: nunca el id. */
export const SIN_NOMBRE = 'Participante sin nombre';

const ETIQUETAS_DE_ASISTENCIA: Readonly<Record<string, string>> = {
  PRESENTE: 'Presente',
  PRESENTE_TARDE: 'Llego tarde',
  AUSENTE: 'Ausente',
};

/**
 * Atencion clinica de una clase (M14/M28, AKINE-08.05: RF-M14-011 a RF-M14-013).
 *
 * <p><b>Una atencion por participante y por Caso, nunca una de la clase.</b> Esta pantalla no
 * registra nada clinico: abre la Sesion de cada participante —desde su derivacion clinica de
 * 08.04— y lleva a la pantalla de atencion de siempre, donde se evalua, se trata y se cierra uno por
 * uno. No hay cierre en lote a proposito: una "evolucion de la clase" que sustituya los registros
 * individuales es lo que RF-M14-013 prohibe.
 *
 * <p><b>El panel no muestra contenido clinico</b>: estados y numeros de cada atencion, nada mas.
 * Las derivaciones —que si son lectura clinica, auditada por persona— se leen solo cuando alguien
 * las pide para un participante: para elegir entre dos Casos o para revertir una.
 *
 * <p><b>"Iniciar para todos" no es atomico</b>: cada participante corre en su transaccion y los que
 * fallan vuelven con su causa, sin deshacer a los demas. Iniciar es idempotente, asi que repetirlo
 * no duplica nada.
 *
 * <p><b>Nunca se elige la derivacion por el profesional.</b> Con dos derivaciones vigentes el
 * backend responde `derivacion-ambigua` y la pantalla ofrece las dos: numerar la atencion en el
 * Caso equivocado no se corrige sin reescribir historia clinica.
 */
@Component({
  selector: 'app-atencion-grupal-page',
  imports: [Ayuda, RouterLink, FocoAlMontar, PermisoDirective, DerivarParticipante],
  templateUrl: './atencion-grupal-page.html',
})
export class AtencionGrupalPage {
  private readonly api = inject(AtencionGrupalApi);
  private readonly tenant = inject(TenantContextStore);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** De la ruta. `withComponentInputBinding` lo liga solo. */
  readonly claseId = input.required<string>();

  protected readonly instante = instanteEnPalabras;
  /** Derivar escribe en la historia: sin `hc:write` no se ofrece (el backend rechazaria igual). */
  protected readonly PERMISO_HC_WRITE = PERMISO_HC_WRITE;

  protected readonly estado = signal<EstadoCarga>({ tipo: 'cargando' });
  /** Participante con una operacion en vuelo, `'lote'` para el lote, o `null`. */
  protected readonly enVuelo = signal<number | 'lote' | null>(null);
  protected readonly errorDeAccion = signal<ErrorAtencionGrupal | null>(null);
  protected readonly lote = signal<ResultadoDeLote | null>(null);
  protected readonly derivaciones = signal<Derivaciones | null>(null);
  /** Derivacion cuya reversion se esta escribiendo, o `null`. */
  protected readonly revirtiendo = signal<number | null>(null);
  protected readonly motivoDeReversion = signal('');
  protected readonly faltaMotivoDeReversion = signal(false);
  protected readonly avisoDeReversion = signal<string | null>(null);

  // --- Derivacion (AKINE-08.04) ---------------------------------------------------------------
  /** Participante cuya derivacion a un Caso se esta armando, o `null`. */
  protected readonly derivando = signal<FilaDeAtencion | null>(null);
  protected readonly avisoDeDerivacion = signal<string | null>(null);
  /**
   * Los derivados en esta visita y a que Caso, para decirlo en su fila: el panel no trae las
   * derivaciones —son lectura clinica— y la atencion todavia no existe.
   */
  protected readonly derivadas = signal<ReadonlyMap<number, string>>(new Map());

  // --- Motivo de acceso (DP-03) -------------------------------------------------------------
  /** El motivo declarado en esta visita. Viaja en cada operacion clinica hasta salir. */
  protected readonly motivo = signal<string | null>(null);
  protected readonly pidiendoMotivo = signal(false);
  protected readonly motivoEscrito = signal('');
  protected readonly intentoMotivo = signal(false);
  /** Lo que se estaba haciendo cuando el backend pidio motivo: se repite al declararlo. */
  private reintento: (() => void) | null = null;

  protected readonly listo = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual : null;
  });
  protected readonly error = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.error : null;
  });
  protected readonly clinica = computed(() => this.listo()?.panel.clinica === true);
  protected readonly titulo = computed(() => {
    const listo = this.listo();
    return listo?.clase?.titulo || listo?.clase?.ofertaNombre || `Clase ${this.claseId()}`;
  });

  protected readonly filas = computed<readonly FilaDeAtencion[]>(() => {
    const listo = this.listo();
    if (listo === null) {
      return [];
    }
    return (listo.panel.participantes ?? []).map(aFila);
  });

  /** Los que estuvieron y todavia no tienen ninguna atencion: lo que "Iniciar para todos" manda. */
  protected readonly pendientes = computed(() =>
    this.filas().filter((fila) => fila.estuvo && fila.atenciones.length === 0),
  );

  /** Las derivaciones abiertas en la tarjeta de abajo; las del lote se eligen en el resultado. */
  protected readonly derivacionesAbajo = computed(() => {
    const panel = this.derivaciones();
    return panel?.desdeLote === null ? panel : null;
  });

  /** Respuesta mas nueva pedida: una vieja que llega tarde no pisa a la nueva. */
  private pedido = 0;

  constructor() {
    effect(() => {
      this.tenant.contextEpoch();
      this.claseId();
      untracked(() => {
        // Cambiar de sede o de clase no deja nada de la anterior: ni resultados, ni derivaciones
        // leidas, ni el motivo declarado, que era para otras personas.
        this.lote.set(null);
        this.errorDeAccion.set(null);
        this.cerrarDerivaciones();
        this.derivando.set(null);
        this.avisoDeDerivacion.set(null);
        this.derivadas.set(new Map());
        this.motivo.set(null);
        this.pidiendoMotivo.set(false);
        this.reintento = null;
        this.cargar();
      });
    });
  }

  protected ids(): { consultorioId: number; claseId: number } | null {
    const consultorioId = this.tenant.consultorioId();
    const claseId = Number(this.claseId());
    return consultorioId === null || !Number.isInteger(claseId) || claseId <= 0
      ? null
      : { consultorioId, claseId };
  }

  protected cargar(): void {
    const ids = this.ids();
    const pedido = ++this.pedido;
    if (ids === null) {
      this.estado.set({ tipo: 'error', error: errorSinContextoGrupal() });
      return;
    }
    if (this.estado().tipo !== 'listo') {
      this.estado.set({ tipo: 'cargando' });
    }
    forkJoin({
      panel: this.api.panel(ids.consultorioId, ids.claseId),
      clase: this.api.clase(ids.consultorioId, ids.claseId),
    }).subscribe({
      next: ({ panel, clase }) => {
        if (pedido === this.pedido) {
          this.estado.set({ tipo: 'listo', panel, clase });
        }
      },
      error: (error: unknown) => {
        if (pedido === this.pedido) {
          this.estado.set({ tipo: 'error', error: traducirErrorAtencionGrupal(error) });
        }
      },
    });
  }

  // ------------------------------------------------------------------ atenciones

  protected etiquetaDeAtencion(atencion: AtencionDeParticipante): string {
    if (atencion.estado !== AtencionDeParticipanteEstadoEnum.CERRADA) {
      return 'Atencion en curso';
    }
    const partes = ['Atencion cerrada'];
    if (atencion.numeroEnCaso !== undefined) {
      partes.push(`sesion ${atencion.numeroEnCaso} del caso`);
    }
    if (atencion.numeroSesion !== undefined) {
      partes.push(`sesion ${atencion.numeroSesion} del paciente`);
    }
    return partes.join(' · ');
  }

  protected rutaDeAtencion(atencion: AtencionDeParticipante): string | null {
    return atencion.sesionId === undefined ? null : `/atencion/sesiones/${atencion.sesionId}`;
  }

  /**
   * Abre la atencion del participante y lleva a ella. Con `derivacionId` la abre desde esa
   * derivacion: es la respuesta a `derivacion-ambigua`.
   */
  protected iniciar(fila: FilaDeAtencion, derivacionId: number | null = null): void {
    const ids = this.ids();
    if (ids === null || this.enVuelo() !== null) {
      return;
    }
    this.empezar(fila.inscripcionId);
    this.api
      .iniciar(ids.consultorioId, ids.claseId, fila.inscripcionId, derivacionId, this.motivo())
      .subscribe({
        next: (atencion) => {
          this.enVuelo.set(null);
          if (atencion.sesionId !== undefined) {
            this.router.navigateByUrl(`/atencion/sesiones/${atencion.sesionId}`);
          } else {
            this.cargar();
          }
        },
        error: (error: unknown) => {
          this.enVuelo.set(null);
          const traducido = traducirErrorAtencionGrupal(error);
          if (this.pedirMotivoSi(traducido, () => this.iniciar(fila, derivacionId))) {
            return;
          }
          this.errorDeAccion.set(traducido);
          if (traducido.causa === 'derivacion-ambigua') {
            this.verDerivaciones(fila, true);
          } else if (traducido.causa === 'sin-derivacion') {
            // La salida de "no tiene derivacion" es derivarlo: se ofrece ahi mismo.
            this.abrirDerivacion(fila);
          }
          this.cargar();
        },
      });
  }

  /** Abre la atencion de todos los que estuvieron y no tienen ninguna. */
  protected iniciarParaTodos(): void {
    const ids = this.ids();
    const pendientes = this.pendientes();
    if (ids === null || this.enVuelo() !== null || pendientes.length === 0) {
      return;
    }
    const nombres = new Map(pendientes.map((fila) => [fila.inscripcionId, fila.nombre]));
    this.empezar('lote');
    this.api
      .iniciarLote(
        ids.consultorioId,
        ids.claseId,
        pendientes.map((fila) => ({ inscripcionId: fila.inscripcionId })),
        this.motivo(),
      )
      .subscribe({
        next: (resultado) => {
          this.enVuelo.set(null);
          const resumen = resumirLote(resultado, nombres);
          this.lote.set(resumen);
          if (this.motivo() === null && pideMotivo(resultado)) {
            this.pidiendoMotivo.set(true);
            this.reintento = () => this.iniciarParaTodos();
          }
          this.cargar();
        },
        error: (error: unknown) => {
          this.enVuelo.set(null);
          const traducido = traducirErrorAtencionGrupal(error);
          if (!this.pedirMotivoSi(traducido, () => this.iniciarParaTodos())) {
            this.errorDeAccion.set(traducido);
          }
          this.cargar();
        },
      });
  }

  // ------------------------------------------------------------------ derivaciones

  protected verDerivaciones(
    fila: FilaDeAtencion,
    porAmbiguedad = false,
    desdeLote: readonly number[] | null = null,
  ): void {
    const ids = this.ids();
    if (ids === null) {
      return;
    }
    if (this.derivaciones()?.fila.inscripcionId !== fila.inscripcionId) {
      this.avisoDeReversion.set(null);
    }
    this.derivando.set(null);
    this.revirtiendo.set(null);
    this.motivoDeReversion.set('');
    this.faltaMotivoDeReversion.set(false);
    this.derivaciones.set({ fila, lista: null, error: null, porAmbiguedad, desdeLote });
    this.api
      .derivacionesDe(ids.consultorioId, ids.claseId, fila.inscripcionId, this.motivo())
      .subscribe({
        next: (respuesta) => {
          if (this.derivaciones()?.fila.inscripcionId === fila.inscripcionId) {
            this.derivaciones.set({
              fila,
              lista: respuesta.derivaciones ?? [],
              error: null,
              porAmbiguedad,
              desdeLote,
            });
          }
        },
        error: (error: unknown) => {
          const traducido = traducirErrorAtencionGrupal(error);
          if (
            this.pedirMotivoSi(traducido, () =>
              this.verDerivaciones(fila, porAmbiguedad, desdeLote),
            )
          ) {
            this.derivaciones.set(null);
            return;
          }
          if (this.derivaciones()?.fila.inscripcionId === fila.inscripcionId) {
            this.derivaciones.set({
              fila,
              lista: null,
              error: traducido,
              porAmbiguedad,
              desdeLote,
            });
          }
        },
      });
  }

  /** La eleccion de derivacion abierta para un fallo del lote, o `null`. */
  protected eleccionEnLote(inscripcionId: number): Derivaciones | null {
    const panel = this.derivaciones();
    return panel !== null && panel.desdeLote !== null && panel.fila.inscripcionId === inscripcionId
      ? panel
      : null;
  }

  /** Las vigentes de entre las que el backend ofrecio para elegir. */
  protected elegibles(panel: Derivaciones): readonly DerivacionDeParticipante[] {
    const ofrecidas = new Set(panel.desdeLote ?? []);
    return (panel.lista ?? []).filter(
      (derivacion) =>
        this.vigente(derivacion) && derivacion.id !== undefined && ofrecidas.has(derivacion.id),
    );
  }

  /**
   * Un participante del lote fallo con `derivacion-ambigua`: lee sus derivaciones —lectura
   * clinica, auditada— para elegir ahi mismo entre las que el backend ofrecio.
   */
  protected elegirEnLote(fallo: FalloDeLote): void {
    const fila = this.filas().find((f) => f.inscripcionId === fallo.inscripcionId);
    if (fila !== undefined) {
      this.verDerivaciones(fila, true, fallo.derivacionIds);
    }
  }

  /**
   * Abre la atencion elegida para un fallo del lote. A diferencia de {@link iniciar} no navega:
   * puede haber otros participantes del lote por resolver, y el resultado se actualiza en su lugar.
   */
  protected iniciarDesdeLote(fila: FilaDeAtencion, derivacion: DerivacionDeParticipante): void {
    const ids = this.ids();
    const derivacionId = derivacion.id;
    if (ids === null || derivacionId === undefined || this.enVuelo() !== null) {
      return;
    }
    this.enVuelo.set(fila.inscripcionId);
    this.errorDeAccion.set(null);
    this.api
      .iniciar(ids.consultorioId, ids.claseId, fila.inscripcionId, derivacionId, this.motivo())
      .subscribe({
        next: () => {
          this.enVuelo.set(null);
          const resumen = this.lote();
          if (resumen !== null) {
            this.lote.set({
              exitosos: resumen.exitosos + 1,
              fallos: resumen.fallos.filter((f) => f.inscripcionId !== fila.inscripcionId),
            });
          }
          this.cerrarDerivaciones();
          this.cargar();
        },
        error: (error: unknown) => {
          this.enVuelo.set(null);
          const traducido = traducirErrorAtencionGrupal(error);
          if (this.pedirMotivoSi(traducido, () => this.iniciarDesdeLote(fila, derivacion))) {
            return;
          }
          const actual = this.derivaciones();
          if (actual !== null) {
            this.derivaciones.set({ ...actual, error: traducido });
          }
        },
      });
  }

  /** El numero visible del Caso ("caso 3"), nunca su id. */
  protected numeroDeCaso(derivacion: DerivacionDeParticipante): string {
    return derivacion.numeroCaso === undefined
      ? 'Caso clinico sin numero'
      : `Caso clinico ${derivacion.numeroCaso}`;
  }

  protected cerrarDerivaciones(): void {
    this.derivaciones.set(null);
    this.revirtiendo.set(null);
    this.motivoDeReversion.set('');
    this.faltaMotivoDeReversion.set(false);
    this.avisoDeReversion.set(null);
  }

  protected vigente(derivacion: DerivacionDeParticipante): boolean {
    return derivacion.estado === DerivacionDeParticipanteEstadoEnum.VIGENTE;
  }

  /** La atencion que ya cuelga de la derivacion, si el panel la conoce. */
  protected atencionDe(
    fila: FilaDeAtencion,
    derivacion: DerivacionDeParticipante,
  ): AtencionDeParticipante | undefined {
    return fila.atenciones.find((atencion) => atencion.derivacionId === derivacion.id);
  }

  protected empezarReversion(derivacion: DerivacionDeParticipante): void {
    this.revirtiendo.set(derivacion.id ?? null);
    this.motivoDeReversion.set('');
    this.faltaMotivoDeReversion.set(false);
    this.avisoDeReversion.set(null);
  }

  /**
   * "No revertir": el campo y sus botones desaparecen y vuelve a dibujarse "Revertir la
   * derivacion" —un elemento nuevo—, asi que el foco se lleva ahi a mano (WCAG 2.4.3).
   */
  protected cancelarReversion(derivacion: DerivacionDeParticipante): void {
    this.revirtiendo.set(null);
    this.faltaMotivoDeReversion.set(false);
    this.enfocarDespues(`#revertir-${derivacion.id}`);
  }

  private enfocarDespues(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }

  protected escribirMotivoDeReversion(texto: string): void {
    this.motivoDeReversion.set(texto);
    if (texto.trim() !== '') {
      this.faltaMotivoDeReversion.set(false);
    }
  }

  /**
   * Revierte una derivacion. Si ya tiene atencion el backend responde 409 `derivacion-con-sesion`
   * y la pantalla explica por que y que hacer en su lugar: la Sesion no se borra.
   */
  protected revertir(fila: FilaDeAtencion, derivacion: DerivacionDeParticipante): void {
    const ids = this.ids();
    const motivo = this.motivoDeReversion().trim();
    if (ids === null || derivacion.id === undefined || this.enVuelo() !== null) {
      return;
    }
    if (motivo === '') {
      this.faltaMotivoDeReversion.set(true);
      this.enfocarDespues(`#motivo-reversion-${derivacion.id}`);
      return;
    }
    const derivacionId = derivacion.id;
    this.empezar(fila.inscripcionId);
    this.avisoDeReversion.set(null);
    this.api
      .revertir(
        ids.consultorioId,
        ids.claseId,
        fila.inscripcionId,
        derivacionId,
        motivo,
        this.motivo(),
      )
      .subscribe({
        next: () => {
          this.enVuelo.set(null);
          this.motivoDeReversion.set('');
          this.verDerivaciones(fila);
          this.avisoDeReversion.set('Derivacion revertida. Queda en el historial con su motivo.');
          this.cargar();
        },
        error: (error: unknown) => {
          this.enVuelo.set(null);
          const traducido = traducirErrorAtencionGrupal(error);
          if (this.pedirMotivoSi(traducido, () => this.revertir(fila, derivacion))) {
            return;
          }
          const actual = this.derivaciones();
          if (actual !== null) {
            this.derivaciones.set({ ...actual, error: traducido });
          }
        },
      });
  }

  // ------------------------------------------------------------------ derivar

  /** Abre la tarjeta para derivar al participante a un Caso. Cierra la de sus derivaciones. */
  protected abrirDerivacion(fila: FilaDeAtencion): void {
    this.cerrarDerivaciones();
    this.avisoDeDerivacion.set(null);
    this.derivando.set(fila);
  }

  /**
   * Quedo derivado: se dice a que Caso y se recarga el panel, que ya ofrece "Iniciar atencion"
   * para el. Repetir al mismo Caso devuelve la existente (`yaExistia`), y tambien se dice.
   */
  protected alDerivar(fila: FilaDeAtencion, derivacion: DerivacionDeParticipante): void {
    const caso = this.numeroDeCaso(derivacion).replace('Caso clinico', 'caso clinico');
    this.derivando.set(null);
    this.errorDeAccion.set(null);
    this.derivadas.update((actual) => new Map(actual).set(fila.inscripcionId, caso));
    const verbo = derivacion.yaExistia === true ? 'ya estaba derivada' : 'quedo derivada';
    this.avisoDeDerivacion.set(
      `${fila.nombre} ${verbo} al ${caso}. Ya se puede iniciar su atencion.`,
    );
    this.cargar();
  }

  /** La tarjeta de derivar necesita motivo de acceso: se pide aca, el mismo de toda la visita. */
  protected pedirMotivoParaDerivar(reintento: ReintentoConMotivo): void {
    this.pidiendoMotivo.set(true);
    this.reintento = () => reintento(this.motivo());
  }

  // ------------------------------------------------------------------ motivo de acceso

  protected declararMotivo(): void {
    this.intentoMotivo.set(true);
    const limpio = this.motivoEscrito().trim();
    if (limpio === '') {
      return;
    }
    this.motivo.set(limpio);
    this.pidiendoMotivo.set(false);
    this.intentoMotivo.set(false);
    this.errorDeAccion.set(null);
    const reintento = this.reintento;
    this.reintento = null;
    reintento?.();
  }

  /** Si el backend pide motivo de acceso, lo pide en pantalla y guarda que repetir. */
  private pedirMotivoSi(error: ErrorAtencionGrupal, reintento: () => void): boolean {
    if (error.causa !== 'requiere-justificacion') {
      return false;
    }
    this.pidiendoMotivo.set(true);
    this.reintento = reintento;
    return true;
  }

  // ------------------------------------------------------------------ comun

  private empezar(quien: number | 'lote'): void {
    this.enVuelo.set(quien);
    this.errorDeAccion.set(null);
    this.lote.set(null);
  }
}

function aFila(participante: ParticipanteEnAtencionGrupal): FilaDeAtencion {
  return {
    inscripcionId: participante.inscripcionId ?? -1,
    nombre: [participante.apellido, participante.nombre].filter(Boolean).join(', ') || SIN_NOMBRE,
    asistencia: ETIQUETAS_DE_ASISTENCIA[participante.resultadoAsistencia ?? ''] ?? 'Sin registrar',
    estuvo: participante.estuvo === true,
    atenciones: participante.atenciones ?? [],
  };
}

function resumirLote(
  resultado: ResultadoDeAtencionGrupal,
  nombres: ReadonlyMap<number, string>,
): ResultadoDeLote {
  const fallos = (resultado.items ?? [])
    .filter((item) => item.atencion === undefined)
    .map((item) => {
      const id = item.inscripcionId ?? -1;
      const fallo = traducirFalloDeAtencion(item.problemType, item.detalle);
      return {
        inscripcionId: id,
        nombre: nombres.get(id) ?? SIN_NOMBRE,
        mensaje: fallo.mensaje,
        derivacionIds: fallo.causa === 'derivacion-ambigua' ? (item.derivacionIds ?? []) : [],
      };
    });
  return { exitosos: resultado.exitosos ?? 0, fallos };
}

function pideMotivo(resultado: ResultadoDeAtencionGrupal): boolean {
  return (resultado.items ?? []).some(
    (item) =>
      item.atencion === undefined &&
      traducirFalloDeAtencion(item.problemType, item.detalle).causa === 'requiere-justificacion',
  );
}
