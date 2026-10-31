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

import { AltaEnListaDeEsperaPrioridadEnum } from '../../../api/generated/model/alta-en-lista-de-espera';
import { ContextoDeAgenda } from '../../../api/generated/model/contexto-de-agenda';
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
import { ErrorAgenda, traducirErrorAgenda } from '../models/agenda-errors';
import {
  fechaEnPalabras,
  hoyEnZona,
  minutosDeLaPrestacion,
  sumarDias,
} from '../models/etiquetas-de-agenda';
import { DIAS_ABREVIADOS, PRIORIDADES_DE_ESPERA } from '../models/etiquetas-de-turno';
import { SchedulingApi } from '../services/scheduling-api';
import { BuscadorDePaciente } from './buscador-de-paciente';

/** Cuanto tiempo le sirve un lugar a quien se anota, si no dice otra cosa. */
const DIAS_DE_ESPERA_POR_DEFECTO = 14;

/**
 * Anotar a alguien en la lista de espera (TURNO.md §20, TURNO - Tecnico §31).
 *
 * <p>Se llega casi siempre desde una busqueda sin horarios, con paciente y prestacion ya elegidos: lo
 * que el contexto ya sabe se muestra como dato y se pregunta solo lo que falta. La fecha es la unica
 * excepcion: viene dada, pero el paciente puede decir que le sirve desde otro dia, asi que se puede
 * cambiar sin volver a empezar.
 *
 * <p><b>Anotarse no ocupa la agenda ni promete un lugar.</b> El turno recien nace al asignar, con las
 * validaciones de cualquier reserva. El backend exige que la persona ya sea paciente: se dice antes
 * de enviar y se ofrece activarla, igual que al reservar.
 */
@Component({
  selector: 'app-lista-de-espera-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alerta, BuscadorDePaciente, PanelLateral],
  templateUrl: './lista-de-espera-panel.html',
  styleUrl: './flujo.css',
})
export class ListaDeEsperaPanel implements OnInit {
  private readonly api = inject(SchedulingApi);
  private readonly tenant = inject(TenantContextStore);
  private readonly dia = inject(DiaDeLaSede);
  private readonly avisos = inject(AvisosStore);
  private readonly flujo = inject(FlujoDeTurnosStore);

  readonly contexto = input.required<ContextoDeTurno>();
  readonly cerrar = output<void>();

  protected readonly DIAS = DIAS_ABREVIADOS;
  protected readonly PRIORIDADES = PRIORIDADES_DE_ESPERA;
  protected readonly fechaEnPalabras = fechaEnPalabras;

  protected readonly persona = signal<PersonaResponse | null>(null);
  protected readonly leyendoPersona = signal(false);
  private readonly contextoDeAgenda = signal<ContextoDeAgenda | null>(null);
  protected readonly ofertas = signal<readonly OfertaResponse[]>([]);
  protected readonly ofertaId = signal<number | null>(null);
  protected readonly profesionales = signal<readonly RecursoLibre[]>([]);
  protected readonly profesionalId = signal<number | null>(null);

  protected readonly desde = signal('');
  protected readonly hasta = signal('');
  /** La fecha vino del contexto y todavia nadie pidio cambiarla. */
  protected readonly desdeDelContexto = signal(false);
  protected readonly dias = signal<ReadonlySet<number>>(new Set());
  protected readonly horaDesde = signal('');
  protected readonly horaHasta = signal('');
  protected readonly prioridad = signal<string>(PRIORIDADES_DE_ESPERA[0].valor);
  protected readonly notas = signal('');

  protected readonly enviando = signal(false);
  protected readonly rechazo = signal<ErrorAgenda | null>(null);

  /** Una respuesta lenta de otra prestacion no puede pisar la lista de la elegida. */
  private ultimoPedidoDeProfesionales = 0;

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

  protected readonly requiereProfesional = computed(
    () => this.ofertaElegida()?.requiereProfesional !== false,
  );

  protected readonly nombreDelProfesional = computed(() => {
    const id = this.profesionalId();
    return this.profesionales().find((p) => p.id === id)?.nombre ?? `#${id}`;
  });

  /** El caso y el plan del contexto, con su numero. Si no se pudieron leer, igual se dice que van. */
  protected readonly rotuloDeContexto = computed(() => {
    const { casoId, planId } = this.contexto();
    if (casoId === undefined && planId === undefined) {
      return '';
    }
    for (const caso of this.contextoDeAgenda()?.casos ?? []) {
      const plan = caso.planes?.find((candidato) => candidato.planId === planId);
      if (plan !== undefined || caso.casoId === casoId) {
        const rotulo = `Caso ${caso.numeroCaso}${caso.ofertaNombre ? ` · ${caso.ofertaNombre}` : ''}`;
        return plan === undefined ? rotulo : `${rotulo} — Plan ${plan.numeroPlan}`;
      }
    }
    return planId === undefined ? 'El caso elegido' : 'El plan elegido';
  });

  /** Lo que falta para poder guardar. El boton lo dice en vez de quedar mudo. */
  protected readonly faltante = computed(() => {
    if (this.persona() === null) {
      return 'Falta elegir el paciente.';
    }
    if (this.ofertaId() === null) {
      return 'Falta elegir la prestación.';
    }
    if (this.desde() === '' || this.hasta() === '') {
      return 'Faltan las fechas.';
    }
    if (this.hasta() < this.desde()) {
      return 'La fecha hasta no puede ser anterior a la fecha desde.';
    }
    const horaDesde = this.horaDesde();
    const horaHasta = this.horaHasta();
    if ((horaDesde === '') !== (horaHasta === '')) {
      return 'La franja lleva hora desde y hora hasta, o ninguna de las dos.';
    }
    if (horaDesde !== '' && horaHasta <= horaDesde) {
      return 'La hora hasta tiene que ser posterior a la hora desde.';
    }
    return '';
  });

  ngOnInit(): void {
    const contexto = this.contexto();
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null) {
      return;
    }
    // Una fecha ya pasada no le sirve a nadie: viene de mirar la agenda de un dia anterior.
    const hoy = this.hoy();
    const delContexto =
      contexto.fecha !== undefined && contexto.fecha >= hoy ? contexto.fecha : null;
    this.desdeDelContexto.set(delContexto !== null);
    this.desde.set(delContexto ?? hoy);
    this.hasta.set(sumarDias(this.desde(), DIAS_DE_ESPERA_POR_DEFECTO));
    this.ofertaId.set(contexto.ofertaId ?? null);
    this.profesionalId.set(contexto.profesionalId ?? null);

    this.api.ofertasAgendables(consultorioId).subscribe({
      next: (ofertas) => this.ofertas.set(ofertas),
      error: (error: unknown) => this.rechazo.set(traducirErrorAgenda(error)),
    });
    this.cargarProfesionales();

    if (contexto.personaId !== undefined) {
      this.leyendoPersona.set(true);
      this.api.verPersona(contexto.personaId).subscribe({
        next: (persona) => {
          this.leyendoPersona.set(false);
          this.elegirPersona(persona);
        },
        error: (error: unknown) => {
          this.leyendoPersona.set(false);
          this.rechazo.set(traducirErrorAgenda(error));
        },
      });
    }
  }

  protected hoy(): string {
    return hoyEnZona(this.dia.zona());
  }

  protected elegirPersona(persona: PersonaResponse): void {
    this.persona.set(persona);
    this.rechazo.set(null);
    const { casoId, planId } = this.contexto();
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null || persona.id === undefined) {
      return;
    }
    if (casoId !== undefined || planId !== undefined) {
      this.api.contextoDePersona(consultorioId, persona.id).subscribe({
        next: (contexto) => this.contextoDeAgenda.set(contexto),
        // Solo da los numeros para mostrar: el caso y el plan viajan igual.
        error: () => this.contextoDeAgenda.set(null),
      });
    }
  }

  protected cambiarPersona(): void {
    this.persona.set(null);
    this.rechazo.set(null);
  }

  protected activarPerfil(): void {
    const persona = this.persona();
    if (persona?.id === undefined) {
      return;
    }
    this.enviando.set(true);
    this.api.activarPerfilDePaciente(persona.id).subscribe({
      next: (activada) => {
        this.enviando.set(false);
        this.persona.set(activada);
        this.rechazo.set(null);
      },
      error: (error: unknown) => {
        this.enviando.set(false);
        this.rechazo.set(traducirErrorAgenda(error));
      },
    });
  }

  protected elegirOferta(valor: string): void {
    const id = Number(valor);
    this.ofertaId.set(valor !== '' && Number.isFinite(id) ? id : null);
    this.cargarProfesionales();
  }

  private cargarProfesionales(): void {
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null) {
      return;
    }
    const pedido = ++this.ultimoPedidoDeProfesionales;
    this.api.profesionales(consultorioId, this.ofertaId() ?? undefined).subscribe({
      next: (lista) => {
        if (pedido === this.ultimoPedidoDeProfesionales) {
          this.profesionales.set(lista);
          // El preferido de antes puede no prestar la prestacion nueva. El del contexto no se toca.
          const elegido = this.profesionalId();
          if (
            this.contexto().profesionalId === undefined &&
            !lista.some((profesional) => profesional.id === elegido)
          ) {
            this.profesionalId.set(null);
          }
        }
      },
      error: () => {
        if (pedido === this.ultimoPedidoDeProfesionales) {
          this.profesionales.set([]);
        }
      },
    });
  }

  protected elegirProfesional(valor: string): void {
    const id = Number(valor);
    this.profesionalId.set(valor !== '' && Number.isFinite(id) ? id : null);
  }

  /** Mover "desde" arrastra a "hasta" si seguia en el default, o si quedo antes de "desde". */
  protected cambiarDesde(valor: string): void {
    const seguiaElDefault = this.hasta() === sumarDias(this.desde(), DIAS_DE_ESPERA_POR_DEFECTO);
    this.desde.set(valor);
    if (valor !== '' && (seguiaElDefault || this.hasta() < valor)) {
      this.hasta.set(sumarDias(valor, DIAS_DE_ESPERA_POR_DEFECTO));
    }
  }

  protected alternarDia(iso: number): void {
    const dias = new Set(this.dias());
    if (dias.has(iso)) {
      dias.delete(iso);
    } else {
      dias.add(iso);
    }
    this.dias.set(dias);
  }

  protected guardar(): void {
    const consultorioId = this.tenant.consultorioId();
    const personaId = this.persona()?.id;
    const ofertaId = this.ofertaId();
    if (
      consultorioId === null ||
      personaId === undefined ||
      ofertaId === null ||
      this.faltante() !== '' ||
      this.enviando()
    ) {
      return;
    }
    const contexto = this.contexto();
    const dias = [...this.dias()].sort((a, b) => a - b);
    const notas = this.notas().trim();
    this.enviando.set(true);
    this.rechazo.set(null);
    this.api
      .anotarEnEspera(consultorioId, {
        personaId,
        ofertaId,
        profesionalId: this.requiereProfesional() ? (this.profesionalId() ?? undefined) : undefined,
        casoId: contexto.casoId,
        planId: contexto.planId,
        fechaDesde: this.desde(),
        fechaHasta: this.hasta(),
        // Sin dias es "cualquiera", y sin franja, "a cualquier hora": no se mandan vacios.
        dias: dias.length > 0 ? dias : undefined,
        horaDesde: this.horaDesde() === '' ? undefined : `${this.horaDesde()}:00`,
        horaHasta: this.horaHasta() === '' ? undefined : `${this.horaHasta()}:00`,
        prioridad: this.prioridad() as AltaEnListaDeEsperaPrioridadEnum,
        notas: notas === '' ? undefined : notas,
      })
      .subscribe({
        next: () => {
          this.enviando.set(false);
          this.avisos.exito('Paciente agregado a la lista de espera.');
          this.flujo.notificarCambio();
          this.cerrar.emit();
        },
        error: (error: unknown) => {
          this.enviando.set(false);
          this.rechazo.set(traducirErrorAgenda(error));
        },
      });
  }
}
