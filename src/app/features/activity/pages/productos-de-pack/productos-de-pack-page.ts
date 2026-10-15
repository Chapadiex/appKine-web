import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { CrearProducto } from '../../../../api/generated/model/crear-producto';
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
import { creditosEnPalabras, importeDePase } from '../../models/etiquetas-de-pases';
import { ErrorPase, errorSinContextoDePase, traducirErrorPase } from '../../models/pase-errors';
import { ESQUEMA_POR_PACK, PasesApi } from '../../services/pases-api';

type Panel =
  | { readonly tipo: 'ninguno' }
  | { readonly tipo: 'alta' }
  | { readonly tipo: 'edicion'; readonly producto: Producto }
  | { readonly tipo: 'baja'; readonly producto: Producto };

const PRECIO_VALIDO = /^\d+([.,]\d{1,2})?$/;

/**
 * Catalogo de productos de pack de la sede (M29, AKINE-08.06: RF-M29-001).
 *
 * <p><b>Crear un producto no le da saldo a nadie</b> (CA-M29-001-06): define que se vende —cuantos
 * creditos, a que precio, cuantos dias valen— sobre una oferta que cobra `POR_PACK`. El saldo nace
 * recien con la venta, en la pantalla de pases.
 *
 * <p><b>Editar no cambia lo vendido</b>: cada pase lleva su snapshot. Y <b>la baja no cascadea</b>:
 * los pases ya vendidos conservan saldo y vigencia.
 */
@Component({
  selector: 'app-productos-de-pack-page',
  imports: [ReactiveFormsModule, RouterLink, ConfirmacionConMotivo],
  templateUrl: './productos-de-pack-page.html',
  styleUrl: '../../activity.css',
})
export class ProductosDePackPage {
  private readonly api = inject(PasesApi);
  private readonly tenant = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly creditos = creditosEnPalabras;
  protected readonly importe = importeDePase;
  protected readonly fecha = formatearFecha;

  protected readonly productos = signal<readonly Producto[] | null>(null);
  protected readonly ofertasDePack = signal<readonly OfertaResponse[]>([]);
  private readonly nombresDeOferta = signal<ReadonlyMap<number, string>>(new Map());
  protected readonly incluirBajas = signal(false);
  protected readonly panel = signal<Panel>({ tipo: 'ninguno' });
  protected readonly error = signal<ErrorPase | null>(null);
  protected readonly errorAccion = signal<ErrorPase | null>(null);
  protected readonly aviso = signal<string | null>(null);
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
  protected readonly formularioAbierto = computed(() => {
    const tipo = this.panel().tipo;
    return tipo === 'alta' || tipo === 'edicion';
  });

  protected readonly formulario = this.fb.group({
    ofertaId: ['', Validators.required],
    nombre: ['', [Validators.required, Validators.maxLength(160)]],
    descripcion: ['', Validators.maxLength(500)],
    creditos: ['', [Validators.required, Validators.min(1)]],
    precio: ['', [Validators.required, Validators.pattern(PRECIO_VALIDO)]],
    moneda: ['ARS', [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)]],
    vigenciaDias: ['', [Validators.required, Validators.min(1)]],
    vigenciaDesde: ['', Validators.required],
    vigenciaHasta: [''],
  });

  /** Respuesta mas nueva pedida: una vieja que llega tarde no pisa a la nueva. */
  private pedido = 0;

  constructor() {
    effect(() => {
      this.tenant.contextEpoch();
      untracked(() => {
        // Cambiar de sede no puede dejar productos ni formularios de la anterior.
        this.cerrarPanel();
        this.aviso.set(null);
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
          this.ofertasDePack.set(
            ofertas.filter((o) => o.esquemaCobro === ESQUEMA_POR_PACK && o.estado === 'ACTIVO'),
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
  }

  protected abrirEdicion(producto: Producto): void {
    this.prepararPanel({ tipo: 'edicion', producto });
    this.formulario.reset({
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
  }

  protected abrirBaja(producto: Producto): void {
    this.prepararPanel({ tipo: 'baja', producto });
  }

  protected cerrarPanel(): void {
    this.panel.set({ tipo: 'ninguno' });
    this.errorAccion.set(null);
    this.intentado.set(false);
  }

  protected invalido(campo: keyof typeof this.formulario.controls): boolean {
    const control = this.formulario.controls[campo];
    return control.invalid && (control.touched || this.intentado());
  }

  protected errorDelServidor(campo: string): string {
    return this.errorAccion()?.campos[campo] ?? '';
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
    if (hasta !== '' && hasta < v.vigenciaDesde) {
      this.errorAccion.set({
        mensaje: 'La fecha hasta la que se vende no puede ser anterior a la fecha desde.',
        causa: 'validacion',
        campos: {},
      });
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
        this.aviso.set(
          editado === null
            ? `Se creo "${producto.nombre}". Todavia nadie tiene saldo: se vende desde la ficha de la persona, en Pacientes.`
            : `Se guardo "${producto.nombre}". Los pases ya vendidos no cambian.`,
        );
        this.cerrarPanel();
        this.cargar();
      },
      error: (error: unknown) => {
        this.enviando.set(false);
        this.errorAccion.set(traducirErrorPase(error));
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
        this.aviso.set(
          `"${producto.nombre}" ya no se vende. Los pases vendidos conservan su saldo y su vigencia.`,
        );
        this.cerrarPanel();
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
    this.aviso.set(null);
    this.intentado.set(false);
  }
}
