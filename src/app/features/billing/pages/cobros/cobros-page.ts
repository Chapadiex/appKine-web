import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { BillingApi } from '../../services/billing-api';
import { Cobro } from '../../../../api/generated/model/cobro';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { ErrorCobro, traducirErrorCobro } from '../../models/cobro-errors';
import { instanteEnPalabras, medioEnPalabras } from '../../models/etiquetas-de-cobro';
import { importeEnPalabras } from '../../models/etiquetas-de-obligacion';

/** En cual de los tres estados esta el listado. No es paginado: el backend devuelve un array. */
type EstadoCobros =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly cobros: readonly Cobro[] }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly faltaContexto: boolean };

/**
 * Cobros registrados de un paciente, y la reimpresion de su comprobante (M19, AKINE-07.02).
 *
 * <p>Es la otra mitad de la cuenta corriente: `/pacientes/:personaId/cuenta-corriente` muestra lo
 * que se debe y esta muestra lo que se cobro. <b>Son dos listas y no una sola fusionada</b>, y eso
 * es deliberado: una deuda y un cobro no son el mismo hecho, y mezclarlos en un renglon por fecha
 * es como se termina leyendo un cobro como si fuera una deuda negativa.
 *
 * <h2>Por que hay un detalle si el listado ya trae todo</h2>
 *
 * <p>`GET /cobros/{cobroId}` no agrega campos: agrega <b>frescura</b>. Es la reimpresion, y el
 * requisito de la etapa es literal —"comprobante recuperable sin crear un cobro nuevo"—. Sin ella,
 * un operador que necesita el comprobante otra vez tendria como unica salida volver a registrar el
 * cobro, que es exactamente lo que la clave de idempotencia trata de evitar. Se relee al abrirlo
 * para no reimprimir lo que se cargo en memoria hace veinte minutos.
 *
 * <h2>Aca tampoco se suma plata</h2>
 *
 * <p>No hay un total de lo cobrado. El backend no lo devuelve, y sumar veinte importes en punto
 * flotante produce centavos que no cuadran contra la base: un total inventado en una pantalla de
 * dinero es el numero que despues alguien le dice a un paciente. Lo unico que se hace con un
 * importe es formatearlo.
 */
@Component({
  selector: 'app-cobros-page',
  imports: [RouterLink],
  templateUrl: './cobros-page.html',
  styleUrl: '../../billing.css',
})
export class CobrosPage {
  private readonly api = inject(BillingApi);
  private readonly tenantContext = inject(TenantContextStore);

  /** De la ruta padre. `withComponentInputBinding` lo liga solo. */
  readonly personaId = input.required<string>();

  protected readonly medioEnPalabras = medioEnPalabras;
  protected readonly instanteEnPalabras = instanteEnPalabras;

  protected readonly estado = signal<EstadoCobros>({ tipo: 'cargando' });

  /** El comprobante abierto, releido del servidor. `null` cuando no hay ninguno. */
  protected readonly comprobante = signal<Cobro | null>(null);
  protected readonly abriendo = signal<number | null>(null);
  protected readonly errorDetalle = signal<ErrorCobro | null>(null);

  protected readonly rutaCuenta = computed(() => `/pacientes/${this.personaId()}/cuenta-corriente`);
  protected readonly rutaCobrar = computed(() => `${this.rutaCuenta()}/cobrar`);

  protected readonly cargando = computed(() => this.estado().tipo === 'cargando');

  protected readonly cobros = computed<readonly Cobro[]>(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.cobros : [];
  });

  protected readonly mensajeError = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  protected readonly faltaContexto = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' && actual.faltaContexto;
  });

  protected readonly vacia = computed(
    () => this.estado().tipo === 'listo' && this.cobros().length === 0,
  );

  constructor() {
    effect(() => {
      this.personaId();
      this.tenantContext.contextEpoch();
      untracked(() => {
        // Un comprobante de otra organizacion abierto en pantalla es una fuga de tenant.
        this.comprobante.set(null);
        this.errorDetalle.set(null);
        this.cargar();
      });
    });
  }

  protected cargar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const personaId = this.numeroDePersona();
    if (consultorioId === null || personaId === null) {
      this.estado.set({
        tipo: 'error',
        mensaje:
          'Para ver los cobros hay que saber en que sede estas. Eligi una organizacion y un ' +
          'consultorio, y volve a entrar. Tu sesion sigue abierta.',
        faltaContexto: true,
      });
      return;
    }

    this.estado.set({ tipo: 'cargando' });
    this.api.cobrosDeLaPersona(consultorioId, personaId).subscribe({
      next: (cobros) => this.estado.set({ tipo: 'listo', cobros }),
      error: (error: unknown) => {
        const traducido = traducirErrorCobro(error);
        this.estado.set({
          tipo: 'error',
          mensaje: traducido.mensaje,
          faltaContexto: traducido.causa === 'sin-contexto',
        });
      },
    });
  }

  /** Abre el comprobante releyendolo del servidor. Cerrar y volver a abrir vuelve a releer. */
  protected abrir(cobro: Cobro): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null || cobro.id === undefined) {
      return;
    }

    this.comprobante.set(null);
    this.errorDetalle.set(null);
    this.abriendo.set(cobro.id);

    this.api.verCobro(consultorioId, cobro.id).subscribe({
      next: (fresco) => {
        this.abriendo.set(null);
        this.comprobante.set(fresco);
      },
      error: (error: unknown) => {
        this.abriendo.set(null);
        this.errorDetalle.set(traducirErrorCobro(error));
      },
    });
  }

  protected cerrar(): void {
    this.comprobante.set(null);
    this.errorDetalle.set(null);
  }

  protected esElAbierto(cobro: Cobro): boolean {
    const abierto = this.comprobante();
    return abierto !== null && cobro.id !== undefined && abierto.id === cobro.id;
  }

  /** Un importe con la moneda del propio cobro, nunca con una constante. */
  protected importe(cobro: Cobro, valor: number | undefined): string {
    return importeEnPalabras(valor, cobro.moneda);
  }

  private numeroDePersona(): number | null {
    const id = Number(this.personaId());
    return Number.isFinite(id) && id > 0 ? id : null;
  }
}
