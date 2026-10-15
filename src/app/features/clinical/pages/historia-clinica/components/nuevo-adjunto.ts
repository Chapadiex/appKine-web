import { Component, computed, inject, input, output, signal } from '@angular/core';

import {
  AdjuntoClinicoResponse,
  AdjuntoClinicoResponseCategoriaEnum,
} from '../../../../../api/generated/model/adjunto-clinico-response';
import { ErrorHistoria, traducirErrorHistoria } from '../../../models/historia-errors';
import { CATEGORIAS_DE_ADJUNTO } from '../../../models/etiquetas-de-historia';
import { HistoriaClinicaApi, Justificacion } from '../../../services/historia-clinica-api';

/**
 * Subir un adjunto clinico (D-a, RF-M25).
 *
 * <p>El cliente no filtra tipos ni tamano: lo decide el backend por los bytes del archivo y
 * responde `archivo-no-aceptado`. Un `accept` en el input seria una pista para el selector de
 * archivos, no un control, y duplicaria una regla que vive en otro lado.
 */
@Component({
  selector: 'app-nuevo-adjunto',
  templateUrl: './nuevo-adjunto.html',
  styleUrl: '../historia-clinica.css',
})
export class NuevoAdjunto {
  private readonly api = inject(HistoriaClinicaApi);

  readonly historiaClinicaId = input.required<number>();
  readonly justificacion = input.required<Justificacion>();

  readonly subido = output<AdjuntoClinicoResponse>();

  protected readonly categorias = Object.entries(CATEGORIAS_DE_ADJUNTO) as [
    AdjuntoClinicoResponseCategoriaEnum,
    string,
  ][];

  protected readonly categoria = signal<AdjuntoClinicoResponseCategoriaEnum>(
    AdjuntoClinicoResponseCategoriaEnum.ESTUDIO,
  );
  protected readonly titulo = signal('');
  protected readonly archivo = signal<File | null>(null);
  protected readonly enviando = signal(false);
  protected readonly intentoEnviar = signal(false);
  protected readonly error = signal<ErrorHistoria | null>(null);
  protected readonly aviso = signal('');

  protected readonly faltaArchivo = computed(() => this.archivo() === null);

  protected elegirCategoria(valor: string): void {
    this.categoria.set(valor as AdjuntoClinicoResponseCategoriaEnum);
  }

  protected elegirArchivo(input: HTMLInputElement): void {
    this.archivo.set(input.files?.item(0) ?? null);
  }

  protected subir(formulario: HTMLFormElement): void {
    this.intentoEnviar.set(true);
    const archivo = this.archivo();
    if (archivo === null || this.enviando()) {
      return;
    }
    this.enviando.set(true);
    this.error.set(null);
    this.api
      .subirAdjunto(
        this.historiaClinicaId(),
        this.categoria(),
        archivo,
        this.titulo().trim(),
        this.justificacion(),
      )
      .subscribe({
        next: (adjunto) => {
          this.enviando.set(false);
          this.intentoEnviar.set(false);
          this.archivo.set(null);
          this.titulo.set('');
          formulario.reset();
          this.aviso.set('Adjunto subido. Ya aparece en el timeline.');
          this.subido.emit(adjunto);
        },
        error: (error: unknown) => {
          this.enviando.set(false);
          this.error.set(traducirErrorHistoria(error));
        },
      });
  }
}
