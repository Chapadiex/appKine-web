import { ContratacionStore } from '../../../../core/services/contratacion.store';
import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable, catchError, map, of, switchMap } from 'rxjs';

import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { LimitUsageResponse } from '../../../../api/generated/model/limit-usage-response';
import { LimitUsageResponseCodeEnum } from '../../../../api/generated/model/limit-usage-response';
import { SubscriptionResponse } from '../../../../api/generated/model/subscription-response';
import { SubscriptionResponseStatusEnum } from '../../../../api/generated/model/subscription-response';
import { SubscriptionTransitionResponse } from '../../../../api/generated/model/subscription-transition-response';
import { SuscripcionesService } from '../../../../api/generated/api/suscripciones.service';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { TerminosPendientesStore } from '../../../../core/services/terminos-pendientes.store';
import { PlanesService } from '../../../../api/generated/api/planes.service';
import { PlanResponse } from '../../../../api/generated/model/plan-response';

import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Icono, NombreDeIcono } from '../../../../shared/components/icono/icono';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { Pestanas } from '../../../../shared/components/pestanas/pestanas';
import {
  ETIQUETA_PESTANAS_DE_ORGANIZACION,
  pestanasDeOrganizacion,
} from '../../../../core/models/pestanas-de-organizacion';
import { PermissionsStore } from '../../../../core/services/permissions.store';

/** Una linea de "Que incluye tu plan": esta o no esta (21/11/2026). */
interface ItemDelPlan {
  readonly texto: string;
  readonly incluido: boolean;
  readonly icono: NombreDeIcono;
}

/**
 * Suscripcion lista para pintar: la respuesta del backend mas el motivo de la suspension.
 *
 * El motivo <b>no viaja en `SubscriptionResponse`</b>: el contrato 0.2.0 solo lo publica en
 * `SubscriptionTransitionResponse`, es decir en el historico. Por eso hace falta una segunda
 * llamada, y por eso `motivo` puede ser `null` aun estando SUSPENDIDA.
 */
interface SuscripcionEnPantalla {
  readonly suscripcion: SubscriptionResponse;
  readonly motivo: string | null;
}

/** Estado de la pantalla de suscripcion (ADR-0005). */
type EstadoSuscripcion =
  | { readonly tipo: 'sin-contexto' }
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly datos: SuscripcionEnPantalla }
  | {
      readonly tipo: 'error';
      readonly mensaje: string;
      readonly esDeRed: boolean;
      readonly faltaContexto: boolean;
    };

/** Etiquetas legibles de los codigos de limite. Los codigos tecnicos no se muestran crudos. */
const NOMBRE_DEL_LIMITE: Readonly<Record<string, string>> = {
  [LimitUsageResponseCodeEnum.MAX_CONSULTORIOS]: 'Sedes habilitadas',
  [LimitUsageResponseCodeEnum.MAX_MIEMBROS_ACTIVOS]: 'Miembros activos',
  [LimitUsageResponseCodeEnum.MAX_PROFESIONALES]: 'Profesionales',
};

/** Cuantos hechos del historico se miran buscando la suspension mas reciente. */
const HECHOS_A_REVISAR = 20;

/**
 * Plan contratado, estado de la suscripcion y consumo de limites (M01, AKINE-01.01).
 *
 * <p>El banner por estado no replica la maquina de estados del backend: solo describe el
 * estado que el backend informa. Las acciones disponibles, cuando existan, salen de
 * `allowedTargets`, que el contrato publica justamente para que el frontend no ofrezca
 * botones que van a fallar.
 *
 * <p><b>PENDIENTE(01.02).</b> Igual que el resto de la feature, este endpoint exige un token
 * con contexto y ademas administrar la organizacion. Sin login <b>no se pudo ejercitar</b>:
 * lo verificado son los estados con el backend simulado.
 */
@Component({
  selector: 'app-subscription-page',
  imports: [CabeceraDePagina, Pestanas, Ayuda, DatePipe, RouterLink, Alerta, Icono],
  templateUrl: './subscription-page.html',
  styleUrl: '../../organization.css',
})
export class SubscriptionPage {
  /** Datos del centro, suscripcion, auditoria y politica de enmienda, como hermanas (08/11/2026). */
  protected readonly pestanasDeOrganizacion = pestanasDeOrganizacion(inject(PermissionsStore));
  protected readonly etiquetaDePestanasDeOrganizacion = ETIQUETA_PESTANAS_DE_ORGANIZACION;

  private readonly suscripciones = inject(SuscripcionesService);
  /** Dias de prueba y vencimiento (18/11/2026). */
  protected readonly contratacion = inject(ContratacionStore);
  private readonly tenantContext = inject(TenantContextStore);

  /**
   * Terminos y condiciones de la cuenta (21/11/2026): version aceptada, cuando y enlace para
   * releerlos. Si la lectura falla, la tarjeta no se muestra.
   */
  private readonly terminosStore = inject(TerminosPendientesStore);
  private readonly planes = inject(PlanesService);
  protected readonly terminos = this.terminosStore.terminos;

  protected readonly estado = signal<EstadoSuscripcion>({ tipo: 'cargando' });

  /** Suscripcion cargada, o `null` en cualquier otro estado (ADR-0005: sin `$any`). */
  protected readonly suscripcion = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'listo' ? estado.datos.suscripcion : null;
  });

  /** Motivo declarado de la suspension, o `null` si no aplica o si no se pudo recuperar. */
  protected readonly motivo = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'listo' ? estado.datos.motivo : null;
  });

  /** Catalogo de planes (21/11/2026): de ahi salen las funciones del plan actual. */
  private readonly catalogo = signal<readonly PlanResponse[]>([]);

  /**
   * Que incluye el plan del centro, para leerlo de un vistazo: servicios y adicional de IA de la
   * contratacion, funciones del catalogo y topes de la suscripcion. Cada item dice si esta o no.
   */
  protected readonly incluye = computed<readonly ItemDelPlan[]>(() => {
    const suscripcion = this.suscripcion();
    if (suscripcion === null) {
      return [];
    }
    const contratacion = this.contratacion.contratacion();
    const servicios = (contratacion?.servicios ?? []) as readonly string[];
    const plan = this.catalogo().find((p) => p.code === suscripcion.planCode);
    const funciones = (plan?.features ?? []) as readonly string[];
    const tope = (codigo: string, singular: string, plural: string): string => {
      const limite = suscripcion.limits?.find((l) => l.code === codigo);
      if (!limite) {
        return '';
      }
      if (limite.limitValue === undefined) {
        return `${plural[0].toUpperCase()}${plural.slice(1)} sin límite`;
      }
      return limite.limitValue === 1
        ? `Hasta 1 ${singular}`
        : `Hasta ${limite.limitValue} ${plural}`;
    };
    const items: ItemDelPlan[] = [];
    const sedes = tope('MAX_CONSULTORIOS', 'sede', 'sedes');
    if (sedes) {
      items.push({ texto: sedes, incluido: true, icono: 'sede' });
    }
    const profesionales = tope('MAX_PROFESIONALES', 'profesional', 'profesionales');
    if (profesionales) {
      items.push({ texto: profesionales, incluido: true, icono: 'perfil' });
    }
    if (contratacion) {
      items.push(
        {
          texto: 'Kinesiología y rehabilitación',
          incluido: servicios.includes('KINESIOLOGIA'),
          icono: 'pacientes',
        },
        {
          texto: 'Actividades y clases',
          incluido: servicios.includes('ACTIVIDADES'),
          icono: 'actividades',
        },
        {
          texto: 'Inteligencia artificial',
          incluido: ((contratacion.adicionales ?? []) as readonly string[]).includes('IA'),
          icono: 'capas',
        },
      );
    }
    if (plan) {
      items.push(
        {
          texto: 'Reportes avanzados',
          incluido: funciones.includes('REPORTES_AVANZADOS'),
          icono: 'economia',
        },
        {
          texto: 'Avisos a pacientes',
          incluido: funciones.includes('NOTIFICACIONES_PACIENTE'),
          icono: 'correo',
        },
      );
    }
    return items;
  });

  /** Limites del plan con su consumo. Lista vacia mientras no haya suscripcion cargada. */
  protected readonly limites = computed<readonly LimitUsageResponse[]>(
    () => this.suscripcion()?.limits ?? [],
  );

  protected readonly mensajeError = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.mensaje : null;
  });

  protected readonly faltaContexto = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' && estado.faltaContexto;
  });

  /** Estados posibles del banner. Se expone como literal para que la plantilla ramifique. */
  protected readonly estadoSuscripcion = computed<SubscriptionResponseStatusEnum | null>(
    () => this.suscripcion()?.status ?? null,
  );

  /** La marca de estado que va junto al titulo de "Estado y plan" (21/11/2026). */
  protected readonly marcaDeEstado = computed<{ texto: string; tono: string } | null>(() => {
    const estado = this.estadoSuscripcion();
    const vencida = this.contratacion.pruebaVencida();
    switch (estado) {
      case 'ACTIVA':
        return { texto: 'Activa', tono: 'activa' };
      case 'PRUEBA':
        return vencida
          ? { texto: 'Prueba vencida', tono: 'suspendida' }
          : { texto: 'En prueba', tono: 'activa' };
      case 'SUSPENDIDA':
        return { texto: 'Suspendida', tono: 'suspendida' };
      case 'CANCELADA':
        return { texto: 'Cancelada', tono: 'revocada' };
      default:
        return null;
    }
  });

  constructor() {
    effect(() => {
      // Igual que la pantalla de organizacion: el epoch invalida lo que hay en pantalla.
      this.tenantContext.contextEpoch();
      untracked(() => this.cargar());
    });
    // Si el catalogo no se puede leer, la lista muestra lo que sale de la contratacion.
    this.planes.listPlans().subscribe({
      next: (planes) => this.catalogo.set(planes),
      error: () => undefined,
    });
    if (this.terminosStore.terminos() === null) {
      this.terminosStore.cargar().subscribe({ error: () => undefined });
    }
  }

  protected cargar(): void {
    const orgId = this.tenantContext.organizationId();
    if (orgId === null) {
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }

    this.estado.set({ tipo: 'cargando' });

    this.suscripciones
      .getSubscription({ orgId })
      .pipe(
        switchMap((suscripcion) => this.conMotivo(orgId, suscripcion)),
        catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))),
      )
      .subscribe((respuesta) => {
        this.estado.set(
          respuesta instanceof Error
            ? aEstadoDeError(respuesta)
            : { tipo: 'listo', datos: respuesta },
        );
      });
  }

  /** Etiqueta legible del limite; cae al codigo crudo si el backend agrega uno nuevo. */
  protected nombreDelLimite(limite: LimitUsageResponse): string {
    const codigo = limite.code ?? '';
    return NOMBRE_DEL_LIMITE[codigo] ?? codigo;
  }

  /** Tope del plan como texto: ausente significa ilimitado, no cero. */
  protected topeDelLimite(limite: LimitUsageResponse): string {
    return limite.limitValue === undefined ? 'Sin tope' : String(limite.limitValue);
  }

  /** Uso sobre el tope, de 0 a 100, para la barra. 0 si el limite es ilimitado: no hay barra. */
  protected porcentajeDeUso(limite: LimitUsageResponse): number {
    const tope = limite.limitValue;
    if (tope === undefined || tope <= 0) {
      return 0;
    }
    return Math.min(100, Math.round(((limite.currentUsage ?? 0) / tope) * 100));
  }

  /**
   * Completa la suscripcion con el motivo de la suspension cuando corresponde.
   *
   * Si el historico falla se sigue adelante con `motivo: null`: quedarse sin pintar la
   * suscripcion entera porque no se pudo recuperar una frase seria desproporcionado.
   */
  private conMotivo(
    orgId: number,
    suscripcion: SubscriptionResponse,
  ): Observable<SuscripcionEnPantalla> {
    if (suscripcion.status !== SubscriptionResponseStatusEnum.SUSPENDIDA) {
      return of({ suscripcion, motivo: null });
    }

    return this.suscripciones.listSubscriptionTransitions({ orgId, size: HECHOS_A_REVISAR }).pipe(
      map((pagina) => ({ suscripcion, motivo: motivoDeLaSuspension(pagina.content ?? []) })),
      catchError(() => of({ suscripcion, motivo: null })),
    );
  }
}

/**
 * Motivo de la suspension mas reciente, o `null`.
 *
 * El historico llega del hecho mas nuevo al mas viejo, asi que el primer hecho que llevo a
 * SUSPENDIDA es el vigente.
 */
function motivoDeLaSuspension(hechos: readonly SubscriptionTransitionResponse[]): string | null {
  const hecho = hechos.find((candidato) => candidato.toStatus === 'SUSPENDIDA');
  return hecho?.reason ?? null;
}

/** Traduce el error del interceptor al estado de la pantalla. */
function aEstadoDeError(error: Error): EstadoSuscripcion {
  if (!(error instanceof AkineHttpError)) {
    return {
      tipo: 'error',
      mensaje: 'Error inesperado al pedir la suscripción.',
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
      mensaje: 'Todavía no elegiste un contexto de trabajo.',
      esDeRed: false,
      faltaContexto: true,
    };
  }

  if (error.status === 403) {
    return {
      tipo: 'error',
      mensaje: 'Tu cuenta no administra este centro, así que no podés ver su suscripción.',
      esDeRed: false,
      faltaContexto: false,
    };
  }

  if (error.status === 404) {
    return {
      tipo: 'error',
      mensaje: 'No encontramos esta organización o ya no tenés acceso a ella.',
      esDeRed: false,
      faltaContexto: false,
    };
  }

  return { tipo: 'error', mensaje: error.message, esDeRed: false, faltaContexto: false };
}
