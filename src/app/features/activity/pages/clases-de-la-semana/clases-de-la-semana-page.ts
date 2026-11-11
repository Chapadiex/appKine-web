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
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import {
  FiltroRapido,
  FiltrosRapidos,
} from '../../../../shared/components/filtros-rapidos/filtros-rapidos';
import { Icono } from '../../../../shared/components/icono/icono';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { PieDeTabla } from '../../../../shared/components/tabla/pie-de-tabla';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import { tablaLocal } from '../../../../shared/components/tabla/tabla-local';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Las tres maneras de mirar las clases (10/11/2026). La semana es la de siempre. */
export type VistaDeClases = 'semana' | 'lista' | 'mes';

const VISTAS: readonly { readonly valor: VistaDeClases; readonly etiqueta: string }[] = [
  { valor: 'semana', etiqueta: 'Semana' },
  { valor: 'lista', etiqueta: 'Lista' },
  { valor: 'mes', etiqueta: 'Mes' },
];

/** Seis tonos de actividad (activity.css). Mas actividades repiten tono: el nombre siempre esta escrito. */
const TONOS_DE_ACTIVIDAD = 6;

/** Cuantas clases se nombran en un dia del mes antes de resumir con "+N mas". */
const CLASES_POR_DIA_DEL_MES = 3;

interface DiaDeClases {
  readonly fecha: string;
  readonly clases: readonly Clase[];
}

interface DiaDelMes extends DiaDeClases {
  readonly delMes: boolean;
}

interface OpcionDeFiltro {
  readonly valor: string;
  readonly etiqueta: string;
}

/**
 * Clases programadas de la sede (M28, RF-M28-001, RF-M12-010, AKINE-08.01), en tres vistas
 * (10/11/2026, docs/ux/clases-semana.md): **semana** en columnas por dia, **lista** con orden y
 * paginado, y **mes** con un resumen por dia.
 *
 * <p>Todo en la zona de la SEDE: la semana va de lunes a domingo de pared de la sede y viaja como
 * ventana UTC. El mes pide una sola ventana de seis semanas (el backend admite hasta 62 dias).
 *
 * <p>Las canceladas se muestran, marcadas: esconderlas deja al mostrador sin nada que decirle a
 * quien llama por una clase que ya no existe. Ninguna vista nombra participantes: eso es del
 * detalle, detras de `inscripcion:read`.
 */
@Component({
  selector: 'app-clases-de-la-semana-page',
  imports: [
    CabeceraDePagina,
    Alerta,
    Ayuda,
    ColumnaOrdenable,
    Filtros,
    FiltrosRapidos,
    Icono,
    EstadoVacio,
    PieDeTabla,
    RouterLink,
    PermisoDirective,
  ],
  templateUrl: './clases-de-la-semana-page.html',
  styleUrls: ['../../activity.css', './clases-de-la-semana-page.css'],
})
export class ClasesDeLaSemanaPage {
  private readonly api = inject(ActivityApi);
  private readonly tenant = inject(TenantContextStore);
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly location = inject(Location);

  /** `?semana=YYYY-MM-DD`: cualquier dia del periodo a mostrar. */
  readonly semana = input('', { transform: (valor: string | undefined) => valor ?? '' });
  /** `?vista=semana|lista|mes`. Sin ella, la semana. */
  readonly vista = input('', { transform: (valor: string | undefined) => valor ?? '' });

  protected readonly PERMISO_CLASE_MANAGE = PERMISO_CLASE_MANAGE;
  protected readonly RUTA_NUEVA_CLASE = RUTA_NUEVA_CLASE;
  protected readonly VISTAS = VISTAS;
  protected readonly DIAS_DEL_MES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  protected readonly CLASES_POR_DIA_DEL_MES = CLASES_POR_DIA_DEL_MES;
  protected readonly diaEnPalabras = diaEnPalabras;
  protected readonly textoDeEstado = textoDeEstadoDeClase;
  protected readonly lugaresLibres = lugaresLibres;
  protected readonly nombre = nombreDeClase;

  /** Fecha y vista elegidas con los botones. Mientras no se elijan, manda la URL y, sin ella, hoy. */
  private readonly anclaElegida = signal<string | null>(null);
  private readonly vistaElegida = signal<VistaDeClases | null>(null);

  protected readonly vistaActual = computed<VistaDeClases>(() => {
    const elegida = this.vistaElegida();
    if (elegida !== null) {
      return elegida;
    }
    const deLaUrl = this.vista();
    return deLaUrl === 'lista' || deLaUrl === 'mes' ? deLaUrl : 'semana';
  });

  /** Un dia del periodo visible. `hoy()` lee la zona de la sede: si resuelve tarde, se corrige solo. */
  private readonly ancla = computed(() => {
    const elegida = this.anclaElegida();
    if (elegida !== null) {
      return elegida;
    }
    const deLaUrl = this.semana();
    return FECHA.test(deLaUrl) ? deLaUrl : this.diaDeLaSede.hoy();
  });

  protected readonly lunes = computed(() => lunesDeLaSemana(this.ancla()));
  protected readonly domingo = computed(() => sumarDiasAFecha(this.lunes(), 6));
  protected readonly hoy = computed(() => this.diaDeLaSede.hoy());

  /** Primer dia del mes visible y el lunes con que empieza su calendario. */
  private readonly primeroDelMes = computed(() => `${this.ancla().slice(0, 7)}-01`);
  private readonly lunesDelMes = computed(() => lunesDeLaSemana(this.primeroDelMes()));

  /** `[desde, hasta)` de lo que se pide: la semana, o las seis semanas del calendario del mes. */
  private readonly ventana = computed(() =>
    this.vistaActual() === 'mes'
      ? { desde: this.lunesDelMes(), hasta: sumarDiasAFecha(this.lunesDelMes(), 42) }
      : { desde: this.lunes(), hasta: sumarDiasAFecha(this.lunes(), 7) },
  );

  protected readonly clases = signal<readonly Clase[] | null>(null);
  protected readonly cargando = signal(false);
  protected readonly error = signal<ErrorActividad | null>(null);

  protected readonly zona = computed(() => this.diaDeLaSede.zona());

  protected readonly rotuloDelPeriodo = computed(() => {
    if (this.vistaActual() === 'mes') {
      const [anio, mes] = this.primeroDelMes().split('-').map(Number);
      const nombre = new Date(Date.UTC(anio, mes - 1, 1)).toLocaleDateString('es-AR', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
      return nombre.charAt(0).toUpperCase() + nombre.slice(1);
    }
    return `Semana del ${diaEnPalabras(this.lunes())} al ${diaEnPalabras(this.domingo())}`;
  });

  /** El rango en un telefono: "09/11 – 15/11"; el mes ya es corto. */
  protected readonly rotuloCorto = computed(() =>
    this.vistaActual() === 'mes'
      ? this.rotuloDelPeriodo()
      : `${this.diaYMes(this.lunes())} – ${this.diaYMes(this.domingo())}`,
  );

  protected readonly unidadDelPeriodo = computed(() =>
    this.vistaActual() === 'mes' ? 'Mes' : 'Semana',
  );

  // --- Filtros: busqueda, estado y, detras del embudo, profesional, actividad y lugar ---------

  protected readonly busqueda = signal('');

  /** Filtro rapido por estado (22/10/2026). Los conteos salen de lo que llego. */
  protected readonly filtroDeEstado = signal<string>('todas');
  protected readonly filtroDeProfesional = signal('');
  protected readonly filtroDeActividad = signal('');
  protected readonly filtroDeLugar = signal('');

  protected readonly filtrosActivos = computed(
    () =>
      [this.filtroDeProfesional(), this.filtroDeActividad(), this.filtroDeLugar()].filter(
        (valor) => valor !== '',
      ).length,
  );

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

  /** Profesionales, actividades y lugares de lo que llego: no hace falta otro pedido. */
  protected readonly opcionesDeProfesional = computed(() =>
    opcionesDe(
      this.clases(),
      (c) => c.profesionalId,
      (c) => c.profesionalNombre,
    ),
  );
  protected readonly opcionesDeActividad = computed(() =>
    opcionesDe(
      this.clases(),
      (c) => c.ofertaId,
      (c) => c.ofertaNombre,
    ),
  );
  protected readonly opcionesDeLugar = computed(() =>
    opcionesDe(
      this.clases(),
      (c) => c.espacioId,
      (c) => c.espacioNombre,
    ),
  );

  /** Lo que llego, filtrado y ordenado por hora de inicio. Las tres vistas dibujan esto. */
  private readonly filtradas = computed<readonly Clase[]>(() => {
    const texto = this.busqueda().trim().toLowerCase();
    const estado = this.filtroDeEstado();
    const profesional = this.filtroDeProfesional();
    const actividad = this.filtroDeActividad();
    const lugar = this.filtroDeLugar();
    return (this.clases() ?? [])
      .filter((c) => estado === 'todas' || c.estado === estado)
      .filter((c) => profesional === '' || String(c.profesionalId) === profesional)
      .filter((c) => actividad === '' || String(c.ofertaId) === actividad)
      .filter((c) => lugar === '' || String(c.espacioId) === lugar)
      .filter(
        (c) =>
          texto === '' ||
          `${nombreDeClase(c)} ${c.ofertaNombre ?? ''} ${c.profesionalNombre ?? ''} ${c.espacioNombre ?? ''}`
            .toLowerCase()
            .includes(texto),
      )
      .sort((a, b) => (a.inicio ?? '').localeCompare(b.inicio ?? ''));
  });

  protected readonly total = computed(() => this.clases()?.length ?? 0);
  protected readonly visibles = computed(() => this.filtradas().length);

  /** Clases filtradas por dia de la sede, para la semana y el mes. */
  private readonly porDia = computed(() => {
    const zona = this.zona();
    const mapa = new Map<string, Clase[]>();
    for (const clase of this.filtradas()) {
      const fecha = fechaDeSede(clase.inicio, zona);
      mapa.set(fecha, [...(mapa.get(fecha) ?? []), clase]);
    }
    return mapa;
  });

  protected readonly dias = computed<readonly DiaDeClases[]>(() =>
    diasDeLaSemana(this.lunes()).map((fecha) => ({
      fecha,
      clases: this.porDia().get(fecha) ?? [],
    })),
  );

  protected readonly semanasDelMes = computed<readonly (readonly DiaDelMes[])[]>(() => {
    const mes = this.primeroDelMes().slice(0, 7);
    return Array.from({ length: 6 }, (_, semana) =>
      diasDeLaSemana(sumarDiasAFecha(this.lunesDelMes(), semana * 7)).map((fecha) => ({
        fecha,
        delMes: fecha.startsWith(mes),
        clases: this.porDia().get(fecha) ?? [],
      })),
    ).filter((semana) => semana.some((dia) => dia.delMes));
  });

  /** Orden y paginado de la lista completa de la semana: el servidor no pagina las clases. */
  protected readonly tabla = tablaLocal(this.filtradas, {
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
      this.ventana();
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
    const ventana = this.ventana();
    const zona = this.zona();
    const desde = instanteDesdeHoraDeSede(ventana.desde, '00:00', zona);
    const hasta = instanteDesdeHoraDeSede(ventana.hasta, '00:00', zona);
    if (desde === null || hasta === null) {
      return;
    }
    const epoca = this.tenant.contextEpoch();
    this.cargando.set(true);
    this.error.set(null);
    this.api.listar(consultorioId, desde, hasta).subscribe({
      next: (clases) => {
        if (epoca !== this.tenant.contextEpoch() || ventana !== this.ventana()) {
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

  /** Un periodo para atras o para adelante: una semana, o un mes en la vista Mes. */
  protected mover(paso: number): void {
    if (this.vistaActual() === 'mes') {
      const [anio, mes] = this.primeroDelMes().split('-').map(Number);
      this.irA(new Date(Date.UTC(anio, mes - 1 + paso, 1)).toISOString().slice(0, 10));
    } else {
      this.irA(sumarDiasAFecha(this.lunes(), paso * 7));
    }
  }

  protected irAHoy(): void {
    this.irA(this.diaDeLaSede.hoy());
  }

  protected elegirFecha(fecha: string): void {
    if (FECHA.test(fecha)) {
      this.irA(fecha);
    }
  }

  protected elegirVista(vista: VistaDeClases): void {
    this.vistaElegida.set(vista);
    this.irA(vista === 'mes' ? this.ancla() : this.lunes());
  }

  /** Un dia del mes abre su semana. */
  protected abrirDia(fecha: string): void {
    this.vistaElegida.set('semana');
    this.irA(fecha);
  }

  /** Abre el calendario nativo del rotulo del periodo (Chromium; los demas lo abren al enfocar). */
  protected abrirCalendario(input: HTMLInputElement): void {
    try {
      input.showPicker();
    } catch {
      // Sin showPicker, el clic sobre el input ya lo abre.
    }
  }

  protected buscar(texto: string): void {
    this.busqueda.set(texto);
  }

  /** "Limpiar filtros": sin busqueda, con todas las clases y sin filtros avanzados. */
  protected limpiarFiltros(): void {
    this.busqueda.set('');
    this.filtroDeEstado.set('todas');
    this.limpiarAvanzados();
  }

  protected limpiarAvanzados(): void {
    this.filtroDeProfesional.set('');
    this.filtroDeActividad.set('');
    this.filtroDeLugar.set('');
  }

  /** "Mie 21/10": el dia de la clase, en la zona de la sede. */
  protected diaCorto(clase: Clase): string {
    const fecha = fechaDeSede(clase.inicio, this.zona());
    return fecha === '' ? '' : diaEnPalabras(fecha);
  }

  protected inicio(clase: Clase): string {
    return horaDeSede(clase.inicio, this.zona());
  }

  protected rango(clase: Clase): string {
    const zona = this.zona();
    return `${horaDeSede(clase.inicio, zona)} a ${horaDeSede(clase.fin, zona)}`;
  }

  protected capacidad(clase: Clase): number {
    return clase.capacidadEfectiva ?? clase.capacidad ?? 0;
  }

  protected ocupacion(clase: Clase): string {
    return `${clase.ocupados ?? 0} de ${this.capacidad(clase)} lugares ocupados`;
  }

  protected completa(clase: Clase): boolean {
    return clase.estado === 'PROGRAMADA' && this.capacidad(clase) > 0 && lugaresLibres(clase) === 0;
  }

  /** Tono 1..6 de la actividad: por `ofertaId`, asi no cambia de una semana a otra. */
  protected tono(clase: Clase): number {
    return ((clase.ofertaId ?? 0) % TONOS_DE_ACTIVIDAD) + 1;
  }

  /** "Lunes", "Martes"... del encabezado de cada dia. */
  protected nombreDelDia(fecha: string): string {
    const nombre = diaEnPalabras(fecha).split(' ')[0] ?? '';
    return nombre.charAt(0).toUpperCase() + nombre.slice(1);
  }

  /** "Lun", "Mar", "Mié"... para que las siete cabeceras midan lo mismo. */
  protected nombreCorto(fecha: string): string {
    return this.nombreDelDia(fecha).slice(0, 3);
  }

  protected numeroDelDia(fecha: string): string {
    return String(Number(fecha.slice(8, 10)));
  }

  protected diaYMes(fecha: string): string {
    return `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
  }

  protected cantidad(n: number): string {
    return `${n} ${n === 1 ? 'clase' : 'clases'}`;
  }

  /** Lo que el lector de pantalla dice de un dia del mes. */
  protected descripcionDelDia(dia: DiaDeClases): string {
    const clases = dia.clases.length === 0 ? 'sin clases' : this.cantidad(dia.clases.length);
    return `${diaEnPalabras(dia.fecha)}, ${clases}. Ver la semana`;
  }

  private irA(fecha: string): void {
    this.anclaElegida.set(fecha);
    const vista = this.vistaActual();
    const ancla = vista === 'mes' ? fecha : lunesDeLaSemana(fecha);
    this.location.replaceState(
      RUTA_CLASES,
      vista === 'semana' ? `semana=${ancla}` : `vista=${vista}&semana=${ancla}`,
    );
  }
}

/** Opciones unicas de un filtro, por id, con el nombre que el contrato pudo resolver. */
function opcionesDe(
  clases: readonly Clase[] | null,
  id: (clase: Clase) => number | undefined,
  nombre: (clase: Clase) => string | undefined,
): readonly OpcionDeFiltro[] {
  const opciones = new Map<string, string>();
  for (const clase of clases ?? []) {
    const valor = id(clase);
    if (valor !== undefined && !opciones.has(String(valor))) {
      opciones.set(String(valor), nombre(clase) || `#${valor}`);
    }
  }
  return [...opciones]
    .map(([valor, etiqueta]) => ({ valor, etiqueta }))
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));
}
