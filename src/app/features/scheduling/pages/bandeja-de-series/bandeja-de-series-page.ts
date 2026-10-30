import { Location } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';

import { ListarSeriesDeTurnosRequestParams } from '../../../../api/generated/api/series-de-turnos.serviceInterface';
import { SerieDeTurnosPage } from '../../../../api/generated/model/serie-de-turnos-page';
import {
  SerieDeTurnosResumen,
  SerieDeTurnosResumenEstadoEnum,
} from '../../../../api/generated/model/serie-de-turnos-resumen';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import { Icono } from '../../../../shared/components/icono/icono';
import {
  FILAS_POR_PAGINA_INICIAL,
  Paginacion,
} from '../../../../shared/components/paginacion/paginacion';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { Pestanas } from '../../../../shared/components/pestanas/pestanas';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import {
  CamposDeSort,
  ordenDeServidor,
} from '../../../../shared/components/tabla/orden-de-servidor';
import { textoDeBusqueda } from '../../../../shared/utils/texto-de-busqueda';
import { ETIQUETA_PESTANAS_DE_AGENDA, pestanasDeAgenda } from '../../models/pestanas-de-agenda';
import { fechaEnPalabras } from '../../models/etiquetas-de-agenda';
import { fechaHoraEnZona } from '../../models/etiquetas-de-turno';
import { ErrorSerie, traducirErrorSerie } from '../../models/series-errors';
import { textoDeDias, textoDeEstadoDeSerie } from '../../models/series';
import { SchedulingApi } from '../../services/scheduling-api';
import { SeriesApi } from '../../services/series-api';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { Alerta } from '../../../../shared/components/alerta/alerta';

/** La ruta que monta esta pantalla. Los filtros se reescriben sobre ella sin navegar. */
const RUTA = '/agenda/series';

/** Valor del filtro que no filtra por estado. No viaja al backend. */
const TODAS = 'TODAS';

type FiltroDeEstado = SerieDeTurnosResumenEstadoEnum | typeof TODAS;

/** La persona por la que se filtra: el id que viaja y el nombre que se muestra. */
interface PersonaFiltrada {
  readonly id: number;
  readonly nombre: string;
}

/**
 * Bandeja de series de turnos de la sede (M12, AKINE E-8).
 *
 * <p>Responde "que series tiene esta sede" o "que series tiene este paciente", la pregunta que E-3
 * dejo sin pantalla porque el contrato no publicaba un listado. Cada fila lleva al detalle de la
 * serie, que es donde se cancela con alcance: la bandeja es solo lectura.
 *
 * <h2>El estado lo calcula el backend</h2>
 *
 * <p>`VIGENTE` y `FINALIZADA` no son una columna: el servidor los deriva de los turnos al leer, y
 * con el mismo instante con que filtra. La pantalla no recalcula nada a partir de
 * `turnosPendientes`, porque dos relojes podrian discrepar justo en el borde.
 *
 * <h2>El nombre del profesional no viene en la fila</h2>
 *
 * <p>`SerieDeTurnosResumen` trae `profesionalId` (la membership) y no su nombre, por decision del
 * backend (§6 del diseno de E-8). Se resuelve con las habilitaciones de cada oferta <b>distinta</b>
 * de la pagina —a lo sumo una lectura por oferta, nunca por fila— y se recuerda mientras dure el
 * contexto. Si no se puede resolver, la celda lo dice en vez de inventar un nombre.
 *
 * <h2>Busqueda y orden en el servidor (DP-45)</h2>
 *
 * <p>El buscador manda `q`, que el backend busca en el paciente (apellido, nombre, documento), la
 * oferta y el profesional. Reemplaza al selector de persona de antes: ya no hace falta elegir a
 * alguien del padron para filtrar. El orden de columna va como `sort`; sin el, mas nuevas primero.
 *
 * <h2>Los filtros viajan en la query</h2>
 *
 * <p>`?estado=` y `?personaId=` para que un refresh o un enlace copiado abran la misma bandeja. Se
 * escriben con `replaceState`, como la recepcion del dia: navegar volveria a disparar el efecto que
 * reinicia todo. Una persona que llega por URL no trae nombre: se toma de la primera fila.
 *
 * <p>Cambiar de organizacion o de sede vacia la tabla antes de pedir la nueva y suelta el filtro de
 * persona: esa persona es de otra organizacion.
 */
@Component({
  selector: 'app-bandeja-de-series-page',
  imports: [
    Ayuda,
    CabeceraDePagina,
    ColumnaOrdenable,
    Filtros,
    Icono,
    RouterLink,
    Paginacion,
    Pestanas,
    Alerta,
    EstadoVacio,
  ],
  templateUrl: './bandeja-de-series-page.html',
  styleUrl: '../../agenda.css',
})
export class BandejaDeSeriesPage {
  /** La ruta ya exigio `turno:read`: las tres pestanas de la agenda estan disponibles. */
  protected readonly pestanas = pestanasDeAgenda(true);
  protected readonly etiquetaDePestanas = ETIQUETA_PESTANAS_DE_AGENDA;

  private readonly series = inject(SeriesApi);
  private readonly agenda = inject(SchedulingApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly location = inject(Location);

  /** De la query. Vacio es `VIGENTE`: lo que el mostrador mira casi siempre. */
  readonly estado = input<string>('');
  /** De la query. */
  readonly personaId = input<string>('');

  protected readonly Estado = SerieDeTurnosResumenEstadoEnum;
  protected readonly TODAS = TODAS;
  protected readonly fechaEnPalabras = fechaEnPalabras;
  protected readonly textoDeDias = textoDeDias;
  protected readonly textoDeEstadoDeSerie = textoDeEstadoDeSerie;

  protected readonly filtroEstado = signal<FiltroDeEstado>(SerieDeTurnosResumenEstadoEnum.VIGENTE);
  /** Filtros avanzados fuera de su valor por defecto (regla de filtros, plan §3.4). */
  protected readonly filtrosAvanzadosActivos = computed(() =>
    Number(this.filtroEstado() !== SerieDeTurnosResumenEstadoEnum.VIGENTE),
  );
  protected readonly persona = signal<PersonaFiltrada | null>(null);
  protected readonly pagina = signal(0);
  /** Filas por pagina (UX-14 §1): viaja como `size`; el backend acota a 100. */
  protected readonly porPagina = signal<number>(FILAS_POR_PAGINA_INICIAL);

  /** Paciente, oferta o profesional (DP-45, `q` del servidor). */
  protected readonly busqueda = signal('');

  /** Orden de la tabla, pedido al servidor: cambiarlo vuelve a la primera pagina (DP-45). */
  protected readonly orden = ordenDeServidor<
    CamposDeSort<ListarSeriesDeTurnosRequestParams['sort']>
  >(() => {
    this.pagina.set(0);
    this.cargar();
  });

  protected readonly resultado = signal<SerieDeTurnosPage | null>(null);
  protected readonly cargando = signal(false);
  protected readonly error = signal<ErrorSerie | null>(null);

  /** Nombres de profesional por oferta: `ofertaId -> (membershipId -> nombre)`. */
  private readonly profesionales = signal<ReadonlyMap<number, ReadonlyMap<number, string>>>(
    new Map(),
  );

  protected readonly filas = computed(() => this.resultado()?.content ?? []);
  protected readonly totalPaginas = computed(() => this.resultado()?.totalPages ?? 0);
  protected readonly total = computed(() => this.resultado()?.totalElements ?? 0);

  /** Hay algo que achica la lista: busqueda, persona o un estado distinto de "Vigentes". */
  protected readonly hayFiltros = computed(
    () =>
      this.busqueda().trim() !== '' ||
      this.persona() !== null ||
      this.filtroEstado() !== SerieDeTurnosResumenEstadoEnum.VIGENTE,
  );

  /** Epoch del contexto con que se abrio la pantalla. Distinto = el usuario cambio de sede. */
  private epochDeApertura: number | null = null;

  constructor() {
    effect(() => {
      const estadoDeLaUrl = this.estado();
      const personaDeLaUrl = this.personaId();
      const epoch = this.tenantContext.contextEpoch();
      untracked(() => {
        if (this.epochDeApertura === null || this.epochDeApertura === epoch) {
          this.epochDeApertura = epoch;
          this.filtroEstado.set(estadoDesdeUrl(estadoDeLaUrl));
          const id = Number(personaDeLaUrl);
          this.persona.set(
            personaDeLaUrl !== '' && Number.isInteger(id) && id > 0 ? { id, nombre: '' } : null,
          );
        } else {
          // Otra sede u otra organizacion: la persona filtrada no es de ahi.
          this.epochDeApertura = epoch;
          this.persona.set(null);
          this.busqueda.set('');
          this.orden.reiniciar();
          this.escribirUrl();
        }
        this.profesionales.set(new Map());
        this.resultado.set(null);
        this.pagina.set(0);
        this.cargar();
      });
    });
  }

  // -------------------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------------------

  protected cargar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      return;
    }
    const estado = this.filtroEstado();
    this.cargando.set(true);
    this.error.set(null);
    this.series
      .listar(consultorioId, {
        estado: estado === TODAS ? undefined : estado,
        personaId: this.persona()?.id,
        q: textoDeBusqueda(this.busqueda()),
        sort: this.orden.sort(),
        page: this.pagina(),
        size: this.porPagina(),
      })
      .subscribe({
        next: (pagina) => {
          this.cargando.set(false);
          this.resultado.set(pagina);
          this.completarNombreDePersona(pagina.content ?? []);
          this.resolverProfesionales(consultorioId, pagina.content ?? []);
        },
        error: (error: unknown) => {
          this.cargando.set(false);
          this.resultado.set(null);
          this.error.set(traducirErrorSerie(error));
        },
      });
  }

  protected cambiarEstado(valor: string): void {
    this.filtroEstado.set(estadoDesdeUrl(valor));
    this.recargarDesdeElPrincipio();
  }

  protected irAPagina(numero: number): void {
    this.pagina.set(numero);
    this.cargar();
  }

  /** Otro tamaño de pagina: vuelve a la primera y relee. */
  protected cambiarPorPagina(cantidad: number): void {
    this.porPagina.set(cantidad);
    this.pagina.set(0);
    this.cargar();
  }

  /** "Limpiar filtros" del estado vacio: busqueda, persona y estado vuelven a su valor inicial. */
  protected limpiarFiltros(): void {
    this.busqueda.set('');
    this.persona.set(null);
    this.filtroEstado.set(SerieDeTurnosResumenEstadoEnum.VIGENTE);
    this.recargarDesdeElPrincipio();
  }

  // -------------------------------------------------------------------------------------
  // Busqueda y filtro por persona
  // -------------------------------------------------------------------------------------

  protected buscar(texto: string): void {
    this.busqueda.set(texto);
    this.pagina.set(0);
    this.cargar();
  }

  /** El filtro por persona llega solo por URL (`?personaId=`, desde otra pantalla). */
  protected quitarPersona(): void {
    this.persona.set(null);
    this.recargarDesdeElPrincipio();
  }

  // -------------------------------------------------------------------------------------
  // Celdas
  // -------------------------------------------------------------------------------------

  protected proximoTurno(fila: SerieDeTurnosResumen): string {
    return fechaHoraEnZona(fila.proximoTurnoInicio, fila.timezone ?? '');
  }

  /** Nombre del profesional, o por que no se muestra. */
  protected profesional(fila: SerieDeTurnosResumen): string {
    if (fila.profesionalId === undefined) {
      return 'Cualquiera de la oferta';
    }
    const nombre = this.profesionales()
      .get(fila.ofertaId ?? -1)
      ?.get(fila.profesionalId);
    return nombre ?? 'Sin nombre disponible';
  }

  // -------------------------------------------------------------------------------------

  private recargarDesdeElPrincipio(): void {
    this.pagina.set(0);
    this.escribirUrl();
    this.cargar();
  }

  private escribirUrl(): void {
    const query = new URLSearchParams();
    if (this.filtroEstado() !== SerieDeTurnosResumenEstadoEnum.VIGENTE) {
      query.set('estado', this.filtroEstado());
    }
    const persona = this.persona();
    if (persona !== null) {
      query.set('personaId', String(persona.id));
    }
    this.location.replaceState(RUTA, query.toString());
  }

  /** Una persona que llego por URL no trae nombre: la primera fila lo tiene. */
  private completarNombreDePersona(filas: readonly SerieDeTurnosResumen[]): void {
    const persona = this.persona();
    const nombre = filas[0]?.personaNombre;
    if (persona !== null && persona.nombre === '' && nombre !== undefined) {
      this.persona.set({ ...persona, nombre });
    }
  }

  /** Una lectura por oferta distinta que todavia no se conoce. Un fallo deja la celda sin nombre. */
  private resolverProfesionales(
    consultorioId: number,
    filas: readonly SerieDeTurnosResumen[],
  ): void {
    const conocidas = this.profesionales();
    const ofertas = [
      ...new Set(
        filas
          .filter((f) => f.profesionalId !== undefined && f.ofertaId !== undefined)
          .map((f) => f.ofertaId as number),
      ),
    ].filter((id) => !conocidas.has(id));
    if (ofertas.length === 0) {
      return;
    }
    const epoch = this.tenantContext.contextEpoch();
    forkJoin(
      ofertas.map((ofertaId) =>
        this.agenda.habilitaciones(consultorioId, ofertaId).pipe(catchError(() => of(null))),
      ),
    ).subscribe((respuestas) => {
      if (epoch !== this.tenantContext.contextEpoch()) {
        return;
      }
      const siguiente = new Map(this.profesionales());
      respuestas.forEach((respuesta, i) => {
        const nombres = new Map<number, string>();
        for (const p of respuesta?.profesionales ?? []) {
          if (p.membershipId !== undefined && p.nombre) {
            nombres.set(p.membershipId, p.nombre);
          }
        }
        siguiente.set(ofertas[i], nombres);
      });
      this.profesionales.set(siguiente);
    });
  }
}

function estadoDesdeUrl(valor: string): FiltroDeEstado {
  if (
    valor === TODAS ||
    valor === SerieDeTurnosResumenEstadoEnum.FINALIZADA ||
    valor === SerieDeTurnosResumenEstadoEnum.CANCELADA
  ) {
    return valor;
  }
  return SerieDeTurnosResumenEstadoEnum.VIGENTE;
}
