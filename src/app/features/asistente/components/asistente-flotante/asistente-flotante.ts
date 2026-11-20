import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

import { PERMISO_ASISTENTE_USE } from '../../../../core/models/permisos';
import { FuncionesIaStore } from '../../../../core/services/funciones-ia.store';
import { PermissionsStore } from '../../../../core/services/permissions.store';
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

  protected readonly visible = computed(
    () =>
      this.session.estado() === 'activa' &&
      this.tenant.context() !== null &&
      this.permisos.tiene(PERMISO_ASISTENTE_USE) &&
      this.funcionesIa.activa('ASISTENTE') &&
      !/^\/asistente(\/|\?|$)/.test(this.url()),
  );

  constructor() {
    // Una pregunta que llega de la ayuda: se abre la charla con el texto escrito, sin enviarlo.
    effect(() => {
      const pendiente = this.pedidos.pendiente();
      if (pendiente === null) {
        return;
      }
      if (!this.visible()) {
        // No se guarda para después: abriría la charla de sorpresa en otra pantalla.
        this.pedidos.atendida();
        return;
      }
      this.abierto.set(true);
      this.pedidos.atendida();
      queueMicrotask(() => this.charla()?.escribirPregunta(pendiente.texto));
    });
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
