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
import { HistoriaClinicaApi, Justificacion } from '../../../services/historia-clinica-api';

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
 * <h2>El unico filtro es el del servidor</h2>
 *
 * <p>Filtrar por caso lo resuelve el backend. Filtrar por tipo de hecho en el cliente sobre una
 * lista paginada diria "no hay adjuntos" cuando en realidad estan en la pagina que no se cargo.
 */
@Component({
  selector: 'app-timeline-clinico',
  imports: [NgTemplateOutlet],
  templateUrl: './timeline-clinico.html',
  styleUrl: '../historia-clinica.css',
})
export class TimelineClinico {
  private readonly api = inject(HistoriaClinicaApi);

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
      this.casoId();
      untracked(() => this.cargarPrimeraPagina());
    });
  }

  protected filtrarPorCaso(valor: string): void {
    this.casoId.set(valor === '' ? null : Number(valor));
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
      .paginaDelTimeline(this.historiaClinicaId(), cursor, this.casoId(), this.justificacion())
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
    this.estado.set({ tipo: 'cargando' });
    this.errorAlCargarMas.set(null);
    this.cargandoMas.set(false);
    this.pedido?.unsubscribe();
    this.pedido = this.api
      .paginaDelTimeline(this.historiaClinicaId(), null, this.casoId(), this.justificacion())
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
