import { Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { TurnoDeCalendario } from '../../../../api/generated/model/turno-de-calendario';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { Icono } from '../../../../shared/components/icono/icono';
import { Pestanas } from '../../../../shared/components/pestanas/pestanas';
import { ErrorAgenda, traducirErrorAgenda } from '../../models/agenda-errors';
import {
  fechaEnPalabras,
  horaEnZona,
  hoyEnZona,
  sumarDias,
} from '../../models/etiquetas-de-agenda';
import { nombreDeEstadoDeRecepcion } from '../../models/etiquetas-de-recepcion';
import { detalleDeEstado, nombreDeEstado } from '../../models/etiquetas-de-turno';
import { ETIQUETA_PESTANAS_DE_AGENDA, pestanasDeAgenda } from '../../models/pestanas-de-agenda';
import {
  agruparPorDia,
  diaCorto,
  diaEnZona,
  diasDeLaSemana,
  esFecha,
  lunesDe,
  rotuloDeSemana,
} from '../../models/semana';
import { SchedulingApi } from '../../services/scheduling-api';

/** La ruta que monta esta pantalla. Se reescribe la semana sobre ella sin navegar. */
const RUTA = '/agenda/calendario';

/** Id del panel de detalle: recibe el foco al elegir un turno (lleva `tabindex="-1"`). */
const ID_DETALLE = 'calendario-detalle';

/**
 * Calendario semanal de los turnos reservados de la sede, con panel de detalle (DP-45, punto 2).
 *
 * <p><b>Solo lectura.</b> Cancelar, reprogramar, confirmar y la recepcion viven en sus pantallas
 * —el ciclo del turno y la recepcion del dia—, que son las que saben manejar la `version` y los
 * conflictos. El panel de detalle enlaza a ellas en vez de duplicarlas.
 *
 * <p><b>La semana es de lunes a domingo y en la zona de la sede.</b> La respuesta trae el
 * `timezone`, y con el se reparte cada turno en su dia y se dan las horas. Igual que la recepcion,
 * sin `?semana=` la pantalla abre con el "hoy" de {@link DiaDeLaSede} y, si la zona de la
 * respuesta cae en otra semana, corrige una sola vez. Un dia elegido a mano, o el de la URL, no se
 * toca. Si la zona llega vacia se rotula UTC en vez de usar la del navegador.
 *
 * <p><b>Cambiar de sede vacia la semana antes de pedir la nueva</b>: dejarla en pantalla mostraria
 * pacientes de otra sede mientras carga. Una respuesta que llega despues de un cambio se descarta.
 */
@Component({
  selector: 'app-calendario-de-turnos-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Ayuda, Icono, Pestanas, RouterLink],
  templateUrl: './calendario-de-turnos-page.html',
  styleUrls: ['../../agenda.css', './calendario-de-turnos-page.css'],
})
export class CalendarioDeTurnosPage {
  private readonly api = inject(SchedulingApi);
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly location = inject(Location);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * De la query: un dia cualquiera de la semana a mostrar (se normaliza al lunes). El `transform`
   * cubre el query param ausente, que con `withComponentInputBinding` llega como `undefined`.
   */
  readonly semana = input('', { transform: (valor: string | undefined) => valor ?? '' });

  /** La ruta ya exigio `turno:read`: las pestanas hermanas estan todas disponibles. */
  protected readonly pestanas = pestanasDeAgenda(true);
  protected readonly etiquetaDePestanas = ETIQUETA_PESTANAS_DE_AGENDA;

  protected readonly fechaEnPalabras = fechaEnPalabras;
  protected readonly diaCorto = diaCorto;
  protected readonly nombreDeEstado = nombreDeEstado;
  protected readonly detalleDeEstado = detalleDeEstado;
  protected readonly nombreDeEstadoDeRecepcion = nombreDeEstadoDeRecepcion;

  /** Lunes de la semana que se muestra. */
  protected readonly lunes = signal(lunesDe(this.diaDeLaSede.hoy()));

  protected readonly turnos = signal<readonly TurnoDeCalendario[]>([]);
  protected readonly timezone = signal('');
  protected readonly cargando = signal(false);
  /** `true` cuando la semana en pantalla ya tiene respuesta: distingue "vacia" de "sin pedir". */
  protected readonly leida = signal(false);
  protected readonly error = signal<ErrorAgenda | null>(null);
  protected readonly seleccionadoId = signal<number | null>(null);

  protected readonly zonaConocida = computed(() => this.timezone() !== '');
  protected readonly rotulo = computed(() => rotuloDeSemana(this.lunes()));
  protected readonly hoy = computed(() =>
    this.zonaConocida() ? hoyEnZona(this.timezone()) : this.diaDeLaSede.hoy(),
  );
  protected readonly dias = computed(() =>
    agruparPorDia(this.turnos(), diasDeLaSemana(this.lunes()), this.timezone()),
  );
  protected readonly seleccionado = computed(() => {
    const id = this.seleccionadoId();
    return id === null ? null : (this.turnos().find((t) => t.turno?.id === id) ?? null);
  });

  /** `true` mientras el lunes es el provisorio del navegador y no se lo comparo con la sede. */
  private semanaPorDefecto = false;
  /** El ultimo `?semana=` aplicado: un cambio de contexto solo no debe pisar la semana elegida. */
  private ultimaDeLaUrl: string | null = null;
  private pedido: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.pedido?.unsubscribe());

    effect(() => {
      const deLaUrl = this.semana();
      this.tenantContext.contextEpoch();
      untracked(() => {
        if (deLaUrl !== this.ultimaDeLaUrl) {
          this.ultimaDeLaUrl = deLaUrl;
          const valida = esFecha(deLaUrl);
          this.lunes.set(lunesDe(valida ? deLaUrl : this.diaDeLaSede.hoy()));
          this.semanaPorDefecto = !valida;
        }
        this.reiniciar();
        this.cargar();
      });
    });
  }

  // -------------------------------------------------------------------------------------
  // Navegacion de semanas
  // -------------------------------------------------------------------------------------

  protected moverSemana(sentido: -1 | 1): void {
    this.irASemana(sumarDias(this.lunes(), 7 * sentido));
  }

  /** "Hoy" es el de la sede cuando ya se conoce su zona; si no, el provisorio del navegador. */
  protected irAHoy(): void {
    this.irASemana(lunesDe(this.hoy()));
  }

  private irASemana(lunes: string): void {
    this.lunes.set(lunes);
    this.semanaPorDefecto = false;
    // `replaceState` y no una navegacion: navegar volveria a disparar el efecto que reinicia todo.
    this.location.replaceState(RUTA, `semana=${lunes}`);
    this.reiniciar();
    this.cargar();
  }

  // -------------------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------------------

  /** Pide la semana. Es tambien el "Volver a intentar" del error. */
  protected cargar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      return;
    }
    const lunes = this.lunes();
    this.pedido?.unsubscribe();
    this.error.set(null);
    this.cargando.set(true);
    this.pedido = this.api.turnosDeSede(consultorioId, lunes, sumarDias(lunes, 7)).subscribe({
      next: (semana) => {
        const timezone = semana.timezone ?? '';
        if (this.corregirALaSemanaDeLaSede(timezone)) {
          return;
        }
        this.turnos.set(semana.turnos ?? []);
        this.timezone.set(timezone);
        this.leida.set(true);
        this.cargando.set(false);
      },
      error: (error: unknown) => {
        this.cargando.set(false);
        this.error.set(traducirErrorAgenda(error));
      },
    });
  }

  /**
   * Si la semana mostrada es la provisoria del navegador y la de la sede es otra, la cambia y
   * vuelve a pedir. Devuelve `true` cuando la respuesta en mano es de otra semana.
   */
  private corregirALaSemanaDeLaSede(timezone: string): boolean {
    if (!this.semanaPorDefecto || timezone === '') {
      return false;
    }
    this.semanaPorDefecto = false;
    const deLaSede = lunesDe(hoyEnZona(timezone));
    if (deLaSede === this.lunes()) {
      return false;
    }
    this.lunes.set(deLaSede);
    this.cargar();
    return true;
  }

  private reiniciar(): void {
    this.pedido?.unsubscribe();
    this.turnos.set([]);
    this.leida.set(false);
    this.error.set(null);
    this.seleccionadoId.set(null);
  }

  // -------------------------------------------------------------------------------------
  // Detalle
  // -------------------------------------------------------------------------------------

  protected elegir(turno: TurnoDeCalendario): void {
    const id = turno.turno?.id;
    if (id === undefined) {
      return;
    }
    this.seleccionadoId.set(id);
    // El foco va al panel: en una pantalla angosta queda debajo de la semana y sin esto no se ve.
    this.enfocar(ID_DETALLE);
  }

  protected cerrarDetalle(): void {
    const id = this.seleccionadoId();
    this.seleccionadoId.set(null);
    if (id !== null) {
      this.enfocar(idDelTurno(id));
    }
  }

  protected idDelTurno(turno: TurnoDeCalendario): string {
    return idDelTurno(turno.turno?.id ?? 0);
  }

  protected hora(instante: string | undefined): string {
    return horaEnZona(instante, this.timezone());
  }

  protected diaDelTurno(turno: TurnoDeCalendario): string {
    return diaEnZona(turno.turno?.inicio, this.timezone());
  }

  /** Lo que el ciclo del turno necesita para poder operar (ver `pages/ciclo-de-turno`). */
  protected queryDelTurno(turno: TurnoDeCalendario): Record<string, string | number> {
    return {
      version: turno.turno?.version ?? 0,
      ofertaId: turno.turno?.ofertaId ?? 0,
      fecha: this.diaDelTurno(turno),
    };
  }

  private enfocar(id: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(`#${id}`)?.focus(), {
      injector: this.injector,
    });
  }
}

function idDelTurno(id: number): string {
  return `calendario-turno-${id}`;
}
