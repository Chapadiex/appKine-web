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
import { RouterLink } from '@angular/router';

import { DetalleOperativoDeClase } from '../../../../api/generated/model/detalle-operativo-de-clase';
import { EventoDeAsistencia } from '../../../../api/generated/model/evento-de-asistencia';
import { ParticipanteOperativo } from '../../../../api/generated/model/participante-operativo';
import { ResultadoDeLoteDeAsistencia } from '../../../../api/generated/model/resultado-de-lote-de-asistencia';
import {
  PERMISO_ASISTENCIA_MANAGE,
  PERMISO_CLASE_MANAGE,
  PERMISO_INSCRIPCION_MANAGE,
  PERMISO_SESION_REGISTER,
} from '../../../../core/models/permisos';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Paginacion } from '../../../../shared/components/paginacion/paginacion';
import { FocoAlMontar } from '../../../../shared/directives/foco-al-montar.directive';
import {
  ErrorAsistencia,
  errorSinContexto,
  traducirErrorAsistencia,
  traducirErrorDeLote,
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
import { avisoDeDevengo } from '../../models/etiquetas-de-devengo';
import { avisoDeConsumo } from '../../models/etiquetas-de-pases';
import { AsistenciaApi } from '../../services/asistencia-api';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import {
  CamposDeSort,
  ordenDeServidor,
} from '../../../../shared/components/tabla/orden-de-servidor';
import { DetalleOperativoRequestParams } from '../../../../api/generated/api/asistencia-de-clases.serviceInterface';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { Migas } from '../../../../shared/components/migas/migas';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';

import { Alerta } from '../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../core/services/avisos.store';

type EstadoCarga =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly detalle: DetalleOperativoDeClase }
  | { readonly tipo: 'error'; readonly error: ErrorAsistencia };

interface FalloDeItem {
  readonly inscripcionId: number;
  readonly nombre: string;
  readonly mensaje: string;
}

/** Lo que la asistencia hizo con el pase de un participante (M29, RN-M29-005). */
interface ConsumoDeItem {
  readonly inscripcionId: number;
  readonly nombre: string;
  readonly texto: string;
}

/**
 * Lo que la asistencia hizo con la deuda de una clase `POR_CLASE` (U-39). `aviso` marca
 * `CON_COBROS` y `SIN_PRECIO`: piden que alguien mire la cuenta corriente, pero no son fallos.
 */
interface DevengoDeItem extends ConsumoDeItem {
  readonly aviso: boolean;
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
 * <p>No muestra nada clinico ni deuda: el detalle operativo no lo trae (privacidad de quien toma
 * lista). Lo unico economico que aparece es lo que el backend devuelve al guardar: si la
 * asistencia consumio o devolvio un credito del pase de la persona, o si no tenia un pase con
 * creditos para la clase (M29, RN-M29-005), y en una oferta `POR_CLASE` que le hizo a la deuda de
 * la clase (U-39). Nada de eso <b>es un error</b>: la asistencia se registra igual
 * (CA-M19-009-06). Sin `pase:read` (U-46 c) llega solo el efecto, y se muestra solo el efecto.
 */
@Component({
  selector: 'app-asistencia-de-clase-page',
  imports: [
    Ayuda,
    Migas,
    CabeceraDePagina,
    RouterLink,
    Paginacion,
    FocoAlMontar,
    ColumnaOrdenable,
    Alerta,
  ],
  templateUrl: './asistencia-de-clase-page.html',
  styleUrl: '../../asistencia.css',
})
export class AsistenciaDeClasePage {
  private readonly api = inject(AsistenciaApi);
  private readonly avisos = inject(AvisosStore);
  private readonly tenant = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

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
  /** Leyenda del campo de observaciones (U-46 d): el contrato las declara operativas. */
  protected readonly avisoObservaciones = 'Operativas: no anotes datos de salud.';

  protected readonly estado = signal<EstadoCarga>({ tipo: 'cargando' });
  protected readonly pagina = signal(0);

  /**
   * Orden de los participantes, pedido al servidor (DP-45): vuelve a la primera pagina. Las marcas
   * sin enviar se conservan, porque van por inscripcion y no por fila, igual que al paginar.
   */
  protected readonly orden = ordenDeServidor<CamposDeSort<DetalleOperativoRequestParams['sort']>>(
    () => {
      this.pagina.set(0);
      this.cargar();
    },
  );

  protected readonly marcas = signal<ReadonlyMap<number, Marca>>(new Map());
  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<ErrorAsistencia | null>(null);
  protected readonly faltanMotivos = signal<readonly number[]>([]);
  protected readonly lote = signal<{
    exitosos: number;
    fallos: readonly FalloDeItem[];
    consumos: readonly ConsumoDeItem[];
    devengos: readonly DevengoDeItem[];
  } | null>(null);
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
  /**
   * Cerrar la clase marca ausentes y cancela la lista de espera: desde el contrato 0.120.0 el
   * backend pide `clase:manage`, `asistencia:manage` e `inscripcion:manage` (AKINE-09.02). Sin los
   * tres, el boton terminaba en 403.
   */
  protected readonly puedeCerrarClase = computed(
    () =>
      !this.permisos.cargados() ||
      (this.permisos.tiene(PERMISO_CLASE_MANAGE) &&
        this.permisos.tiene(PERMISO_ASISTENCIA_MANAGE) &&
        this.permisos.tiene(PERMISO_INSCRIPCION_MANAGE)),
  );

  /** Ofrece la atencion clinica de la clase (AKINE-08.05). Sin permisos cargados, se ofrece. */
  protected readonly puedeAtender = computed(
    () => !this.permisos.cargados() || this.permisos.tiene(PERMISO_SESION_REGISTER),
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
        this.errorAccion.set(null);
        this.historial.set(null);
        this.pagina.set(0);
        this.orden.reiniciar();
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
    this.api.detalle(ids.consultorioId, ids.claseId, this.pagina(), this.orden.sort()).subscribe({
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
      next: () => {
        this.terminarAccion();
        // "Iniciar clase" desaparece con la clase en curso: el foco iria al `body`.
        this.enfocarDespues('#titulo-clase');
      },
      error: (error: unknown) =>
        this.fallarAccionDeClase('No pudimos iniciar la clase', error, () => this.iniciar()),
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
        // El resultado va al aviso global (UX-12). "Cerrar clase" desaparece: el foco al titulo.
        if (resultado.cerroAhora === false) {
          this.avisos.info('La clase ya estaba cerrada', { descripcion: 'No se cambio nada.' });
        } else {
          this.avisos.exito('Clase cerrada', {
            descripcion:
              `Se marcaron ausentes ${ausentados} sin resolver` +
              (espera > 0 ? ` y se cancelaron ${espera} de la lista de espera.` : '.'),
          });
        }
        this.marcas.set(new Map());
        this.terminarAccion();
        this.enfocarDespues('#titulo-clase');
      },
      error: (error: unknown) =>
        this.fallarAccionDeClase('No pudimos cerrar la clase', error, () => this.cerrar()),
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

  protected escribirObservaciones(
    participante: ParticipanteOperativo,
    observaciones: string,
  ): void {
    const id = participante.inscripcion?.id;
    const marca = id === undefined ? undefined : this.marcas().get(id);
    if (id === undefined || marca === undefined) {
      return;
    }
    const siguiente = new Map(this.marcas());
    siguiente.set(id, { ...marca, observaciones });
    this.marcas.set(siguiente);
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
    // "Descartar cambios" desaparece sin pendientes: el foco vuelve a la lista.
    this.enfocarDespues('#titulo-participantes');
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
      // Las marcas no se tocan: un 503 del lote no guardo nada y se reintenta con lo mismo.
      error: (error: unknown) => this.fallarAccion(error, traducirErrorDeLote),
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

  /** Foco a un elemento de la pantalla despues del proximo render (WCAG 2.4.3). */
  private enfocarDespues(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }

  private empezarAccion(): void {
    this.enviando.set(true);
    this.errorAccion.set(null);
    this.lote.set(null);
  }

  private terminarAccion(): void {
    this.enviando.set(false);
    this.cargar();
  }

  private fallarAccion(
    error: unknown,
    traducir: (error: unknown) => ErrorAsistencia = traducirErrorAsistencia,
  ): void {
    this.enviando.set(false);
    this.errorAccion.set(traducir(error));
    // El estado de la clase pudo cambiar por otro operador: se relee para no mentir.
    this.cargar();
  }

  /**
   * Iniciar o cerrar la clase son botones sueltos, sin formulario: su rechazo va al aviso global
   * (UX-12), con Reintentar cuando un fallo de red lo justifica. Se relee igual.
   */
  private fallarAccionDeClase(titulo: string, error: unknown, reintentar: () => void): void {
    this.enviando.set(false);
    const traducido = traducirErrorAsistencia(error);
    const reintentable = traducido.causa === 'red' || traducido.causa === 'otro';
    this.avisos.error(titulo, {
      descripcion: traducido.mensaje,
      accion: reintentable ? { etiqueta: 'Reintentar', ejecutar: reintentar } : undefined,
    });
    this.cargar();
  }
}

function resumirLote(
  resultado: ResultadoDeLoteDeAsistencia,
  nombres: ReadonlyMap<number, string>,
): {
  exitosos: number;
  fallos: FalloDeItem[];
  consumos: ConsumoDeItem[];
  devengos: DevengoDeItem[];
} {
  const fallos = (resultado.items ?? [])
    .filter((item) => !item.resultado)
    .map((item) => ({
      inscripcionId: item.inscripcionId ?? -1,
      nombre: nombres.get(item.inscripcionId ?? -1) ?? `Inscripción ${item.inscripcionId}`,
      mensaje: traducirFalloDeItem(item.problemType, item.detalle).mensaje,
    }));
  const consumos = (resultado.items ?? []).flatMap((item) => {
    const texto = avisoDeConsumo(item.resultado?.consumoDeCredito);
    const id = item.inscripcionId ?? -1;
    return texto === null
      ? []
      : [{ inscripcionId: id, nombre: nombres.get(id) ?? `Inscripción ${id}`, texto }];
  });
  const devengos = (resultado.items ?? []).flatMap((item) => {
    const aviso = avisoDeDevengo(item.resultado?.devengoDeClase);
    const id = item.inscripcionId ?? -1;
    return aviso === null
      ? []
      : [{ inscripcionId: id, nombre: nombres.get(id) ?? `Inscripción ${id}`, ...aviso }];
  });
  return { exitosos: resultado.exitosos ?? 0, fallos, consumos, devengos };
}
