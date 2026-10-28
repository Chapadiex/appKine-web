import { computed, inject, signal } from '@angular/core';

import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { RegistroYActivacionService } from '../../../api/generated/api/registro-y-activacion.service';
import { TermsResponse } from '../../../api/generated/model/terms-response';

/** Lectura de `GET /api/v1/terms`. */
export type EstadoTerminos =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'error' }
  | { readonly tipo: 'listo'; readonly terminos: TermsResponse };

/** Campos de la aceptacion, tal como los piden `RegisterAccountRequest` y `AcceptInvitacionRequest`. */
export interface AceptacionDeTerminos {
  readonly aceptaTerminos?: boolean;
  readonly versionTerminos?: string;
}

/**
 * Los terminos que un alta tiene que aceptar (DP-45), y si se aceptaron.
 *
 * <p><b>Quien decide si se exigen es el backend.</b> `GET /api/v1/terms` dice
 * `aceptacionObligatoria` y la `versionVigente`; sin version configurada el alta no exige nada y
 * los dos campos se ignoran, como antes de DP-45. Con version, el alta (registro o invitacion con
 * cuenta nueva) responde `400 validation-error` si no viaja `aceptaTerminos = true` con esa
 * version exacta.
 *
 * <p><b>Si `/terms` falla, el alta no se envia.</b> No hay forma de saber si el despliegue exige
 * terminos: mandar sin ellos termina en un 400 si los exige, y en ese caso ademas no hay version
 * que aceptar. La pantalla lo dice y ofrece reintentar. Lo mismo si el backend dijera
 * "obligatoria" sin version: no hay nada que se pueda aceptar.
 *
 * <p>Se crea en el contexto de inyeccion del componente, como {@link crearEsperaPorLimite}.
 */
export class TerminosVigentes {
  private readonly lectura = signal<EstadoTerminos>({ tipo: 'cargando' });

  readonly estado = this.lectura.asReadonly();

  /** La casilla "Acepto". La escribe {@link TerminosDelAlta}. */
  readonly aceptados = signal(false);

  /** La version que hay que aceptar, o `null` si el despliegue no exige terminos. */
  readonly versionExigida = computed(() => {
    const estado = this.lectura();
    return estado.tipo === 'listo' && estado.terminos.aceptacionObligatoria
      ? (estado.terminos.versionVigente ?? null)
      : null;
  });

  /** `true` si el alta no puede salir: se estan leyendo los terminos o no se pudieron leer. */
  readonly impidenElAlta = computed(() => this.lectura().tipo !== 'listo');

  /** `true` si se exigen y la casilla no esta marcada. */
  readonly faltaAceptar = computed(() => this.versionExigida() !== null && !this.aceptados());

  constructor(private readonly registro: RegistroYActivacionService) {}

  /** Lee (o relee) los terminos vigentes. Desmarca la casilla: lo aceptado era otra version. */
  cargar(): void {
    this.lectura.set({ tipo: 'cargando' });
    this.aceptados.set(false);
    this.registro.getCurrentTerms().subscribe({
      next: (terminos) =>
        this.lectura.set(
          terminos.aceptacionObligatoria && !terminos.versionVigente
            ? { tipo: 'error' }
            : { tipo: 'listo', terminos },
        ),
      error: () => this.lectura.set({ tipo: 'error' }),
    });
  }

  /** Los campos para el cuerpo del alta. Vacio si no se exigen: el backend los ignoraria. */
  campos(): AceptacionDeTerminos {
    const version = this.versionExigida();
    return version === null ? {} : { aceptaTerminos: true, versionTerminos: version };
  }
}

/** Crea los terminos de un alta y empieza a leerlos. Llamar en el contexto de inyeccion. */
export function leerTerminosVigentes(): TerminosVigentes {
  const terminos = new TerminosVigentes(inject(RegistroYActivacionService));
  terminos.cargar();
  return terminos;
}

/**
 * `true` si el alta se rechazo por los terminos: no se aceptaron, o la version cambio despues de
 * leerla (el backend nombra el campo en `errors`). La salida es releerlos y volver a aceptar.
 */
export function esRechazoDeTerminos(error: unknown): boolean {
  if (!(error instanceof AkineHttpError) || error.status !== 400) {
    return false;
  }
  const campos = error.erroresPorCampo;
  return 'aceptaTerminos' in campos || 'versionTerminos' in campos;
}

/** Mensaje del rechazo por terminos. */
export const MENSAJE_TERMINOS_CAMBIARON =
  'Los términos y condiciones vigentes cambiaron. Leelos y aceptalos de nuevo para continuar.';
