import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { CrearSerieDeTurnosOrigenEnum } from '../../../api/generated/model/crear-serie-de-turnos';
import { ContextoDeAgenda } from '../../../api/generated/model/contexto-de-agenda';
import { HorarioDisponible } from '../../../api/generated/model/horario-disponible';
import { OcurrenciaPrevista } from '../../../api/generated/model/ocurrencia-prevista';
import { OfertaResponse } from '../../../api/generated/model/oferta-response';
import { PersonaResponse } from '../../../api/generated/model/persona-response';
import { RecursoLibre } from '../../../api/generated/model/recurso-libre';
import { ContextoDeTurno } from '../../../core/models/contexto-de-turno';
import { AvisosStore } from '../../../core/services/avisos.store';
import { DiaDeLaSede } from '../../../core/services/dia-de-la-sede';
import { FlujoDeTurnosStore } from '../../../core/services/flujo-de-turnos.store';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { Alerta } from '../../../shared/components/alerta/alerta';
import { PanelLateral } from '../../../shared/components/panel-lateral/panel-lateral';
import { nuevaClaveDeIntento } from '../../../shared/utils/clave-de-intento';
import { ErrorAgenda, traducirErrorAgenda } from '../models/agenda-errors';
import {
  fechaEnPalabras,
  horaEnZona,
  hoyEnZona,
  minutosDeLaPrestacion,
} from '../models/etiquetas-de-agenda';
import { diaEnZona } from '../models/semana';
import { SchedulingApi } from '../services/scheduling-api';
import { SeriesApi } from '../services/series-api';
import { BuscadorDePaciente } from './buscador-de-paciente';
import { ListaDeHorarios } from './lista-de-horarios';

const DIAS = [
  { iso: 1, etiqueta: 'Lun' },
  { iso: 2, etiqueta: 'Mar' },
  { iso: 3, etiqueta: 'Mié' },
  { iso: 4, etiqueta: 'Jue' },
  { iso: 5, etiqueta: 'Vie' },
  { iso: 6, etiqueta: 'Sáb' },
  { iso: 7, etiqueta: 'Dom' },
] as const;

/** Una fila de la propuesta, tal como la va dejando el operador. */
interface FilaDePropuesta {
  readonly ocurrencia: OcurrenciaPrevista;
  /** El horario que va a quedar: el propuesto, la sugerencia aceptada o uno elegido a mano. */
  readonly inicio: string | null;
  readonly profesionalId: number | null;
  readonly excluida: boolean;
}

/**
 * Programar varias sesiones de una vez: configurar la regla, revisar la propuesta y confirmar el
 * conjunto (TURNO.md §5 y §13, TURNO - Tecnico §19 y §20).
 *
 * <p><b>Nunca crea nada antes de confirmar.</b> La previsualizacion la hace el backend con los mismos
 * controles que la reserva; lo que se confirma es lo que quedo de ella, ocurrencia por ocurrencia. El
 * alta revalida todo bajo el lock de la sede y es todo o nada: si algo cambio mientras se revisaba, no
 * se crea ningun turno y se vuelve a previsualizar.
 */
@Component({
  selector: 'app-programacion-multiple-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alerta, BuscadorDePaciente, ListaDeHorarios, PanelLateral],
  templateUrl: './programacion-multiple-panel.html',
  styleUrl: './flujo.css',
})
export class ProgramacionMultiplePanel implements OnInit {
  private readonly api = inject(SchedulingApi);
  private readonly series = inject(SeriesApi);
  private readonly tenant = inject(TenantContextStore);
  private readonly dia = inject(DiaDeLaSede);
  private readonly avisos = inject(AvisosStore);
  private readonly flujo = inject(FlujoDeTurnosStore);
  private readonly router = inject(Router);

  readonly contexto = input.required<ContextoDeTurno>();
  readonly cerrar = output<void>();

  protected readonly DIAS = DIAS;

  protected readonly persona = signal<PersonaResponse | null>(null);
  protected readonly contextoDeAgenda = signal<ContextoDeAgenda | null>(null);
  protected readonly ofertas = signal<readonly OfertaResponse[]>([]);
  protected readonly profesionales = signal<readonly RecursoLibre[]>([]);

  protected readonly ofertaId = signal<number | null>(null);
  protected readonly profesionalId = signal<number | null>(null);
  protected readonly dias = signal<ReadonlySet<number>>(new Set());
  protected readonly hora = signal('10:00');
  protected readonly desde = signal('');
  protected readonly cantidad = signal(10);
  private pedidoDeProfesionales: Subscription | null = null;
  private pedidoDePropuesta: Subscription | null = null;
  private pedidoDeAlternativas: Subscription | null = null;
  protected readonly falta = signal('');

  protected readonly filas = signal<readonly FilaDePropuesta[]>([]);
  protected readonly timezone = signal('');
  protected readonly pendientesDelPlan = signal<number | null>(null);
  protected readonly previsualizando = signal(false);
  protected readonly enviando = signal(false);
  protected readonly error = signal<ErrorAgenda | null>(null);
  protected readonly rechazoDeOcurrencia = signal('');

  /** La fila a la que se le esta buscando otro horario. */
  protected readonly filaEnEdicion = signal<number | null>(null);
  protected readonly alternativas = signal<readonly HorarioDisponible[]>([]);
  protected readonly fechaAlternativa = signal('');

  private clave = '';

  protected readonly ofertaElegida = computed(
    () => this.ofertas().find((oferta) => oferta.id === this.ofertaId()) ?? null,
  );

  /** La duracion de la prestacion, o la del profesional elegido si en esta tiene una propia. */
  protected minutosDe(oferta: OfertaResponse): number | undefined {
    return minutosDeLaPrestacion(
      oferta,
      this.ofertaId(),
      this.profesionales(),
      this.profesionalId(),
    );
  }

  protected readonly plan = computed(() => {
    const planId = this.contexto().planId;
    for (const caso of this.contextoDeAgenda()?.casos ?? []) {
      for (const plan of caso.planes ?? []) {
        if (plan.planId === planId) {
          return plan;
        }
      }
    }
    return null;
  });

  protected readonly prestacionDelPlan = computed(() =>
    this.plan()?.prestaciones?.find((p) => p.ofertaId === this.ofertaId()),
  );

  protected readonly aReservar = computed(() =>
    this.filas().filter((fila) => !fila.excluida && fila.inicio !== null),
  );

  protected readonly sinResolver = computed(
    () => this.filas().filter((fila) => !fila.excluida && fila.inicio === null).length,
  );

  /** Sin confirmar nada de mas: el backend lo rechaza igual, pero aca se ve antes. */
  protected readonly excedeElPlan = computed(() => {
    const pendientes = this.pendientesDelPlan();
    return pendientes !== null && this.aReservar().length > pendientes;
  });

  protected readonly puedeConfirmar = computed(
    () =>
      this.aReservar().length > 0 &&
      this.sinResolver() === 0 &&
      !this.excedeElPlan() &&
      !this.enviando(),
  );

  ngOnInit(): void {
    const contexto = this.contexto();
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null) {
      return;
    }
    this.timezone.set(this.dia.zona());
    this.desde.set(contexto.fecha ?? hoyEnZona(this.dia.zona()));
    this.ofertaId.set(contexto.ofertaId ?? null);
    this.profesionalId.set(contexto.profesionalId ?? null);

    this.api.ofertasAgendables(consultorioId).subscribe({
      next: (ofertas) => this.ofertas.set(ofertas),
      error: (error: unknown) => this.error.set(traducirErrorAgenda(error)),
    });
    this.cargarProfesionales();

    if (contexto.personaId !== undefined) {
      this.api.verPersona(contexto.personaId).subscribe({
        next: (persona) => this.elegirPersona(persona),
        error: (error: unknown) => this.error.set(traducirErrorAgenda(error)),
      });
    }
  }

  protected elegirPersona(persona: PersonaResponse): void {
    this.persona.set(persona);
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null || persona.id === undefined) {
      return;
    }
    this.api.contextoDePersona(consultorioId, persona.id).subscribe({
      next: (contexto) => {
        this.contextoDeAgenda.set(contexto);
        this.precargarDesdeElPlan();
      },
      error: () => this.contextoDeAgenda.set(null),
    });
  }

  /** "Programar sesiones restantes": la cantidad y la frecuencia ya estan en el plan. */
  private precargarDesdeElPlan(): void {
    const plan = this.plan();
    if (plan === null) {
      return;
    }
    const prestaciones = plan.prestaciones ?? [];
    if (this.ofertaId() === null && prestaciones.length === 1) {
      this.ofertaId.set(prestaciones[0].ofertaId ?? null);
      this.cargarProfesionales();
    }
    const delPlan = this.prestacionDelPlan();
    if (delPlan?.pendientes !== undefined && delPlan.pendientes > 0) {
      this.cantidad.set(delPlan.pendientes);
    }
    if (this.dias().size === 0 && plan.frecuenciaSemanal) {
      // Sugerencia repartida en la semana: es sugerida en el plan y se edita con un click.
      const reparto: Readonly<Record<number, readonly number[]>> = {
        1: [1],
        2: [1, 4],
        3: [1, 3, 5],
        4: [1, 2, 4, 5],
        5: [1, 2, 3, 4, 5],
      };
      this.dias.set(new Set(reparto[plan.frecuenciaSemanal] ?? []));
    }
    if (this.profesionalId() === null) {
      const caso = (this.contextoDeAgenda()?.casos ?? []).find((c) =>
        (c.planes ?? []).some((p) => p.planId === plan.planId),
      );
      this.profesionalId.set(caso?.responsableId ?? null);
    }
  }

  protected elegirOferta(valor: string): void {
    const id = Number(valor);
    this.ofertaId.set(valor !== '' && Number.isFinite(id) ? id : null);
    this.profesionalId.set(null);
    this.descartarPropuesta();
    this.cargarProfesionales();
  }

  private cargarProfesionales(): void {
    const consultorioId = this.tenant.consultorioId();
    const ofertaId = this.ofertaId();
    if (consultorioId === null || ofertaId === null) {
      this.profesionales.set([]);
      return;
    }
    this.pedidoDeProfesionales?.unsubscribe();
    this.pedidoDeProfesionales = this.api.profesionales(consultorioId, ofertaId).subscribe({
      next: (lista) => {
        this.profesionales.set(lista);
        // Si la presta una sola persona no hay nada que preguntar (TURNO - Tecnico §11).
        if (this.profesionalId() === null && lista.length === 1) {
          this.profesionalId.set(lista[0].id ?? null);
        }
      },
      error: () => this.profesionales.set([]),
    });
  }

  protected elegirProfesional(valor: string): void {
    const id = Number(valor);
    this.profesionalId.set(valor !== '' && Number.isFinite(id) ? id : null);
    this.descartarPropuesta();
  }

  protected alternarDia(iso: number): void {
    const dias = new Set(this.dias());
    if (dias.has(iso)) {
      dias.delete(iso);
    } else {
      dias.add(iso);
    }
    this.dias.set(dias);
    this.descartarPropuesta();
  }

  /**
   * Otra regla es otra propuesta: lo que se reviso ya no es lo que se confirmaria. Tambien la que venia
   * en camino: si llegara despues, se confirmaria la regla nueva con las ocurrencias de la vieja.
   */
  private descartarPropuesta(): void {
    this.pedidoDePropuesta?.unsubscribe();
    this.previsualizando.set(false);
    this.filas.set([]);
  }

  protected cambiarHora(valor: string): void {
    this.hora.set(valor);
    this.descartarPropuesta();
  }

  protected cambiarDesde(valor: string): void {
    this.desde.set(valor);
    this.descartarPropuesta();
  }

  protected cambiarCantidad(valor: number): void {
    this.cantidad.set(valor);
    this.descartarPropuesta();
  }

  private pedido(): {
    ofertaId: number;
    personaId: number;
    profesionalId?: number;
    diasSemana: number[];
    hora: string;
    fechaDesde: string;
    cantidad: number;
    casoId?: number;
    planId?: number;
    origen: CrearSerieDeTurnosOrigenEnum;
  } | null {
    const persona = this.persona();
    const ofertaId = this.ofertaId();
    if (persona?.id === undefined) {
      this.falta.set('Falta elegir el paciente.');
      return null;
    }
    if (ofertaId === null) {
      this.falta.set('Falta elegir la prestación.');
      return null;
    }
    if (this.profesionalId() === null && this.ofertaElegida()?.requiereProfesional !== false) {
      this.falta.set('Falta elegir el profesional: una serie se programa con uno.');
      return null;
    }
    if (this.dias().size === 0) {
      this.falta.set('Falta elegir al menos un día de la semana.');
      return null;
    }
    if (this.hora() === '' || this.desde() === '' || this.cantidad() < 1) {
      this.falta.set('Faltan el horario, la fecha inicial o la cantidad de sesiones.');
      return null;
    }
    this.falta.set('');
    return {
      ofertaId,
      personaId: persona.id,
      profesionalId: this.profesionalId() ?? undefined,
      diasSemana: [...this.dias()].sort(),
      hora: `${this.hora()}:00`,
      fechaDesde: this.desde(),
      cantidad: Math.min(this.cantidad(), 52),
      casoId: this.contexto().casoId,
      planId: this.contexto().planId,
      origen: this.contexto().origen as string as CrearSerieDeTurnosOrigenEnum,
    };
  }

  protected previsualizar(): void {
    this.error.set(null);
    this.rechazoDeOcurrencia.set('');
    this.pedirPropuesta();
  }

  /**
   * Sin tocar el error: al volver de un alta rechazada, ese mensaje es lo que le explica a quien mira
   * por que la propuesta cambio. Si se borrara, la tabla se actualiza sola y no se dice nada.
   */
  private pedirPropuesta(): void {
    const consultorioId = this.tenant.consultorioId();
    const pedido = this.pedido();
    if (consultorioId === null || pedido === null) {
      return;
    }
    this.previsualizando.set(true);
    this.pedidoDePropuesta?.unsubscribe();
    this.pedidoDePropuesta = this.series.previsualizarAlta(consultorioId, pedido).subscribe({
      next: (propuesta) => {
        this.previsualizando.set(false);
        this.timezone.set(propuesta.timezone ?? this.timezone());
        this.pendientesDelPlan.set(propuesta.pendientesDelPlan ?? null);
        this.clave = '';
        this.filas.set(
          (propuesta.ocurrencias ?? []).map((ocurrencia) => ({
            ocurrencia,
            inicio: ocurrencia.estado === 'DISPONIBLE' ? (ocurrencia.inicio ?? null) : null,
            profesionalId: null,
            // U-22: el feriado omite la ocurrencia y se lista; no frena el alta.
            excluida: ocurrencia.estado === 'FERIADO',
          })),
        );
      },
      error: (error: unknown) => {
        this.previsualizando.set(false);
        this.error.set(traducirErrorAgenda(error));
      },
    });
  }

  protected rotulo(instante: string | null | undefined): string {
    if (!instante) {
      return '';
    }
    const zona = this.timezone();
    return `${fechaEnPalabras(diaEnZona(instante, zona))} · ${horaEnZona(instante, zona)}`;
  }

  private cambiarFila(indice: number, cambio: Partial<FilaDePropuesta>): void {
    this.clave = '';
    this.filas.update((filas) =>
      filas.map((fila, i) => (i === indice ? { ...fila, ...cambio } : fila)),
    );
  }

  protected aceptarSugerencia(indice: number): void {
    const sugerencia = this.filas()[indice]?.ocurrencia.sugerencia;
    if (sugerencia?.desde !== undefined) {
      this.cambiarFila(indice, {
        inicio: sugerencia.desde,
        profesionalId: sugerencia.profesionalId ?? null,
      });
    }
  }

  protected alternarExclusion(indice: number): void {
    const fila = this.filas()[indice];
    if (fila !== undefined) {
      this.cambiarFila(indice, { excluida: !fila.excluida });
    }
  }

  protected buscarAlternativa(indice: number): void {
    const fila = this.filas()[indice];
    if (fila === undefined) {
      return;
    }
    this.filaEnEdicion.set(indice);
    this.fechaAlternativa.set(diaEnZona(fila.ocurrencia.inicio, this.timezone()));
    this.leerAlternativas();
  }

  protected cambiarFechaAlternativa(valor: string): void {
    this.fechaAlternativa.set(valor);
    this.leerAlternativas();
  }

  private leerAlternativas(): void {
    const consultorioId = this.tenant.consultorioId();
    const ofertaId = this.ofertaId();
    if (consultorioId === null || ofertaId === null) {
      return;
    }
    this.alternativas.set([]);
    this.pedidoDeAlternativas?.unsubscribe();
    this.pedidoDeAlternativas = this.api
      .buscarHorarios(consultorioId, {
        ofertaId,
        profesionalId: this.profesionalId() ?? undefined,
        desde: this.fechaAlternativa() === '' ? undefined : this.fechaAlternativa(),
        limite: 12,
      })
      .subscribe({
        next: (respuesta) => this.alternativas.set(respuesta.horarios ?? []),
        error: (error: unknown) => this.error.set(traducirErrorAgenda(error)),
      });
  }

  protected elegirAlternativa(horario: HorarioDisponible): void {
    const indice = this.filaEnEdicion();
    const repetido = this.filas().some(
      (fila, otra) => otra !== indice && !fila.excluida && fila.inicio === horario.desde,
    );
    if (repetido) {
      this.falta.set('Ese horario ya está en otra sesión de la lista: elegí otro.');
      return;
    }
    this.falta.set('');
    if (indice !== null && horario.desde !== undefined) {
      this.cambiarFila(indice, {
        inicio: horario.desde,
        profesionalId: horario.profesionalId ?? null,
      });
    }
    this.filaEnEdicion.set(null);
  }

  protected confirmar(): void {
    const consultorioId = this.tenant.consultorioId();
    const pedido = this.pedido();
    if (consultorioId === null || pedido === null || !this.puedeConfirmar()) {
      return;
    }
    if (this.clave === '') {
      this.clave = nuevaClaveDeIntento();
    }
    this.enviando.set(true);
    this.error.set(null);
    this.rechazoDeOcurrencia.set('');
    const elegidas = this.aReservar();
    this.series
      .crear(consultorioId, {
        ...pedido,
        idempotencyKey: this.clave,
        ocurrencias: elegidas.map((fila) => ({
          inicio: fila.inicio ?? '',
          profesionalId: fila.profesionalId ?? undefined,
        })),
      })
      .subscribe({
        next: (serie) => {
          this.enviando.set(false);
          this.flujo.notificarCambio();
          this.avisos.exito(
            elegidas.length === 1
              ? 'Turno creado correctamente.'
              : `${elegidas.length} turnos creados correctamente.`,
            {
              accion: {
                etiqueta: 'Ver la serie',
                ejecutar: () => {
                  this.router.navigate(['/agenda', 'series', serie.id]).catch(() => undefined);
                },
              },
            },
          );
          this.cerrar.emit();
        },
        error: (error: unknown) => {
          this.enviando.set(false);
          const traducido = traducirErrorAgenda(error);
          this.error.set(traducido);
          // Una respuesta que no llego, o un 5xx, no dice si la serie se creo: el reintento lleva la
          // misma clave, que es lo que evita una segunda serie.
          if (traducido.causa !== 'red' && traducido.causa !== 'otro') {
            this.clave = '';
          }
          // No se creo nada: algo cambio mientras se revisaba. La propuesta nueva dice que.
          if (
            traducido.causa === 'slot-no-disponible' ||
            traducido.causa === 'slot-completo' ||
            traducido.causa === 'recurso-ocupado'
          ) {
            this.rechazoDeOcurrencia.set(
              'No se creó ningún turno: un horario dejó de estar libre mientras revisabas. ' +
                'Volvé a revisar la propuesta.',
            );
            this.pedirPropuesta();
          }
        },
      });
  }
}
