import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { InterpretacionDto } from '../../../../api/generated/model/interpretacion-dto';
import { OpcionDePersonaDelAsistente } from '../../../../api/generated/model/opcion-de-persona-del-asistente';
import { RespuestaAsistenteResponse } from '../../../../api/generated/model/respuesta-asistente-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { traducirErrorAsistente } from '../../models/asistente-errors';
import { AsistenteApi, TurnoPrevio } from '../../services/asistente-api';

const MAX_PREGUNTA = 300;
/** El servidor usa los últimos tres: mandar más es ruido. */
const MAX_TURNOS = 3;
const MAX_FILAS_VISIBLES = 10;
const AVISO_FIJO =
  'Responde con los datos de la sede activa y con tus permisos. Sólo consulta: no modifica nada.';

/** Lo que se puede preguntar, como punto de partida. */
export const SUGERENCIAS: readonly string[] = [
  '¿Quiénes vienen hoy?',
  '¿Cuánto se facturó este mes?',
  '¿Cuántos turnos se cancelaron este mes?',
];

/** Claves de las filas que no se muestran en la tabla: son ids internos. */
const CLAVES_OCULTAS = new Set(['personaId', 'turnoId', 'sesionId', 'claseId']);
const ETIQUETAS: Readonly<Record<string, string>> = {
  inicio: 'Fecha y hora',
  estado: 'Estado',
  oferta: 'Servicio',
  profesional: 'Profesional',
  paciente: 'Paciente',
  clase: 'Clase',
  estadoClase: 'Estado de la clase',
  participante: 'Participante',
  resultado: 'Asistencia',
  seccion: 'Sección',
  etiqueta: 'Indicador',
  tipo: 'Tipo',
  valor: 'Valor',
  moneda: 'Moneda',
};

export interface MensajeDelAsistente {
  readonly rol: 'usuario' | 'asistente';
  readonly texto: string;
  readonly estado: 'esperando' | 'listo' | 'error';
  /** La pregunta que originó la respuesta: una opción elegida la reenvía con el `personaId`. */
  readonly pregunta?: string;
  readonly respuesta?: RespuestaAsistenteResponse;
}

/**
 * Charla con el asistente de datos. Vive sólo en memoria: se pierde al salir, al cambiar de sede o
 * con "Nueva charla". El servidor no la guarda; el historial viaja en cada pregunta.
 */
@Component({
  selector: 'app-asistente-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CabeceraDePagina, Ayuda, EstadoVacio, RouterLink],
  templateUrl: './asistente-page.html',
  styleUrl: './asistente-page.css',
})
export class AsistentePage {
  private readonly api = inject(AsistenteApi);
  private readonly tenantContext = inject(TenantContextStore);

  protected readonly aviso = AVISO_FIJO;
  protected readonly maxPregunta = MAX_PREGUNTA;
  protected readonly sugerencias = SUGERENCIAS;

  protected readonly mensajes = signal<readonly MensajeDelAsistente[]>([]);
  protected readonly texto = signal('');
  protected readonly deshabilitado = signal(false);
  protected readonly anuncio = signal('');

  protected readonly enCurso = computed(() => this.mensajes().at(-1)?.estado === 'esperando');
  protected readonly puedeEnviar = computed(
    () => !this.deshabilitado() && !this.enCurso() && this.texto().trim().length > 0,
  );

  private readonly lista = viewChild<ElementRef<HTMLElement>>('lista');
  private suscripcion: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.abortar());
    // Cambiar de sede corta la charla: las respuestas y el historial son de la sede anterior.
    let sede: number | null | undefined;
    effect(() => {
      const actual = this.tenantContext.consultorioId();
      untracked(() => {
        if (sede !== undefined && sede !== actual) {
          this.nuevaCharla();
          this.deshabilitado.set(false);
        }
        sede = actual;
      });
    });
    effect(() => {
      this.mensajes();
      const el = this.lista()?.nativeElement;
      if (el) {
        queueMicrotask(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    });
  }

  protected alEscribir(evento: Event): void {
    this.texto.set((evento.target as HTMLTextAreaElement).value);
  }

  protected alTeclear(evento: KeyboardEvent): void {
    if (evento.key === 'Enter' && !evento.shiftKey && !evento.isComposing) {
      evento.preventDefault();
      this.enviar();
    }
  }

  protected enviar(): void {
    if (!this.puedeEnviar()) {
      return;
    }
    const pregunta = this.texto().trim();
    this.texto.set('');
    this.preguntar(pregunta, pregunta);
  }

  protected usarSugerencia(pregunta: string): void {
    if (this.deshabilitado() || this.enCurso()) {
      return;
    }
    this.preguntar(pregunta, pregunta);
  }

  /** Reenvía la pregunta de la aclaración con la persona elegida. */
  protected elegirOpcion(mensaje: MensajeDelAsistente, opcion: OpcionDePersonaDelAsistente): void {
    if (this.enCurso() || !mensaje.pregunta) {
      return;
    }
    this.preguntar(mensaje.pregunta, opcion.etiqueta, opcion.personaId);
  }

  protected nuevaCharla(): void {
    this.abortar();
    this.mensajes.set([]);
    this.texto.set('');
  }

  protected columnas(respuesta: RespuestaAsistenteResponse): string[] {
    const claves = new Set<string>();
    for (const fila of respuesta.filas.slice(0, MAX_FILAS_VISIBLES)) {
      for (const [clave, valor] of Object.entries(fila)) {
        if (!CLAVES_OCULTAS.has(clave) && valor !== null && valor !== undefined) {
          claves.add(clave);
        }
      }
    }
    return [...claves];
  }

  protected filasVisibles(respuesta: RespuestaAsistenteResponse): object[] {
    return respuesta.filas.slice(0, MAX_FILAS_VISIBLES);
  }

  protected etiquetaDeColumna(clave: string): string {
    return ETIQUETAS[clave] ?? clave;
  }

  protected celda(fila: object, clave: string): string {
    const valor = (fila as Record<string, unknown>)[clave];
    if (valor === null || valor === undefined) {
      return '—';
    }
    if (clave === 'inicio' && typeof valor === 'string') {
      const fecha = new Date(valor);
      return Number.isNaN(fecha.getTime())
        ? valor
        : fecha.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
    }
    return String(valor);
  }

  private preguntar(pregunta: string, visible: string, personaId?: number): void {
    const sede = this.tenantContext.consultorioId();
    if (sede === null) {
      return;
    }
    const historial = this.historial();
    this.mensajes.update((ms) => [
      ...ms,
      { rol: 'usuario', texto: visible, estado: 'listo' },
      { rol: 'asistente', texto: '', estado: 'esperando', pregunta },
    ]);
    this.anuncio.set('Consultando…');
    this.abortar();
    this.suscripcion = this.api.consultar(sede, pregunta, historial, personaId).subscribe({
      next: (respuesta) => {
        this.cambiarUltimo((m) => ({ ...m, estado: 'listo', texto: respuesta.texto, respuesta }));
        this.anuncio.set('Respuesta lista');
      },
      error: (error: unknown) => this.fallar(error),
    });
  }

  /** Las últimas preguntas con su interpretación, para que "¿y la semana pasada?" se entienda. */
  private historial(): TurnoPrevio[] {
    const turnos: TurnoPrevio[] = [];
    for (const m of this.mensajes()) {
      const interpretacion: InterpretacionDto | undefined = m.respuesta?.interpretacion;
      if (m.rol === 'asistente' && m.estado === 'listo' && m.pregunta && interpretacion) {
        turnos.push({ pregunta: m.pregunta, interpretacion });
      }
    }
    return turnos.slice(-MAX_TURNOS);
  }

  private abortar(): void {
    this.suscripcion?.unsubscribe();
    this.suscripcion = null;
  }

  private cambiarUltimo(cambio: (m: MensajeDelAsistente) => MensajeDelAsistente): void {
    this.mensajes.update((actuales) => {
      const ultimo = actuales.at(-1);
      return ultimo ? [...actuales.slice(0, -1), cambio(ultimo)] : actuales;
    });
  }

  private fallar(error: unknown): void {
    const traducido = traducirErrorAsistente(error);
    if (traducido.causa === 'deshabilitado') {
      this.deshabilitado.set(true);
      this.mensajes.set([]);
      return;
    }
    this.cambiarUltimo((m) => ({ ...m, estado: 'error', texto: traducido.mensaje }));
    this.anuncio.set('Error en la respuesta');
  }
}
