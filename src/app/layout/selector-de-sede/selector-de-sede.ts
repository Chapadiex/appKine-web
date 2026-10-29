import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';

import { AkineHttpError } from '../../core/interceptors/error.interceptor';
import { AuthorizedContextResponse } from '../../api/generated/model/authorized-context-response';
import { CambioDeSede } from './cambio-de-sede';
import { Desplegable } from '../desplegable';
import { Icono } from '../../shared/components/icono/icono';
import { SessionService } from '../../core/services/session.service';
import { TenantContextStore } from '../../core/services/tenant-context.store';

/** Desde cuantas sedes el panel lleva buscador. Con menos, la lista entera se lee de un vistazo. */
export const SEDES_PARA_BUSCAR = 6;

/**
 * Selector de la sede activa, en la barra superior antes del perfil (refactor de la cabecera
 * global, 28/10/2026). Es el UNICO lugar donde se cambia de sede: el "Cambiar" de la cabecera y
 * el "Cambiar de sede" del pie de la barra lateral se fueron.
 *
 * <p><b>Siempre dice donde se esta trabajando.</b> Con una sola sede habilitada es un indicador
 * sin accion: ofrecer un cambio que no lleva a ningun lado es ruido. Con varias, un boton que
 * despliega la lista con la actual primero y tildada; desde {@link SEDES_PARA_BUSCAR}, con
 * buscador. Si la cuenta trabaja en mas de una organizacion, cada sede dice de cual es.
 *
 * <p>Las sedes son los contextos autorizados de la cuenta (`/me/contexts`): el backend ya filtra
 * las que no puede usar. El cambio lo hace {@link CambioDeSede}.
 */
@Component({
  selector: 'app-selector-de-sede',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icono],
  templateUrl: './selector-de-sede.html',
  styleUrls: ['../desplegable.css', './selector-de-sede.css'],
})
export class SelectorDeSede extends Desplegable {
  private readonly session = inject(SessionService);
  private readonly tenant = inject(TenantContextStore);
  private readonly cambio = inject(CambioDeSede);

  protected readonly busqueda = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly cambiandoA = this.cambio.cambiandoA;

  protected readonly nombreActivo = computed(() => {
    const activo = this.tenant.context();
    return activo?.consultorioName || activo?.organizationName || '';
  });

  /** "Organizacion · Sede", para el `title` del control: el nombre visible puede venir cortado. */
  protected readonly descripcionActiva = computed(() => {
    const activo = this.tenant.context();
    if (activo === null) {
      return '';
    }
    return activo.consultorioName && activo.consultorioName !== activo.organizationName
      ? `${activo.organizationName} · ${activo.consultorioName}`
      : activo.organizationName;
  });

  private readonly sedes = computed(() =>
    this.session
      .contextos()
      .filter((sede) => sede.organizationId !== undefined && sede.consultorioId !== undefined),
  );

  protected readonly cambiable = computed(() => this.sedes().length > 1);
  protected readonly conBuscador = computed(() => this.sedes().length >= SEDES_PARA_BUSCAR);
  protected readonly variasOrganizaciones = computed(
    () => new Set(this.sedes().map((sede) => sede.organizationId)).size > 1,
  );

  /** Las que coinciden con la busqueda, con la actual primero. */
  protected readonly opciones = computed(() => {
    const texto = normalizar(this.busqueda());
    return this.sedes()
      .filter(
        (sede) =>
          texto === '' ||
          normalizar(`${sede.consultorioName ?? ''} ${sede.organizationName ?? ''}`).includes(
            texto,
          ),
      )
      .sort((a, b) => Number(this.esActual(b)) - Number(this.esActual(a)));
  });

  /** Identidad para la que ya se pidieron los contextos: se piden una vez por cuenta. */
  private pedidosPara: number | null = null;

  constructor() {
    super();
    // Al volver de una recarga los contextos ya llegaron con la restauracion; al entrar por el
    // selector, tambien. Este pedido cubre el caso que queda: la lista vacia con sesion activa.
    effect(() => {
      const identidad = this.session.epocaDeIdentidad();
      if (
        this.session.estado() !== 'activa' ||
        this.session.contextos().length > 0 ||
        this.pedidosPara === identidad
      ) {
        return;
      }
      this.pedidosPara = identidad;
      untracked(() => this.session.cargarContextos().subscribe({ error: () => undefined }));
    });
  }

  protected esActual(sede: AuthorizedContextResponse): boolean {
    return (
      sede.organizationId === this.tenant.organizationId() &&
      sede.consultorioId === this.tenant.consultorioId()
    );
  }

  protected override alternar(): void {
    this.busqueda.set('');
    this.error.set(null);
    super.alternar();
  }

  protected alBuscar(evento: Event): void {
    this.busqueda.set((evento.target as HTMLInputElement).value);
  }

  protected elegir(sede: AuthorizedContextResponse): void {
    if (this.esActual(sede)) {
      this.cerrar(true);
      return;
    }
    this.error.set(null);
    this.cambio.cambiar(sede).subscribe({
      next: () => this.cerrar(true),
      error: (error: unknown) => {
        // Un par que ya no es accesible responde 404, nunca 403: la lista que se estaba mirando
        // quedo vieja y se vuelve a pedir.
        if (error instanceof AkineHttpError && !error.esDeRed && error.status === 404) {
          this.error.set('Esa sede ya no está habilitada para tu cuenta.');
          this.session.cargarContextos().subscribe({ error: () => undefined });
          return;
        }
        this.error.set('No pudimos cambiar de sede. Probá de nuevo en unos segundos.');
      },
    });
  }
}

/** Minusculas y sin tildes: "cordoba" encuentra "Córdoba". */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
