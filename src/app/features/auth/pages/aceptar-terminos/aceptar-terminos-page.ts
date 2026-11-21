import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { MisTerminosResponse } from '../../../../api/generated/model/mis-terminos-response';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { PARAM_VOLVER_A, RUTA_LOGIN, destinoInterno } from '../../../../core/models/rutas';
import { SessionService } from '../../../../core/services/session.service';
import { TerminosPendientesStore } from '../../../../core/services/terminos-pendientes.store';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Icono } from '../../../../shared/components/icono/icono';

type Lectura =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'error' }
  | { readonly tipo: 'listo'; readonly terminos: MisTerminosResponse };

/**
 * Aceptar la versión vigente de los términos (19/11/2026,
 * `appKine-api/docs/diseno/AKINE-terminos-obligatorios.md`).
 *
 * <p>Aparece después de iniciar sesión, o en medio del uso si la versión cambia, cuando la cuenta
 * no aceptó la vigente: hasta aceptarla el backend responde 403 `terminos-pendientes` a todo. Las
 * dos salidas son aceptar o cerrar sesión. Al aceptar vuelve a donde iba (`volverA`).
 */
@Component({
  selector: 'app-aceptar-terminos-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alerta, Icono],
  templateUrl: './aceptar-terminos-page.html',
  styleUrls: [
    '../../auth.css',
    '../../../../shared/styles/acceso.css',
    './aceptar-terminos-page.css',
  ],
})
export class AceptarTerminosPage implements OnInit {
  private readonly store = inject(TerminosPendientesStore);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);

  protected readonly lectura = signal<Lectura>({ tipo: 'cargando' });
  protected readonly aceptados = signal(false);
  protected readonly enviando = signal(false);
  protected readonly faltaMarcar = signal(false);
  protected readonly errorAlAceptar = signal<string | null>(null);

  ngOnInit(): void {
    this.cargar();
  }

  protected cargar(): void {
    this.lectura.set({ tipo: 'cargando' });
    this.aceptados.set(false);
    this.store.cargar().subscribe({
      next: (terminos) => {
        if (!terminos.pendiente) {
          this.seguir();
          return;
        }
        this.lectura.set({ tipo: 'listo', terminos });
      },
      error: () => this.lectura.set({ tipo: 'error' }),
    });
  }

  protected alternar(evento: Event): void {
    const marcado = (evento.target as HTMLInputElement).checked;
    this.aceptados.set(marcado);
    if (marcado) {
      this.faltaMarcar.set(false);
    }
  }

  protected aceptar(): void {
    const lectura = this.lectura();
    if (lectura.tipo !== 'listo' || this.enviando()) {
      return;
    }
    if (!this.aceptados()) {
      this.faltaMarcar.set(true);
      return;
    }
    const version = lectura.terminos.versionVigente;
    if (!version) {
      this.seguir();
      return;
    }
    this.enviando.set(true);
    this.errorAlAceptar.set(null);
    this.store.aceptar(version).subscribe({
      next: () => {
        this.enviando.set(false);
        this.seguir();
      },
      error: (error: unknown) => {
        this.enviando.set(false);
        if (error instanceof AkineHttpError && error.status === 400) {
          // La versión cambió mientras se leía: se muestra la nueva y se vuelve a pedir la casilla.
          this.errorAlAceptar.set(
            'Los términos cambiaron mientras los leías. Revisá la versión nueva y aceptala.',
          );
          this.cargar();
          return;
        }
        this.errorAlAceptar.set(
          error instanceof AkineHttpError && !error.esDeRed
            ? error.mensaje
            : 'No pudimos guardar tu aceptación. Revisá tu conexión y volvé a intentar.',
        );
      },
    });
  }

  protected cerrarSesion(): void {
    this.session.logout().subscribe({
      complete: () => this.irA(RUTA_LOGIN),
      error: () => this.irA(RUTA_LOGIN),
    });
  }

  private seguir(): void {
    const destino = destinoInterno(this.ruta.snapshot.queryParamMap.get(PARAM_VOLVER_A));
    this.irA(destino ?? '/');
  }

  private irA(url: string): void {
    this.router.navigateByUrl(url).catch(() => undefined);
  }
}
