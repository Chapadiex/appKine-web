import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import {
  CrearProducto,
  CrearProductoTipoEnum,
} from '../../../../api/generated/model/crear-producto';
import { EditarProducto } from '../../../../api/generated/model/editar-producto';
import { OfertaResponse } from '../../../../api/generated/model/oferta-response';
import { Producto } from '../../../../api/generated/model/producto';
import { PERMISO_PRODUCTO_MANAGE } from '../../../../core/models/permisos';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { numeroDeclarado } from '../../../../shared/utils/numero-declarado';
import { formatearFecha } from '../../../../shared/utils/instantes';
import {
  creditosEnPalabras,
  esAbono,
  etiquetaDeTipoDePase,
  importeDePase,
} from '../../models/etiquetas-de-pases';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { ErrorPase, errorSinContextoDePase, traducirErrorPase } from '../../models/pase-errors';
import { ESQUEMA_POR_ABONO, ESQUEMA_POR_PACK, PasesApi } from '../../services/pases-api';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import { Icono } from '../../../../shared/components/icono/icono';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { PieDeTabla } from '../../../../shared/components/tabla/pie-de-tabla';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import { AccionesDeFila } from '../../../../shared/components/acciones-de-fila/acciones-de-fila';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import { tablaLocal } from '../../../../shared/components/tabla/tabla-local';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

import { Alerta } from '../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../core/services/avisos.store';

/** El esquema de cobro que exige cada tipo de producto (RN-M29-005, RF-M29-007). */
const ESQUEMA_DEL_TIPO: Readonly<Record<CrearProductoTipoEnum, string>> = {
  PACK: ESQUEMA_POR_PACK,
  ABONO: ESQUEMA_POR_ABONO,
};

type Panel =
  | { readonly tipo: 'ninguno' }
  | { readonly tipo: 'alta' }
  | { readonly tipo: 'edicion'; readonly producto: Producto }
  | { readonly tipo: 'baja'; readonly producto: Producto };

const PRECIO_VALIDO = /^\d+([.,]\d{1,2})?$/;

/** Tope de `vigenciaDias` del contrato 0.120.0 (`maximum: 3660`, diez anios). */
const VIGENCIA_DIAS_MAXIMA = 3660;

/**
 * Catalogo de productos de pack de la sede (M29, AKINE-08.06: RF-M29-001).
 *
 * <p><b>Crear un producto no le da saldo a nadie</b> (CA-M29-001-06): define que se vende —cuantos
 * creditos, a que precio, cuantos dias valen— sobre una oferta que cobra `POR_PACK`. El saldo nace
 * recien con la venta, en la pantalla de pases.
 *
 * <p><b>Editar no cambia lo vendido</b>: cada pase lleva su snapshot. Y <b>la baja no cascadea</b>:
 * los pases ya vendidos conservan saldo y vigencia.
 *
 * <p><b>Abonos</b> (AKINE-08.08, RF-M29-007): un producto `ABONO` cuelga de una oferta `POR_ABONO`;
 * sus creditos son las asistencias que permite cada periodo y `vigenciaDias` la duracion maxima de
 * un periodo, que se elige al vender. El tipo se elige al crear y no se edita.
 */
@Component({
  selector: 'app-productos-de-pack-page',
  imports: [
    CabeceraDePagina,
    Alerta,
    Ayuda,
    ColumnaOrdenable,
    Filtros,
    Icono,
    EstadoVacio,
    PieDeTabla,
    ReactiveFormsModule,
    RouterLink,
    ConfirmacionConMotivo,
    AccionesDeFila,
    PanelLateral,
  ],
  templateUrl: './productos-de-pack-page.html',
  styleUrl: '../../activity.css',
})
export class ProductosDePackPage {
  private readonly api = inject(PasesApi);
  private readonly avisos = inject(AvisosStore);
  private readonly tenant = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly creditos = creditosEnPalabras;
  protected readonly tipoDeProducto = etiquetaDeTipoDePase;
  protected readonly abono = esAbono;
  protected readonly importe = importeDePase;
  protected readonly fecha = formatearFecha;

  protected readonly productos = signal<readonly Producto[] | null>(null);
  /** Busqueda por nombre u oferta, sobre la lista completa (el servidor no busca productos). */
  protected readonly busqueda = signal('');
  private readonly filtrados = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    const todos = this.productos() ?? [];
    return texto === ''
      ? todos
      : todos.filter((producto) =>
          `${producto.nombre ?? ''} ${this.nombreDeOferta(producto)}`.toLowerCase().includes(texto),
        );
  });
  /** Orden y paginado de la lista completa (plan §3.4): el servidor no pagina productos. */
  protected readonly tabla = tablaLocal(this.filtrados, {
    columnas: {
      producto: (producto) => producto.nombre,
      tipo: (producto) => this.tipoDeProducto(producto),
      oferta: (producto) => this.nombreDeOferta(producto),
      precio: (producto) => producto.precio,
      estado: (producto) => (producto.active === false ? 'Dado de baja' : 'Vigente'),
    },
  });
  /** Ofertas activas que admiten producto: `POR_PACK` o `POR_ABONO`. */
  private readonly ofertasVendibles = signal<readonly OfertaResponse[]>([]);
  /** El tipo elegido en el formulario, como signal: filtra las ofertas que se ofrecen. */
  protected readonly tipoElegido = signal<CrearProductoTipoEnum>(CrearProductoTipoEnum.PACK);
  protected readonly ofertasDelTipo = computed(() => {
    const esquema = ESQUEMA_DEL_TIPO[this.tipoElegido()];
    return this.ofertasVendibles().filter((o) => o.esquemaCobro === esquema);
  });
  protected readonly esquemaDelTipo = computed(() => ESQUEMA_DEL_TIPO[this.tipoElegido()]);
  private readonly nombresDeOferta = signal<ReadonlyMap<number, string>>(new Map());
  protected readonly incluirBajas = signal(false);
  /** Filtros avanzados fuera de su valor por defecto: el contador del embudo. */
  protected readonly filtrosAvanzadosActivos = computed(() => Number(this.incluirBajas()));
  protected readonly panel = signal<Panel>({ tipo: 'ninguno' });
  protected readonly error = signal<ErrorPase | null>(null);
  protected readonly errorAccion = signal<ErrorPase | null>(null);
  /** "Se vende hasta" anterior a "desde": se dice en ese campo (UX-12). */
  protected readonly hastaAntesDeDesde = signal(false);
  protected readonly enviando = signal(false);
  protected readonly intentado = signal(false);

  /** Sin permisos cargados se muestra todo: el backend decide igual. */
  protected readonly puedeGestionar = computed(
    () => !this.permisos.cargados() || this.permisos.tiene(PERMISO_PRODUCTO_MANAGE),
  );
  protected readonly enEdicion = computed(() => {
    const panel = this.panel();
    return panel.tipo === 'edicion' ? panel.producto : null;
  });
  /** El producto de la baja abierta, para el panel lateral que vive fuera de la tabla. */
  protected readonly productoEnPanel = computed(() => {
    const panel = this.panel();
    return panel.tipo === 'baja' ? panel.producto : null;
  });
  protected readonly formularioAbierto = computed(() => {
    const tipo = this.panel().tipo;
    return tipo === 'alta' || tipo === 'edicion';
  });

  protected readonly formulario = this.fb.group({
    tipo: [CrearProductoTipoEnum.PACK as CrearProductoTipoEnum],
    ofertaId: ['', Validators.required],
    nombre: ['', [Validators.required, Validators.maxLength(160)]],
    descripcion: ['', Validators.maxLength(500)],
    creditos: ['', [Validators.required, Validators.min(1)]],
    precio: ['', [Validators.required, Validators.pattern(PRECIO_VALIDO)]],
    moneda: ['ARS', [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)]],
    // Tope del contrato 0.120.0 (`maximum: 3660`, diez anios): el backend lo rechaza con 400.
    vigenciaDias: [
      '',
      [Validators.required, Validators.min(1), Validators.max(VIGENCIA_DIAS_MAXIMA)],
    ],
    vigenciaDesde: ['', Validators.required],
    vigenciaHasta: [''],
  });

  /** Respuesta mas nueva pedida: una vieja que llega tarde no pisa a la nueva. */
  private pedido = 0;

  constructor() {
    // Otro tipo pide otra oferta: la elegida ya no sirve.
    this.formulario.controls.tipo.valueChanges.pipe(takeUntilDestroyed()).subscribe((tipo) => {
      this.tipoElegido.set(tipo);
      this.formulario.controls.ofertaId.setValue('');
    });
    effect(() => {
      this.tenant.contextEpoch();
      untracked(() => {
        // Cambiar de sede no puede dejar productos ni formularios de la anterior.
        this.cerrarPanel();
        this.productos.set(null);
        this.cargar();
      });
    });
  }

  protected nombreDeOferta(producto: Producto): string {
    const id = producto.ofertaId;
    return id === undefined ? '' : (this.nombresDeOferta().get(id) ?? `Oferta #${id}`);
  }

  protected ventana(producto: Producto): string {
    const desde = formatearFecha(producto.vigenciaDesde);
    const hasta = formatearFecha(producto.vigenciaHasta);
    return hasta ? `Del ${desde} al ${hasta}` : `Desde el ${desde}, sin fin`;
  }

  protected cambiarIncluirBajas(valor: boolean): void {
    this.incluirBajas.set(valor);
    this.cargar();
  }

  protected cargar(): void {
    const consultorioId = this.tenant.consultorioId();
    const pedido = ++this.pedido;
    if (consultorioId === null) {
      this.error.set(errorSinContextoDePase());
      return;
    }
    this.error.set(null);
    this.api.productos(consultorioId, this.incluirBajas()).subscribe({
      next: (productos) => {
        if (pedido === this.pedido) {
          this.productos.set(productos);
        }
      },
      error: (error: unknown) => {
        if (pedido === this.pedido) {
          this.productos.set([]);
          this.error.set(traducirErrorPase(error));
        }
      },
    });
    // Los nombres de oferta son ayuda: si fallan, la tabla dice "Oferta #id" y sigue.
    this.api.ofertasDeLaSede(consultorioId).subscribe({
      next: (ofertas) => {
        if (pedido === this.pedido) {
          this.nombresDeOferta.set(
            new Map(ofertas.map((o) => [o.id ?? -1, o.nombreComercial ?? ''])),
          );
          const esquemas: readonly string[] = [ESQUEMA_POR_PACK, ESQUEMA_POR_ABONO];
          this.ofertasVendibles.set(
            ofertas.filter((o) => o.estado === 'ACTIVO' && esquemas.includes(o.esquemaCobro ?? '')),
          );
        }
      },
      error: () => undefined,
    });
  }

  // ------------------------------------------------------------------ alta y edicion

  protected abrirAlta(): void {
    this.prepararPanel({ tipo: 'alta' });
    this.formulario.reset({
      tipo: CrearProductoTipoEnum.PACK,
      ofertaId: '',
      nombre: '',
      descripcion: '',
      creditos: '',
      precio: '',
      moneda: 'ARS',
      vigenciaDias: '',
      vigenciaDesde: this.diaDeLaSede.hoy(),
      vigenciaHasta: '',
    });
    this.formulario.controls.ofertaId.enable();
    this.formulario.controls.tipo.enable();
  }

  protected abrirEdicion(producto: Producto): void {
    this.prepararPanel({ tipo: 'edicion', producto });
    this.formulario.reset({
      tipo: esAbono(producto) ? CrearProductoTipoEnum.ABONO : CrearProductoTipoEnum.PACK,
      ofertaId: String(producto.ofertaId ?? ''),
      nombre: producto.nombre ?? '',
      descripcion: producto.descripcion ?? '',
      creditos: String(producto.creditos ?? ''),
      precio: producto.precio === undefined ? '' : String(producto.precio),
      moneda: producto.moneda ?? '',
      vigenciaDias: String(producto.vigenciaDias ?? ''),
      vigenciaDesde: producto.vigenciaDesde ?? '',
      vigenciaHasta: producto.vigenciaHasta ?? '',
    });
    // La oferta y el tipo no se editan: el contrato no los acepta.
    this.formulario.controls.ofertaId.disable();
    this.formulario.controls.tipo.disable();
  }

  protected abrirBaja(producto: Producto): void {
    this.prepararPanel({ tipo: 'baja', producto });
  }

  protected cerrarPanel(): void {
    this.panel.set({ tipo: 'ninguno' });
    this.errorAccion.set(null);
    this.intentado.set(false);
  }

  /**
   * "Cancelar" del formulario. El alta oculta "Nuevo producto" mientras esta abierta y lo vuelve a
   * dibujar —un elemento nuevo— al cerrarse: el foco se lleva ahi a mano (WCAG 2.4.3). En la
   * edicion, el "Editar" de la fila sigue en pantalla y la directiva del formulario le devuelve el
   * foco sola.
   */
  protected cancelarFormulario(): void {
    const eraAlta = this.panel().tipo === 'alta';
    this.cerrarPanel();
    if (eraAlta) {
      this.enfocarNuevoProducto();
    }
  }

  /** Foco a "Nuevo producto", que se vuelve a dibujar al cerrar el panel (WCAG 2.4.3). */
  private enfocarNuevoProducto(): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('#boton-nuevo-producto')?.focus(),
      { injector: this.injector },
    );
  }

  protected invalido(campo: keyof typeof this.formulario.controls): boolean {
    const control = this.formulario.controls[campo];
    return control.invalid && (control.touched || this.intentado());
  }

  protected errorDelServidor(campo: string): string {
    return this.errorAccion()?.campos[campo] ?? '';
  }

  /**
   * `aria-describedby` de un campo: su ayuda, si tiene, y su error cuando lo hay —del formulario o
   * del servidor—. Sin esto el lector de pantalla anunciaba "invalido" sin decir por que (WCAG
   * 3.3.1, AKINE-09.02).
   */
  protected descritoPor(
    campo: keyof typeof this.formulario.controls,
    ayuda: string | null = null,
  ): string | null {
    const conError = this.invalido(campo) || this.errorDelServidor(campo) !== '';
    const ids = [ayuda, conError ? `producto-${campo}-error` : null].filter((id) => id !== null);
    return ids.length === 0 ? null : ids.join(' ');
  }

  protected guardar(): void {
    const consultorioId = this.tenant.consultorioId();
    this.intentado.set(true);
    if (consultorioId === null) {
      this.errorAccion.set(errorSinContextoDePase());
      return;
    }
    if (this.formulario.invalid || this.enviando()) {
      return;
    }
    const v = this.formulario.getRawValue();
    const hasta = v.vigenciaHasta.trim();
    this.hastaAntesDeDesde.set(hasta !== '' && hasta < v.vigenciaDesde);
    if (this.hastaAntesDeDesde()) {
      this.errorAccion.set(null);
      return;
    }
    const comun = {
      nombre: v.nombre.trim(),
      descripcion: v.descripcion.trim() || undefined,
      creditos: numeroDeclarado(v.creditos) ?? undefined,
      precio: numeroDeclarado(v.precio.replace(',', '.')) ?? undefined,
      moneda: v.moneda.trim().toUpperCase(),
      vigenciaDias: numeroDeclarado(v.vigenciaDias) ?? undefined,
      vigenciaDesde: v.vigenciaDesde,
    };
    const editado = this.enEdicion();
    this.enviando.set(true);
    this.errorAccion.set(null);
    const pedido$ =
      editado === null
        ? this.api.crearProducto(consultorioId, {
            ...comun,
            tipo: v.tipo,
            ofertaId: Number(v.ofertaId),
            vigenciaHasta: hasta || undefined,
          } as CrearProducto)
        : this.api.editarProducto(consultorioId, editado.id ?? -1, {
            ...comun,
            vigenciaHasta: hasta || undefined,
            limpiarVigenciaHasta: hasta === '' && editado.vigenciaHasta !== undefined,
            version: editado.version ?? 0,
          } as EditarProducto);
    pedido$.subscribe({
      next: (producto) => {
        this.enviando.set(false);
        if (editado === null) {
          this.avisos.exito(esAbono(producto) ? 'Abono creado' : 'Producto creado', {
            descripcion:
              `"${producto.nombre}". Todavía nadie tiene saldo: se vende desde la ficha de la ` +
              'persona, en Pacientes.',
          });
        } else {
          this.avisos.exito('Cambios guardados', {
            descripcion: `"${producto.nombre}". Los pases ya vendidos no cambian.`,
          });
        }
        // El aviso no toma el foco (UX-12): en el alta vuelve a "Nuevo producto"; en la edicion, el
        // panel se lo devuelve a la fila.
        if (editado === null) {
          this.cancelarFormulario();
        } else {
          this.cerrarPanel();
        }
        this.cargar();
      },
      error: (error: unknown) => {
        this.enviando.set(false);
        const traducido = traducirErrorPase(error);
        // El error de `nombre` ya se muestra junto al control: el cartel no lo repite.
        const cartel =
          error instanceof AkineHttpError
            ? error.mensajeSinCampos((campo) => campo === 'nombre')
            : null;
        this.errorAccion.set(cartel === null ? traducido : { ...traducido, mensaje: cartel });
      },
    });
  }

  // ------------------------------------------------------------------ baja

  protected confirmarBaja(motivo: string): void {
    const consultorioId = this.tenant.consultorioId();
    const panel = this.panel();
    if (consultorioId === null || panel.tipo !== 'baja' || this.enviando()) {
      return;
    }
    this.enviando.set(true);
    this.errorAccion.set(null);
    this.api.darDeBajaProducto(consultorioId, panel.producto.id ?? -1, motivo).subscribe({
      next: (producto) => {
        this.enviando.set(false);
        this.avisos.exito('Producto dado de baja', {
          descripcion:
            `"${producto.nombre}" ya no se vende. Los pases vendidos conservan su saldo y su ` +
            'vigencia.',
        });
        // La fila puede desaparecer del listado (sin "dados de baja"): el foco a "Nuevo producto".
        this.cerrarPanel();
        this.enfocarNuevoProducto();
        this.cargar();
      },
      error: (error: unknown) => {
        this.enviando.set(false);
        this.errorAccion.set(traducirErrorPase(error));
      },
    });
  }

  private prepararPanel(panel: Panel): void {
    this.panel.set(panel);
    this.errorAccion.set(null);
    this.hastaAntesDeDesde.set(false);
    this.intentado.set(false);
  }
}
