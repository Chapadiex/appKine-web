import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { CuentaCorrienteDeFinanciador } from '../../../../api/generated/model/cuenta-corriente-de-financiador';
import { FinanciadorResponse } from '../../../../api/generated/model/financiador-response';
import { Presentacion } from '../../../../api/generated/model/presentacion';
import { PresentacionesApi } from '../../services/presentaciones-api';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
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
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './presentaciones-page.html',
  styleUrl: '../../billing.css',
})
export class PresentacionesPage {
  private readonly api = inject(PresentacionesApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly estados = ESTADOS_DE_PRESENTACION;
  protected readonly estadoEnPalabras = estadoDePresentacionEnPalabras;
  protected readonly claseDeEstado = claseDeEstadoDePresentacion;
  protected readonly fecha = fechaIsoEnPalabras;

  protected readonly filtro = this.fb.group({
    estado: [''],
    financiadorId: [''],
    desde: [''],
    hasta: [''],
  });

  protected readonly alta = this.fb.group({
    financiadorId: ['', Validators.required],
    periodoDesde: ['', Validators.required],
    periodoHasta: ['', Validators.required],
    moneda: ['ARS', [Validators.required, Validators.pattern(/^[A-Z]{3}$/)]],
  });

  protected readonly estado = signal<EstadoListado>({ tipo: 'cargando' });
  protected readonly financiadores = signal<readonly FinanciadorResponse[]>([]);
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
    this.estado.set({ tipo: 'cargando' });
    this.api
      .buscar(consultorioId, {
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

  protected crear(): void {
    this.altaIntentada.set(true);
    const consultorioId = this.tenantContext.consultorioId();
    const valor = this.alta.getRawValue();
    const financiadorId = aNumero(valor.financiadorId);
    if (this.alta.invalid || consultorioId === null || financiadorId === null) {
      return;
    }
    if (valor.periodoHasta < valor.periodoDesde) {
      this.errorAlta.set({
        mensaje: 'El periodo termina antes de empezar. Revisa las fechas.',
        causa: 'datos-invalidos',
        recargar: false,
      });
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
      error: () => this.financiadores.set([]),
    });
  }
}

function aNumero(valor: string): number | null {
  const n = Number(valor);
  return valor !== '' && Number.isFinite(n) && n > 0 ? n : null;
}
