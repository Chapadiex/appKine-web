import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, Subscription } from 'rxjs';

import { CatalogoGlobalDeFinanciadoresService } from '../../../../api/generated/api/catalogo-global-de-financiadores.service';
import { ListCatalogoFinanciadoresDePlataformaRequestParams } from '../../../../api/generated/api/catalogo-global-de-financiadores.serviceInterface';
import {
  CatalogoFinanciadorResponse,
  CatalogoFinanciadorResponseTipoEnum,
} from '../../../../api/generated/model/catalogo-financiador-response';
import { CreateFinanciadorRequestTipoEnum } from '../../../../api/generated/model/create-financiador-request';
import { UpdateFinanciadorRequestTipoEnum } from '../../../../api/generated/model/update-financiador-request';
import { PlanCatalogoResponse } from '../../../../api/generated/model/plan-catalogo-response';
import { AccionesDeFila } from '../../../../shared/components/acciones-de-fila/acciones-de-fila';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { textoRequerido } from '../../../../shared/validators/texto-requerido';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import { Icono } from '../../../../shared/components/icono/icono';
import { Pestanas } from '../../../../shared/components/pestanas/pestanas';
import {
  ETIQUETA_PESTANAS_DE_PLATAFORMA,
  PESTANAS_DE_PLATAFORMA,
} from '../../models/pestanas-de-plataforma';
import { releeElCatalogo, traducirErrorCatalogo } from '../../models/catalogo-financiadores-errors';

type FiltroEstado = NonNullable<ListCatalogoFinanciadoresDePlataformaRequestParams['estado']>;
type Tipo = CatalogoFinanciadorResponseTipoEnum;

/** Opciones del tipo. Viven aca porque un feature no importa de otro (ADR-0004). */
const TIPOS: readonly { readonly valor: Tipo; readonly etiqueta: string }[] = [
  { valor: CatalogoFinanciadorResponseTipoEnum.OBRA_SOCIAL, etiqueta: 'Obra social' },
  { valor: CatalogoFinanciadorResponseTipoEnum.PREPAGA, etiqueta: 'Prepaga' },
  { valor: CatalogoFinanciadorResponseTipoEnum.ART, etiqueta: 'ART' },
  { valor: CatalogoFinanciadorResponseTipoEnum.MUTUAL, etiqueta: 'Mutual' },
  { valor: CatalogoFinanciadorResponseTipoEnum.ORGANISMO_PUBLICO, etiqueta: 'Organismo publico' },
  { valor: CatalogoFinanciadorResponseTipoEnum.OTRO, etiqueta: 'Otro' },
];

type Listado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly entradas: readonly CatalogoFinanciadorResponse[] }
  | { readonly tipo: 'error'; readonly mensaje: string };

/** Que formulario o confirmacion esta abierto. Uno a la vez. */
type Panel =
  | { readonly tipo: 'alta-financiador' }
  | { readonly tipo: 'editar-financiador'; readonly entrada: CatalogoFinanciadorResponse }
  | { readonly tipo: 'baja-financiador'; readonly entrada: CatalogoFinanciadorResponse }
  | { readonly tipo: 'alta-plan'; readonly entrada: CatalogoFinanciadorResponse }
  | {
      readonly tipo: 'editar-plan';
      readonly entrada: CatalogoFinanciadorResponse;
      readonly plan: PlanCatalogoResponse;
    }
  | {
      readonly tipo: 'baja-plan';
      readonly entrada: CatalogoFinanciadorResponse;
      readonly plan: PlanCatalogoResponse;
    };

/**
 * Catalogo global de financiadores y planes, para la administracion de plataforma (DP-43, U-12).
 *
 * <p><b>El catalogo no es de ningun centro.</b> Cada centro lo <b>adopta</b> por copia desde su
 * pantalla de financiadores: lo que se edite aca no propaga a las copias, que solo reciben el aviso
 * `actualizacionDisponible`. Por eso esta pantalla no tiene contexto de tenant, igual que las otras
 * dos de la consola.
 *
 * <p>El codigo es inmutable: es el que recibe la copia de cada centro. La edicion no lo incluye.
 * La baja exige motivo y no cascadea ni a los planes ni a las copias ya adoptadas.
 */
@Component({
  selector: 'app-catalogo-financiadores-page',
  imports: [
    AccionesDeFila,
    Ayuda,
    Filtros,
    Icono,
    PanelLateral,
    Pestanas,
    ReactiveFormsModule,
    ConfirmacionConMotivo,
  ],
  templateUrl: './catalogo-financiadores-page.html',
  styleUrl: './catalogo-financiadores-page.css',
})
export class CatalogoFinanciadoresPage {
  private readonly api = inject(CatalogoGlobalDeFinanciadoresService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly pestanasDePlataforma = PESTANAS_DE_PLATAFORMA;
  protected readonly etiquetaDePestanas = ETIQUETA_PESTANAS_DE_PLATAFORMA;
  protected readonly tipos = TIPOS;

  protected readonly busqueda = signal('');
  protected readonly filtroEstado = signal<FiltroEstado>('ACTIVO');
  protected readonly filtroTipo = signal<Tipo | ''>('');
  /** Filtros avanzados (detras del embudo) fuera de su valor por defecto. */
  protected readonly filtrosAvanzadosActivos = computed(
    () => Number(this.filtroEstado() !== 'ACTIVO') + Number(this.filtroTipo() !== ''),
  );
  protected readonly listado = signal<Listado>({ tipo: 'cargando' });
  protected readonly panel = signal<Panel | null>(null);
  protected readonly enviando = signal(false);
  protected readonly exito = signal<string | null>(null);
  protected readonly errorAccion = signal<string | null>(null);
  /**
   * Cuenta los envios rechazados por el formulario. `markAllAsTouched` no es un signal y con
   * OnPush no re-renderiza: leer esto desde {@link invalido} es lo que hace aparecer los errores.
   */
  private readonly intentos = signal(0);

  /** El plan con el panel abierto, para marcar su fila mientras se edita o se da de baja. */
  protected readonly planEnPanel = computed(() => {
    const panel = this.panel();
    return panel?.tipo === 'editar-plan' || panel?.tipo === 'baja-plan' ? panel.plan.id : null;
  });

  protected readonly entradas = computed(() => {
    const actual = this.listado();
    return actual.tipo === 'listo' ? actual.entradas : [];
  });
  protected readonly errorDeListado = computed(() => {
    const actual = this.listado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  protected readonly formularioFinanciador = this.formBuilder.nonNullable.group({
    codigo: ['', [textoRequerido]],
    nombre: ['', [textoRequerido]],
    tipo: ['', [Validators.required]],
    cuit: [''],
    emailContacto: [''],
    telefonoContacto: [''],
    observaciones: [''],
  });

  protected readonly formularioPlan = this.formBuilder.nonNullable.group({
    codigo: ['', [textoRequerido]],
    nombre: ['', [textoRequerido]],
    descripcion: [''],
    vigenciaDesde: ['', [Validators.required]],
    vigenciaHasta: [''],
    requiereAutorizacion: [false],
    requiereCredencial: [false],
  });

  private pedidoDeListado: Subscription | null = null;

  constructor() {
    this.cargar();
  }

  protected cargar(): void {
    this.listado.set({ tipo: 'cargando' });
    const q = this.busqueda().trim();
    const tipo = this.filtroTipo();
    this.pedidoDeListado?.unsubscribe();
    this.pedidoDeListado = this.api
      .listCatalogoFinanciadoresDePlataforma({
        estado: this.filtroEstado(),
        ...(q === '' ? {} : { q }),
        ...(tipo === '' ? {} : { tipo }),
      })
      .subscribe({
        next: (entradas) => this.listado.set({ tipo: 'listo', entradas }),
        error: (error: unknown) =>
          this.listado.set({ tipo: 'error', mensaje: traducirErrorCatalogo(error).mensaje }),
      });
  }

  protected etiquetaDeTipo(tipo: string | undefined): string {
    return TIPOS.find((t) => t.valor === tipo)?.etiqueta ?? tipo ?? '-';
  }

  // -------------------------------------------------------------------------------------
  // Paneles
  // -------------------------------------------------------------------------------------

  protected abrirAltaFinanciador(): void {
    this.formularioFinanciador.reset();
    this.formularioFinanciador.controls.codigo.enable();
    this.abrir({ tipo: 'alta-financiador' });
  }

  protected abrirEdicionFinanciador(entrada: CatalogoFinanciadorResponse): void {
    this.formularioFinanciador.reset({
      codigo: entrada.codigo ?? '',
      nombre: entrada.nombre ?? '',
      tipo: entrada.tipo ?? '',
      cuit: entrada.cuit ?? '',
      emailContacto: entrada.emailContacto ?? '',
      telefonoContacto: entrada.telefonoContacto ?? '',
      observaciones: entrada.observaciones ?? '',
    });
    // Inmutable: es el codigo que recibe la copia de cada centro.
    this.formularioFinanciador.controls.codigo.disable();
    this.abrir({ tipo: 'editar-financiador', entrada });
  }

  protected abrirBajaFinanciador(entrada: CatalogoFinanciadorResponse): void {
    this.abrir({ tipo: 'baja-financiador', entrada });
  }

  protected abrirAltaPlan(entrada: CatalogoFinanciadorResponse): void {
    this.formularioPlan.reset();
    this.formularioPlan.controls.codigo.enable();
    this.abrir({ tipo: 'alta-plan', entrada });
  }

  protected abrirEdicionPlan(
    entrada: CatalogoFinanciadorResponse,
    plan: PlanCatalogoResponse,
  ): void {
    this.formularioPlan.reset({
      codigo: plan.codigo ?? '',
      nombre: plan.nombre ?? '',
      descripcion: plan.descripcion ?? '',
      vigenciaDesde: plan.vigenciaDesde ?? '',
      vigenciaHasta: plan.vigenciaHasta ?? '',
      requiereAutorizacion: plan.requiereAutorizacion ?? false,
      requiereCredencial: plan.requiereCredencial ?? false,
    });
    this.formularioPlan.controls.codigo.disable();
    this.abrir({ tipo: 'editar-plan', entrada, plan });
  }

  protected abrirBajaPlan(entrada: CatalogoFinanciadorResponse, plan: PlanCatalogoResponse): void {
    this.abrir({ tipo: 'baja-plan', entrada, plan });
  }

  protected cerrar(): void {
    this.panel.set(null);
    this.errorAccion.set(null);
  }

  protected invalido(formulario: 'financiador' | 'plan', campo: string): boolean {
    this.intentos();
    const control =
      formulario === 'financiador'
        ? this.formularioFinanciador.get(campo)
        : this.formularioPlan.get(campo);
    return control !== null && control.invalid && (control.touched || control.dirty);
  }

  // -------------------------------------------------------------------------------------
  // Envios
  // -------------------------------------------------------------------------------------

  protected guardarFinanciador(): void {
    const panel = this.panel();
    if (panel === null) return;
    if (this.formularioFinanciador.invalid) {
      this.formularioFinanciador.markAllAsTouched();
      this.intentos.update((n) => n + 1);
      return;
    }
    const v = this.formularioFinanciador.getRawValue();
    const datos = {
      nombre: v.nombre.trim(),
      cuit: opcional(v.cuit),
      emailContacto: opcional(v.emailContacto),
      telefonoContacto: opcional(v.telefonoContacto),
      observaciones: opcional(v.observaciones),
    };
    if (panel.tipo === 'alta-financiador') {
      this.enviar(
        this.api.createCatalogoFinanciador({
          createFinanciadorRequest: {
            codigo: v.codigo.trim(),
            tipo: v.tipo as CreateFinanciadorRequestTipoEnum,
            ...datos,
          },
        }),
        `${datos.nombre} quedo en el catalogo. Los centros ya lo pueden agregar.`,
      );
    } else if (panel.tipo === 'editar-financiador' && panel.entrada.id !== undefined) {
      this.enviar(
        this.api.updateCatalogoFinanciador({
          catalogoId: panel.entrada.id,
          updateFinanciadorRequest: {
            ...datos,
            tipo: v.tipo as UpdateFinanciadorRequestTipoEnum,
            expectedVersion: panel.entrada.version ?? 0,
          },
        }),
        `${datos.nombre} se actualizo. Las copias de los centros no cambian: veran el aviso.`,
      );
    }
  }

  protected guardarPlan(): void {
    const panel = this.panel();
    if (panel === null || (panel.tipo !== 'alta-plan' && panel.tipo !== 'editar-plan')) return;
    const catalogoId = panel.entrada.id;
    if (catalogoId === undefined) return;
    if (this.formularioPlan.invalid) {
      this.formularioPlan.markAllAsTouched();
      this.intentos.update((n) => n + 1);
      return;
    }
    const v = this.formularioPlan.getRawValue();
    const datos = {
      nombre: v.nombre.trim(),
      descripcion: opcional(v.descripcion),
      vigenciaDesde: v.vigenciaDesde,
      vigenciaHasta: opcional(v.vigenciaHasta),
      requiereAutorizacion: v.requiereAutorizacion,
      requiereCredencial: v.requiereCredencial,
    };
    if (panel.tipo === 'alta-plan') {
      this.enviar(
        this.api.createCatalogoPlan({
          catalogoId,
          createPlanCoberturaRequest: { codigo: v.codigo.trim(), ...datos },
        }),
        `El plan ${datos.nombre} quedo en el catalogo.`,
      );
    } else if (panel.plan.id !== undefined) {
      this.enviar(
        this.api.updateCatalogoPlan({
          catalogoId,
          planId: panel.plan.id,
          updatePlanCoberturaRequest: { ...datos, expectedVersion: panel.plan.version ?? 0 },
        }),
        `El plan ${datos.nombre} se actualizo.`,
      );
    }
  }

  protected confirmarBaja(motivo: string): void {
    const panel = this.panel();
    if (panel === null) return;
    const catalogoId = panelEntradaId(panel);
    if (catalogoId === undefined) return;
    if (panel.tipo === 'baja-financiador') {
      this.enviar(
        this.api.deactivateCatalogoFinanciador({
          catalogoId,
          deactivateContractingRequest: { reason: motivo },
        }),
        `${panel.entrada.nombre} se dio de baja del catalogo. Las copias de los centros siguen.`,
      );
    } else if (panel.tipo === 'baja-plan' && panel.plan.id !== undefined) {
      this.enviar(
        this.api.deactivateCatalogoPlan({
          catalogoId,
          planId: panel.plan.id,
          deactivateContractingRequest: { reason: motivo },
        }),
        `El plan ${panel.plan.nombre} se dio de baja del catalogo.`,
      );
    }
  }

  /** Titulo del panel lateral: la operacion y sobre que entrada se hace. */
  protected tituloDelPanel(panel: Panel): string {
    switch (panel.tipo) {
      case 'alta-financiador':
        return 'Nuevo financiador del catálogo';
      case 'editar-financiador':
        return `Editar ${panel.entrada.nombre ?? 'el financiador'}`;
      case 'alta-plan':
        return `Nuevo plan de ${panel.entrada.nombre ?? 'el financiador'}`;
      case 'editar-plan':
        return `Editar el plan ${panel.plan.nombre ?? ''}`;
      case 'baja-financiador':
        return `Dar de baja ${panel.entrada.nombre ?? 'el financiador'}`;
      case 'baja-plan':
        return `Dar de baja el plan ${panel.plan.nombre ?? ''}`;
    }
  }

  // -------------------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------------------

  private abrir(panel: Panel): void {
    this.exito.set(null);
    this.errorAccion.set(null);
    this.panel.set(panel);
  }

  private enviar(pedido: Observable<unknown>, mensaje: string): void {
    if (this.enviando()) return;
    this.enviando.set(true);
    this.errorAccion.set(null);
    pedido.subscribe({
      next: () => {
        this.enviando.set(false);
        this.panel.set(null);
        this.exito.set(mensaje);
        this.cargar();
      },
      error: (error: unknown) => {
        this.enviando.set(false);
        const traducido = traducirErrorCatalogo(error);
        this.errorAccion.set(traducido.mensaje);
        if (releeElCatalogo(traducido.causa)) {
          this.panel.set(null);
          this.cargar();
        }
      },
    });
  }
}

function opcional(valor: string): string | undefined {
  const recortado = valor.trim();
  return recortado === '' ? undefined : recortado;
}

function panelEntradaId(panel: Panel): number | undefined {
  return panel.tipo === 'alta-financiador' ? undefined : panel.entrada.id;
}
