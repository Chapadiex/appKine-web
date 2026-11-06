import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { ConsultoriosService } from '../../../../api/generated/api/consultorios.service';
import { DireccionEncontradaResponse } from '../../../../api/generated/model/direccion-encontrada-response';
import { MapaDeUbicacion } from '../../../../shared/components/mapa-de-ubicacion/mapa-de-ubicacion';
import {
  coordenadasFormateadas,
  enlaceComoLlegar,
  enlaceVerEnGoogleMaps,
} from '../../../../shared/utils/enlaces-de-mapa';
import { consultaParaGeocodificar } from '../../models/direccion';
import { PAISES, PROVINCIAS_ARGENTINAS } from '../../models/paises';
import {
  Coordenadas,
  EstadoDeUbicacion,
  UbicacionForm,
  estadoDeUbicacion,
  ubicacionDelFormulario,
} from '../../models/ubicacion-form';

/** Lo que dice la busqueda de direcciones mientras no hay resultados que elegir. */
type EstadoDeBusqueda =
  | { readonly tipo: 'quieta' }
  | { readonly tipo: 'buscando' }
  | { readonly tipo: 'sin-resultados' }
  | { readonly tipo: 'no-disponible' }
  | { readonly tipo: 'error'; readonly mensaje: string };

const TEXTOS_DE_ESTADO: Readonly<Record<EstadoDeUbicacion, string>> = {
  'sin-direccion': 'Sin dirección por ahora. Podés cargarla después desde la ficha de la sede.',
  pendiente:
    'Ubicación pendiente de verificar: la dirección está cargada pero todavía no tiene un punto en el mapa.',
  geocodificada: 'Ubicada por el buscador de direcciones. Si el marcador no cae justo, arrastralo.',
  manual: 'Ubicación ajustada a mano.',
};

/**
 * Direccion estructurada y punto en el mapa de una sede (M03, alta de sede con ubicacion,
 * 05/11/2026). Lo usan el alta y el panel de edicion sobre el mismo {@link UbicacionForm}.
 *
 * <p>Dos columnas: a la izquierda la direccion en partes, a la derecha el mapa con el marcador,
 * las coordenadas y los enlaces para llegar. Lo que proyecta el padre va arriba de la direccion
 * (`[arriba]`) y debajo del mapa (`[abajo]`): asi el alta pone ahi los datos generales y la
 * visibilidad y el paso 1 queda en dos columnas sin que este componente sepa de pasos.
 *
 * <h2>Buscar no es autocompletar</h2>
 *
 * <p>La busqueda sale cuando se pide con el boton, no mientras se escribe: el geocodificador del
 * backend es Nominatim (OpenStreetMap), cuya politica de uso prohibe el autocompletado y limita a
 * una consulta por segundo. Si no esta configurado o no responde, el backend contesta `503` y
 * la pantalla sigue sirviendo: el marcador se arrastra o se escriben las coordenadas a mano, y
 * una direccion sin punto se guarda igual como "pendiente de verificar".
 *
 * <p>Las coordenadas viven en el formulario como texto, igual que cualquier `input`, y el mapa
 * las lee como numero. Mover el marcador escribe las dos con seis decimales (un metro, mas o
 * menos) y marca el origen `MANUAL`; elegir un resultado de la busqueda marca `GEOCODIFICADA`.
 */
@Component({
  selector: 'app-editor-de-ubicacion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MapaDeUbicacion],
  templateUrl: './editor-de-ubicacion.html',
  styleUrl: './editor-de-ubicacion.css',
})
export class EditorDeUbicacion {
  private readonly consultorios = inject(ConsultoriosService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly avisos = inject(AvisosStore);
  private readonly destroyRef = inject(DestroyRef);

  /** El formulario a editar. El componente lo muta en el lugar, como el editor de franjas. */
  readonly formulario = input.required<UbicacionForm>();

  /** Prefijo de los `id`: tiene que ser unico en la pantalla. */
  readonly idBase = input.required<string>();

  /** `true` despues de un intento de envio: muestra los errores aunque no se toco el campo. */
  readonly mostrarErrores = input(false);

  /** Nombre de la sede, para el rotulo accesible del mapa. */
  readonly nombreDeSede = input('');

  /** Panel angosto: una sola columna, mapa compacto. */
  readonly compacto = input(false);

  private readonly mapa = viewChild(MapaDeUbicacion);

  protected readonly paises = PAISES;
  protected readonly provinciasArgentinas = PROVINCIAS_ARGENTINAS;

  protected readonly busqueda = signal<EstadoDeBusqueda>({ tipo: 'quieta' });
  protected readonly candidatos = signal<readonly DireccionEncontradaResponse[]>([]);

  /** Con OnPush, un formulario mutado desde afuera no dispara nada: se escuchan sus eventos. */
  private readonly cambios = signal(0);

  protected readonly ubicacion = computed(() => {
    this.cambios();
    return ubicacionDelFormulario(this.formulario());
  });

  protected readonly coordenadas = computed<Coordenadas | null>(() => this.ubicacion().coordenadas);

  protected readonly estado = computed(() => estadoDeUbicacion(this.ubicacion()));
  protected readonly textoDeEstado = computed(() => TEXTOS_DE_ESTADO[this.estado()]);

  protected readonly esArgentina = computed(() => {
    this.cambios();
    return this.formulario().controls.pais.value.toUpperCase() === 'AR';
  });

  protected readonly enlaceVer = computed(() => {
    const punto = this.coordenadas();
    return punto === null ? null : enlaceVerEnGoogleMaps(punto.latitud, punto.longitud);
  });

  protected readonly enlaceLlegar = computed(() => {
    const punto = this.coordenadas();
    return punto === null ? null : enlaceComoLlegar(punto.latitud, punto.longitud);
  });

  protected readonly coordenadasTexto = computed(() => {
    const punto = this.coordenadas();
    return punto === null ? '' : coordenadasFormateadas(punto.latitud, punto.longitud);
  });

  private busquedaEnVuelo: Subscription | null = null;

  constructor() {
    effect((alLimpiar) => {
      const suscripcion = this.formulario().events.subscribe(() =>
        this.cambios.update((valor) => valor + 1),
      );
      alLimpiar(() => suscripcion.unsubscribe());
    });
  }

  /** El padre que muestra el mapa en una pestaña oculta lo llama al mostrarla. */
  redibujar(): void {
    this.mapa()?.redibujar();
  }

  protected mostrarError(nombre: 'latitud' | 'longitud'): boolean {
    const control = this.formulario().controls[nombre];
    const par = this.formulario().hasError('par');
    return (control.invalid || par) && (control.touched || this.mostrarErrores());
  }

  protected mensajeDeCoordenadas(): string | null {
    const formulario = this.formulario();
    const { latitud, longitud } = formulario.controls;
    if (!this.mostrarError('latitud') && !this.mostrarError('longitud')) {
      return null;
    }
    if (latitud.hasError('coordenada') || longitud.hasError('coordenada')) {
      return 'Las coordenadas se escriben como números decimales, por ejemplo -34.5593 y -58.4526.';
    }
    if (latitud.hasError('rango') || longitud.hasError('rango')) {
      return 'La latitud va de -90 a 90 y la longitud de -180 a 180.';
    }
    if (formulario.hasError('par')) {
      return 'Latitud y longitud van juntas: cargá las dos o ninguna.';
    }
    return null;
  }

  /** Busca la direccion cargada en el geocodificador del backend y ofrece lo que encuentra. */
  protected buscar(): void {
    const orgId = this.tenantContext.organizationId();
    const consulta = consultaParaGeocodificar(this.ubicacion().direccion);
    if (orgId === null) {
      return;
    }
    if (consulta === '') {
      this.busqueda.set({
        tipo: 'error',
        mensaje: 'Cargá al menos la calle y la ciudad para buscar la dirección.',
      });
      return;
    }

    this.busquedaEnVuelo?.unsubscribe();
    this.busqueda.set({ tipo: 'buscando' });
    this.candidatos.set([]);

    const pais = this.ubicacion().direccion.pais ?? '';
    this.busquedaEnVuelo = this.consultorios
      .buscarDirecciones({ orgId, q: consulta, pais: pais === '' ? undefined : pais })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (respuesta) => {
          const resultados = respuesta.resultados ?? [];
          this.candidatos.set(resultados);
          this.busqueda.set(
            resultados.length === 0 ? { tipo: 'sin-resultados' } : { tipo: 'quieta' },
          );
        },
        error: (error: unknown) => {
          if (error instanceof AkineHttpError && error.status === 503) {
            this.busqueda.set({ tipo: 'no-disponible' });
            return;
          }
          this.busqueda.set({
            tipo: 'error',
            mensaje:
              error instanceof AkineHttpError && error.status === 0
                ? 'No pudimos conectar con el servidor para buscar la dirección.'
                : 'No pudimos buscar la dirección. Probá de nuevo en un momento.',
          });
        },
      });
  }

  /**
   * Toma un resultado: completa las partes que trae y pone el punto en el mapa.
   *
   * <p>Pisa calle, numero, ciudad, provincia y codigo postal SOLO con lo que el resultado trae:
   * una busqueda por "Cabildo 1234" que devuelve el barrio sin numero no borra el numero que
   * alguien escribio. Piso y referencias no se tocan nunca: el buscador no los conoce.
   */
  protected elegir(candidato: DireccionEncontradaResponse): void {
    const formulario = this.formulario();
    const partes: Partial<
      Record<'calle' | 'numero' | 'ciudad' | 'provincia' | 'codigoPostal' | 'pais', string>
    > = {};
    if (candidato.calle) partes.calle = candidato.calle;
    if (candidato.numero) partes.numero = candidato.numero;
    if (candidato.ciudad) partes.ciudad = candidato.ciudad;
    if (candidato.provincia) partes.provincia = candidato.provincia;
    if (candidato.codigoPostal) partes.codigoPostal = candidato.codigoPostal;
    if (candidato.pais) partes.pais = candidato.pais.toUpperCase();
    formulario.patchValue({
      ...partes,
      latitud: String(candidato.latitud ?? ''),
      longitud: String(candidato.longitud ?? ''),
      origen: 'GEOCODIFICADA',
    });
    formulario.markAsDirty();
    this.candidatos.set([]);
    this.busqueda.set({ tipo: 'quieta' });
  }

  protected descartarCandidatos(): void {
    this.candidatos.set([]);
    this.busqueda.set({ tipo: 'quieta' });
  }

  /** El marcador se arrastro o se hizo clic en el mapa. */
  protected moverMarcador(punto: Coordenadas): void {
    this.formulario().patchValue({
      latitud: punto.latitud.toFixed(6),
      longitud: punto.longitud.toFixed(6),
      origen: 'MANUAL',
    });
    this.formulario().markAsDirty();
  }

  /** Escribir una coordenada a mano es ajustarla a mano. */
  protected coordenadaEscrita(): void {
    if (this.formulario().controls.origen.value !== 'MANUAL') {
      this.formulario().controls.origen.setValue('MANUAL');
    }
  }

  protected quitarUbicacion(): void {
    this.formulario().patchValue({ latitud: '', longitud: '', origen: '' });
    this.formulario().markAsDirty();
  }

  protected async copiarEnlace(): Promise<void> {
    const enlace = this.enlaceVer();
    if (enlace === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(enlace);
      this.avisos.exito('Enlace copiado', {
        descripcion: 'Pegalo donde quieras compartir la ubicación de la sede.',
      });
    } catch {
      this.avisos.error('No pudimos copiar el enlace', {
        descripcion: 'Copialo desde la barra del navegador al abrirlo en Google Maps.',
      });
    }
  }
}
