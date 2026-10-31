import { DestroyRef, Injectable, Signal, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject, catchError, filter, map, of, switchMap, take } from 'rxjs';

import { OrganizacionesService } from '../../api/generated/api/organizaciones.service';
import { TenantContextStore } from './tenant-context.store';

/** Tope del backend por pagina de sedes. Una organizacion con mas cae a la zona del tenant. */
const SEDES_POR_PAGINA = 100;

/**
 * Hoy, en fecha local del NAVEGADOR. Es el ultimo recurso, cuando no hay zona que aplicar.
 *
 * <p>Entre las 21:00 y las 24:00 de Cordoba un navegador en UTC —o en cualquier zona
 * adelantada— ya esta en el dia siguiente al de la sede. Por eso ninguna pantalla deberia usar
 * esto directo: el dia de negocio sale de {@link DiaDeLaSede}.
 */
export function hoyDelNavegador(ahora: Date = new Date()): string {
  const local = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * Hoy, en la zona IANA dada. Con una zona vacia o que el navegador no conoce cae al dia del
 * navegador, que es lo mejor que se puede hacer sin dato.
 */
export function hoyEnZona(timezone: string, ahora: Date = new Date()): string {
  if (timezone === '') {
    return hoyDelNavegador(ahora);
  }
  try {
    // `en-CA` formatea `YYYY-MM-DD`, que es exactamente la fecha de calendario que viaja.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(ahora);
  } catch {
    return hoyDelNavegador(ahora);
  }
}

/**
 * El "hoy" de negocio: el dia de calendario en la zona de la sede del contexto activo.
 *
 * <p><b>Por que existe.</b> Las fechas por defecto de vigencias, filtros de periodo y formularios
 * se tomaban del navegador. Entre las 21:00 y las 24:00 de Argentina un navegador en UTC ya esta
 * en el dia siguiente: un arancel se consultaba para manana, un plan nacia vigente desde manana y
 * el reporte del mes cerraba un dia despues. El PR #43 lo corrigio en la agenda con la zona que
 * traen sus respuestas; el resto de las pantallas no recibe la zona en ninguna respuesta, asi que
 * se resuelve una vez por contexto, aca.
 *
 * <p><b>De donde sale la zona.</b> De la sede del contexto (`ConsultorioResponse.timezone`, que ya
 * es la efectiva) y, si no hay sede o no aparece, de la organizacion. Se lee del listado de sedes
 * y no de `getConsultorio` porque este exige `consultorio:manage` y el listado solo ser miembro.
 *
 * <p><b>No bloquea la navegacion.</b> `contextGuard` dispara {@link cargar} y deja pasar en el
 * acto: esperar la zona sumaria un round-trip en serie antes de la primera pintura. Mientras no
 * llega, {@link hoy} devuelve el dia del navegador, que coincide con el de la sede salvo de noche.
 * Las pantallas que proponen una fecha por defecto al construirse la registran con
 * {@link alinear}: si al resolver la zona el dia de la sede es otro y nadie toco el valor, se
 * corrige. {@link hoy} lee un signal, asi que un `computed` o una plantilla que lo use se
 * actualiza solo. Un error deja la zona vacia, que es lo que habia antes.
 *
 * <p><b>Se invalida por epoca de contexto</b>, igual que los demas caches: la zona de la
 * organizacion A no vale bajo la B.
 */
@Injectable({ providedIn: 'root' })
export class DiaDeLaSede {
  private readonly organizaciones = inject(OrganizacionesService);
  private readonly tenant = inject(TenantContextStore);

  private readonly cache = signal<{ readonly epoca: number; readonly zona: string } | null>(null);

  /** Epoca cuya carga esta en vuelo: el guard corre en cada navegacion y no hay que repetirla. */
  private enVuelo: number | null = null;

  /** Emite la epoca cada vez que su zona queda resuelta (con dato o sin el). */
  private readonly resueltas = new Subject<number>();

  private readonly vigente = computed(() => {
    const cache = this.cache();
    return cache !== null && cache.epoca === this.tenant.contextEpoch() ? cache : null;
  });

  /** Zona IANA de la sede activa, o vacio mientras no se conozca. */
  readonly zona: Signal<string> = computed(() => this.vigente()?.zona ?? '');

  /** `true` cuando la carga termino, con dato o sin el: desde ahi {@link zona} no va a cambiar. */
  readonly resuelta: Signal<boolean> = computed(() => this.vigente() !== null);

  /** Hoy en la zona de la sede, `YYYY-MM-DD`. Sin zona conocida, el dia del navegador. */
  hoy(ahora: Date = new Date()): string {
    return hoyEnZona(this.zona(), ahora);
  }

  /**
   * Corrige un default tomado antes de que la zona resolviera.
   *
   * <p>Cuando la zona del contexto actual llega, si el dia de la sede difiere del del navegador y
   * `leer()` sigue devolviendo lo mismo que al registrarse —nadie lo toco—, llama a
   * `aplicar(hoyDeLaSede)` una sola vez. Con la zona ya resuelta no hace nada: el default ya
   * salio de ella. Muere con `destroyRef`, que fuera de un contexto de inyeccion hay que pasar.
   */
  alinear(
    leer: () => string,
    aplicar: (hoy: string) => void,
    destroyRef: DestroyRef = inject(DestroyRef),
  ): void {
    if (this.vigente() !== null) {
      return;
    }
    const epoca = this.tenant.contextEpoch();
    const previo = leer();
    this.resueltas
      .pipe(
        filter((resuelta) => resuelta === epoca),
        take(1),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe(() => {
        if (this.tenant.contextEpoch() !== epoca || leer() !== previo) {
          return;
        }
        const deLaSede = this.hoy();
        if (deLaSede !== hoyDelNavegador()) {
          aplicar(deLaSede);
        }
      });
  }

  /** Dispara la carga de la zona del contexto activo si falta. No espera ni falla. */
  cargar(): void {
    const orgId = this.tenant.organizationId();
    const epoca = this.tenant.contextEpoch();
    if (this.vigente() !== null || orgId === null || this.enVuelo === epoca) {
      return;
    }
    this.enVuelo = epoca;
    const consultorioId = this.tenant.consultorioId();

    const deLaSede: Observable<string> =
      consultorioId === null
        ? of('')
        : this.organizaciones
            .listOrganizationConsultorios({
              orgId,
              estado: 'TODOS',
              page: 0,
              size: SEDES_POR_PAGINA,
            })
            .pipe(
              map(
                (pagina) =>
                  (pagina.content ?? []).find((sede) => sede.id === consultorioId)?.timezone ?? '',
              ),
              catchError(() => of('')),
            );

    deLaSede
      .pipe(
        switchMap((zona) =>
          zona !== ''
            ? of(zona)
            : this.organizaciones.getOrganization({ orgId }).pipe(
                map((organizacion) => organizacion.timezone ?? ''),
                catchError(() => of('')),
              ),
        ),
      )
      .subscribe((zona) => {
        if (this.enVuelo === epoca) {
          this.enVuelo = null;
        }
        // Una respuesta que llega despues de un cambio de contexto es del contexto anterior.
        if (this.tenant.contextEpoch() === epoca) {
          this.cache.set({ epoca, zona });
          this.resueltas.next(epoca);
        }
      });
  }
}
