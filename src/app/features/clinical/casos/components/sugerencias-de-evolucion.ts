import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { EvolucionDelCasoPlanResponse } from '../../../../api/generated/model/evolucion-del-caso-plan-response';
import { SugerenciaDeEvolucionCitaResponse } from '../../../../api/generated/model/sugerencia-de-evolucion-cita-response';
import { SugerenciaDeEvolucionGeneracionResponse } from '../../../../api/generated/model/sugerencia-de-evolucion-generacion-response';
import { SugerenciaDeEvolucionResponse } from '../../../../api/generated/model/sugerencia-de-evolucion-response';
import {
  SugerenciaDeEvolucionRespuestaRequest,
  SugerenciaDeEvolucionRespuestaRequestRespuestaEnum as Respuesta,
} from '../../../../api/generated/model/sugerencia-de-evolucion-respuesta-request';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { PERMISO_EVOLUCION_SUGERIR, PERMISO_HC_WRITE } from '../../../../core/models/permisos';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import { fechaYHora } from '../../models/etiquetas-de-historia';
import { Justificacion } from '../../services/historia-clinica-api';
import { traducirErrorCaso } from '../casos-errors';
import { SugerenciasApi } from '../sugerencias-api';

type Sugerencia = SugerenciaDeEvolucionResponse;

type Historial =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'oculta' }
  | { readonly tipo: 'listo'; readonly sugerencias: readonly Sugerencia[] }
  | { readonly tipo: 'error'; readonly mensaje: string };

/** Un rechazo al pedir o al responder, con el texto a mostrar y si tiene sentido reintentar. */
interface Rechazo {
  readonly mensaje: string;
  readonly reintentable: boolean;
}

/** Un pedido anterior: una fila por `generacionId`. */
interface Pedido {
  readonly generacionId: string;
  readonly solicitadaEn: string | undefined;
  readonly sugerencias: readonly Sugerencia[];
}

/** El codigo que el servidor manda cuando un texto parecia una instruccion y no viajo al modelo. */
const TEXTO_OMITIDO = 'TEXTO_OMITIDO';

/** Los rechazos del modelo: transitorios, con el texto del servidor y la opcion de reintentar. */
const RECHAZOS_DEL_MODELO = new Set([
  'generacion-en-curso',
  'modelo-ocupado',
  'modelo-no-disponible',
]);

/** Los hallazgos de la fase 1 en palabras. Un codigo nuevo se muestra tal cual. */
const HALLAZGOS: Readonly<Record<string, string>> = {
  DOLOR_SIN_MEJORA: 'Dolor sin mejora',
  DOLOR_EN_AUMENTO: 'Dolor en aumento',
  EVOLUCION_DESFAVORABLE: 'Evolución desfavorable',
  MALA_TOLERANCIA: 'Mala tolerancia',
  MEDICION_SIN_CAMBIO: 'Medición sin cambio',
  MEDICION_EMPEORA: 'Medición que empeora',
  BAJA_ADHERENCIA: 'Baja adherencia',
  FRECUENCIA_BAJO_PLAN: 'Frecuencia por debajo del plan',
  PLAN_COMPLETO_ABIERTO: 'Plan completo sin cerrar',
  PLAN_EXCEDIDO_EN_TIEMPO: 'Plan excedido en tiempo',
  SIN_PLAN_ACTIVO: 'Sin plan activo',
  CONDUCTA_SIN_SEGUIR: 'Conducta sin seguir',
  SIN_MEDICIONES: 'Sin mediciones',
};

/** Las opciones rapidas del descarte. La ultima abre el texto libre. */
export const MOTIVOS_DE_DESCARTE = [
  'No aplica al paciente',
  'Ya se hizo',
  'Fuente no pertinente',
] as const;
const OTRO_MOTIVO = 'OTRO';
export const MAXIMO_DEL_MOTIVO = 300;

/**
 * Sugerencias de revision del tratamiento en la evolucion de un caso (M31 fase 2).
 *
 * <p>Las redacta un modelo local a partir de un hallazgo de la fase 1 y de pasajes de la biblioteca
 * del centro. No son indicaciones: el profesional las acepta o las descarta, y aceptar no cambia
 * nada por si solo. "Usar en nueva version del plan" solo lleva el texto al motivo del formulario.
 *
 * <p>Sin `evolucion:sugerir`, o con la funcion apagada (404 en el historial), la seccion no se
 * muestra: el historial pide el mismo permiso que pedir sugerencias.
 */
@Component({
  selector: 'app-sugerencias-de-evolucion',
  imports: [Alerta, Ayuda, PanelLateral, RouterLink],
  templateUrl: './sugerencias-de-evolucion.html',
  styleUrl: './sugerencias-de-evolucion.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SugerenciasDeEvolucion {
  private readonly api = inject(SugerenciasApi);
  private readonly avisos = inject(AvisosStore);
  private readonly contexto = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);
  private readonly router = inject(Router);

  readonly casoId = input.required<number>();
  readonly justificacion = input<Justificacion>(null);
  /** El plan vivo del caso segun la evolucion, o nada si no tiene. */
  readonly plan = input<EvolucionDelCasoPlanResponse | null | undefined>(null);
  /** A donde lleva "Usar en nueva version del plan". Sin ruta, solo se marca como util. */
  readonly rutaPlan = input<string | null>(null);

  protected readonly motivos = MOTIVOS_DE_DESCARTE;
  protected readonly otroMotivo = OTRO_MOTIVO;
  protected readonly maximoDelMotivo = MAXIMO_DEL_MOTIVO;
  protected readonly fechaYHora = fechaYHora;

  protected readonly historial = signal<Historial>({ tipo: 'cargando' });
  protected readonly generando = signal(false);
  protected readonly rechazoAlPedir = signal<Rechazo | null>(null);
  protected readonly resultado = signal<SugerenciaDeEvolucionGeneracionResponse | null>(null);
  protected readonly rechazoAlResponder = signal<string | null>(null);
  /** La sugerencia que se esta respondiendo: deshabilita sus botones. */
  protected readonly respondiendo = signal<number | null>(null);

  // Descarte
  protected readonly descartando = signal<Sugerencia | null>(null);
  protected readonly opcionDeDescarte = signal<string | null>(null);
  protected readonly textoDeDescarte = signal('');
  protected readonly motivoDeDescarte = computed(() => {
    const opcion = this.opcionDeDescarte();
    return opcion === OTRO_MOTIVO ? this.textoDeDescarte().trim() : (opcion ?? '');
  });

  private readonly puedeSugerir = computed(() => this.permisos.tiene(PERMISO_EVOLUCION_SUGERIR));

  /** Llevar el texto a una version nueva exige un plan que se pueda versionar y poder hacerlo. */
  protected readonly puedeVersionar = computed(() => {
    const estado = this.plan()?.estado;
    return (
      (estado === 'ACTIVO' || estado === 'SUSPENDIDO') &&
      this.rutaPlan() !== null &&
      this.permisos.tiene(PERMISO_HC_WRITE)
    );
  });

  /** El pedido que se acaba de responder: sigue a la vista aunque ya no le queden pendientes. */
  private readonly respondidoAhora = signal<string | null>(null);

  /**
   * Las sugerencias a la vista: las del pedido recien hecho, o las del ultimo pedido si alguna
   * sigue pendiente (o si se respondio recien, para que la respuesta se vea en su lugar).
   */
  protected readonly actuales = computed<readonly Sugerencia[]>(() => {
    const resultado = this.resultado();
    if (resultado !== null) return resultado.sugerencias ?? [];
    const ultimo = this.pedidos()[0];
    if (ultimo === undefined) return [];
    const aLaVista =
      ultimo.generacionId === this.respondidoAhora() ||
      ultimo.sugerencias.some((s) => s.respuesta === 'PENDIENTE');
    return aLaVista ? ultimo.sugerencias : [];
  });

  /** El pedido que se muestra arriba, para no repetirlo en el historial. */
  private readonly generacionActual = computed(() => {
    const resultado = this.resultado();
    if (resultado !== null) return resultado.generacionId ?? null;
    return this.actuales()[0]?.generacionId ?? null;
  });

  private readonly pedidos = computed<readonly Pedido[]>(() => {
    const historial = this.historial();
    if (historial.tipo !== 'listo') return [];
    const porGeneracion = new Map<string, Sugerencia[]>();
    for (const sugerencia of historial.sugerencias) {
      const clave = sugerencia.generacionId ?? '';
      const grupo = porGeneracion.get(clave);
      if (grupo) grupo.push(sugerencia);
      else porGeneracion.set(clave, [sugerencia]);
    }
    return [...porGeneracion].map(([generacionId, sugerencias]) => ({
      generacionId,
      solicitadaEn: sugerencias[0].solicitadaEn,
      sugerencias,
    }));
  });

  protected readonly anteriores = computed(() =>
    this.pedidos().filter((p) => p.generacionId !== this.generacionActual()),
  );

  /**
   * Solo `TEXTO_OMITIDO`, traducido. Las demas advertencias del pedido son las de la fase 1 (sesiones
   * sin caso, recorte por tope), que la tarjeta de evolucion ya muestra: no se repiten aca.
   */
  protected readonly advertencias = computed(() =>
    (this.resultado()?.advertencias ?? []).includes(TEXTO_OMITIDO)
      ? ['Se omitió un texto de la historia que parecía contener instrucciones.']
      : [],
  );

  private pedidoDelHistorial: Subscription | null = null;
  private pedidoDeGeneracion: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.pedidoDelHistorial?.unsubscribe();
      this.pedidoDeGeneracion?.unsubscribe();
    });
    effect(() => {
      this.casoId();
      this.justificacion();
      this.puedeSugerir();
      untracked(() => this.cargarHistorial());
    });
  }

  protected hallazgo(codigo: string | undefined): string {
    return (codigo && HALLAZGOS[codigo]) || codigo || 'Hallazgo';
  }

  protected fuente(cita: SugerenciaDeEvolucionCitaResponse): string {
    const titulo = `«${cita.titulo ?? 'Libro sin título'}»`;
    const { paginaDesde: desde, paginaHasta: hasta } = cita;
    if (desde === undefined) return titulo;
    return hasta === undefined || hasta === desde
      ? `${titulo}, pág. ${desde}`
      : `${titulo}, págs. ${desde}–${hasta}`;
  }

  protected resumen(pedido: Pedido): string {
    const contar = (respuesta: string) =>
      pedido.sugerencias.filter((s) => s.respuesta === respuesta).length;
    const partes = [
      `${pedido.sugerencias.length} ${pedido.sugerencias.length === 1 ? 'sugerencia' : 'sugerencias'}`,
    ];
    const aceptadas = contar('ACEPTADA');
    const descartadas = contar('DESCARTADA');
    const pendientes = contar('PENDIENTE');
    if (aceptadas) partes.push(`${aceptadas} ${aceptadas === 1 ? 'aceptada' : 'aceptadas'}`);
    if (descartadas)
      partes.push(`${descartadas} ${descartadas === 1 ? 'descartada' : 'descartadas'}`);
    if (pendientes) partes.push(`${pendientes} ${pendientes === 1 ? 'pendiente' : 'pendientes'}`);
    return partes.join(' · ');
  }

  protected pedir(): void {
    const consultorioId = this.contexto.consultorioId();
    if (consultorioId === null || this.generando()) return;
    this.generando.set(true);
    this.rechazoAlPedir.set(null);
    this.rechazoAlResponder.set(null);
    this.pedidoDeGeneracion?.unsubscribe();
    this.pedidoDeGeneracion = this.api
      .generar(consultorioId, this.casoId(), this.justificacion())
      .subscribe({
        next: (resultado) => {
          this.generando.set(false);
          this.resultado.set(resultado);
          // El historial suma el pedido anterior y queda listo para la proxima respuesta.
          this.cargarHistorial();
        },
        error: (error: unknown) => {
          this.generando.set(false);
          this.rechazoAlPedir.set(rechazo(error));
        },
      });
  }

  protected aceptar(sugerencia: Sugerencia): void {
    const versionar = this.puedeVersionar();
    this.responder(sugerencia, { respuesta: Respuesta.ACEPTADA }, () => {
      if (versionar) {
        this.router
          .navigateByUrl(this.rutaPlan() as string, {
            state: { motivoModificacion: sugerencia.texto ?? '' },
          })
          .catch((error: unknown) => console.error('No se pudo abrir el plan', error));
      } else {
        this.avisos.exito('Sugerencia marcada como útil');
      }
    });
  }

  protected abrirDescarte(sugerencia: Sugerencia): void {
    this.descartando.set(sugerencia);
    this.opcionDeDescarte.set(null);
    this.textoDeDescarte.set('');
  }

  protected cerrarDescarte(): void {
    this.descartando.set(null);
    this.rechazoAlResponder.set(null);
  }

  protected confirmarDescarte(): void {
    const sugerencia = this.descartando();
    const motivo = this.motivoDeDescarte();
    if (sugerencia === null || motivo === '') return;
    this.responder(sugerencia, { respuesta: Respuesta.DESCARTADA, motivo }, () => {
      this.descartando.set(null);
      this.avisos.exito('Sugerencia descartada');
    });
  }

  private responder(
    sugerencia: Sugerencia,
    respuesta: Omit<SugerenciaDeEvolucionRespuestaRequest, 'version'>,
    alTerminar: () => void,
  ): void {
    const consultorioId = this.contexto.consultorioId();
    if (consultorioId === null || sugerencia.id === undefined) return;
    this.respondiendo.set(sugerencia.id);
    this.rechazoAlResponder.set(null);
    this.api
      .responder(
        consultorioId,
        this.casoId(),
        sugerencia.id,
        { ...respuesta, version: sugerencia.version ?? 0 },
        this.justificacion(),
      )
      .subscribe({
        next: (respondida) => {
          this.respondiendo.set(null);
          this.reemplazar(respondida);
          alTerminar();
        },
        error: (error: unknown) => {
          this.respondiendo.set(null);
          this.rechazoAlResponder.set(rechazo(error).mensaje);
          // Ya respondida o cambiada por otra persona: el descarte ya no aplica, se cierra el panel y
          // se relee para mostrar lo que quedo. Ante otro error el panel sigue abierto con el motivo.
          if (error instanceof AkineHttpError && error.status === 409) {
            this.descartando.set(null);
            this.cargarHistorial();
          }
        },
      });
  }

  /** Refleja la respuesta en el pedido de arriba y en el historial. */
  private reemplazar(respondida: Sugerencia): void {
    const cambiar = (lista: readonly Sugerencia[] | undefined) =>
      lista?.map((s) => (s.id === respondida.id ? respondida : s));
    this.respondidoAhora.set(respondida.generacionId ?? null);
    this.resultado.update((r) => (r === null ? r : { ...r, sugerencias: cambiar(r.sugerencias) }));
    this.historial.update((h) =>
      h.tipo === 'listo' ? { ...h, sugerencias: cambiar(h.sugerencias) ?? [] } : h,
    );
  }

  private cargarHistorial(): void {
    const consultorioId = this.contexto.consultorioId();
    this.pedidoDelHistorial?.unsubscribe();
    if (consultorioId === null || !this.puedeSugerir()) {
      this.historial.set({ tipo: 'oculta' });
      return;
    }
    if (this.historial().tipo !== 'listo') this.historial.set({ tipo: 'cargando' });
    this.pedidoDelHistorial = this.api
      .historial(consultorioId, this.casoId(), this.justificacion())
      .subscribe({
        next: (pagina) => this.historial.set({ tipo: 'listo', sugerencias: pagina.content ?? [] }),
        error: (error: unknown) => {
          const traducido = traducirErrorCaso(error);
          this.historial.set(
            traducido.causa === 'no-encontrado' || traducido.causa === 'sin-permiso'
              ? { tipo: 'oculta' }
              : { tipo: 'error', mensaje: traducido.mensaje },
          );
        },
      });
  }
}

/** Los rechazos del modelo muestran el texto del servidor; los demas, el de los casos. */
function rechazo(error: unknown): Rechazo {
  if (error instanceof AkineHttpError) {
    const tipo = error.problemType;
    if (tipo !== null && RECHAZOS_DEL_MODELO.has(tipo)) {
      return { mensaje: error.mensaje, reintentable: true };
    }
    if (tipo === 'sugerencia-ya-respondida') {
      return { mensaje: error.mensaje, reintentable: false };
    }
    if (tipo === 'concurrent-modification') {
      return {
        mensaje:
          'La sugerencia cambió después de que la abriste. Ya la volvimos a leer: revisá cómo quedó.',
        reintentable: false,
      };
    }
  }
  const traducido = traducirErrorCaso(error);
  return {
    mensaje: traducido.mensaje,
    reintentable: traducido.causa !== 'sin-permiso' && traducido.causa !== 'requiere-justificacion',
  };
}
