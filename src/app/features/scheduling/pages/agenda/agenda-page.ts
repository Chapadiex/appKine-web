import { Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { AgendaOperativa } from '../../../../api/generated/model/agenda-operativa';
import { OfertaResponse } from '../../../../api/generated/model/oferta-response';
import { RecursoLibre } from '../../../../api/generated/model/recurso-libre';
import { TurnoDeCalendario } from '../../../../api/generated/model/turno-de-calendario';
import { PERMISO_CONSULTORIO_MANAGE, PERMISO_TURNO_MANAGE } from '../../../../core/models/permisos';
import { RUTA_HORARIOS } from '../../../../core/models/rutas';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { FlujoDeTurnosStore } from '../../../../core/services/flujo-de-turnos.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import { Icono } from '../../../../shared/components/icono/icono';
import { Pestanas } from '../../../../shared/components/pestanas/pestanas';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { ErrorAgenda, traducirErrorAgenda } from '../../models/agenda-errors';
import {
  fechaEnPalabras,
  horaEnZona,
  hoyEnZona,
  sumarDias,
} from '../../models/etiquetas-de-agenda';
import { nombreDeEstadoOperativo, simboloDeEstadoOperativo } from '../../models/etiquetas-de-turno';
import {
  AgrupacionDeAgenda,
  CeldaLibre,
  ColumnaDeAgenda,
  EventoDeGrilla,
  PASO_DE_CELDA_MIN,
  VistaDeAgenda,
  armarColumnas,
  minutosEnZona,
  pasoDeCelda,
  rangoDeHoras,
} from '../../models/grilla-de-agenda';
import { ETIQUETA_PESTANAS_DE_AGENDA, pestanasDeAgenda } from '../../models/pestanas-de-agenda';
import { diaCorto, diaEnZona, esFecha, lunesDe, rotuloDeSemana } from '../../models/semana';
import { SchedulingApi } from '../../services/scheduling-api';

/** Alto de un minuto en la grilla. 30 minutos son 36 px: entra una linea y media de tarjeta. */
const PX_POR_MINUTO = 1.2;

/** Debajo de este ancho la agenda es una lista: no se comprime una grilla en 375 px. */
const ANCHO_DE_LISTA = '(max-width: 767px)';

/** Los estados de la agenda que se pueden filtrar. Cancelado pide leerlos: no vienen por defecto. */
const ESTADOS = [
  'RESERVADO',
  'CONFIRMADO',
  'PRESENTE',
  'EN_ATENCION',
  'ATENDIDO',
  'AUSENTE',
  'CANCELADO',
] as const;

/**
 * La agenda operativa de la sede: dia o semana, por profesional o por box (TURNO - Tecnico §14, §52 a
 * §59).
 *
 * <p>Es la pantalla desde donde recepcion trabaja, y por eso <b>no pierde el lugar</b>: despues de crear
 * o mover un turno relee en el sitio, sin vaciar la grilla ni tocar el scroll, la fecha o los filtros
 * (§86 a §88). La fecha, la vista y los filtros viven en la URL, asi un enlace copiado abre lo mismo.
 *
 * <p>La disponibilidad no se inventa aca: las celdas libres salen de las franjas que devuelve el backend
 * y son una invitacion. Lo que decide es el formulario, que valida contra el motor, y la reserva.
 *
 * <p><b>Un turno se dibuja por su estado operativo, con simbolo y texto</b>: el color nunca es la unica
 * senal (WCAG 1.4.1).
 */
@Component({
  selector: 'app-agenda-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Alerta,
    Ayuda,
    CabeceraDePagina,
    EstadoVacio,
    Filtros,
    Icono,
    Pestanas,
    PermisoDirective,
    RouterLink,
  ],
  templateUrl: './agenda-page.html',
  styleUrl: './agenda-page.css',
})
export class AgendaPage {
  private readonly api = inject(SchedulingApi);
  private readonly dia = inject(DiaDeLaSede);
  private readonly tenant = inject(TenantContextStore);
  private readonly location = inject(Location);
  private readonly injector = inject(Injector);
  private readonly elemento = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly flujo = inject(FlujoDeTurnosStore);

  /** De la query. El `transform` cubre el parametro ausente, que llega como `undefined`. */
  readonly fecha = input('', {
    transform: (valor: string | undefined) => valor ?? '',
  });
  readonly vista = input('', {
    transform: (valor: string | undefined) => valor ?? '',
  });
  readonly por = input('', {
    transform: (valor: string | undefined) => valor ?? '',
  });
  readonly profesional = input('', {
    transform: (valor: string | undefined) => valor ?? '',
  });
  readonly oferta = input('', {
    transform: (valor: string | undefined) => valor ?? '',
  });
  readonly estado = input('', {
    transform: (valor: string | undefined) => valor ?? '',
  });

  protected readonly PERMISO_TURNO_MANAGE = PERMISO_TURNO_MANAGE;
  protected readonly PERMISO_CONSULTORIO_MANAGE = PERMISO_CONSULTORIO_MANAGE;
  protected readonly ESTADOS = ESTADOS;
  protected readonly etiquetaDePestanas = ETIQUETA_PESTANAS_DE_AGENDA;
  protected readonly pestanas = pestanasDeAgenda(true);
  protected readonly nombreDeEstadoOperativo = nombreDeEstadoOperativo;
  protected readonly simboloDeEstadoOperativo = simboloDeEstadoOperativo;
  protected readonly diaCorto = diaCorto;
  protected readonly PX_POR_MINUTO = PX_POR_MINUTO;
  /** Quitar un bloqueo pide motivo y muestra su impacto: lo resuelve Excepciones, no se repite aca. */
  protected readonly rutaDeBloqueos = `${RUTA_HORARIOS}/excepciones`;

  protected readonly fechaVisible = signal(this.dia.hoy());
  protected readonly vistaElegida = signal<VistaDeAgenda>('dia');
  protected readonly agrupacion = signal<AgrupacionDeAgenda>('profesional');
  protected readonly profesionalId = signal<number | null>(null);
  protected readonly ofertaId = signal<number | null>(null);
  protected readonly estadoElegido = signal('');

  protected readonly agenda = signal<AgendaOperativa | null>(null);
  protected readonly cargando = signal(false);
  protected readonly error = signal<ErrorAgenda | null>(null);
  protected readonly profesionales = signal<readonly RecursoLibre[]>([]);
  protected readonly ofertas = signal<readonly OfertaResponse[]>([]);
  private readonly duracionesPropias = signal<ReadonlyMap<number, number>>(new Map());
  private pedidoDeDuraciones?: Subscription;
  protected readonly angosta = signal(false);
  /** Ahora, para la linea de la hora y las celdas que ya pasaron. */
  private readonly ahora = signal(new Date());

  private readonly grillaRef = viewChild<ElementRef<HTMLElement>>('grilla');
  private pedido: Subscription | null = null;
  private scrollInicialHecho = false;
  private primeraLecturaHecha = false;
  private ultimaUrl = '';
  /** La fecha sigue siendo el "hoy" que se supuso al abrir: sin `?fecha=` y sin que nadie la toque. */
  private fechaProvisoria = false;

  protected readonly timezone = computed(() => this.agenda()?.timezone ?? this.dia.zona());
  /** Primer dia de lo que se pide: el dia, o el lunes de su semana. */
  protected readonly primerDia = computed(() =>
    this.vistaEfectiva() === 'semana' ? lunesDe(this.fechaVisible()) : this.fechaVisible(),
  );
  protected readonly vistaEfectiva = computed<VistaDeAgenda>(() =>
    this.angosta() ? 'dia' : this.vistaElegida(),
  );

  protected readonly rotuloDeFecha = computed(() =>
    this.vistaEfectiva() === 'semana'
      ? rotuloDeSemana(this.primerDia())
      : fechaEnPalabras(this.fechaVisible()),
  );

  protected readonly hoy = computed(() =>
    this.timezone() === '' ? this.dia.hoy() : hoyEnZona(this.timezone()),
  );

  protected readonly filtrosActivos = computed(() => {
    const chips: { clave: string; texto: string; quitar: () => void }[] = [];
    const profesional = this.profesionalId();
    if (profesional !== null) {
      const nombre =
        this.profesionales().find((p) => p.id === profesional)?.nombre ?? `#${profesional}`;
      chips.push({
        clave: 'profesional',
        texto: `Profesional: ${nombre}`,
        quitar: () => this.filtrarProfesional(''),
      });
    }
    const oferta = this.ofertaId();
    if (oferta !== null) {
      const nombre = this.ofertas().find((o) => o.id === oferta)?.nombreComercial ?? `#${oferta}`;
      chips.push({
        clave: 'oferta',
        texto: `Prestación: ${nombre}`,
        quitar: () => this.filtrarOferta(''),
      });
    }
    if (this.estadoElegido() !== '') {
      chips.push({
        clave: 'estado',
        texto: `Estado: ${nombreDeEstadoOperativo(this.estadoElegido())}`,
        quitar: () => this.filtrarEstado(''),
      });
    }
    return chips;
  });

  private readonly filtroDeTurno = computed(() => {
    const estado = this.estadoElegido();
    const oferta = this.ofertaId();
    return (turno: TurnoDeCalendario) =>
      (estado === '' || turno.turno?.operativo?.estadoOperativo === estado) &&
      (oferta === null || turno.turno?.ofertaId === oferta);
  });

  protected readonly columnas = computed<readonly ColumnaDeAgenda[]>(() => {
    const agenda = this.agenda();
    if (agenda === null) {
      return [];
    }
    return armarColumnas({
      agenda,
      vista: this.vistaEfectiva(),
      agrupacion: this.agrupacion(),
      fecha: this.primerDia(),
      profesionalFiltrado: this.profesionalId(),
      filtroDeTurno: this.filtroDeTurno(),
      ahora: this.ahora(),
      pasoMin: pasoDeCelda(
        this.ofertas().map((oferta) => oferta.duracionMinutos),
        this.ofertas().find((oferta) => oferta.id === this.ofertaId())?.duracionMinutos,
      ),
      duracionesPropias: this.duracionesPropias(),
    });
  });

  protected readonly rango = computed(() => rangoDeHoras(this.columnas()));

  protected readonly horas = computed(() => {
    const { inicioMin, finMin } = this.rango();
    const horas: { minuto: number; rotulo: string }[] = [];
    for (let minuto = inicioMin; minuto < finMin; minuto += 60) {
      horas.push({ minuto, rotulo: `${String(minuto / 60).padStart(2, '0')}:00` });
    }
    return horas;
  });

  protected readonly altoDeGrilla = computed(
    () => (this.rango().finMin - this.rango().inicioMin) * PX_POR_MINUTO,
  );

  protected readonly turnosVisibles = computed(() => {
    const zona = this.timezone();
    const fecha = this.fechaVisible();
    return (this.agenda()?.turnos ?? [])
      .filter(this.filtroDeTurno())
      .filter(
        (t) => this.vistaEfectiva() === 'semana' || diaEnZona(t.turno?.inicio, zona) === fecha,
      )
      .sort((a, b) => (a.turno?.inicio ?? '').localeCompare(b.turno?.inicio ?? ''));
  });

  protected readonly sinHorarios = computed(
    () =>
      this.agenda() !== null &&
      // Sin columnas no es "sin horarios": es una sede sin profesionales o sin boxes, y se dice eso.
      this.columnas().length > 0 &&
      this.columnas().every((c) => c.franjas.length === 0 && c.eventos.length === 0),
  );

  /** Posicion de la linea de "ahora", si el dia que se ve es hoy. */
  protected readonly lineaDeAhora = computed(() => {
    if (this.vistaEfectiva() !== 'dia' || this.fechaVisible() !== this.hoy()) {
      return null;
    }
    const minuto = minutosEnZona(this.ahora().toISOString(), this.timezone());
    const { inicioMin, finMin } = this.rango();
    return minuto >= inicioMin && minuto <= finMin ? (minuto - inicioMin) * PX_POR_MINUTO : null;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => {
      this.pedido?.unsubscribe();
      this.pedidoDeDuraciones?.unsubscribe();
    });

    // La URL manda al entrar o al navegar; adentro de la pantalla se reescribe con replaceState.
    effect(() => {
      const clave = [
        this.fecha(),
        this.vista(),
        this.por(),
        this.profesional(),
        this.oferta(),
        this.estado(),
      ].join('|');
      this.tenant.contextEpoch();
      untracked(() => {
        if (clave !== this.ultimaUrl) {
          this.ultimaUrl = clave;
          this.leerUrl();
        }
        this.cargarCatalogos();
        this.cargar();
      });
    });

    // Con una prestacion filtrada, cada profesional ofrece horarios a su ritmo.
    effect(() => {
      const consultorioId = this.tenant.consultorioId();
      const ofertaId = this.ofertaId();
      untracked(() => {
        this.pedidoDeDuraciones?.unsubscribe();
        this.duracionesPropias.set(new Map());
        if (consultorioId === null || ofertaId === null) {
          return;
        }
        this.pedidoDeDuraciones = this.api.habilitaciones(consultorioId, ofertaId).subscribe({
          next: (respuesta) =>
            this.duracionesPropias.set(
              new Map(
                (respuesta.duracionesPropias ?? []).map((propia) => [
                  propia.membershipId ?? 0,
                  propia.duracionMinutos ?? 0,
                ]),
              ),
            ),
          // Sin este dato la grilla sigue con la duracion de la prestacion; reservar valida igual.
          error: () => this.duracionesPropias.set(new Map()),
        });
      });
    });

    // Lo que hace el flujo se ve en el lugar: sin vaciar la grilla ni mover el scroll.
    let primera = true;
    effect(() => {
      this.flujo.cambios();
      if (primera) {
        primera = false;
        return;
      }
      untracked(() => this.cargar());
    });

    afterNextRender(() => {
      const consulta = window.matchMedia(ANCHO_DE_LISTA);
      this.angosta.set(consulta.matches);
      const aplicar = (): void => {
        this.angosta.set(consulta.matches);
        if (this.vistaElegida() === 'semana') {
          this.cargar();
        }
      };
      consulta.addEventListener('change', aplicar);
      destroyRef.onDestroy(() => consulta.removeEventListener('change', aplicar));
      this.ajustarAlto();
      window.addEventListener('resize', this.ajustarAlto);
      destroyRef.onDestroy(() => window.removeEventListener('resize', this.ajustarAlto));
      // Abrir el embudo o sumar un chip corre la grilla: tiene que seguir entrando en la pantalla.
      if (typeof ResizeObserver !== 'undefined') {
        const observador = new ResizeObserver(() => this.ajustarAlto());
        observador.observe(this.elemento.nativeElement);
        destroyRef.onDestroy(() => observador.disconnect());
      }
      const reloj = window.setInterval(() => this.ahora.set(new Date()), 60_000);
      destroyRef.onDestroy(() => window.clearInterval(reloj));
    });
  }

  private leerUrl(): void {
    this.fechaProvisoria = !esFecha(this.fecha());
    this.fechaVisible.set(esFecha(this.fecha()) ? this.fecha() : this.dia.hoy());
    this.vistaElegida.set(this.vista() === 'semana' ? 'semana' : 'dia');
    this.agrupacion.set(this.por() === 'box' ? 'box' : 'profesional');
    this.profesionalId.set(numeroOVacio(this.profesional()));
    this.ofertaId.set(numeroOVacio(this.oferta()));
    this.estadoElegido.set(
      (ESTADOS as readonly string[]).includes(this.estado()) ? this.estado() : '',
    );
  }

  private escribirUrl(): void {
    const parametros = new URLSearchParams();
    parametros.set('fecha', this.fechaVisible());
    if (this.vistaElegida() !== 'dia') {
      parametros.set('vista', this.vistaElegida());
    }
    if (this.agrupacion() !== 'profesional') {
      parametros.set('por', this.agrupacion());
    }
    if (this.profesionalId() !== null) {
      parametros.set('profesional', String(this.profesionalId()));
    }
    if (this.ofertaId() !== null) {
      parametros.set('oferta', String(this.ofertaId()));
    }
    if (this.estadoElegido() !== '') {
      parametros.set('estado', this.estadoElegido());
    }
    // `replaceState` y no una navegacion: navegar volveria a disparar el efecto que relee la URL.
    this.location.replaceState('/agenda', parametros.toString());
  }

  // -------------------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------------------

  private cargarCatalogos(): void {
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null) {
      return;
    }
    this.api.profesionales(consultorioId).subscribe({
      next: (lista) => this.profesionales.set(lista),
      error: () => this.profesionales.set([]),
    });
    this.api.ofertasAgendables(consultorioId).subscribe({
      next: (lista) => this.ofertas.set(lista),
      error: () => this.ofertas.set([]),
    });
  }

  /** Relee sin vaciar: la grilla sigue a la vista mientras llega la respuesta. */
  protected cargar(): void {
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null) {
      return;
    }
    const desde = this.primerDia();
    const hasta = sumarDias(desde, this.vistaEfectiva() === 'semana' ? 7 : 1);
    this.pedido?.unsubscribe();
    this.cargando.set(true);
    this.error.set(null);
    this.ahora.set(new Date());
    this.pedido = this.api
      .agendaOperativa(consultorioId, {
        desde,
        hasta,
        profesionalId: this.profesionalId() ?? undefined,
        incluirCancelados: this.estadoElegido() === 'CANCELADO',
      })
      .subscribe({
        next: (agenda) => {
          this.cargando.set(false);
          this.agenda.set(agenda);
          if (!this.alinearConLaSede(agenda.timezone)) {
            this.alLlegarLaAgenda();
          }
        },
        error: (error: unknown) => {
          this.cargando.set(false);
          this.error.set(traducirErrorAgenda(error));
        },
      });
  }

  /**
   * Hasta conocer la zona, "hoy" es el dia del navegador: entre las 21 y las 24 de Cordoba, uno en UTC
   * ya esta en el dia siguiente. La respuesta trae la zona de la sede y, si el dia era otro y nadie lo
   * eligio, se corrige y se vuelve a pedir. Devuelve si lo hizo.
   */
  private alinearConLaSede(timezone: string | undefined): boolean {
    if (!this.fechaProvisoria) {
      return false;
    }
    this.fechaProvisoria = false;
    const deLaSede = timezone ? hoyEnZona(timezone) : this.fechaVisible();
    if (deLaSede === this.fechaVisible()) {
      return false;
    }
    this.fechaVisible.set(deLaSede);
    this.cargar();
    return true;
  }

  /**
   * La primera lectura ubica la grilla cerca de lo que importa; una relectura nunca la mueve: quien
   * acaba de dar un turno sigue donde estaba (TURNO - Tecnico §86).
   */
  private alLlegarLaAgenda(): void {
    const primera = !this.primeraLecturaHecha;
    this.primeraLecturaHecha = true;
    afterNextRender(
      () => {
        this.ajustarAlto();
        if (primera) {
          this.ubicarLaGrilla();
        }
      },
      { injector: this.injector },
    );
  }

  /** Una vez sola. Si todavia no hay grilla (por box, sin boxes), la ubica al aparecer. */
  private ubicarLaGrilla(): void {
    const grilla = this.grillaRef()?.nativeElement;
    if (this.scrollInicialHecho || grilla === undefined) {
      return;
    }
    this.scrollInicialHecho = true;
    grilla.scrollTop = this.scrollInicial();
  }

  /** La hora actual si se mira hoy; si no, el primer turno; si no hay, las 8 de la mañana. */
  private scrollInicial(): number {
    const linea = this.lineaDeAhora();
    if (linea !== null) {
      return Math.max(0, linea - 96);
    }
    const inicios = this.columnas().flatMap((c) => c.eventos.map((e) => e.inicioMin));
    return Math.max(0, this.arriba(inicios.length > 0 ? Math.min(...inicios) : 8 * 60) - 24);
  }

  /** La grilla usa todo el alto util y el scroll queda adentro (TURNO - Tecnico §59). */
  private readonly ajustarAlto = (): void => {
    const grilla = this.grillaRef()?.nativeElement;
    if (grilla === undefined) {
      return;
    }
    const arriba = grilla.getBoundingClientRect().top + window.scrollY;
    const alto = Math.max(320, window.innerHeight - arriba - 16);
    grilla.style.setProperty('--alto-de-grilla', `${alto}px`);
    // Lo que el contenedor agrega abajo se descuenta: la pagina no tiene que crecer.
    const exceso = document.documentElement.scrollHeight - window.innerHeight;
    if (exceso > 0) {
      grilla.style.setProperty('--alto-de-grilla', `${Math.max(320, alto - exceso)}px`);
    }
  };

  // -------------------------------------------------------------------------------------
  // Navegacion y filtros
  // -------------------------------------------------------------------------------------

  protected mover(sentido: -1 | 1): void {
    this.fechaProvisoria = false;
    this.fechaVisible.set(
      sumarDias(this.fechaVisible(), this.vistaEfectiva() === 'semana' ? 7 * sentido : sentido),
    );
    this.alCambiarVentana();
  }

  protected irAHoy(): void {
    this.fechaProvisoria = false;
    this.fechaVisible.set(this.hoy());
    this.alCambiarVentana();
  }

  protected irAFecha(valor: string): void {
    if (esFecha(valor)) {
      this.fechaProvisoria = false;
      this.fechaVisible.set(valor);
      this.alCambiarVentana();
    }
  }

  protected elegirVista(vista: VistaDeAgenda): void {
    this.vistaElegida.set(vista);
    this.alCambiarVentana();
  }

  protected elegirAgrupacion(agrupacion: AgrupacionDeAgenda): void {
    this.agrupacion.set(agrupacion);
    this.escribirUrl();
    afterNextRender(
      () => {
        this.ajustarAlto();
        this.ubicarLaGrilla();
      },
      { injector: this.injector },
    );
  }

  protected filtrarProfesional(valor: string): void {
    this.profesionalId.set(numeroOVacio(valor));
    this.alCambiarVentana();
  }

  protected limpiarFiltros(): void {
    const leiaCancelados = this.estadoElegido() === 'CANCELADO';
    const habiaProfesional = this.profesionalId() !== null;
    this.profesionalId.set(null);
    this.ofertaId.set(null);
    this.estadoElegido.set('');
    this.escribirUrl();
    if (leiaCancelados || habiaProfesional) {
      this.cargar();
    }
  }

  protected filtrarOferta(valor: string): void {
    this.ofertaId.set(numeroOVacio(valor));
    this.escribirUrl();
  }

  protected filtrarEstado(valor: string): void {
    const antes = this.estadoElegido();
    this.estadoElegido.set(valor);
    this.escribirUrl();
    // Solo el estado cancelado cambia lo que hay que leer; el resto filtra lo que ya esta.
    if (antes === 'CANCELADO' || valor === 'CANCELADO') {
      this.cargar();
    }
  }

  private alCambiarVentana(): void {
    this.escribirUrl();
    this.cargar();
  }

  // -------------------------------------------------------------------------------------
  // Dibujo
  // -------------------------------------------------------------------------------------

  /** Lo que en esa columna queda fuera de sus franjas de atencion: se dibuja como no disponible. */
  protected fueraDeAtencion(
    columna: ColumnaDeAgenda,
  ): readonly { readonly inicioMin: number; readonly finMin: number }[] {
    const { inicioMin, finMin } = this.rango();
    const tramos: { inicioMin: number; finMin: number }[] = [];
    let desde = inicioMin;
    for (const franja of [...columna.franjas].sort((a, b) => a.inicioMin - b.inicioMin)) {
      if (franja.inicioMin > desde) {
        tramos.push({ inicioMin: desde, finMin: franja.inicioMin });
      }
      desde = Math.max(desde, franja.finMin);
    }
    if (desde < finMin) {
      tramos.push({ inicioMin: desde, finMin });
    }
    return tramos;
  }

  protected diaSiguiente(fecha: string): string {
    return sumarDias(fecha, 1);
  }

  protected arriba(minuto: number): number {
    return (minuto - this.rango().inicioMin) * PX_POR_MINUTO;
  }

  protected alto(desde: number, hasta: number): number {
    return Math.max(PASO_DE_CELDA_MIN * PX_POR_MINUTO * 0.6, (hasta - desde) * PX_POR_MINUTO);
  }

  protected tituloDeColumna(columna: ColumnaDeAgenda): string {
    return this.vistaEfectiva() === 'semana' ? diaCorto(columna.fecha) : columna.titulo;
  }

  protected esHoy(columna: ColumnaDeAgenda): boolean {
    return this.vistaEfectiva() === 'semana' && columna.fecha === this.hoy();
  }

  protected hora(instante: string | undefined): string {
    return horaEnZona(instante, this.timezone());
  }

  protected horaDeMinuto(minuto: number): string {
    return `${String(Math.floor(minuto / 60)).padStart(2, '0')}:${String(minuto % 60).padStart(2, '0')}`;
  }

  /** Lo que da contexto al turno sin saturar: el caso y la sesion, o la prestacion (TURNO.md §31). */
  protected lineaClinica(turno: TurnoDeCalendario): string {
    const operativo = turno.turno?.operativo;
    const partes: string[] = [];
    if (operativo?.numeroCaso) {
      partes.push(`Caso ${operativo.numeroCaso}`);
    }
    if (operativo?.sesionNumero) {
      partes.push(`Sesión ${operativo.sesionNumero}/${operativo.sesionesPlanificadas}`);
    }
    return partes.length > 0 ? partes.join(' · ') : (turno.turno?.ofertaNombre ?? '');
  }

  /** En la vista por profesional el profesional ya esta en la columna: se muestra el box, y al reves. */
  protected lineaDeRecurso(turno: TurnoDeCalendario): string {
    const operativo = turno.turno?.operativo;
    if (this.vistaEfectiva() === 'semana') {
      return [operativo?.profesionalNombre, operativo?.espacioNombre].filter(Boolean).join(' · ');
    }
    return (
      (this.agrupacion() === 'box' ? operativo?.profesionalNombre : operativo?.espacioNombre) ?? ''
    );
  }

  protected descripcion(evento: EventoDeGrilla): string {
    const turno = evento.turno;
    if (turno === undefined) {
      return `${evento.titulo}. ${evento.detalle}`;
    }
    const estado = nombreDeEstadoOperativo(turno.turno?.operativo?.estadoOperativo);
    return [
      `${this.hora(turno.turno?.inicio)} a ${this.hora(turno.turno?.fin)}`,
      turno.turno?.personaNombre,
      turno.turno?.ofertaNombre,
      this.lineaClinica(turno),
      turno.turno?.operativo?.profesionalNombre,
      turno.turno?.operativo?.espacioNombre,
      estado,
      turno.turno?.operativo?.sobreturno ? 'Sobreturno' : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  protected claseDeEstado(evento: EventoDeGrilla): string {
    const estado = evento.turno?.turno?.operativo?.estadoOperativo ?? '';
    return `turno turno--${estado.toLowerCase().replace('_', '-')}`;
  }

  // -------------------------------------------------------------------------------------
  // Acciones
  // -------------------------------------------------------------------------------------

  protected nuevoTurno(): void {
    this.flujo.nuevoTurno({
      origen: 'AGENDA',
      fecha: this.fechaVisible(),
      profesionalId: this.profesionalId() ?? undefined,
      ofertaId: this.ofertaId() ?? undefined,
    });
  }

  /** Lo que la celda sabe no se vuelve a preguntar (TURNO - Tecnico §15). */
  protected nuevoTurnoEn(columna: ColumnaDeAgenda, celda: CeldaLibre): void {
    this.flujo.nuevoTurno({
      origen: 'AGENDA',
      fecha: columna.fecha,
      inicio: celda.inicio,
      profesionalId: columna.profesionalId,
      espacioId: columna.espacioId,
      ofertaId: this.ofertaId() ?? undefined,
    });
  }

  protected abrirTurno(evento: EventoDeGrilla): void {
    const id = evento.turno?.turno?.id;
    if (id !== undefined) {
      this.flujo.verTurno(id);
    }
  }

  protected bloquearAgenda(): void {
    this.flujo.bloqueoDeAgenda({
      origen: 'AGENDA',
      fecha: this.fechaVisible(),
      profesionalId: this.profesionalId() ?? undefined,
    });
  }
}

function numeroOVacio(valor: string): number | null {
  const numero = Number(valor);
  return valor !== '' && Number.isFinite(numero) && numero > 0 ? numero : null;
}
