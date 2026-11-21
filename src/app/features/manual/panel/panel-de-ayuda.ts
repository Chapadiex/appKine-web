import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import {
  Subject,
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  of,
  switchMap,
  catchError,
} from 'rxjs';

import { FichaDelManualResponse } from '../../../api/generated/model/ficha-del-manual-response';
import { IndiceDelManualResponse } from '../../../api/generated/model/indice-del-manual-response';
import { PasajeDelManualResponse } from '../../../api/generated/model/pasaje-del-manual-response';
import { PrimerosPasosStore } from '../../../core/guards/primeros-pasos.guard';
import { PERMISO_ASISTENTE_USE } from '../../../core/models/permisos';
import { FuncionesIaStore } from '../../../core/services/funciones-ia.store';
import { ManualStore } from '../../../core/services/manual.store';
import { PermissionsStore } from '../../../core/services/permissions.store';
import { PreguntaAlAsistenteStore } from '../../../core/services/pregunta-al-asistente.store';
import { SessionService } from '../../../core/services/session.service';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { Icono } from '../../../shared/components/icono/icono';
import { rutaDePantalla } from '../../../shared/utils/ruta-de-pantalla';
import { trazoDelManual } from '../../../shared/components/markdown-seguro/iconos-de-texto';
import {
  CapturaAmpliada,
  MarkdownSeguro,
} from '../../../shared/components/markdown-seguro/markdown-seguro';
import { ManualApi } from '../services/manual-api';

type Vista = 'ficha' | 'indice';

/**
 * El manual de usuario al costado de la pantalla (appKine-api/docs/diseno/AKINE-manual-de-usuario.md
 * §5.5). No es modal: la persona sigue usando la aplicación con la ayuda abierta, y al navegar la ficha
 * sigue a la pantalla. El contenido viene de la API y se dibuja sin `innerHTML`.
 */
@Component({
  selector: 'app-panel-de-ayuda',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icono, MarkdownSeguro],
  templateUrl: './panel-de-ayuda.html',
  styleUrl: './panel-de-ayuda.css',
  host: { '(document:keydown.escape)': 'alEscape($event)' },
})
export class PanelDeAyuda {
  private readonly api = inject(ManualApi);
  private readonly router = inject(Router);
  private readonly tenant = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);
  private readonly funcionesIa = inject(FuncionesIaStore);
  private readonly preguntaAlAsistente = inject(PreguntaAlAsistenteStore);
  private readonly destruir = inject(DestroyRef);
  private readonly session = inject(SessionService);
  private readonly primerosPasos = inject(PrimerosPasosStore);
  protected readonly manual = inject(ManualStore);

  private readonly titulo = viewChild<ElementRef<HTMLElement>>('tituloDelPanel');
  private readonly lupa = viewChild<ElementRef<HTMLDialogElement>>('lupa');

  protected readonly trazoManual = trazoDelManual('manual');
  protected readonly trazoRelacionadas = trazoDelManual('relacionadas');

  protected readonly vista = signal<Vista>('ficha');
  protected readonly ficha = signal<FichaDelManualResponse | null>(null);
  protected readonly cargando = signal(false);
  protected readonly error = signal(false);
  protected readonly indice = signal<IndiceDelManualResponse | null>(null);
  protected readonly consulta = signal('');
  protected readonly resultados = signal<PasajeDelManualResponse[] | null>(null);
  protected readonly ampliada = signal<CapturaAmpliada | null>(null);

  protected readonly sinSede = computed(() => this.tenant.context() === null);
  protected readonly puedePreguntar = computed(
    () => this.permisos.tiene(PERMISO_ASISTENTE_USE) && this.funcionesIa.activa('ASISTENTE'),
  );

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((evento) => evento instanceof NavigationEnd),
      map(() => rutaDePantalla(this.router.url)),
    ),
    { initialValue: rutaDePantalla(this.router.url) },
  );

  private readonly busquedas = new Subject<string>();
  /** Lo que tenía el foco al abrir: vuelve ahí al cerrar. */
  private disparador: HTMLElement | null = null;

  constructor() {
    // La ficha sigue a la pantalla (o a la pedida por id) y a la sede: al cambiar de sede se relee,
    // porque lo visible depende de los permisos de esa sede.
    effect((alLimpiar) => {
      if (!this.manual.abierto() || this.sinSede()) {
        return;
      }
      this.tenant.context();
      const pedida = this.manual.fichaPedida();
      const ruta = this.url();
      this.vista.set('ficha');
      this.cargando.set(true);
      this.error.set(false);
      const fuente = pedida ? this.api.ficha(pedida) : this.api.deLaRuta(ruta);
      const sub = fuente.subscribe({
        next: (ficha) => {
          this.ficha.set(ficha);
          this.cargando.set(false);
        },
        error: () => {
          this.ficha.set(null);
          this.cargando.set(false);
          this.error.set(true);
        },
      });
      alLimpiar(() => sub.unsubscribe());
    });

    // Al abrir, el foco va al título; al cerrar (con la X, Escape o F1), vuelve a quien abrió.
    let estabaAbierto = false;
    effect(() => {
      const abierto = this.manual.abierto();
      if (abierto && !estabaAbierto) {
        this.disparador =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        queueMicrotask(() => this.titulo()?.nativeElement.focus());
      } else if (!abierto && estabaAbierto) {
        queueMicrotask(() => this.disparador?.focus());
      }
      estabaAbierto = abierto;
    });

    // Otra sede u otra persona: nada de lo leído antes sigue valiendo (lo visible depende de los
    // permisos). Al cerrar sesión, además, se cierra.
    effect(() => {
      this.tenant.context();
      if (this.session.estado() === 'anonimo') {
        this.manual.cerrar();
      }
      this.indice.set(null);
      this.resultados.set(null);
      this.consulta.set('');
    });

    this.busquedas
      .pipe(
        map((q) => q.trim()),
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) =>
          q.length < 2
            ? of(null)
            : this.api
                .buscar(q, this.url())
                .pipe(catchError(() => of([] as PasajeDelManualResponse[]))),
        ),
        takeUntilDestroyed(this.destruir),
      )
      .subscribe((resultados) => this.resultados.set(resultados));
  }

  protected escribir(valor: string): void {
    this.consulta.set(valor);
    this.busquedas.next(valor);
  }

  protected abrirFicha(id: string): void {
    this.vista.set('ficha');
    this.consulta.set('');
    this.busquedas.next('');
    this.manual.verFicha(id);
  }

  protected verIndice(): void {
    this.vista.set('indice');
    this.error.set(false);
    if (this.indice() === null) {
      this.api.indice().subscribe({
        next: (indice) => this.indice.set(indice),
        error: () => this.error.set(true),
      });
    }
  }

  protected volverALaPantalla(): void {
    this.manual.seguirPantalla();
    this.vista.set('ficha');
  }

  protected preguntar(): void {
    const texto =
      this.consulta().trim() || (this.ficha() ? `¿Cómo uso ${this.ficha()!.titulo}?` : '');
    this.preguntaAlAsistente.preguntar(texto);
  }

  protected ampliar(captura: CapturaAmpliada): void {
    this.ampliada.set(captura);
    queueMicrotask(() => this.lupa()?.nativeElement.showModal?.());
  }

  protected cerrarLupa(): void {
    this.lupa()?.nativeElement.close?.();
    this.ampliada.set(null);
  }

  protected cerrar(): void {
    this.manual.cerrar();
  }

  /** Cierra la ayuda y vuelve a mostrar el tour guiado del menú, como el menú del perfil. */
  protected verRecorrido(): void {
    this.cerrar();
    this.primerosPasos.recorrido.set(true);
  }

  protected alEscape(evento: Event): void {
    // Un Escape que ya atendió otro diálogo o menú de la pantalla no cierra la ayuda.
    if (evento.defaultPrevented || this.ampliada()) {
      return; // El dialog de la captura se cierra solo con Escape.
    }
    if (this.manual.abierto()) {
      this.cerrar();
    }
  }
}
