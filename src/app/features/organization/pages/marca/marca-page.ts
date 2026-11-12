import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';

import { MarcaDeLaOrganizacionService } from '../../../../api/generated/api/marca-de-la-organizacion.service';
import { MarcaResponse } from '../../../../api/generated/model/marca-response';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import {
  COLORES_DE_AKINE,
  PALETAS_DE_MARCA,
  PaletaDeMarca,
  REFERENCIA_DE_TEMA,
  TemaDeMarca,
  ajustarIntensidad,
  contraste,
  esColor,
  textoSobre,
  tonoConContraste,
} from '../../../../core/models/color-de-marca';
import {
  ETIQUETA_PESTANAS_DE_ORGANIZACION,
  pestanasDeOrganizacion,
} from '../../../../core/models/pestanas-de-organizacion';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { MarcaStore } from '../../../../core/services/marca.store';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { Icono } from '../../../../shared/components/icono/icono';
import { Pestanas } from '../../../../shared/components/pestanas/pestanas';

type CampoDeColor = 'principal' | 'acento';

/** Los cuatro colores en edicion. `null` es "el de AKINE". */
type Colores = Readonly<Record<TemaDeMarca, Readonly<Record<CampoDeColor, string | null>>>>;

interface AvisoDeContraste {
  readonly campo: CampoDeColor;
  readonly texto: string;
  readonly sugerido: string;
}

/** Contraste minimo de un control contra su fondo (WCAG 1.4.11) y de un texto (1.4.3). */
const MINIMO: Readonly<Record<CampoDeColor, number>> = { principal: 3, acento: 4.5 };

const LOGO_MAX_BYTES = 500 * 1024;
const TIPOS_DE_LOGO = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Marca del centro: colores institucionales de cada tema, logo y datos de contacto del pie.
 *
 * <p>Las paletas son un punto de partida: cada color se puede cambiar a mano, aclarar u oscurecer.
 * Cuando un color no se va a leer bien la pantalla <b>avisa y ofrece el tono mas cercano que si</b>,
 * pero deja guardar igual: es la decision del producto. El texto que va sobre el color principal
 * (blanco o casi negro) lo elige la aplicacion.
 *
 * <p>Colores y contacto se guardan juntos con "Guardar los cambios". El logo se guarda al subirlo:
 * es otro pedido, y esperar al guardado dejaria un archivo elegido que nadie ve.
 */
@Component({
  selector: 'app-marca-page',
  imports: [CabeceraDePagina, Pestanas, Ayuda, Alerta, Icono, ReactiveFormsModule],
  templateUrl: './marca-page.html',
  styleUrl: './marca-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarcaPage {
  protected readonly pestanasDeOrganizacion = pestanasDeOrganizacion(inject(PermissionsStore));
  protected readonly etiquetaDePestanasDeOrganizacion = ETIQUETA_PESTANAS_DE_ORGANIZACION;

  private readonly api = inject(MarcaDeLaOrganizacionService);
  private readonly tenant = inject(TenantContextStore);
  private readonly store = inject(MarcaStore);
  private readonly avisos = inject(AvisosStore);

  protected readonly paletas = PALETAS_DE_MARCA;
  protected readonly temas: readonly { id: TemaDeMarca; titulo: string }[] = [
    { id: 'claro', titulo: 'Tema claro' },
    { id: 'oscuro', titulo: 'Tema oscuro' },
  ];
  protected readonly camposDeColor: readonly {
    id: CampoDeColor;
    etiqueta: string;
    uso: string;
  }[] = [
    { id: 'principal', etiqueta: 'Color principal', uso: 'Botones, foco y selección.' },
    { id: 'acento', etiqueta: 'Color de acento', uso: 'Enlaces y pestaña activa.' },
  ];

  protected readonly estado = signal<'cargando' | 'listo' | 'error'>('cargando');
  protected readonly mensajeDeCarga = signal('');
  protected readonly guardando = signal(false);
  protected readonly errorAlGuardar = signal<string | null>(null);
  protected readonly erroresDeCampo = signal<Readonly<Record<string, string>>>({});
  protected readonly subiendoLogo = signal(false);
  protected readonly errorDeLogo = signal<string | null>(null);

  /** Lo ultimo que devolvio el servidor: la base contra la que se mide "hay cambios". */
  private readonly guardada = signal<MarcaResponse | null>(null);
  private readonly colores = signal<Colores>(coloresDe(null));

  protected readonly contacto = inject(FormBuilder).nonNullable.group({
    telefono: [''],
    email: ['', [Validators.email]],
    sitioWeb: ['', [Validators.pattern(/^https?:\/\/\S+$/)]],
    direccion: [''],
    leyenda: [''],
  });
  private readonly valoresDeContacto = toSignal(this.contacto.valueChanges, {
    initialValue: this.contacto.getRawValue(),
  });

  protected readonly hayCambios = computed(() => {
    const base = this.guardada();
    if (base === null) {
      return false;
    }
    this.valoresDeContacto();
    const contacto = this.contacto.getRawValue();
    return (
      JSON.stringify(this.colores()) !== JSON.stringify(coloresDe(base)) ||
      (Object.keys(contacto) as (keyof typeof contacto)[]).some(
        (campo) => contacto[campo].trim() !== (base[campo] ?? ''),
      )
    );
  });

  constructor() {
    // Vista previa en vivo: lo que se edita se ve en toda la aplicacion antes de guardar, y al
    // salir de la pantalla sin guardar vuelve lo guardado.
    effect(() => {
      const colores = this.colores();
      if (this.estado() === 'listo') {
        this.store.previsualizar(colores);
      }
    });
    inject(DestroyRef).onDestroy(() => this.store.previsualizar(null));

    effect(() => {
      // Cambiar de centro invalida lo que se estaba editando.
      this.tenant.contextEpoch();
      untracked(() => {
        // Lo que estaba en vuelo era del centro anterior: su respuesta se ignora (`delContextoActual`).
        this.guardando.set(false);
        this.subiendoLogo.set(false);
        this.errorDeLogo.set(null);
        this.cargar();
      });
    });
  }

  protected cargar(): void {
    const orgId = this.tenant.organizationId();
    if (orgId === null) {
      return;
    }
    this.estado.set('cargando');
    this.delContextoActual(this.api.getMarcaDeOrganizacion({ orgId })).subscribe({
      next: (marca) => {
        this.adoptar(marca);
        this.estado.set('listo');
      },
      error: (error: unknown) => {
        this.mensajeDeCarga.set(
          error instanceof AkineHttpError ? error.mensaje : 'Volvé a intentar en un momento.',
        );
        this.estado.set('error');
      },
    });
  }

  // --- Colores ---

  /** El color que se ve: el propio o, si no hay, el de AKINE. */
  protected colorEfectivo(tema: TemaDeMarca, campo: CampoDeColor): string {
    return this.colores()[tema][campo] ?? COLORES_DE_AKINE[tema][campo];
  }

  protected esPropio(tema: TemaDeMarca, campo: CampoDeColor): boolean {
    return this.colores()[tema][campo] !== null;
  }

  protected textoSobrePrincipal(tema: TemaDeMarca): string {
    return textoSobre(this.colorEfectivo(tema, 'principal'));
  }

  protected cambiarColor(tema: TemaDeMarca, campo: CampoDeColor, valor: string | null): void {
    const color = esColor(valor) ? valor.toLowerCase() : null;
    this.colores.update((actual) => ({ ...actual, [tema]: { ...actual[tema], [campo]: color } }));
  }

  /** Codigo tipeado a mano: si no es un `#rrggbb`, el campo vuelve al color vigente. */
  protected escribirColor(tema: TemaDeMarca, campo: CampoDeColor, entrada: HTMLInputElement): void {
    const texto = entrada.value.trim();
    const valor = texto.startsWith('#') ? texto : '#' + texto;
    if (esColor(valor)) {
      this.cambiarColor(tema, campo, valor);
    }
    entrada.value = this.colorEfectivo(tema, campo);
  }

  /** "Mas fuerte" oscurece un paso; "mas suave" aclara un paso. */
  protected intensidad(tema: TemaDeMarca, campo: CampoDeColor, sentido: 1 | -1): void {
    this.cambiarColor(
      tema,
      campo,
      ajustarIntensidad(this.colorEfectivo(tema, campo), sentido * 0.12),
    );
  }

  protected usarPaleta(paleta: PaletaDeMarca): void {
    this.colores.set({ claro: { ...paleta.claro }, oscuro: { ...paleta.oscuro } });
  }

  protected esLaPaletaActual(paleta: PaletaDeMarca): boolean {
    return (
      JSON.stringify({ claro: paleta.claro, oscuro: paleta.oscuro }) ===
      JSON.stringify(this.colores())
    );
  }

  protected muestrasDe(paleta: PaletaDeMarca): string[] {
    return [
      paleta.claro.principal ?? COLORES_DE_AKINE.claro.principal,
      paleta.claro.acento ?? COLORES_DE_AKINE.claro.acento,
      paleta.oscuro.principal ?? COLORES_DE_AKINE.oscuro.principal,
      paleta.oscuro.acento ?? COLORES_DE_AKINE.oscuro.acento,
    ];
  }

  /** Lo que no se va a leer bien en un tema, con el tono mas cercano que si. Solo colores propios. */
  protected avisosDe(tema: TemaDeMarca): AvisoDeContraste[] {
    const fondo = REFERENCIA_DE_TEMA[tema].superficie;
    const avisos: AvisoDeContraste[] = [];
    for (const campo of ['principal', 'acento'] as const) {
      const color = this.colores()[tema][campo];
      if (color === null) {
        continue;
      }
      const razon = contraste(color, fondo);
      if (razon < MINIMO[campo]) {
        const medida = razon.toFixed(1).replace('.', ',');
        avisos.push({
          campo,
          sugerido: tonoConContraste(color, fondo, MINIMO[campo]),
          texto:
            campo === 'principal'
              ? `El color principal se distingue poco del fondo (${medida}:1; conviene 3:1 o más).`
              : `Los enlaces con este acento van a costar de leer (${medida}:1; conviene 4,5:1 o más).`,
        });
      }
    }
    return avisos;
  }

  // --- Guardado ---

  protected conError(campo: 'email' | 'sitioWeb'): boolean {
    const control = this.contacto.controls[campo];
    return (control.invalid && control.touched) || campo in this.erroresDeCampo();
  }

  protected guardar(): void {
    const orgId = this.tenant.organizationId();
    const base = this.guardada();
    if (orgId === null || base === null) {
      return;
    }
    if (this.contacto.invalid) {
      this.contacto.markAllAsTouched();
      return;
    }
    const colores = this.colores();
    const contacto = this.contacto.getRawValue();
    this.guardando.set(true);
    this.errorAlGuardar.set(null);
    this.erroresDeCampo.set({});
    this.delContextoActual(
      this.api.updateMarcaDeOrganizacion({
        orgId,
        updateMarcaRequest: {
          version: base.version,
          colorPrincipalClaro: colores.claro.principal ?? undefined,
          colorAcentoClaro: colores.claro.acento ?? undefined,
          colorPrincipalOscuro: colores.oscuro.principal ?? undefined,
          colorAcentoOscuro: colores.oscuro.acento ?? undefined,
          telefono: contacto.telefono.trim(),
          email: contacto.email.trim(),
          sitioWeb: contacto.sitioWeb.trim(),
          direccion: contacto.direccion.trim(),
          leyenda: contacto.leyenda.trim(),
        },
      }),
    ).subscribe({
      next: (marca) => {
        this.guardando.set(false);
        this.adoptar(marca);
        this.store.adoptar(marca);
        this.avisos.exito('Marca guardada', {
          descripcion: 'Los colores y los datos ya se ven en todo el centro.',
        });
      },
      error: (error: unknown) => {
        this.guardando.set(false);
        if (error instanceof AkineHttpError) {
          this.erroresDeCampo.set(error.erroresPorCampo);
          this.errorAlGuardar.set(
            error.status === 409
              ? 'Alguien cambió la marca mientras editabas. Recargá la pantalla y volvé a intentar.'
              : (error.mensajeSinCampos(() => true) ?? error.message),
          );
          return;
        }
        this.errorAlGuardar.set('No pudimos guardar la marca. Volvé a intentar.');
      },
    });
  }

  protected descartar(): void {
    const base = this.guardada();
    if (base !== null) {
      this.adoptar(base);
    }
  }

  // --- Logo ---

  protected urlDeLogo(tema: TemaDeMarca): string | null {
    return this.store.logosPorTema()[tema];
  }

  protected tieneLogo(tema: TemaDeMarca): boolean {
    const marca = this.guardada();
    return Boolean(tema === 'claro' ? marca?.logoClaro : marca?.logoOscuro);
  }

  protected subirLogo(tema: TemaDeMarca, entrada: HTMLInputElement): void {
    const archivo = entrada.files?.[0];
    // Se vacia para que elegir de nuevo el mismo archivo vuelva a disparar `change`.
    entrada.value = '';
    const orgId = this.tenant.organizationId();
    if (!archivo || orgId === null) {
      return;
    }
    if (!TIPOS_DE_LOGO.includes(archivo.type)) {
      this.errorDeLogo.set('El logo tiene que ser una imagen PNG, JPG o WebP.');
      return;
    }
    if (archivo.size > LOGO_MAX_BYTES) {
      this.errorDeLogo.set('El logo no puede superar los 500 kB.');
      return;
    }
    this.cambiarLogo(
      this.api.subirLogoDeOrganizacion({ orgId, variante: variante(tema), body: archivo }),
      'Logo guardado',
    );
  }

  protected quitarLogo(tema: TemaDeMarca): void {
    const orgId = this.tenant.organizationId();
    if (orgId !== null) {
      this.cambiarLogo(
        this.api.quitarLogoDeOrganizacion({ orgId, variante: variante(tema) }),
        'Logo quitado',
      );
    }
  }

  private cambiarLogo(pedido: Observable<MarcaResponse>, aviso: string): void {
    this.subiendoLogo.set(true);
    this.errorDeLogo.set(null);
    this.delContextoActual(pedido).subscribe({
      next: (marca) => {
        this.subiendoLogo.set(false);
        // Solo los logos: lo que se esta editando de colores y contacto no se pisa.
        this.guardada.update((base) =>
          base === null
            ? marca
            : { ...base, logoClaro: marca.logoClaro, logoOscuro: marca.logoOscuro },
        );
        const enUso = this.store.marca();
        this.store.adoptar(
          enUso === null
            ? marca
            : { ...enUso, logoClaro: marca.logoClaro, logoOscuro: marca.logoOscuro },
        );
        this.avisos.exito(aviso);
      },
      error: (error: unknown) => {
        this.subiendoLogo.set(false);
        this.errorDeLogo.set(
          error instanceof AkineHttpError
            ? (error.erroresPorCampo['logo'] ?? error.mensaje)
            : 'No pudimos guardar el logo. Volvé a intentar.',
        );
      },
    });
  }

  /**
   * Deja pasar la respuesta de un pedido solo si el contexto sigue siendo el de cuando salio.
   *
   * <p>Sin esto, cambiar de centro con un pedido en vuelo dejaba en el editor la marca del centro
   * anterior, y guardar la escribia sobre el centro nuevo. Se compara la epoca y no el id: tambien
   * cubre salir y volver al mismo centro.
   */
  private delContextoActual<T>(pedido: Observable<T>): Observable<T> {
    const epoca = this.tenant.contextEpoch();
    const vigente = (): boolean => this.tenant.contextEpoch() === epoca;
    return new Observable<T>((destino) =>
      pedido.subscribe({
        next: (valor) => vigente() && destino.next(valor),
        error: (error: unknown) => vigente() && destino.error(error),
        complete: () => destino.complete(),
      }),
    );
  }

  private adoptar(marca: MarcaResponse): void {
    this.guardada.set(marca);
    this.colores.set(coloresDe(marca));
    this.contacto.reset({
      telefono: marca.telefono ?? '',
      email: marca.email ?? '',
      sitioWeb: marca.sitioWeb ?? '',
      direccion: marca.direccion ?? '',
      leyenda: marca.leyenda ?? '',
    });
    this.errorAlGuardar.set(null);
    this.erroresDeCampo.set({});
  }
}

function coloresDe(marca: MarcaResponse | null): Colores {
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

function variante(tema: TemaDeMarca): 'CLARO' | 'OSCURO' {
  return tema === 'claro' ? 'CLARO' : 'OSCURO';
}
