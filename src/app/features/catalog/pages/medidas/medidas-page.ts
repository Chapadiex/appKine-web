import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { catchError, concatMap, from, of, toArray } from 'rxjs';

import { DefinicionesDeMedicionService } from '../../../../api/generated/api/definiciones-de-medicion.service';
import {
  CreateMedicionDefinicionRequest,
  CreateMedicionDefinicionRequestAlcanceEnum,
  CreateMedicionDefinicionRequestTipoEnum,
} from '../../../../api/generated/model/create-medicion-definicion-request';
import { MedicionDefinicionResponse } from '../../../../api/generated/model/medicion-definicion-response';
import { UpdateMedicionDefinicionRequest } from '../../../../api/generated/model/update-medicion-definicion-request';
import { PERMISO_CATALOGO_MANAGE } from '../../../../core/models/permisos';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { AccionesDeFila } from '../../../../shared/components/acciones-de-fila/acciones-de-fila';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { Icono } from '../../../../shared/components/icono/icono';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import { Pestanas } from '../../../../shared/components/pestanas/pestanas';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { textoRequerido } from '../../../../shared/validators/texto-requerido';
import { traducirErrorCatalogo } from '../../models/catalogo-errors';
import {
  ETIQUETA_PESTANAS_DE_CATALOGO,
  PESTANAS_DE_CATALOGO,
} from '../../models/tipos-de-catalogo';

type Tipo = 'NUMERICO' | 'ESCALA' | 'TEXTO' | 'BOOLEANO';

/** Los cuatro tipos, en palabras: el tipo decide si lleva unidad y rango. */
const TIPOS: readonly {
  readonly valor: Tipo;
  readonly etiqueta: string;
  readonly ayuda: string;
}[] = [
  { valor: 'NUMERICO', etiqueta: 'Número', ayuda: 'Un valor con unidad: grados, cm, kg.' },
  { valor: 'ESCALA', etiqueta: 'Escala', ayuda: 'Un puntaje dentro de un rango: 0 a 5.' },
  { valor: 'BOOLEANO', etiqueta: 'Sí / No', ayuda: 'Positivo o negativo: un test.' },
  { valor: 'TEXTO', etiqueta: 'Texto', ayuda: 'Una observación libre.' },
];

/** Medidas tipicas de kinesiologia para arrancar con un clic. Se crean del centro, editables. */
const MEDIDAS_BASE = [
  {
    codigo: 'ROM_FLEX_RODILLA',
    name: 'Flexión de rodilla',
    tipo: 'NUMERICO',
    unidad: '°',
    minimo: 0,
    maximo: 150,
  },
  {
    codigo: 'ROM_EXT_RODILLA',
    name: 'Extensión de rodilla',
    tipo: 'NUMERICO',
    unidad: '°',
    minimo: -20,
    maximo: 20,
  },
  {
    codigo: 'ROM_FLEX_HOMBRO',
    name: 'Flexión de hombro',
    tipo: 'NUMERICO',
    unidad: '°',
    minimo: 0,
    maximo: 180,
  },
  {
    codigo: 'ROM_ABD_HOMBRO',
    name: 'Abducción de hombro',
    tipo: 'NUMERICO',
    unidad: '°',
    minimo: 0,
    maximo: 180,
  },
  {
    codigo: 'ROM_FLEX_LUMBAR',
    name: 'Flexión lumbar',
    tipo: 'NUMERICO',
    unidad: '°',
    minimo: 0,
    maximo: 90,
  },
  {
    codigo: 'FUERZA_MRC',
    name: 'Fuerza muscular (MRC)',
    tipo: 'ESCALA',
    unidad: 'puntos',
    minimo: 0,
    maximo: 5,
  },
  { codigo: 'PERIMETRO', name: 'Perímetro', tipo: 'NUMERICO', unidad: 'cm' },
  { codigo: 'TEST_LACHMAN', name: 'Test de Lachman', tipo: 'BOOLEANO' },
  { codigo: 'TEST_NEER', name: 'Test de Neer', tipo: 'BOOLEANO' },
  { codigo: 'OBS_POSTURAL', name: 'Observación postural', tipo: 'TEXTO' },
].map(
  (medida) =>
    ({ ...medida, alcance: 'ORGANIZACION' }) as unknown as CreateMedicionDefinicionRequest,
);

type Panel =
  | { readonly tipo: 'alta' }
  | { readonly tipo: 'editar' | 'baja'; readonly medida: MedicionDefinicionResponse };

/**
 * Catalogo de medidas del examen fisico (13/11/2026). Que se mide, en que unidad y con que rango:
 * sin esto la seccion "Examen fisico" de la atencion no ofrece nada para registrar. El backend
 * existia; faltaba la pantalla. Las de AKINE se leen; las del centro se crean, editan y dan de baja.
 */
@Component({
  selector: 'app-medidas-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AccionesDeFila,
    Alerta,
    Ayuda,
    CabeceraDePagina,
    ConfirmacionConMotivo,
    Icono,
    PanelLateral,
    Pestanas,
    PermisoDirective,
    ReactiveFormsModule,
  ],
  templateUrl: './medidas-page.html',
  styleUrls: ['../../catalog.css', './medidas-page.css'],
})
export class MedidasPage {
  private readonly api = inject(DefinicionesDeMedicionService);
  private readonly avisos = inject(AvisosStore);
  private readonly permisos = inject(PermissionsStore);
  private readonly tenantContext = inject(TenantContextStore);

  protected readonly pestanas = PESTANAS_DE_CATALOGO;
  protected readonly etiquetaDePestanas = ETIQUETA_PESTANAS_DE_CATALOGO;
  protected readonly tipos = TIPOS;
  protected readonly permisoManage = PERMISO_CATALOGO_MANAGE;

  protected readonly medidas = signal<readonly MedicionDefinicionResponse[] | null>(null);
  protected readonly errorDeCarga = signal<string | null>(null);
  protected readonly busqueda = signal('');
  protected readonly panel = signal<Panel | null>(null);
  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly cargandoBase = signal(false);

  protected readonly puedeGestionar = computed(() => this.permisos.tiene(PERMISO_CATALOGO_MANAGE));

  protected readonly filtradas = computed(() => {
    const texto = normalizar(this.busqueda());
    const lista = this.medidas() ?? [];
    return texto === ''
      ? lista
      : lista.filter((m) => normalizar(`${m.name ?? ''} ${m.codigo ?? ''}`).includes(texto));
  });

  protected readonly formulario = inject(FormBuilder).nonNullable.group({
    name: ['', [textoRequerido]],
    codigo: ['', [textoRequerido]],
    tipo: ['NUMERICO' as Tipo],
    unidad: [''],
    minimo: [''],
    maximo: [''],
    descripcion: [''],
  });

  /** El tipo elegido en el formulario, como signal para que la plantilla reaccione. */
  protected readonly tipoElegido = signal<Tipo>('NUMERICO');

  protected readonly llevaUnidad = computed(
    () => this.tipoElegido() === 'NUMERICO' || this.tipoElegido() === 'ESCALA',
  );

  constructor() {
    this.formulario.controls.tipo.valueChanges.subscribe((tipo) => this.tipoElegido.set(tipo));
    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.panel.set(null);
        this.cargar();
      });
    });
  }

  protected cargar(): void {
    this.errorDeCarga.set(null);
    this.api
      .searchMedicionDefiniciones({
        estado: 'ACTIVO',
        alcance: 'TODOS',
        size: 100,
        sort: 'nombre,asc',
      })
      .pipe(
        catchError((error: unknown) => {
          this.errorDeCarga.set(traducirErrorCatalogo(error).mensaje);
          return of(null);
        }),
      )
      .subscribe((pagina) =>
        this.medidas.set(pagina?.content ?? (this.errorDeCarga() ? null : [])),
      );
  }

  protected esGlobal(medida: MedicionDefinicionResponse): boolean {
    return medida.alcance === 'GLOBAL';
  }

  protected etiquetaDeTipo(tipo: string | undefined): string {
    return TIPOS.find((t) => t.valor === tipo)?.etiqueta ?? tipo ?? '';
  }

  /** "0 a 150 °", "cm", o nada. */
  protected rangoDe(medida: MedicionDefinicionResponse): string {
    const unidad = medida.unidad ?? '';
    if (medida.minimo !== undefined && medida.maximo !== undefined) {
      return `${medida.minimo} a ${medida.maximo} ${unidad}`.trim();
    }
    return unidad;
  }

  protected abrirAlta(): void {
    this.formulario.reset({
      name: '',
      codigo: '',
      tipo: 'NUMERICO',
      unidad: '',
      minimo: '',
      maximo: '',
      descripcion: '',
    });
    this.formulario.controls.codigo.enable();
    this.formulario.controls.tipo.enable();
    this.tipoElegido.set('NUMERICO');
    this.errorAccion.set(null);
    this.panel.set({ tipo: 'alta' });
  }

  protected abrirEdicion(medida: MedicionDefinicionResponse): void {
    const tipo = (medida.tipo ?? 'NUMERICO') as Tipo;
    this.formulario.reset({
      name: medida.name ?? '',
      codigo: medida.codigo ?? '',
      tipo,
      unidad: medida.unidad ?? '',
      minimo: medida.minimo === undefined ? '' : String(medida.minimo),
      maximo: medida.maximo === undefined ? '' : String(medida.maximo),
      descripcion: medida.descripcion ?? '',
    });
    // El codigo y el tipo no se cambian: el tipo decide como se lee cada medicion ya tomada.
    this.formulario.controls.codigo.disable();
    this.formulario.controls.tipo.disable();
    this.tipoElegido.set(tipo);
    this.errorAccion.set(null);
    this.panel.set({ tipo: 'editar', medida });
  }

  protected abrirBaja(medida: MedicionDefinicionResponse): void {
    this.errorAccion.set(null);
    this.panel.set({ tipo: 'baja', medida });
  }

  protected cerrarPanel(): void {
    this.panel.set(null);
    this.enviando.set(false);
  }

  protected guardar(): void {
    const panel = this.panel();
    if (panel === null || this.enviando()) {
      return;
    }
    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }
    const v = this.formulario.getRawValue();
    const unidad = this.llevaUnidad() ? v.unidad.trim() : '';
    const minimo = this.llevaUnidad() ? numero(v.minimo) : undefined;
    const maximo = this.llevaUnidad() ? numero(v.maximo) : undefined;
    if (this.llevaUnidad() && unidad === '') {
      this.errorAccion.set(
        'Un número o una escala necesitan su unidad (por ejemplo °, cm o puntos).',
      );
      return;
    }
    if ((minimo === undefined) !== (maximo === undefined)) {
      this.errorAccion.set('El rango lleva los dos extremos, o ninguno.');
      return;
    }
    this.enviando.set(true);
    this.errorAccion.set(null);

    const pedido =
      panel.tipo === 'alta'
        ? this.api.createMedicionDefinicion({
            createMedicionDefinicionRequest: {
              alcance: CreateMedicionDefinicionRequestAlcanceEnum.ORGANIZACION,
              codigo: v.codigo.trim().toUpperCase().replace(/\s+/g, '_'),
              name: v.name.trim(),
              tipo: v.tipo as CreateMedicionDefinicionRequestTipoEnum,
              unidad: unidad || undefined,
              minimo,
              maximo,
              descripcion: v.descripcion.trim() || undefined,
            },
          })
        : this.api.updateMedicionDefinicion({
            definicionId: panel.medida.id ?? 0,
            updateMedicionDefinicionRequest: this.cambios(
              panel.medida,
              v.name,
              unidad,
              minimo,
              maximo,
              v.descripcion,
            ),
          });

    pedido.subscribe({
      next: (medida) => {
        this.cerrarPanel();
        this.avisos.exito(panel.tipo === 'alta' ? 'Medida creada' : 'Cambios guardados', {
          descripcion: medida.name ?? undefined,
        });
        this.cargar();
      },
      error: (error: unknown) => {
        this.enviando.set(false);
        this.errorAccion.set(traducirErrorCatalogo(error).mensaje);
      },
    });
  }

  protected darDeBaja(motivo: string): void {
    const panel = this.panel();
    if (panel?.tipo !== 'baja' || panel.medida.id === undefined) {
      return;
    }
    this.enviando.set(true);
    this.api
      .deactivateMedicionDefinicion({
        definicionId: panel.medida.id,
        deactivateMedicionDefinicionRequest: { reason: motivo },
      })
      .subscribe({
        next: () => {
          this.cerrarPanel();
          this.avisos.exito('Medida dada de baja', { descripcion: panel.medida.name ?? undefined });
          this.cargar();
        },
        error: (error: unknown) => {
          this.enviando.set(false);
          this.errorAccion.set(traducirErrorCatalogo(error).mensaje);
        },
      });
  }

  /** Crea las medidas tipicas de kinesiologia, una por una; las que ya existen se saltean. */
  protected cargarMedidasBase(): void {
    if (this.cargandoBase()) {
      return;
    }
    const existentes = new Set((this.medidas() ?? []).map((m) => m.codigo));
    const faltan = MEDIDAS_BASE.filter((m) => !existentes.has(m.codigo));
    this.cargandoBase.set(true);
    from(faltan)
      .pipe(
        concatMap((medida) =>
          this.api
            .createMedicionDefinicion({ createMedicionDefinicionRequest: medida })
            .pipe(catchError(() => of(null))),
        ),
        toArray(),
      )
      .subscribe((creadas) => {
        this.cargandoBase.set(false);
        const ok = creadas.filter((c) => c !== null).length;
        this.avisos.exito('Medidas de kinesiología cargadas', {
          descripcion: `${ok} de ${faltan.length}. Las podés editar o dar de baja.`,
        });
        this.cargar();
      });
  }

  /** Solo lo que cambio, mas la version. Vaciar los dos extremos del rango lo quita. */
  private cambios(
    original: MedicionDefinicionResponse,
    nombre: string,
    unidad: string,
    minimo: number | undefined,
    maximo: number | undefined,
    descripcion: string,
  ): UpdateMedicionDefinicionRequest {
    const cambios: UpdateMedicionDefinicionRequest = { version: original.version ?? 0 };
    if (nombre.trim() !== (original.name ?? '')) {
      cambios.name = nombre.trim();
    }
    if (unidad !== '' && unidad !== (original.unidad ?? '')) {
      cambios.unidad = unidad;
    }
    if (descripcion.trim() !== (original.descripcion ?? '')) {
      cambios.descripcion = descripcion.trim();
    }
    if (minimo === undefined && maximo === undefined) {
      if (original.minimo !== undefined) {
        cambios.clearRango = true;
      }
    } else if (minimo !== original.minimo || maximo !== original.maximo) {
      cambios.minimo = minimo;
      cambios.maximo = maximo;
    }
    return cambios;
  }
}

function numero(texto: string): number | undefined {
  const limpio = texto.trim().replace(',', '.');
  if (limpio === '') {
    return undefined;
  }
  const valor = Number(limpio);
  return Number.isFinite(valor) ? valor : undefined;
}

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
