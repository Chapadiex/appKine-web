import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { SafeUrl, DomSanitizer } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';

import { AdjuntoClinicoResponse } from '../../../api/generated/model/adjunto-clinico-response';
import { EventoClinicoResponse } from '../../../api/generated/model/evento-clinico-response';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { ErrorTimeline, traducirErrorTimeline } from './timeline-errors';
import { TimelineApi } from './timeline-api';

/** Previews que se muestran en linea; el resto solo se descarga. */
const TIPOS_PREVIEWABLES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/**
 * Timeline de la historia clinica de una persona (solo lectura).
 *
 * <p>Pagina por el cursor opaco del backend y no reordena nada. La autoridad es del backend:
 * no hay `permissionGuard`, se muestra lo que devuelve y se traducen sus errores.
 */
@Component({
  selector: 'app-timeline-page',
  imports: [RouterLink],
  templateUrl: './timeline-page.html',
})
export class TimelinePage {
  private readonly api = inject(TimelineApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly sanitizer = inject(DomSanitizer);

  readonly personaId = input.required<string>();

  protected readonly cargando = signal(false);
  protected readonly error = signal<ErrorTimeline | null>(null);
  protected readonly paciente = signal('');
  protected readonly eventos = signal<readonly EventoClinicoResponse[]>([]);
  protected readonly proximoCursor = signal<string | null>(null);
  protected readonly hayMas = computed(() => this.proximoCursor() !== null);
  protected readonly vacio = computed(
    () => !this.cargando() && this.error() === null && this.eventos().length === 0,
  );

  protected readonly adjuntos = signal<readonly AdjuntoClinicoResponse[]>([]);
  protected readonly preview = signal<{ titulo: string; url: SafeUrl } | null>(null);

  private historiaId: number | null = null;
  private blobUrls: string[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => this.soltarBlobs());

    effect(() => {
      // Depende de la ruta y del contexto: cambiar de persona o de sede recarga desde cero.
      this.personaId();
      this.tenantContext.consultorioId();
      untracked(() => this.abrir());
    });
  }

  protected abrir(): void {
    const personaId = Number(this.personaId());
    this.historiaId = null;
    this.eventos.set([]);
    this.adjuntos.set([]);
    this.proximoCursor.set(null);
    this.preview.set(null);
    this.error.set(null);
    if (!Number.isInteger(personaId) || personaId <= 0) {
      this.error.set({ mensaje: 'No encontramos la historia clinica.', causa: 'no-encontrado' });
      return;
    }
    this.cargando.set(true);
    this.api.abrirHistoria(personaId).subscribe({
      next: (historia) => {
        this.historiaId = historia.id ?? null;
        this.paciente.set(historia.personaNombreCompleto ?? '');
        if (this.historiaId === null) {
          this.cargando.set(false);
          return;
        }
        this.cargarPagina(null);
        this.cargarAdjuntos();
      },
      error: (e: unknown) => this.fallar(e),
    });
  }

  protected verMas(): void {
    const cursor = this.proximoCursor();
    if (cursor !== null && !this.cargando()) {
      this.cargarPagina(cursor);
    }
  }

  protected adjuntosDe(evento: EventoClinicoResponse): AdjuntoClinicoResponse[] {
    if (evento.referencia === undefined) {
      return [];
    }
    return this.adjuntos().filter((a) => a.entradaClinicaId === evento.referencia);
  }

  protected sePuedeVer(adjunto: AdjuntoClinicoResponse): boolean {
    return TIPOS_PREVIEWABLES.includes(adjunto.contentType ?? '');
  }

  /** Descarga el binario como blob y lo muestra (imagenes) o lo guarda (resto). */
  protected abrirAdjunto(adjunto: AdjuntoClinicoResponse, descargar: boolean): void {
    if (this.historiaId === null || adjunto.id === undefined) {
      return;
    }
    const titulo = adjunto.titulo ?? adjunto.nombreArchivo ?? 'Adjunto';
    this.api.descargar(this.historiaId, adjunto.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        this.blobUrls.push(url);
        if (descargar) {
          const enlace = document.createElement('a');
          enlace.href = url;
          enlace.download = adjunto.nombreArchivo ?? titulo;
          enlace.click();
        } else {
          this.preview.set({ titulo, url: this.sanitizer.bypassSecurityTrustUrl(url) });
        }
      },
      error: (e: unknown) => this.error.set(traducirErrorTimeline(e)),
    });
  }

  protected cerrarPreview(): void {
    this.preview.set(null);
  }

  private cargarPagina(cursor: string | null): void {
    if (this.historiaId === null) {
      return;
    }
    this.cargando.set(true);
    this.api.verTimeline(this.historiaId, cursor ?? undefined).subscribe({
      next: (pagina) => {
        // El orden es el del backend: se agrega al final, sin reordenar.
        this.eventos.update((previos) => [...previos, ...(pagina.eventos ?? [])]);
        this.proximoCursor.set(pagina.proximoCursor ?? null);
        this.cargando.set(false);
      },
      error: (e: unknown) => this.fallar(e),
    });
  }

  private cargarAdjuntos(): void {
    if (this.historiaId === null) {
      return;
    }
    this.api.listarAdjuntos(this.historiaId).subscribe({
      next: (pagina) => this.adjuntos.set(pagina.content ?? []),
      // Los adjuntos son complementarios: si fallan, el timeline sigue siendo util.
      error: () => this.adjuntos.set([]),
    });
  }

  private fallar(e: unknown): void {
    this.error.set(traducirErrorTimeline(e));
    this.cargando.set(false);
  }

  private soltarBlobs(): void {
    this.blobUrls.forEach((url) => URL.revokeObjectURL(url));
    this.blobUrls = [];
  }
}
