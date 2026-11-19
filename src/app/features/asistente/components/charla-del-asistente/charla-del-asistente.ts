import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  input,
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
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { formatearInstante } from '../../../../shared/utils/instantes';
import { traducirErrorAsistente } from '../../models/asistente-errors';
import { AsistenteApi, TurnoPrevio } from '../../services/asistente-api';
import { Dictado } from '../../../../shared/dictado/dictado.directive';
import { TarjetaDeAccion } from '../tarjeta-de-accion/tarjeta-de-accion';

let siguienteId = 0;
/** Una consulta entra en 300; una atención dictada con su nota necesita más. */
const MAX_PREGUNTA = 600;
/** El servidor usa los últimos tres: mandar más es ruido. */
const MAX_TURNOS = 3;
const MAX_FILAS_VISIBLES = 10;
const AVISO_FIJO =
  'Responde con los datos de la sede activa y con tus permisos. Sólo consulta: no modifica nada.';
/** Desde que el servidor propone una acción: ya no es sólo consulta, pero nada se graba sin confirmar. */
const AVISO_CON_ACCIONES =
  'Responde con los datos de la sede activa y con tus permisos. Antes de grabar algo te muestra qué entendió y esperás vos para confirmar.';

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

/** La tabla de una respuesta, ya armada: se calcula una vez al llegar y no en cada render. */
/**
 * Los valores de estado que manda el backend, en palabras. Locales a esta pantalla: ADR-0004 no deja
 * importar los formateadores de turnos, asistencia ni reportes desde otra funcionalidad.
 */
const VALORES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  estado: {
    RESERVADO: 'reservado',
    CONFIRMADO: 'confirmado',
    PRESENTE: 'presente, esperando',
    EN_ATENCION: 'en atención',
    ATENDIDO: 'atendido',
    AUSENTE: 'ausente',
    RETIRADO: 'se retiró sin atenderse',
    CANCELADO: 'cancelado',
  },
  resultado: { PRESENTE: 'presente', PRESENTE_TARDE: 'llegó tarde', AUSENTE: 'ausente' },
  estadoClase: {
    PROGRAMADA: 'programada',
    EN_CURSO: 'en curso',
    REALIZADA: 'realizada',
    CANCELADA: 'cancelada',
  },
  tipo: { DINERO: 'dinero', CONTEO: 'cantidad', PORCENTAJE: 'porcentaje' },
};
const NUMERO = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const INSTANTE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export interface TablaDeDatos {
  readonly columnas: readonly string[];
  readonly filas: readonly (readonly string[])[];
  readonly total: number;
}

export interface MensajeDelAsistente {
  readonly rol: 'usuario' | 'asistente';
  readonly texto: string;
  readonly estado: 'esperando' | 'listo' | 'error';
  /** La pregunta que originó la respuesta: una opción elegida la reenvía con el `personaId`. */
  readonly pregunta?: string;
  readonly respuesta?: RespuestaAsistenteResponse;
  readonly tabla?: TablaDeDatos;
}

/**
 * Charla con el asistente de datos, la de la pantalla y la del panel flotante. Vive sólo en memoria: se pierde al salir, al cambiar de sede o
 * con "Nueva charla". El servidor no la guarda; el historial viaja en cada pregunta.
 */
@Component({
  selector: 'app-charla-del-asistente',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Dictado, EstadoVacio, RouterLink, TarjetaDeAccion],
  host: { class: 'charla', '[class.charla--compacta]': 'compacta()' },
  templateUrl: './charla-del-asistente.html',
  styleUrl: './charla-del-asistente.css',
})
export class CharlaDelAsistente {
  private readonly api = inject(AsistenteApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly diaDeLaSede = inject(DiaDeLaSede);

  /** En el panel flotante: lista más baja y sin tarjeta propia. */
  readonly compacta = input(false);

  /** Único por instancia: la pantalla y el panel flotante pueden convivir en el DOM. */
  protected readonly idPregunta = `asistente-pregunta-${++siguienteId}`;

  /** Hubo al menos una propuesta en esta charla: el aviso deja de decir "sólo consulta". */
  private readonly huboAcciones = signal(false);
  protected readonly aviso = computed(() =>
    this.huboAcciones() ? AVISO_CON_ACCIONES : AVISO_FIJO,
  );
  protected readonly sede = this.tenantContext.consultorioId;
  protected readonly maxPregunta = MAX_PREGUNTA;
  protected readonly sugerencias = SUGERENCIAS;
  protected readonly maxFilas = MAX_FILAS_VISIBLES;

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
  /** Burbuja que se está escribiendo y cuántos caracteres ya se ven. */
  private readonly escritura = signal<{ indice: number; largo: number } | null>(null);
  private temporizador: ReturnType<typeof setInterval> | null = null;

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
      this.escritura();
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

  nuevaCharla(): void {
    this.abortar();
    this.mensajes.set([]);
    this.texto.set('');
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
        const tabla = respuesta.filas.length > 0 ? this.armarTabla(respuesta) : undefined;
        if (respuesta.accion) {
          this.huboAcciones.set(true);
        }
        this.cambiarUltimo((m) => ({
          ...m,
          estado: 'listo',
          texto: respuesta.texto,
          respuesta,
          tabla,
        }));
        this.anuncio.set('Respuesta lista');
        this.escribir(this.mensajes().length - 1, respuesta.texto.length);
      },
      error: (error: unknown) => this.fallar(error),
    });
  }

  /** Texto de la burbuja: mientras se escribe, sólo lo que ya apareció. */
  protected textoVisible(m: MensajeDelAsistente, indice: number): string {
    const escritura = this.escritura();
    return escritura?.indice === indice ? m.texto.slice(0, escritura.largo) : m.texto;
  }

  protected escribiendo(indice: number): boolean {
    return this.escritura()?.indice === indice;
  }

  /**
   * Efecto de escritura: la respuesta ya llegó entera (sale de una plantilla del servidor) y se
   * revela de a poco, en no más de ~1,5 s. Sin animación si el usuario pidió movimiento reducido.
   * Los datos, opciones y enlace aparecen al terminar.
   */
  private escribir(indice: number, total: number): void {
    this.terminarEscritura();
    const reducido =
      typeof window.matchMedia !== 'function' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducido || total === 0) {
      return;
    }
    const paso = Math.max(2, Math.ceil(total / 75));
    this.escritura.set({ indice, largo: 0 });
    this.temporizador = setInterval(() => {
      const actual = this.escritura();
      if (!actual || actual.largo + paso >= total) {
        this.terminarEscritura();
      } else {
        this.escritura.set({ indice, largo: actual.largo + paso });
      }
    }, 20);
  }

  private terminarEscritura(): void {
    if (this.temporizador !== null) {
      clearInterval(this.temporizador);
      this.temporizador = null;
    }
    this.escritura.set(null);
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

  /** Columnas con dato en las primeras filas (sin ids internos), y fechas en la zona de la sede. */
  private armarTabla(respuesta: RespuestaAsistenteResponse): TablaDeDatos {
    const visibles = respuesta.filas.slice(0, MAX_FILAS_VISIBLES) as Record<string, unknown>[];
    const claves = [
      ...new Set(
        visibles.flatMap((fila) =>
          Object.entries(fila)
            .filter(
              ([clave, valor]) =>
                !CLAVES_OCULTAS.has(clave) && valor !== null && valor !== undefined,
            )
            .map(([clave]) => clave),
        ),
      ),
    ];
    const zona = this.diaDeLaSede.zona();
    const celda = (fila: Record<string, unknown>, clave: string): string => {
      const valor = fila[clave];
      if (valor === null || valor === undefined) {
        return '—';
      }
      // Instantes ISO (de las intenciones y de las consultas libres) en la zona de la sede.
      if (typeof valor === 'string' && INSTANTE_ISO.test(valor)) {
        return formatearInstante(valor, zona) ?? valor;
      }
      if (typeof valor === 'number') {
        return NUMERO.format(valor);
      }
      if (typeof valor === 'boolean') {
        return valor ? 'sí' : 'no';
      }
      return VALORES[clave]?.[String(valor)] ?? String(valor);
    };
    return {
      columnas: claves.map((clave) => ETIQUETAS[clave] ?? clave.replaceAll('_', ' ')),
      filas: visibles.map((fila) => claves.map((clave) => celda(fila, clave))),
      total: respuesta.filas.length,
    };
  }

  private abortar(): void {
    this.terminarEscritura();
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
