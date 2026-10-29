import {
  Component,
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
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of, switchMap } from 'rxjs';

import { Clase } from '../../../../api/generated/model/clase';
import { Cupos } from '../../../../api/generated/model/cupos';
import { EventoDeClase } from '../../../../api/generated/model/evento-de-clase';
import { Inscripcion } from '../../../../api/generated/model/inscripcion';
import { Participante } from '../../../../api/generated/model/participante';
import { PersonaResponse } from '../../../../api/generated/model/persona-response';
import {
  PERMISO_CLASE_MANAGE,
  PERMISO_INSCRIPCION_MANAGE,
  PERMISO_INSCRIPCION_READ,
  PERMISO_SESION_REGISTER,
} from '../../../../core/models/permisos';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { nuevaClaveDeIntento } from '../../../../shared/utils/clave-de-intento';
import { InstructoresDeClaseComponent } from '../../components/instructores-de-clase/instructores-de-clase';
import { ErrorActividad, traducirErrorActividad } from '../../models/actividad-errors';
import {
  admiteBaja,
  admiteCambios,
  admiteConfirmacion,
  fechaDeSede,
  fechaHoraDeSede,
  horaDeSede,
  instanteDesdeHoraDeSede,
  textoDeEstadoDeClase,
  textoDeEstadoDeInscripcion,
  textoDeEventoDeClase,
  nombreDeClase,
  OpcionDeEspacio,
} from '../../models/clases';
import { RUTA_CLASES } from '../../models/rutas-de-clases';
import { ActivityApi } from '../../services/activity-api';
import { AccionesDeFila } from '../../../../shared/components/acciones-de-fila/acciones-de-fila';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { Migas } from '../../../../shared/components/migas/migas';

import { Alerta } from '../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../core/services/avisos.store';

const ESPERA_DE_BUSQUEDA_MS = 300;

/** Que panel de accion esta abierto. Uno por vez: cada uno es una decision distinta. */
type Panel =
  | { readonly tipo: 'ninguno' }
  | { readonly tipo: 'reprogramar' }
  | { readonly tipo: 'cancelar' }
  | { readonly tipo: 'baja'; readonly participante: Participante };

/**
 * Detalle de una clase: cupos, participantes, lista de espera y acciones (M28, RF-M28-002/003/005,
 * RF-M12-010/012, AKINE-08.01 y 08.02).
 *
 * <h2>Tres lecturas, tres permisos</h2>
 *
 * <ul>
 *   <li><b>La clase y sus cupos</b>, con `clase:read`: no nombran a nadie.</li>
 *   <li><b>Los participantes</b>, con `inscripcion:read`: es la unica respuesta de M28 con nombre y
 *       documento. Sin el permiso la seccion no se pide ni se muestra.</li>
 *   <li><b>El historial</b> de la clase (RN-M28-009), con `clase:read`.</li>
 * </ul>
 *
 * <h2>Lo que la pantalla no puede callar</h2>
 *
 * <ul>
 *   <li><b>Quien entro desde la espera.</b> Al dar de baja una inscripcion con lugar el backend
 *       promueve a la cabeza de la cola en el mismo acto y lo devuelve en `promovida`: la pantalla
 *       lo nombra para que el mostrador pueda avisarle en el momento.</li>
 *   <li><b>Que los inscriptos reciben aviso</b> al reprogramar o cancelar. Lo encola el backend; la
 *       pantalla lo anuncia antes de confirmar.</li>
 *   <li><b>Que inscribir no es asistir.</b> Confirmar una reserva no afirma que la persona vino.</li>
 * </ul>
 */
@Component({
  selector: 'app-detalle-de-clase-page',
  imports: [
    Migas,
    CabeceraDePagina,

    Alerta,
    Ayuda,
    ReactiveFormsModule,
    RouterLink,
    ConfirmacionConMotivo,
    InstructoresDeClaseComponent,
    AccionesDeFila,
    PanelLateral,
  ],
  templateUrl: './detalle-de-clase-page.html',
  styleUrl: '../../activity.css',
})
export class DetalleDeClasePage {
  private readonly api = inject(ActivityApi);
  private readonly avisos = inject(AvisosStore);
  private readonly tenant = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly claseId = input('');

  protected readonly RUTA_CLASES = RUTA_CLASES;
  protected readonly textoDeEstado = textoDeEstadoDeClase;
  protected readonly textoDeInscripcion = textoDeEstadoDeInscripcion;
  protected readonly textoDeEvento = textoDeEventoDeClase;
  protected readonly admiteBaja = admiteBaja;
  protected readonly admiteConfirmacion = admiteConfirmacion;

  protected readonly clase = signal<Clase | null>(null);
  protected readonly cupos = signal<Cupos | null>(null);

  /** Cuanto del cupo esta ocupado, para la barra. */
  protected porcentajeDeCupo(c: Cupos): number {
    const capacidad = c.capacidadEfectiva ?? c.capacidad ?? 0;
    return capacidad > 0 ? Math.min(100, Math.round(((c.ocupados ?? 0) / capacidad) * 100)) : 0;
  }
  protected readonly historial = signal<readonly EventoDeClase[]>([]);
  protected readonly participantes = signal<readonly Participante[] | null>(null);
  /** Boxes que ofrece la reprogramacion; se leen al abrirla, no al cargar la clase. */
  protected readonly espacios = signal<readonly OpcionDeEspacio[]>([]);

  protected readonly cargando = signal(false);
  protected readonly errorDeLectura = signal<ErrorActividad | null>(null);
  /** Error de la operacion del panel abierto (reprogramar, cancelar, dar de baja). */
  protected readonly errorDeAccion = signal<ErrorActividad | null>(null);
  /** Error de la busqueda o de la inscripcion: se muestra en "Inscribir a una persona". */
  protected readonly errorDeInscripcion = signal<ErrorActividad | null>(null);
  /** Los participantes no se pudieron leer: se dice en su seccion, con Reintentar. */
  protected readonly errorDeParticipantes = signal<ErrorActividad | null>(null);
  /** La hora de fin de la reprogramacion no es posterior a la de inicio (UX-12: en el campo). */
  protected readonly finAntesDeInicio = signal(false);

  /**
   * Que dato de la reprogramacion choca con algo que ya existe: se muestra pegado a esos campos
   * (UX-12) y no como error general del panel.
   */
  protected readonly conflictoDeReprogramacion = computed<'horario' | 'cupo' | null>(() => {
    switch (this.errorDeAccion()?.causa) {
      case 'recurso-ocupado':
      case 'horario-no-disponible':
        return 'horario';
      case 'clase-capacidad-no-admitida':
        return 'cupo';
      default:
        return null;
    }
  });

  /** La persona elegida choca con la clase: no hay lugar, o ya esta anotada. */
  protected readonly conflictoDeInscripcion = computed(() => {
    const causa = this.errorDeInscripcion()?.causa;
    return causa === 'clase-completa' || causa === 'ya-inscripta';
  });
  protected readonly enviando = signal(false);
  protected readonly panel = signal<Panel>({ tipo: 'ninguno' });

  // Inscripcion
  protected readonly candidatas = signal<readonly PersonaResponse[]>([]);
  protected readonly buscoPersonas = signal(false);
  protected readonly persona = signal<PersonaResponse | null>(null);
  protected readonly aceptaEspera = signal(false);
  private busquedaPendiente: ReturnType<typeof setTimeout> | undefined;
  private claveDeInscripcion = nuevaClaveDeIntento();

  protected readonly zona = computed(() => this.diaDeLaSede.zona());
  protected readonly editable = computed(() => admiteCambios(this.clase()));
  protected readonly puedeGestionar = computed(
    () => this.permisos.tiene(PERMISO_CLASE_MANAGE) && this.editable(),
  );
  /**
   * Los instructores adicionales (DP-38) se cambian tambien en una clase ya dictada —es justo la
   * que se liquida—; solo la cancelada no admite cambios.
   */
  protected readonly puedeCambiarInstructores = computed(
    () => this.permisos.tiene(PERMISO_CLASE_MANAGE) && this.clase()?.estado !== 'CANCELADA',
  );
  protected readonly puedeInscribir = computed(
    () => this.permisos.tiene(PERMISO_INSCRIPCION_MANAGE) && this.editable(),
  );
  protected readonly puedeVerParticipantes = computed(() =>
    this.permisos.tiene(PERMISO_INSCRIPCION_READ),
  );
  /** Ofrece la atencion clinica de la clase (AKINE-08.05). UX: el backend decide igual. */
  protected readonly puedeAtender = computed(() => this.permisos.tiene(PERMISO_SESION_REGISTER));
  protected readonly puedeOperarInscripciones = computed(() =>
    this.permisos.tiene(PERMISO_INSCRIPCION_MANAGE),
  );

  protected readonly conLugar = computed(() =>
    (this.participantes() ?? []).filter((p) => {
      const estado = p.inscripcion?.estado;
      return estado !== 'LISTA_ESPERA' && estado !== 'CANCELADA';
    }),
  );
  protected readonly enEspera = computed(() =>
    (this.participantes() ?? [])
      .filter((p) => p.inscripcion?.estado === 'LISTA_ESPERA')
      .sort((a, b) => (a.inscripcion?.posicionEspera ?? 0) - (b.inscripcion?.posicionEspera ?? 0)),
  );
  protected readonly canceladas = computed(() =>
    (this.participantes() ?? []).filter((p) => p.inscripcion?.estado === 'CANCELADA'),
  );

  protected readonly reprogramacion = this.fb.group({
    fecha: ['', Validators.required],
    horaInicio: ['', Validators.required],
    horaFin: ['', Validators.required],
    capacidad: [1, [Validators.required, Validators.min(1)]],
    espacioId: [''],
  });

  constructor() {
    effect(() => {
      this.claseId();
      this.tenant.contextEpoch();
      untracked(() => {
        this.limpiar();
        this.cargar();
      });
    });
    // Los participantes dependen del permiso, que puede llegar despues de la clase.
    effect(() => {
      const puede = this.puedeVerParticipantes();
      const clase = this.clase();
      untracked(() => {
        if (puede && clase !== null && this.participantes() === null) {
          this.cargarParticipantes();
        }
      });
    });
  }

  // -------------------------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------------------------

  protected cargar(): void {
    const consultorioId = this.tenant.consultorioId();
    const claseId = this.id();
    if (consultorioId === null || claseId === null) {
      return;
    }
    this.permisos.asegurarCargados();
    const epoca = this.tenant.contextEpoch();
    this.cargando.set(true);
    this.errorDeLectura.set(null);
    forkJoin({
      clase: this.api.ver(consultorioId, claseId),
      cupos: this.api.cupos(consultorioId, claseId).pipe(catchError(() => of(null))),
      historial: this.api.historial(consultorioId, claseId).pipe(catchError(() => of([]))),
    }).subscribe({
      next: ({ clase, cupos, historial }) => {
        if (epoca !== this.tenant.contextEpoch()) {
          return;
        }
        this.cargando.set(false);
        this.clase.set(clase);
        this.cupos.set(cupos);
        this.historial.set(historial);
        if (this.participantes() !== null) {
          this.cargarParticipantes();
        }
      },
      error: (error: unknown) => {
        this.cargando.set(false);
        this.errorDeLectura.set(traducirErrorActividad(error));
      },
    });
  }

  private cargarParticipantes(): void {
    const consultorioId = this.tenant.consultorioId();
    const claseId = this.id();
    if (consultorioId === null || claseId === null) {
      return;
    }
    this.errorDeParticipantes.set(null);
    this.api.participantes(consultorioId, claseId).subscribe({
      next: (participantes) => this.participantes.set(participantes),
      error: (error: unknown) => {
        this.participantes.set([]);
        this.errorDeParticipantes.set(traducirErrorActividad(error));
      },
    });
  }

  /** Relee clase, cupos, historial y participantes despues de cualquier escritura. */
  protected releer(): void {
    this.cargar();
  }

  // -------------------------------------------------------------------------------------------
  // Celdas
  // -------------------------------------------------------------------------------------------

  protected horario(): string {
    const clase = this.clase();
    if (clase === null) {
      return '';
    }
    return `${fechaHoraDeSede(clase.inicio, this.zona())} a ${horaDeSede(clase.fin, this.zona())}`;
  }

  protected titulo(): string {
    return nombreDeClase(this.clase());
  }

  protected nombreDe(participante: Participante | undefined): string {
    if (participante === undefined) {
      return '';
    }
    const nombre = [participante.apellido, participante.nombre].filter(Boolean).join(', ');
    return nombre || `Persona #${participante.inscripcion?.personaId ?? ''}`;
  }

  protected documentoDe(participante: Participante): string {
    return [participante.tipoDocumento, participante.numeroDocumento].filter(Boolean).join(' ');
  }

  protected cuando(instante: string | undefined): string {
    return fechaHoraDeSede(instante, this.zona());
  }

  // -------------------------------------------------------------------------------------------
  // Reprogramar y cancelar la clase
  // -------------------------------------------------------------------------------------------

  protected abrirReprogramacion(): void {
    const clase = this.clase();
    if (clase === null) {
      return;
    }
    const zona = this.zona();
    this.reprogramacion.setValue({
      fecha: fechaDeSede(clase.inicio, zona),
      horaInicio: horaDeSede(clase.inicio, zona),
      horaFin: horaDeSede(clase.fin, zona),
      capacidad: clase.capacidad ?? 1,
      espacioId: clase.espacioId !== undefined ? String(clase.espacioId) : '',
    });
    this.errorDeAccion.set(null);
    this.finAntesDeInicio.set(false);
    this.panel.set({ tipo: 'reprogramar' });
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId !== null) {
      this.cargarEspacios(consultorioId, clase);
    }
  }

  protected abrirCancelacion(): void {
    this.errorDeAccion.set(null);
    this.panel.set({ tipo: 'cancelar' });
  }

  /**
   * Cierra el panel lateral abierto y lleva el foco al control que lo abrio (WCAG 2.4.3).
   * "Reprogramar" sigue a la vista; "Cancelar la clase" vive en el menu "⋯" de la cabecera
   * (refactor UX/UI del 28/10/2026), que queda cerrado: el foco vuelve a ese boton "⋯". La baja de
   * un participante no lo necesita: el panel le devuelve el foco solo.
   */
  protected cerrarPanel(): void {
    const abierto = this.panel().tipo;
    this.panel.set({ tipo: 'ninguno' });
    if (abierto === 'reprogramar') {
      this.enfocarDespues('#boton-reprogramar');
    } else if (abierto === 'cancelar') {
      this.enfocarDespues('[cabeceraAcciones] .acciones-de-fila__boton');
    }
  }

  /**
   * El resultado de una accion va al aviso global (UX-12). El foco no se pierde: el boton que la
   * disparo suele desaparecer con ella (la persona elegida, la confirmacion de la fila), asi que
   * quien llama dice a donde llevarlo.
   */
  private avisar(titulo: string, descripcion: string, foco: string | null): void {
    this.avisos.exito(titulo, descripcion === '' ? undefined : { descripcion });
    if (foco !== null) {
      this.enfocarDespues(foco);
    }
  }

  /** Mensaje del backend y su detalle, en una linea, para la descripcion de un aviso. */
  private descripcionDe(fallo: ErrorActividad): string {
    return fallo.motivo ? `${fallo.mensaje} Detalle: ${fallo.motivo}` : fallo.mensaje;
  }

  private enfocarDespues(selector: string): void {
    afterNextRender(
      () => {
        const destino = this.host.nativeElement.querySelector<HTMLElement>(selector);
        // El `h1` de la cabecera no es enfocable por si mismo: se lo vuelve, solo por programa.
        if (destino !== null && !destino.hasAttribute('tabindex')) {
          destino.setAttribute('tabindex', '-1');
        }
        destino?.focus();
      },
      { injector: this.injector },
    );
  }

  protected reprogramar(): void {
    const consultorioId = this.tenant.consultorioId();
    const clase = this.clase();
    if (consultorioId === null || clase?.id === undefined || this.reprogramacion.invalid) {
      this.reprogramacion.markAllAsTouched();
      return;
    }
    const valor = this.reprogramacion.getRawValue();
    const zona = this.zona();
    const inicio = instanteDesdeHoraDeSede(valor.fecha, valor.horaInicio, zona);
    const fin = instanteDesdeHoraDeSede(valor.fecha, valor.horaFin, zona);
    if (inicio === null || fin === null || fin <= inicio) {
      this.errorDeAccion.set(null);
      this.finAntesDeInicio.set(true);
      this.enfocarDespues('#reprogramar-fin');
      return;
    }
    this.finAntesDeInicio.set(false);
    this.enviando.set(true);
    this.errorDeAccion.set(null);
    this.api
      .reprogramar(consultorioId, clase.id, {
        inicio,
        fin,
        capacidad: Number(valor.capacidad),
        profesionalId: clase.profesionalId,
        espacioId: valor.espacioId === '' ? undefined : Number(valor.espacioId),
        version: clase.version ?? 0,
      })
      .subscribe({
        next: () => {
          this.enviando.set(false);
          this.cerrarPanel();
          this.avisar(
            'Clase reprogramada',
            'Si cambio el horario, los inscriptos reciben un aviso.',
            null,
          );
          this.releer();
        },
        error: (error: unknown) => this.fallo(error),
      });
  }

  protected cancelarClase(motivo: string): void {
    const consultorioId = this.tenant.consultorioId();
    const clase = this.clase();
    if (consultorioId === null || clase?.id === undefined) {
      return;
    }
    this.enviando.set(true);
    this.errorDeAccion.set(null);
    this.api.cancelar(consultorioId, clase.id, motivo).subscribe({
      next: () => {
        this.enviando.set(false);
        // Cancelada, la clase ya no ofrece el menu que abrio el panel: el foco va al titulo.
        this.panel.set({ tipo: 'ninguno' });
        this.avisar(
          'Clase cancelada',
          'Las inscripciones quedaron canceladas y los inscriptos reciben un aviso.',
          'h1',
        );
        this.releer();
      },
      error: (error: unknown) => this.fallo(error),
    });
  }

  // -------------------------------------------------------------------------------------------
  // Inscripciones
  // -------------------------------------------------------------------------------------------

  protected buscarPersona(texto: string): void {
    clearTimeout(this.busquedaPendiente);
    if (texto.trim() === '') {
      this.candidatas.set([]);
      this.buscoPersonas.set(false);
      return;
    }
    this.busquedaPendiente = setTimeout(() => {
      this.api.buscarPersonas(texto).subscribe({
        next: (pagina) => {
          this.candidatas.set(pagina.content ?? []);
          this.buscoPersonas.set(true);
        },
        error: (error: unknown) => this.errorDeInscripcion.set(traducirErrorActividad(error)),
      });
    }, ESPERA_DE_BUSQUEDA_MS);
  }

  protected elegirPersona(candidata: PersonaResponse): void {
    this.persona.set(candidata);
    this.candidatas.set([]);
    this.buscoPersonas.set(false);
    this.errorDeInscripcion.set(null);
    this.claveDeInscripcion = nuevaClaveDeIntento();
  }

  protected quitarPersona(): void {
    this.persona.set(null);
    this.errorDeInscripcion.set(null);
  }

  protected cambiarAceptaEspera(valor: boolean): void {
    this.aceptaEspera.set(valor);
    this.claveDeInscripcion = nuevaClaveDeIntento();
  }

  /** `conEspera` fuerza la lista de espera: es la salida que ofrece `clase-completa`. */
  protected inscribir(conEspera = false): void {
    const consultorioId = this.tenant.consultorioId();
    const claseId = this.id();
    const persona = this.persona();
    if (consultorioId === null || claseId === null || persona?.id === undefined) {
      return;
    }
    if (conEspera && !this.aceptaEspera()) {
      this.aceptaEspera.set(true);
      this.claveDeInscripcion = nuevaClaveDeIntento();
    }
    this.enviando.set(true);
    this.errorDeInscripcion.set(null);
    this.api
      .inscribir(consultorioId, claseId, {
        personaId: persona.id,
        aceptaListaEspera: this.aceptaEspera(),
        idempotencyKey: this.claveDeInscripcion,
      })
      .subscribe({
        next: (resultado) => {
          this.enviando.set(false);
          const nombre = [persona.apellido, persona.nombre].filter(Boolean).join(', ');
          const { titulo, descripcion } = avisoDeInscripcion(nombre, resultado.inscripcion);
          // La persona elegida desaparece con su boton: el foco vuelve a la busqueda.
          this.avisar(titulo, descripcion, '#inscribir-persona');
          this.persona.set(null);
          this.aceptaEspera.set(false);
          this.claveDeInscripcion = nuevaClaveDeIntento();
          this.releer();
        },
        error: (error: unknown) => {
          const traducido = traducirErrorActividad(error);
          if (traducido.accion === 'reintentar-con-clave-nueva') {
            this.claveDeInscripcion = nuevaClaveDeIntento();
          }
          this.enviando.set(false);
          this.errorDeInscripcion.set(traducido);
          if (traducido.accion === 'recargar') {
            this.releer();
          }
        },
      });
  }

  protected confirmar(participante: Participante): void {
    const consultorioId = this.tenant.consultorioId();
    const claseId = this.id();
    const inscripcionId = participante.inscripcion?.id;
    if (consultorioId === null || claseId === null || inscripcionId === undefined) {
      return;
    }
    this.enviando.set(true);
    this.api.confirmar(consultorioId, claseId, inscripcionId).subscribe({
      next: () => {
        this.enviando.set(false);
        // El boton de la fila desaparece: el foco va al titulo de los participantes.
        this.avisar('Inscripción confirmada', this.nombreDe(participante), '#titulo-participantes');
        this.releer();
      },
      // Accion de fila, sin formulario: aviso global (UX-12). Si la clase quedo vieja se relee
      // sola; un fallo de red se puede reintentar.
      error: (error: unknown) => {
        this.enviando.set(false);
        const traducido = traducirErrorActividad(error);
        const reintentable = traducido.causa === 'red' || traducido.causa === 'otro';
        this.avisos.error('No pudimos confirmar la inscripción', {
          descripcion: this.descripcionDe(traducido),
          accion: reintentable
            ? { etiqueta: 'Reintentar', ejecutar: () => this.confirmar(participante) }
            : undefined,
        });
        if (traducido.accion === 'recargar') {
          this.releer();
        }
      },
    });
  }

  protected abrirBaja(participante: Participante): void {
    this.errorDeAccion.set(null);
    this.panel.set({ tipo: 'baja', participante });
  }

  protected participanteEnBaja(): Participante | null {
    const panel = this.panel();
    return panel.tipo === 'baja' ? panel.participante : null;
  }

  protected darDeBaja(motivo: string): void {
    const consultorioId = this.tenant.consultorioId();
    const claseId = this.id();
    const participante = this.participanteEnBaja();
    const inscripcionId = participante?.inscripcion?.id;
    if (consultorioId === null || claseId === null || inscripcionId === undefined) {
      return;
    }
    this.enviando.set(true);
    this.errorDeAccion.set(null);
    this.api.darDeBaja(consultorioId, claseId, inscripcionId, motivo).subscribe({
      next: (resultado) => {
        this.enviando.set(false);
        this.panel.set({ tipo: 'ninguno' });
        const promovida = resultado.promovida;
        const quien = (this.participantes() ?? []).find(
          (p) => p.inscripcion?.id !== undefined && p.inscripcion.id === promovida?.id,
        );
        // La fila puede cambiar de lista: el foco va al titulo de los participantes.
        this.avisar(
          `Se dio de baja a ${this.nombreDe(participante ?? undefined)}`,
          promovida
            ? `${this.nombreDe(quien) || `La persona #${promovida.personaId}`} entro desde la ` +
                'lista de espera y recibe un aviso.'
            : '',
          '#titulo-participantes',
        );
        this.releer();
      },
      error: (error: unknown) => this.fallo(error),
    });
  }

  // -------------------------------------------------------------------------------------------

  private fallo(error: unknown, traducido = traducirErrorActividad(error)): void {
    this.enviando.set(false);
    this.errorDeAccion.set(traducido);
    if (traducido.accion === 'recargar') {
      this.releer();
    }
  }

  private id(): number | null {
    const id = Number(this.claseId());
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  private limpiar(): void {
    this.clase.set(null);
    this.cupos.set(null);
    this.historial.set([]);
    this.participantes.set(null);
    this.espacios.set([]);
    this.errorDeAccion.set(null);
    this.errorDeInscripcion.set(null);
    this.errorDeParticipantes.set(null);
    this.persona.set(null);
    this.panel.set({ tipo: 'ninguno' });
  }

  /**
   * Boxes para reprogramar. El actual va siempre primero, aunque ya no figure entre los elegibles:
   * conservarlo es lo que el contrato pide mandar, y si dejo de servir el 409 lo dice.
   */
  private cargarEspacios(consultorioId: number, clase: Clase): void {
    const actual: OpcionDeEspacio[] =
      clase.espacioId !== undefined
        ? [{ espacioId: clase.espacioId, nombre: clase.espacioNombre || `Box #${clase.espacioId}` }]
        : [];
    this.espacios.set(actual);
    const ofertaId = clase.ofertaId;
    if (ofertaId === undefined) {
      return;
    }
    const claseId = clase.id;
    this.api
      .habilitaciones(consultorioId, ofertaId)
      .pipe(
        catchError(() => of(null)),
        switchMap((habilitaciones) =>
          this.api.espaciosElegibles(this.tenant.organizationId(), consultorioId, habilitaciones),
        ),
      )
      .subscribe((elegibles) => {
        if (this.clase()?.id !== claseId) {
          return;
        }
        this.espacios.set([...actual, ...elegibles.filter((e) => e.espacioId !== clase.espacioId)]);
      });
  }
}

function avisoDeInscripcion(
  nombre: string,
  inscripcion: Inscripcion | undefined,
): { titulo: string; descripcion: string } {
  const quien = nombre || 'La persona';
  if (inscripcion?.estado === 'LISTA_ESPERA') {
    return {
      titulo: `${quien} quedo en la lista de espera, posicion ${inscripcion.posicionEspera ?? '?'}`,
      descripcion: 'Entra sola si alguien se da de baja.',
    };
  }
  return { titulo: `${quien} quedo inscripta con lugar`, descripcion: '' };
}
