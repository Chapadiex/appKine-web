import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { EstadoFormulario, traducirYEsperar } from '../../models/auth-errors';
import {
  PARAM_VOLVER_A,
  RUTA_SELECTOR_CONTEXTO,
  destinoInterno,
} from '../../../../core/models/rutas';
import { SessionService } from '../../../../core/services/session.service';
import { PlatformRoleStore } from '../../../../core/services/platform-role.store';
import { catchError, of } from 'rxjs';
import { crearEsperaPorLimite } from '../../../../shared/utils/espera-por-limite';
import { Alerta } from '../../../../shared/components/alerta/alerta';

/** Escena ilustrada que acompaña la tarjeta de ingreso (19/11/2026). */
interface EscenaDeIngreso {
  readonly imagen: string;
  readonly titulo: string;
  readonly bajada: string;
}

/**
 * Las imágenes viven en `public/acceso/` (1400 px, JPG): se piden aparte y no pesan en el bundle.
 * Vienen sobre fondo blanco, el mismo del panel.
 */
const ESCENAS: readonly EscenaDeIngreso[] = [
  {
    imagen: 'acceso/paralelas-y-pelota.jpg',
    titulo: 'Rehabilitar es acompañar.',
    bajada: 'El plan y la evolución de cada paciente, a la vista de todo el equipo.',
  },
  {
    imagen: 'acceso/grupo.jpg',
    titulo: 'Sesiones y clases, en un solo lugar.',
    bajada: 'Turnos, inscripciones y asistencia sin planillas de por medio.',
  },
  {
    imagen: 'acceso/estiramientos.jpg',
    titulo: 'Cada sesión, un paso más.',
    bajada: 'La agenda, la historia clínica y los cobros, conectados.',
  },
];

/** Destino por defecto cuando la sesion ya quedo con contexto. */
const DESTINO_POR_DEFECTO = '/organizacion';

/** La consola de la administracion de plataforma (`features/platform`). */
const DESTINO_DE_PLATAFORMA = '/plataforma';

/**
 * Inicio de sesion (M02, AKINE-01.02).
 *
 * <p>Identidad unica: no se pregunta "sos paciente o profesional" (DP-02). Segun como quede
 * la sesion, se sigue al selector de contexto o directo al destino.
 *
 * <p><b>Rechazo uniforme (ADR-0018).</b> Credenciales incorrectas, cuenta pendiente de
 * activacion y cuenta bloqueada devuelven las tres el MISMO 401 con el MISMO cuerpo. La
 * pantalla muestra un unico mensaje para las tres, a proposito: cualquier diferencia
 * convertiria el login en un verificador de emails y de credenciales filtradas.
 */
@Component({
  selector: 'app-login-page',
  imports: [Alerta, ReactiveFormsModule, RouterLink],
  templateUrl: './login-page.html',
  styleUrls: ['../../auth.css', '../../../../shared/styles/acceso.css', './login-page.css'],
})
export class LoginPage {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly rolDePlataforma = inject(PlatformRoleStore);
  private readonly ruta = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly formulario = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
    /** "Mantener la sesión iniciada" (DP-45). Desmarcada por defecto: la jornada de siempre. */
    recordarme: [false],
  });

  /** Una escena al azar cada vez que se abre el ingreso. */
  protected readonly escena = ESCENAS[Math.floor(Math.random() * ESCENAS.length)];

  protected readonly estado = signal<EstadoFormulario>({ tipo: 'editando' });

  /** Se incrementa en cada envio. Es lo que hace reactiva la pintura de errores (zoneless). */
  protected readonly intentos = signal(0);

  /** Mostrar u ocultar la contraseña mientras se escribe (diseño del canvas). Solo cambia el input. */
  protected readonly verPassword = signal(false);

  protected readonly espera = crearEsperaPorLimite();

  protected readonly enviando = computed(() => this.estado().tipo === 'enviando');
  /** Desde que se mandan los datos hasta que abre la pantalla siguiente: el botón gira. */
  protected readonly entrando = computed(
    () => this.estado().tipo === 'enviando' || this.estado().tipo === 'ok',
  );

  protected readonly mensajeError = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.mensaje : null;
  });

  protected readonly bloqueado = computed(() => this.enviando() || this.espera.activa());

  protected mostrarError(nombre: 'email' | 'password'): boolean {
    const control = this.formulario.controls[nombre];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected enviar(): void {
    this.intentos.update((valor) => valor + 1);

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      this.enfocarPrimerInvalido();
      return;
    }

    if (this.espera.activa()) {
      return;
    }

    const { email, password, recordarme } = this.formulario.getRawValue();
    this.estado.set({ tipo: 'enviando' });

    this.session.login(email, password, recordarme).subscribe({
      next: () => this.continuar(),
      error: (error: unknown) => this.fallar(error),
    });
  }

  /**
   * Camino de vuelta tras el login, saneado para que no sirva de redireccion abierta.
   *
   * <p>El nombre del parametro y el sanitizado salen de `core/`: quien escribe el destino es
   * un guard o el interceptor de auth, y leerlo con otro nombre -como pasaba con
   * `returnUrl`- equivale a ignorarlo siempre.
   */
  private destino(): string {
    const solicitado = this.ruta.snapshot.queryParamMap.get(PARAM_VOLVER_A);
    return destinoInterno(solicitado) ?? DESTINO_POR_DEFECTO;
  }

  /**
   * Sin un destino pedido, la administracion de plataforma va directo a su consola: el rol le
   * quita los permisos del centro y la pantalla por defecto le mostraria un error de permisos.
   */
  private continuar(): void {
    if (this.ruta.snapshot.queryParamMap.get(PARAM_VOLVER_A) !== null) {
      this.navegarAdentro();
      return;
    }
    this.rolDePlataforma
      .resolver()
      .pipe(catchError(() => of(false)))
      .subscribe((admin) => this.navegarAdentro(admin ? DESTINO_DE_PLATAFORMA : undefined));
  }

  private navegarAdentro(destinoDePlataforma?: string): void {
    // `sin-contexto` no es un error: el token de login todavia no esta acotado a una
    // Organizacion y hay que elegir donde trabajar antes de operar (DP-02).
    //
    // El destino viaja al selector como query param en vez de perderse: el recorrido real es
    // guard de contexto -> selector -> guard de auth -> login, y cada salto arrastra el
    // `volverA` original. Navegar al selector "pelado" cortaba esa cadena en su ultimo tramo
    // y devolvia a todo el mundo a la pantalla por defecto, sin importar que hubiera pedido.
    const ruta =
      destinoDePlataforma ??
      (this.session.estado() === 'activa'
        ? this.destino()
        : `${RUTA_SELECTOR_CONTEXTO}?${PARAM_VOLVER_A}=${encodeURIComponent(this.destino())}`);

    this.estado.set({ tipo: 'ok', mensaje: 'Sesión iniciada. Te estamos llevando adentro.' });

    this.router.navigateByUrl(ruta).catch((error: unknown) => {
      console.error('No se pudo navegar después del login', error);
      this.estado.set({
        tipo: 'error',
        mensaje: 'Iniciaste sesión pero no pudimos abrir la pantalla siguiente.',
        causa: 'otro',
      });
    });
  }

  private fallar(error: unknown): void {
    const traducido = traducirYEsperar(error, this.espera);
    this.estado.set({ tipo: 'error', mensaje: traducido.mensaje, causa: traducido.causa });
  }

  private enfocarPrimerInvalido(): void {
    const nombre = (['email', 'password'] as const).find(
      (campo) => this.formulario.controls[campo].invalid,
    );
    if (nombre === undefined) {
      return;
    }
    this.host.nativeElement.querySelector<HTMLElement>(`#login-${nombre}`)?.focus();
  }
}
