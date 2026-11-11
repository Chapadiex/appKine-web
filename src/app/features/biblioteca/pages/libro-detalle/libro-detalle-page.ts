import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Observable, catchError, of, tap } from 'rxjs';

import { LibroDetalleResponse } from '../../../../api/generated/model/libro-detalle-response';
import { LibroResponseEstadoEnum } from '../../../../api/generated/model/libro-response';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { publicarMigas } from '../../../../core/services/migas.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { ErrorBiblioteca, traducirErrorBiblioteca } from '../../models/biblioteca-errors';
import {
  claseDeEstadoDeLibro,
  estadoDeLibroEnPalabras,
} from '../../models/etiquetas-de-biblioteca';
import { relecturaMientras } from '../../models/relectura';
import { BibliotecaApi } from '../../services/biblioteca-api';

type EstadoDeDetalle =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly detalle: LibroDetalleResponse }
  | { readonly tipo: 'error'; readonly error: ErrorBiblioteca };

/**
 * Detalle de un libro de la biblioteca: datos, avance de indexado, fragmentos sospechosos y
 * edicion en sitio con control optimista (409 `concurrent-modification` conserva lo tipeado).
 */
@Component({
  selector: 'app-libro-detalle-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CabeceraDePagina, Ayuda, Alerta],
  templateUrl: './libro-detalle-page.html',
  styleUrl: './libro-detalle-page.css',
})
export class LibroDetallePage {
  private readonly api = inject(BibliotecaApi);
  private readonly avisos = inject(AvisosStore);
  private readonly tenantContext = inject(TenantContextStore);

  /** `:libroId` de la ruta (component input binding). */
  readonly libroId = input.required<string>();

  protected readonly estadoEnPalabras = estadoDeLibroEnPalabras;
  protected readonly claseDeEstado = claseDeEstadoDeLibro;

  protected readonly estado = signal<EstadoDeDetalle>({ tipo: 'cargando' });
  protected readonly detalle = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.detalle : null;
  });
  protected readonly libro = computed(() => this.detalle()?.libro ?? null);
  protected readonly sospechosos = computed(() => this.detalle()?.sospechosos ?? []);
  protected readonly mensajeDeError = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.error.mensaje : '';
  });

  /** Porcentaje de indexado, o `null` si ya esta completo (o no hay pedazos). */
  protected readonly indexando = computed(() => {
    const d = this.detalle();
    const total = d?.fragmentos ?? 0;
    const conVector = d?.fragmentosConVector ?? 0;
    return total > 0 && conVector < total ? Math.round((conVector / total) * 100) : null;
  });

  protected readonly editando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly errorDeEdicion = signal<ErrorBiblioteca | null>(null);
  protected readonly titulo = signal('');
  protected readonly autores = signal('');
  protected readonly edicion = signal('');
  protected readonly area = signal('');
  protected readonly tituloVacio = signal(false);

  private secuencia = 0;

  constructor() {
    publicarMigas(() => [
      { etiqueta: 'Biblioteca', ruta: ['/biblioteca'] },
      { etiqueta: this.libro()?.titulo ?? 'Libro' },
    ]);

    effect(() => {
      this.tenantContext.contextEpoch();
      this.libroId();
      untracked(() => {
        this.editando.set(false);
        this.errorDeEdicion.set(null);
        this.estado.set({ tipo: 'cargando' });
        this.leer(true).subscribe();
      });
    });

    relecturaMientras(
      computed(() => {
        const e = this.libro()?.estado;
        return e === LibroResponseEstadoEnum.PENDIENTE || e === LibroResponseEstadoEnum.PROCESANDO;
      }),
      () => this.leer(false),
    );
  }

  protected reintentar(): void {
    this.estado.set({ tipo: 'cargando' });
    this.leer(true).subscribe();
  }

  protected abrirEdicion(): void {
    const libro = this.libro();
    if (libro === null) {
      return;
    }
    this.titulo.set(libro.titulo ?? '');
    this.autores.set(libro.autores ?? '');
    this.edicion.set(libro.edicion ?? '');
    this.area.set(libro.area ?? '');
    this.tituloVacio.set(false);
    this.errorDeEdicion.set(null);
    this.editando.set(true);
  }

  protected cancelarEdicion(): void {
    this.editando.set(false);
    this.errorDeEdicion.set(null);
  }

  /** Relee el libro sin tocar el formulario: lo tipeado queda para reaplicarlo. */
  protected recargar(): void {
    this.errorDeEdicion.set(null);
    this.leer(false).subscribe();
  }

  protected guardar(): void {
    const orgId = this.tenantContext.organizationId();
    const libro = this.libro();
    if (orgId === null || libro?.id === undefined || this.guardando()) {
      return;
    }
    const titulo = this.titulo().trim();
    this.tituloVacio.set(titulo === '');
    if (titulo === '') {
      return;
    }
    this.errorDeEdicion.set(null);
    this.guardando.set(true);
    this.api
      .editar(orgId, libro.id, {
        titulo,
        ...(this.autores().trim() ? { autores: this.autores().trim() } : {}),
        ...(this.edicion().trim() ? { edicion: this.edicion().trim() } : {}),
        ...(this.area().trim() ? { area: this.area().trim() } : {}),
        version: libro.version ?? 0,
      })
      .subscribe({
        next: () => {
          this.guardando.set(false);
          this.editando.set(false);
          this.avisos.exito('Datos del libro guardados');
          this.leer(false).subscribe();
        },
        error: (error: unknown) => {
          this.guardando.set(false);
          const traducido = traducirErrorBiblioteca(error);
          if (traducido.causa === 'deshabilitada') {
            this.estado.set({ tipo: 'error', error: traducido });
            return;
          }
          this.errorDeEdicion.set(traducido);
        },
      });
  }

  private leer(esConsulta: boolean): Observable<unknown> {
    const orgId = this.tenantContext.organizationId();
    const id = Number(this.libroId());
    const mia = ++this.secuencia;
    if (orgId === null || !Number.isFinite(id)) {
      this.estado.set({ tipo: 'error', error: traducirErrorBiblioteca(null) });
      return of(null);
    }
    return this.api.ver(orgId, id).pipe(
      tap((detalle) => {
        if (mia === this.secuencia) {
          this.estado.set({ tipo: 'listo', detalle });
        }
      }),
      catchError((error: unknown) => {
        if (mia === this.secuencia) {
          const traducido = traducirErrorBiblioteca(error);
          if (esConsulta || traducido.causa === 'deshabilitada') {
            this.estado.set({ tipo: 'error', error: traducido });
          }
        }
        return of(null);
      }),
    );
  }
}
