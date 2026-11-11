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

import { OpcionDeAclaracionResponse } from '../../../../api/generated/model/opcion-de-aclaracion-response';
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
const MAX_LIBROS_PREFERIDOS = 10;
const PREGUNTA_PROFUNDIZAR = 'Más detalle sobre lo anterior';
const AVISO_FIJO =
  'Respuestas orientativas basadas sólo en la bibliografía cargada por el centro. No reemplazan el criterio profesional.';
/** Respuesta fija sin material (R11): el modelo también puede devolverla, y se trata igual. */
const SIN_MATERIAL = 'No encontré material en la biblioteca para responder eso.';

export interface MensajeDeCharla {
  readonly rol: 'usuario' | 'asistente';
  readonly texto: string;
  readonly fuentes: FuenteDeConsultaResponse[];
  readonly estado: 'esperando' | 'en-cola' | 'escribiendo' | 'listo' | 'error';
  readonly posicion?: number;
  readonly sinMaterial?: boolean;
  readonly etapa?: 'buscando' | 'redactando';
  /** Repregunta del servidor: sus opciones son botones y nunca entra al historial. */
  readonly aclaracion?: boolean;
  readonly opciones?: readonly OpcionDeAclaracionResponse[];
  /** Respuesta a "Profundizar": no ofrece profundizar de nuevo. */
  readonly profunda?: boolean;
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
    this.texto.set('');
    this.lanzar(orgId, pregunta, this.mensajes());
  }

  /** Una opción de la repregunta arranca una pregunta nueva: sin historial ni libros preferidos. */
  protected elegirOpcion(opcion: OpcionDeAclaracionResponse): void {
    const orgId = this.tenantContext.organizationId();
    if (this.enCurso() || this.deshabilitada() || orgId === null) {
      return;
    }
    this.lanzar(orgId, opcion.pregunta, []);
  }

  /** Pide más detalle de la respuesta en la posición indicada, con la charla hasta ella. */
  protected profundizar(indice: number): void {
    const orgId = this.tenantContext.organizationId();
    if (this.enCurso() || this.deshabilitada() || orgId === null) {
      return;
    }
    this.lanzar(orgId, PREGUNTA_PROFUNDIZAR, this.mensajes().slice(0, indice + 1), true);
  }

  protected puedeProfundizar(m: MensajeDeCharla): boolean {
    return (
      m.rol === 'asistente' &&
      m.estado === 'listo' &&
      m.fuentes.length > 0 &&
      !m.sinMaterial &&
      !m.aclaracion &&
      !m.profunda
    );
  }

  /**
   * Envía la pregunta con el historial de los mensajes previos y, si lo hay, los libros de la
   * última respuesta buena como librosPreferidos (R1). Lo que ya está en pantalla se conserva.
   */
  private lanzar(
    orgId: number,
    pregunta: string,
    previos: readonly MensajeDeCharla[],
    profunda = false,
  ): void {
    const historial = this.historialDePares(previos);
    const libros = this.librosDeLaUltimaRespuesta(previos, historial.length > 0);
    this.mensajes.update((actuales) => [
      ...actuales,
      { rol: 'usuario', texto: pregunta, fuentes: [], estado: 'listo' },
      { rol: 'asistente', texto: '', fuentes: [], estado: 'esperando', profunda },
    ]);
    this.anuncio.set('');
    this.abortar();
    this.suscripcion = this.api
      .consultar(orgId, {
        pregunta,
        historial,
        ...(libros.length > 0 ? { librosPreferidos: libros } : {}),
      })
      .subscribe({
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
    if (m.estado === 'esperando') {
      return m.etapa === 'redactando' ? 'Redactando…' : 'Buscando en la biblioteca…';
    }
    return m.texto;
  }

  /** Sólo pares usuario+asistente cuya respuesta terminó bien y con material: los últimos 3. */
  private historialDePares(
    ms: readonly MensajeDeCharla[],
  ): { rol: TurnoDeConsultaRequestRolEnum; texto: string }[] {
    const turnos: { rol: TurnoDeConsultaRequestRolEnum; texto: string }[] = [];
    for (let i = 0; i + 1 < ms.length; i += 2) {
      const [u, a] = [ms[i], ms[i + 1]];
      if (a.estado === 'listo' && !a.sinMaterial && !a.aclaracion) {
        turnos.push(
          { rol: TurnoDeConsultaRequestRolEnum.USUARIO, texto: u.texto },
          { rol: TurnoDeConsultaRequestRolEnum.ASISTENTE, texto: a.texto },
        );
      }
    }
    return turnos.slice(-MAX_TURNOS);
  }

  /** Libros distintos de las fuentes de la última respuesta buena, hasta 10; sólo con historial. */
  private librosDeLaUltimaRespuesta(
    ms: readonly MensajeDeCharla[],
    hayHistorial: boolean,
  ): number[] {
    if (!hayHistorial) {
      return [];
    }
    let ultima: MensajeDeCharla | undefined;
    for (let i = 0; i + 1 < ms.length; i += 2) {
      const a = ms[i + 1];
      if (a.estado === 'listo' && !a.sinMaterial && !a.aclaracion) {
        ultima = a;
      }
    }
    const ids = new Set((ultima?.fuentes ?? []).map((f) => f.libroId));
    return [...ids].slice(0, MAX_LIBROS_PREFERIDOS);
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
        // Ya tiene el turno: deja "En cola…" y vuelve a "Buscando…" hasta el primer texto.
        this.cambiarUltimo((m) => ({
          ...m,
          estado: 'esperando',
          posicion: undefined,
          fuentes: evento.fuentes,
        }));
        break;
      case 'texto':
        this.cambiarUltimo((m) => ({
          ...m,
          estado: 'escribiendo',
          texto: m.texto + evento.texto,
        }));
        break;
      case 'etapa':
        this.cambiarUltimo((m) =>
          m.estado === 'escribiendo'
            ? m
            : { ...m, estado: 'esperando', posicion: undefined, etapa: evento.etapa },
        );
        break;
      case 'aclaracion':
        this.cambiarUltimo((m) => ({
          ...m,
          estado: 'escribiendo',
          texto: evento.texto,
          opciones: evento.opciones,
          aclaracion: true,
          posicion: undefined,
        }));
        break;
      case 'fin':
        this.cambiarUltimo((m) => ({
          ...m,
          estado: 'listo',
          sinMaterial: evento.sinMaterial || m.texto.trim() === SIN_MATERIAL,
        }));
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
    // El texto ya recibido queda; el aviso va después.
    this.cambiarUltimo((m) => ({
      ...m,
      estado: 'error',
      texto: m.texto ? `${m.texto}\n\n${mensaje}` : mensaje,
      fuentes: [],
    }));
    this.anuncio.set('Error en la respuesta');
  }
}
