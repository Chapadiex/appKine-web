import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { CuentaCorrienteDeFinanciador } from '../../../../api/generated/model/cuenta-corriente-de-financiador';
import { FinanciadorResponse } from '../../../../api/generated/model/financiador-response';
import { Presentacion } from '../../../../api/generated/model/presentacion';
import { PresentacionesApi } from '../../services/presentaciones-api';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { esSinPermiso } from '../../../../core/interceptors/error.interceptor';
import {
  ErrorPresentacion,
  errorSinContexto,
  traducirErrorPresentacion,
} from '../../models/presentacion-errors';
import {
  ESTADOS_DE_PRESENTACION,
  claseDeEstadoDePresentacion,
  estadoDePresentacionEnPalabras,
  fechaIsoEnPalabras,
} from '../../models/etiquetas-de-presentacion';
import { importeEnPalabras } from '../../models/etiquetas-de-obligacion';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import { Icono } from '../../../../shared/components/icono/icono';
import { textoDeBusqueda } from '../../../../shared/utils/texto-de-busqueda';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import { PieDeTabla } from '../../../../shared/components/tabla/pie-de-tabla';
import { tablaLocal } from '../../../../shared/components/tabla/tabla-local';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

type EstadoListado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly lotes: readonly Presentacion[] }
  | { readonly tipo: 'error'; readonly error: ErrorPresentacion };

/**
 * Bandeja de presentaciones a financiadores y alta de un borrador (M21, RF-M21-002, AKINE-07.04).
 *
 * <p>Los filtros son los que el contrato ofrece —estado, financiador y periodo— y se aplican del
 * lado del servidor: no se filtra en memoria lo que el backend ya sabe filtrar. Con un financiador
 * elegido se muestra ademas su cuenta corriente, que el backend calcula (no se suma plata aca).
 *
 * <p>Crear el borrador no agrega prestaciones: lleva al detalle del lote, donde esta la bandeja
 * de elegibles. Asi el armado se hace en un solo lugar y con la revision a la vista.
 */
@Component({
  selector: 'app-presentaciones-page',
  imports: [
    CabeceraDePagina,
    PanelLateral,
    Ayuda,
    Filtros,
    EstadoVacio,
    ColumnaOrdenable,
    PieDeTabla,
    Icono,
    ReactiveFormsModule,
    RouterLink,
    Alerta,
  ],
  templateUrl: './presentaciones-page.html',
  styleUrls: ['../../billing.css', '../../economia.css'],
})
export class PresentacionesPage {
  private readonly api = inject(PresentacionesApi);
  private readonly avisos = inject(AvisosStore);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly estados = ESTADOS_DE_PRESENTACION;
  protected readonly estadoEnPalabras = estadoDePresentacionEnPalabras;
  protected readonly claseDeEstado = claseDeEstadoDePresentacion;
  protected readonly fecha = fechaIsoEnPalabras;

  protected readonly filtro = this.fb.group({
    /** Numero de lote o de factura, buscado en el servidor (DP-45, `q`). No es filtro avanzado. */
    q: [''],
    estado: [''],
    financiadorId: [''],
    desde: [''],
    hasta: [''],
  });

  private readonly valorDelFiltro = toSignal(
    this.filtro.valueChanges.pipe(map(() => this.filtro.getRawValue())),
    { initialValue: this.filtro.getRawValue() },
  );
  /** Filtros avanzados fuera de su valor por defecto (vacio): el contador del embudo. */
  protected readonly filtrosAvanzadosActivos = computed(() => {
    const valor = this.valorDelFiltro();
    return [valor.estado, valor.financiadorId, valor.desde, valor.hasta].filter((v) => v !== '')
      .length;
  });

  protected readonly alta = this.fb.group({
    financiadorId: ['', Validators.required],
    periodoDesde: ['', Validators.required],
    periodoHasta: ['', Validators.required],
    moneda: ['ARS', [Validators.required, Validators.pattern(/^[A-Z]{3}$/)]],
  });

  protected readonly estado = signal<EstadoListado>({ tipo: 'cargando' });
  protected readonly financiadores = signal<readonly FinanciadorResponse[]>([]);

  /** El catalogo de financiadores respondio 403: falta `convenio:read` (DP-36). */
  protected readonly financiadoresSinPermiso = signal(false);
  protected readonly cuenta = signal<CuentaCorrienteDeFinanciador | null>(null);
  protected readonly creando = signal(false);
  protected readonly errorAlta = signal<ErrorPresentacion | null>(null);
  protected readonly altaIntentada = signal(false);

  protected readonly lotes = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.lotes : [];
  });
  protected readonly error = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.error : null;
  });
  protected readonly vacia = computed(
    () => this.estado().tipo === 'listo' && this.lotes().length === 0,
  );
  /** Si la ultima busqueda llevaba texto o algun filtro avanzado: decide el estado vacio. */
  protected readonly conFiltros = signal(false);

  /** La bandeja llega completa del servidor: orden y paginas en el cliente (UX-14). */
  protected readonly tabla = tablaLocal(this.lotes, {
    columnas: {
      numero: (lote) => lote.numero,
      financiador: (lote) => lote.financiadorNombre,
      periodo: (lote) => lote.periodoDesde,
      estado: (lote) => estadoDePresentacionEnPalabras(lote.estado),
      presentado: (lote) => lote.totalPresentado,
      saldo: (lote) => lote.saldo,
    },
  });

  constructor() {
    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        // Cambiar de organizacion no puede dejar lotes ni financiadores de la anterior.
        this.financiadores.set([]);
        this.cuenta.set(null);
        this.errorAlta.set(null);
        this.cargarFinanciadores();
        this.buscar();
      });
    });
  }

  protected buscar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      this.estado.set({ tipo: 'error', error: errorSinContexto() });
      return;
    }

    const valor = this.filtro.getRawValue();
    const financiadorId = aNumero(valor.financiadorId);
    this.conFiltros.set(valor.q.trim() !== '' || this.filtrosAvanzadosActivos() > 0);
    this.estado.set({ tipo: 'cargando' });
    this.api
      .buscar(consultorioId, {
        q: textoDeBusqueda(valor.q),
        estado: valor.estado || undefined,
        financiadorId: financiadorId ?? undefined,
        desde: valor.desde || undefined,
        hasta: valor.hasta || undefined,
      })
      .subscribe({
        next: (lotes) => this.estado.set({ tipo: 'listo', lotes }),
        error: (error: unknown) =>
          this.estado.set({ tipo: 'error', error: traducirErrorPresentacion(error) }),
      });

    this.cuenta.set(null);
    if (financiadorId !== null) {
      this.api.cuentaCorriente(consultorioId, financiadorId).subscribe({
        next: (cuenta) => this.cuenta.set(cuenta),
        // La cuenta corriente es un resumen accesorio: si falla, la bandeja sigue en pie.
        error: () => this.cuenta.set(null),
      });
    }
  }

  /**
   * Vuelve los filtros avanzados a su valor por defecto (y la busqueda, desde el estado vacio) y
   * busca de nuevo.
   */
  protected limpiarFiltros(tambienLaBusqueda = false): void {
    this.filtro.patchValue({
      ...(tambienLaBusqueda ? { q: '' } : {}),
      estado: '',
      financiadorId: '',
      desde: '',
      hasta: '',
    });
    this.buscar();
  }

  /** El panel de alta (refactor UX/UI del 28/10/2026): se abre desde "Nuevo lote". */
  protected readonly altaAbierta = signal(false);

  /** El "hasta" es anterior al "desde": un dato a corregir del campo, no un rechazo. */
  protected readonly periodoInvertido = signal(false);

  protected abrirAlta(): void {
    this.errorAlta.set(null);
    this.periodoInvertido.set(false);
    this.altaAbierta.set(true);
  }

  protected cerrarAlta(): void {
    if (!this.creando()) {
      this.altaAbierta.set(false);
    }
  }

  protected crear(): void {
    this.altaIntentada.set(true);
    const consultorioId = this.tenantContext.consultorioId();
    const valor = this.alta.getRawValue();
    const financiadorId = aNumero(valor.financiadorId);
    if (this.alta.invalid || consultorioId === null || financiadorId === null) {
      return;
    }
    this.periodoInvertido.set(valor.periodoHasta < valor.periodoDesde);
    if (this.periodoInvertido()) {
      return;
    }

    this.creando.set(true);
    this.errorAlta.set(null);
    this.api
      .crear(consultorioId, {
        financiadorId,
        moneda: valor.moneda,
        periodoDesde: valor.periodoDesde,
        periodoHasta: valor.periodoHasta,
      })
      .subscribe({
        next: (creada) => {
          this.creando.set(false);
          // El aviso vive en el shell: sobrevive a la navegacion al detalle del lote.
          this.avisos.exito('Borrador del lote abierto');
          this.router.navigate(['/presentaciones', creada.id]).catch(() => undefined);
        },
        error: (error: unknown) => {
          this.creando.set(false);
          this.errorAlta.set(traducirErrorPresentacion(error));
        },
      });
  }

  protected importe(lote: Presentacion, valor: number | undefined): string {
    return importeEnPalabras(valor, lote.moneda);
  }

  protected importeDeCuenta(valor: number | undefined): string {
    return importeEnPalabras(valor, undefined);
  }

  protected campoInvalido(
    nombre: 'financiadorId' | 'periodoDesde' | 'periodoHasta' | 'moneda',
  ): boolean {
    return this.altaIntentada() && this.alta.controls[nombre].invalid;
  }

  private cargarFinanciadores(): void {
    this.api.financiadoresActivos().subscribe({
      next: (lista) => this.financiadores.set(lista),
      // Sin la lista no se puede filtrar ni crear por financiador, pero la bandeja se lee igual.
      error: (error: unknown) => {
        this.financiadores.set([]);
        this.financiadoresSinPermiso.set(esSinPermiso(error));
      },
    });
  }
}

function aNumero(valor: string): number | null {
  const n = Number(valor);
  return valor !== '' && Number.isFinite(n) && n > 0 ? n : null;
}
