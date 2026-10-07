import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

import { Agenda } from '../../../../api/generated/model/agenda';
import { CrearSerieDeTurnos } from '../../../../api/generated/model/crear-serie-de-turnos';
import { PersonaResponse } from '../../../../api/generated/model/persona-response';
import { ProfesionalHabilitado } from '../../../../api/generated/model/profesional-habilitado';
import { SerieDeTurnos } from '../../../../api/generated/model/serie-de-turnos';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { SchedulingApi } from '../../services/scheduling-api';
import { SeriesApi } from '../../services/series-api';
import { fechaEnPalabras, horaEnZona, sumarDias } from '../../models/etiquetas-de-agenda';
import { fechaHoraEnZona, textoDeEstado } from '../../models/etiquetas-de-turno';
import { ErrorSerie, traducirErrorSerie } from '../../models/series-errors';
import {
  DIAS_DE_LA_SEMANA,
  MAXIMO_OCURRENCIAS,
  OcurrenciaPrevista,
  clasificarOcurrencias,
  diaIso,
  expandirRegla,
  fechaEnZona,
  textoDeDias,
  ventanasDeAgenda,
} from '../../models/series';

/** Cuanto se espera despues de la ultima tecla antes de consultar el padron. */
const ESPERA_DE_BUSQUEDA_MS = 300;

/** Cantidad que se propone al abrir: dos meses de una sesion semanal. */
const CANTIDAD_INICIAL = 8;

type ModoDeFin = 'cantidad' | 'fecha';

/**
 * Alta de una serie semanal de turnos (M12, AKINE E-3, DP-04).
 *
 * <p>Llega desde la reserva de un turno con la oferta, el dia, el instante y el profesional del
 * slot elegido, y propone una serie que <b>repite ese horario</b>: el mismo dia de la semana, la
 * misma hora, ocho semanas. El operador ajusta dias, hora, inicio y fin.
 *
 * <h2>1. El backend reserva todas o ninguna, y no ofrece previsualizacion del alta</h2>
 *
 * <p>Si una sola ocurrencia no tiene lugar, el 409 la nombra en `ocurrenciaInicio` y no se crea
 * nada. Mandar la serie a ciegas seria descubrir los choques de a uno, con un viaje por cada uno.
 * Por eso la pantalla <b>previsualiza leyendo la agenda</b> de todas las fechas —de a 62 dias, que
 * es lo que acepta el endpoint— y marca las que no tienen un horario libre a esa hora. El boton de
 * reservar se habilita solo cuando todas se ven libres.
 *
 * <p>La previsualizacion es una lectura y puede quedar vieja: el backend revalida bajo el lock de
 * sede. Si rechaza igual, la fecha que nombra queda marcada en la tabla.
 *
 * <h2>2. Cualquier cambio en la regla invalida la previsualizacion y la clave</h2>
 *
 * <p>Otra regla es otro intento: reusar la clave de idempotencia con otro contenido es exactamente
 * el 409 `idempotency-key-conflict`, y confirmar una previsualizacion de otra regla seria reservar
 * fechas que nadie miro.
 */
@Component({
  selector: 'app-serie-de-turnos-alta-page',
  imports: [RouterLink],
  templateUrl: './serie-de-turnos-alta-page.html',
  styleUrl: '../../agenda.css',
})
export class SerieDeTurnosAltaPage {
  private readonly agendaApi = inject(SchedulingApi);
  private readonly seriesApi = inject(SeriesApi);
  private readonly tenantContext = inject(TenantContextStore);

  /** De la ruta. `withComponentInputBinding` los liga solos. */
  readonly ofertaId = input.required<string>();
  readonly fecha = input<string>('');
  readonly inicio = input<string>('');
  readonly profesionalId = input<string>('');

  protected readonly dias = DIAS_DE_LA_SEMANA;
  protected readonly maximo = MAXIMO_OCURRENCIAS;
  protected readonly fechaEnPalabras = fechaEnPalabras;
  protected readonly textoDeEstado = textoDeEstado;
  protected readonly textoDeDias = textoDeDias;

  protected readonly agenda = signal<Agenda | null>(null);
  protected readonly profesionales = signal<readonly ProfesionalHabilitado[]>([]);

  protected readonly persona = signal<PersonaResponse | null>(null);
  protected readonly candidatas = signal<readonly PersonaResponse[]>([]);
  protected readonly buscoPersonas = signal(false);
  private busquedaPendiente: ReturnType<typeof setTimeout> | undefined;

  // La regla
  protected readonly diasSemana = signal<readonly number[]>([]);
  protected readonly hora = signal('');
  protected readonly fechaDesde = signal('');
  protected readonly modoDeFin = signal<ModoDeFin>('cantidad');
  protected readonly cantidad = signal(CANTIDAD_INICIAL);
  protected readonly fechaHasta = signal('');

  protected readonly previsualizacion = signal<readonly OcurrenciaPrevista[] | null>(null);
  protected readonly previsualizando = signal(false);
  protected readonly aviso = signal('');

  protected readonly serie = signal<SerieDeTurnos | null>(null);
  protected readonly enviando = signal(false);
  protected readonly error = signal<ErrorSerie | null>(null);

  private readonly claveDeIntento = signal('');

  protected readonly timezone = computed(() => this.agenda()?.timezone ?? '');
  protected readonly nombreComercial = computed(() => this.agenda()?.nombreComercial ?? '');

  protected readonly nombreDelProfesional = computed(() => {
    const id = this.numeroDeProfesional();
    if (id === null) {
      return '';
    }
    return this.profesionales().find((p) => p.membershipId === id)?.nombre ?? `#${id}`;
  });

  protected readonly conflictos = computed(
    () => (this.previsualizacion() ?? []).filter((o) => o.estado !== 'libre').length,
  );

  /** Fecha local de la ocurrencia que el backend rechazo, para marcarla en la tabla. */
  protected readonly fechaRechazada = computed(() =>
    fechaEnZona(this.error()?.ocurrenciaInicio, this.timezone()),
  );

  protected readonly puedeReservar = computed(() => {
    const prevista = this.previsualizacion();
    return (
      this.persona() !== null &&
      prevista !== null &&
      prevista.length > 0 &&
      this.conflictos() === 0 &&
      !this.enviando()
    );
  });

  constructor() {
    effect(() => {
      const fecha = this.fecha();
      this.ofertaId();
      this.inicio();
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.persona.set(null);
        this.candidatas.set([]);
        this.serie.set(null);
        this.fechaDesde.set(fecha);
        this.diasSemana.set(fecha === '' ? [] : [diaIso(fecha)]);
        this.hora.set('');
        this.invalidar();
        this.cargarOferta();
      });
    });
  }

  // -------------------------------------------------------------------------------------
  // Lectura inicial
  // -------------------------------------------------------------------------------------

  /** Lee el dia del slot de origen: de ahi salen la zona, el nombre y la hora propuesta. */
  private cargarOferta(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const ofertaId = this.numeroDeOferta();
    const fecha = this.fecha();
    if (consultorioId === null || ofertaId === null || fecha === '') {
      return;
    }

    this.agendaApi
      .buscarAgenda(consultorioId, ofertaId, { desde: fecha, hasta: sumarDias(fecha, 1) })
      .subscribe({
        next: (agenda) => {
          this.agenda.set(agenda);
          if (this.hora() === '') {
            this.hora.set(horaEnZona(this.inicio(), agenda.timezone ?? ''));
          }
        },
        error: (error: unknown) => this.error.set(traducirErrorSerie(error)),
      });

    this.agendaApi.habilitaciones(consultorioId, ofertaId).subscribe({
      next: (respuesta) => this.profesionales.set(respuesta.profesionales ?? []),
      error: () => this.profesionales.set([]),
    });
  }

  // -------------------------------------------------------------------------------------
  // A quien se le reserva. Mismo patron que la reserva suelta: `input` con debounce.
  // -------------------------------------------------------------------------------------

  protected buscarPersona(texto: string): void {
    clearTimeout(this.busquedaPendiente);
    if (texto.trim() === '') {
      this.candidatas.set([]);
      this.buscoPersonas.set(false);
      return;
    }
    this.busquedaPendiente = setTimeout(() => {
      this.agendaApi.buscarPersonas(texto).subscribe({
        next: (pagina) => {
          this.candidatas.set(pagina.content ?? []);
          this.buscoPersonas.set(true);
        },
        error: (error: unknown) => this.error.set(traducirErrorSerie(error)),
      });
    }, ESPERA_DE_BUSQUEDA_MS);
  }

  protected elegirPersona(persona: PersonaResponse): void {
    this.persona.set(persona);
    this.candidatas.set([]);
    this.buscoPersonas.set(false);
    // Otra persona es otro intento, pero no otra agenda: la previsualizacion sigue valiendo.
    this.claveDeIntento.set('');
    this.error.set(null);
  }

  // -------------------------------------------------------------------------------------
  // La regla
  // -------------------------------------------------------------------------------------

  protected alternarDia(iso: number, marcado: boolean): void {
    const actuales = this.diasSemana().filter((d) => d !== iso);
    this.diasSemana.set(marcado ? [...actuales, iso].sort((a, b) => a - b) : actuales);
    this.invalidar();
  }

  protected tieneDia(iso: number): boolean {
    return this.diasSemana().includes(iso);
  }

  protected cambiarHora(valor: string): void {
    this.hora.set(valor);
    this.invalidar();
  }

  protected cambiarFechaDesde(valor: string): void {
    this.fechaDesde.set(valor);
    this.invalidar();
  }

  protected cambiarModoDeFin(modo: ModoDeFin): void {
    this.modoDeFin.set(modo);
    this.invalidar();
  }

  protected cambiarCantidad(valor: string): void {
    const numero = Number(valor);
    this.cantidad.set(Number.isFinite(numero) ? Math.trunc(numero) : 0);
    this.invalidar();
  }

  protected cambiarFechaHasta(valor: string): void {
    this.fechaHasta.set(valor);
    this.invalidar();
  }

  // -------------------------------------------------------------------------------------
  // Previsualizacion
  // -------------------------------------------------------------------------------------

  protected previsualizar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const ofertaId = this.numeroDeOferta();
    if (consultorioId === null || ofertaId === null) {
      return;
    }
    this.error.set(null);
    this.aviso.set('');

    const motivo = this.reglaIncompleta();
    if (motivo !== '') {
      this.aviso.set(motivo);
      return;
    }

    const { fechas, excedeElTope } = expandirRegla(this.regla());
    if (excedeElTope) {
      this.aviso.set(
        `La serie produce mas de ${MAXIMO_OCURRENCIAS} turnos, que es el maximo. Acorta la fecha ` +
          'de fin.',
      );
      return;
    }
    if (fechas.length === 0) {
      this.aviso.set('Con esos dias y esas fechas la serie no produce ningun turno.');
      return;
    }

    const profesionalId = this.numeroDeProfesional();
    const ventanas = ventanasDeAgenda(fechas[0], fechas[fechas.length - 1]);
    this.previsualizando.set(true);
    forkJoin(
      ventanas.map((ventana) =>
        this.agendaApi.buscarAgenda(consultorioId, ofertaId, {
          ...ventana,
          profesionalId: profesionalId ?? undefined,
        }),
      ),
    ).subscribe({
      next: (agendas) => {
        this.previsualizando.set(false);
        this.previsualizacion.set(
          clasificarOcurrencias(fechas, this.hora(), agendas, profesionalId),
        );
      },
      error: (error: unknown) => {
        this.previsualizando.set(false);
        this.error.set(traducirErrorSerie(error, this.timezone()));
      },
    });
  }

  // -------------------------------------------------------------------------------------
  // Alta
  // -------------------------------------------------------------------------------------

  protected reservar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const ofertaId = this.numeroDeOferta();
    const personaId = this.persona()?.id;
    if (consultorioId === null || ofertaId === null || personaId === undefined) {
      return;
    }

    const porCantidad = this.modoDeFin() === 'cantidad';
    const cuerpo: CrearSerieDeTurnos = {
      ofertaId,
      personaId,
      profesionalId: this.numeroDeProfesional() ?? undefined,
      diasSemana: [...this.diasSemana()],
      fechaDesde: this.fechaDesde(),
      hora: `${this.hora()}:00`,
      cantidad: porCantidad ? this.cantidad() : undefined,
      fechaHasta: porCantidad ? undefined : this.fechaHasta(),
      idempotencyKey: this.claveDelIntento(),
    };

    this.enviando.set(true);
    this.error.set(null);
    this.seriesApi.crear(consultorioId, cuerpo).subscribe({
      next: (serie) => {
        this.enviando.set(false);
        this.serie.set(serie);
      },
      error: (error: unknown) => {
        this.enviando.set(false);
        const traducido = traducirErrorSerie(error, this.timezone());
        this.error.set(traducido);
        if (traducido.accion === 'reintentar-con-clave-nueva') {
          this.claveDeIntento.set('');
        }
      },
    });
  }

  protected fechaHora(instante: string | undefined): string {
    return fechaHoraEnZona(instante, this.timezone());
  }

  // -------------------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------------------

  private regla() {
    const porCantidad = this.modoDeFin() === 'cantidad';
    return {
      fechaDesde: this.fechaDesde(),
      diasSemana: this.diasSemana(),
      cantidad: porCantidad ? this.cantidad() : undefined,
      fechaHasta: porCantidad ? undefined : this.fechaHasta(),
    };
  }

  /** Lo que falta para poder previsualizar, o cadena vacia. */
  private reglaIncompleta(): string {
    if (this.diasSemana().length === 0) {
      return 'Elegi al menos un dia de la semana.';
    }
    if (this.hora() === '') {
      return 'Indica la hora de los turnos.';
    }
    if (this.fechaDesde() === '') {
      return 'Indica desde que fecha empieza la serie.';
    }
    if (this.modoDeFin() === 'cantidad') {
      const cantidad = this.cantidad();
      if (cantidad < 1 || cantidad > MAXIMO_OCURRENCIAS) {
        return `La cantidad de turnos va de 1 a ${MAXIMO_OCURRENCIAS}.`;
      }
    } else if (this.fechaHasta() === '' || this.fechaHasta() < this.fechaDesde()) {
      return 'La fecha de fin tiene que ser igual o posterior a la de inicio.';
    }
    return '';
  }

  /** Otra regla es otro intento: se descarta lo previsualizado y la clave. */
  private invalidar(): void {
    this.previsualizacion.set(null);
    this.claveDeIntento.set('');
    this.error.set(null);
    this.aviso.set('');
  }

  private numeroDeProfesional(): number | null {
    const id = Number(this.profesionalId());
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  private numeroDeOferta(): number | null {
    const id = Number(this.ofertaId());
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  /** Igual que en la reserva suelta: una por intento, con respaldo si no hay `randomUUID`. */
  private claveDelIntento(): string {
    const actual = this.claveDeIntento();
    if (actual !== '') {
      return actual;
    }
    const nueva =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `akine-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.claveDeIntento.set(nueva);
    return nueva;
  }
}
