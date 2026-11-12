import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable, catchError, of, tap } from 'rxjs';

import { ListarLibrosRequestParams } from '../../../../api/generated/api/biblioteca.serviceInterface';
import { LibroPageResponse } from '../../../../api/generated/model/libro-page-response';
import {
  LibroResponse,
  LibroResponseEstadoEnum,
} from '../../../../api/generated/model/libro-response';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { AccionesDeFila } from '../../../../shared/components/acciones-de-fila/acciones-de-fila';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import { Icono } from '../../../../shared/components/icono/icono';
import {
  FILAS_POR_PAGINA_INICIAL,
  Paginacion,
} from '../../../../shared/components/paginacion/paginacion';
import { ProbarBusqueda } from '../../components/probar-busqueda/probar-busqueda';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import {
  CamposDeSort,
  ordenDeServidor,
} from '../../../../shared/components/tabla/orden-de-servidor';
import { SubirLibro } from '../../components/subir-libro/subir-libro';
import { ErrorBiblioteca, traducirErrorBiblioteca } from '../../models/biblioteca-errors';
import {
  ESTADOS_DE_LIBRO,
  claseDeEstadoDeLibro,
  estadoDeLibroEnPalabras,
} from '../../models/etiquetas-de-biblioteca';
import { relecturaMientras } from '../../models/relectura';
import { BibliotecaApi } from '../../services/biblioteca-api';

/** Espera entre la ultima tecla y la consulta al servidor. */
const DEBOUNCE_BUSQUEDA_MS = 300;

/** Lo que la pantalla esta mostrando. `deshabilitada` no es un error: es el entorno apagado. */
type EstadoDeBiblioteca =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly pagina: LibroPageResponse }
  | { readonly tipo: 'deshabilitada' }
  | { readonly tipo: 'error'; readonly error: ErrorBiblioteca };

/** Que pidio abrir el usuario; lo monta el dialogo de subida y reemplazo (Tarea 3). */
export type DialogoDeBiblioteca =
  { readonly modo: 'subir' } | { readonly modo: 'reemplazar'; readonly libro: LibroResponse };

/**
 * Lista de libros de la biblioteca del centro (M30): busqueda, filtros, orden y paginacion en el
 * servidor, acciones por fila y relectura mientras algun libro se procesa.
 *
 * <p>La biblioteca viene apagada por defecto en cada entorno: ahi todo responde 409
 * `biblioteca-deshabilitada` y la pantalla explica eso con un estado vacio, sin error rojo ni
 * reintentos.
 */
@Component({
  selector: 'app-biblioteca-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CabeceraDePagina,
    Ayuda,
    Filtros,
    Icono,
    ColumnaOrdenable,
    AccionesDeFila,
    Paginacion,
    EstadoVacio,
    Alerta,
    PanelLateral,
    SubirLibro,
    ProbarBusqueda,
    RouterLink,
  ],
  templateUrl: './biblioteca-page.html',
  styleUrl: './biblioteca-page.css',
})
export class BibliotecaPage {
  private readonly api = inject(BibliotecaApi);
  private readonly avisos = inject(AvisosStore);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly estadosDeLibro = ESTADOS_DE_LIBRO;
  protected readonly estadoEnPalabras = estadoDeLibroEnPalabras;
  protected readonly claseDeEstado = claseDeEstadoDeLibro;

  protected readonly estado = signal<EstadoDeBiblioteca>({ tipo: 'cargando' });

  /** Para la Tarea 3: el dialogo de subida y reemplazo se monta con esto. */
  readonly dialogo = signal<DialogoDeBiblioteca | null>(null);
  /** Para la Tarea 5: el panel de "Probar busqueda" se monta con esto. */
  readonly panelBusquedaAbierto = signal(false);

  protected readonly busqueda = signal('');
  protected readonly area = signal('');
  protected readonly estadoElegido = signal<LibroResponseEstadoEnum | ''>('');
  protected readonly paginaActual = signal(0);
  protected readonly porPagina = signal<number>(FILAS_POR_PAGINA_INICIAL);
  protected readonly orden = ordenDeServidor<CamposDeSort<ListarLibrosRequestParams['sort']>>(() =>
    this.consultarDesdeElPrincipio(),
  );

  /** Estado del orden por fecha de alta (`creadoEn`), que no tiene columna en la tabla. */
  protected readonly textoOrdenAgregado = computed(() => {
    const actual = this.orden.orden();
    if (actual?.columna !== 'creadoEn') {
      return 'Ordenar por agregado';
    }
    return actual.direccion === 'asc'
      ? 'Agregado: más viejos primero'
      : 'Agregado: más nuevos primero';
  });

  /** Error de una accion de fila (reprocesar, activar...), sobre la tabla. */
  protected readonly errorDeAccion = signal<ErrorBiblioteca | null>(null);
  protected readonly accionEnCurso = signal(false);
  /** Libro cuya eliminacion espera confirmacion. */
  protected readonly porEliminar = signal<LibroResponse | null>(null);

  protected readonly deshabilitada = computed(() => this.estado().tipo === 'deshabilitada');
  protected readonly pagina = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.pagina : null;
  });
  protected readonly libros = computed(() => this.pagina()?.content ?? []);
  protected readonly total = computed(() => this.pagina()?.totalElements ?? 0);
  protected readonly totalPaginas = computed(() => this.pagina()?.totalPages ?? 0);
  protected readonly subtitulo = computed(() => {
    const n = this.total();
    return `${n} ${n === 1 ? 'libro' : 'libros'}`;
  });
  protected readonly filtrosAvanzadosActivos = computed(
    () => Number(this.area().trim() !== '') + Number(this.estadoElegido() !== ''),
  );
  protected readonly hayFiltros = computed(
    () => this.busqueda().trim() !== '' || this.filtrosAvanzadosActivos() > 0,
  );
  protected readonly mensajeDeError = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.error.mensaje : '';
  });

  /** Titulo de cada libro de la pagina, para rotular "Reemplazo de «titulo»". */
  private readonly titulos = computed(
    () => new Map(this.libros().map((libro) => [libro.id, libro.titulo ?? ''])),
  );

  private secuencia = 0;
  private temporizadorDeBusqueda: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.busqueda.set('');
        this.area.set('');
        this.estadoElegido.set('');
        this.errorDeAccion.set(null);
        this.porEliminar.set(null);
        this.dialogo.set(null);
        this.orden.reiniciar();
        this.consultarDesdeElPrincipio();
      });
    });

    relecturaMientras(
      computed(() => this.libros().some((libro) => this.estaProcesandose(libro))),
      () => this.leer(false),
    );

    this.destroyRef.onDestroy(() => this.cancelarBusquedaPendiente());
  }

  protected alSubir(): void {
    this.dialogo.set(null);
    this.avisos.exito('Libro en cola para procesar');
    this.recargar();
  }

  /** Relee la pagina actual en sitio, sin pasar por `cargando`. */
  recargar(): void {
    this.leer(false).subscribe();
  }

  protected rotuloDeReemplazo(libro: LibroResponse): string | null {
    if (libro.reemplazaLibroId === undefined) {
      return null;
    }
    const titulo = this.titulos().get(libro.reemplazaLibroId);
    return titulo ? `Reemplazo de «${titulo}»` : 'Reemplazo de otro libro';
  }

  /** El original con un reemplazo en curso (otra fila de la pagina lo apunta) no se toca. */
  protected tieneReemplazoEnCurso(libro: LibroResponse): boolean {
    return this.libros().some((otro) => otro.reemplazaLibroId === libro.id);
  }

  protected alCancelarDialogo(): void {
    this.dialogo.set(null);
    // El libro pudo quedar creado aunque se haya cancelado la subida.
    this.recargar();
  }

  protected puedeReprocesar(libro: LibroResponse): boolean {
    return (
      libro.estado === LibroResponseEstadoEnum.ERROR ||
      libro.estado === LibroResponseEstadoEnum.LISTO
    );
  }

  protected alEscribirBusqueda(texto: string): void {
    this.cancelarBusquedaPendiente();
    this.temporizadorDeBusqueda = setTimeout(() => {
      this.temporizadorDeBusqueda = null;
      this.busqueda.set(texto);
      this.consultarDesdeElPrincipio();
    }, DEBOUNCE_BUSQUEDA_MS);
  }

  protected cambiarArea(texto: string): void {
    this.area.set(texto);
    this.consultarDesdeElPrincipio();
  }

  protected cambiarEstado(valor: string): void {
    this.estadoElegido.set(valor as LibroResponseEstadoEnum | '');
    this.consultarDesdeElPrincipio();
  }

  protected limpiarFiltros(): void {
    this.cancelarBusquedaPendiente();
    this.busqueda.set('');
    this.area.set('');
    this.estadoElegido.set('');
    this.consultarDesdeElPrincipio();
  }

  protected irAPagina(numero: number): void {
    if (numero < 0 || numero >= this.totalPaginas()) {
      return;
    }
    this.paginaActual.set(numero);
    this.consultar();
  }

  protected cambiarPorPagina(cantidad: number): void {
    this.porPagina.set(cantidad);
    this.consultarDesdeElPrincipio();
  }

  protected consultar(): void {
    this.estado.set({ tipo: 'cargando' });
    this.leer(true).subscribe();
  }

  protected abrirReemplazo(libro: LibroResponse): void {
    this.dialogo.set({ modo: 'reemplazar', libro });
  }

  protected reprocesar(libro: LibroResponse): void {
    this.ejecutar((orgId, id) => this.api.reprocesar(orgId, id), libro, 'Se reprocesa el libro');
  }

  protected alternarActivo(libro: LibroResponse): void {
    if (libro.estado === LibroResponseEstadoEnum.INACTIVO) {
      this.ejecutar((orgId, id) => this.api.activar(orgId, id), libro, 'Libro activado');
    } else {
      this.ejecutar((orgId, id) => this.api.desactivar(orgId, id), libro, 'Libro desactivado');
    }
  }

  protected confirmarEliminar(): void {
    const libro = this.porEliminar();
    if (libro === null) {
      return;
    }
    this.ejecutar(
      (orgId, id) => this.api.eliminar(orgId, id),
      libro,
      'Libro eliminado',
      () => this.porEliminar.set(null),
    );
  }

  private consultarDesdeElPrincipio(): void {
    this.paginaActual.set(0);
    this.consultar();
  }

  private estaProcesandose(libro: LibroResponse): boolean {
    return (
      libro.estado === LibroResponseEstadoEnum.PENDIENTE ||
      libro.estado === LibroResponseEstadoEnum.PROCESANDO
    );
  }

  private cancelarBusquedaPendiente(): void {
    if (this.temporizadorDeBusqueda !== null) {
      clearTimeout(this.temporizadorDeBusqueda);
      this.temporizadorDeBusqueda = null;
    }
  }

  /**
   * Pide la pagina con los filtros de ahora y aplica el resultado, salvo que otra lectura haya
   * empezado despues (gana la ultima). Una relectura (`esConsulta` falso) que falla deja la tabla
   * como estaba, salvo que la biblioteca se haya apagado.
   */
  private leer(esConsulta: boolean): Observable<unknown> {
    const orgId = this.tenantContext.organizationId();
    const mia = ++this.secuencia;
    if (orgId === null) {
      this.estado.set({ tipo: 'error', error: traducirErrorBiblioteca(null) });
      return of(null);
    }
    const q = this.busqueda().trim();
    const area = this.area().trim();
    const estado = this.estadoElegido();
    return this.api
      .listar(orgId, {
        ...(q ? { q } : {}),
        ...(area ? { area } : {}),
        ...(estado ? { estado } : {}),
        page: this.paginaActual(),
        size: this.porPagina(),
        sort: this.orden.sort(),
      })
      .pipe(
        tap((pagina) => {
          if (mia !== this.secuencia) {
            return;
          }
          const ultima = (pagina.totalPages ?? 0) - 1;
          if ((pagina.content ?? []).length === 0 && this.paginaActual() > 0 && ultima >= 0) {
            // Se borro la ultima fila de la ultima pagina: volver a la que queda.
            this.paginaActual.set(Math.min(this.paginaActual() - 1, ultima));
            this.consultar();
            return;
          }
          this.estado.set({ tipo: 'listo', pagina });
        }),
        catchError((error: unknown) => {
          if (mia === this.secuencia) {
            const traducido = traducirErrorBiblioteca(error);
            if (traducido.causa === 'deshabilitada') {
              this.estado.set({ tipo: 'deshabilitada' });
            } else if (esConsulta) {
              this.estado.set({ tipo: 'error', error: traducido });
            }
          }
          return of(null);
        }),
      );
  }

  private ejecutar(
    accion: (orgId: number, id: number) => Observable<unknown>,
    libro: LibroResponse,
    aviso: string,
    alTerminar?: () => void,
  ): void {
    const orgId = this.tenantContext.organizationId();
    if (orgId === null || libro.id === undefined || this.accionEnCurso()) {
      return;
    }
    this.errorDeAccion.set(null);
    this.accionEnCurso.set(true);
    accion(orgId, libro.id).subscribe({
      next: () => {
        this.accionEnCurso.set(false);
        alTerminar?.();
        this.avisos.exito(aviso);
        this.recargar();
      },
      error: (error: unknown) => {
        const traducido = traducirErrorBiblioteca(error);
        this.accionEnCurso.set(false);
        alTerminar?.();
        if (traducido.causa === 'deshabilitada') {
          this.estado.set({ tipo: 'deshabilitada' });
          return;
        }
        this.errorDeAccion.set(traducido);
        if (traducido.recargar) {
          this.recargar();
        }
      },
    });
  }
}
