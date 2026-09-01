import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Agenda } from '../../../../api/generated/model/agenda';
import { PersonaResponse } from '../../../../api/generated/model/persona-response';
import { ProfesionalHabilitado } from '../../../../api/generated/model/profesional-habilitado';
import { SlotDisponible } from '../../../../api/generated/model/slot-disponible';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Turno } from '../../../../api/generated/model/turno';
import { SchedulingApi } from '../../services/scheduling-api';
import { AccionSugerida, ErrorAgenda, traducirErrorAgenda } from '../../models/agenda-errors';
import {
  fechaEnPalabras,
  horaEnZona,
  rangoEnZona,
  slotCompleto,
  sumarDias,
  textoDeCupo,
} from '../../models/etiquetas-de-agenda';

/**
 * Reserva y confirmacion de un turno (M12, AKINE-05.02).
 *
 * <p>Llega desde la grilla con la oferta, el dia y el instante del slot elegido. Muestra el
 * resumen, deja elegir a quien se le reserva, reserva y confirma.
 *
 * <h2>1. Resumen antes de confirmar</h2>
 *
 * <p>El paso de revision no es cortesia: es lo unico que hay entre un click y un turno equivocado
 * en la agenda de un profesional. Cancelar y mover ya existen —AKINE-05.03— y viven en
 * `pages/ciclo-de-turno`, a la que esta pantalla enlaza pasandole la version del turno.
 *
 * <h2>2. La clave de idempotencia es lo que hace que el doble click no cree dos turnos</h2>
 *
 * <p>Se genera <b>una por intento</b> y se mantiene estable mientras el intento sea el mismo: si
 * el operador aprieta dos veces, o reintenta despues de un timeout, el backend devuelve <b>200 con
 * el turno ya creado</b> en vez de un segundo 201.
 *
 * <p><b>Y se regenera cuando el intento cambia</b> —otra persona, otro horario, otro
 * profesional—, porque reusarla con otro contenido es exactamente lo que el backend rechaza con
 * `idempotency-key-conflict`. Esa es la unica forma de que ese 409 no aparezca nunca por culpa de
 * esta pantalla.
 *
 * <h2>3. Los cuatro conflictos llevan a cuatro acciones distintas</h2>
 *
 * <p>Es el corazon de la etapa. La pantalla ramifica por {@link AccionSugerida} y ofrece el boton
 * que resuelve cada caso: recargar la agenda, ofrecer el turno siguiente, volver a elegir horario
 * o profesional, o activar el perfil de paciente. Un "no se pudo" generico dejaria al operador sin
 * ninguna de las cuatro.
 *
 * <h2>4. La lectura del dia se rehace, no se hereda</h2>
 *
 * <p>El resumen se arma releyendo la agenda de ese dia y no con datos arrastrados por la URL. Es
 * mas caro y es correcto: entre que se dibujo la grilla y se abrio esta pantalla pudo entrar
 * otro, y ademas de ahi salen el `timezone` y la duracion, que son de la respuesta y no del
 * cliente.
 */
@Component({
  selector: 'app-reserva-de-turno-page',
  imports: [RouterLink],
  templateUrl: './reserva-de-turno-page.html',
  styleUrl: '../../agenda.css',
})
export class ReservaDeTurnoPage {
  private readonly api = inject(SchedulingApi);
  private readonly tenantContext = inject(TenantContextStore);

  /** De la ruta. `withComponentInputBinding` los liga solos. */
  readonly ofertaId = input.required<string>();
  readonly fecha = input<string>('');
  readonly inicio = input<string>('');
  readonly profesionalId = input<string>('');

  protected readonly fechaEnPalabras = fechaEnPalabras;
  protected readonly textoDeCupo = textoDeCupo;

  protected readonly agenda = signal<Agenda | null>(null);
  protected readonly profesionales = signal<readonly ProfesionalHabilitado[]>([]);
  protected readonly cargando = signal(false);

  /** Instante del slot que se esta por reservar. Cambia si se acepta el turno siguiente. */
  protected readonly instante = signal('');

  protected readonly persona = signal<PersonaResponse | null>(null);
  protected readonly candidatas = signal<readonly PersonaResponse[]>([]);
  protected readonly buscoPersonas = signal(false);

  protected readonly turno = signal<Turno | null>(null);
  protected readonly enviando = signal(false);
  protected readonly error = signal<ErrorAgenda | null>(null);
  protected readonly exito = signal<string | null>(null);

  /**
   * Clave de idempotencia del intento en curso.
   *
   * <p>Se crea vacia y se genera al primer envio; se borra cuando cambia la persona o el horario,
   * que es lo que define un intento distinto.
   */
  private readonly claveDeIntento = signal('');

  protected readonly timezone = computed(() => this.agenda()?.timezone ?? '');
  protected readonly duracion = computed(() => this.agenda()?.duracionMinutos ?? 0);
  protected readonly nombreComercial = computed(() => this.agenda()?.nombreComercial ?? '');

  /** Slots del dia, tal como los devolvio la relectura. */
  protected readonly slotsDelDia = computed<readonly SlotDisponible[]>(
    () => this.agenda()?.dias?.[0]?.slots ?? [],
  );

  protected readonly slot = computed<SlotDisponible | null>(
    () => this.slotsDelDia().find((s) => s.desde === this.instante()) ?? null,
  );

  /** El primer slot posterior al actual con cupo. Es lo que ofrece `slot-completo`. */
  protected readonly siguienteConCupo = computed<SlotDisponible | null>(() => {
    const actual = this.instante();
    return (
      this.slotsDelDia().find(
        (s) => (s.desde ?? '') > actual && !slotCompleto(s) && s.desde !== undefined,
      ) ?? null
    );
  });

  protected readonly horario = computed(() => {
    const slot = this.slot();
    return slot === null ? '' : rangoEnZona(slot, this.timezone());
  });

  protected readonly nombreDelProfesional = computed(() => {
    const id = this.profesionalDelSlot();
    if (id === null) {
      return '';
    }
    return this.profesionales().find((p) => p.membershipId === id)?.nombre ?? `#${id}`;
  });

  protected readonly accion = computed<AccionSugerida>(() => this.error()?.accion ?? 'ninguna');

  /** `true` cuando el turno ya existe y solo falta confirmarlo. */
  protected readonly reservado = computed(() => this.turno() !== null);
  protected readonly confirmado = computed(() => this.turno()?.estado === 'CONFIRMADO');

  constructor() {
    effect(() => {
      // Depende de la ruta y del contexto: cambiar de sede invalida la oferta, el slot y la
      // persona elegida, que son todos de la sede anterior.
      const inicio = this.inicio();
      this.ofertaId();
      this.fecha();
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.instante.set(inicio);
        this.persona.set(null);
        this.candidatas.set([]);
        this.turno.set(null);
        this.claveDeIntento.set('');
        this.error.set(null);
        this.exito.set(null);
        this.cargarDia();
      });
    });
  }

  // -------------------------------------------------------------------------------------
  // Lectura del dia
  // -------------------------------------------------------------------------------------

  /** Relee la agenda del dia del slot. Es tambien la accion de `recargar-agenda`. */
  protected cargarDia(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const ofertaId = this.numeroDeOferta();
    const fecha = this.fecha();
    if (consultorioId === null || ofertaId === null || fecha === '') {
      return;
    }

    this.cargando.set(true);
    this.api
      .buscarAgenda(consultorioId, ofertaId, { desde: fecha, hasta: sumarDias(fecha, 1) })
      .subscribe({
        next: (agenda) => {
          this.agenda.set(agenda);
          this.cargando.set(false);
        },
        error: (error: unknown) => {
          this.cargando.set(false);
          this.error.set(traducirErrorAgenda(error));
        },
      });

    this.api.habilitaciones(consultorioId, ofertaId).subscribe({
      next: (respuesta) => this.profesionales.set(respuesta.profesionales ?? []),
      error: () => this.profesionales.set([]),
    });
  }

  // -------------------------------------------------------------------------------------
  // A quien se le reserva
  // -------------------------------------------------------------------------------------

  protected buscarPersona(texto: string): void {
    if (texto.trim() === '') {
      this.candidatas.set([]);
      this.buscoPersonas.set(false);
      return;
    }

    this.api.buscarPersonas(texto).subscribe({
      next: (pagina) => {
        this.candidatas.set(pagina.content ?? []);
        this.buscoPersonas.set(true);
      },
      error: (error: unknown) => this.error.set(traducirErrorAgenda(error)),
    });
  }

  protected elegirPersona(persona: PersonaResponse): void {
    this.persona.set(persona);
    this.candidatas.set([]);
    this.buscoPersonas.set(false);
    // Otra persona es otro intento: la clave anterior identificaba un pedido distinto y
    // reusarla seria exactamente el 409 `idempotency-key-conflict`.
    this.claveDeIntento.set('');
    this.error.set(null);
  }

  // -------------------------------------------------------------------------------------
  // Reserva y confirmacion
  // -------------------------------------------------------------------------------------

  protected reservar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const ofertaId = this.numeroDeOferta();
    const persona = this.persona();
    const instante = this.instante();
    if (
      consultorioId === null ||
      ofertaId === null ||
      persona?.id === undefined ||
      instante === ''
    ) {
      return;
    }

    this.enviando.set(true);
    this.error.set(null);

    this.api
      .reservar(consultorioId, ofertaId, {
        inicio: instante,
        personaId: persona.id,
        profesionalId: this.profesionalDelSlot() ?? undefined,
        idempotencyKey: this.claveDelIntento(),
      })
      .subscribe({
        next: (turno) => {
          this.enviando.set(false);
          this.turno.set(turno);
          this.exito.set(
            'Turno reservado. Todavia falta confirmarlo: confirmar es un estado de la reserva, no ' +
              'del cobro ni de la llegada del paciente.',
          );
        },
        error: (error: unknown) => {
          this.enviando.set(false);
          const traducido = traducirErrorAgenda(error);
          this.error.set(traducido);

          // La clave se quema sola en el unico caso donde reusarla vuelve a fallar seguro.
          if (traducido.causa === 'clave-reusada') {
            this.claveDeIntento.set('');
          }
        },
      });
  }

  protected confirmar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const turnoId = this.turno()?.id;
    if (consultorioId === null || turnoId === undefined) {
      return;
    }

    this.enviando.set(true);
    this.error.set(null);
    this.api.confirmar(consultorioId, turnoId).subscribe({
      next: (turno) => {
        this.enviando.set(false);
        this.turno.set(turno);
        this.exito.set('Turno confirmado.');
      },
      error: (error: unknown) => {
        this.enviando.set(false);
        this.error.set(traducirErrorAgenda(error));
      },
    });
  }

  /** Accion de `slot-completo`: correr el intento al primer horario del dia que tenga cupo. */
  protected tomarElSiguiente(): void {
    const siguiente = this.siguienteConCupo();
    if (siguiente?.desde === undefined) {
      return;
    }
    this.instante.set(siguiente.desde);
    // Otro horario es otro intento.
    this.claveDeIntento.set('');
    this.error.set(null);
  }

  /** Accion de `recargar-agenda`: el hueco dejo de existir y hay que releer el dia. */
  protected recargar(): void {
    this.error.set(null);
    this.cargarDia();
  }

  /** Accion de `reintentar-con-clave-nueva`. La clave ya se limpio al recibir el 409. */
  protected reintentar(): void {
    this.error.set(null);
    this.reservar();
  }

  // -------------------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------------------

  /** Hora local del slot, para el resumen. */
  protected hora(instante: string | undefined): string {
    return horaEnZona(instante, this.timezone());
  }

  protected esElActual(slot: SlotDisponible): boolean {
    return slot.desde === this.instante();
  }

  private profesionalDelSlot(): number | null {
    const delSlot = this.slot()?.profesionalId;
    if (delSlot !== undefined) {
      return delSlot;
    }
    const deLaUrl = Number(this.profesionalId());
    return Number.isFinite(deLaUrl) && deLaUrl > 0 ? deLaUrl : null;
  }

  private numeroDeOferta(): number | null {
    const id = Number(this.ofertaId());
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  /**
   * La clave del intento, generandola si todavia no existe.
   *
   * <p>`crypto.randomUUID` no esta en contextos inseguros ni en algunos runtimes de test, asi que
   * hay respaldo: una clave debil es peor que ninguna solo si se repite, y esta no se repite
   * dentro de una sesion.
   */
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
