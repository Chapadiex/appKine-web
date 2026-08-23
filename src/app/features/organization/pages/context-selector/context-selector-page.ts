import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, of } from 'rxjs';

import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { AuthorizedContextResponse } from '../../../../api/generated/model/authorized-context-response';
import { MiCuentaService } from '../../../../api/generated/api/mi-cuenta.service';
import { TenantContext, TenantContextStore } from '../../../../core/services/tenant-context.store';

/**
 * Estado de la pantalla de seleccion de contexto (ADR-0005).
 *
 * <p>`vacio` es un estado propio y no un caso del exito: "no tenes donde trabajar" y
 * "todavia no elegiste" exigen mensajes y salidas distintas, y el backend los distingue
 * devolviendo lista vacia en lugar de un error.
 */
type EstadoContextos =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'eligiendo'; readonly contextos: readonly TenantContext[] }
  | { readonly tipo: 'vacio' }
  | { readonly tipo: 'entrando'; readonly contexto: TenantContext }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly esDeRed: boolean };

/**
 * Seleccion del contexto de trabajo: Organizacion + Consultorio (M01, AKINE-01.01).
 *
 * <p>Consume `GET /api/v1/me/contexts`, el unico endpoint del modulo que <b>no</b> exige
 * contexto de tenant: es con el que se averigua que contextos hay.
 *
 * <p><b>Con un solo contexto no se muestra el selector.</b> Elegir entre una sola opcion no
 * es una decision, es un clic de tramite; la mayoria de los centros tiene una sede y se
 * comeria esa friccion en cada login.
 *
 * <p><b>PENDIENTE(01.02).</b> Seleccionar el contexto debe ademas renovar el token contra
 * `POST /api/v1/auth/context`, que publica el modulo de identidad. Hoy la seleccion solo
 * actualiza `TenantContextStore`, asi que las pantallas siguientes mandan un token sin
 * contexto y el backend las rechaza con `missing-tenant-context`. Esta pantalla <b>no puede
 * ejercitarse de punta a punta hasta que exista el login</b>.
 */
@Component({
  selector: 'app-context-selector-page',
  templateUrl: './context-selector-page.html',
  styleUrl: '../../organization.css',
})
export class ContextSelectorPage {
  private readonly miCuenta = inject(MiCuentaService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly router = inject(Router);

  protected readonly estado = signal<EstadoContextos>({ tipo: 'cargando' });

  /**
   * Contextos a elegir, o `null` en cualquier otro estado.
   *
   * El estrechamiento se hace aca, en TypeScript, no en la plantilla con `$any` (ADR-0005).
   */
  protected readonly contextos = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'eligiendo' ? estado.contextos : null;
  });

  /** Contexto al que se esta entrando tras la auto-seleccion, o `null`. */
  protected readonly contextoEnCurso = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'entrando' ? estado.contexto : null;
  });

  /** Mensaje de error mostrable, o `null` si el estado no es de error. */
  protected readonly mensajeError = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.mensaje : null;
  });

  constructor() {
    this.cargar();
  }

  protected cargar(): void {
    this.estado.set({ tipo: 'cargando' });

    this.miCuenta
      .listMyContexts()
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          this.estado.set(this.aEstadoDeError(respuesta));
          return;
        }

        this.resolver(respuesta);
      });
  }

  /**
   * Aplica la seleccion y navega a la organizacion.
   *
   * `select()` incrementa `contextEpoch`, y las features que cachean datos deben descartar
   * su estado ante ese cambio: no hacerlo deja datos del tenant A visibles bajo el B.
   */
  protected seleccionar(contexto: TenantContext): void {
    this.estado.set({ tipo: 'entrando', contexto });
    this.tenantContext.select(contexto);
    // La promesa se maneja: una navegacion fallida en silencio deja al usuario mirando el
    // "Entrando a..." para siempre, sin saber que paso.
    this.router.navigate(['/organizacion']).catch((error: unknown) => {
      console.error('No se pudo navegar a la organizacion', error);
      this.estado.set({
        tipo: 'error',
        mensaje: 'El contexto quedo elegido pero no pudimos abrir la organizacion.',
        esDeRed: false,
      });
    });
  }

  /** Convierte un elemento de la respuesta en el contexto del store, o `null` si viene incompleto. */
  private aContexto(elemento: AuthorizedContextResponse): TenantContext | null {
    const { organizationId, organizationName } = elemento;
    if (organizationId === undefined || organizationName === undefined) {
      return null;
    }

    return {
      organizationId,
      organizationName,
      consultorioId: elemento.consultorioId,
      consultorioName: elemento.consultorioName,
    };
  }

  private resolver(respuesta: readonly AuthorizedContextResponse[]): void {
    // Todos los campos vienen opcionales del generador porque el contrato no los marca
    // required. Un elemento sin organizacion no es elegible: seleccionarlo produciria un
    // contexto invalido que fallaria recien en la pantalla siguiente.
    const utilizables = respuesta
      .map((elemento) => this.aContexto(elemento))
      .filter((contexto): contexto is TenantContext => contexto !== null);

    if (utilizables.length === 0) {
      this.estado.set({ tipo: 'vacio' });
      return;
    }

    if (utilizables.length === 1) {
      this.seleccionar(utilizables[0]);
      return;
    }

    this.estado.set({ tipo: 'eligiendo', contextos: utilizables });
  }

  private aEstadoDeError(error: Error): EstadoContextos {
    if (!(error instanceof AkineHttpError)) {
      return { tipo: 'error', mensaje: 'Error inesperado al pedir tus contextos.', esDeRed: false };
    }

    if (error.esDeRed) {
      return {
        tipo: 'error',
        mensaje: 'No se pudo contactar al servidor.',
        esDeRed: true,
      };
    }

    // 403 y no 401: el backend nunca emite 401 desde endpoints de negocio, justamente para
    // que el cliente no descarte el token y entre en un bucle de login.
    if (error.status === 403) {
      return {
        tipo: 'error',
        mensaje: 'Tu sesion no esta activa. Volve a iniciar sesion.',
        esDeRed: false,
      };
    }

    return { tipo: 'error', mensaje: error.message, esDeRed: false };
  }
}
