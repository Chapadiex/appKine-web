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

import { FuenteDeConsultaResponse } from '../../../../api/generated/model/fuente-de-consulta-response';
import { TurnoDeConsultaRequestRolEnum } from '../../../../api/generated/model/turno-de-consulta-request';
import { PERMISO_BIBLIOTECA_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { traducirErrorBiblioteca } from '../../models/biblioteca-errors';
import { ConsultaApi, EventoConsulta } from '../../services/consulta-api';

const MAX_PREGUNTA = 600;
const MAX_TURNOS = 6;
const AVISO_FIJO =
  'Respuestas orientativas basadas sólo en la bibliografía cargada por el centro. No reemplazan el criterio profesional.';

export interface MensajeDeCharla {
  readonly rol: 'usuario' | 'asistente';
  readonly texto: string;
  readonly fuentes: FuenteDeConsultaResponse[];
  readonly estado: 'esperando' | 'en-cola' | 'escribiendo' | 'listo' | 'error';
  readonly posicion?: number;
  readonly sinMaterial?: boolean;
}

/**
 * Chat con la biblioteca. La charla vive sólo en memoria: se pierde al salir o con "Nueva charla".
 * Cada fragmento reemplaza el último mensaje (nunca se muta en sitio).
 */
@Component({
  selector: 'app-consulta-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CabeceraDePagina, Ayuda, EstadoVacio, RouterLink],
  templateUrl: './consulta-page.html',
  styleUrl: './consulta-page.css',
})
export class ConsultaPage {
  private readonly api = inject(ConsultaApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);

  protected readonly aviso = AVISO_FIJO;
  protected readonly maxPregunta = MAX_PREGUNTA;

  protected readonly mensajes = signal<readonly MensajeDeCharla[]>([]);
  protected readonly texto = signal('');
  protected readonly deshabilitada = signal(false);
  protected readonly anuncio = signal('');

  protected readonly enCurso = computed(() => {
    const ultimo = this.mensajes().at(-1);
    return ultimo?.rol === 'asistente' && ultimo.estado !== 'listo' && ultimo.estado !== 'error';
  });
  protected readonly puedeEnviar = computed(
    () => !this.deshabilitada() && !this.enCurso() && this.texto().trim().length > 0,
  );
  protected readonly puedeAbrirLibros = computed(() =>
    this.permisos.tiene(PERMISO_BIBLIOTECA_MANAGE),
  );

  private readonly lista = viewChild<ElementRef<HTMLElement>>('lista');
  private suscripcion: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.abortar());
    // Cambiar de centro corta la charla: ni el texto en curso ni el historial viajan al nuevo.
    let organizacion: number | null | undefined;
    effect(() => {
      const actual = this.tenantContext.organizationId();
      untracked(() => {
        if (organizacion !== undefined && organizacion !== actual) {
          this.nuevaCharla();
          this.deshabilitada.set(false);
        }
        organizacion = actual;
      });
    });
    // Desplazamiento al último mensaje mientras llega el texto.
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
    const orgId = this.tenantContext.organizationId();
    if (orgId === null) {
      return;
    }
    const pregunta = this.texto().trim();
    const historial = this.historialDePares();
    this.mensajes.update((actuales) => [
      ...actuales,
      { rol: 'usuario', texto: pregunta, fuentes: [], estado: 'listo' },
      { rol: 'asistente', texto: '', fuentes: [], estado: 'esperando' },
    ]);
    this.texto.set('');
    this.anuncio.set('');
    this.abortar();
    this.suscripcion = this.api.consultar(orgId, { pregunta, historial }).subscribe({
      next: (evento) => this.aplicar(evento),
      error: (error: unknown) => this.fallar(error),
    });
  }

  protected nuevaCharla(): void {
    this.abortar();
    this.mensajes.set([]);
    this.texto.set('');
    this.anuncio.set('');
  }

  protected paginas(f: FuenteDeConsultaResponse): string {
    return f.paginaDesde === f.paginaHasta
      ? `pág. ${f.paginaDesde}`
      : `págs. ${f.paginaDesde}–${f.paginaHasta}`;
  }

  protected textoDeMensaje(m: MensajeDeCharla): string {
    if (m.estado === 'en-cola') {
      return `En cola, sos el N.º ${m.posicion}.`;
    }
    return m.estado === 'esperando' ? 'Buscando en la biblioteca…' : m.texto;
  }

  /** Sólo pares usuario+asistente cuya respuesta terminó bien y con material: los últimos 3. */
  private historialDePares(): { rol: TurnoDeConsultaRequestRolEnum; texto: string }[] {
    const ms = this.mensajes();
    const turnos: { rol: TurnoDeConsultaRequestRolEnum; texto: string }[] = [];
    for (let i = 0; i + 1 < ms.length; i += 2) {
      const [u, a] = [ms[i], ms[i + 1]];
      if (a.estado === 'listo' && !a.sinMaterial) {
        turnos.push(
          { rol: TurnoDeConsultaRequestRolEnum.USUARIO, texto: u.texto },
          { rol: TurnoDeConsultaRequestRolEnum.ASISTENTE, texto: a.texto },
        );
      }
    }
    return turnos.slice(-MAX_TURNOS);
  }

  private abortar(): void {
    this.suscripcion?.unsubscribe();
    this.suscripcion = null;
  }

  private cambiarUltimo(cambio: (m: MensajeDeCharla) => MensajeDeCharla): void {
    this.mensajes.update((actuales) => {
      const ultimo = actuales.at(-1);
      return ultimo ? [...actuales.slice(0, -1), cambio(ultimo)] : actuales;
    });
  }

  private aplicar(evento: EventoConsulta): void {
    switch (evento.tipo) {
      case 'espera':
        this.cambiarUltimo((m) => ({ ...m, estado: 'en-cola', posicion: evento.posicion }));
        break;
      case 'fuentes':
        this.cambiarUltimo((m) => ({ ...m, fuentes: evento.fuentes }));
        break;
      case 'texto':
        this.cambiarUltimo((m) => ({
          ...m,
          estado: 'escribiendo',
          texto: m.texto + evento.texto,
        }));
        break;
      case 'fin':
        this.cambiarUltimo((m) => ({ ...m, estado: 'listo', sinMaterial: evento.sinMaterial }));
        this.anuncio.set('Respuesta lista');
        break;
      case 'error':
        this.terminarConError(
          evento.type.endsWith('asistente-no-disponible')
            ? 'El asistente no está disponible en este momento.'
            : 'No se pudo completar la consulta. Volvé a intentar en un momento.',
        );
        break;
    }
  }

  private fallar(error: unknown): void {
    const traducido = traducirErrorBiblioteca(error);
    if (traducido.causa === 'deshabilitada') {
      this.deshabilitada.set(true);
      this.mensajes.set([]);
      return;
    }
    this.terminarConError(traducido.mensaje);
  }

  private terminarConError(mensaje: string): void {
    this.cambiarUltimo((m) => ({ ...m, estado: 'error', texto: mensaje, fuentes: [] }));
    this.anuncio.set('Error en la respuesta');
  }
}
