import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';

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
} from '../../../../core/models/permisos';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { nuevaClaveDeIntento } from '../../../../shared/utils/clave-de-intento';
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
} from '../../models/clases';
import { RUTA_CLASES } from '../../models/rutas-de-clases';
import { ActivityApi } from '../../services/activity-api';

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
  imports: [ReactiveFormsModule, RouterLink, ConfirmacionConMotivo],
  templateUrl: './detalle-de-clase-page.html',
  styleUrl: '../../activity.css',
})
export class DetalleDeClasePage {
  private readonly api = inject(ActivityApi);
  private readonly tenant = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly claseId = input('');

  protected readonly RUTA_CLASES = RUTA_CLASES;
  protected readonly textoDeEstado = textoDeEstadoDeClase;
  protected readonly textoDeInscripcion = textoDeEstadoDeInscripcion;
  protected readonly textoDeEvento = textoDeEventoDeClase;
  protected readonly admiteBaja = admiteBaja;
  protected readonly admiteConfirmacion = admiteConfirmacion;

  protected readonly clase = signal<Clase | null>(null);
  protected readonly cupos = signal<Cupos | null>(null);
  protected readonly historial = signal<readonly EventoDeClase[]>([]);
  protected readonly participantes = signal<readonly Participante[] | null>(null);
  protected readonly nombreDeOferta = signal('');
  protected readonly nombreDeProfesional = signal('');

  protected readonly cargando = signal(false);
  protected readonly errorDeLectura = signal<ErrorActividad | null>(null);
  protected readonly errorDeAccion = signal<ErrorActividad | null>(null);
  protected readonly aviso = signal('');
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
  protected readonly puedeInscribir = computed(
    () => this.permisos.tiene(PERMISO_INSCRIPCION_MANAGE) && this.editable(),
  );
  protected readonly puedeVerParticipantes = computed(() =>
    this.permisos.tiene(PERMISO_INSCRIPCION_READ),
  );
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
        this.resolverNombres(consultorioId, clase);
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
    this.api.participantes(consultorioId, claseId).subscribe({
      next: (participantes) => this.participantes.set(participantes),
      error: (error: unknown) => {
        this.participantes.set([]);
        this.errorDeAccion.set(traducirErrorActividad(error));
      },
    });
  }

  /** Relee clase, cupos, historial y participantes despues de cualquier escritura. */
  private releer(): void {
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
    const clase = this.clase();
    return clase?.titulo || this.nombreDeOferta() || `Clase #${clase?.id ?? ''}`;
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
    });
    this.errorDeAccion.set(null);
    this.panel.set({ tipo: 'reprogramar' });
  }

  protected abrirCancelacion(): void {
    this.errorDeAccion.set(null);
    this.panel.set({ tipo: 'cancelar' });
  }

  protected cerrarPanel(): void {
    this.panel.set({ tipo: 'ninguno' });
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
      this.errorDeAccion.set({
        mensaje: 'La hora de fin tiene que ser posterior a la de inicio.',
        causa: 'validacion',
        accion: 'corregir',
        motivo: '',
        campos: {},
      });
      return;
    }
    this.enviando.set(true);
    this.errorDeAccion.set(null);
    this.api
      .reprogramar(consultorioId, clase.id, {
        inicio,
        fin,
        capacidad: Number(valor.capacidad),
        profesionalId: clase.profesionalId,
        version: clase.version ?? 0,
      })
      .subscribe({
        next: () => {
          this.enviando.set(false);
          this.panel.set({ tipo: 'ninguno' });
          this.aviso.set(
            'Clase reprogramada. Si cambio el horario, los inscriptos reciben un aviso.',
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
        this.panel.set({ tipo: 'ninguno' });
        this.aviso.set(
          'Clase cancelada. Las inscripciones quedaron canceladas y los inscriptos reciben un aviso.',
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
        error: (error: unknown) => this.errorDeAccion.set(traducirErrorActividad(error)),
      });
    }, ESPERA_DE_BUSQUEDA_MS);
  }

  protected elegirPersona(candidata: PersonaResponse): void {
    this.persona.set(candidata);
    this.candidatas.set([]);
    this.buscoPersonas.set(false);
    this.errorDeAccion.set(null);
    this.claveDeInscripcion = nuevaClaveDeIntento();
  }

  protected quitarPersona(): void {
    this.persona.set(null);
    this.errorDeAccion.set(null);
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
    this.errorDeAccion.set(null);
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
          this.aviso.set(mensajeDeInscripcion(nombre, resultado.inscripcion));
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
          this.fallo(error, traducido);
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
    this.errorDeAccion.set(null);
    this.api.confirmar(consultorioId, claseId, inscripcionId).subscribe({
      next: () => {
        this.enviando.set(false);
        this.aviso.set(`Inscripcion de ${this.nombreDe(participante)} confirmada.`);
        this.releer();
      },
      error: (error: unknown) => this.fallo(error),
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
        this.aviso.set(
          `Se dio de baja a ${this.nombreDe(participante ?? undefined)}.` +
            (promovida
              ? ` ${this.nombreDe(quien) || `La persona #${promovida.personaId}`} entro desde la ` +
                'lista de espera y recibe un aviso.'
              : ''),
        );
        this.releer();
      },
      error: (error: unknown) => this.fallo(error),
    });
  }

  // -------------------------------------------------------------------------------------------

  private fallo(error: unknown, traducido = traducirErrorActividad(error)): void {
    this.enviando.set(false);
    this.aviso.set('');
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
    this.nombreDeOferta.set('');
    this.nombreDeProfesional.set('');
    this.errorDeAccion.set(null);
    this.aviso.set('');
    this.persona.set(null);
    this.panel.set({ tipo: 'ninguno' });
  }

  private resolverNombres(consultorioId: number, clase: Clase): void {
    const ofertaId = clase.ofertaId;
    if (ofertaId === undefined || this.nombreDeOferta() !== '') {
      return;
    }
    this.api
      .ofertasGrupales(consultorioId)
      .pipe(catchError(() => of([])))
      .subscribe((ofertas) =>
        this.nombreDeOferta.set(ofertas.find((o) => o.id === ofertaId)?.nombreComercial ?? ''),
      );
    if (clase.profesionalId === undefined) {
      return;
    }
    this.api
      .habilitaciones(consultorioId, ofertaId)
      .pipe(catchError(() => of(null)))
      .subscribe((respuesta) =>
        this.nombreDeProfesional.set(
          respuesta?.profesionales?.find((p) => p.membershipId === clase.profesionalId)?.nombre ??
            '',
        ),
      );
  }
}

function mensajeDeInscripcion(nombre: string, inscripcion: Inscripcion | undefined): string {
  const quien = nombre || 'La persona';
  if (inscripcion?.estado === 'LISTA_ESPERA') {
    return (
      `${quien} quedo en la lista de espera, posicion ${inscripcion.posicionEspera ?? '?'}. Entra ` +
      'sola si alguien se da de baja.'
    );
  }
  return `${quien} quedo inscripta con lugar.`;
}
