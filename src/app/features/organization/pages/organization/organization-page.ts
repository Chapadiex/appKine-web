import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { OrganizacionesService } from '../../../../api/generated/api/organizaciones.service';
import { OrganizationResponse } from '../../../../api/generated/model/organization-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';

/** Estado de la pantalla de organizacion (ADR-0005). */
type EstadoOrganizacion =
  | { readonly tipo: 'sin-contexto' }
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly organizacion: OrganizationResponse }
  | {
      readonly tipo: 'error';
      readonly mensaje: string;
      readonly esDeRed: boolean;
      readonly faltaContexto: boolean;
    };

/**
 * Datos de la organizacion activa (M01, AKINE-01.01).
 *
 * <p>Lee el `organizationId` de `TenantContextStore` y consulta
 * `GET /api/v1/organizations/{orgId}`. No guarda una copia del id: el store es la unica
 * fuente de verdad del contexto.
 *
 * <p><b>Reacciona a `contextEpoch`.</b> Cambiar de contexto sin recargar dejaria en pantalla
 * los datos de la organizacion anterior bajo la nueva: es el bug de aislamiento mas grave
 * del frontend. El `effect` depende del epoch, no del id, para que tambien dispare al
 * limpiar el contexto (logout).
 *
 * <p><b>PENDIENTE(01.02).</b> Sin login no hay token con contexto, asi que este endpoint
 * responde `403 missing-tenant-context` en la practica. La pantalla lo maneja como estado y
 * ofrece la salida a `/seleccionar-contexto`, pero <b>el camino feliz no se pudo verificar
 * contra el backend real</b>.
 */
@Component({
  selector: 'app-organization-page',
  imports: [RouterLink],
  templateUrl: './organization-page.html',
  styleUrl: '../../organization.css',
})
export class OrganizationPage {
  private readonly organizaciones = inject(OrganizacionesService);
  private readonly tenantContext = inject(TenantContextStore);

  protected readonly estado = signal<EstadoOrganizacion>({ tipo: 'cargando' });

  /** Datos de la organizacion, o `null` en cualquier otro estado (ADR-0005: sin `$any`). */
  protected readonly organizacion = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'listo' ? estado.organizacion : null;
  });

  protected readonly mensajeError = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.mensaje : null;
  });

  /** `true` cuando el error concreto es que falta elegir contexto: la salida es el selector. */
  protected readonly faltaContexto = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' && estado.faltaContexto;
  });

  constructor() {
    effect(() => {
      // Dependencia explicita: cualquier cambio de contexto invalida lo que hay en pantalla.
      this.tenantContext.contextEpoch();
      untracked(() => this.cargar());
    });
  }

  protected cargar(): void {
    const orgId = this.tenantContext.organizationId();
    if (orgId === null) {
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }

    this.estado.set({ tipo: 'cargando' });

    this.organizaciones
      .getOrganization({ orgId })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        this.estado.set(
          respuesta instanceof Error
            ? aEstadoDeError(respuesta)
            : { tipo: 'listo', organizacion: respuesta },
        );
      });
  }
}

/** Traduce el error del interceptor al estado de la pantalla. */
function aEstadoDeError(error: Error): EstadoOrganizacion {
  if (!(error instanceof AkineHttpError)) {
    return {
      tipo: 'error',
      mensaje: 'Error inesperado al pedir los datos de la organizacion.',
      esDeRed: false,
      faltaContexto: false,
    };
  }

  if (error.esDeRed) {
    return {
      tipo: 'error',
      mensaje: 'No se pudo contactar al servidor.',
      esDeRed: true,
      faltaContexto: false,
    };
  }

  if (error.faltaContexto) {
    return {
      tipo: 'error',
      mensaje: 'Todavia no elegiste un contexto de trabajo.',
      esDeRed: false,
      faltaContexto: true,
    };
  }

  if (error.status === 404) {
    // El backend responde 404 igual para "no existe", "dada de baja" y "de otro tenant":
    // distinguirlos permitiria enumerar los clientes del SaaS probando ids.
    return {
      tipo: 'error',
      mensaje: 'No encontramos esta organizacion o ya no tenes acceso a ella.',
      esDeRed: false,
      faltaContexto: false,
    };
  }

  // Para el resto se muestra el `detail` del backend, no un texto generico nuestro: el
  // backend ya lo escribio para que el usuario lo lea (ADR-0005).
  return { tipo: 'error', mensaje: error.message, esDeRed: false, faltaContexto: false };
}
