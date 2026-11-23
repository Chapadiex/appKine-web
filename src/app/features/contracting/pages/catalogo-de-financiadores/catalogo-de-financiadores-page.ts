import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, from, of } from 'rxjs';
import { catchError, concatMap, map, toArray } from 'rxjs/operators';

import { CatalogoFinanciadorResponse } from '../../../../api/generated/model/catalogo-financiador-response';
import { PERMISO_CONVENIO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { ContractingApi, FiltroTipo } from '../../services/contracting-api';
import { traducirErrorContracting } from '../../models/contracting-errors';
import { TIPOS_DE_FINANCIADOR, etiquetaDeTipo } from '../../models/etiquetas-de-contracting';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import { PieDeTabla } from '../../../../shared/components/tabla/pie-de-tabla';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { tablaLocal } from '../../../../shared/components/tabla/tabla-local';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import { Icono } from '../../../../shared/components/icono/icono';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { publicarMigas } from '../../../../core/services/migas.store';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';

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
 * despues devuelve la misma (`creado = false`). Por eso agregar varios a la vez es seguro.
 *
 * <p>Tocar una fila abre un panel con los planes de la entrada. Se pueden marcar varias y agregarlas
 * juntas. Las ya adoptadas traen `financiadorAdoptadoId`: no se marcan y el panel lleva a su copia.
 * Cuando no hay copia, el campo viaja <b>ausente</b>, no `null`.
 */
@Component({
  selector: 'app-catalogo-de-financiadores-page',
  imports: [
    CabeceraDePagina,
    ColumnaOrdenable,
    PieDeTabla,
    EstadoVacio,
    Ayuda,
    Filtros,
    Icono,
    Alerta,
    PanelLateral,
  ],
  templateUrl: './catalogo-de-financiadores-page.html',
  styleUrl: '../../contracting.css',
})
export class CatalogoDeFinanciadoresPage {
  /** Ruta de navegacion de la barra superior (UX-13). */
  private readonly migasDeLaBarra = publicarMigas(() => [
    { etiqueta: 'Financiadores', ruta: '/contratacion/financiadores' },
    { etiqueta: 'Catálogo de financiadores' },
  ]);

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
  /**
   * Si el listado mostrado salio de una busqueda o un tipo. La busqueda se aplica con el submit,
   * asi que no alcanza con mirar lo tipeado: un vacio con filtros aplicados ofrece limpiarlos.
   */
  protected readonly hayFiltrosAplicados = signal(false);
  /** Id de la entrada con una adopcion en vuelo, o `null`. */
  protected readonly adoptando = signal<number | null>(null);
  /** Entradas marcadas para agregar juntas. Solo entran las que el centro todavia no tiene. */
  protected readonly seleccionados = signal<ReadonlySet<number>>(new Set());
  /** Agregado en lote en vuelo: bloquea la tabla y el panel hasta que termine. */
  protected readonly agregandoVarios = signal(false);
  /** Entrada abierta en el panel lateral, por id, para que sobreviva a la relectura del listado. */
  protected readonly abierta = signal<number | null>(null);
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
  protected readonly entradaAbierta = computed(
    () => this.entradas().find((entrada) => entrada.id === this.abierta()) ?? null,
  );

  /** Lo que se puede marcar en la pagina visible: sin copia en el centro y con permiso. */
  protected readonly seleccionablesVisibles = computed(() =>
    this.puedeAdoptar()
      ? this.tabla
          .visibles()
          .filter((entrada) => !entrada.financiadorAdoptadoId && entrada.id !== undefined)
          .map((entrada) => entrada.id!)
      : [],
  );
  protected readonly todosVisiblesMarcados = computed(() => {
    const visibles = this.seleccionablesVisibles();
    const marcados = this.seleccionados();
    return visibles.length > 0 && visibles.every((id) => marcados.has(id));
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
        this.seleccionados.set(new Set());
        this.abierta.set(null);
        this.cargar();
      });
    });
  }

  protected cargar(): void {
    this.estado.set({ tipo: 'cargando' });
    const q = this.busqueda().trim();
    const tipo = this.filtroTipo();
    this.hayFiltrosAplicados.set(q !== '' || tipo !== '');
    this.pedidoDeListado?.unsubscribe();
    this.pedidoDeListado = this.api
      .listarCatalogo({ q: q === '' ? undefined : q, tipo: tipo === '' ? undefined : tipo })
      .subscribe({
        next: (entradas) => {
          this.estado.set({ tipo: 'listo', entradas });
          // Lo ya agregado (o lo que dejo de listarse) sale de la seleccion.
          const seleccionables = new Set(
            entradas.filter((e) => !e.financiadorAdoptadoId).map((e) => e.id),
          );
          this.seleccionados.update(
            (actual) => new Set([...actual].filter((id) => seleccionables.has(id))),
          );
        },
        error: (error: unknown) =>
          this.estado.set({
            tipo: 'error',
            mensaje: traducirErrorContracting(error, 'financiador').mensaje,
          }),
      });
  }

  /** Vuelve la busqueda y el tipo a su valor por defecto y relee el catalogo entero. */
  protected limpiarFiltros(): void {
    this.busqueda.set('');
    this.filtroTipo.set('');
    this.cargar();
  }

  protected abrir(entrada: CatalogoFinanciadorResponse): void {
    this.abierta.set(entrada.id ?? null);
  }

  protected cerrarPanel(): void {
    this.abierta.set(null);
  }

  protected alternar(id: number | undefined, marcado: boolean): void {
    if (id === undefined) {
      return;
    }
    this.seleccionados.update((actual) => {
      const nuevo = new Set(actual);
      if (marcado) {
        nuevo.add(id);
      } else {
        nuevo.delete(id);
      }
      return nuevo;
    });
  }

  /** Marca o desmarca todo lo seleccionable de la pagina visible. */
  protected alternarVisibles(marcado: boolean): void {
    const visibles = this.seleccionablesVisibles();
    this.seleccionados.update((actual) => {
      const nuevo = new Set(actual);
      for (const id of visibles) {
        if (marcado) {
          nuevo.add(id);
        } else {
          nuevo.delete(id);
        }
      }
      return nuevo;
    });
  }

  protected limpiarSeleccion(): void {
    this.seleccionados.set(new Set());
  }

  protected irALosPlanes(copia: number): void {
    this.router.navigate(['/contratacion', 'financiadores', copia, 'planes']);
  }

  /**
   * Agrega todas las marcadas, una por una: la adopcion es idempotente y un fallo no frena a las
   * demas. Al final un solo aviso con cuantas entraron y cuales no.
   */
  protected agregarSeleccionados(): void {
    const ids = [...this.seleccionados()];
    if (ids.length === 0 || this.agregandoVarios()) {
      return;
    }
    const nombres = new Map(this.entradas().map((e) => [e.id, e.nombre ?? `#${e.id}`]));
    this.agregandoVarios.set(true);
    from(ids)
      .pipe(
        concatMap((id) =>
          this.api.adoptarDelCatalogo(id).pipe(
            map(() => ({ id, ok: true })),
            catchError(() => of({ id, ok: false })),
          ),
        ),
        toArray(),
      )
      .subscribe((resultados) => {
        this.agregandoVarios.set(false);
        const fallidos = resultados.filter((r) => !r.ok).map((r) => nombres.get(r.id));
        const agregados = resultados.length - fallidos.length;
        if (agregados > 0) {
          this.avisos.exito(
            agregados === 1
              ? '1 financiador agregado al centro'
              : `${agregados} financiadores agregados al centro`,
            { descripcion: 'Cada uno con sus planes. Firmá el convenio para empezar a usarlos.' },
          );
        }
        if (fallidos.length > 0) {
          this.avisos.error('Algunos no se pudieron agregar', {
            descripcion: `${fallidos.join(', ')}. Volvé a intentarlo desde su fila.`,
          });
        }
        this.cargar();
      });
  }

  protected adoptar(entrada: CatalogoFinanciadorResponse): void {
    const id = entrada.id;
    if (id === undefined || this.adoptando() !== null) {
      return;
    }
    this.adoptando.set(id);
    this.api.adoptarDelCatalogo(id).subscribe({
      next: () => {
        this.adoptando.set(null);
        this.avisos.exito(`${entrada.nombre ?? 'El financiador'} agregado al centro`, {
          descripcion: 'Con sus planes. Es una copia propia: el catálogo no la modifica después.',
        });
        // Se queda en el catalogo: el panel pasa a decir "ya esta en el centro" con el enlace.
        this.cargar();
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
