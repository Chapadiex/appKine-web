import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Pase } from '../../../../api/generated/model/pase';
import { PaseDetalle } from '../../../../api/generated/model/pase-detalle';
import { PersonaResponse } from '../../../../api/generated/model/persona-response';
import { Producto } from '../../../../api/generated/model/producto';
import { ResultadoDeVenta } from '../../../../api/generated/model/resultado-de-venta';
import { PERMISO_COBRO_REGISTER, PERMISO_PASE_MANAGE } from '../../../../core/models/permisos';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { nuevaClaveDeIntento } from '../../../../shared/utils/clave-de-intento';
import { formatearFecha, formatearInstante } from '../../../../shared/utils/instantes';
import {
  cantidadConSigno,
  claseDeEstadoDePase,
  creditosEnPalabras,
  etiquetaDeEstadoDePase,
  etiquetaDeMovimiento,
  importeDePase,
  origenDeMovimiento,
} from '../../models/etiquetas-de-pases';
import { ErrorPase, errorSinContextoDePase, traducirErrorPase } from '../../models/pase-errors';
import { PasesApi } from '../../services/pases-api';

interface Detalle {
  readonly paseId: number;
  readonly datos: PaseDetalle | null;
  readonly error: ErrorPase | null;
}

/**
 * Pases de una persona en la sede, con su ledger, y la venta de uno nuevo (M29, AKINE-08.06:
 * RF-M29-002, RF-M29-009).
 *
 * <p><b>Vender no es cobrar</b> (DP-06): la venta crea el pase con su saldo y <b>una deuda</b> a
 * nombre de la persona. El cobro se registra despues, desde su cuenta corriente, y la pantalla lo
 * dice con un enlace.
 *
 * <p><b>El saldo se explica con los movimientos</b> (CA-M29-009-06): compra +8, tres consumos -1,
 * saldo 5. El ledger es del backend; aca no se suma nada.
 *
 * <p>El reintento de una venta lleva la misma `idempotencyKey`: un doble click o un timeout no
 * venden dos veces (CA-M29-002-06). Cambiar de producto es otro pedido y otra clave.
 */
@Component({
  selector: 'app-pases-de-persona-page',
  imports: [RouterLink, PermisoDirective],
  templateUrl: './pases-de-persona-page.html',
  styleUrl: '../../activity.css',
})
export class PasesDePersonaPage {
  private readonly api = inject(PasesApi);
  private readonly tenant = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);
  private readonly diaDeLaSede = inject(DiaDeLaSede);

  /** De la ruta. `withComponentInputBinding` lo liga solo. */
  readonly personaId = input.required<string>();

  /** La cuenta corriente la lee quien tiene `cobro:register`: el enlace se ofrece solo a ese. */
  protected readonly permisoCobro = PERMISO_COBRO_REGISTER;
  protected readonly estadoDePase = etiquetaDeEstadoDePase;
  protected readonly claseDeEstado = claseDeEstadoDePase;
  protected readonly movimiento = etiquetaDeMovimiento;
  protected readonly origen = origenDeMovimiento;
  protected readonly conSigno = cantidadConSigno;
  protected readonly creditos = creditosEnPalabras;
  protected readonly importe = importeDePase;
  protected readonly fecha = formatearFecha;

  protected readonly persona = signal<PersonaResponse | null>(null);
  protected readonly pases = signal<readonly Pase[] | null>(null);
  protected readonly error = signal<ErrorPase | null>(null);
  protected readonly detalle = signal<Detalle | null>(null);

  protected readonly productos = signal<readonly Producto[]>([]);
  protected readonly errorProductos = signal<ErrorPase | null>(null);
  protected readonly productoElegido = signal('');
  protected readonly enviando = signal(false);
  protected readonly errorVenta = signal<ErrorPase | null>(null);
  protected readonly venta = signal<ResultadoDeVenta | null>(null);

  protected readonly zona = computed(() => this.diaDeLaSede.zona());
  protected readonly nombre = computed(() => {
    const persona = this.persona();
    const texto = [persona?.apellido, persona?.nombre].filter(Boolean).join(', ');
    return texto || `Persona #${this.personaId()}`;
  });
  protected readonly rutaCuentaCorriente = computed(
    () => `/pacientes/${this.personaId()}/cuenta-corriente`,
  );
  /** Sin permisos cargados se muestra todo: el backend decide igual. */
  protected readonly puedeVender = computed(
    () => !this.permisos.cargados() || this.permisos.tiene(PERMISO_PASE_MANAGE),
  );

  private pedido = 0;
  private clave = nuevaClaveDeIntento();

  constructor() {
    effect(() => {
      this.tenant.contextEpoch();
      this.personaId();
      untracked(() => {
        // Otra sede u otra persona: nada de la anterior puede quedar en pantalla.
        this.persona.set(null);
        this.pases.set(null);
        this.detalle.set(null);
        this.venta.set(null);
        this.errorVenta.set(null);
        this.productoElegido.set('');
        this.clave = nuevaClaveDeIntento();
        this.cargar();
        this.cargarProductos();
      });
    });
  }

  private ids(): { consultorioId: number; personaId: number } | null {
    const consultorioId = this.tenant.consultorioId();
    const personaId = Number(this.personaId());
    return consultorioId === null || !Number.isInteger(personaId)
      ? null
      : { consultorioId, personaId };
  }

  protected cargar(): void {
    const ids = this.ids();
    const pedido = ++this.pedido;
    if (ids === null) {
      this.error.set(errorSinContextoDePase());
      return;
    }
    this.error.set(null);
    this.api.pasesDePersona(ids.consultorioId, ids.personaId).subscribe({
      next: (pases) => {
        if (pedido === this.pedido) {
          this.pases.set(pases);
        }
      },
      error: (error: unknown) => {
        if (pedido === this.pedido) {
          this.pases.set([]);
          this.error.set(traducirErrorPase(error));
        }
      },
    });
    // El nombre es ayuda: sin el, la pantalla dice "Persona #id" y sigue.
    this.api.verPersona(ids.personaId).subscribe({
      next: (persona) => {
        if (pedido === this.pedido) {
          this.persona.set(persona);
        }
      },
      error: () => undefined,
    });
  }

  private cargarProductos(): void {
    const ids = this.ids();
    if (ids === null || !this.puedeVender()) {
      return;
    }
    this.errorProductos.set(null);
    this.api.productos(ids.consultorioId).subscribe({
      next: (productos) => this.productos.set(productos.filter((p) => p.active !== false)),
      error: (error: unknown) => {
        this.productos.set([]);
        this.errorProductos.set(traducirErrorPase(error));
      },
    });
  }

  protected vigencia(pase: Pase): string {
    return `Del ${formatearFecha(pase.vigenciaDesde)} al ${formatearFecha(pase.vigenciaHasta)}`;
  }

  protected instante(valor: string | undefined): string {
    return formatearInstante(valor, this.zona()) ?? '';
  }

  // ------------------------------------------------------------------ ledger

  protected verMovimientos(pase: Pase): void {
    const ids = this.ids();
    const paseId = pase.id;
    if (ids === null || paseId === undefined) {
      return;
    }
    this.detalle.set({ paseId, datos: null, error: null });
    this.api.verPase(ids.consultorioId, paseId).subscribe({
      next: (datos) => {
        if (this.detalle()?.paseId === paseId) {
          this.detalle.set({ paseId, datos, error: null });
        }
      },
      error: (error: unknown) => {
        if (this.detalle()?.paseId === paseId) {
          this.detalle.set({ paseId, datos: null, error: traducirErrorPase(error) });
        }
      },
    });
  }

  protected cerrarMovimientos(): void {
    this.detalle.set(null);
  }

  // ------------------------------------------------------------------ venta

  protected elegirProducto(id: string): void {
    this.productoElegido.set(id);
    this.errorVenta.set(null);
    // Otro producto es otro pedido: la clave anterior ya no lo identifica.
    this.clave = nuevaClaveDeIntento();
  }

  protected productoDeLaVenta(): Producto | undefined {
    return this.productos().find((p) => String(p.id) === this.productoElegido());
  }

  protected vender(): void {
    const ids = this.ids();
    if (ids === null) {
      this.errorVenta.set(errorSinContextoDePase());
      return;
    }
    const productoId = Number(this.productoElegido());
    if (this.enviando()) {
      return;
    }
    if (!Number.isInteger(productoId) || productoId <= 0) {
      this.errorVenta.set({
        mensaje: 'Elegi el producto a vender.',
        causa: 'validacion',
        campos: {},
      });
      return;
    }
    this.enviando.set(true);
    this.errorVenta.set(null);
    this.venta.set(null);
    this.api.vender(ids.consultorioId, productoId, ids.personaId, this.clave).subscribe({
      next: (resultado) => {
        this.enviando.set(false);
        this.venta.set(resultado);
        this.productoElegido.set('');
        this.clave = nuevaClaveDeIntento();
        this.cargar();
      },
      error: (error: unknown) => {
        this.enviando.set(false);
        const traducido = traducirErrorPase(error);
        if (traducido.causa === 'clave-reusada') {
          this.clave = nuevaClaveDeIntento();
        }
        this.errorVenta.set(traducido);
      },
    });
  }
}
