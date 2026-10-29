import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Desplegable } from '../desplegable';
import { Icono } from '../../shared/components/icono/icono';
import { PerfilPropioStore } from '../../core/services/perfil-propio.store';
import { RUTA_LOGIN } from '../../core/models/rutas';
import { RUTA_MI_PERFIL, RUTA_PREFERENCIAS } from '../../features/cuenta/models/rutas-de-cuenta';
import { SessionService } from '../../core/services/session.service';

/**
 * Perfil de quien ingreso, en el extremo derecho de la barra superior (refactor de la cabecera
 * global, 28/10/2026): avatar, nombre y un menu con sus datos, "Mi perfil", "Preferencias" y
 * "Cerrar sesion" al final y separado.
 *
 * <p>Reemplaza al pie de la barra lateral, que repetia la sede y tenia el boton de salir: la
 * barra lateral quedo para la navegacion. "Cerrar sesion" sigue a un clic de distancia en toda
 * pantalla, que era lo que pedia la auditoria del 21/10 (C1: la computadora compartida del
 * mostrador).
 *
 * <p>El avatar son las iniciales: la cuenta no tiene foto en el contrato. Mientras `/me` no
 * responde —o si falla— el disparador muestra el icono de persona y "Mi cuenta".
 */
@Component({
  selector: 'app-menu-de-perfil',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icono, RouterLink],
  templateUrl: './menu-de-perfil.html',
  styleUrls: ['../desplegable.css', './menu-de-perfil.css'],
})
export class MenuDePerfil extends Desplegable {
  private readonly perfil = inject(PerfilPropioStore);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  protected readonly rutaMiPerfil = RUTA_MI_PERFIL;
  protected readonly rutaPreferencias = RUTA_PREFERENCIAS;
  protected readonly saliendo = signal(false);

  protected readonly nombre = computed(() => {
    const perfil = this.perfil.perfil();
    return [perfil?.firstName, perfil?.lastName].filter(Boolean).join(' ') || null;
  });

  protected readonly rol = computed(() => this.perfil.perfil()?.context?.roleLabel ?? null);
  protected readonly correo = computed(() => this.perfil.perfil()?.email ?? null);
  protected readonly iniciales = computed(() => inicialesDe(this.nombre() ?? ''));

  constructor() {
    super();
    // Lee el sello de cuenta y sede: cambiar de sede puede cambiar el rol y vuelve a pedirlo.
    effect(() => this.perfil.asegurarCargado());
  }

  /** Cierra la sesion y vuelve al login. Un logout que falla en el servidor igual limpia el local. */
  protected cerrarSesion(): void {
    this.saliendo.set(true);
    this.session.logout().subscribe({
      complete: () => {
        this.saliendo.set(false);
        this.cerrar();
        this.router.navigateByUrl(RUTA_LOGIN).catch(() => undefined);
      },
    });
  }
}

/** Dos letras: "Ana Admin" → "AA"; "Ana" → "A". */
export function inicialesDe(nombre: string): string {
  return nombre
    .split(/\s+/)
    .filter((palabra) => palabra.length > 0)
    .slice(0, 2)
    .map((palabra) => palabra[0]!.toUpperCase())
    .join('');
}
