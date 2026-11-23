import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';

import { PrimerosPasosStore } from '../../core/guards/primeros-pasos.guard';
import { Icono } from '../../shared/components/icono/icono';
import { GUIAS, type DefinicionDeGuia, type Objetivo, type PasoDeGuia } from './guias';

interface PasoDelRecorrido {
  readonly titulo: string;
  readonly texto: string;
  /** Lo que se resalta: la unión de los rectángulos de estos elementos (se buscan al medir). */
  readonly destinos: () => readonly Element[];
  /** Pantalla a la que lleva el paso antes de resaltar. */
  readonly ruta?: string;
  /** Un grupo del menú: se abre al llegar al paso y se cierra al dejarlo. */
  readonly grupo: HTMLDetailsElement | null;
  /** Dónde va la tarjeta respecto de lo resaltado. */
  readonly lado: 'derecha' | 'abajo-izquierda' | 'abajo';
}

/** Qué hay en cada gran título del menú. Un título que no esté acá usa el texto genérico. */
const EXPLICACIONES: Readonly<Record<string, string>> = {
  Atención:
    'Todo el día a día: la agenda y los turnos, la recepción de quienes llegan, las series de turnos y la lista de espera.',
  Padrón:
    'Las personas y los pacientes del centro: sus datos, coberturas, historia clínica y cuenta corriente.',
  Pacientes:
    'Las personas y los pacientes del centro: sus datos, coberturas, historia clínica y cuenta corriente.',
  Actividades: 'Las clases grupales, la asistencia y los packs o abonos de quienes van a clase.',
  Economía:
    'La plata del centro: la caja del día, los egresos, los honorarios, las presentaciones a obras sociales y los reportes.',
  'Servicios y catálogo':
    'Lo que el centro ofrece: los servicios, las actividades, el catálogo clínico y sus precios.',
  Contratación:
    'Obras sociales y prepagas: los financiadores, sus planes, los convenios y los aranceles.',
  'Espacios y horarios': 'Los boxes y salas de la sede, y los horarios de cada profesional.',
  Configuración:
    'Los datos del centro, las sedes, tu equipo de colaboradores, la marca y la inteligencia artificial.',
};

const MARGEN = 8;
const ANCHO_TARJETA = 352;
/** Cuántas veces se busca lo marcado mientras la pantalla carga, cada 150 ms (~3 s). */
const VUELTAS_DE_ESPERA = 20;

interface Rect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/**
 * "Guía rápida" (20/11/2026; varias guías desde el 23/11/2026). Sin guía elegida muestra la lista
 * de guías disponibles. La del menú recorre la barra lateral gran título por gran título —lo abre,
 * lo resalta y explica qué hay adentro— y termina en la sede y el perfil; es la que arranca sola al
 * terminar la configuración inicial. Las demás (dar un turno, cobrar, sumar un colaborador…) llevan
 * a cada pantalla de la tarea y marcan dónde tocar.
 *
 * <p>Spotlight hecho a mano, sin librería: el velo es el `box-shadow` del resaltado. Se puede
 * cerrar en cualquier momento (✕ o Escape) y al terminar queda abierto el grupo de la pantalla
 * actual.
 */
@Component({
  selector: 'app-recorrido-inicial',
  imports: [Icono],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:resize)': 'medir()', '(document:keydown.escape)': 'cerrar()' },
  template: `
    @if (eligiendo()) {
      <div class="recorrido__velo" aria-hidden="true" (click)="cerrar()"></div>
      <section
        #selector
        class="recorrido__tarjeta recorrido__selector"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guias-titulo"
      >
        <button type="button" class="recorrido__cerrar" title="Cerrar" (click)="cerrar()">
          <span aria-hidden="true">×</span>
          <span class="visualmente-oculto">Cerrar</span>
        </button>
        <h2 id="guias-titulo" class="recorrido__titulo">¿Qué querés aprender?</h2>
        <p class="recorrido__texto">
          Elegí una guía: te lleva a cada pantalla y te marca dónde tocar.
        </p>
        <ul class="recorrido__guias">
          @for (g of guiasDisponibles(); track g.id) {
            <li>
              <button type="button" class="recorrido__guia" (click)="elegir(g.id)">
                <span class="recorrido__guia-icono"><app-icono [nombre]="g.icono" /></span>
                <span class="recorrido__guia-texto">
                  <b>{{ g.titulo }}</b>
                  <span>{{ g.descripcion }}</span>
                </span>
                <app-icono nombre="chevron-derecha" />
              </button>
            </li>
          }
        </ul>
      </section>
    } @else if (visible() && pasos().length > 0) {
      @if (resaltado(); as r) {
        <div
          class="recorrido__resaltado"
          aria-hidden="true"
          [style.top.px]="r.top"
          [style.left.px]="r.left"
          [style.width.px]="r.width"
          [style.height.px]="r.height"
        ></div>
      } @else {
        <div class="recorrido__velo" aria-hidden="true"></div>
      }
      <section
        #tarjeta
        class="recorrido__tarjeta"
        role="dialog"
        aria-labelledby="recorrido-titulo"
        aria-describedby="recorrido-texto"
        [style.top.px]="posicion().top"
        [style.left.px]="posicion().left"
      >
        <button type="button" class="recorrido__cerrar" title="Cerrar la guía" (click)="cerrar()">
          <span aria-hidden="true">×</span>
          <span class="visualmente-oculto">Cerrar la guía</span>
        </button>
        <p class="recorrido__contador">
          {{ tituloDeLaGuia() }} · Paso {{ indice() + 1 }} de {{ pasos().length }}
        </p>
        <h2 id="recorrido-titulo" class="recorrido__titulo">{{ paso().titulo }}</h2>
        <p id="recorrido-texto" class="recorrido__texto">{{ paso().texto }}</p>
        <div class="recorrido__puntos" aria-hidden="true">
          @for (p of pasos(); track $index; let i = $index) {
            <span class="recorrido__punto" [class.recorrido__punto--actual]="i === indice()"></span>
          }
        </div>
        <div class="recorrido__acciones">
          <button type="button" class="boton-texto" (click)="volverAGuias()">Otras guías</button>
          <span class="recorrido__navegacion">
            @if (indice() > 0) {
              <button
                type="button"
                class="boton boton--secundario boton--chico"
                (click)="mover(-1)"
              >
                Anterior
              </button>
            }
            <button type="button" class="boton boton--chico" (click)="siguiente()">
              {{ esUltimo() ? 'Listo' : 'Siguiente' }}
            </button>
          </span>
        </div>
      </section>
    }
  `,
  styles: `
    .recorrido__resaltado {
      position: fixed;
      z-index: 900;
      border: 2px solid var(--color-acento);
      border-radius: var(--radio-md);
      box-shadow: 0 0 0 9999px rgb(15 23 42 / 0.45);
      pointer-events: none;
      transition:
        top 0.2s ease,
        left 0.2s ease,
        width 0.2s ease,
        height 0.2s ease;
    }

    /* Velo sin resaltado: el selector de guías y los pasos que sólo explican. */
    .recorrido__velo {
      position: fixed;
      inset: 0;
      z-index: 900;
      background: rgb(15 23 42 / 0.45);
    }

    .recorrido__tarjeta {
      position: fixed;
      z-index: 901;
      width: min(22rem, calc(100vw - 2rem));
      box-sizing: border-box;
      padding: var(--esp-6) var(--esp-7);
      border: var(--borde-fino) solid var(--color-borde);
      border-radius: var(--radio-lg);
      background: var(--color-superficie);
      color: var(--color-texto);
      box-shadow: var(--sombra-flotante);
    }

    .recorrido__selector {
      top: 50%;
      left: 50%;
      width: min(30rem, calc(100vw - 2rem));
      max-height: calc(100dvh - 2rem);
      overflow-y: auto;
      transform: translate(-50%, -50%);
    }

    .recorrido__guias {
      display: grid;
      gap: var(--esp-2);
      margin: var(--esp-5) 0 0;
      padding: 0;
      list-style: none;
    }

    .recorrido__guia {
      display: flex;
      align-items: center;
      gap: var(--esp-4);
      width: 100%;
      padding: var(--esp-3) var(--esp-4);
      border: var(--borde-fino) solid var(--color-borde);
      border-radius: var(--radio-md);
      background: var(--color-superficie);
      color: var(--color-texto);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .recorrido__guia:hover {
      border-color: var(--color-accion-fondo);
      background: color-mix(in srgb, var(--color-accion-fondo) 6%, var(--color-superficie));
    }

    .recorrido__guia-icono {
      display: grid;
      flex-shrink: 0;
      place-items: center;
      width: 2.25rem;
      height: 2.25rem;
      border-radius: var(--radio-md);
      background: color-mix(in srgb, var(--color-accion-fondo) 12%, var(--color-superficie));
      color: var(--color-accion-fondo);
      font-size: 1.125rem;
    }

    .recorrido__guia-texto {
      display: grid;
      flex: 1;
      gap: 0.125rem;
    }

    .recorrido__guia-texto span {
      color: var(--color-texto-suave);
      font-size: var(--tipo-sm);
    }

    /* Cerrar arriba a la derecha (23/11/2026), además de Escape. */
    .recorrido__cerrar {
      position: absolute;
      top: var(--esp-3);
      right: var(--esp-3);
      display: grid;
      place-items: center;
      width: 2rem;
      height: 2rem;
      border: 0;
      border-radius: var(--radio-md);
      background: none;
      color: var(--color-texto-suave);
      font-size: 1.25rem;
      line-height: 1;
      cursor: pointer;
    }

    .recorrido__cerrar:hover {
      background: var(--color-hover);
      color: var(--color-texto-fuerte);
    }

    .recorrido__contador {
      margin: 0 0 var(--esp-2);
      padding-right: var(--esp-6);
      color: var(--color-texto-suave);
      font-size: var(--tipo-xs);
      font-weight: var(--peso-medio);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .recorrido__titulo {
      margin: 0 0 var(--esp-3);
      padding-right: var(--esp-6);
      font-size: var(--tipo-lg);
    }

    .recorrido__texto {
      margin: 0;
      color: var(--color-texto-suave);
    }

    .recorrido__puntos {
      display: flex;
      flex-wrap: wrap;
      gap: var(--esp-2);
      margin: var(--esp-5) 0;
    }

    .recorrido__punto {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
      background: var(--color-borde);
    }

    .recorrido__punto--actual {
      background: var(--color-acento);
    }

    .recorrido__acciones {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--esp-4);
    }

    .recorrido__acciones .boton-texto {
      white-space: nowrap;
    }

    .recorrido__navegacion {
      display: inline-flex;
      gap: var(--esp-3);
    }

    @media (prefers-reduced-motion: reduce) {
      .recorrido__resaltado {
        transition: none;
      }
    }
  `,
})
export class RecorridoInicial {
  private readonly documento = inject(DOCUMENT);
  private readonly primerosPasos = inject(PrimerosPasosStore);
  private readonly router = inject(Router);
  private readonly tarjeta = viewChild<ElementRef<HTMLElement>>('tarjeta');
  private readonly selector = viewChild<ElementRef<HTMLElement>>('selector');
  private readonly injector = inject(Injector);
  /** Corta la espera de un elemento cuando se cambia de paso o se cierra. */
  private intento = 0;

  protected readonly pasos = signal<readonly PasoDelRecorrido[]>([]);
  protected readonly indice = signal(0);
  protected readonly visible = this.primerosPasos.recorrido;
  protected readonly eligiendo = computed(
    () => this.visible() && this.primerosPasos.guia() === null,
  );
  /** Las guías cuya pantalla de arranque está en el menú de esta persona: respeta sus permisos. */
  protected readonly guiasDisponibles = signal<readonly DefinicionDeGuia[]>([]);
  protected readonly tituloDeLaGuia = computed(
    () => GUIAS.find((g) => g.id === this.primerosPasos.guia())?.titulo ?? 'Guía',
  );
  protected readonly paso = computed(() => this.pasos()[this.indice()]);
  protected readonly esUltimo = computed(() => this.indice() === this.pasos().length - 1);
  protected readonly resaltado = signal<Rect | null>(null);

  protected readonly posicion = computed(() => {
    const r = this.resaltado();
    const vista = this.documento.defaultView;
    const ancho = vista?.innerWidth ?? 1280;
    const alto = vista?.innerHeight ?? 800;
    if (r === null) {
      return { top: alto / 3, left: (ancho - ANCHO_TARJETA) / 2 };
    }
    const lado = this.paso()?.lado;
    if (lado === 'abajo') {
      // Debajo de lo marcado; si no entra, encima.
      const debajo = r.top + r.height + 16;
      return {
        top: debajo + 280 > alto ? Math.max(MARGEN, r.top - 296) : debajo,
        left: Math.min(Math.max(MARGEN, r.left), ancho - ANCHO_TARJETA - MARGEN),
      };
    }
    if (lado === 'abajo-izquierda') {
      return {
        top: r.top + r.height + 16,
        left: Math.max(MARGEN, r.left + r.width - ANCHO_TARJETA),
      };
    }
    // A la derecha del menú, a la altura de lo resaltado sin salirse de la pantalla.
    return {
      top: Math.min(Math.max(MARGEN, r.top), alto - 260),
      left: r.left + r.width + 16,
    };
  });

  constructor() {
    // Sin guía elegida, la lista; con guía, se arma en ese momento y arranca del primer paso.
    effect(() => {
      const guia = this.primerosPasos.guia();
      if (!this.visible()) {
        return;
      }
      untracked(() =>
        guia === null ? this.prepararSelector() : setTimeout(() => this.iniciar(guia)),
      );
    });
  }

  private prepararSelector(): void {
    this.salir();
    this.intento++;
    this.pasos.set([]);
    this.resaltado.set(null);
    const enlaces = [...this.documento.querySelectorAll('app-navegacion-principal a[href]')].map(
      (a) => (a.getAttribute('href') ?? '').split('?')[0],
    );
    this.guiasDisponibles.set(GUIAS.filter((g) => g.desde === null || enlaces.includes(g.desde)));
    afterNextRender(
      () => this.selector()?.nativeElement.querySelector<HTMLElement>('.recorrido__guia')?.focus(),
      { injector: this.injector },
    );
  }

  protected elegir(id: string): void {
    this.primerosPasos.guia.set(id);
  }

  protected volverAGuias(): void {
    this.salir();
    this.primerosPasos.guia.set(null);
  }

  private iniciar(guia: string): void {
    this.indice.set(0);
    const pasos = GUIAS.find((g) => g.id === guia)?.pasos;
    this.pasos.set(pasos ? pasos.map((p) => this.pasoDeTarea(p)) : this.armarPasos());
    this.entrar();
    // Puede pedirse justo antes de cambiar de pantalla: se vuelve a medir cuando ya se dibujó.
    setTimeout(() => this.medir(), 600);
    afterNextRender(
      () => this.tarjeta()?.nativeElement.querySelector<HTMLElement>('.boton:last-child')?.focus(),
      { injector: this.injector },
    );
  }

  /** Los grandes títulos del menú que esta persona ve, en orden, más la sede y el perfil al final. */
  private armarPasos(): PasoDelRecorrido[] {
    const menu = this.documento.querySelector('app-navegacion-principal');
    const titulos = [
      ...(menu?.querySelectorAll<HTMLElement>('details.nav__grupo, a.nav__enlace--grupo') ?? []),
    ];
    const pasos: PasoDelRecorrido[] = titulos.map((titulo) => {
      const nombre = (
        titulo.querySelector('.nav__rotulo')?.textContent ??
        titulo.textContent ??
        ''
      ).trim();
      return {
        titulo: nombre,
        texto: EXPLICACIONES[nombre] ?? 'Abrilo para ver las pantallas que tiene.',
        destinos: () => [titulo],
        grupo: titulo instanceof HTMLDetailsElement ? titulo : null,
        lado: 'derecha',
      };
    });
    const arriba = ['app-selector-de-sede', 'app-menu-de-perfil']
      .map((selector) => this.documento.querySelector(selector))
      .filter((elemento): elemento is Element => elemento !== null);
    pasos.push({
      titulo: 'Tu sede y tu perfil',
      texto:
        'Arriba a la derecha cambiás de sede y entrás a tu perfil: tus datos, el tema claro u oscuro y la salida. Si te perdés, apretá F1 en cualquier pantalla.',
      destinos: () => arriba,
      grupo: null,
      lado: 'abajo-izquierda',
    });
    return pasos;
  }

  /** Un paso de una guía por tarea: va a su pantalla y busca lo que hay que tocar. */
  private pasoDeTarea(p: PasoDeGuia): PasoDelRecorrido {
    const objetivo = p.objetivo;
    return {
      titulo: p.titulo,
      texto: p.texto,
      ruta: p.ruta,
      grupo: null,
      lado: 'abajo',
      destinos: () => (objetivo ? this.buscar(objetivo) : []),
    };
  }

  /** Lo que marca un paso, dentro del contenido: por selector y, si se da, por su texto visible. */
  private buscar(objetivo: Objetivo): Element[] {
    const raiz = this.documento.getElementById('contenido') ?? this.documento.body;
    const texto = objetivo.texto?.toLocaleLowerCase('es');
    const encontrado = [...raiz.querySelectorAll(objetivo.selector ?? 'a, button')].find(
      (el) =>
        el.getBoundingClientRect().width > 0 &&
        (texto === undefined ||
          (el.textContent ?? '').replace(/\s+/g, ' ').toLocaleLowerCase('es').includes(texto)),
    );
    return encontrado ? [encontrado] : [];
  }

  /** Al llegar a un paso: va a su pantalla si hace falta, abre su grupo y lo mide. */
  private entrar(): void {
    const paso = this.paso();
    const intento = ++this.intento;
    if (paso?.ruta) {
      this.resaltado.set(null);
      if (this.router.url.split(/[?#]/)[0] === paso.ruta) {
        this.esperar(intento, 0);
      } else {
        this.router.navigateByUrl(paso.ruta).then(
          () => this.esperar(intento, 0),
          () => this.esperar(intento, 0),
        );
      }
      return;
    }
    if (paso?.grupo && !paso.grupo.open) {
      paso.grupo.open = true;
    }
    // El grupo se despliega con una transición corta: se mide ahora y cuando termina.
    requestAnimationFrame(() => this.medir());
    setTimeout(() => this.medir(), 260);
  }

  /** La pantalla carga sus datos después de navegar: busca lo marcado un rato antes de rendirse. */
  private esperar(intento: number, vuelta: number): void {
    if (intento !== this.intento) {
      return;
    }
    const destino = this.paso()?.destinos()[0];
    if (destino === undefined && vuelta < VUELTAS_DE_ESPERA) {
      setTimeout(() => this.esperar(intento, vuelta + 1), 150);
      return;
    }
    destino?.scrollIntoView({ block: 'nearest' });
    this.medir();
  }

  /** Al dejar un paso: cierra el grupo que abrió el recorrido. */
  private salir(): void {
    const grupo = this.paso()?.grupo;
    if (grupo) {
      grupo.open = false;
    }
  }

  protected medir(): void {
    const rects = (this.paso()?.destinos() ?? [])
      .map((destino) => destino.getBoundingClientRect())
      .filter((rect) => rect.width > 0);
    if (rects.length === 0) {
      this.resaltado.set(null);
      return;
    }
    const top = Math.min(...rects.map((r) => r.top));
    const left = Math.min(...rects.map((r) => r.left));
    const derecha = Math.max(...rects.map((r) => r.right));
    const abajo = Math.min(
      Math.max(...rects.map((r) => r.bottom)),
      this.documento.defaultView?.innerHeight ?? Infinity,
    );
    this.resaltado.set({
      top: top - 4,
      left: left - 4,
      width: derecha - left + 8,
      height: abajo - top + 8,
    });
  }

  protected mover(delta: number): void {
    this.salir();
    this.indice.update((i) => Math.min(this.pasos().length - 1, Math.max(0, i + delta)));
    this.entrar();
  }

  protected siguiente(): void {
    if (this.esUltimo()) {
      this.cerrar();
      return;
    }
    this.mover(1);
  }

  protected cerrar(): void {
    this.salir();
    this.intento++;
    // Queda abierto el grupo de la pantalla en la que está, como sin el recorrido.
    this.documento
      .querySelector('app-navegacion-principal a.nav__enlace--actual')
      ?.closest<HTMLDetailsElement>('details.nav__grupo')
      ?.setAttribute('open', '');
    this.primerosPasos.recorrido.set(false);
    this.primerosPasos.guia.set(null);
    this.indice.set(0);
  }
}
