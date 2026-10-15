import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { DetalleOperativoDeClase } from '../../../../api/generated/model/detalle-operativo-de-clase';
import { EventoDeAsistencia } from '../../../../api/generated/model/evento-de-asistencia';
import { ParticipanteOperativo } from '../../../../api/generated/model/participante-operativo';
import { ResultadoDeLoteDeAsistencia } from '../../../../api/generated/model/resultado-de-lote-de-asistencia';
import { PERMISO_ASISTENCIA_MANAGE, PERMISO_CLASE_MANAGE } from '../../../../core/models/permisos';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Paginacion } from '../../../../shared/components/paginacion/paginacion';
import {
  ErrorAsistencia,
  errorSinContexto,
  traducirErrorAsistencia,
  traducirFalloDeItem,
} from '../../models/asistencia-errors';
import {
  Marca,
  RESULTADOS,
  ResultadoAsistencia,
  admiteAsistencia,
  armarLote,
  correccionesSinMotivo,
  descripcionDeEvento,
  esCorreccion,
  etiquetaDeEstadoDeClase,
  etiquetaDeEstadoDeInscripcion,
  etiquetaDeEvento,
  etiquetaDeResultado,
  fechaHoraEnZona,
  horaEnZona,
  nombreDeParticipante,
  tieneLugar,
} from '../../models/etiquetas-de-asistencia';
import { AsistenciaApi } from '../../services/asistencia-api';

type EstadoCarga =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly detalle: DetalleOperativoDeClase }
  | { readonly tipo: 'error'; readonly error: ErrorAsistencia };

interface FalloDeItem {
  readonly inscripcionId: number;
  readonly nombre: string;
  readonly mensaje: string;
}

interface Historial {
  readonly asistenciaId: number;
  readonly nombre: string;
  readonly eventos: readonly EventoDeAsistencia[] | null;
  readonly error: ErrorAsistencia | null;
}

/**
 * Tomar asistencia de una clase (M28/M13, AKINE-08.03: RF-M28-007, RF-M13-007, RF-M13-008).
 *
 * <p><b>El ciclo de la clase manda.</b> Se toma lista con la clase EN CURSO; una REALIZADA admite
 * correcciones —que llegan despues, que es cuando se descubren—; una PROGRAMADA se inicia primero
 * y una CANCELADA no tuvo asistentes. El cierre marca ausentes a los que nadie resolvio.
 *
 * <p><b>El lote no es atomico, a proposito</b> (CA-M13-008-06): cada participante corre en su
 * propia transaccion y la pantalla muestra los que fallaron con su causa, sin deshacer los que
 * salieron bien.
 *
 * <p><b>Corregir no borra.</b> Cambiar un resultado ya registrado exige motivo y el anterior queda
 * en el historial (RN-M28-009), que se abre por participante.
 *
 * <p>No muestra nada clinico ni economico: el detalle operativo no lo trae (privacidad de quien
 * toma lista) y la asistencia no consume pases ni genera deuda en el backend actual.
 */
@Component({
  selector: 'app-asistencia-de-clase-page',
  imports: [RouterLink, Paginacion],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './asistencia-de-clase-page.html',
  styleUrl: '../../asistencia.css',
})
export class AsistenciaDeClasePage {
  private readonly api = inject(AsistenciaApi);
  private readonly tenant = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);
  private readonly diaDeLaSede = inject(DiaDeLaSede);

  /** De la ruta. `withComponentInputBinding` lo liga solo. */
  readonly claseId = input.required<string>();

  protected readonly resultados = RESULTADOS;
  protected readonly etiquetaDeResultado = etiquetaDeResultado;
  protected readonly etiquetaDeEstadoDeClase = etiquetaDeEstadoDeClase;
  protected readonly etiquetaDeInscripcion = etiquetaDeEstadoDeInscripcion;
  protected readonly etiquetaDeEvento = etiquetaDeEvento;
  protected readonly cambio = descripcionDeEvento;
  protected readonly nombre = nombreDeParticipante;
  protected readonly tieneLugar = tieneLugar;
  protected readonly hora = horaEnZona;
  protected readonly fechaHora = fechaHoraEnZona;

  protected readonly estado = signal<EstadoCarga>({ tipo: 'cargando' });
  protected readonly pagina = signal(0);
  protected readonly marcas = signal<ReadonlyMap<number, Marca>>(new Map());
  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<ErrorAsistencia | null>(null);
  protected readonly faltanMotivos = signal<readonly number[]>([]);
  protected readonly lote = signal<{ exitosos: number; fallos: readonly FalloDeItem[] } | null>(
    null,
  );
  protected readonly avisoCierre = signal<string | null>(null);
  protected readonly historial = signal<Historial | null>(null);

  protected readonly zona = computed(() => this.diaDeLaSede.zona());
  protected readonly detalle = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.detalle : null;
  });
  protected readonly error = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.error : null;
  });
  protected readonly participantes = computed(() => this.detalle()?.content ?? []);
  protected readonly admite = computed(() => admiteAsistencia(this.detalle()?.estado));
  protected readonly pendientes = computed(() => armarLote(this.participantes(), this.marcas()));

  /** Sin permisos cargados se muestra todo: el backend decide igual. */
  protected readonly puedeGestionarClase = computed(
    () => !this.permisos.cargados() || this.permisos.tiene(PERMISO_CLASE_MANAGE),
  );
  protected readonly puedeMarcar = computed(
    () => !this.permisos.cargados() || this.permisos.tiene(PERMISO_ASISTENCIA_MANAGE),
  );

  /** Respuesta mas nueva pedida: una vieja que llega tarde no pisa a la nueva. */
  private pedido = 0;

  constructor() {
    effect(() => {
      this.tenant.contextEpoch();
      this.claseId();
      untracked(() => {
        // Cambiar de sede o de clase no puede dejar marcas ni resultados de la anterior.
        this.marcas.set(new Map());
        this.lote.set(null);
        this.avisoCierre.set(null);
        this.errorAccion.set(null);
        this.historial.set(null);
        this.pagina.set(0);
        this.cargar();
      });
    });
  }

  private ids(): { consultorioId: number; claseId: number } | null {
    const consultorioId = this.tenant.consultorioId();
    const claseId = Number(this.claseId());
    return consultorioId === null || !Number.isInteger(claseId) ? null : { consultorioId, claseId };
  }

  protected cargar(): void {
    const ids = this.ids();
    const pedido = ++this.pedido;
    if (ids === null) {
      this.estado.set({ tipo: 'error', error: errorSinContexto() });
      return;
    }
    if (this.estado().tipo !== 'listo') {
      this.estado.set({ tipo: 'cargando' });
    }
    this.api.detalle(ids.consultorioId, ids.claseId, this.pagina()).subscribe({
      next: (detalle) => {
        if (pedido === this.pedido) {
          this.estado.set({ tipo: 'listo', detalle });
        }
      },
      error: (error: unknown) => {
        if (pedido === this.pedido) {
          this.estado.set({ tipo: 'error', error: traducirErrorAsistencia(error) });
        }
      },
    });
  }

  protected irAPagina(pagina: number): void {
    this.pagina.set(pagina);
    this.cargar();
  }

  // ------------------------------------------------------------------ ciclo de la clase

  protected iniciar(): void {
    const ids = this.ids();
    if (ids === null || this.enviando()) {
      return;
    }
    this.empezarAccion();
    this.api.iniciar(ids.consultorioId, ids.claseId).subscribe({
      next: () => this.terminarAccion(),
      error: (error: unknown) => this.fallarAccion(error),
    });
  }

  protected cerrar(): void {
    const ids = this.ids();
    if (ids === null || this.enviando()) {
      return;
    }
    this.empezarAccion();
    this.api.cerrar(ids.consultorioId, ids.claseId).subscribe({
      next: (resultado) => {
        const ausentados = resultado.ausentados?.length ?? 0;
        const espera = resultado.esperaCancelada ?? 0;
        this.avisoCierre.set(
          resultado.cerroAhora === false
            ? 'La clase ya estaba cerrada: no se cambio nada.'
            : `Clase cerrada. Se marcaron ausentes ${ausentados} sin resolver` +
                (espera > 0 ? ` y se cancelaron ${espera} de la lista de espera.` : '.'),
        );
        this.marcas.set(new Map());
        this.terminarAccion();
      },
      error: (error: unknown) => this.fallarAccion(error),
    });
  }

  // ------------------------------------------------------------------ marcas

  protected marcaDe(participante: ParticipanteOperativo): Marca | undefined {
    const id = participante.inscripcion?.id;
    return id === undefined ? undefined : this.marcas().get(id);
  }

  /** El resultado que el radio muestra: lo elegido, o si no lo ya registrado. */
  protected elegido(participante: ParticipanteOperativo): string | undefined {
    return this.marcaDe(participante)?.resultado ?? participante.asistencia?.resultado;
  }

  protected corrige(participante: ParticipanteOperativo): boolean {
    const marca = this.marcaDe(participante);
    return marca !== undefined && esCorreccion(participante, marca);
  }

  protected faltaMotivo(participante: ParticipanteOperativo): boolean {
    const id = participante.inscripcion?.id;
    return id !== undefined && this.faltanMotivos().includes(id);
  }

  protected marcar(participante: ParticipanteOperativo, resultado: ResultadoAsistencia): void {
    const id = participante.inscripcion?.id;
    if (id === undefined) {
      return;
    }
    const siguiente = new Map(this.marcas());
    siguiente.set(id, { resultado, motivo: siguiente.get(id)?.motivo ?? '' });
    this.marcas.set(siguiente);
  }

  protected escribirMotivo(participante: ParticipanteOperativo, motivo: string): void {
    const id = participante.inscripcion?.id;
    const marca = id === undefined ? undefined : this.marcas().get(id);
    if (id === undefined || marca === undefined) {
      return;
    }
    const siguiente = new Map(this.marcas());
    siguiente.set(id, { ...marca, motivo });
    this.marcas.set(siguiente);
    if (motivo.trim() !== '') {
      this.faltanMotivos.update((ids) => ids.filter((otro) => otro !== id));
    }
  }

  /** Marca presentes a los que tienen lugar y nadie resolvio todavia. No toca lo registrado. */
  protected presentesLosSinMarcar(): void {
    const siguiente = new Map(this.marcas());
    for (const participante of this.participantes()) {
      const id = participante.inscripcion?.id;
      if (
        id !== undefined &&
        tieneLugar(participante) &&
        participante.asistencia === undefined &&
        !siguiente.has(id)
      ) {
        siguiente.set(id, { resultado: 'PRESENTE', motivo: '' });
      }
    }
    this.marcas.set(siguiente);
  }

  protected descartar(): void {
    this.marcas.set(new Map());
    this.faltanMotivos.set([]);
  }

  protected guardar(): void {
    const ids = this.ids();
    if (ids === null || this.enviando()) {
      return;
    }
    const sinMotivo = correccionesSinMotivo(this.participantes(), this.marcas());
    this.faltanMotivos.set(sinMotivo);
    if (sinMotivo.length > 0) {
      this.errorAccion.set({
        mensaje:
          'Hay correcciones sin motivo. Cambiar una asistencia ya registrada necesita explicar ' +
          'por que.',
        causa: 'motivo-obligatorio',
      });
      return;
    }
    const items = this.pendientes();
    if (items.length === 0) {
      return;
    }
    const nombres = new Map(
      this.participantes().map((p) => [p.inscripcion?.id ?? -1, nombreDeParticipante(p)]),
    );
    this.empezarAccion();
    this.api.registrarLote(ids.consultorioId, ids.claseId, items).subscribe({
      next: (resultado) => {
        this.lote.set(resumirLote(resultado, nombres));
        // Las que salieron bien ya estan en el servidor; las fallidas quedan para reintentar.
        const fallidas = new Set(
          (resultado.items ?? []).filter((i) => !i.resultado).map((i) => i.inscripcionId),
        );
        const siguiente = new Map(
          [...this.marcas()].filter(([id]) => fallidas.has(id)),
        ) as ReadonlyMap<number, Marca>;
        this.marcas.set(siguiente);
        this.terminarAccion();
      },
      error: (error: unknown) => this.fallarAccion(error),
    });
  }

  // ------------------------------------------------------------------ historial

  protected verHistorial(participante: ParticipanteOperativo): void {
    const ids = this.ids();
    const asistenciaId = participante.asistencia?.id;
    if (ids === null || asistenciaId === undefined) {
      return;
    }
    const nombre = nombreDeParticipante(participante);
    this.historial.set({ asistenciaId, nombre, eventos: null, error: null });
    this.api.historial(ids.consultorioId, ids.claseId, asistenciaId).subscribe({
      next: (eventos) => {
        if (this.historial()?.asistenciaId === asistenciaId) {
          this.historial.set({ asistenciaId, nombre, eventos, error: null });
        }
      },
      error: (error: unknown) => {
        if (this.historial()?.asistenciaId === asistenciaId) {
          this.historial.set({
            asistenciaId,
            nombre,
            eventos: null,
            error: traducirErrorAsistencia(error),
          });
        }
      },
    });
  }

  protected cerrarHistorial(): void {
    this.historial.set(null);
  }

  // ------------------------------------------------------------------ comun

  private empezarAccion(): void {
    this.enviando.set(true);
    this.errorAccion.set(null);
    this.lote.set(null);
    this.avisoCierre.set(null);
  }

  private terminarAccion(): void {
    this.enviando.set(false);
    this.cargar();
  }

  private fallarAccion(error: unknown): void {
    this.enviando.set(false);
    this.errorAccion.set(traducirErrorAsistencia(error));
    // El estado de la clase pudo cambiar por otro operador: se relee para no mentir.
    this.cargar();
  }
}

function resumirLote(
  resultado: ResultadoDeLoteDeAsistencia,
  nombres: ReadonlyMap<number, string>,
): { exitosos: number; fallos: FalloDeItem[] } {
  const fallos = (resultado.items ?? [])
    .filter((item) => !item.resultado)
    .map((item) => ({
      inscripcionId: item.inscripcionId ?? -1,
      nombre: nombres.get(item.inscripcionId ?? -1) ?? `Inscripcion ${item.inscripcionId}`,
      mensaje: traducirFalloDeItem(item.problemType, item.detalle).mensaje,
    }));
  return { exitosos: resultado.exitosos ?? 0, fallos };
}
