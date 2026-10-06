import { HttpResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subscription } from 'rxjs';

import { nombreDeContentDisposition, tamanoEnPalabras } from '../../../../../shared/utils/archivos';
import { ErrorHistoria, traducirErrorHistoria } from '../../../models/historia-errors';
import { ComoSeMuestra, vistaPreviaDe } from '../../../models/vista-previa';
import { HistoriaClinicaApi, Justificacion } from '../../../services/historia-clinica-api';

/** Lo que quedo listo despues de bajar el archivo. Las URLs son de blobs propios, y se revocan. */
interface Archivo {
  readonly nombre: string;
  readonly tamano: string;
  /** Para el enlace de descarga: `octet-stream`, asi abrirlo nunca lo interpreta. */
  readonly urlDescarga: string;
  readonly previa: { readonly como: ComoSeMuestra; readonly url: string } | null;
}

type Estado =
  | { readonly tipo: 'sin-abrir' }
  | { readonly tipo: 'bajando' }
  | { readonly tipo: 'listo'; readonly archivo: Archivo }
  | { readonly tipo: 'error'; readonly error: ErrorHistoria };

/**
 * Un adjunto clinico abierto desde el timeline (D-a, RF-M25).
 *
 * <p><b>No se baja solo.</b> Abrir el archivo es una lectura clinica auditada, como abrir una
 * entrada; elegir la fila del timeline no deberia producirla sin que nadie lo pida.
 *
 * <p>La vista previa se arma con {@link vistaPreviaDe}: solo imagenes rasterizadas y PDF, y con el
 * tipo de la lista blanca. El resto se ofrece para descargar como `application/octet-stream`, que
 * el navegador no abre ni interpreta. Las URLs de blob se revocan al cambiar de adjunto, al volver
 * a abrirlo y al destruir el componente.
 */
@Component({
  selector: 'app-visor-de-adjunto',
  templateUrl: './visor-de-adjunto.html',
  styleUrl: '../historia-clinica.css',
})
export class VisorDeAdjunto {
  private readonly api = inject(HistoriaClinicaApi);
  private readonly sanitizer = inject(DomSanitizer);

  readonly historiaClinicaId = input.required<number>();
  readonly adjuntoId = input.required<number>();
  readonly justificacion = input.required<Justificacion>();

  protected readonly estado = signal<Estado>({ tipo: 'sin-abrir' });

  protected readonly archivo = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'listo' ? estado.archivo : null;
  });

  protected readonly error = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.error : null;
  });

  protected readonly urlDeLaImagen = computed(() => {
    const previa = this.archivo()?.previa;
    return previa?.como === 'imagen' ? previa.url : null;
  });

  /** El `iframe` exige una URL de recurso confiable. Solo se confia en un blob armado aca. */
  protected readonly urlDelPdf = computed<SafeResourceUrl | null>(() => {
    const previa = this.archivo()?.previa;
    return previa?.como === 'pdf'
      ? this.sanitizer.bypassSecurityTrustResourceUrl(previa.url)
      : null;
  });

  private pedido: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.pedido?.unsubscribe();
      this.liberar();
    });

    // Otro adjunto: se descarta lo bajado del anterior.
    effect(() => {
      this.adjuntoId();
      this.historiaClinicaId();
      untracked(() => {
        this.pedido?.unsubscribe();
        this.pasarA({ tipo: 'sin-abrir' });
      });
    });
  }

  protected abrir(): void {
    this.pasarA({ tipo: 'bajando' });
    this.pedido?.unsubscribe();
    this.pedido = this.api
      .descargar(this.historiaClinicaId(), this.adjuntoId(), this.justificacion())
      .subscribe({
        next: (respuesta) => this.pasarA({ tipo: 'listo', archivo: this.preparar(respuesta) }),
        error: (error: unknown) =>
          this.pasarA({ tipo: 'error', error: traducirErrorHistoria(error) }),
      });
  }

  /** Todo cambio de estado pasa por aca: las URLs del archivo anterior se revocan al salir. */
  private pasarA(estado: Estado): void {
    this.liberar();
    this.estado.set(estado);
  }

  private preparar(respuesta: HttpResponse<Blob>): Archivo {
    const blob = respuesta.body ?? new Blob([]);
    const vista = vistaPreviaDe(blob);
    const nombre =
      nombreDeContentDisposition(respuesta.headers.get('Content-Disposition')) ??
      `adjunto-${this.adjuntoId()}`;

    return {
      nombre,
      tamano: tamanoEnPalabras(blob.size),
      urlDescarga: URL.createObjectURL(blob.slice(0, blob.size, 'application/octet-stream')),
      previa: vista === null ? null : { como: vista.como, url: URL.createObjectURL(vista.blob) },
    };
  }

  private liberar(): void {
    const anterior = this.archivo();
    if (anterior !== null) {
      URL.revokeObjectURL(anterior.urlDescarga);
      if (anterior.previa !== null) {
        URL.revokeObjectURL(anterior.previa.url);
      }
    }
  }
}
