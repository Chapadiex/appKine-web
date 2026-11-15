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
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';

import { DefinicionesDeMedicionService } from '../../../../api/generated/api/definiciones-de-medicion.service';
import { MedicionDefinicionResponse } from '../../../../api/generated/model/medicion-definicion-response';
import {
  CreateMedicionDefinicionRequestAlcanceEnum,
  CreateMedicionDefinicionRequestMejoraCuandoEnum,
  CreateMedicionDefinicionRequestTipoEnum,
} from '../../../../api/generated/model/create-medicion-definicion-request';
import { UpdateMedicionDefinicionRequestMejoraCuandoEnum } from '../../../../api/generated/model/update-medicion-definicion-request';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import { Icono } from '../../../../shared/components/icono/icono';
import { Paginacion } from '../../../../shared/components/paginacion/paginacion';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import { Pestanas } from '../../../../shared/components/pestanas/pestanas';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import { tablaLocal } from '../../../../shared/components/tabla/tabla-local';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import {
  ETIQUETA_PESTANAS_DE_CATALOGO,
  PESTANAS_DE_CATALOGO,
} from '../../models/tipos-de-catalogo';

type Tipo = 'NUMERICO' | 'ESCALA' | 'TEXTO' | 'BOOLEANO';
type Sentido = '' | 'SUBE' | 'BAJA';
type Alcance = 'TODOS' | 'GLOBAL' | 'ORGANIZACION';

type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'sin-contexto' }
  | { readonly tipo: 'listo' }
  | { readonly tipo: 'error'; readonly mensaje: string };

const TIPOS: Readonly<Record<Tipo, string>> = {
  NUMERICO: 'Numérica',
  ESCALA: 'Escala',
  TEXTO: 'Texto',
  BOOLEANO: 'Sí o no',
};

const SENTIDOS: Readonly<Record<string, string>> = {
  SUBE: 'Mejora cuando sube',
  BAJA: 'Mejora cuando baja',
};

/**
 * Definiciones de medida del examen fisico (M06) y su sentido de mejora (M31, RF-M31-003).
 *
 * <p>Las definiciones de la plataforma se ven y no se editan. Las del centro se dan de alta y se
 * editan aca; el codigo, el tipo y el alcance no cambian despues del alta (lo impone el backend).
 * El sentido de mejora solo existe para las medidas numericas o de escala: es lo que deja a la
 * evolucion del caso decir que una medida empeora.
 */
@Component({
  selector: 'app-mediciones-page',
  imports: [
    Alerta,
    Ayuda,
    CabeceraDePagina,
    ColumnaOrdenable,
    EstadoVacio,
    Filtros,
    Icono,
    Paginacion,
    PanelLateral,
    PermisoDirective,
    Pestanas,
    ReactiveFormsModule,
  ],
  templateUrl: './mediciones-page.html',
  styleUrl: '../../catalog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MedicionesPage {
  private readonly api = inject(DefinicionesDeMedicionService);
  private readonly contexto = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);
  private readonly avisos = inject(AvisosStore);
  private readonly fb = inject(FormBuilder);

  protected readonly pestanasDeCatalogo = PESTANAS_DE_CATALOGO;
  protected readonly etiquetaDePestanas = ETIQUETA_PESTANAS_DE_CATALOGO;
  protected readonly permisoManage = PERMISO_CONSULTORIO_MANAGE;
  protected readonly tipos = Object.entries(TIPOS) as [Tipo, string][];

  protected readonly estado = signal<Estado>({ tipo: 'cargando' });
  private readonly definiciones = signal<readonly MedicionDefinicionResponse[]>([]);
  protected readonly busqueda = signal('');
  protected readonly filtroAlcance = signal<Alcance>('TODOS');

  protected readonly filtradas = computed(() => {
    const texto = normalizar(this.busqueda());
    const alcance = this.filtroAlcance();
    return this.definiciones().filter(
      (d) =>
        (alcance === 'TODOS' || d.alcance === alcance) &&
        (texto === '' || normalizar(`${d.name ?? ''} ${d.codigo ?? ''}`).includes(texto)),
    );
  });

  protected readonly tabla = tablaLocal(this.filtradas, {
    columnas: {
      nombre: (d) => d.name ?? '',
      codigo: (d) => d.codigo ?? '',
      tipo: (d) => this.tipoEnPalabras(d.tipo),
    },
    ordenInicial: { columna: 'nombre', direccion: 'asc' },
  });

  /** El panel: `null` cerrado, `'alta'` o la definicion que se edita. */
  protected readonly enPanel = signal<'alta' | MedicionDefinicionResponse | null>(null);
  protected readonly enviando = signal(false);
  protected readonly errorDelPanel = signal<string | null>(null);

  protected readonly formulario = this.fb.nonNullable.group({
    codigo: ['', [Validators.required, Validators.maxLength(48)]],
    name: ['', [Validators.required, Validators.maxLength(160)]],
    descripcion: ['', Validators.maxLength(280)],
    tipo: ['NUMERICO' as Tipo, Validators.required],
    unidad: ['', Validators.maxLength(24)],
    minimo: [''],
    maximo: [''],
    mejoraCuando: ['' as Sentido],
  });

  private readonly tipoElegido = signal<Tipo>('NUMERICO');
  protected readonly esNumerica = computed(
    () => this.tipoElegido() === 'NUMERICO' || this.tipoElegido() === 'ESCALA',
  );

  private pedido: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.pedido?.unsubscribe());
    this.formulario.controls.tipo.valueChanges.subscribe((tipo) => this.tipoElegido.set(tipo));
    effect(() => {
      this.contexto.contextEpoch();
      untracked(() => this.cargar());
    });
  }

  protected puedeGestionar(): boolean {
    return this.permisos.tiene(this.permisoManage);
  }

  protected tipoEnPalabras(tipo: string | undefined): string {
    return tipo ? (TIPOS[tipo as Tipo] ?? tipo) : '—';
  }

  protected sentidoEnPalabras(sentido: string | undefined | null): string {
    return sentido ? (SENTIDOS[sentido] ?? sentido) : 'Sin definir';
  }

  protected rango(d: MedicionDefinicionResponse): string {
    if (d.minimo === undefined && d.maximo === undefined) return '—';
    return `${d.minimo ?? '…'} a ${d.maximo ?? '…'}`;
  }

  protected tituloDelPanel(): string {
    const panel = this.enPanel();
    return panel === 'alta'
      ? 'Nueva medida de este centro'
      : `Editar ${panel?.name ?? 'la medida'}`;
  }

  protected esAlta(): boolean {
    return this.enPanel() === 'alta';
  }

  protected abrirAlta(): void {
    this.formulario.reset();
    this.formulario.controls.codigo.enable();
    this.formulario.controls.tipo.enable();
    this.tipoElegido.set('NUMERICO');
    this.errorDelPanel.set(null);
    this.enPanel.set('alta');
  }

  protected abrirEdicion(d: MedicionDefinicionResponse): void {
    this.formulario.reset({
      codigo: d.codigo ?? '',
      name: d.name ?? '',
      descripcion: d.descripcion ?? '',
      tipo: (d.tipo as Tipo) ?? 'NUMERICO',
      unidad: d.unidad ?? '',
      minimo: d.minimo === undefined ? '' : String(d.minimo),
      maximo: d.maximo === undefined ? '' : String(d.maximo),
      mejoraCuando: (d.mejoraCuando as Sentido) ?? '',
    });
    this.formulario.controls.codigo.disable();
    this.formulario.controls.tipo.disable();
    this.tipoElegido.set((d.tipo as Tipo) ?? 'NUMERICO');
    this.errorDelPanel.set(null);
    this.enPanel.set(d);
  }

  protected cerrarPanel(): void {
    this.enPanel.set(null);
  }

  protected guardar(): void {
    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }
    const panel = this.enPanel();
    const v = this.formulario.getRawValue();
    const numerica = this.esNumerica();
    const sentido = numerica && v.mejoraCuando !== '' ? v.mejoraCuando : undefined;
    const peticion =
      panel === 'alta'
        ? this.api.createMedicionDefinicion({
            createMedicionDefinicionRequest: {
              alcance: CreateMedicionDefinicionRequestAlcanceEnum.ORGANIZACION,
              codigo: v.codigo.trim(),
              name: v.name.trim(),
              descripcion: v.descripcion.trim() || undefined,
              tipo: CreateMedicionDefinicionRequestTipoEnum[v.tipo],
              unidad: numerica ? v.unidad.trim() || undefined : undefined,
              minimo: numerica ? numero(v.minimo) : undefined,
              maximo: numerica ? numero(v.maximo) : undefined,
              mejoraCuando: sentido && CreateMedicionDefinicionRequestMejoraCuandoEnum[sentido],
            },
          })
        : panel
          ? this.api.updateMedicionDefinicion({
              definicionId: panel.id!,
              updateMedicionDefinicionRequest: {
                name: v.name.trim(),
                descripcion: v.descripcion.trim(),
                unidad: numerica ? v.unidad.trim() || undefined : undefined,
                minimo: numerica ? numero(v.minimo) : undefined,
                maximo: numerica ? numero(v.maximo) : undefined,
                mejoraCuando: sentido && UpdateMedicionDefinicionRequestMejoraCuandoEnum[sentido],
                clearMejoraCuando: numerica && v.mejoraCuando === '' && !!panel.mejoraCuando,
                version: panel.version!,
              },
            })
          : null;
    if (peticion === null) return;
    this.enviando.set(true);
    this.errorDelPanel.set(null);
    peticion.subscribe({
      next: (guardada) => {
        this.enviando.set(false);
        this.enPanel.set(null);
        this.avisos.exito(`Se guardó la medida ${guardada.name ?? ''}.`);
        this.cargar();
      },
      error: (error: unknown) => {
        this.enviando.set(false);
        this.errorDelPanel.set(mensajeDe(error));
      },
    });
  }

  protected cargar(): void {
    this.pedido?.unsubscribe();
    if (this.contexto.consultorioId() === null) {
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }
    this.estado.set({ tipo: 'cargando' });
    this.pedido = this.api
      .searchMedicionDefiniciones({ estado: 'ACTIVO', alcance: 'TODOS', size: 100 })
      .subscribe({
        next: (pagina) => {
          this.definiciones.set(pagina.content ?? []);
          this.estado.set({ tipo: 'listo' });
        },
        error: (error: unknown) => this.estado.set({ tipo: 'error', mensaje: mensajeDe(error) }),
      });
  }
}

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function numero(valor: string): number | undefined {
  const limpio = valor.trim().replace(',', '.');
  return limpio === '' || Number.isNaN(Number(limpio)) ? undefined : Number(limpio);
}

function mensajeDe(error: unknown): string {
  if (error instanceof AkineHttpError) return error.mensaje;
  return 'No pudimos completar la operación. Volvé a intentar en un momento.';
}
