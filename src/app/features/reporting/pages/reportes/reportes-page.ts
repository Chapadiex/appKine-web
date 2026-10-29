import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ReporteResponse } from '../../../../api/generated/model/reporte-response';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { ReporteDisponible } from '../../../../api/generated/model/reporte-disponible';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { ErrorReporte, errorSinContexto, traducirErrorReporte } from '../../models/reporte-errors';
import {
  ADVERTENCIA_ACTIVIDAD_PROPIA,
  CodigoDeReporte,
  agrupacionDeSerie,
  celdaEnPalabras,
  diaCorto,
  valorDeSerie,
  esImporteEnCelda,
  MAXIMO_DIAS_DE_REPORTE,
  REPORTES,
  esCodigoDeReporte,
  fechaEnPalabras,
  nombreDeArchivo,
  nombreDeReporte,
  permisoEnPalabras,
  problemaDelRango,
  valorDeIndicador,
} from '../../models/reportes';
import { ReportesApi } from '../../services/reportes-api';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { guardarComoArchivo, nombreDelEncabezado } from '../../../../shared/utils/descarga';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import {
  BarraDeGrafico,
  GraficoDeBarras,
} from '../../../../shared/components/grafico-de-barras/grafico-de-barras';
import { SerieDeReporte } from '../../../../api/generated/model/serie-de-reporte';
import { SerieDeIndicadorDeReporte } from '../../../../api/generated/model/serie-de-indicador-de-reporte';
import { Subscription } from 'rxjs';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

type EstadoReporte =
  | { readonly tipo: 'inicial' }
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly reporte: ReporteResponse }
  | { readonly tipo: 'error'; readonly error: ErrorReporte };

/** La serie del grafico (DP-45). Se pide despues del reporte y su fallo no lo tapa. */
type EstadoSerie =
  | { readonly tipo: 'nada' }
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'lista'; readonly serie: SerieDeReporte }
  | { readonly tipo: 'error'; readonly error: ErrorReporte };

/**
 * Tablero de reportes de la sede (M23, RF-M23-001 a 006, AKINE-07.06 y G-1).
 *
 * <p>Tres cosas que la pantalla no puede callar, porque el contrato las trae a proposito:
 * <ul>
 *   <li><b>De donde sale cada numero.</b> Cada indicador muestra su fuente y su criterio de fecha
 *       como texto visible, no en un tooltip: deuda, cobro, caja, presentacion y egreso son cinco
 *       conceptos, y sin esa linea el primero que vea dos numeros parecidos los va a sumar.</li>
 *   <li><b>Lo que no se puede ver.</b> `omitidas` llega en vez de un 403; se lista con el permiso
 *       que falta.</li>
 *   <li><b>El recorte a la actividad propia</b> (DP-15): un profesional ve "12 turnos" y tiene que
 *       saber que son los suyos, no los de la sede.</li>
 * </ul>
 *
 * <p>No hay totales ni graficos que crucen indicadores: la pantalla no suma nada que el backend no
 * haya sumado.
 *
 * <p><b>El grafico de evolucion</b> (DP-45) dibuja UN indicador por vez, abierto por dia o por
 * semana segun el ancho del periodo: dos indicadores en un mismo grafico serian dos escalas, o la
 * suma de una deuda y un cobro. El total que muestra es el `total` del servidor, que coincide con
 * el indicador del reporte; aca solo se elige el maximo para el eje.
 */
@Component({
  selector: 'app-reportes-page',
  imports: [CabeceraDePagina, Ayuda, GraficoDeBarras, ReactiveFormsModule, RouterLink],
  templateUrl: './reportes-page.html',
  styleUrl: '../../reporting.css',
})
export class ReportesPage {
  private readonly api = inject(ReportesApi);
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly maximoDias = MAXIMO_DIAS_DE_REPORTE;
  protected readonly valor = valorDeIndicador;
  protected readonly fecha = fechaEnPalabras;
  protected readonly permisoEnPalabras = permisoEnPalabras;
  protected readonly nombreDeReporte = nombreDeReporte;

  protected readonly filtro = this.fb.group({
    reporte: ['OPERATIVO'],
    desde: [primerDiaDelMes(this.diaDeLaSede.hoy())],
    hasta: [this.diaDeLaSede.hoy()],
  });

  protected readonly catalogo = signal<readonly ReporteDisponible[]>([]);
  protected readonly reporteElegido = signal<string>('OPERATIVO');
  protected readonly estado = signal<EstadoReporte>({ tipo: 'inicial' });
  protected readonly problemaDeRango = signal<string | null>(null);
  protected readonly exportando = signal(false);
  protected readonly errorExport = signal<ErrorReporte | null>(null);

  /** Reportes que se ofrecen: los del catalogo de la sede si llego, si no los cinco del MVP. */
  protected readonly opciones = computed(() => {
    const codigos = this.catalogo()
      .map((r) => r.reporte)
      .filter(esCodigoDeReporte);
    return codigos.length === 0 ? REPORTES : REPORTES.filter((r) => codigos.includes(r.codigo));
  });

  /** Secciones del reporte elegido, de antemano, con el permiso que cada una pide. */
  protected readonly seccionesPrevistas = computed(() => {
    const elegido = this.catalogo().find((r) => r.reporte === this.reporteElegido());
    const cargados = this.permisos.cargados();
    return (elegido?.secciones ?? []).map((s) => ({
      ...s,
      faltaPermiso: cargados && !!s.permisoRequerido && !this.permisos.tiene(s.permisoRequerido),
    }));
  });

  protected readonly reporte = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.reporte : null;
  });
  protected readonly error = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.error : null;
  });

  protected readonly actividadPropia = computed(
    () =>
      this.reporte()?.advertencias?.some((a) => a.codigo === ADVERTENCIA_ACTIVIDAD_PROPIA) ?? false,
  );
  /**
   * Las advertencias que no son de una seccion en pantalla van arriba. Las de una seccion visible
   * se leen junto a sus numeros —`rentabilidad-sin-costos` (DP-39) dice que el "resultado" de esa
   * tabla es en realidad la facturacion—: arriba quedaria lejos de la tabla que corrige.
   */
  protected readonly advertencias = computed(() => {
    const visibles = new Set((this.reporte()?.secciones ?? []).map((s) => s.seccion));
    return (
      this.reporte()?.advertencias?.filter(
        (a) =>
          a.codigo !== ADVERTENCIA_ACTIVIDAD_PROPIA &&
          (a.seccion === undefined || !visibles.has(a.seccion)),
      ) ?? []
    );
  });
  protected readonly celda = celdaEnPalabras;
  protected readonly esImporte = esImporteEnCelda;
  protected readonly valorDeSerie = valorDeSerie;

  // --- Grafico de evolucion (DP-45) ---------------------------------------------------------

  protected readonly estadoSerie = signal<EstadoSerie>({ tipo: 'nada' });
  /** `seccion/clave` de la serie elegida; `null` es la primera. */
  private readonly serieElegida = signal<string | null>(null);
  private pedidoDeSerie: Subscription | null = null;

  /** Las series con algo para dibujar, agrupadas por seccion para el selector. */
  protected readonly gruposDeSeries = computed(() => {
    const actual = this.estadoSerie();
    if (actual.tipo !== 'lista') {
      return [];
    }
    const grupos = new Map<string, SerieDeIndicadorDeReporte[]>();
    for (const serie of actual.serie.series ?? []) {
      if ((serie.puntos?.length ?? 0) === 0) {
        continue;
      }
      const seccion = serie.seccion ?? '';
      grupos.set(seccion, [...(grupos.get(seccion) ?? []), serie]);
    }
    return [...grupos.entries()].map(([seccion, series]) => ({
      titulo: this.tituloDeSeccion(seccion),
      series,
    }));
  });

  protected readonly cantidadDeSeries = computed(() =>
    this.gruposDeSeries().reduce((total, grupo) => total + grupo.series.length, 0),
  );

  protected readonly serieMostrada = computed(() => {
    const todas = this.gruposDeSeries().flatMap((g) => g.series);
    const elegida = this.serieElegida();
    return todas.find((s) => claveDeSerie(s) === elegida) ?? todas[0] ?? null;
  });

  protected readonly errorDeSerie = computed(() => {
    const actual = this.estadoSerie();
    return actual.tipo === 'error' ? actual.error : null;
  });

  protected readonly porSemana = computed(() => {
    const actual = this.estadoSerie();
    return actual.tipo === 'lista' && actual.serie.agrupacion === 'SEMANA';
  });

  protected readonly barras = computed<readonly BarraDeGrafico[]>(() => {
    const serie = this.serieMostrada();
    const semanal = this.porSemana();
    return (serie?.puntos ?? []).map((punto) => ({
      etiqueta: diaCorto(punto.desde),
      detalle: semanal
        ? `Semana del ${fechaEnPalabras(punto.desde)} al ${fechaEnPalabras(punto.hasta)}`
        : fechaEnPalabras(punto.desde),
      valor: punto.valor ?? 0,
      texto: valorDeSerie(punto.valor, serie ?? {}),
    }));
  });

  /** Nombre accesible del grafico: que es, el periodo, el total del servidor y la barra mas alta. */
  protected readonly descripcionDelGrafico = computed(() => {
    const serie = this.serieMostrada();
    const actual = this.estadoSerie();
    if (serie === null || actual.tipo !== 'lista') {
      return '';
    }
    const barras = this.barras();
    const mayor = barras.reduce<BarraDeGrafico | null>(
      (max, b) => (max === null || b.valor > max.valor ? b : max),
      null,
    );
    const unidad = this.porSemana() ? 'semana' : 'día';
    const partes = [
      `Barras de ${serie.etiqueta ?? serie.clave} por ${unidad}, ` +
        `del ${fechaEnPalabras(actual.serie.desde)} al ${fechaEnPalabras(actual.serie.hasta)}`,
      `total ${valorDeSerie(serie.total, serie)}`,
    ];
    if (mayor !== null && mayor.valor > 0) {
      partes.push(`la más alta, ${mayor.detalle}: ${mayor.texto}`);
    }
    return `${partes.join('; ')}.`;
  });

  protected claveDeSerie = claveDeSerie;

  protected elegirSerie(clave: string): void {
    this.serieElegida.set(clave);
  }

  constructor() {
    // Fechas por defecto tomadas antes de conocer la zona de la sede: se corrigen al llegar.
    const { desde, hasta } = this.filtro.controls;
    this.diaDeLaSede.alinear(
      () => desde.value,
      (hoy) => desde.setValue(primerDiaDelMes(hoy)),
    );
    this.diaDeLaSede.alinear(
      () => hasta.value,
      (hoy) => hasta.setValue(hoy),
    );

    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        // Cambiar de sede no puede dejar en pantalla los numeros de la anterior.
        this.catalogo.set([]);
        this.estado.set({ tipo: 'inicial' });
        this.descartarSerie();
        this.errorExport.set(null);
        this.cargarCatalogo();
      });
    });
    this.filtro.controls.reporte.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((codigo) => this.reporteElegido.set(codigo));
  }

  /** Las advertencias de una seccion visible, para mostrarlas dentro de ella. */
  protected advertenciasDe(seccion: string | undefined) {
    return (
      this.reporte()?.advertencias?.filter(
        (a) => a.codigo !== ADVERTENCIA_ACTIVIDAD_PROPIA && a.seccion === seccion,
      ) ?? []
    );
  }

  /** Titulo legible de una seccion, segun el catalogo; si no, su nombre estable. */
  protected tituloDeSeccion(seccion: string | undefined, titulo?: string): string {
    if (titulo) {
      return titulo;
    }
    for (const reporte of this.catalogo()) {
      const encontrada = reporte.secciones?.find((s) => s.seccion === seccion);
      if (encontrada?.titulo) {
        return encontrada.titulo;
      }
    }
    return seccion ?? '';
  }

  protected generar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      this.estado.set({ tipo: 'error', error: errorSinContexto() });
      return;
    }
    const { reporte, desde, hasta } = this.filtro.getRawValue();
    const problema = problemaDelRango(desde, hasta);
    this.problemaDeRango.set(problema);
    if (problema !== null || !esCodigoDeReporte(reporte)) {
      return;
    }

    this.estado.set({ tipo: 'cargando' });
    this.descartarSerie();
    this.errorExport.set(null);
    this.api.generar(consultorioId, reporte, desde, hasta).subscribe({
      next: (resultado) => {
        this.estado.set({ tipo: 'listo', reporte: resultado });
        this.cargarSerie(consultorioId, reporte, desde, hasta);
      },
      error: (error: unknown) =>
        this.estado.set({ tipo: 'error', error: traducirErrorReporte(error) }),
    });
  }

  /**
   * La serie va despues del reporte, con el mismo periodo: sin reporte en pantalla no hay grafico
   * que mostrar, y un reporte sin series (los de F9 hoy) responde vacio y no dibuja nada.
   */
  private cargarSerie(
    consultorioId: number,
    reporte: CodigoDeReporte,
    desde: string,
    hasta: string,
  ): void {
    this.estadoSerie.set({ tipo: 'cargando' });
    this.pedidoDeSerie = this.api
      .serie(consultorioId, reporte, desde, hasta, agrupacionDeSerie(desde, hasta))
      .subscribe({
        next: (serie) => this.estadoSerie.set({ tipo: 'lista', serie }),
        error: (error: unknown) =>
          this.estadoSerie.set({ tipo: 'error', error: traducirErrorReporte(error) }),
      });
  }

  /** Un grafico viejo, o una respuesta en vuelo, no puede quedar al lado de otro reporte. */
  private descartarSerie(): void {
    this.pedidoDeSerie?.unsubscribe();
    this.pedidoDeSerie = null;
    this.serieElegida.set(null);
    this.estadoSerie.set({ tipo: 'nada' });
  }

  /** Descarga el CSV del reporte en pantalla, con los mismos filtros con que se genero. */
  protected exportar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const actual = this.reporte();
    if (consultorioId === null || actual === null || !esCodigoDeReporte(actual.reporte)) {
      return;
    }
    const desde = actual.desde ?? '';
    const hasta = actual.hasta ?? '';
    this.exportando.set(true);
    this.errorExport.set(null);
    this.api.exportar(consultorioId, actual.reporte, desde, hasta).subscribe({
      next: (respuesta) => {
        this.exportando.set(false);
        // El nombre lo pone el servidor; el armado local queda de respaldo si no lo mando.
        guardarComoArchivo(
          new Blob([respuesta.body ?? ''], { type: 'text/csv;charset=utf-8' }),
          nombreDelEncabezado(respuesta.headers.get('Content-Disposition')) ??
            nombreDeArchivo(actual.reporte ?? 'reporte', desde, hasta),
        );
      },
      error: (error: unknown) => {
        this.exportando.set(false);
        this.errorExport.set(traducirErrorReporte(error));
      },
    });
  }

  private cargarCatalogo(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      this.estado.set({ tipo: 'error', error: errorSinContexto() });
      return;
    }
    this.api.catalogo(consultorioId).subscribe({
      next: (catalogo) => this.catalogo.set(catalogo.reportes ?? []),
      // El catalogo es una ayuda: sin el se ofrecen los cinco reportes y el servidor decide.
      error: () => this.catalogo.set([]),
    });
  }
}

/** Identifica una serie en el selector: la clave sola podria repetirse entre secciones. */
function claveDeSerie(serie: SerieDeIndicadorDeReporte): string {
  return `${serie.seccion ?? ''}/${serie.clave ?? ''}`;
}

/** El primero del mes de `hoy` (`YYYY-MM-DD`), que ya viene en la zona de la sede. */
function primerDiaDelMes(hoy: string): string {
  return `${hoy.slice(0, 8)}01`;
}
