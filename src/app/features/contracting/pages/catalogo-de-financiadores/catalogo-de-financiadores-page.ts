import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { CatalogoFinanciadorResponse } from '../../../../api/generated/model/catalogo-financiador-response';
import { PERMISO_CONVENIO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { ContractingApi, FiltroTipo } from '../../services/contracting-api';
import { traducirErrorContracting } from '../../models/contracting-errors';
import { TIPOS_DE_FINANCIADOR, etiquetaDeTipo } from '../../models/etiquetas-de-contracting';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import { Paginacion } from '../../../../shared/components/paginacion/paginacion';
import { tablaLocal } from '../../../../shared/components/tabla/tabla-local';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import { Icono } from '../../../../shared/components/icono/icono';
import { Migas } from '../../../../shared/components/migas/migas';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../core/services/avisos.store';

type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly entradas: readonly CatalogoFinanciadorResponse[] }
  | { readonly tipo: 'error'; readonly mensaje: string };

/**
 * Agregar al centro un financiador del catalogo global de la plataforma (DP-43, U-12).
 *
 * <p><b>Adoptar es copiar.</b> El centro recibe una copia propia del financiador y de sus planes
 * activos, con el puntero `catalogoId` como dato informativo: editar el catalogo despues <b>no</b>
 * toca la copia. Por eso la lista dice "el catalogo cambio" y no aplica nada.
 *
 * <p><b>201 y 200 son lo mismo.</b> La adopcion es idempotente: la primera vez crea la copia y
 * despues devuelve la misma (`creado = false`). La pantalla no distingue: navega a los planes de la
 * copia, que es lo que el usuario quiere ver en los dos casos.
 *
 * <p>Las entradas ya adoptadas traen `financiadorAdoptadoId` y enlazan a su copia en lugar de
 * ofrecer adoptarlas otra vez. Cuando no hay copia, el campo viaja <b>ausente</b>, no `null`.
 */
@Component({
  selector: 'app-catalogo-de-financiadores-page',
  imports: [
    CabeceraDePagina,
    Migas,
    ColumnaOrdenable,
    Paginacion,
    Ayuda,
    Filtros,
    Icono,
    RouterLink,
    Alerta,
  ],
  templateUrl: './catalogo-de-financiadores-page.html',
  styleUrl: '../../contracting.css',
})
export class CatalogoDeFinanciadoresPage {
  private readonly api = inject(ContractingApi);
  private readonly router = inject(Router);
  private readonly avisos = inject(AvisosStore);
  private readonly permisos = inject(PermissionsStore);
  private readonly tenantContext = inject(TenantContextStore);

  protected readonly tipos = TIPOS_DE_FINANCIADOR;
  protected readonly etiquetaDeTipo = etiquetaDeTipo;

  protected readonly estado = signal<Estado>({ tipo: 'cargando' });
  protected readonly busqueda = signal('');
  protected readonly filtroTipo = signal<FiltroTipo | ''>('');
  /** Filtros avanzados (detras del embudo) fuera de su valor por defecto. */
  protected readonly filtrosAvanzadosActivos = computed(() => Number(this.filtroTipo() !== ''));
  /** Id de la entrada con una adopcion en vuelo, o `null`. */
  protected readonly adoptando = signal<number | null>(null);
  /** Listado en vuelo: una busqueda nueva lo cancela, para que la respuesta vieja no pise a la nueva. */
  private pedidoDeListado: Subscription | null = null;

  protected readonly puedeAdoptar = computed(() => this.permisos.tiene(PERMISO_CONVENIO_MANAGE));
  protected readonly entradas = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.entradas : [];
  });

  /** Orden y paginado de la lista completa (plan Â§3.4): el catalogo llega entero. */
  protected readonly tabla = tablaLocal(this.entradas, {
    columnas: {
      nombre: (entrada) => entrada.nombre,
      tipo: (entrada) => this.etiquetaDeTipo(entrada.tipo),
      planes: (entrada) => this.cantidadDePlanes(entrada),
      enElCentro: (entrada) => Boolean(entrada.financiadorAdoptadoId),
    },
  });
  protected readonly mensajeError = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  constructor() {
    effect(() => {
      // Otro centro adopta otras cosas: `financiadorAdoptadoId` es de la organizacion del contexto.
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.adoptando.set(null);
        this.cargar();
      });
    });
  }

  protected cargar(): void {
    this.estado.set({ tipo: 'cargando' });
    const q = this.busqueda().trim();
    const tipo = this.filtroTipo();
    this.pedidoDeListado?.unsubscribe();
    this.pedidoDeListado = this.api
      .listarCatalogo({ q: q === '' ? undefined : q, tipo: tipo === '' ? undefined : tipo })
      .subscribe({
        next: (entradas) => this.estado.set({ tipo: 'listo', entradas }),
        error: (error: unknown) =>
          this.estado.set({
            tipo: 'error',
            mensaje: traducirErrorContracting(error, 'financiador').mensaje,
          }),
      });
  }

  protected adoptar(entrada: CatalogoFinanciadorResponse): void {
    const id = entrada.id;
    if (id === undefined || this.adoptando() !== null) {
      return;
    }
    this.adoptando.set(id);
    this.api.adoptarDelCatalogo(id).subscribe({
      next: (adopcion) => {
        this.adoptando.set(null);
        // El aviso vive en el shell: sobrevive a la navegacion a los planes de la copia.
        this.avisos.exito(`${entrada.nombre ?? 'El financiador'} agregado al centro`, {
          descripcion: 'Es una copia propia: los cambios posteriores del catálogo no la modifican.',
        });
        const copia = adopcion.financiador?.id;
        if (copia === undefined) {
          this.cargar();
          return;
        }
        this.router.navigate(['/contratacion', 'financiadores', copia, 'planes']);
      },
      error: (error: unknown) => {
        this.adoptando.set(null);
        // Boton de fila, sin formulario: aviso global con la salida.
        this.avisos.error(`No pudimos agregar ${entrada.nombre ?? 'el financiador'} al centro`, {
          descripcion: traducirErrorContracting(error, 'financiador').mensaje,
          accion: { etiqueta: 'Reintentar', ejecutar: () => this.adoptar(entrada) },
        });
        // Una entrada dada de baja entre la lectura y el click ya no se lista: se relee.
        this.cargar();
      },
    });
  }

  protected cantidadDePlanes(entrada: CatalogoFinanciadorResponse): number {
    return (entrada.planes ?? []).length;
  }
}
