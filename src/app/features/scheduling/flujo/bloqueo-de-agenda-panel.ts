import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';

import {
  CreateExcepcionRequest,
  CreateExcepcionRequestMotivoEnum,
  CreateExcepcionRequestTipoEnum,
} from '../../../api/generated/model/create-excepcion-request';
import { ImpactoDisponibilidadResponse } from '../../../api/generated/model/impacto-disponibilidad-response';
import { RecursoLibre } from '../../../api/generated/model/recurso-libre';
import { ContextoDeTurno } from '../../../core/models/contexto-de-turno';
import { AvisosStore } from '../../../core/services/avisos.store';
import { DiaDeLaSede } from '../../../core/services/dia-de-la-sede';
import { FlujoDeTurnosStore } from '../../../core/services/flujo-de-turnos.store';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { Alerta } from '../../../shared/components/alerta/alerta';
import { PanelLateral } from '../../../shared/components/panel-lateral/panel-lateral';
import { ErrorAgenda, traducirErrorAgenda } from '../models/agenda-errors';
import { fechaEnPalabras, horaEnZona, hoyEnZona, sumarDias } from '../models/etiquetas-de-agenda';
import { MOTIVOS_DE_BLOQUEO, fechaHoraEnZona } from '../models/etiquetas-de-turno';
import { diaEnZona } from '../models/semana';
import { SchedulingApi } from '../services/scheduling-api';

/** Valor del selector que cierra la sede entera: en el contrato es omitir `membershipId`. */
const TODA_LA_SEDE = 'SEDE';

const MENSAJE_SIN_PERMISO =
  'No tenés permiso para bloquear la agenda de esta sede: hace falta poder administrar la sede. ' +
  'Pedíselo a quien administra el centro.';

/**
 * Bloquear la agenda sin dejar turnos en conflicto en silencio (TURNO.md §22, TURNO - Tecnico §34 y
 * §35).
 *
 * <p>Es un <b>cierre de disponibilidad</b>: la misma excepcion que se carga desde Horarios, vista desde
 * los turnos. No hay una entidad aparte, y el servidor es el que decide: exige `consultorio:manage`
 * (aca solo se traduce el 403) y sin confirmar rechaza con 409 el cierre que deja turnos afuera.
 *
 * <h2>"Toda la sede" es una decision, no un default</h2>
 *
 * <p>Omitir el profesional cierra la sede para todos. Si fuera la primera opcion del selector, un
 * descuido se llevaria la agenda entera: por eso hay que elegirlo.
 *
 * <h2>Primero se revisa</h2>
 *
 * <p>"Revisar" consulta el impacto sin guardar. Sin turnos afectados guarda directo; con turnos muestra
 * cuales y se elige que hacer. El 409 sigue existiendo porque entre la consulta y el alta puede entrar
 * un turno: en ese caso se vuelve a mostrar la misma pantalla, con la lista al dia.
 *
 * <p><b>Crear el bloqueo igualmente no cancela nada</b>: los turnos siguen reservados, fuera de la
 * disponibilidad, hasta que alguien los mueva.
 */
@Component({
  selector: 'app-bloqueo-de-agenda-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alerta, PanelLateral],
  templateUrl: './bloqueo-de-agenda-panel.html',
  styleUrl: './flujo.css',
})
export class BloqueoDeAgendaPanel implements OnInit {
  private readonly api = inject(SchedulingApi);
  private readonly tenant = inject(TenantContextStore);
  private readonly dia = inject(DiaDeLaSede);
  private readonly avisos = inject(AvisosStore);
  private readonly flujo = inject(FlujoDeTurnosStore);
  private readonly router = inject(Router);
  private readonly elemento = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly contexto = input.required<ContextoDeTurno>();
  readonly cerrar = output<void>();

  protected readonly TODA_LA_SEDE = TODA_LA_SEDE;
  protected readonly MOTIVOS = MOTIVOS_DE_BLOQUEO;

  protected readonly profesionales = signal<readonly RecursoLibre[]>([]);
  protected readonly errorDeProfesionales = signal('');
  /** Vacio mientras no se eligio; {@link TODA_LA_SEDE}, o el id del profesional. */
  protected readonly alcance = signal('');
  protected readonly desde = signal('');
  /** Inclusiva en pantalla: al enviar se le suma un dia, porque el contrato la quiere exclusiva. */
  protected readonly hasta = signal('');
  protected readonly horaDesde = signal('');
  protected readonly horaHasta = signal('');
  protected readonly motivo = signal('');
  protected readonly notas = signal('');

  protected readonly revisando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly rechazo = signal<ErrorAgenda | null>(null);

  /** Con esto se muestra la pantalla de turnos afectados en lugar del formulario. */
  protected readonly impacto = signal<ImpactoDisponibilidadResponse | null>(null);
  /** Lo que se reviso: es lo que se guarda, aunque el formulario ya no este a la vista. */
  private cierreRevisado: CreateExcepcionRequest | null = null;

  protected readonly ocupado = computed(() => this.revisando() || this.guardando());

  /** Lo que falta para poder revisar. El boton lo dice en vez de quedar mudo. */
  protected readonly faltante = computed(() => {
    if (this.alcance() === '') {
      return 'Falta elegir a quién afecta.';
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
      return 'El horario lleva hora desde y hora hasta, o ninguna de las dos para el día completo.';
    }
    if (horaDesde !== '' && horaHasta <= horaDesde) {
      return 'La hora hasta tiene que ser posterior a la hora desde.';
    }
    if (this.motivo() === '') {
      return 'Falta elegir el tipo.';
    }
    return '';
  });

  protected readonly tituloDelImpacto = computed(() => {
    const cantidad = this.impacto()?.turnosAfectados ?? 0;
    return cantidad === 1
      ? 'Este bloqueo afecta 1 turno.'
      : `Este bloqueo afecta ${cantidad} turnos.`;
  });

  protected readonly rotuloDelAlcance = computed(() => {
    const alcance = this.alcance();
    return alcance === TODA_LA_SEDE ? 'Toda la sede' : this.nombreDe(Number(alcance));
  });

  protected readonly rotuloDelPeriodo = computed(() =>
    this.desde() === this.hasta()
      ? fechaEnPalabras(this.desde())
      : `Del ${fechaEnPalabras(this.desde())} al ${fechaEnPalabras(this.hasta())}`,
  );

  protected readonly rotuloDelHorario = computed(() =>
    this.horaDesde() === '' ? 'Día completo' : `${this.horaDesde()} a ${this.horaHasta()}`,
  );

  protected readonly rotuloDelMotivo = computed(
    () => this.MOTIVOS.find((opcion) => opcion.valor === this.motivo())?.etiqueta ?? '',
  );

  /** La cuenta llega completa, la lista recortada a 50. Se dice para no leerla como el total. */
  protected readonly listaRecortada = computed(() => {
    const impacto = this.impacto();
    return (impacto?.turnos?.length ?? 0) < (impacto?.turnosAfectados ?? 0);
  });

  /** El backend mira a lo sumo noventa dias. Un bloqueo mas largo puede afectar turnos posteriores. */
  protected readonly revisadoHasta = computed(() => {
    const evaluado = this.impacto()?.evaluadoHasta;
    return evaluado && evaluado < sumarDias(this.hasta(), 1)
      ? fechaEnPalabras(sumarDias(evaluado, -1))
      : '';
  });

  ngOnInit(): void {
    const contexto = this.contexto();
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null) {
      return;
    }
    const fecha = contexto.fecha ?? hoyEnZona(this.dia.zona());
    this.desde.set(fecha);
    this.hasta.set(fecha);
    this.alcance.set(contexto.profesionalId === undefined ? '' : String(contexto.profesionalId));
    this.cargarProfesionales();
  }

  protected cargarProfesionales(): void {
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null) {
      return;
    }
    this.errorDeProfesionales.set('');
    this.api.profesionales(consultorioId).subscribe({
      next: (lista) => {
        this.profesionales.set(lista);
        // Un profesional que ya no esta en la sede no se puede dejar elegido sin que se vea.
        const alcance = this.alcance();
        if (
          alcance !== '' &&
          alcance !== TODA_LA_SEDE &&
          !lista.some((profesional) => String(profesional.id) === alcance)
        ) {
          this.alcance.set('');
        }
      },
      error: (error: unknown) => {
        this.profesionales.set([]);
        this.errorDeProfesionales.set(this.traducir(error).mensaje);
        // El selector no puede mostrarlo: mandar un id que no se ve seria un bloqueo a ciegas.
        if (this.alcance() !== TODA_LA_SEDE) {
          this.alcance.set('');
        }
      },
    });
  }

  protected cambiarDesde(valor: string): void {
    this.desde.set(valor);
    if (valor !== '' && this.hasta() < valor) {
      this.hasta.set(valor);
    }
  }

  /** La consulta sin efectos. Sin turnos afectados no hay nada que preguntar: se guarda. */
  protected revisar(): void {
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null || this.faltante() !== '' || this.ocupado()) {
      return;
    }
    const cierre = this.armarCierre();
    this.revisando.set(true);
    this.rechazo.set(null);
    this.api.simularImpactoDeBloqueo(consultorioId, cierre).subscribe({
      next: (impacto) => {
        this.revisando.set(false);
        if ((impacto.turnosAfectados ?? 0) === 0) {
          this.crear(consultorioId, cierre);
        } else {
          this.mostrarImpacto(cierre, impacto);
        }
      },
      error: (error: unknown) => {
        this.revisando.set(false);
        this.rechazo.set(this.traducir(error));
      },
    });
  }

  protected crearIgualmente(): void {
    const consultorioId = this.tenant.consultorioId();
    const cierre = this.cierreRevisado;
    if (consultorioId === null || cierre === null || this.ocupado()) {
      return;
    }
    this.rechazo.set(null);
    this.crear(consultorioId, { ...cierre, confirmaTurnosAfectados: true });
  }

  private crear(consultorioId: number, cierre: CreateExcepcionRequest): void {
    this.guardando.set(true);
    this.api.crearBloqueo(consultorioId, cierre).subscribe({
      next: () => {
        this.guardando.set(false);
        this.avisos.exito('Agenda bloqueada.');
        this.flujo.notificarCambio();
        this.cerrar.emit();
      },
      error: (error: unknown) => {
        this.guardando.set(false);
        const fallo = this.traducir(error);
        if (fallo.causa === 'bloqueo-con-turnos-afectados') {
          this.releerImpacto(consultorioId, cierre, fallo.turnosAfectados);
        } else {
          this.rechazo.set(fallo);
        }
      },
    });
  }

  /**
   * Entro un turno entre la consulta y el alta. El 409 trae cuantos y no cuales: se vuelven a pedir, y
   * si eso falla se muestra la cuenta sola antes que guardar sin avisar.
   */
  private releerImpacto(
    consultorioId: number,
    cierre: CreateExcepcionRequest,
    afectados: number,
  ): void {
    const soloLaCuenta: ImpactoDisponibilidadResponse = { turnosAfectados: afectados, turnos: [] };
    this.revisando.set(true);
    this.api.simularImpactoDeBloqueo(consultorioId, cierre).subscribe({
      next: (impacto) => {
        this.revisando.set(false);
        this.mostrarImpacto(cierre, (impacto.turnosAfectados ?? 0) > 0 ? impacto : soloLaCuenta);
      },
      error: () => {
        this.revisando.set(false);
        this.mostrarImpacto(cierre, soloLaCuenta);
      },
    });
  }

  private mostrarImpacto(
    cierre: CreateExcepcionRequest,
    impacto: ImpactoDisponibilidadResponse,
  ): void {
    this.cierreRevisado = cierre;
    this.impacto.set(impacto);
    this.enfocar('#bloqueo-impacto');
  }

  /** "Cancelar": no se guardo nada y lo cargado sigue ahi, para corregirlo o cerrar el panel. */
  protected volverAlFormulario(): void {
    this.impacto.set(null);
    this.cierreRevisado = null;
    this.rechazo.set(null);
    this.enfocar('#bloqueo-profesional');
  }

  /** A la agenda, en el dia del primer turno afectado: es donde hay algo que mover. */
  protected reprogramarTurnos(): void {
    const primero = this.impacto()?.primerTurnoAfectado ?? undefined;
    const fecha = diaEnZona(primero, this.dia.zona()) || this.desde();
    const alcance = this.alcance();
    this.router
      .navigate(['/agenda'], {
        queryParams: { fecha, profesional: alcance === TODA_LA_SEDE ? undefined : alcance },
      })
      .catch(() => undefined);
    this.cerrar.emit();
  }

  protected verTurno(turnoId: number): void {
    this.flujo.verTurno(turnoId);
  }

  protected rotuloDelTurno(inicio: string | undefined, fin: string | undefined): string {
    const zona = this.dia.zona();
    return `${fechaHoraEnZona(inicio, zona)} a ${horaEnZona(fin, zona)}`;
  }

  /** Con la sede entera los turnos son de varios profesionales: sin el nombre no se distinguen. */
  protected profesionalDelTurno(membershipId: number | undefined): string {
    return this.alcance() === TODA_LA_SEDE && membershipId !== undefined
      ? this.nombreDe(membershipId)
      : '';
  }

  private nombreDe(id: number): string {
    return this.profesionales().find((profesional) => profesional.id === id)?.nombre ?? `#${id}`;
  }

  private armarCierre(): CreateExcepcionRequest {
    const alcance = this.alcance();
    const notas = this.notas().trim();
    return {
      tipo: CreateExcepcionRequestTipoEnum.CIERRE,
      motivo: this.motivo() as CreateExcepcionRequestMotivoEnum,
      fechaDesde: this.desde(),
      fechaHasta: sumarDias(this.hasta(), 1),
      // Omitirlo es sede entera, y es una decision: por eso no se manda vacio ni cero.
      membershipId: alcance === TODA_LA_SEDE ? undefined : Number(alcance),
      horaDesde: this.horaDesde() === '' ? undefined : this.horaDesde(),
      horaHasta: this.horaHasta() === '' ? undefined : this.horaHasta(),
      notes: notas === '' ? undefined : notas,
    };
  }

  /** El texto generico habla de consultar turnos; aca lo que falta es administrar la sede. */
  private traducir(error: unknown): ErrorAgenda {
    const fallo = traducirErrorAgenda(error);
    return fallo.causa === 'sin-permiso' ? { ...fallo, mensaje: MENSAJE_SIN_PERMISO } : fallo;
  }

  /** Cambiar de pantalla dentro del panel se lleva el control enfocado: el foco no puede perderse. */
  private enfocar(selector: string): void {
    afterNextRender(
      () => this.elemento.nativeElement.querySelector<HTMLElement>(selector)?.focus(),
      { injector: this.injector },
    );
  }
}
