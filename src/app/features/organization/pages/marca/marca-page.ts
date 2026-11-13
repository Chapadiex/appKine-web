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
import { NgTemplateOutlet } from '@angular/common';
import { Observable } from 'rxjs';

import { MarcaDeLaOrganizacionService } from '../../../../api/generated/api/marca-de-la-organizacion.service';
import { ColoresDeInterfaz } from '../../../../api/generated/model/colores-de-interfaz';
import { MarcaResponse } from '../../../../api/generated/model/marca-response';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import {
  COLORES_DE_AKINE,
  CampoDeMarca,
  PALETAS_DE_MARCA,
  PaletaDeMarca,
  REFERENCIA_DE_TEMA,
  TemaDeMarca,
  ajustarIntensidad,
  colorPorDefecto,
  mezclar,
  contraste,
  esColor,
  textoSobre,
  tonoConContraste,
  zonasDe,
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

type CampoDeColor = CampoDeMarca;

const PESTANAS: readonly TemaDeMarca[] = ['claro', 'oscuro'];

/** Los colores en edicion. `null` es "el de AKINE" o, en una zona, "automatico". */
type Colores = Readonly<Record<TemaDeMarca, Readonly<Record<CampoDeColor, string | null>>>>;

interface DefinicionDeCampo {
  readonly id: CampoDeColor;
  readonly etiqueta: string;
  readonly uso: string;
  /** Rotulo del enlace que le quita el color propio. */
  readonly reinicio: string;
}

interface AvisoDeContraste {
  readonly campo: CampoDeColor;
  readonly texto: string;
  readonly sugerido: string;
}

/**
 * Lo que se mide de cada color que el centro elige: contra que, el minimo (3:1 para un control,
 * WCAG 1.4.11; 4,5:1 para texto, 1.4.3) y como se le dice. La barra lateral y la cabecera no
 * figuran: el texto que llevan encima lo elige la aplicacion y se lee siempre.
 */
const MEDICIONES: readonly {
  readonly campo: CampoDeColor;
  readonly contra: 'superficie' | 'texto';
  readonly minimo: number;
  readonly texto: (medida: string) => string;
}[] = [
  {
    campo: 'principal',
    contra: 'superficie',
    minimo: 3,
    texto: (m) => `El color principal se distingue poco del fondo (${m}:1; conviene 3:1 o más).`,
  },
  {
    campo: 'acento',
    contra: 'superficie',
    minimo: 4.5,
    texto: (m) =>
      `Los enlaces con este acento van a costar de leer (${m}:1; conviene 4,5:1 o más).`,
  },
  {
    campo: 'botonSecundario',
    contra: 'superficie',
    minimo: 3,
    texto: (m) =>
      `El contorno de los botones secundarios se distingue poco (${m}:1; conviene 3:1 o más).`,
  },
  {
    campo: 'tarjeta',
    contra: 'texto',
    minimo: 4.5,
    texto: (m) => `El texto sobre las tarjetas va a costar de leer (${m}:1; conviene 4,5:1 o más).`,
  },
  {
    campo: 'fondo',
    contra: 'texto',
    minimo: 4.5,
    texto: (m) =>
      `Los títulos sobre este fondo van a costar de leer (${m}:1; conviene 4,5:1 o más).`,
  },
];

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
 * <p>Los colores de los dos temas se guardan juntos con "Guardar los cambios". El logo se guarda
 * al subirlo: es otro pedido, y esperar al guardado dejaria un archivo elegido que nadie ve. Los
 * datos de contacto del pie viven en la misma marca pero se editan en "Datos del centro".
 */
@Component({
  selector: 'app-marca-page',
  imports: [CabeceraDePagina, Pestanas, Ayuda, Alerta, Icono, NgTemplateOutlet],
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
  protected readonly camposDeColor: readonly DefinicionDeCampo[] = [
    {
      id: 'principal',
      etiqueta: 'Principal',
      uso: 'Botones, foco y selección.',
      reinicio: 'Volver al de AKINE',
    },
    {
      id: 'acento',
      etiqueta: 'Acento',
      uso: 'Enlaces y pestaña activa.',
      reinicio: 'Volver al de AKINE',
    },
  ];
  /** Zonas de la pantalla: sin color propio salen solas del color principal. */
  protected readonly camposDeZona: readonly DefinicionDeCampo[] = [
    {
      id: 'barraLateral',
      etiqueta: 'Barra lateral',
      uso: 'Fondo del menú.',
      reinicio: 'Automático',
    },
    {
      id: 'cabecera',
      etiqueta: 'Cabecera',
      uso: 'Fondo de la barra superior.',
      reinicio: 'Automático',
    },
    {
      id: 'fondo',
      etiqueta: 'Fondo',
      uso: 'Fondo de la página, detrás de las tarjetas.',
      reinicio: 'Automático',
    },
    {
      id: 'tarjeta',
      etiqueta: 'Tarjetas',
      uso: 'Fondo de tarjetas, paneles y campos.',
      reinicio: 'Automático',
    },
    {
      id: 'pie',
      etiqueta: 'Pie',
      uso: 'Fondo del pie de página.',
      reinicio: 'Automático',
    },
    {
      id: 'botonSecundario',
      etiqueta: 'Secundario',
      uso: 'Contorno y texto de los botones secundarios.',
      reinicio: 'Automático',
    },
  ];

  protected readonly todosLosCampos: readonly DefinicionDeCampo[] = [
    ...this.camposDeColor,
    ...this.camposDeZona,
  ];

  /** El color que se esta editando: se elige en la miniatura o en la tira de colores. */
  protected readonly campoElegido = signal<CampoDeColor>('principal');
  protected readonly definicionElegida = computed(() =>
    this.todosLosCampos.find((campo) => campo.id === this.campoElegido())!,
  );

  /** El tema que se esta editando: arranca en el que la persona tiene en uso. */
  protected readonly pestana = signal<TemaDeMarca>(this.store.temaEfectivo());

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

  protected readonly hayCambios = computed(() => {
    const base = this.guardada();
    return base !== null && JSON.stringify(this.colores()) !== JSON.stringify(coloresDe(base));
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

  /** Flechas entre las pestañas, como pide el patron: mueven la seleccion y el foco. */
  protected cambiarDePestana(evento: Event, paso: 1 | -1): void {
    const actual = PESTANAS.indexOf(this.pestana());
    const destino = PESTANAS[(actual + paso + PESTANAS.length) % PESTANAS.length];
    this.pestana.set(destino);
    (evento.currentTarget as HTMLElement).parentElement
      ?.querySelector<HTMLElement>('#pestana-tema-' + destino)
      ?.focus();
  }

  /** El color que se ve: el propio o, si no hay, el de AKINE (o el automatico de la zona). */
  protected colorEfectivo(tema: TemaDeMarca, campo: CampoDeColor): string {
    const delTema = this.colores()[tema];
    return delTema[campo] ?? colorPorDefecto(delTema, tema, campo);
  }

  protected esPropio(tema: TemaDeMarca, campo: CampoDeColor): boolean {
    return this.colores()[tema][campo] !== null;
  }

  /**
   * Los colores de la miniatura de un tema, ya resueltos (lo propio o lo que sale solo), como
   * variables `--q-*`. Sigue las mismas reglas que `tokensDeMarca`: texto que se lee sobre la
   * barra y la cabecera, y tintes del principal donde el centro no fijo nada.
   */
  protected maqueta(tema: TemaDeMarca): Record<string, string> {
    const propios = this.colores()[tema];
    const referencia = REFERENCIA_DE_TEMA[tema];
    const de = (campo: CampoDeColor): string => this.colorEfectivo(tema, campo);
    const principal = de('principal');
    const barra = de('barraLateral');
    const cabecera = de('cabecera');
    const tarjeta = de('tarjeta');
    const secundario = de('botonSecundario');
    const pie = de('pie');
    const textoDeBarra = propios.barraLateral === null ? referencia.texto : textoSobre(barra);
    const conMarca = propios.principal !== null || propios.botonSecundario !== null;
    return {
      '--q-barra': barra,
      '--q-barra-texto': textoDeBarra,
      '--q-barra-actual':
        propios.barraLateral === null
          ? mezclar(referencia.superficie, principal, 0.28)
          : mezclar(barra, textoDeBarra, 0.2),
      '--q-cabecera': cabecera,
      '--q-cabecera-texto': propios.cabecera === null ? referencia.texto : textoSobre(cabecera),
      '--q-fondo': de('fondo'),
      '--q-pie': pie,
      '--q-pie-texto': propios.pie === null ? referencia.texto : textoSobre(pie),
      '--q-tarjeta': tarjeta,
      '--q-texto': referencia.texto,
      '--q-borde': mezclar(tarjeta, referencia.texto, 0.16),
      '--q-fila': mezclar(tarjeta, principal, 0.16),
      '--q-principal': principal,
      '--q-sobre-principal': textoSobre(principal),
      '--q-acento': de('acento'),
      '--q-secundario': secundario,
      '--q-secundario-fondo': conMarca ? mezclar(tarjeta, secundario, 0.08) : tarjeta,
      '--q-secundario-texto':
        propios.botonSecundario !== null
          ? tonoConContraste(secundario, referencia.superficie, 4.5)
          : (propios.acento ?? referencia.texto),
    };
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
    this.colores.set(coloresDePaleta(paleta));
  }

  protected esLaPaletaActual(paleta: PaletaDeMarca): boolean {
    return JSON.stringify(coloresDePaleta(paleta)) === JSON.stringify(this.colores());
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
    const avisos: AvisoDeContraste[] = [];
    for (const { campo, contra, minimo, texto } of MEDICIONES) {
      const color = this.colores()[tema][campo];
      if (color === null) {
        continue;
      }
      const referencia = REFERENCIA_DE_TEMA[tema][contra];
      const razon = contraste(color, referencia);
      if (razon < minimo) {
        avisos.push({
          campo,
          sugerido: tonoConContraste(color, referencia, minimo),
          texto: texto(razon.toFixed(1).replace('.', ',')),
        });
      }
    }
    return avisos;
  }

  // --- Guardado ---

  protected guardar(): void {
    const orgId = this.tenant.organizationId();
    const base = this.guardada();
    if (orgId === null || base === null) {
      return;
    }
    const colores = this.colores();
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
          interfazClaro: interfazDe(colores.claro),
          interfazOscuro: interfazDe(colores.oscuro),
          // El contacto se edita en "Datos del centro": aca viaja tal como esta guardado, porque
          // el servidor reemplaza la marca entera.
          telefono: base.telefono,
          email: base.email,
          sitioWeb: base.sitioWeb,
          direccion: base.direccion,
          leyenda: base.leyenda,
        },
      }),
    ).subscribe({
      next: (marca) => {
        this.guardando.set(false);
        this.adoptar(marca);
        this.store.adoptar(marca);
        this.avisos.exito('Marca guardada', {
          descripcion: 'Los colores ya se ven en todo el centro.',
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
    this.errorAlGuardar.set(null);
    this.erroresDeCampo.set({});
  }
}

function coloresDe(marca: MarcaResponse | null): Colores {
  return {
    claro: {
      principal: marca?.colorPrincipalClaro ?? null,
      acento: marca?.colorAcentoClaro ?? null,
      ...zonasDe(marca?.interfazClaro),
    },
    oscuro: {
      principal: marca?.colorPrincipalOscuro ?? null,
      acento: marca?.colorAcentoOscuro ?? null,
      ...zonasDe(marca?.interfazOscuro),
    },
  };
}

/** Una paleta fija principal y acento, y deja las zonas en automatico. */
function coloresDePaleta(paleta: PaletaDeMarca): Colores {
  return {
    claro: { ...paleta.claro, ...zonasDe(undefined) },
    oscuro: { ...paleta.oscuro, ...zonasDe(undefined) },
  };
}

function interfazDe(colores: Colores[TemaDeMarca]): ColoresDeInterfaz {
  return {
    barraLateral: colores.barraLateral ?? undefined,
    cabecera: colores.cabecera ?? undefined,
    fondo: colores.fondo ?? undefined,
    tarjeta: colores.tarjeta ?? undefined,
    pie: colores.pie ?? undefined,
    botonSecundario: colores.botonSecundario ?? undefined,
  };
}

function variante(tema: TemaDeMarca): 'CLARO' | 'OSCURO' {
  return tema === 'claro' ? 'CLARO' : 'OSCURO';
}
