import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

import { PERMISO_ASISTENTE_USE } from '../../../../core/models/permisos';
import { FuncionesIaStore } from '../../../../core/services/funciones-ia.store';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { PreferenciasStore } from '../../../../core/services/preferencias.store';
import { PreguntaAlAsistenteStore } from '../../../../core/services/pregunta-al-asistente.store';
import { SessionService } from '../../../../core/services/session.service';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { CharlaDelAsistente } from '../charla-del-asistente/charla-del-asistente';

/**
 * Acceso flotante al asistente de datos, abajo a la izquierda en todas las pantallas. Abre un panel
 * con la misma charla que la pantalla `/asistente`; ahí no se muestra, para no tener dos. Lo monta
 * el shell después de la primera pintura (ver `App`). Mostrarlo según el permiso es UX: el backend
 * rechaza igual.
 */
@Component({
  selector: 'app-asistente-flotante',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CharlaDelAsistente],
  templateUrl: './asistente-flotante.html',
  styleUrl: './asistente-flotante.css',
  host: { '(document:keydown.escape)': 'alEscape()' },
})
export class AsistenteFlotante {
  private readonly router = inject(Router);
  private readonly permisos = inject(PermissionsStore);
  private readonly funcionesIa = inject(FuncionesIaStore);
  private readonly session = inject(SessionService);
  private readonly tenant = inject(TenantContextStore);
  private readonly pedidos = inject(PreguntaAlAsistenteStore);
  private readonly preferencias = inject(PreferenciasStore);

  protected readonly abierto = signal(false);
  private readonly disparador = viewChild<ElementRef<HTMLButtonElement>>('disparador');
  private readonly charla = viewChild(CharlaDelAsistente);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((evento) => evento instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** Puede verse (sesión, sede, permiso, IA y pantalla), aunque la persona lo haya ocultado. */
  private readonly disponible = computed(
    () =>
      this.session.estado() === 'activa' &&
      this.tenant.context() !== null &&
      this.permisos.tiene(PERMISO_ASISTENTE_USE) &&
      this.funcionesIa.activa('ASISTENTE') &&
      // Ni en /asistente ni en las pantallas de acceso (ingresar, invitación, elegir contexto),
      // que pueden abrirse con una sesión de otra cuenta todavía viva.
      !/^\/(asistente|auth|seleccionar-contexto)(\/|\?|$)/.test(this.url()),
  );

  /** Se ve si está disponible y no lo ocultaron desde el pie del menú (23/11/2026). */
  protected readonly visible = computed(
    () => this.disponible() && this.preferencias.asistenteVisible(),
  );

  constructor() {
    // Una pregunta que llega de la ayuda: se abre la charla con el texto escrito, sin enviarlo.
    effect(() => {
      const pendiente = this.pedidos.pendiente();
      if (pendiente === null) {
        return;
      }
      if (!this.disponible()) {
        // No se guarda para después: abriría la charla de sorpresa en otra pantalla.
        this.pedidos.atendida();
        return;
      }
      // Pedirle algo es querer verlo: si estaba oculto, vuelve.
      this.preferencias.mostrarAsistente(true);
      this.abierto.set(true);
      this.pedidos.atendida();
      queueMicrotask(() => this.charla()?.escribirPregunta(pendiente.texto));
    });
    // Respuesta que llega con el panel cerrado: queda marcada hasta abrirlo.
    let pensabaAntes = false;
    effect(() => {
      const pensando = this.charla()?.enCurso() ?? false;
      if (pensabaAntes && !pensando && !untracked(this.abierto)) {
        this.respuestaSinLeer.set(true);
      }
      pensabaAntes = pensando;
    });
    effect(() => {
      if (this.abierto()) this.respuestaSinLeer.set(false);
    });

    // La forma ondulante solo se anima mientras piensa, y no con movimiento reducido.
    effect((alLimpiar) => {
      const reducido = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (this.estado() !== 'pensando' || reducido || typeof requestAnimationFrame !== 'function') {
        return;
      }
      this.animarForma();
      alLimpiar(() => {
        if (this.cuadro !== null) cancelAnimationFrame(this.cuadro);
        this.cuadro = null;
      });
    });

    // El botón movido no queda fuera de la ventana al achicarla.
    const alRedimensionar = () => {
      this.anchoVentana.set(globalThis.innerWidth);
      this.altoVentana.set(globalThis.innerHeight);
      const pos = this.posicion();
      const boton = this.disparador()?.nativeElement;
      if (pos && boton) this.posicion.set(this.dentroDeLaVentana(pos.left, pos.top, boton));
    };
    globalThis.addEventListener?.('resize', alRedimensionar);
    inject(DestroyRef).onDestroy(() => globalThis.removeEventListener?.('resize', alRedimensionar));

    // Si deja de verse (salió, cambió a una sede sin permiso, entró a /asistente) se cierra.
    effect(() => {
      if (!this.visible()) {
        this.abierto.set(false);
      }
    });
  }

  protected alternar(): void {
    this.abierto.update((a) => !a);
  }

  // --- Estado del orbe ---------------------------------------------------------------------

  /** Llegó una respuesta con el panel cerrado: el borde late hasta que se abre. */
  private readonly respuestaSinLeer = signal(false);

  protected readonly estado = computed<'reposo' | 'pensando' | 'listo'>(() => {
    if (this.charla()?.enCurso()) return 'pensando';
    return this.respuestaSinLeer() ? 'listo' : 'reposo';
  });

  private readonly formaInterna = viewChild<ElementRef<SVGPathElement>>('formaInterna');
  private cuadro: number | null = null;
  private fase = 0;

  // --- Arrastre ----------------------------------------------------------------------------

  /** Dónde lo dejó la persona, o `null` en su lugar de siempre. Vale para esta pestaña. */
  protected readonly posicion = signal<{ left: number; top: number } | null>(null);
  protected readonly arrastrando = signal(false);
  private inicio: { x: number; y: number; left: number; top: number; id: number } | null = null;
  /** El clic que sigue a un arrastre no abre ni cierra. */
  private ignorarClic = false;

  protected readonly cercaDelBordeDerecho = computed(() => {
    const pos = this.posicion();
    return pos !== null && pos.left > this.anchoVentana() - 160;
  });

  /** El panel se abre debajo del botón cuando el botón quedó en la mitad de arriba. */
  protected readonly panelAbajo = computed(() => {
    const pos = this.posicion();
    return pos !== null && pos.top < this.altoVentana() / 2;
  });

  private readonly anchoVentana = signal(globalThis.innerWidth ?? 1024);
  private readonly altoVentana = signal(globalThis.innerHeight ?? 768);

  protected empezarArrastre(evento: PointerEvent): void {
    if (evento.button !== 0) return;
    const caja = (evento.currentTarget as HTMLElement).getBoundingClientRect();
    this.inicio = {
      x: evento.clientX,
      y: evento.clientY,
      left: caja.left,
      top: caja.top,
      id: evento.pointerId,
    };
  }

  protected arrastrar(evento: PointerEvent): void {
    if (this.inicio === null) return;
    const dx = evento.clientX - this.inicio.x;
    const dy = evento.clientY - this.inicio.y;
    if (!this.arrastrando()) {
      if (Math.hypot(dx, dy) <= 4) return;
      this.arrastrando.set(true);
      (evento.currentTarget as HTMLElement).setPointerCapture?.(this.inicio.id);
    }
    this.posicion.set(
      this.dentroDeLaVentana(
        this.inicio.left + dx,
        this.inicio.top + dy,
        evento.currentTarget as HTMLElement,
      ),
    );
  }

  protected soltar(evento: PointerEvent): void {
    if (this.inicio === null) return;
    (evento.currentTarget as HTMLElement).releasePointerCapture?.(this.inicio.id);
    this.inicio = null;
    if (this.arrastrando()) {
      this.arrastrando.set(false);
      this.ignorarClic = true;
    }
  }

  /** Oculta el orbe (y la charla): vuelve desde «Asistente» al pie del menú. */
  protected ocultar(): void {
    this.abierto.set(false);
    this.preferencias.mostrarAsistente(false);
  }

  protected alClic(): void {
    if (this.ignorarClic) {
      this.ignorarClic = false;
      return;
    }
    this.alternar();
  }

  private dentroDeLaVentana(
    left: number,
    top: number,
    boton: HTMLElement,
  ): { left: number; top: number } {
    const margen = 12;
    const maxLeft = this.anchoVentana() - boton.offsetWidth - margen;
    const maxTop = this.altoVentana() - boton.offsetHeight - margen;
    return {
      left: Math.min(Math.max(margen, left), Math.max(margen, maxLeft)),
      top: Math.min(Math.max(margen, top), Math.max(margen, maxTop)),
    };
  }

  /** Forma que ondula mientras piensa: ocho puntos sobre un círculo, unidos con curvas. */
  private formaOndulante(t: number): string {
    const puntos = Array.from({ length: 8 }, (_, i) => {
      const angulo = (Math.PI * 2 * i) / 8;
      const r = 7.4 + Math.sin(t * 2.1 + i * 1.57) * 1.05 + Math.cos(t * 1.5 - i * 2.35) * 0.55;
      return { x: 12 + Math.cos(angulo) * r, y: 12 + Math.sin(angulo) * r };
    });
    const medio = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      `${((a.x + b.x) / 2).toFixed(2)} ${((a.y + b.y) / 2).toFixed(2)}`;
    let d = `M ${medio(puntos[7], puntos[0])} `;
    puntos.forEach((p, i) => {
      d += `Q ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${medio(p, puntos[(i + 1) % 8])} `;
    });
    return `${d}Z`;
  }

  private animarForma(): void {
    const path = this.formaInterna()?.nativeElement;
    if (!path) {
      this.cuadro = null;
      return;
    }
    this.fase += 0.042;
    path.setAttribute('d', this.formaOndulante(this.fase));
    this.cuadro = requestAnimationFrame(() => this.animarForma());
  }

  protected nuevaCharla(): void {
    this.charla()?.nuevaCharla();
  }

  protected cerrar(): void {
    this.abierto.set(false);
    this.disparador()?.nativeElement.focus();
  }

  protected alEscape(): void {
    if (this.abierto()) {
      this.cerrar();
    }
  }
}
