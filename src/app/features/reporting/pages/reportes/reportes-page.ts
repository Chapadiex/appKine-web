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
  MAXIMO_DIAS_DE_REPORTE,
  REPORTES,
  esCodigoDeReporte,
  fechaEnPalabras,
  fechaIso,
  nombreDeArchivo,
  nombreDeReporte,
  permisoEnPalabras,
  problemaDelRango,
  valorDeIndicador,
} from '../../models/reportes';
import { ReportesApi } from '../../services/reportes-api';

type EstadoReporte =
  | { readonly tipo: 'inicial' }
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly reporte: ReporteResponse }
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
 */
@Component({
  selector: 'app-reportes-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './reportes-page.html',
  styleUrl: '../../reporting.css',
})
export class ReportesPage {
  private readonly api = inject(ReportesApi);
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
    desde: [primerDiaDelMes()],
    hasta: [fechaIso(new Date())],
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
  protected readonly advertencias = computed(
    () =>
      this.reporte()?.advertencias?.filter((a) => a.codigo !== ADVERTENCIA_ACTIVIDAD_PROPIA) ?? [],
  );

  constructor() {
    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        // Cambiar de sede no puede dejar en pantalla los numeros de la anterior.
        this.catalogo.set([]);
        this.estado.set({ tipo: 'inicial' });
        this.errorExport.set(null);
        this.cargarCatalogo();
      });
    });
    this.filtro.controls.reporte.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((codigo) => this.reporteElegido.set(codigo));
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
    this.errorExport.set(null);
    this.api.generar(consultorioId, reporte, desde, hasta).subscribe({
      next: (resultado) => this.estado.set({ tipo: 'listo', reporte: resultado }),
      error: (error: unknown) =>
        this.estado.set({ tipo: 'error', error: traducirErrorReporte(error) }),
    });
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
      next: (csv) => {
        this.exportando.set(false);
        descargar(csv, nombreDeArchivo(actual.reporte ?? 'reporte', desde, hasta));
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

function primerDiaDelMes(): string {
  const hoy = new Date();
  return fechaIso(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
}

function descargar(contenido: string, nombre: string): void {
  const url = URL.createObjectURL(new Blob([contenido], { type: 'text/csv;charset=utf-8' }));
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  URL.revokeObjectURL(url);
}
