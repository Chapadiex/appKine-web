import { Location } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Clase } from '../../../../api/generated/model/clase';
import { PERMISO_CLASE_MANAGE } from '../../../../core/models/permisos';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { ErrorActividad, traducirErrorActividad } from '../../models/actividad-errors';
import {
  diaEnPalabras,
  diasDeLaSemana,
  fechaDeSede,
  horaDeSede,
  instanteDesdeHoraDeSede,
  lugaresLibres,
  lunesDeLaSemana,
  nombreDeClase,
  sumarDiasAFecha,
  textoDeEstadoDeClase,
} from '../../models/clases';
import { RUTA_CLASES, RUTA_NUEVA_CLASE } from '../../models/rutas-de-clases';
import { ActivityApi } from '../../services/activity-api';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import {
  FiltroRapido,
  FiltrosRapidos,
} from '../../../../shared/components/filtros-rapidos/filtros-rapidos';
import { Icono } from '../../../../shared/components/icono/icono';
import { Paginacion } from '../../../../shared/components/paginacion/paginacion';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import { tablaLocal } from '../../../../shared/components/tabla/tabla-local';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

interface DiaDeClases {
  readonly fecha: string;
  readonly clases: readonly Clase[];
}

/**
 * Clases programadas de la sede, por semana (M28, RF-M28-001, RF-M12-010, AKINE-08.01).
 *
 * <p>Muestra los siete dias aunque esten vacios, en la zona de la SEDE: la semana va de lunes a
 * domingo de pared de la sede y viaja como ventana UTC `[lunes 00:00, lunes siguiente 00:00)`. El
 * backend filtra por instante de inicio —"lo que empieza esta semana"—, que es lo que se pinta.
 *
 * <p>Las canceladas se muestran, marcadas: esconderlas deja al mostrador sin nada que decirle a
 * quien llama por una clase que ya no existe. La grilla no nombra participantes: eso es del detalle,
 * detras de `inscripcion:read`.
 */
@Component({
  selector: 'app-clases-de-la-semana-page',
  imports: [
    CabeceraDePagina,
    Ayuda,
    ColumnaOrdenable,
    Filtros,
    FiltrosRapidos,
    Icono,
    Paginacion,
    RouterLink,
    PermisoDirective,
  ],
  templateUrl: './clases-de-la-semana-page.html',
  styleUrl: '../../activity.css',
})
export class ClasesDeLaSemanaPage {
  private readonly api = inject(ActivityApi);
  private readonly tenant = inject(TenantContextStore);
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly location = inject(Location);

  /** `?semana=YYYY-MM-DD`: cualquier dia de la semana a mostrar. */
  readonly semana = input('', { transform: (valor: string | undefined) => valor ?? '' });

  protected readonly PERMISO_CLASE_MANAGE = PERMISO_CLASE_MANAGE;
  protected readonly RUTA_NUEVA_CLASE = RUTA_NUEVA_CLASE;
  protected readonly diaEnPalabras = diaEnPalabras;
  protected readonly textoDeEstado = textoDeEstadoDeClase;
  protected readonly lugaresLibres = lugaresLibres;
  protected readonly nombre = nombreDeClase;

  /** Semana elegida con los botones. Mientras no se elija, manda la URL y, sin ella, hoy. */
  private readonly elegido = signal<string | null>(null);

  /** Lunes de la semana visible. `hoy()` lee la zona de la sede: si resuelve tarde, se corrige solo. */
  protected readonly lunes = computed(() => {
    const elegido = this.elegido();
    if (elegido !== null) {
      return elegido;
    }
    const deLaUrl = this.semana();
    return lunesDeLaSemana(FECHA.test(deLaUrl) ? deLaUrl : this.diaDeLaSede.hoy());
  });
  protected readonly clases = signal<readonly Clase[] | null>(null);
  protected readonly cargando = signal(false);
  protected readonly error = signal<ErrorActividad | null>(null);

  protected readonly zona = computed(() => this.diaDeLaSede.zona());

  protected readonly dias = computed<readonly DiaDeClases[]>(() => {
    const clases = this.clases() ?? [];
    const zona = this.zona();
    return diasDeLaSemana(this.lunes()).map((fecha) => ({
      fecha,
      clases: clases
        .filter((c) => fechaDeSede(c.inicio, zona) === fecha)
        .sort((a, b) => (a.inicio ?? '').localeCompare(b.inicio ?? '')),
    }));
  });

  protected readonly total = computed(() => this.clases()?.length ?? 0);

  protected readonly busqueda = signal('');

  /**
   * Filtro rapido por estado (decidido el 22/10/2026). La semana llega entera del servidor, asi
   * que los conteos se calculan aca; se combina con la busqueda.
   */
  protected readonly filtroDeEstado = signal<string>('todas');

  protected readonly opcionesDeEstado = computed<readonly FiltroRapido[]>(() => {
    const todas = this.clases() ?? [];
    const cuenta = (estado: string) => todas.filter((c) => c.estado === estado).length;
    return [
      { valor: 'todas', etiqueta: 'Todas', cantidad: todas.length },
      { valor: 'PROGRAMADA', etiqueta: 'Programadas', cantidad: cuenta('PROGRAMADA') },
      { valor: 'EN_CURSO', etiqueta: 'En curso', cantidad: cuenta('EN_CURSO') },
      { valor: 'REALIZADA', etiqueta: 'Realizadas', cantidad: cuenta('REALIZADA') },
      { valor: 'CANCELADA', etiqueta: 'Canceladas', cantidad: cuenta('CANCELADA') },
    ];
  });

  /** Las clases de la semana en una sola lista por hora de inicio, filtradas por estado y busqueda. */
  private readonly filas = computed<readonly Clase[]>(() => {
    const texto = this.busqueda().trim().toLowerCase();
    const estado = this.filtroDeEstado();
    return (this.clases() ?? [])
      .filter((c) => estado === 'todas' || c.estado === estado)
      .filter(
        (c) =>
          texto === '' ||
          `${nombreDeClase(c)} ${c.profesionalNombre ?? ''} ${c.espacioNombre ?? ''}`
            .toLowerCase()
            .includes(texto),
      )
      .sort((a, b) => (a.inicio ?? '').localeCompare(b.inicio ?? ''));
  });

  /** Orden y paginado de la lista completa de la semana: el servidor no pagina las clases. */
  protected readonly tabla = tablaLocal(this.filas, {
    porPagina: 10,
    columnas: {
      clase: (c) => nombreDeClase(c),
      fecha: (c) => c.inicio,
      profesional: (c) => c.profesionalNombre,
      cupo: (c) => c.ocupados ?? 0,
      estado: (c) => textoDeEstadoDeClase(c.estado),
    },
  });

  constructor() {
    // Cambiar de sede no puede dejar en pantalla las clases de la anterior; y la ventana depende
    // de la zona, que puede resolver despues del primer pintado.
    effect(() => {
      this.tenant.contextEpoch();
      this.lunes();
      this.zona();
      untracked(() => {
        this.clases.set(null);
        this.cargar();
      });
    });
  }

  protected cargar(): void {
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null) {
      return;
    }
    const lunes = this.lunes();
    const zona = this.zona();
    const desde = instanteDesdeHoraDeSede(lunes, '00:00', zona);
    const hasta = instanteDesdeHoraDeSede(sumarDiasAFecha(lunes, 7), '00:00', zona);
    if (desde === null || hasta === null) {
      return;
    }
    const epoca = this.tenant.contextEpoch();
    this.cargando.set(true);
    this.error.set(null);
    this.api.listar(consultorioId, desde, hasta).subscribe({
      next: (clases) => {
        if (epoca !== this.tenant.contextEpoch() || lunes !== this.lunes()) {
          return;
        }
        this.cargando.set(false);
        this.clases.set(clases);
      },
      error: (error: unknown) => {
        this.cargando.set(false);
        this.error.set(traducirErrorActividad(error));
      },
    });
  }

  protected moverSemana(semanas: number): void {
    this.irA(sumarDiasAFecha(this.lunes(), semanas * 7));
  }

  protected irAHoy(): void {
    this.irA(lunesDeLaSemana(this.diaDeLaSede.hoy()));
  }

  protected elegirFecha(fecha: string): void {
    if (FECHA.test(fecha)) {
      this.irA(lunesDeLaSemana(fecha));
    }
  }

  protected buscar(texto: string): void {
    this.busqueda.set(texto);
  }

  /** "Mie 21/10": el dia de la clase, en la zona de la sede. */
  protected diaCorto(clase: Clase): string {
    const fecha = fechaDeSede(clase.inicio, this.zona());
    return fecha === '' ? '' : diaEnPalabras(fecha);
  }

  protected rango(clase: Clase): string {
    const zona = this.zona();
    return `${horaDeSede(clase.inicio, zona)} a ${horaDeSede(clase.fin, zona)}`;
  }

  /** "Lic. Diaz · Box 2": quien y donde, con lo que el contrato pudo resolver. */
  protected quienYDonde(clase: Clase): string {
    return [clase.profesionalNombre, clase.espacioNombre].filter(Boolean).join(' · ');
  }

  protected ocupacion(clase: Clase): string {
    const capacidad = clase.capacidadEfectiva ?? clase.capacidad ?? 0;
    return `${clase.ocupados ?? 0} de ${capacidad} lugares ocupados`;
  }

  private irA(lunes: string): void {
    this.elegido.set(lunes);
    this.location.replaceState(RUTA_CLASES, `semana=${lunes}`);
  }

  protected readonly domingo = computed(() => sumarDiasAFecha(this.lunes(), 6));
}
