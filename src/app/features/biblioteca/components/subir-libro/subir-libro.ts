import { HttpEvent, HttpEventType } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { LibroResponse } from '../../../../api/generated/model/libro-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import { ErrorBiblioteca, traducirErrorBiblioteca } from '../../models/biblioteca-errors';
import { BibliotecaApi } from '../../services/biblioteca-api';

/**
 * Dialogo para subir un PDF nuevo o reemplazar el archivo de un libro (M30).
 *
 * <p>Reusa `app-panel-lateral` (dialog modal nativo: foco en el primer campo, Escape, foco de
 * vuelta). El tamano no se valida aca: el maximo lo fija cada despliegue y un 413 se traduce.
 * Mientras sube, el envio queda bloqueado para evitar el doble envio; Cancelar, la X y Escape
 * abortan la peticion y devuelven el formulario editable con lo cargado.
 */
@Component({
  selector: 'app-subir-libro',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, Alerta, PanelLateral],
  templateUrl: './subir-libro.html',
  styleUrl: './subir-libro.css',
})
export class SubirLibro {
  private readonly api = inject(BibliotecaApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly destroyRef = inject(DestroyRef);
  private envio: Subscription | null = null;

  readonly modo = input.required<'subir' | 'reemplazar'>();
  readonly libro = input<LibroResponse | null>(null);

  /** El libro creado (subir) o el libro con el reemplazo en cola (reemplazar). */
  readonly listo = output<LibroResponse>();
  readonly cancelar = output<void>();

  protected readonly formulario = new FormGroup({
    titulo: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(300)],
    }),
    autores: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
    edicion: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(100)] }),
    area: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(100)] }),
    declaracion: new FormControl(false, { nonNullable: true }),
  });

  protected readonly archivo = signal<File | null>(null);
  protected readonly intento = signal(false);
  protected readonly enviando = signal(false);
  /** 0 a 100; `null` cuando el navegador no informa el total. */
  protected readonly progreso = signal<number | null>(0);
  protected readonly error = signal<ErrorBiblioteca | null>(null);
  /** Refleja la casilla como signal: el control reactivo no dispara el render por si solo. */
  protected readonly declarado = signal(false);

  protected readonly esReemplazo = computed(() => this.modo() === 'reemplazar');
  protected readonly titulo = computed(() =>
    this.esReemplazo() ? `Reemplazar el archivo de «${this.libro()?.titulo ?? ''}»` : 'Subir libro',
  );

  protected elegirArchivo(input: HTMLInputElement): void {
    this.archivo.set(input.files?.item(0) ?? null);
  }

  protected pedirCierre(): void {
    if (this.enviando()) {
      this.envio?.unsubscribe();
      this.envio = null;
      this.enviando.set(false);
      return;
    }
    this.cancelar.emit();
  }

  protected faltaDeclaracion(): boolean {
    return this.intento() && !this.declarado();
  }

  protected faltaTitulo(): boolean {
    return !this.esReemplazo() && this.intento() && this.formulario.controls.titulo.invalid;
  }

  protected enviar(): void {
    this.intento.set(true);
    if (this.enviando()) {
      return;
    }
    const valores = this.formulario.getRawValue();
    const archivo = this.archivo();
    const orgId = this.tenantContext.organizationId();
    const libro = this.libro();
    const reemplazo = this.esReemplazo();
    const c = this.formulario.controls;
    const datosInvalidos =
      !reemplazo && (c.titulo.invalid || c.autores.invalid || c.edicion.invalid || c.area.invalid);
    if (archivo === null || !valores.declaracion || datosInvalidos || orgId === null) {
      return;
    }
    if (reemplazo && libro?.id === undefined) {
      return;
    }

    this.enviando.set(true);
    this.error.set(null);
    this.progreso.set(0);
    const eventos$ =
      reemplazo && libro?.id !== undefined
        ? this.api.reemplazar(orgId, libro.id, archivo, true)
        : this.api.subir(
            orgId,
            {
              titulo: valores.titulo.trim(),
              ...(valores.autores.trim() ? { autores: valores.autores.trim() } : {}),
              ...(valores.edicion.trim() ? { edicion: valores.edicion.trim() } : {}),
              ...(valores.area.trim() ? { area: valores.area.trim() } : {}),
              declaracionDerechos: true,
            },
            archivo,
          );
    this.envio = eventos$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (evento) => this.alEvento(evento),
      error: (causa: unknown) => {
        this.enviando.set(false);
        this.error.set(traducirErrorBiblioteca(causa));
      },
    });
  }

  private alEvento(evento: HttpEvent<LibroResponse>): void {
    if (evento.type === HttpEventType.UploadProgress) {
      this.progreso.set(
        evento.total ? Math.min(100, Math.floor((evento.loaded / evento.total) * 100)) : null,
      );
    } else if (evento.type === HttpEventType.Response) {
      this.envio = null;
      this.enviando.set(false);
      this.listo.emit(evento.body ?? {});
    }
  }
}
