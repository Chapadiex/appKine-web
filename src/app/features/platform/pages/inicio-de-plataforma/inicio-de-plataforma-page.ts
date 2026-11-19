import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { CatalogoClinicoService } from '../../../../api/generated/api/catalogo-clinico.service';
import { PlataformaService } from '../../../../api/generated/api/plataforma.service';
import { CuentasDePlataformaResponse } from '../../../../api/generated/model/cuentas-de-plataforma-response';
import { PanelDePlataformaResponse } from '../../../../api/generated/model/panel-de-plataforma-response';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { Icono, NombreDeIcono } from '../../../../shared/components/icono/icono';
import { formatearInstante } from '../../../../shared/utils/instantes';
import {
  MarcaDeEstado,
  diasRestantes,
  marcaDePedido,
  marcaDeSuscripcion,
} from '../../models/contratacion';
import {
  RUTA_ALTA_DE_CENTRO_DE_PLATAFORMA,
  RUTA_PEDIDOS_DE_PRUEBA_DE_PLATAFORMA,
  RUTA_SOLICITUDES_DE_PLATAFORMA,
  RUTA_SUSCRIPCIONES_DE_PLATAFORMA,
} from '../../models/rutas-de-plataforma';

type Carga<T> =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly datos: T }
  | { readonly tipo: 'error' };

/** Un indicador del panel: un número que lleva a su listado ya filtrado. */
interface Indicador {
  readonly id: string;
  readonly rotulo: string;
  readonly valor: number | null;
  readonly detalle: string;
  readonly icono: NombreDeIcono;
  readonly ruta: string;
  readonly filtro?: Record<string, string>;
  /** Pide atención: se pinta con el tono de aviso cuando el valor es mayor que cero. */
  readonly atencion?: boolean;
}

/**
 * Inicio de la consola de plataforma (19/11/2026). Centro de control: cuántos centros hay y en qué
 * estado, qué necesita atención (pruebas que terminan, pedidos y solicitudes sin resolver, cuentas
 * bloqueadas) y lo último que pasó. Cada número lleva a su listado. Todo sale de la API: no hay
 * indicadores de vencimiento de suscripción, importes ni mensajes porque el producto no los tiene.
 */
@Component({
  selector: 'app-inicio-de-plataforma-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Ayuda, CabeceraDePagina, Icono, RouterLink],
  templateUrl: './inicio-de-plataforma-page.html',
  styleUrl: './inicio-de-plataforma-page.css',
})
export class InicioDePlataformaPage {
  private readonly plataforma = inject(PlataformaService);
  private readonly catalogo = inject(CatalogoClinicoService);

  protected readonly rutaAlta = RUTA_ALTA_DE_CENTRO_DE_PLATAFORMA;
  protected readonly rutaCentros = RUTA_SUSCRIPCIONES_DE_PLATAFORMA;
  protected readonly rutaPedidos = RUTA_PEDIDOS_DE_PRUEBA_DE_PLATAFORMA;

  protected readonly panel = signal<Carga<PanelDePlataformaResponse>>({ tipo: 'cargando' });
  protected readonly cuentas = signal<Carga<CuentasDePlataformaResponse>>({ tipo: 'cargando' });
  protected readonly solicitudesPendientes = signal<number | null>(null);

  protected readonly datos = computed(() => {
    const panel = this.panel();
    return panel.tipo === 'listo' ? panel.datos : null;
  });

  protected readonly hoy = new Intl.DateTimeFormat('es-AR', { dateStyle: 'full' }).format(
    new Date(),
  );

  protected readonly indicadores = computed<readonly Indicador[]>(() => {
    const centros = this.datos()?.centros;
    const cuentas = this.cuentas();
    const conCuentas = cuentas.tipo === 'listo' ? cuentas.datos : null;
    return [
      {
        id: 'activos',
        rotulo: 'Centros activos',
        valor: centros?.activos ?? null,
        detalle: centros ? `de ${centros.total} centros` : '',
        icono: 'edificio',
        ruta: RUTA_SUSCRIPCIONES_DE_PLATAFORMA,
        filtro: { situacion: 'ACTIVA' },
      },
      {
        id: 'en-prueba',
        rotulo: 'En prueba gratis',
        valor: centros?.enPrueba ?? null,
        detalle: centros ? `${centros.pruebaPorVencer} terminan esta semana` : '',
        icono: 'calendario',
        ruta: RUTA_SUSCRIPCIONES_DE_PLATAFORMA,
        filtro: { situacion: 'PRUEBA' },
      },
      {
        id: 'vencidas',
        rotulo: 'Pruebas vencidas',
        valor: centros?.pruebaVencida ?? null,
        detalle: 'en solo lectura hasta contratar',
        icono: 'advertencia',
        ruta: RUTA_SUSCRIPCIONES_DE_PLATAFORMA,
        filtro: { situacion: 'PRUEBA' },
        atencion: true,
      },
      {
        id: 'suspendidos',
        rotulo: 'Suspendidos o cancelados',
        valor: centros ? (centros.suspendidos ?? 0) + (centros.cancelados ?? 0) : null,
        detalle: centros
          ? `${centros.suspendidos} suspendidos · ${centros.cancelados} cancelados`
          : '',
        icono: 'candado',
        ruta: RUTA_SUSCRIPCIONES_DE_PLATAFORMA,
        filtro: { situacion: 'SUSPENDIDA' },
      },
      {
        id: 'pedidos',
        rotulo: 'Pedidos de prueba',
        valor: this.datos()?.pedidosPendientes ?? null,
        detalle: 'pendientes de gestión',
        icono: 'correo',
        ruta: RUTA_PEDIDOS_DE_PRUEBA_DE_PLATAFORMA,
        atencion: true,
      },
      {
        id: 'solicitudes',
        rotulo: 'Solicitudes de catálogo',
        valor: this.solicitudesPendientes(),
        detalle: 'pendientes de revisar',
        icono: 'capas',
        ruta: RUTA_SOLICITUDES_DE_PLATAFORMA,
        atencion: true,
      },
      {
        id: 'cuentas',
        rotulo: 'Cuentas activas',
        valor: conCuentas?.activas ?? null,
        detalle: conCuentas
          ? `${conCuentas.bloqueadas} bloqueadas · ${conCuentas.pendientesDeActivar} sin activar`
          : '',
        icono: 'perfil',
        ruta: RUTA_SUSCRIPCIONES_DE_PLATAFORMA,
      },
    ];
  });

  /** Lo que pide una acción hoy: pruebas vencidas o por vencer, y cuentas bloqueadas. */
  protected readonly pruebas = computed(() =>
    (this.datos()?.pruebasQueTerminan ?? []).map((prueba) => {
      const dias = diasRestantes(prueba.pruebaHasta);
      const vencida = dias !== null && dias <= 0;
      return {
        ...prueba,
        vencida,
        cuando: vencida
          ? `Venció ${this.fecha(prueba.pruebaHasta)}`
          : dias === 1
            ? 'Termina mañana'
            : `Termina en ${dias} días`,
        marca: marcaDeSuscripcion('PRUEBA', vencida),
      };
    }),
  );

  protected readonly cuentasBloqueadas = computed(() => {
    const cuentas = this.cuentas();
    return cuentas.tipo === 'listo' ? (cuentas.datos.bloqueadas ?? 0) : 0;
  });

  constructor() {
    this.cargar();
  }

  protected cargar(): void {
    this.panel.set({ tipo: 'cargando' });
    this.cuentas.set({ tipo: 'cargando' });
    this.plataforma.getPanelDePlataforma().subscribe({
      next: (datos) => this.panel.set({ tipo: 'listo', datos }),
      error: () => this.panel.set({ tipo: 'error' }),
    });
    this.plataforma.getCuentasDePlataforma().subscribe({
      next: (datos) => this.cuentas.set({ tipo: 'listo', datos }),
      error: () => this.cuentas.set({ tipo: 'error' }),
    });
    this.catalogo.listCatalogoSolicitudes({ estado: 'PENDIENTE' }).subscribe({
      next: (lista) => this.solicitudesPendientes.set(lista.length),
      error: () => this.solicitudesPendientes.set(null),
    });
  }

  protected fecha(instante: string | undefined): string {
    return formatearInstante(instante) ?? '';
  }

  protected marcaDeCentro(estado: string | undefined): MarcaDeEstado {
    return marcaDeSuscripcion(estado);
  }

  protected marcaDelPedido(estado: string | undefined): MarcaDeEstado {
    return marcaDePedido(estado as Parameters<typeof marcaDePedido>[0]);
  }

  protected rotuloDeEstado(estado: string | undefined): string {
    return estado ? marcaDeSuscripcion(estado).texto : 'Alta';
  }
}
