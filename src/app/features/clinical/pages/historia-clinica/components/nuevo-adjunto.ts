import { Component, computed, inject, input, output, signal } from '@angular/core';
import { Observable } from 'rxjs';

import {
  AdjuntoClinicoResponse,
  AdjuntoClinicoResponseCategoriaEnum,
} from '../../../../../api/generated/model/adjunto-clinico-response';
import { ErrorHistoria, traducirErrorHistoria } from '../../../models/historia-errors';
import { CATEGORIAS_DE_ADJUNTO } from '../../../models/etiquetas-de-historia';
import { HistoriaClinicaApi, Justificacion } from '../../../services/historia-clinica-api';
import { Alerta } from '../../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../../core/services/avisos.store';

/**
 * Subir un adjunto clinico (D-a, RF-M25).
 *
 * <p>El cliente no filtra tipos ni tamano: lo decide el backend por los bytes del archivo y
 * responde `archivo-no-aceptado`. Un `accept` en el input seria una pista para el selector de
 * archivos, no un control, y duplicaria una regla que vive en otro lado.
 */
@Component({
  selector: 'app-nuevo-adjunto',
  imports: [Alerta],
  templateUrl: './nuevo-adjunto.html',
  styleUrl: '../historia-clinica.css',
})
export class NuevoAdjunto {
  private readonly api = inject(HistoriaClinicaApi);
  private readonly avisos = inject(AvisosStore);

  /** La historia donde se sube. Con `subida` (DP-47) puede no existir todavia. */
  readonly historiaClinicaId = input<number | null>(null);
  readonly justificacion = input.required<Justificacion>();

  /**
   * Otro destino de la subida (DP-47: declarar un archivo por persona). Se llama `subida` y no
   * `subir` porque `subir` es el metodo del formulario. Si no viene, sube a la historia.
   */
  readonly subida = input<
    | ((
        archivo: File,
        categoria: AdjuntoClinicoResponseCategoriaEnum,
        titulo: string,
      ) => Observable<AdjuntoClinicoResponse>)
    | null
  >(null);

  /** Limita las categorias ofrecidas. `null` ofrece todas. */
  readonly categoriasPermitidas = input<readonly string[] | null>(null);

  /** Mensaje propio para una falla (DP-47); `null` deja el de la historia. */
  readonly mensajeDeFalla = input<((error: unknown) => string | null) | null>(null);

  readonly subido = output<AdjuntoClinicoResponse>();

  /** Cada falla de la subida, para que la pantalla decida (p.ej. persona sin perfil). */
  readonly fallo = output<unknown>();

  protected readonly categorias = computed(() => {
    const todas = Object.entries(CATEGORIAS_DE_ADJUNTO) as [
      AdjuntoClinicoResponseCategoriaEnum,
      string,
    ][];
    const permitidas = this.categoriasPermitidas();
    return permitidas === null ? todas : todas.filter(([valor]) => permitidas.includes(valor));
  });

  protected readonly categoria = signal<AdjuntoClinicoResponseCategoriaEnum>(
    AdjuntoClinicoResponseCategoriaEnum.ESTUDIO,
  );
  protected readonly titulo = signal('');
  protected readonly archivo = signal<File | null>(null);
  protected readonly enviando = signal(false);
  protected readonly intentoEnviar = signal(false);
  protected readonly error = signal<ErrorHistoria | null>(null);

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
    const subida = this.subida();
    const titulo = this.titulo().trim();
    const pedido =
      subida !== null
        ? subida(archivo, this.categoria(), titulo)
        : this.api.subirAdjunto(
            this.historiaClinicaId() ?? 0,
            this.categoria(),
            archivo,
            titulo,
            this.justificacion(),
          );
    pedido.subscribe({
      next: (adjunto) => {
        this.enviando.set(false);
        this.intentoEnviar.set(false);
        this.archivo.set(null);
        this.titulo.set('');
        formulario.reset();
        // UX-12: el resultado es un aviso global.
        this.avisos.exito('Adjunto subido', {
          descripcion:
            subida !== null ? 'Queda en la historia clínica.' : 'Ya aparece en el timeline.',
        });
        this.subido.emit(adjunto);
      },
      error: (error: unknown) => {
        this.enviando.set(false);
        const base = traducirErrorHistoria(error);
        const propio = this.mensajeDeFalla()?.(error) ?? null;
        this.error.set(propio === null ? base : { ...base, mensaje: propio });
        this.fallo.emit(error);
      },
    });
  }
}
