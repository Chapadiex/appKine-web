import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';

import { LibroDetalleResponse } from '../../../../api/generated/model/libro-detalle-response';
import { LibroResponse } from '../../../../api/generated/model/libro-response';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { Icono } from '../../../../shared/components/icono/icono';
import { ErrorBiblioteca, traducirErrorBiblioteca } from '../../models/biblioteca-errors';
import {
  claseDeEstadoDeLibro,
  estadoDeLibroEnPalabras,
} from '../../models/etiquetas-de-biblioteca';
import { BibliotecaApi } from '../../services/biblioteca-api';

/** Hoja con la esquina doblada y renglones: un archivo, no una credencial. */
const TRAZO_PDF =
  'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4';

/**
 * Lo que se ve al desplegar un libro debajo de su fila (23/11/2026): sus datos con edición en el
 * lugar, el avance del indexado y los pedazos sospechosos. Reemplaza a la pantalla de detalle, que
 * repetía lo mismo en otra URL. El detalle (pedazos) se pide al desplegar.
 */
@Component({
  selector: 'app-detalle-de-libro',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alerta, Ayuda, Icono],
  templateUrl: './detalle-de-libro.html',
  styleUrl: './detalle-de-libro.css',
})
export class DetalleDeLibro {
  private readonly api = inject(BibliotecaApi);
  private readonly avisos = inject(AvisosStore);
  private readonly tenantContext = inject(TenantContextStore);

  readonly libro = input.required<LibroResponse>();
  /** Texto del reemplazo en curso, si lo hay (lo arma la lista). */
  readonly reemplazo = input<string | null>(null);
  /** Se guardaron los datos: la lista se relee. */
  readonly guardado = output<void>();

  protected readonly trazoPdf = TRAZO_PDF;
  protected readonly estadoEnPalabras = estadoDeLibroEnPalabras;
  protected readonly claseDeEstado = claseDeEstadoDeLibro;

  protected readonly detalle = signal<LibroDetalleResponse | null>(null);
  protected readonly errorDeDetalle = signal<string | null>(null);
  protected readonly sospechosos = computed(() => this.detalle()?.sospechosos ?? []);
  /** Porcentaje de indexado, o `null` si ya está completo (o no hay pedazos). */
  protected readonly indexando = computed(() => {
    const total = this.detalle()?.fragmentos ?? 0;
    const conVector = this.detalle()?.fragmentosConVector ?? 0;
    return total > 0 && conVector < total
      ? Math.min(99, Math.floor((conVector / total) * 100))
      : null;
  });
  protected readonly editable = computed(() => this.libro().reemplazaLibroId === undefined);

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
    // Se relee al desplegar y cada vez que la lista trae otra versión del libro (estado, páginas).
    effect(() => {
      const libro = this.libro();
      untracked(() => this.leer(libro));
    });
  }

  protected abrirEdicion(): void {
    const libro = this.libro();
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

  protected guardar(): void {
    const orgId = this.tenantContext.organizationId();
    const libro = this.libro();
    if (orgId === null || libro.id === undefined || this.guardando()) {
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
          this.guardado.emit();
        },
        error: (error: unknown) => {
          this.guardando.set(false);
          this.errorDeEdicion.set(traducirErrorBiblioteca(error));
        },
      });
  }

  private leer(libro: LibroResponse): void {
    const orgId = this.tenantContext.organizationId();
    const mia = ++this.secuencia;
    if (orgId === null || libro.id === undefined) {
      return;
    }
    this.api.ver(orgId, libro.id).subscribe({
      next: (detalle) => {
        if (mia === this.secuencia) {
          this.detalle.set(detalle);
          this.errorDeDetalle.set(null);
        }
      },
      error: (error: unknown) => {
        if (mia === this.secuencia) {
          this.errorDeDetalle.set(traducirErrorBiblioteca(error).mensaje);
        }
      },
    });
  }
}
