import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Subscription } from 'rxjs';

import { CasoClinico } from '../../../../../api/generated/model/caso-clinico';
import { EventoClinicoResponse } from '../../../../../api/generated/model/evento-clinico-response';
import { ErrorHistoria, traducirErrorHistoria } from '../../../models/historia-errors';
import {
  TIPOS_DE_ENTRADA,
  esOrigenConocido,
  etiquetaDeOrigen,
  fechaYHora,
  rotulo,
} from '../../../models/etiquetas-de-historia';
import { DiaDeLaSede } from '../../../../../core/services/dia-de-la-sede';
import { aInstanteUtc } from '../../../../../shared/utils/instantes';
import {
  FiltrosDelTimeline,
  HistoriaClinicaApi,
  Justificacion,
  OrigenDelTimeline,
} from '../../../services/historia-clinica-api';

/**
 * Los origenes que se pueden filtrar, con su rotulo. `Record` sobre el tipo del contrato: un origen
 * nuevo en el filtro no compila sin su rotulo.
 */
const ORIGENES_FILTRABLES: Readonly<Record<OrigenDelTimeline, string>> = {
  ENTRADA_CLINICA: 'Entradas',
  ADJUNTO_CLINICO: 'Adjuntos',
  ANTECEDENTE_CLINICO: 'Antecedentes',
  SESION: 'Sesiones',
};

/**
 * Un rango de dias de calendario (`YYYY-MM-DD`, de los `<input type="date">`) como instantes UTC
 * inclusivos: desde las 00:00 del primero hasta el ultimo milisegundo del segundo, en la zona de la
 * sede. Un dia vacio no acota ese extremo.
 *
 * <p>El contrato pide instantes y el profesional piensa en dias: "del 1 al 15" incluye lo que paso
 * el 15 a la tarde. Leerlos en la zona del navegador correria el borde tres horas para quien mira
 * un consultorio de Cordoba desde otro huso.
 */
export function rangoDeDias(
  desde: string,
  hasta: string,
  zona: string,
): { readonly desde: string | null; readonly hasta: string | null } {
  const inicio = desde === '' ? null : aInstanteUtc(`${desde}T00:00`, zona);
  const finExclusivo = hasta === '' ? null : aInstanteUtc(`${diaSiguiente(hasta)}T00:00`, zona);
  return {
    desde: inicio,
    hasta: finExclusivo === null ? null : new Date(Date.parse(finExclusivo) - 1).toISOString(),
  };
}

function mismosFiltros(a: FiltrosDelTimeline, b: FiltrosDelTimeline): boolean {
  return (
    a.casoId === b.casoId &&
    a.desde === b.desde &&
    a.hasta === b.hasta &&
    a.origenes.length === b.origenes.length &&
    a.origenes.every((origen, i) => origen === b.origenes[i])
  );
}

function diaSiguiente(dia: string): string {
  const fecha = new Date(`${dia}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + 1);
  return fecha.toISOString().slice(0, 10);
}

/** Identidad de un hecho del timeline: el origen y su id. El indice no tiene id propio. */
export function claveDe(evento: EventoClinicoResponse): string {
  return `${evento.origen ?? ''}:${evento.referencia ?? ''}:${evento.tipo ?? ''}`;
}

/** Una fila ya resuelta: se calcula una vez por cambio de datos, no en cada pasada de la vista. */
interface Fila {
  readonly evento: EventoClinicoResponse;
  readonly clave: string;
  readonly origen: string;
  readonly tipo: string;
  readonly fecha: string;
  readonly conDetalle: boolean;
}

type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'lista' }
  | { readonly tipo: 'error'; readonly error: ErrorHistoria };

/**
 * El timeline de una Historia Clinica (D-a, RF-M09-003).
 *
 * <h2>Indice, no contenido</h2>
 *
 * <p>Cada hecho trae fecha, origen y un titulo generico —"Entrada clinica", "Adjunto clinico"—, y
 * nunca el contenido: el contenido se pide al elegirlo, y esa lectura se audita aparte. Por eso la
 * lista no muestra el cuerpo de las entradas aunque eso ahorraria un click.
 *
 * <h2>Cursor y "Cargar mas"</h2>
 *
 * <p>El backend pagina por keyset descendente con un cursor opaco: la pagina siguiente se pide con
 * el `proximoCursor` de la anterior y se concatena. No hay "pagina 3": un offset sobre fuentes
 * heterogeneas se desordena en cuanto una inserta. Un cursor rechazado reinicia desde el principio.
 *
 * <h2>Los filtros son del servidor</h2>
 *
 * <p>Caso, origen y rango de fechas los resuelve el backend (RF-M09-004, `appKine-api` #132).
 * Filtrar en el cliente sobre una lista paginada diria "no hay adjuntos" cuando en realidad estan
 * en la pagina que no se cargo. El cursor no lleva los filtros, asi que "Cargar mas" los reenvia, y
 * cambiar cualquiera arranca de la primera pagina.
 */
@Component({
  selector: 'app-timeline-clinico',
  imports: [NgTemplateOutlet],
  templateUrl: './timeline-clinico.html',
  styleUrl: '../historia-clinica.css',
})
export class TimelineClinico {
  private readonly api = inject(HistoriaClinicaApi);
  private readonly dia = inject(DiaDeLaSede);

  readonly historiaClinicaId = input.required<number>();
  readonly justificacion = input.required<Justificacion>();
  /** Cambia cada vez que la pagina registra algo: obliga a releer desde el principio. */
  readonly recargas = input(0);
  readonly seleccionado = input<string | null>(null);

  readonly elegido = output<EventoClinicoResponse>();

  protected readonly estado = signal<Estado>({ tipo: 'cargando' });
  protected readonly eventos = signal<readonly EventoClinicoResponse[]>([]);
  protected readonly casos = signal<readonly CasoClinico[]>([]);
  protected readonly casoId = signal<number | null>(null);
  protected readonly origenes = signal<readonly OrigenDelTimeline[]>([]);
  /** Dias de calendario tal como los dejo el control, `YYYY-MM-DD` o vacio. */
  protected readonly desde = signal('');
  protected readonly hasta = signal('');
  protected readonly opcionesDeOrigen = Object.entries(ORIGENES_FILTRABLES).map(
    ([valor, rotulo]) => ({ valor: valor as OrigenDelTimeline, rotulo }),
  );

  /** "Desde" despues de "Hasta": el backend responde 400, asi que ni se pregunta. */
  protected readonly rangoInvalido = computed(
    () => this.desde() !== '' && this.hasta() !== '' && this.desde() > this.hasta(),
  );
  /** Algun filtro ademas del caso: cambia el mensaje de la lista vacia. */
  protected readonly hayFiltros = computed(
    () => this.origenes().length > 0 || this.desde() !== '' || this.hasta() !== '',
  );
  /**
   * Lo que se le pide al servidor. Con igualdad por valor: la zona de la sede llega despues de la
   * primera pintura, y sin fechas elegidas no cambia nada; releer la primera pagina por eso seria
   * un pedido (y una lectura auditada) de mas.
   */
  private readonly filtros = computed<FiltrosDelTimeline>(
    () => ({
      casoId: this.casoId(),
      origenes: this.origenes(),
      ...rangoDeDias(this.desde(), this.hasta(), this.dia.zona()),
    }),
    { equal: mismosFiltros },
  );
  protected readonly cargandoMas = signal(false);
  protected readonly errorAlCargarMas = signal<ErrorHistoria | null>(null);
  protected readonly aviso = signal('');

  protected readonly filas = computed<readonly Fila[]>(() =>
    this.eventos().map((evento) => ({
      evento,
      clave: claveDe(evento),
      origen: etiquetaDeOrigen(evento.origen),
      tipo: evento.origen === 'ENTRADA_CLINICA' ? rotulo(TIPOS_DE_ENTRADA, evento.tipo) : '',
      fecha: fechaYHora(evento.ocurrioEn),
      conDetalle: esOrigenConocido(evento.origen) && evento.referencia !== undefined,
    })),
  );

  protected readonly opcionesDeCaso = computed(() =>
    this.casos().map((caso) => ({ id: caso.id, rotulo: rotuloDeCaso(caso) })),
  );

  private readonly proximoCursor = signal<string | null>(null);
  protected readonly hayMas = computed(() => this.proximoCursor() !== null);

  protected readonly error = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.error : null;
  });

  private pedido: Subscription | null = null;
  private pedidoDeCasos: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.pedido?.unsubscribe();
      this.pedidoDeCasos?.unsubscribe();
    });

    // Historia y motivo: se releen los casos del filtro.
    effect(() => {
      const historia = this.historiaClinicaId();
      const justificacion = this.justificacion();
      untracked(() => this.cargarCasos(historia, justificacion));
    });

    // Cualquier cambio de entrada o de filtro arranca desde la primera pagina.
    effect(() => {
      this.historiaClinicaId();
      this.justificacion();
      this.recargas();
      this.filtros();
      untracked(() => this.cargarPrimeraPagina());
    });
  }

  protected filtrarPorCaso(valor: string): void {
    this.casoId.set(valor === '' ? null : Number(valor));
  }

  protected incluyeOrigen(origen: OrigenDelTimeline): boolean {
    return this.origenes().includes(origen);
  }

  protected alternarOrigen(origen: OrigenDelTimeline, marcado: boolean): void {
    this.origenes.update((actuales) =>
      marcado
        ? this.opcionesDeOrigen
            .map((o) => o.valor)
            .filter((o) => o === origen || actuales.includes(o))
        : actuales.filter((o) => o !== origen),
    );
  }

  protected limpiarFiltros(): void {
    this.origenes.set([]);
    this.desde.set('');
    this.hasta.set('');
  }

  protected reintentar(): void {
    this.cargarPrimeraPagina();
  }

  protected cargarMas(): void {
    const cursor = this.proximoCursor();
    if (cursor === null || this.cargandoMas()) {
      return;
    }
    this.cargandoMas.set(true);
    this.errorAlCargarMas.set(null);
    this.pedido?.unsubscribe();
    this.pedido = this.api
      .paginaDelTimeline(this.historiaClinicaId(), cursor, this.filtros(), this.justificacion())
      .subscribe({
        next: (pagina) => {
          const nuevos = pagina.eventos ?? [];
          this.eventos.update((anteriores) => [...anteriores, ...nuevos]);
          this.proximoCursor.set(pagina.proximoCursor ?? null);
          this.cargandoMas.set(false);
          this.aviso.set(`Se cargaron ${nuevos.length} hechos mas.`);
        },
        error: (error: unknown) => {
          this.cargandoMas.set(false);
          const traducido = traducirErrorHistoria(error);
          if (traducido.causa === 'cursor-invalido') {
            this.aviso.set(traducido.mensaje);
            this.cargarPrimeraPagina();
            return;
          }
          this.errorAlCargarMas.set(traducido);
        },
      });
  }

  private cargarPrimeraPagina(): void {
    this.errorAlCargarMas.set(null);
    this.cargandoMas.set(false);
    this.pedido?.unsubscribe();
    if (this.rangoInvalido()) {
      this.pedido = null;
      this.eventos.set([]);
      this.proximoCursor.set(null);
      this.estado.set({ tipo: 'lista' });
      return;
    }
    this.estado.set({ tipo: 'cargando' });
    this.pedido = this.api
      .paginaDelTimeline(this.historiaClinicaId(), null, this.filtros(), this.justificacion())
      .subscribe({
        next: (pagina) => {
          this.eventos.set(pagina.eventos ?? []);
          this.proximoCursor.set(pagina.proximoCursor ?? null);
          this.estado.set({ tipo: 'lista' });
        },
        error: (error: unknown) => {
          this.eventos.set([]);
          this.proximoCursor.set(null);
          this.estado.set({ tipo: 'error', error: traducirErrorHistoria(error) });
        },
      });
  }

  /**
   * Los casos del filtro. Si fallan, el timeline sigue: el filtro es una comodidad y la historia
   * completa es lo que importa. Por eso el error no se muestra como error de la pantalla.
   */
  private cargarCasos(historia: number, justificacion: Justificacion): void {
    this.pedidoDeCasos?.unsubscribe();
    this.pedidoDeCasos = this.api.casosDe(historia, justificacion).subscribe({
      next: (casos) => this.casos.set(casos),
      error: () => this.casos.set([]),
    });
  }
}

function rotuloDeCaso(caso: CasoClinico): string {
  const estado = caso.estado === 'CERRADO' ? ' (cerrado)' : '';
  const diagnostico = caso.diagnosticoPresuntivo ? ` - ${caso.diagnosticoPresuntivo}` : '';
  return `Caso ${caso.numeroCaso ?? caso.id}${diagnostico}${estado}`;
}
