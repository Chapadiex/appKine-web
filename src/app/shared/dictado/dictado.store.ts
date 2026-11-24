import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { DictadoService } from '../../api/generated/api/dictado.service';
import { PropuestaDeEvaluacionDictada } from '../../api/generated/model/propuesta-de-evaluacion-dictada';
import { PERMISO_DICTADO_USE } from '../../core/models/permisos';
import { PermissionsStore } from '../../core/services/permissions.store';
import { TenantContextStore } from '../../core/services/tenant-context.store';
import { traducirErrorDictado } from './dictado-errors';
import { Grabadora } from './grabadora';

/** Tope de una grabación: después se corta sola. */
export const MAXIMO_DE_GRABACION_MS = 120_000;

/**
 * Menos que esto no se manda: un toque y otro enseguida deja un archivo sin audio que el
 * transcriptor no puede abrir, y el servidor lo devolvia como "no disponible" (23/11/2026).
 */
const MINIMO_DE_GRABACION_MS = 1000;
const MINIMO_DE_BYTES = 1024;

/**
 * El dictado por voz de la aplicación (contrato 0.175.0): una sola grabación a la vez, en toda la
 * pantalla, y lo que el servidor contesta. Lo usan el botón de micrófono de cada campo
 * (`[appDictado]`) y el dictado de la evaluación de la sesión.
 *
 * <p>No sabe del dominio: devuelve texto y propuestas. Dónde va cada cosa lo decide quien lo usa.
 */
@Injectable({ providedIn: 'root' })
export class DictadoStore {
  private readonly api = inject(DictadoService);
  private readonly permisos = inject(PermissionsStore);
  private readonly tenant = inject(TenantContextStore);
  private readonly grabadora = new Grabadora();

  /** Quién está grabando ahora; `null` si nadie. */
  private readonly dueno = signal<object | null>(null);
  private inicio = 0;

  /** El servidor dijo 409 `dictado-deshabilitado`: no se ofrece más hasta recargar. */
  private readonly apagado = signal(false);

  /** Si se dibuja el micrófono: permiso, sede elegida, navegador capaz y servidor no apagado. */
  readonly disponible = computed(
    () =>
      !this.apagado() &&
      this.tenant.consultorioId() !== null &&
      this.permisos.tiene(PERMISO_DICTADO_USE) &&
      Grabadora.disponible(),
  );

  grabando(dueno: object): boolean {
    return this.dueno() === dueno;
  }

  /** Empieza a grabar para `dueno`. Si otro estaba grabando, su grabación se descarta. */
  async empezar(dueno: object): Promise<void> {
    this.dueno.set(dueno);
    try {
      await this.grabadora.empezar();
      this.inicio = Date.now();
    } catch (error) {
      this.dueno.set(null);
      throw traducirErrorDictado(error);
    }
  }

  cancelar(dueno: object): void {
    if (this.dueno() === dueno) {
      this.grabadora.cancelar();
      this.dueno.set(null);
    }
  }

  /** Termina la grabación de `dueno` y devuelve el texto dictado (vacío si no se entendió nada). */
  async transcribir(dueno: object): Promise<string> {
    if (this.dueno() !== dueno) {
      return '';
    }
    const audio = await this.grabadora.detener();
    this.dueno.set(null);
    const consultorioId = this.tenant.consultorioId();
    const corta = Date.now() - this.inicio < MINIMO_DE_GRABACION_MS;
    if (corta || audio.size < MINIMO_DE_BYTES || consultorioId === null) {
      return '';
    }
    try {
      const respuesta = await firstValueFrom(this.api.transcribirDictado({ consultorioId, audio }));
      return respuesta.texto.trim();
    } catch (error) {
      throw this.traducir(error);
    }
  }

  /** Propone cómo repartir un texto dictado entre los campos de la evaluación. No escribe nada. */
  async proponerEvaluacion(texto: string): Promise<PropuestaDeEvaluacionDictada> {
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null) {
      return {};
    }
    try {
      return await firstValueFrom(
        this.api.proponerEvaluacionDictada({
          consultorioId,
          proponerEvaluacionDictada: { texto },
        }),
      );
    } catch (error) {
      throw this.traducir(error);
    }
  }

  private traducir(error: unknown) {
    const traducido = traducirErrorDictado(error);
    if (traducido.causa === 'deshabilitado') {
      this.apagado.set(true);
    }
    return traducido;
  }
}

/** Agrega `texto` al final de lo que tiene el campo, como si se hubiera tecleado. */
export function agregarAlCampo(campo: HTMLInputElement | HTMLTextAreaElement, texto: string): void {
  const actual = campo.value;
  const separador = actual && !/\s$/.test(actual) ? ' ' : '';
  let nuevo = actual + separador + texto;
  if (campo.maxLength > 0 && nuevo.length > campo.maxLength) {
    nuevo = nuevo.slice(0, campo.maxLength);
  }
  campo.value = nuevo;
  campo.dispatchEvent(new Event('input', { bubbles: true }));
  campo.focus();
  try {
    campo.setSelectionRange(nuevo.length, nuevo.length);
  } catch {
    // Algunos tipos de input (email, number) no admiten selección: el foco alcanza.
  }
}
