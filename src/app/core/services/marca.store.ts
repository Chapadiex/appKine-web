import { DOCUMENT } from '@angular/common';
import { Injectable, Signal, computed, effect, inject, signal, untracked } from '@angular/core';

import { MarcaDeLaOrganizacionService } from '../../api/generated/api/marca-de-la-organizacion.service';
import { MarcaResponse } from '../../api/generated/model/marca-response';
import { ColoresDeTema, TemaDeMarca, tokensDeMarca } from '../models/color-de-marca';
import { PreferenciasStore } from './preferencias.store';
import { SessionService } from './session.service';
import { TenantContextStore } from './tenant-context.store';

/**
 * Marca del centro activo: sus colores institucionales pintados sobre los tokens del sistema, su
 * logo y sus datos de contacto.
 *
 * <p><b>Los colores se aplican con una hoja de estilos construida</b> (`adoptedStyleSheets`), no
 * con un `<style>`: la CSP de produccion exige nonce para los estilos en linea y el CSSOM no pasa
 * por ella. La hoja repite los tres selectores con que `design-system.css` define los temas, asi
 * que el color claro del centro nunca pisa los tokens oscuros por defecto (gana por
 * especificidad el tema, y por orden la marca).
 *
 * <p><b>Cambia con el contexto.</b> Al cambiar de organizacion o cerrar sesion la marca anterior
 * se quita antes de pedir la nueva: los colores de un centro no se ven ni un instante bajo otro.
 * Si la lectura falla, queda la marca de AKINE; no es un error que la persona tenga que atender.
 */
@Injectable({ providedIn: 'root' })
export class MarcaStore {
  private readonly api = inject(MarcaDeLaOrganizacionService);
  private readonly tenant = inject(TenantContextStore);
  private readonly session = inject(SessionService);
  private readonly preferencias = inject(PreferenciasStore);
  private readonly documento = inject(DOCUMENT);

  private readonly actual = signal<MarcaResponse | null>(null);
  private readonly logos = signal<Readonly<Record<TemaDeMarca, string | null>>>({
    claro: null,
    oscuro: null,
  });
  private readonly sistemaOscuro = signal(false);

  /** Huella de cada logo ya descargado: con la misma no se vuelve a pedir. */
  private huellas: Record<TemaDeMarca, string | null> = { claro: null, oscuro: null };
  private hoja: CSSStyleSheet | null = null;

  /** La marca del centro activo, o `null` mientras no se sabe o no hay contexto. */
  readonly marca: Signal<MarcaResponse | null> = this.actual.asReadonly();

  /** El tema que la persona esta viendo, resuelto "sistema" contra el sistema operativo. */
  readonly temaEfectivo: Signal<TemaDeMarca> = computed(() => {
    const elegido = this.preferencias.tema();
    return elegido === 'sistema' ? (this.sistemaOscuro() ? 'oscuro' : 'claro') : elegido;
  });

  /** URL de cada logo cargado (un `blob:` local), para la pantalla de edicion. */
  readonly logosPorTema = this.logos.asReadonly();

  /** El logo que corresponde al tema en uso: en oscuro, el oscuro o si no el claro. */
  readonly logoUrl: Signal<string | null> = computed(() => {
    const logos = this.logos();
    return this.temaEfectivo() === 'oscuro' ? (logos.oscuro ?? logos.claro) : logos.claro;
  });

  constructor() {
    const consulta = this.documento.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
    if (consulta) {
      this.sistemaOscuro.set(consulta.matches);
      consulta.addEventListener?.('change', (evento) => this.sistemaOscuro.set(evento.matches));
    }

    effect(() => {
      // Cualquier cambio de contexto o de sesion invalida la marca en pantalla.
      this.tenant.contextEpoch();
      this.session.estado();
      untracked(() => this.recargar());
    });
  }

  /** Vuelve a leer la marca del centro activo. */
  recargar(): void {
    const orgId = this.tenant.organizationId();
    this.adoptar(null);
    if (orgId === null || this.session.estado() !== 'activa') {
      return;
    }
    this.api.getMarcaDeOrganizacion({ orgId }).subscribe({
      next: (marca) => {
        if (this.tenant.organizationId() === orgId) {
          this.adoptar(marca);
        }
      },
      // Sin marca se ve la de AKINE: nada que mostrarle a la persona.
      error: () => undefined,
    });
  }

  /** Pone en uso una marca ya leida o recien guardada; `null` vuelve a la de AKINE. */
  adoptar(marca: MarcaResponse | null): void {
    this.actual.set(marca);
    this.pintar(coloresGuardados(marca));
    this.sincronizarLogo('claro', marca?.logoClaro?.sha256 ?? null);
    this.sincronizarLogo('oscuro', marca?.logoOscuro?.sha256 ?? null);
  }

  /**
   * Pinta colores todavia sin guardar sobre toda la aplicacion, para verlos mientras se editan.
   * Solo en este navegador: el resto del centro los ve recien al guardar. `null` vuelve a los
   * guardados.
   */
  previsualizar(colores: Readonly<Record<TemaDeMarca, ColoresDeTema>> | null): void {
    this.pintar(colores ?? coloresGuardados(this.actual()));
  }

  private pintar(colores: Readonly<Record<TemaDeMarca, ColoresDeTema>>): void {
    const claro = declaraciones(tokensDeMarca(colores.claro, 'claro'));
    const oscuro = declaraciones(tokensDeMarca(colores.oscuro, 'oscuro'));
    const css =
      `:root{${claro}}` +
      `@media (prefers-color-scheme: dark){:root:not([data-tema='claro']){${oscuro}}}` +
      `:root[data-tema='oscuro']{${oscuro}}`;
    try {
      if (this.hoja === null) {
        const Hoja = this.documento.defaultView?.CSSStyleSheet;
        if (!Hoja) {
          return;
        }
        this.hoja = new Hoja();
        this.documento.adoptedStyleSheets = [...this.documento.adoptedStyleSheets, this.hoja];
      }
      this.hoja.replaceSync(css);
    } catch {
      // Un navegador sin hojas construidas se queda con los colores de AKINE.
    }
  }

  private sincronizarLogo(tema: TemaDeMarca, huella: string | null): void {
    if (this.huellas[tema] === huella) {
      return;
    }
    this.huellas[tema] = huella;
    this.ponerLogo(tema, null);
    const orgId = this.tenant.organizationId();
    if (huella === null || orgId === null) {
      return;
    }
    this.api
      .descargarLogoDeOrganizacion({ orgId, variante: tema === 'claro' ? 'CLARO' : 'OSCURO' })
      .subscribe({
        next: (imagen) => {
          if (this.huellas[tema] === huella && this.tenant.organizationId() === orgId) {
            this.ponerLogo(tema, URL.createObjectURL(imagen));
          }
        },
        error: () => undefined,
      });
  }

  private ponerLogo(tema: TemaDeMarca, url: string | null): void {
    const anterior = this.logos()[tema];
    if (anterior !== null) {
      URL.revokeObjectURL(anterior);
    }
    this.logos.update((logos) => ({ ...logos, [tema]: url }));
  }
}

function coloresGuardados(marca: MarcaResponse | null): Record<TemaDeMarca, ColoresDeTema> {
  return {
    claro: {
      principal: marca?.colorPrincipalClaro ?? null,
      acento: marca?.colorAcentoClaro ?? null,
    },
    oscuro: {
      principal: marca?.colorPrincipalOscuro ?? null,
      acento: marca?.colorAcentoOscuro ?? null,
    },
  };
}

function declaraciones(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([nombre, valor]) => `${nombre}:${valor}`)
    .join(';');
}
