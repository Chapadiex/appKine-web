import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

/** Tema de la interfaz. `sistema` sigue al modo claro u oscuro del sistema operativo. */
export type Tema = 'sistema' | 'claro' | 'oscuro';

const CLAVE_TEMA = 'akine.preferencias.tema';

/**
 * Preferencias personales de quien usa este navegador (refactor de la cabecera global,
 * 28/10/2026): hoy, el tema.
 *
 * <p><b>Son del dispositivo, no de la cuenta.</b> El contrato no tiene donde guardarlas, y una
 * preferencia visual no merece una ida al servidor: viven en el `localStorage` del navegador.
 * La regla de lint que prohibe el `localStorage` protege el token de la historia clinica
 * (ADR-0001); un tema no es un dato sensible, y por eso se accede por `defaultView` y no por el
 * global. Si el almacenamiento no esta (modo privado, bloqueado), la preferencia dura lo que la
 * pestana.
 *
 * <p>El tema se aplica con `data-tema` en `<html>`, que es lo que lee `design-system.css`. Sin
 * atributo manda el sistema operativo, como antes de que hubiera preferencia.
 */
@Injectable({ providedIn: 'root' })
export class PreferenciasStore {
  private readonly documento = inject(DOCUMENT);

  private readonly temaElegido = signal<Tema>(this.leerTema());

  readonly tema = this.temaElegido.asReadonly();

  constructor() {
    this.aplicarTema(this.temaElegido());
  }

  elegirTema(tema: Tema): void {
    this.temaElegido.set(tema);
    this.aplicarTema(tema);
    try {
      if (tema === 'sistema') {
        this.almacen()?.removeItem(CLAVE_TEMA);
      } else {
        this.almacen()?.setItem(CLAVE_TEMA, tema);
      }
    } catch {
      // Sin almacenamiento la preferencia vale para esta pestana: no es un error para el usuario.
    }
  }

  private aplicarTema(tema: Tema): void {
    const raiz = this.documento.documentElement;
    if (tema === 'sistema') {
      raiz.removeAttribute('data-tema');
    } else {
      raiz.setAttribute('data-tema', tema);
    }
  }

  private leerTema(): Tema {
    try {
      const guardado = this.almacen()?.getItem(CLAVE_TEMA);
      return guardado === 'claro' || guardado === 'oscuro' ? guardado : 'sistema';
    } catch {
      return 'sistema';
    }
  }

  private almacen(): Storage | null {
    return this.documento.defaultView?.localStorage ?? null;
  }
}
