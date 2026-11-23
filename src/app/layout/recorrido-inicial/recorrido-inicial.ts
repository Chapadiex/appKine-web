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

import { PrimerosPasosStore } from '../../core/guards/primeros-pasos.guard';

interface PasoDelRecorrido {
  readonly titulo: string;
  readonly texto: string;
  /** Lo que se resalta: la unión de los rectángulos de estos elementos. */
  readonly destinos: readonly Element[];
  /** Un grupo del menú: se abre al llegar al paso y se cierra al dejarlo. */
  readonly grupo: HTMLDetailsElement | null;
  /** Dónde va la tarjeta respecto de lo resaltado. */
  readonly lado: 'derecha' | 'abajo-izquierda';
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

interface Rect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Tour guiado del primer ingreso (20/11/2026), al terminar la configuración inicial: recorre el
 * menú gran título por gran título —lo abre, lo resalta y explica qué hay adentro, y lo cierra al
 * pasar al siguiente— y termina en la sede y el perfil. Los pasos salen del menú que esa persona
 * ve, así que respetan sus permisos.
 *
 * <p>Spotlight hecho a mano, sin librería: el velo es el `box-shadow` del resaltado. Se puede
 * saltar en cualquier momento (botón o Escape) y al terminar queda abierto el grupo de la
 * pantalla actual.
 */
@Component({
  selector: 'app-recorrido-inicial',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:resize)': 'medir()', '(document:keydown.escape)': 'cerrar()' },
  template: `
    @if (visible() && pasos().length > 0) {
      @if (resaltado(); as r) {
        <div
          class="recorrido__resaltado"
          aria-hidden="true"
          [style.top.px]="r.top"
          [style.left.px]="r.left"
          [style.width.px]="r.width"
          [style.height.px]="r.height"
        ></div>
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
        <p class="recorrido__contador">Paso {{ indice() + 1 }} de {{ pasos().length }}</p>
        <h2 id="recorrido-titulo" class="recorrido__titulo">{{ paso().titulo }}</h2>
        <p id="recorrido-texto" class="recorrido__texto">{{ paso().texto }}</p>
        <div class="recorrido__puntos" aria-hidden="true">
          @for (p of pasos(); track $index; let i = $index) {
            <span class="recorrido__punto" [class.recorrido__punto--actual]="i === indice()"></span>
          }
        </div>
        <div class="recorrido__acciones">
          <button type="button" class="boton-texto" (click)="cerrar()">Saltar recorrido</button>
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
              {{ esUltimo() ? 'Listo, empezar' : 'Siguiente' }}
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

    /* Cerrar arriba a la derecha (23/11/2026), además de "Saltar recorrido" y Escape. */
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
      color: var(--color-texto-suave);
      font-size: var(--tipo-xs);
      font-weight: var(--peso-medio);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .recorrido__titulo {
      margin: 0 0 var(--esp-3);
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
  private readonly tarjeta = viewChild<ElementRef<HTMLElement>>('tarjeta');
  private readonly injector = inject(Injector);

  protected readonly pasos = signal<readonly PasoDelRecorrido[]>([]);
  protected readonly indice = signal(0);
  protected readonly visible = this.primerosPasos.recorrido;
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
    if (this.paso()?.lado === 'abajo-izquierda') {
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
    // Cada vez que se pide (al terminar la configuración o desde "Guía rápida"), se arma con
    // el menú de ese momento y arranca del primer paso.
    effect(() => {
      if (!this.visible()) {
        return;
      }
      untracked(() => setTimeout(() => this.iniciar()));
    });
  }

  private iniciar(): void {
    this.indice.set(0);
    this.pasos.set(this.armarPasos());
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
        destinos: [titulo],
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
      destinos: arriba,
      grupo: null,
      lado: 'abajo-izquierda',
    });
    return pasos;
  }

  /** Al llegar a un paso: abre su grupo (el acordeón cierra el resto) y lo mide. */
  private entrar(): void {
    const grupo = this.paso()?.grupo;
    if (grupo && !grupo.open) {
      grupo.open = true;
    }
    // El grupo se despliega con una transición corta: se mide ahora y cuando termina.
    requestAnimationFrame(() => this.medir());
    setTimeout(() => this.medir(), 260);
  }

  /** Al dejar un paso: cierra el grupo que abrió el recorrido. */
  private salir(): void {
    const grupo = this.paso()?.grupo;
    if (grupo) {
      grupo.open = false;
    }
  }

  protected medir(): void {
    const rects = (this.paso()?.destinos ?? [])
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
    // Queda abierto el grupo de la pantalla en la que está, como sin el recorrido.
    this.documento
      .querySelector('app-navegacion-principal a.nav__enlace--actual')
      ?.closest<HTMLDetailsElement>('details.nav__grupo')
      ?.setAttribute('open', '');
    this.primerosPasos.recorrido.set(false);
    this.indice.set(0);
  }
}
