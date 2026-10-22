import { DOCUMENT } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { cabeceraDePersona } from '../../../../core/services/cabecera-de-persona';
import { CabeceraDeFicha } from '../../../../shared/components/cabecera-de-ficha/cabecera-de-ficha';
import { RouterLink } from '@angular/router';

import { Pase } from '../../../../api/generated/model/pase';
import { PaginaDeMovimientosDePase } from '../../../../api/generated/model/pagina-de-movimientos-de-pase';
import { PersonaResponse } from '../../../../api/generated/model/persona-response';
import { Producto } from '../../../../api/generated/model/producto';
import { ResultadoDeAnulacionDePase } from '../../../../api/generated/model/resultado-de-anulacion-de-pase';
import { ResultadoDeVenta } from '../../../../api/generated/model/resultado-de-venta';
import {
  PERMISO_COBRO_REGISTER,
  PERMISO_PASE_ADJUST,
  PERMISO_PASE_MANAGE,
} from '../../../../core/models/permisos';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { Paginacion } from '../../../../shared/components/paginacion/paginacion';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import { tablaLocal } from '../../../../shared/components/tabla/tabla-local';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { FocoAlMontar } from '../../../../shared/directives/foco-al-montar.directive';
import { nuevaClaveDeIntento } from '../../../../shared/utils/clave-de-intento';
import { formatearFecha, formatearInstante } from '../../../../shared/utils/instantes';
import {
  avisoDeVigencia,
  cantidadConSigno,
  claseDeEstadoDePase,
  creditosEnPalabras,
  esAbono,
  etiquetaDeEstadoDePase,
  etiquetaDeMovimiento,
  etiquetaDeTipoDePase,
  importeDePase,
  origenDeMovimiento,
  renovacionApagadaPorAutorizante,
} from '../../models/etiquetas-de-pases';
import { ErrorPase, errorSinContextoDePase, traducirErrorPase } from '../../models/pase-errors';
import { MOVIMIENTOS_POR_PAGINA, PasesApi } from '../../services/pases-api';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';

/**
 * El ledger abierto, de a paginas (0.116.0). Mientras llega otra pagina se sigue mostrando la
 * anterior: si la tabla desapareciera, el foco del boton "Siguiente" se perderia con ella.
 */
interface Detalle {
  readonly paseId: number;
  /** El pase tal como se leyo: nombre y saldo del encabezado. */
  readonly pase: Pase;
  /** Pagina pedida, base cero. */
  readonly numero: number;
  readonly pagina: PaginaDeMovimientosDePase | null;
  readonly cargando: boolean;
  readonly error: ErrorPase | null;
}

/** Ajustar el saldo o anular, sobre el pase tal como se leyo (con su `version`). */
type Accion =
  | { readonly tipo: 'ajuste'; readonly pase: Pase }
  | { readonly tipo: 'anulacion'; readonly pase: Pase };

const ENTERO_CON_SIGNO = /^[+-]?\d+$/;

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
 * venden dos veces (CA-M29-002-06). Cambiar de producto o de periodo es otro pedido y otra clave.
 *
 * <p><b>Abonos</b> (AKINE-08.08, RF-M29-007): un producto `ABONO` se vende eligiendo el periodo que
 * cubre; el resto es igual a un pack.
 *
 * <p><b>Ajuste y anulacion</b> (AKINE-08.07, RF-M29-005, RN-M29-002) piden `pase:adjust` y viajan
 * con la `version` del pase leido. Anular anula tambien la deuda de la venta: queda ANULADA en la
 * cuenta corriente, no se borra.
 *
 * <p><b>Renovacion automatica de abonos</b> (AKINE-08.08, 0.116.0): se pide al vender o despues, abono
 * por abono, con `pase:manage` —prenderla es autorizar que el sistema venda el periodo siguiente, con
 * su deuda, a nombre de quien la prende—. Cada periodo renovado es un pase propio que apunta al
 * anterior (`renuevaPaseId`), y la pantalla enlaza los dos. Si el sistema no pudo renovar, la
 * renovacion queda apagada y el motivo se muestra.
 *
 * <p><b>El ledger se lee de a paginas</b> (RF-M29-009, 0.116.0), del movimiento mas viejo al mas
 * nuevo: un pase con historia larga no viaja entero.
 */
@Component({
  selector: 'app-pases-de-persona-page',
  imports: [
    CabeceraDeFicha,
    Ayuda,
    ColumnaOrdenable,
    RouterLink,
    PermisoDirective,
    ConfirmacionConMotivo,
    Paginacion,
    FocoAlMontar,
  ],
  templateUrl: './pases-de-persona-page.html',
  styleUrls: ['../../activity.css', './pases-de-persona.css'],
})
export class PasesDePersonaPage {
  private readonly api = inject(PasesApi);
  private readonly tenant = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly documento = inject(DOCUMENT);

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
  protected readonly tipoDePase = etiquetaDeTipoDePase;
  protected readonly abono = esAbono;

  protected readonly persona = signal<PersonaResponse | null>(null);

  protected readonly cabecera = cabeceraDePersona(() => ({
    personaId: this.personaId(),
    persona: this.persona(),
    nombreAlternativo: this.nombre(),
    actual: 'pases',
  }));
  protected readonly pases = signal<readonly Pase[] | null>(null);
  /**
   * Orden y paginado de la lista completa (plan §3.4). 100 por pagina y no 20: el enlace "renovado
   * desde el periodo…" salta a otra fila de la tabla, y tiene que estar en la misma pagina.
   */
  protected readonly tabla = tablaLocal(
    computed(() => this.pases() ?? []),
    {
      porPagina: 100,
      columnas: {
        pase: (pase) => pase.nombre,
        vigencia: (pase) => pase.vigenciaDesde,
        precio: (pase) => pase.precio,
        estado: (pase) => this.estadoDePase(pase),
      },
    },
  );
  protected readonly error = signal<ErrorPase | null>(null);
  protected readonly detalle = signal<Detalle | null>(null);

  protected readonly productos = signal<readonly Producto[]>([]);
  protected readonly errorProductos = signal<ErrorPase | null>(null);
  protected readonly productoElegido = signal('');
  protected readonly enviando = signal(false);
  protected readonly errorVenta = signal<ErrorPase | null>(null);
  protected readonly venta = signal<ResultadoDeVenta | null>(null);
  protected readonly periodoDesde = signal('');
  protected readonly periodoHasta = signal('');
  protected readonly renovarAlVender = signal(false);

  /** El pase cuya renovacion se esta cambiando, para deshabilitar solo ese boton. */
  protected readonly renovando = signal<number | null>(null);
  protected readonly errorRenovacion = signal<ErrorPase | null>(null);

  protected readonly accion = signal<Accion | null>(null);
  protected readonly ajusteCantidad = signal('');
  protected readonly ajusteMotivo = signal('');
  protected readonly ajusteIntentado = signal(false);
  protected readonly errorAccion = signal<ErrorPase | null>(null);
  protected readonly avisoAccion = signal<string | null>(null);
  protected readonly anulacion = signal<ResultadoDeAnulacionDePase | null>(null);

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
  /**
   * Ajustar y anular son de `pase:adjust` (ORG_ADMIN, CONSULTORIO_ADMIN). A diferencia de vender, no
   * se ofrecen sin permisos cargados: al mostrador no se le muestra lo que no puede hacer.
   */
  protected readonly puedeAjustar = computed(
    () => this.permisos.cargados() && this.permisos.tiene(PERMISO_PASE_ADJUST),
  );
  protected readonly enAjuste = computed(() => {
    const accion = this.accion();
    return accion?.tipo === 'ajuste' ? accion.pase : null;
  });
  protected readonly enAnulacion = computed(() => {
    const accion = this.accion();
    return accion?.tipo === 'anulacion' ? accion.pase : null;
  });
  /** La cantidad escrita, si es un entero distinto de cero; si no, `null`. */
  protected readonly cantidadDelAjuste = computed(() => {
    const texto = this.ajusteCantidad().trim();
    if (!ENTERO_CON_SIGNO.test(texto)) {
      return null;
    }
    const n = Number(texto);
    return n === 0 ? null : n;
  });
  /** El saldo que quedaria, para decirlo antes de enviar. */
  protected readonly saldoResultante = computed(() => {
    const pase = this.enAjuste();
    const cantidad = this.cantidadDelAjuste();
    return pase === null || cantidad === null ? null : (pase.creditosDisponibles ?? 0) + cantidad;
  });
  /** RN-M29-008 y no regalar lo no vendido: entre 0 y los creditos comprados. */
  protected readonly ajusteFueraDeRango = computed(() => {
    const pase = this.enAjuste();
    const saldo = this.saldoResultante();
    return pase !== null && saldo !== null && (saldo < 0 || saldo > (pase.creditosIniciales ?? 0));
  });

  private pedido = 0;
  private pedidoMovimientos = 0;
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
        this.periodoDesde.set('');
        this.periodoHasta.set('');
        this.renovarAlVender.set(false);
        this.renovando.set(null);
        this.errorRenovacion.set(null);
        this.cerrarAccion();
        this.avisoAccion.set(null);
        this.anulacion.set(null);
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
    const desde = formatearFecha(pase.vigenciaDesde);
    const hasta = formatearFecha(pase.vigenciaHasta);
    return esAbono(pase) ? `Periodo del ${desde} al ${hasta}` : `Del ${desde} al ${hasta}`;
  }

  protected avisoDeVigencia(pase: Pase): string | null {
    return avisoDeVigencia(pase, this.diaDeLaSede.hoy());
  }

  /** Ajustable: activo o agotado. El backend ademas exige que siga dentro de su vigencia. */
  protected ajustable(pase: Pase): boolean {
    return pase.estado === 'ACTIVO' || pase.estado === 'AGOTADO';
  }

  /**
   * Lo decide el backend al leer (`Pase.anulable`, 0.111.0): no anulado, sin creditos usados y con la
   * deuda de la venta sin cobros. La pantalla no lo deduce del estado: un pase activo con una
   * asistencia ya no se anula, y ofrecer el boton solo llevaba a un 409.
   */
  protected anulable(pase: Pase): boolean {
    return pase.anulable === true;
  }

  /** Los creditos tomados por asistencias, junto al saldo (`Pase.creditosUsados`, 0.111.0). */
  protected usados(creditosUsados: number): string {
    return creditosUsados === 1 ? '1 usado' : `${creditosUsados} usados`;
  }

  protected instante(valor: string | undefined): string {
    return formatearInstante(valor, this.zona()) ?? '';
  }

  // ------------------------------------------------------------------ ledger

  protected verMovimientos(pase: Pase): void {
    this.cargarMovimientos(pase, 0);
  }

  protected irAPaginaDeMovimientos(numero: number): void {
    const actual = this.detalle();
    if (actual !== null) {
      this.cargarMovimientos(actual.pase, numero);
    }
  }

  /** "Movimientos 21 a 40 de 45": la posicion dicha con texto, no solo con los botones. */
  protected rangoDeMovimientos(pagina: PaginaDeMovimientosDePase): string {
    const total = pagina.totalElements ?? 0;
    const cantidad = (pagina.content ?? []).length;
    if (total <= cantidad) {
      return `${total === 1 ? '1 movimiento' : `${total} movimientos`}, del mas viejo al mas nuevo.`;
    }
    const desde = (pagina.page ?? 0) * (pagina.size ?? MOVIMIENTOS_POR_PAGINA) + 1;
    return `Movimientos ${desde} a ${desde + cantidad - 1} de ${total}, del mas viejo al mas nuevo.`;
  }

  /**
   * Pide una pagina del ledger. Con `alFinal` (despues de un ajuste o una anulacion, que agregan
   * el movimiento mas nuevo) termina en la ultima pagina, que es donde quedo. Una pagina que ya no
   * existe —el pase tenia menos movimientos de los que se creia— tambien lleva a la ultima.
   */
  private cargarMovimientos(pase: Pase, numero: number, alFinal = false): void {
    const ids = this.ids();
    const paseId = pase.id;
    if (ids === null || paseId === undefined) {
      return;
    }
    const pedido = ++this.pedidoMovimientos;
    const anterior = this.detalle();
    this.detalle.set({
      paseId,
      pase,
      numero,
      pagina: anterior?.paseId === paseId ? anterior.pagina : null,
      cargando: true,
      error: null,
    });
    this.api.movimientos(ids.consultorioId, paseId, numero).subscribe({
      next: (pagina) => {
        if (pedido !== this.pedidoMovimientos) {
          return;
        }
        const ultima = Math.max((pagina.totalPages ?? 0) - 1, 0);
        const fueraDeRango = numero > 0 && (pagina.content ?? []).length === 0;
        if ((alFinal || fueraDeRango) && numero !== ultima) {
          this.cargarMovimientos(pase, ultima);
          return;
        }
        this.detalle.set({ paseId, pase, numero, pagina, cargando: false, error: null });
      },
      error: (error: unknown) => {
        if (pedido === this.pedidoMovimientos) {
          this.detalle.set({
            paseId,
            pase,
            numero,
            pagina: null,
            cargando: false,
            error: traducirErrorPase(error),
          });
        }
      },
    });
  }

  /** Despues de una escritura, el ledger abierto se relee en la pagina del movimiento nuevo. */
  private releerMovimientos(pase: Pase): void {
    const actual = this.detalle();
    if (actual === null || actual.paseId !== pase.id) {
      return;
    }
    const total = (actual.pagina?.totalElements ?? 0) + 1;
    const tamano = actual.pagina?.size ?? MOVIMIENTOS_POR_PAGINA;
    this.cargarMovimientos(pase, Math.floor((total - 1) / tamano), true);
  }

  protected cerrarMovimientos(): void {
    this.pedidoMovimientos++;
    this.detalle.set(null);
  }

  // ------------------------------------------------------------------ renovacion de abonos

  protected readonly renovacionApagadaPorAutorizante = renovacionApagadaPorAutorizante;

  /**
   * El periodo que renovo a este, si esta en la lista. Lo dice el backend (`renovadoPorPaseId`,
   * 0.117.0): deducirlo de la lista fallaba cuando el periodo siguiente no estaba cargado.
   */
  protected renovadoPor(pase: Pase): Pase | undefined {
    return pase.renovadoPorPaseId === undefined
      ? undefined
      : (this.pases() ?? []).find((p) => p.id === pase.renovadoPorPaseId);
  }

  /** El periodo que este renueva, si esta en la lista. */
  protected periodoAnterior(pase: Pase): Pase | undefined {
    return pase.renuevaPaseId === undefined
      ? undefined
      : (this.pases() ?? []).find((p) => p.id === pase.renuevaPaseId);
  }

  /**
   * Se configura sobre un abono no anulado que todavia no se renovo: sobre uno ya renovado el
   * backend responde `YA_RENOVADO`, porque la renovacion paso al periodo nuevo.
   */
  protected renovacionConfigurable(pase: Pase): boolean {
    return esAbono(pase) && pase.estado !== 'ANULADO' && pase.renovadoPorPaseId === undefined;
  }

  /** Lleva el foco a la fila de otro periodo de la cadena, sin navegar. */
  protected irAPase(evento: Event, paseId: number | undefined): void {
    evento.preventDefault();
    const fila = this.documento.getElementById(`pase-${paseId}`);
    fila?.focus();
    fila?.scrollIntoView?.({ block: 'nearest' });
  }

  protected cambiarRenovacion(pase: Pase, activa: boolean): void {
    const ids = this.ids();
    if (ids === null) {
      this.errorRenovacion.set(errorSinContextoDePase());
      return;
    }
    if (pase.id === undefined || this.renovando() !== null) {
      return;
    }
    const paseId = pase.id;
    this.renovando.set(paseId);
    this.errorRenovacion.set(null);
    this.avisoAccion.set(null);
    this.anulacion.set(null);
    this.api.configurarRenovacion(ids.consultorioId, paseId, activa, pase.version ?? 0).subscribe({
      next: (actualizado) => {
        this.renovando.set(null);
        this.avisoAccion.set(
          actualizado.renovacionAutomatica
            ? `"${actualizado.nombre}" se va a renovar solo: unos días antes del ` +
                `${formatearFecha(actualizado.vigenciaHasta)} el sistema vende el periodo ` +
                'siguiente, con el precio del producto de ese momento y su propia deuda. No cobra.'
            : `"${actualizado.nombre}" ya no se renueva solo. El periodo actual sigue como estaba.`,
        );
        this.cargar();
      },
      error: (error: unknown) => {
        this.renovando.set(null);
        const traducido = traducirErrorPase(error);
        this.errorRenovacion.set(traducido);
        // Version vieja o ya renovado: el pase en pantalla no es el del servidor.
        if (traducido.causa === 'version-vieja' || traducido.causa === 'pase-no-ajustable') {
          this.cargar();
        }
      },
    });
  }

  // ------------------------------------------------------------------ venta

  protected elegirProducto(id: string): void {
    this.productoElegido.set(id);
    this.errorVenta.set(null);
    // Un abono necesita su periodo: arranca hoy, que es lo mas comun.
    const producto = this.productoDeLaVenta();
    this.periodoDesde.set(producto && esAbono(producto) ? this.diaDeLaSede.hoy() : '');
    this.periodoHasta.set('');
    this.renovarAlVender.set(false);
    // Otro producto es otro pedido: la clave anterior ya no lo identifica.
    this.clave = nuevaClaveDeIntento();
  }

  /** Otro periodo es otro pedido: con la clave anterior el backend responderia 409. */
  protected cambiarPeriodo(campo: 'desde' | 'hasta', valor: string): void {
    (campo === 'desde' ? this.periodoDesde : this.periodoHasta).set(valor);
    this.errorVenta.set(null);
    this.clave = nuevaClaveDeIntento();
  }

  /** Pedir o no la renovacion es otro pedido: con la clave anterior el backend responderia 409. */
  protected cambiarRenovacionAlVender(valor: boolean): void {
    this.renovarAlVender.set(valor);
    this.errorVenta.set(null);
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
      this.errorVenta.set(validacion('Elegí el producto a vender.'));
      return;
    }
    const producto = this.productoDeLaVenta();
    const deAbono = producto !== undefined && esAbono(producto);
    const desde = this.periodoDesde();
    const hasta = this.periodoHasta();
    if (deAbono && desde === '') {
      this.errorVenta.set(validacion('Indica desde que día cubre el abono.'));
      return;
    }
    if (deAbono && hasta !== '' && hasta < desde) {
      this.errorVenta.set(
        validacion('El último día del periodo no puede ser anterior al primero.'),
      );
      return;
    }
    const periodo = deAbono
      ? { desde, hasta: hasta || undefined, renovacionAutomatica: this.renovarAlVender() }
      : undefined;
    this.enviando.set(true);
    this.errorVenta.set(null);
    this.venta.set(null);
    this.api.vender(ids.consultorioId, productoId, ids.personaId, this.clave, periodo).subscribe({
      next: (resultado) => {
        this.enviando.set(false);
        this.venta.set(resultado);
        this.productoElegido.set('');
        this.periodoDesde.set('');
        this.periodoHasta.set('');
        this.renovarAlVender.set(false);
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

  // ------------------------------------------------------------------ ajuste y anulacion

  protected abrirAjuste(pase: Pase): void {
    this.prepararAccion({ tipo: 'ajuste', pase });
  }

  protected abrirAnulacion(pase: Pase): void {
    this.prepararAccion({ tipo: 'anulacion', pase });
  }

  protected cerrarAccion(): void {
    this.accion.set(null);
    this.errorAccion.set(null);
    this.ajusteCantidad.set('');
    this.ajusteMotivo.set('');
    this.ajusteIntentado.set(false);
  }

  protected ajustar(): void {
    const ids = this.ids();
    const pase = this.enAjuste();
    this.ajusteIntentado.set(true);
    if (ids === null) {
      this.errorAccion.set(errorSinContextoDePase());
      return;
    }
    const cantidad = this.cantidadDelAjuste();
    const motivo = this.ajusteMotivo().trim();
    if (
      pase?.id === undefined ||
      cantidad === null ||
      motivo === '' ||
      this.ajusteFueraDeRango() ||
      this.enviando()
    ) {
      return;
    }
    const paseId = pase.id;
    this.enviando.set(true);
    this.errorAccion.set(null);
    this.api
      .ajustarSaldo(ids.consultorioId, paseId, cantidad, motivo, pase.version ?? 0)
      .subscribe({
        next: (datos) => {
          this.enviando.set(false);
          this.cerrarAccion();
          const ajustado = datos.pase ?? pase;
          this.avisoAccion.set(
            `Se ajusto el saldo de "${ajustado.nombre}": ahora tiene ` +
              `${creditosEnPalabras(ajustado.creditosDisponibles)} de ` +
              `${ajustado.creditosIniciales}. El ajuste queda en los movimientos con su motivo.`,
          );
          // El ledger abierto se relee en la pagina donde quedo el ajuste.
          this.releerMovimientos(ajustado);
          this.cargar();
        },
        error: (error: unknown) => this.fallaDeAccion(error),
      });
  }

  protected confirmarAnulacion(motivo: string): void {
    const ids = this.ids();
    const pase = this.enAnulacion();
    if (ids === null) {
      this.errorAccion.set(errorSinContextoDePase());
      return;
    }
    if (pase?.id === undefined || this.enviando()) {
      return;
    }
    const paseId = pase.id;
    this.enviando.set(true);
    this.errorAccion.set(null);
    this.api.anular(ids.consultorioId, paseId, motivo, pase.version ?? 0).subscribe({
      next: (resultado) => {
        this.enviando.set(false);
        this.cerrarAccion();
        this.anulacion.set(resultado);
        this.releerMovimientos(resultado.pase ?? pase);
        this.cargar();
      },
      error: (error: unknown) => this.fallaDeAccion(error),
    });
  }

  private fallaDeAccion(error: unknown): void {
    this.enviando.set(false);
    const traducido = traducirErrorPase(error);
    this.errorAccion.set(traducido);
    // Con la version vieja, el pase en pantalla ya no es el del servidor: se relee.
    if (traducido.causa === 'version-vieja') {
      this.cargar();
    }
  }

  private prepararAccion(accion: Accion): void {
    this.cerrarAccion();
    this.accion.set(accion);
    this.avisoAccion.set(null);
    this.anulacion.set(null);
  }
}

function validacion(mensaje: string): ErrorPase {
  return { mensaje, causa: 'validacion', campos: {} };
}
