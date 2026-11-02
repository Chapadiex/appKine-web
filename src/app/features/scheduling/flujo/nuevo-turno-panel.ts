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
import { NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { CoberturaResponse } from '../../../api/generated/model/cobertura-response';
import { ContextoDeAgenda } from '../../../api/generated/model/contexto-de-agenda';
import { HorarioDisponible } from '../../../api/generated/model/horario-disponible';
import { OfertaResponse } from '../../../api/generated/model/oferta-response';
import { PersonaResponse } from '../../../api/generated/model/persona-response';
import { RecursoLibre } from '../../../api/generated/model/recurso-libre';
import { ReservarTurnoOrigenEnum } from '../../../api/generated/model/reservar-turno';
import { SesionesDePrestacion } from '../../../api/generated/model/sesiones-de-prestacion';
import { ValidacionDeHorario } from '../../../api/generated/model/validacion-de-horario';
import { ContextoDeTurno } from '../../../core/models/contexto-de-turno';
import { PERMISO_TURNO_SOBRETURNO } from '../../../core/models/permisos';
import { AvisosStore } from '../../../core/services/avisos.store';
import { DiaDeLaSede } from '../../../core/services/dia-de-la-sede';
import { FlujoDeTurnosStore } from '../../../core/services/flujo-de-turnos.store';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { Alerta } from '../../../shared/components/alerta/alerta';
import { PanelLateral } from '../../../shared/components/panel-lateral/panel-lateral';
import { PermisoDirective } from '../../../shared/directives/permiso.directive';
import { nuevaClaveDeIntento } from '../../../shared/utils/clave-de-intento';
import { ErrorAgenda, traducirErrorAgenda } from '../models/agenda-errors';
import {
  fechaEnPalabras,
  horaEnZona,
  hoyEnZona,
  minutosDeLaPrestacion,
  textoSinMotivoDeBusqueda,
} from '../models/etiquetas-de-agenda';
import { coberturaParaReservar } from '../models/etiquetas-de-turno';
import { diaEnZona } from '../models/semana';
import { SchedulingApi } from '../services/scheduling-api';
import { BuscadorDePaciente } from './buscador-de-paciente';
import { ListaDeHorarios } from './lista-de-horarios';

/** Cuantos horarios se piden de entrada: alcanza para elegir sin navegar una agenda. */
const HORARIOS_INICIALES = 12;

interface OpcionDeContexto {
  readonly valor: string;
  readonly etiqueta: string;
  readonly casoId?: number;
  readonly planId?: number;
  readonly prestaciones: readonly SesionesDePrestacion[];
}

/**
 * El formulario unico de creacion de turnos (TURNO - Tecnico §3 a §6, §13, §18, §85).
 *
 * <p>Recibe lo que ya se sabe y pregunta solo lo que falta. Viniendo de la agenda no pregunta fecha,
 * hora ni profesional; viniendo de un plan no pregunta paciente, caso, plan ni prestacion. El punto de
 * entrada cambia lo que se pregunta y nunca una regla: todo lo decide el backend, en la misma reserva.
 *
 * <h2>Dos modos de elegir el horario</h2>
 *
 * <p>Con un instante en el contexto no se busca: se valida ese horario contra el motor. Sin instante
 * se muestran los proximos disponibles, que es lo que evita navegar una agenda.
 *
 * <p><b>Lo que se ve es informativo</b>: otro usuario puede tomar el mismo horario. La reserva revalida
 * bajo el lock de la sede y, si perdio, se le ofrecen alternativas reales en vez de un error.
 */
@Component({
  selector: 'app-nuevo-turno-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Alerta,
    BuscadorDePaciente,
    ListaDeHorarios,
    NgTemplateOutlet,
    PanelLateral,
    PermisoDirective,
  ],
  templateUrl: './nuevo-turno-panel.html',
  styleUrl: './flujo.css',
})
export class NuevoTurnoPanel implements OnInit {
  private readonly api = inject(SchedulingApi);
  private readonly tenant = inject(TenantContextStore);
  private readonly dia = inject(DiaDeLaSede);
  private readonly avisos = inject(AvisosStore);
  private readonly flujo = inject(FlujoDeTurnosStore);
  private readonly router = inject(Router);

  readonly contexto = input.required<ContextoDeTurno>();
  readonly cerrar = output<void>();

  protected readonly PERMISO_TURNO_SOBRETURNO = PERMISO_TURNO_SOBRETURNO;
  protected readonly coberturaParaReservar = coberturaParaReservar;

  protected readonly persona = signal<PersonaResponse | null>(null);
  protected readonly leyendoPersona = signal(false);
  protected readonly contextoDeAgenda = signal<ContextoDeAgenda | null>(null);
  protected readonly ofertas = signal<readonly OfertaResponse[]>([]);
  protected readonly ofertaId = signal<number | null>(null);
  protected readonly contextoClinico = signal('');
  protected readonly profesionales = signal<readonly RecursoLibre[]>([]);
  protected readonly profesionalId = signal<number | null>(null);
  protected readonly coberturas = signal<readonly CoberturaResponse[]>([]);
  protected readonly coberturaId = signal<number | null>(null);

  /** La zona de la sede: la de la busqueda, o la del contexto hasta que llegue. */
  protected readonly timezone = signal('');

  // Modo "proximos disponibles"
  protected readonly horarios = signal<readonly HorarioDisponible[]>([]);
  protected readonly truncado = signal(false);
  protected readonly motivosSinHorario = signal<readonly string[]>([]);
  protected readonly buscando = signal(false);
  protected readonly errorDeBusqueda = signal<ErrorAgenda | null>(null);
  protected readonly limite = signal(HORARIOS_INICIALES);
  protected readonly desde = signal('');
  protected readonly franja = signal<'' | 'manana' | 'tarde'>('');

  /** El horario elegido, sea de la lista o del contexto. */
  protected readonly horario = signal<HorarioDisponible | null>(null);
  protected readonly validacion = signal<ValidacionDeHorario | null>(null);
  protected readonly validando = signal(false);
  private pedidoDeValidacion: Subscription | null = null;
  private pedidoDeContexto: Subscription | null = null;
  private pedidoDeHorarios: Subscription | null = null;
  private pedidoDeProfesionales: Subscription | null = null;
  protected readonly espacioId = signal<number | null>(null);
  protected readonly cambiandoEspacio = signal(false);

  protected readonly enviando = signal(false);
  protected readonly rechazo = signal<ErrorAgenda | null>(null);
  /** Los horarios que se ofrecen cuando el elegido ya no esta. */
  protected readonly alternativas = signal<readonly HorarioDisponible[]>([]);
  protected readonly sobreturnoAbierto = signal(false);
  protected readonly sobreturnoMotivo = signal('');
  protected readonly faltaMotivoDeSobreturno = signal(false);
  protected readonly ocupante = signal('');

  private clave = '';

  protected readonly opcionesDeContexto = computed<readonly OpcionDeContexto[]>(() => {
    const opciones: OpcionDeContexto[] = [];
    for (const caso of this.contextoDeAgenda()?.casos ?? []) {
      const rotulo = `Caso ${caso.numeroCaso}${caso.ofertaNombre ? ` · ${caso.ofertaNombre}` : ''}`;
      for (const plan of caso.planes ?? []) {
        const prestaciones = plan.prestaciones ?? [];
        opciones.push({
          valor: `plan:${plan.planId}`,
          etiqueta: `${rotulo} — Plan ${plan.numeroPlan}${textoDeSesiones(prestaciones)}`,
          casoId: caso.casoId,
          planId: plan.planId,
          prestaciones,
        });
      }
      opciones.push({
        valor: `caso:${caso.casoId}`,
        etiqueta: `${rotulo} — sin plan`,
        casoId: caso.casoId,
        prestaciones: [],
      });
    }
    return opciones;
  });

  protected readonly opcionElegida = computed(
    () => this.opcionesDeContexto().find((o) => o.valor === this.contextoClinico()) ?? null,
  );

  /** Con plan, solo sus prestaciones de esta sede: no se ofrece lo que el backend va a rechazar. */
  protected readonly ofertasPosibles = computed<readonly OfertaResponse[]>(() => {
    const prestaciones = this.opcionElegida()?.prestaciones ?? [];
    if (prestaciones.length === 0) {
      return this.ofertas();
    }
    const ids = new Set(prestaciones.map((p) => p.ofertaId));
    return this.ofertas().filter((oferta) => ids.has(oferta.id));
  });

  protected readonly ofertaElegida = computed(
    () => this.ofertas().find((oferta) => oferta.id === this.ofertaId()) ?? null,
  );

  /** La prestacion queda decidida cuando el plan define una sola (TURNO - Tecnico §10). */
  protected readonly ofertaFija = computed(() => this.ofertasPosibles().length === 1);

  protected readonly sesionesDeLaPrestacion = computed(() =>
    (this.opcionElegida()?.prestaciones ?? []).find((p) => p.ofertaId === this.ofertaId()),
  );

  /** El profesional viene dado cuando se entro por una celda de agenda de un profesional. */
  protected readonly profesionalFijo = computed(
    () => this.contexto().inicio !== undefined && this.contexto().profesionalId !== undefined,
  );

  protected readonly conHorarioDelContexto = computed(() => this.contexto().inicio !== undefined);

  protected readonly nombreDelProfesional = computed(() => {
    const id = this.profesionalId();
    return (
      this.profesionales().find((p) => p.id === id)?.nombre ??
      this.horario()?.profesionalNombre ??
      ''
    );
  });

  /** Lo que falta para poder confirmar. El boton lo dice en vez de quedar mudo. */
  /** El plan ya tiene todo programado: no se ofrecen horarios que el backend va a rechazar. */
  protected readonly planAgotado = computed(() => this.sesionesDeLaPrestacion()?.pendientes === 0);

  protected readonly faltante = computed(() => {
    if (this.persona() === null) {
      return 'Falta elegir el paciente.';
    }
    if (this.ofertaId() === null) {
      return 'Falta elegir la prestación.';
    }
    if (this.planAgotado()) {
      return 'Ese plan no tiene sesiones pendientes para esta prestación.';
    }
    if (this.horario() === null) {
      return 'Falta elegir un horario.';
    }
    if (this.validacion()?.estado === 'NO_DISPONIBLE') {
      return 'Ese horario no se puede reservar.';
    }
    if (this.horario()?.profesionalId === undefined && this.requiereProfesional()) {
      return 'Falta elegir quién atiende.';
    }
    return '';
  });

  protected readonly requiereProfesional = computed(
    () => this.ofertaElegida()?.requiereProfesional !== false,
  );

  protected readonly rotuloDelHorario = computed(() => {
    const elegido = this.horario();
    if (elegido === null) {
      return '';
    }
    const zona = this.zona();
    const fin = elegido.hasta ?? this.finSegunLaValidacion(elegido);
    return (
      `${fechaEnPalabras(diaEnZona(elegido.desde, zona))} · ${horaEnZona(elegido.desde, zona)}` +
      (fin ? ` a ${horaEnZona(fin, zona)}` : '')
    );
  });

  /**
   * El fin de un horario que no vino de la lista, sino de una celda de la agenda. Con "cualquier
   * profesional" y varios libres, el `fin` de la validacion es el de la prestacion: si alguno tiene
   * duracion propia, hasta que se elija no se sabe, y no se afirma.
   */
  private finSegunLaValidacion(elegido: HorarioDisponible): string | undefined {
    const validacion = this.validacion();
    const libres = validacion?.profesionales ?? [];
    const propia = libres.find((p) => p.id === elegido.profesionalId)?.duracionPropiaMinutos;
    if (propia && elegido.desde) {
      return new Date(Date.parse(elegido.desde) + propia * 60_000).toISOString();
    }
    return elegido.profesionalId === undefined && libres.some((p) => p.duracionPropiaMinutos)
      ? undefined
      : validacion?.fin;
  }

  /** La duracion de la prestacion, o la del profesional elegido si en esta tiene una propia. */
  protected minutosDe(oferta: OfertaResponse): number | undefined {
    return minutosDeLaPrestacion(
      oferta,
      this.ofertaId(),
      this.profesionales(),
      this.profesionalId(),
    );
  }

  protected readonly rotuloDelEspacio = computed(() => {
    const id = this.espacioId();
    if (id !== null) {
      return (
        this.validacion()?.espaciosLibres?.find((e) => e.id === id)?.nombre || 'Sin nombre cargado'
      );
    }
    return this.horario()?.espacioNombre ?? this.validacion()?.espaciosLibres?.[0]?.nombre ?? '';
  });

  protected readonly conflictoDeLugar = computed(() => {
    const causa = this.rechazo()?.causa;
    return (
      causa === 'recurso-ocupado' || causa === 'slot-completo' || causa === 'slot-no-disponible'
    );
  });

  ngOnInit(): void {
    const contexto = this.contexto();
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null) {
      return;
    }
    this.timezone.set(this.dia.zona());
    this.desde.set(contexto.fecha ?? '');
    this.ofertaId.set(contexto.ofertaId ?? null);
    this.profesionalId.set(contexto.profesionalId ?? null);
    this.espacioId.set(contexto.espacioId ?? null);
    if (contexto.inicio !== undefined) {
      this.horario.set({ desde: contexto.inicio, profesionalId: contexto.profesionalId });
    }

    this.api.ofertasAgendables(consultorioId).subscribe({
      next: (ofertas) => {
        this.ofertas.set(ofertas);
        this.alCambiarElContexto();
      },
      error: (error: unknown) => this.errorDeBusqueda.set(traducirErrorAgenda(error)),
    });

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

  // -------------------------------------------------------------------------------------
  // Paciente, caso y plan
  // -------------------------------------------------------------------------------------

  protected elegirPersona(persona: PersonaResponse): void {
    this.persona.set(persona);
    this.clave = '';
    this.rechazo.set(null);
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null || persona.id === undefined) {
      return;
    }
    this.pedidoDeContexto?.unsubscribe();
    this.pedidoDeContexto = this.api.contextoDePersona(consultorioId, persona.id).subscribe({
      next: (contexto) => {
        this.contextoDeAgenda.set(contexto);
        this.preseleccionar(contexto);
      },
      // Sin el contexto se reserva igual: caso y plan son opcionales.
      error: () => this.contextoDeAgenda.set(null),
    });
    this.cargarCoberturas();
  }

  protected cambiarPersona(): void {
    this.pedidoDeContexto?.unsubscribe();
    this.persona.set(null);
    this.contextoDeAgenda.set(null);
    this.contextoClinico.set('');
    this.coberturas.set([]);
    this.coberturaId.set(null);
    this.clave = '';
    this.validarSiCorresponde();
  }

  /**
   * Lo que el contexto ya dice y lo que se puede deducir: si hay una sola opcion compatible se elige
   * sola (TURNO - Tecnico §9). Nunca se elige un caso si la oferta del contexto no esta en su plan.
   */
  private preseleccionar(contexto: ContextoDeAgenda): void {
    const pedido = this.contexto();
    const opciones = this.opcionesDeContexto();
    let elegida = '';
    if (pedido.planId !== undefined) {
      elegida = `plan:${pedido.planId}`;
    } else if (pedido.casoId !== undefined) {
      const delCaso = opciones.filter((o) => o.casoId === pedido.casoId && o.planId !== undefined);
      elegida = delCaso.length === 1 ? delCaso[0].valor : `caso:${pedido.casoId}`;
    } else {
      const conPlan = opciones.filter((o) => o.planId !== undefined);
      // Un plan sin sesiones pendientes se puede elegir para ver por que, pero no viene elegido.
      const compatibles = conPlan.filter((o) =>
        o.prestaciones.some(
          (p) =>
            (this.ofertaId() === null || p.ofertaId === this.ofertaId()) && (p.pendientes ?? 0) > 0,
        ),
      );
      elegida = compatibles.length === 1 ? compatibles[0].valor : '';
    }
    this.contextoClinico.set(opciones.some((o) => o.valor === elegida) ? elegida : '');

    if (this.profesionalId() === null && pedido.inicio === undefined) {
      // El responsable del caso es el de siempre; "cualquiera" sigue a un click.
      const caso = (contexto.casos ?? []).find((c) => c.casoId === this.opcionElegida()?.casoId);
      this.profesionalId.set(caso?.responsableId ?? null);
    }
    this.alCambiarElContexto();
  }

  protected elegirContextoClinico(valor: string): void {
    this.contextoClinico.set(valor);
    this.clave = '';
    this.alCambiarElContexto();
  }

  /** Prestacion decidida por el plan o unica: se fija sola. */
  private alCambiarElContexto(): void {
    const posibles = this.ofertasPosibles();
    const actual = this.ofertaId();
    if (posibles.length === 1) {
      this.ofertaId.set(posibles[0].id ?? null);
    } else if (actual !== null && !posibles.some((oferta) => oferta.id === actual)) {
      this.ofertaId.set(null);
    }
    this.alCambiarLaPrestacion();
  }

  protected elegirOferta(valor: string): void {
    const id = Number(valor);
    this.ofertaId.set(valor !== '' && Number.isFinite(id) ? id : null);
    this.clave = '';
    this.alCambiarLaPrestacion();
  }

  private alCambiarLaPrestacion(): void {
    const consultorioId = this.tenant.consultorioId();
    const ofertaId = this.ofertaId();
    if (consultorioId === null || ofertaId === null) {
      this.profesionales.set([]);
      return;
    }
    // Igual que los horarios: la lista de la prestacion anterior no puede pisar a la de la elegida.
    this.pedidoDeProfesionales?.unsubscribe();
    this.pedidoDeProfesionales = this.api.profesionales(consultorioId, ofertaId).subscribe({
      next: (lista) => this.profesionales.set(lista),
      error: () => this.profesionales.set([]),
    });
    if (this.conHorarioDelContexto()) {
      this.validarSiCorresponde();
    } else {
      this.buscarHorarios();
    }
  }

  protected elegirProfesional(valor: string): void {
    const id = Number(valor);
    this.profesionalId.set(valor !== '' && Number.isFinite(id) ? id : null);
    this.clave = '';
    if (this.conHorarioDelContexto()) {
      const elegido = this.horario();
      this.horario.set(
        elegido === null ? null : { ...elegido, profesionalId: this.profesionalId() ?? undefined },
      );
      this.validarSiCorresponde();
    } else {
      this.buscarHorarios();
    }
  }

  private cargarCoberturas(): void {
    const persona = this.persona();
    const elegido = this.horario();
    this.coberturas.set([]);
    this.coberturaId.set(null);
    if (persona?.id === undefined || elegido === null) {
      return;
    }
    this.api.coberturasElegibles(persona.id, diaEnZona(elegido.desde, this.zona())).subscribe({
      next: (lista) => {
        if (this.persona()?.id === persona.id) {
          this.coberturas.set(lista);
        }
      },
      error: () => this.coberturas.set([]),
    });
  }

  protected elegirCobertura(valor: string): void {
    const id = Number(valor);
    this.coberturaId.set(valor !== '' && Number.isFinite(id) ? id : null);
    this.clave = '';
  }

  // -------------------------------------------------------------------------------------
  // Horarios
  // -------------------------------------------------------------------------------------

  protected buscarHorarios(): void {
    const consultorioId = this.tenant.consultorioId();
    const ofertaId = this.ofertaId();
    if (consultorioId === null || ofertaId === null) {
      return;
    }
    this.buscando.set(true);
    this.errorDeBusqueda.set(null);
    this.horario.set(null);
    this.validacion.set(null);
    const franja = this.franja();
    // Con dos busquedas en vuelo no gana la ultima en llegar: entrar por un plan dispara una con
    // cualquier profesional y otra con el responsable, y la vieja dejaba horarios que el filtro no dice.
    this.pedidoDeHorarios?.unsubscribe();
    this.pedidoDeHorarios = this.api
      .buscarHorarios(consultorioId, {
        ofertaId,
        profesionalId: this.profesionalId() ?? undefined,
        desde: this.desde() === '' ? undefined : this.desde(),
        horaDesde: franja === 'tarde' ? '13:00:00' : undefined,
        horaHasta: franja === 'manana' ? '13:00:00' : undefined,
        limite: this.limite(),
      })
      .subscribe({
        next: (respuesta) => {
          this.buscando.set(false);
          this.timezone.set(respuesta.timezone ?? this.timezone());
          this.horarios.set(respuesta.horarios ?? []);
          this.truncado.set(respuesta.truncado === true);
          this.motivosSinHorario.set(respuesta.motivosSinHorario ?? []);
        },
        error: (error: unknown) => {
          this.buscando.set(false);
          this.horarios.set([]);
          this.errorDeBusqueda.set(traducirErrorAgenda(error));
        },
      });
  }

  protected filtrarDesde(valor: string): void {
    this.desde.set(valor);
    this.limite.set(HORARIOS_INICIALES);
    this.buscarHorarios();
  }

  protected filtrarFranja(valor: string): void {
    this.franja.set(valor === 'manana' || valor === 'tarde' ? valor : '');
    this.limite.set(HORARIOS_INICIALES);
    this.buscarHorarios();
  }

  protected verMas(): void {
    this.limite.update((actual) => actual + HORARIOS_INICIALES);
    this.buscarHorarios();
  }

  /** "Ampliar busqueda": saca los filtros de fecha y de franja. */
  protected ampliarBusqueda(): void {
    this.desde.set('');
    this.franja.set('');
    this.buscarHorarios();
  }

  protected verOtrosProfesionales(): void {
    this.profesionalId.set(null);
    this.buscarHorarios();
  }

  protected elegirPrimero(): void {
    const primero = this.horarios()[0];
    if (primero !== undefined) {
      this.elegirHorario(primero);
    }
  }

  protected elegirHorario(horario: HorarioDisponible): void {
    this.horario.set(horario);
    this.profesionalId.set(horario.profesionalId ?? this.profesionalId());
    this.espacioId.set(null);
    this.cambiandoEspacio.set(false);
    this.clave = '';
    this.rechazo.set(null);
    this.alternativas.set([]);
    this.sobreturnoAbierto.set(false);
    this.cargarCoberturas();
    this.validarSiCorresponde();
  }

  /** Un horario ya elegido se pregunta al motor: dice si sigue libre, los boxes y los avisos. */
  private validarSiCorresponde(): void {
    const consultorioId = this.tenant.consultorioId();
    const ofertaId = this.ofertaId();
    const elegido = this.horario();
    if (consultorioId === null || ofertaId === null || elegido?.desde === undefined) {
      this.validacion.set(null);
      return;
    }
    this.validando.set(true);
    const opcion = this.opcionElegida();
    // Cambiar de plan o de profesional vuelve a validar: la respuesta vieja no puede ganarle a la nueva.
    this.pedidoDeValidacion?.unsubscribe();
    this.pedidoDeValidacion = this.api
      .validarHorario(consultorioId, {
        ofertaId,
        inicio: elegido.desde,
        profesionalId: elegido.profesionalId ?? this.profesionalId() ?? undefined,
        espacioId: this.espacioId() ?? undefined,
        personaId: this.persona()?.id,
        casoId: opcion?.casoId,
        planId: opcion?.planId,
      })
      .subscribe({
        next: (validacion) => {
          this.validando.set(false);
          this.validacion.set(validacion);
          this.alternativas.set(validacion.alternativas ?? []);
          // Con "cualquier profesional" y uno solo libre, no hay nada que preguntar.
          const libres = validacion.profesionales ?? [];
          const actual = this.horario();
          if (actual !== null && actual.profesionalId === undefined && libres.length === 1) {
            this.horario.set({
              ...actual,
              profesionalId: libres[0].id,
              profesionalNombre: libres[0].nombre,
            });
            this.profesionalId.set(libres[0].id ?? null);
          }
        },
        error: (error: unknown) => {
          this.validando.set(false);
          this.validacion.set(null);
          this.rechazo.set(traducirErrorAgenda(error));
        },
      });
  }

  protected elegirProfesionalLibre(valor: string): void {
    const id = Number(valor);
    const actual = this.horario();
    if (actual !== null && Number.isFinite(id)) {
      this.horario.set({ ...actual, profesionalId: id });
      this.profesionalId.set(id);
      this.clave = '';
    }
  }

  protected elegirEspacio(valor: string): void {
    const id = Number(valor);
    this.espacioId.set(valor !== '' && Number.isFinite(id) ? id : null);
    this.clave = '';
  }

  // -------------------------------------------------------------------------------------
  // Confirmacion
  // -------------------------------------------------------------------------------------

  protected confirmar(sobreturnoMotivo?: string): void {
    // Un doble click es una sola reserva: la clave lo protege en el servidor, esto evita el segundo aviso.
    if (this.enviando()) {
      return;
    }
    const consultorioId = this.tenant.consultorioId();
    const ofertaId = this.ofertaId();
    const persona = this.persona();
    const elegido = this.horario();
    if (
      consultorioId === null ||
      ofertaId === null ||
      persona?.id === undefined ||
      elegido?.desde === undefined
    ) {
      return;
    }
    if (this.clave === '') {
      this.clave = nuevaClaveDeIntento();
    }
    this.enviando.set(true);
    this.rechazo.set(null);
    const opcion = this.opcionElegida();
    this.api
      .reservar(consultorioId, ofertaId, {
        inicio: elegido.desde,
        personaId: persona.id,
        profesionalId: elegido.profesionalId ?? this.profesionalId() ?? undefined,
        coberturaId: this.coberturaId() ?? undefined,
        espacioId: this.espacioId() ?? undefined,
        casoId: opcion?.casoId,
        planId: opcion?.planId,
        origen: this.contexto().origen as string as ReservarTurnoOrigenEnum,
        sobreturnoMotivo,
        idempotencyKey: this.clave,
      })
      .subscribe({
        next: (turno) => {
          this.enviando.set(false);
          this.flujo.notificarCambio();
          const contexto = this.contexto();
          this.avisos.exito('Turno creado correctamente.', {
            descripcion: `${persona.apellido}, ${persona.nombre} · ${this.rotuloDelHorario()}`,
            accion: {
              etiqueta: 'Ver turno',
              ejecutar: () => this.flujo.verTurno(turno.id ?? 0),
            },
            otraAccion: {
              etiqueta: 'Crear otro',
              ejecutar: () =>
                this.flujo.nuevoTurno({ ...contexto, inicio: undefined, fecha: undefined }),
            },
          });
          this.cerrar.emit();
        },
        error: (error: unknown) => {
          this.enviando.set(false);
          this.alRechazar(traducirErrorAgenda(error));
        },
      });
  }

  /** Un horario que se fue no es un error tecnico: se dice que paso y se ofrece que hacer. */
  private alRechazar(fallo: ErrorAgenda): void {
    this.rechazo.set(fallo);
    // Una respuesta que no llego, o un 5xx, no dice si el turno se creo: el reintento lleva la misma
    // clave, que es lo que hace que el backend devuelva ese turno en vez de crear otro. Un rechazo
    // claro si la invalida, porque lo que sigue es cambiar el pedido.
    if (fallo.causa !== 'red' && fallo.causa !== 'otro') {
      this.clave = '';
    }
    if (
      fallo.causa === 'recurso-ocupado' ||
      fallo.causa === 'slot-completo' ||
      fallo.causa === 'slot-no-disponible'
    ) {
      this.validarSiCorresponde();
      this.leerOcupante(fallo.turnoEnConflictoId);
      if (!this.conHorarioDelContexto()) {
        this.buscarSinPerderElRechazo();
      }
    }
  }

  private buscarSinPerderElRechazo(): void {
    const elegido = this.horario();
    this.buscarHorarios();
    this.horario.set(elegido);
  }

  private leerOcupante(turnoId: number): void {
    const consultorioId = this.tenant.consultorioId();
    this.ocupante.set('');
    if (consultorioId === null || turnoId <= 0) {
      return;
    }
    this.api.verTurno(consultorioId, turnoId).subscribe({
      next: (turno) => this.ocupante.set(turno.personaNombre ?? ''),
      error: () => this.ocupante.set(''),
    });
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

  protected abrirSobreturno(): void {
    this.sobreturnoAbierto.set(true);
    this.leerOcupante(
      this.validacion()?.turnoEnConflictoId ?? this.rechazo()?.turnoEnConflictoId ?? 0,
    );
  }

  protected confirmarSobreturno(): void {
    const motivo = this.sobreturnoMotivo().trim();
    if (motivo === '') {
      this.faltaMotivoDeSobreturno.set(true);
      return;
    }
    this.faltaMotivoDeSobreturno.set(false);
    this.clave = '';
    this.confirmar(motivo);
  }

  protected irALaListaDeEspera(): void {
    const opcion = this.opcionElegida();
    this.flujo.listaDeEspera({
      origen: this.contexto().origen,
      personaId: this.persona()?.id,
      ofertaId: this.ofertaId() ?? undefined,
      profesionalId: this.profesionalId() ?? undefined,
      casoId: opcion?.casoId,
      planId: opcion?.planId,
      fecha: this.desde() === '' ? undefined : this.desde(),
    });
  }

  protected irAProgramarVarias(): void {
    const opcion = this.opcionElegida();
    this.flujo.programacionMultiple({
      origen: this.contexto().origen,
      personaId: this.persona()?.id,
      ofertaId: this.ofertaId() ?? undefined,
      profesionalId: this.profesionalId() ?? undefined,
      casoId: opcion?.casoId,
      planId: opcion?.planId,
      fecha: this.desde() === '' ? undefined : this.desde(),
    });
  }

  protected verAgendaCompleta(): void {
    const profesional = this.profesionalId();
    this.router
      .navigate(['/agenda'], {
        queryParams: {
          fecha: this.desde() === '' ? undefined : this.desde(),
          profesional: profesional ?? undefined,
        },
      })
      .catch(() => undefined);
    this.cerrar.emit();
  }

  protected motivosDeBusqueda(): string {
    return textoSinMotivoDeBusqueda(this.motivosSinHorario());
  }

  protected rotuloDeCobertura(cobertura: CoberturaResponse): string {
    return coberturaParaReservar(cobertura);
  }

  /** Sin zona conocida se rotula en la del navegador por un instante: la busqueda la corrige. */
  private zona(): string {
    return this.timezone();
  }

  protected hora(instante: string | undefined): string {
    return horaEnZona(instante, this.zona());
  }

  protected hoy(): string {
    return hoyEnZona(this.zona());
  }
}

function textoDeSesiones(prestaciones: readonly SesionesDePrestacion[]): string {
  if (prestaciones.length !== 1) {
    return '';
  }
  const [unica] = prestaciones;
  return ` (${unica.realizadas} realizadas · ${unica.programadas} programadas · ${unica.pendientes} pendientes)`;
}
