import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MapaDeUbicacion, Ubicacion } from './mapa-de-ubicacion';

type Manejador = (evento: { latlng: { lat: number; lng: number } }) => void;

/** Lo que el componente le pide a Leaflet, sin Leaflet: jsdom no calcula layout. */
const leaflet = vi.hoisted(() => {
  const manejadoresDelMapa = new Map<string, Manejador>();
  const manejadoresDelMarcador = new Map<string, Manejador>();
  let posicionDelMarcador = { lat: 0, lng: 0 };

  const mapa = {
    setView: vi.fn(),
    panTo: vi.fn(),
    invalidateSize: vi.fn(),
    remove: vi.fn(),
    on: vi.fn((nombre: string, manejador: Manejador) => {
      manejadoresDelMapa.set(nombre, manejador);
    }),
  };
  const marcador = {
    addTo: vi.fn(() => marcador),
    bindTooltip: vi.fn(() => marcador),
    setLatLng: vi.fn(),
    remove: vi.fn(),
    getLatLng: vi.fn(() => posicionDelMarcador),
    on: vi.fn((nombre: string, manejador: Manejador) => {
      manejadoresDelMarcador.set(nombre, manejador);
    }),
    dragging: { enable: vi.fn(), disable: vi.fn() },
  };
  const capa = { addTo: vi.fn() };

  return {
    mapa,
    marcador,
    manejadoresDelMapa,
    manejadoresDelMarcador,
    moverMarcadorA(lat: number, lng: number) {
      posicionDelMarcador = { lat, lng };
    },
    modulo: {
      map: vi.fn(() => mapa),
      tileLayer: vi.fn(() => capa),
      marker: vi.fn(() => marcador),
      divIcon: vi.fn((opciones: unknown) => opciones),
    },
  };
});

vi.mock('leaflet', () => leaflet.modulo);

/**
 * Mapa de ubicación: sin coordenadas no hay marcador, con coordenadas el marcador se pone ahí, y
 * en modo editable un arrastre emite la ubicación redondeada a seis decimales.
 */
describe('MapaDeUbicacion', () => {
  let fixture: ComponentFixture<MapaDeUbicacion>;

  beforeEach(() => {
    vi.clearAllMocks();
    leaflet.manejadoresDelMapa.clear();
    leaflet.manejadoresDelMarcador.clear();
    fixture = TestBed.createComponent(MapaDeUbicacion);
  });

  /** Deja que `afterNextRender` corra y que el `import()` simulado resuelva. */
  async function renderizar(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolver) => setTimeout(resolver));
    fixture.detectChanges();
  }

  it('sin coordenadas muestra el país y no pone ningún marcador', async () => {
    await renderizar();

    expect(leaflet.modulo.map).toHaveBeenCalledTimes(1);
    expect(leaflet.modulo.tileLayer).toHaveBeenCalledWith(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      expect.objectContaining({ maxZoom: 19 }),
    );
    expect(leaflet.mapa.setView).toHaveBeenCalledWith([-38.4, -63.6], 4);
    expect(leaflet.modulo.marker).not.toHaveBeenCalled();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.mapa-de-ubicacion__aviso'),
    ).toBeNull();
  });

  it('con coordenadas centra el mapa ahí y pone el marcador en el punto', async () => {
    fixture.componentRef.setInput('latitud', -31.4201);
    fixture.componentRef.setInput('longitud', -64.1888);
    fixture.componentRef.setInput('etiqueta', 'Sede Centro');
    await renderizar();

    expect(leaflet.mapa.setView).toHaveBeenCalledWith([-31.4201, -64.1888], 16);
    expect(leaflet.modulo.marker).toHaveBeenCalledWith(
      [-31.4201, -64.1888],
      expect.objectContaining({ draggable: false, title: 'Sede Centro' }),
    );
    expect(leaflet.marcador.addTo).toHaveBeenCalledWith(leaflet.mapa);
    const lienzo = (fixture.nativeElement as HTMLElement).querySelector(
      '.mapa-de-ubicacion__lienzo',
    );
    expect(lienzo?.getAttribute('aria-label')).toBe('Mapa con la ubicación de Sede Centro');
  });

  it('en modo editable, arrastrar el marcador emite la ubicación con seis decimales', async () => {
    fixture.componentRef.setInput('latitud', -31.4201);
    fixture.componentRef.setInput('longitud', -64.1888);
    fixture.componentRef.setInput('editable', true);
    const emitidas: Ubicacion[] = [];
    fixture.componentInstance.ubicacionCambiada.subscribe((ubicacion) => emitidas.push(ubicacion));
    await renderizar();

    expect(leaflet.modulo.marker).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ draggable: true }),
    );
    leaflet.moverMarcadorA(-31.42012345678, -64.18887654321);
    leaflet.manejadoresDelMarcador.get('dragend')!({ latlng: { lat: 0, lng: 0 } });

    expect(emitidas).toEqual([{ latitud: -31.420123, longitud: -64.188877 }]);
  });
});
