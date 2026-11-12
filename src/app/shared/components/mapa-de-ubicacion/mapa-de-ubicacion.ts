import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type * as Leaflet from 'leaflet';

/** Donde se centra el mapa cuando todavía no hay coordenadas: la Argentina entera. */
const CENTRO_SIN_UBICACION: [number, number] = [-38.4, -63.6];
const ZOOM_SIN_UBICACION = 4;

const URL_TESELAS = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATRIBUCION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Seis decimales son ~11 cm: más que suficiente para una sede, y lo que guarda el backend. */
const DECIMALES = 6;

/**
 * El pin del marcador, como SVG en línea. Pinta con `currentColor` y la clase le da el color del
 * acento: un atributo `style` acá lo bloquearía la CSP (sin `unsafe-inline`), y las imágenes PNG de
 * Leaflet se pierden bajo el empaquetador (busca `marker-icon.png` relativo a la página).
 */
const PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" aria-hidden="true" focusable="false">' +
  '<path class="mapa-de-ubicacion__pin-cuerpo" d="M12 1C6.5 1 2 5.4 2 10.9 2 18.2 12 31 12 31s10-12.8 10-20.1C22 5.4 17.5 1 12 1z"/>' +
  '<circle class="mapa-de-ubicacion__pin-centro" cx="12" cy="11" r="4"/>' +
  '</svg>';

export interface Ubicacion {
  readonly latitud: number;
  readonly longitud: number;
}

let siguienteId = 0;

/**
 * Mapa con un marcador para mostrar o ajustar una ubicación (Leaflet + OpenStreetMap, sin clave).
 *
 * <p><b>Leaflet se carga recién al mostrarse</b> (`import()` dinámico): ~150 kB que el bundle
 * inicial no paga, y que tampoco paga quien nunca abre la pantalla que lo usa. Mientras baja se ve
 * "Cargando el mapa…"; si no baja (sin red), el aviso lo dice y el resto de la pantalla sigue
 * andando: el mapa es una ayuda, las coordenadas se pueden escribir igual.
 *
 * <p><b>La hoja de Leaflet viaja con el componente</b>: `mapa-de-ubicacion.css` la importa, así
 * queda en el chunk perezoso de quien lo use y no en `angular.json`. Por eso la encapsulación es
 * `None` —Leaflet inyecta su propio DOM— y toda regla propia va bajo `.mapa-de-ubicacion`.
 *
 * <p><b>Dos modos.</b> Sólo lectura: el mapa centrado en el punto con su marcador. Editable: el
 * marcador se arrastra y un clic en el mapa lo mueve; cada ajuste emite {@link ubicacionCambiada}
 * con seis decimales. Si quien lo usa cambia las coordenadas por su cuenta (las escribió en un
 * campo), el marcador se mueve solo y el mapa lo sigue.
 *
 * <p><b>Accesible sin el mouse.</b> El lienzo es una `application` con nombre; en modo editable
 * un texto oculto explica cómo ajustar y que las coordenadas también se escriben. El marcador es
 * enfocable (Leaflet le pone `tabindex`) y la atribución de OpenStreetMap queda visible, como
 * exige su licencia.
 *
 * <p><b>No sabe de dominio.</b> Recibe coordenadas y una etiqueta; no sabe qué es una sede.
 */
@Component({
  selector: 'app-mapa-de-ubicacion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Leaflet inyecta su DOM adentro del lienzo: los estilos tienen que alcanzarlo.
  encapsulation: ViewEncapsulation.None,
  templateUrl: './mapa-de-ubicacion.html',
  styleUrl: './mapa-de-ubicacion.css',
  host: {
    class: 'mapa-de-ubicacion',
    '[class.mapa-de-ubicacion--compacto]': "alto() === 'compacto'",
  },
})
export class MapaDeUbicacion {
  private readonly destroyRef = inject(DestroyRef);
  private readonly lienzo = viewChild.required<ElementRef<HTMLDivElement>>('lienzo');

  readonly latitud = input<number | null>(null);
  readonly longitud = input<number | null>(null);
  /** Con `true`, el marcador se arrastra y un clic en el mapa lo mueve. */
  readonly editable = input(false);
  /** Qué se marca ("Sede Centro"): nombre del mapa y globo del marcador. */
  readonly etiqueta = input('');
  /** Zoom con coordenadas; sin ellas el mapa muestra el país. */
  readonly zoom = input(16);
  readonly alto = input<'normal' | 'compacto'>('normal');

  /** El usuario arrastró el marcador o hizo clic en el mapa (sólo en modo editable). */
  readonly ubicacionCambiada = output<Ubicacion>();

  protected readonly estado = signal<'cargando' | 'listo' | 'error'>('cargando');
  protected readonly idAyuda = `mapa-de-ubicacion-${siguienteId++}-ayuda`;
  protected readonly nombreAccesible = computed(() => {
    const etiqueta = this.etiqueta().trim();
    return etiqueta ? `Mapa con la ubicación de ${etiqueta}` : 'Mapa con la ubicación';
  });

  private L: typeof Leaflet | null = null;
  private mapa: Leaflet.Map | null = null;
  private marcador: Leaflet.Marker | null = null;
  private destruido = false;

  constructor() {
    // `iniciar` nunca rechaza: el fallo de la descarga queda en `estado`.
    afterNextRender(() => {
      this.iniciar().catch(() => undefined);
    });

    // Las coordenadas cambiaron desde afuera (quien usa el mapa las escribió): el marcador las sigue.
    effect(() => {
      const latitud = this.latitud();
      const longitud = this.longitud();
      untracked(() => this.sincronizarMarcador(latitud, longitud));
    });

    effect(() => {
      const editable = this.editable();
      untracked(() => {
        const arrastre = this.marcador?.dragging;
        if (editable) {
          arrastre?.enable();
        } else {
          arrastre?.disable();
        }
      });
    });

    this.destroyRef.onDestroy(() => {
      this.destruido = true;
      this.mapa?.remove();
      this.mapa = null;
      this.marcador = null;
    });
  }

  /** Para quien muestra el mapa en una pestaña que estaba oculta: Leaflet mide el lienzo de nuevo. */
  redibujar(): void {
    this.mapa?.invalidateSize();
  }

  private async iniciar(): Promise<void> {
    let L: typeof Leaflet;
    try {
      L = await import('leaflet');
    } catch {
      this.estado.set('error');
      return;
    }
    if (this.destruido) {
      return;
    }
    this.L = L;
    const mapa = L.map(this.lienzo().nativeElement, {
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer(URL_TESELAS, { maxZoom: 19, attribution: ATRIBUCION }).addTo(mapa);
    mapa.on('click', (evento: Leaflet.LeafletMouseEvent) => {
      if (!this.editable()) {
        return;
      }
      this.ponerMarcador(evento.latlng.lat, evento.latlng.lng);
      this.emitir(evento.latlng.lat, evento.latlng.lng);
    });
    this.mapa = mapa;

    const latitud = this.latitud();
    const longitud = this.longitud();
    if (latitud !== null && longitud !== null) {
      mapa.setView([latitud, longitud], this.zoom());
      this.ponerMarcador(latitud, longitud);
    } else {
      mapa.setView(CENTRO_SIN_UBICACION, ZOOM_SIN_UBICACION);
    }
    this.estado.set('listo');
    // El lienzo pudo cambiar de tamaño mientras Leaflet bajaba (el aviso de carga ya no está).
    mapa.invalidateSize();
  }

  private sincronizarMarcador(latitud: number | null, longitud: number | null): void {
    const mapa = this.mapa;
    if (mapa === null) {
      return;
    }
    if (latitud === null || longitud === null) {
      this.marcador?.remove();
      this.marcador = null;
      return;
    }
    // Si es el eco de lo que el mapa acaba de emitir, el marcador ya está ahí: no se mueve nada.
    const actual = this.marcador?.getLatLng();
    if (actual && redondear(actual.lat) === latitud && redondear(actual.lng) === longitud) {
      return;
    }
    const habiaMarcador = this.marcador !== null;
    this.ponerMarcador(latitud, longitud);
    if (habiaMarcador) {
      mapa.panTo([latitud, longitud]);
    } else {
      mapa.setView([latitud, longitud], this.zoom());
    }
  }

  private ponerMarcador(latitud: number, longitud: number): void {
    const L = this.L;
    const mapa = this.mapa;
    if (L === null || mapa === null) {
      return;
    }
    if (this.marcador !== null) {
      this.marcador.setLatLng([latitud, longitud]);
      return;
    }
    const etiqueta = this.etiqueta().trim();
    const icono = L.divIcon({
      className: 'mapa-de-ubicacion__pin',
      html: PIN_SVG,
      iconSize: [28, 36],
      iconAnchor: [14, 36],
      tooltipAnchor: [0, -32],
    });
    const marcador = L.marker([latitud, longitud], {
      icon: icono,
      draggable: this.editable(),
      keyboard: true,
      title: etiqueta || 'Ubicación marcada',
      alt: etiqueta || 'Ubicación marcada',
    }).addTo(mapa);
    if (etiqueta) {
      marcador.bindTooltip(etiqueta, { direction: 'top' });
    }
    marcador.on('dragend', () => {
      const posicion = marcador.getLatLng();
      this.emitir(posicion.lat, posicion.lng);
    });
    this.marcador = marcador;
  }

  private emitir(latitud: number, longitud: number): void {
    this.ubicacionCambiada.emit({ latitud: redondear(latitud), longitud: redondear(longitud) });
  }
}

function redondear(valor: number): number {
  const factor = 10 ** DECIMALES;
  return Math.round(valor * factor) / factor;
}
