import { Injectable, signal } from '@angular/core';

/** Severidad de un aviso: decide el icono, el color, el rol accesible y cuanto dura. */
export type TipoDeAviso = 'exito' | 'info' | 'advertencia' | 'error';

/** Accion contextual de un aviso ("Reintentar", "Ver persona"). Al usarla, el aviso se cierra. */
export interface AccionDeAviso {
  readonly etiqueta: string;
  readonly ejecutar: () => void;
}

export interface OpcionesDeAviso {
  /** Una linea mas, solo si agrega informacion al titulo. */
  readonly descripcion?: string;
  readonly accion?: AccionDeAviso;
  /** Milisegundos a la vista; `null` = hasta que el usuario lo cierre. */
  readonly duracion?: number | null;
}

export interface Aviso {
  readonly id: number;
  readonly tipo: TipoDeAviso;
  readonly titulo: string;
  readonly descripcion: string | null;
  readonly accion: AccionDeAviso | null;
  readonly duracion: number | null;
}

/** Cuantos avisos conviven en pantalla: con mas, se descarta el mas viejo. */
export const MAXIMO_DE_AVISOS = 3;

/** Cuanto queda a la vista cada tipo si quien lo publica no dice otra cosa. */
export const DURACION_POR_DEFECTO: Readonly<Record<TipoDeAviso, number>> = {
  exito: 4500,
  info: 5000,
  advertencia: 8000,
  error: 10000,
};

/**
 * Avisos globales ("toasts") del resultado de una operación (refactor UX/UI del 28/10/2026).
 *
 * <p><b>Para que es y para que no.</b> Un aviso dice <b>que paso</b> despues de una accion:
 * "Persona registrada", "No pudimos guardar los cambios · Reintentar". No reemplaza a:
 *
 * <ul>
 *   <li>la <b>validacion junto al campo</b> (`.campo__error`), que dice que dato corregir;</li>
 *   <li>la <b>alerta del formulario</b> (`app-alerta`), para un problema que bloquea la
 *       operacion entera y tiene que seguir a la vista mientras se corrige;</li>
 *   <li>la <b>confirmacion</b> de algo destructivo, que es un dialogo modal.</li>
 * </ul>
 *
 * <p><b>Duracion.</b> Exito ~4,5 s, informacion ~5 s, advertencia 8 s. Un error con accion
 * (Reintentar) no se va solo: el usuario tiene que poder usarla. Pasar el puntero o el foco por
 * un aviso pausa su cuenta (WCAG 2.2.1); lo maneja el host con {@link pausar}/{@link reanudar}.
 *
 * <p>Lo dibuja `layout/avisos`, que el shell monta despues de la primera pintura. Este store es
 * chico a proposito: vive en la carga inicial.
 */
@Injectable({ providedIn: 'root' })
export class AvisosStore {
  private readonly lista = signal<readonly Aviso[]>([]);
  private readonly temporizadores = new Map<number, ReturnType<typeof setTimeout>>();
  private siguienteId = 1;

  readonly avisos = this.lista.asReadonly();

  exito(titulo: string, opciones?: OpcionesDeAviso): number {
    return this.publicar('exito', titulo, opciones);
  }

  info(titulo: string, opciones?: OpcionesDeAviso): number {
    return this.publicar('info', titulo, opciones);
  }

  advertencia(titulo: string, opciones?: OpcionesDeAviso): number {
    return this.publicar('advertencia', titulo, opciones);
  }

  error(titulo: string, opciones?: OpcionesDeAviso): number {
    return this.publicar('error', titulo, opciones);
  }

  cerrar(id: number): void {
    this.detener(id);
    this.lista.update((avisos) => avisos.filter((aviso) => aviso.id !== id));
  }

  /** Usa la accion del aviso y lo cierra. */
  ejecutar(id: number): void {
    const aviso = this.lista().find((candidato) => candidato.id === id);
    this.cerrar(id);
    aviso?.accion?.ejecutar();
  }

  /** El puntero o el foco estan sobre el aviso: no se cierra mientras se lee. */
  pausar(id: number): void {
    this.detener(id);
  }

  /** Vuelve a contar desde el principio de su duracion. */
  reanudar(id: number): void {
    const aviso = this.lista().find((candidato) => candidato.id === id);
    if (aviso !== undefined) {
      this.programar(aviso);
    }
  }

  /** Saca todos: al cerrar sesion, nada de lo que decian sigue siendo cierto. */
  vaciar(): void {
    for (const id of this.temporizadores.keys()) {
      this.detener(id);
    }
    this.lista.set([]);
  }

  private publicar(tipo: TipoDeAviso, titulo: string, opciones: OpcionesDeAviso = {}): number {
    const accion = opciones.accion ?? null;
    const porDefecto = tipo === 'error' && accion !== null ? null : DURACION_POR_DEFECTO[tipo];
    const aviso: Aviso = {
      id: this.siguienteId++,
      tipo,
      titulo,
      descripcion: opciones.descripcion ?? null,
      accion,
      duracion: opciones.duracion === undefined ? porDefecto : opciones.duracion,
    };

    const actuales = this.lista();
    const sobrantes = actuales.slice(0, Math.max(0, actuales.length - (MAXIMO_DE_AVISOS - 1)));
    sobrantes.forEach((viejo) => this.detener(viejo.id));
    this.lista.set([...actuales.slice(sobrantes.length), aviso]);
    this.programar(aviso);
    return aviso.id;
  }

  private programar(aviso: Aviso): void {
    this.detener(aviso.id);
    if (aviso.duracion !== null) {
      this.temporizadores.set(
        aviso.id,
        setTimeout(() => this.cerrar(aviso.id), aviso.duracion),
      );
    }
  }

  private detener(id: number): void {
    const temporizador = this.temporizadores.get(id);
    if (temporizador !== undefined) {
      clearTimeout(temporizador);
      this.temporizadores.delete(id);
    }
  }
}
