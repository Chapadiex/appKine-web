import { Location } from '@angular/common';
import {
  Component,
  DOCUMENT,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';

import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import {
  PERMISO_CLASE_READ,
  PERMISO_COBRO_REGISTER,
  PERMISO_SESION_REGISTER,
  PERMISO_TURNO_MANAGE,
} from '../../../../core/models/permisos';
import { ClasesDelDia } from '../../components/clases-del-dia/clases-del-dia';
import { Pestanas } from '../../../../shared/components/pestanas/pestanas';
import { ETIQUETA_PESTANAS_DE_AGENDA, pestanasDeAgenda } from '../../models/pestanas-de-agenda';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { PrepagoDeRecepcionEstadoEnum } from '../../../../api/generated/model/prepago-de-recepcion';
import { Recepcion, RecepcionEstadoEnum } from '../../../../api/generated/model/recepcion';
import { TurnoDelDia, TurnoDelDiaEstadoEnum } from '../../../../api/generated/model/turno-del-dia';
import { SchedulingApi } from '../../services/scheduling-api';
import { CausaAgenda, ErrorAgenda, traducirErrorRecepcion } from '../../models/agenda-errors';
import {
  fechaEnPalabras,
  horaEnZona,
  hoyEnZona,
  sumarDias,
} from '../../models/etiquetas-de-agenda';
import { detalleDeEstado, nombreDeEstado } from '../../models/etiquetas-de-turno';
import {
  admiteParticular,
  admiteRetiro,
  detalleDeEstadoDeRecepcion,
  llegadaVigente,
  nombreDeEstadoDeRecepcion,
  recepcionAbierta,
  recepcionRetirada,
  textoDeModalidad,
  textoDePrepago,
} from '../../models/etiquetas-de-recepcion';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import { PieDeTabla } from '../../../../shared/components/tabla/pie-de-tabla';
import { tablaLocal } from '../../../../shared/components/tabla/tabla-local';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { AccionesDeFila } from '../../../../shared/components/acciones-de-fila/acciones-de-fila';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import {
  FiltroRapido,
  FiltrosRapidos,
} from '../../../../shared/components/filtros-rapidos/filtros-rapidos';
import { Icono } from '../../../../shared/components/icono/icono';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../core/services/avisos.store';

/** La ruta que monta esta pantalla. Se reescribe la fecha sobre ella sin navegar. */
const RUTA = '/agenda/recepcion';

/** Cada cuanto se relee sola la lista mientras la pestaña esta a la vista. */
const RELECTURA_MS = 60_000;

/** Los grupos del filtro rapido: el estado de la recepcion, agrupado como lo mira el mostrador. */
const GRUPOS_DE_RECEPCION: readonly { readonly valor: string; readonly etiqueta: string }[] = [
  { valor: 'sin-llegar', etiqueta: 'Sin llegar' },
  { valor: 'en-mostrador', etiqueta: 'En mostrador' },
  { valor: 'en-espera', etiqueta: 'En espera' },
  { valor: 'llamados', etiqueta: 'Llamados' },
  { valor: 'cerrados', etiqueta: 'Retirados o cerrados' },
];

/** Una accion de la fila que es un boton (las dos que son enlaces se dibujan aparte). */
interface AccionDeFila {
  readonly clave: string;
  readonly texto: string;
  readonly secundaria: boolean;
  readonly peligro: boolean;
  readonly ejecutar: () => void;
}

/** Las dos transiciones que piden un motivo antes de mandarse. */
type TipoDePanel = 'particular' | 'anular' | 'retiro';

/**
 * Como se anuncia una transicion que salio bien (UX-12): aviso global con un titulo concreto y,
 * si suma, la consecuencia en la descripcion. Una validacion observada no es un error, pero
 * tampoco un exito liso: se anuncia como advertencia.
 */
interface ResultadoDeTransicion {
  readonly tipo?: 'exito' | 'advertencia';
  readonly titulo: string;
  readonly descripcion: string;
}

/** Errores tras los que la fila que se ve quedo vieja y conviene releerla sola. */
const CAUSAS_QUE_RELEEN: ReadonlySet<CausaAgenda> = new Set<CausaAgenda>([
  'turno-transicion-no-permitida',
  'recepcion-transicion-no-permitida',
  'conflicto',
  'no-encontrado',
]);

/**
 * Recepcion del dia: quien viene hoy, quien llego y en que punto del mostrador esta (M13,
 * AKINE-05.04 y E-4, RF-M13-001 a 005).
 *
 * <h2>1. Esta pantalla es del MOSTRADOR, no de la atencion</h2>
 *
 * <p>DP-05 separa Turno, Recepcion y Sesion, y desde DP-16 (contrato 0.63.0) <b>la Recepcion tiene
 * maquina propia</b>: `LLEGO → VALIDADA | OBSERVADA → EN_ESPERA → LLAMADA`, con `ANULADA` para un
 * check-in por error y `CERRADA` cuando el turno se cancela con la persona presente. El turno
 * vuelve a ser solo la reserva y <b>esta pantalla ya no mira `EN_ESPERA` en el turno</b>: el
 * servidor dejo de emitirlo, y todo lo que dice la columna "Recepcion" sale de
 * `TurnoDelDia.recepcion`.
 *
 * <p>Ningun estado de recepcion prueba que la atencion ocurrio. `LLAMADA` no es "atendido": la
 * prestacion la registra la Sesion, que es otra pantalla. Y no se muestra ningun dato clinico:
 * `TurnoDelDia` es PHI minima a proposito.
 *
 * <h2>2. Los cancelados se muestran, y esa es media pantalla</h2>
 *
 * <p>El backend los devuelve <b>a proposito</b>, con su `motivoCancelacion`: el caso que esta
 * pantalla existe para resolver es el paciente que se presenta a un turno cancelado. Se muestran
 * distinguidos y <b>sin acciones</b>.
 *
 * <h2>3. Registrar y anular NO son simetricos</h2>
 *
 * <ul>
 *   <li><b>Registrar la llegada es idempotente.</b> El doble click del mostrador es el caso normal
 *       y el servidor devuelve la misma recepcion sin mover la hora.</li>
 *   <li><b>Anular no lo es</b>, ni llamar, ni pasar a espera: llevan la `version` de la
 *       recepcion, y si otro puesto la movio el servidor rechaza con 409. Ese 409 se explica (ver
 *       `traducirErrorRecepcion`) y la fila se relee sola.</li>
 * </ul>
 *
 * <h2>4. Validar no es un error aunque observe</h2>
 *
 * <p>El servidor decide si la recepcion queda `VALIDADA` u `OBSERVADA` (RF-M13-003/004). Una
 * observacion responde 200 y <b>no bloquea</b> (RN-M13-003): la pantalla la muestra en la fila y
 * sigue ofreciendo pasar a espera y continuar como Particular, que pide motivo obligatorio
 * (RF-M13-005).
 *
 * <h2>5. Por que un 409 recarga UNA fila y no el dia entero</h2>
 *
 * <p>Releer el dia completo le mueve la lista bajo el dedo a quien esta atendiendo a alguien, asi
 * que la pantalla usa `verTurno` para corregir esa fila sola. Lo mismo despues de registrar una
 * llegada: el check-in avanza la `version` del <b>turno</b> aunque no cambie su estado, y el
 * enlace al ciclo del turno la necesita vigente.
 *
 * <h2>6. La zona horaria viene en la respuesta, y hay que usar esa</h2>
 *
 * <p>Los instantes vienen en UTC y las horas del mostrador son locales de la sede. Si la zona
 * llegara vacia, la pantalla <b>rotula UTC</b> en vez de mentir con la del navegador.
 *
 * <p><b>Y "hoy" tambien es el de la sede.</b> Sin `?fecha=` la pantalla abre con el dia del
 * navegador, que es lo unico que sabe antes de la primera respuesta, y en cuanto la respuesta trae
 * el `timezone` lo corrige al dia de la sede y vuelve a pedir. Entre las 21:00 y las 24:00 de
 * Cordoba un navegador en UTC —o en cualquier zona adelantada— ya esta en el dia siguiente y abria
 * una recepcion vacia. Lo destapo el E2E del CI, que corre en UTC. La correccion es una sola vez:
 * un dia elegido a mano, o el de la URL, no se toca.
 *
 * <h2>7. El prepago avisa, no bloquea, y se ve antes de la llegada (E-6 y E-8, DP-06 / ADR-0013)</h2>
 *
 * <p>Desde el contrato 0.68.0 el servidor calcula `TurnoDelDia.prepago` para <b>todas</b> las filas,
 * haya recepcion o no, y con recepcion vigente es el mismo que `recepcion.prepago`. Por eso esta
 * pantalla lee una sola fuente, la del turno, y no la de la recepcion.
 *
 * <p>`PENDIENTE` se muestra como alerta con el precio sugerido y ofrece "Registrar prepago", que
 * lleva al registro de cobro de `billing` en modo anticipo atado al turno. Antes del check-in vale
 * "si se atiende como particular": la cobertura se resuelve al validar. Un `REGISTRADO` en un turno
 * cancelado se muestra igual, porque es un anticipo que hay que reintegrar. Ninguna transicion de
 * esta pantalla mira el prepago: pasar a espera con el prepago pendiente se permite y el servidor
 * deja constancia.
 *
 * <p>Las transiciones devuelven la recepcion y no el turno, asi que el prepago de la fila se toma de
 * `recepcion.prepago` al fusionar; si la recepcion deja de ser vigente (anulada), la fila se relee
 * para que el servidor recalcule el del turno.
 */
@Component({
  selector: 'app-recepcion-del-dia-page',
  imports: [
    Alerta,
    PieDeTabla,
    Filtros,
    EstadoVacio,
    ColumnaOrdenable,
    Ayuda,
    CabeceraDePagina,
    RouterLink,
    ConfirmacionConMotivo,
    ClasesDelDia,
    Pestanas,
    Icono,
    AccionesDeFila,
    FiltrosRapidos,
    PanelLateral,
  ],
  templateUrl: './recepcion-del-dia-page.html',
  styleUrl: '../../agenda.css',
})
export class RecepcionDelDiaPage {
  private readonly api = inject(SchedulingApi);
  private readonly avisos = inject(AvisosStore);
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);

  /** La ruta ya exigio `turno:read`: las tres pestanas de la agenda estan disponibles. */
  protected readonly pestanas = pestanasDeAgenda(true);
  protected readonly etiquetaDePestanas = ETIQUETA_PESTANAS_DE_AGENDA;
  private readonly location = inject(Location);

  /**
   * De la query. Sin ella, hoy: la recepcion abre el dia que esta atendiendo.
   *
   * <p>El `transform` no es decorativo: con `withComponentInputBinding`, un query param AUSENTE
   * llega como `undefined` y no como el default. Sin normalizarlo, entrar desde el enlace de la
   * agenda —que no lleva `?fecha=`— dejaba la pantalla en blanco. Lo destapo el E2E contra el
   * backend real (AKINE E-2).
   */
  readonly fecha = input('', { transform: (valor: string | undefined) => valor ?? '' });

  protected readonly fechaEnPalabras = fechaEnPalabras;
  protected readonly nombreDeEstado = nombreDeEstado;
  protected readonly detalleDeEstado = detalleDeEstado;
  protected readonly nombreDeEstadoDeRecepcion = nombreDeEstadoDeRecepcion;
  protected readonly detalleDeEstadoDeRecepcion = detalleDeEstadoDeRecepcion;
  protected readonly textoDeModalidad = textoDeModalidad;

  /** Dia que se muestra. Vive en un signal aparte del input: el selector lo mueve sin navegar. */
  protected readonly dia = signal(this.diaDeLaSede.hoy());

  /**
   * `true` mientras {@link dia} es el provisorio del navegador y todavia no se lo comparo con el
   * de la sede. Ver el punto 6 del encabezado.
   */
  private diaPorDefecto = false;

  protected readonly turnos = signal<readonly TurnoDelDia[]>([]);

  /**
   * Busqueda del canvas sobre la lista ya leida: paciente o documento. Filtra en pantalla, no
   * vuelve a pedir nada; los contadores del dia siguen contando la lista entera.
   */
  protected readonly busqueda = signal('');

  /**
   * Filtro rapido por estado de la recepcion (decidido el 22/10/2026). La lista del dia llega
   * entera, asi que los conteos se calculan aca; se combina con la busqueda por paciente.
   */
  protected readonly filtroDeRecepcion = signal<string>('todos');

  protected readonly opcionesDeRecepcion = computed<readonly FiltroRapido[]>(() => {
    const todos = this.turnos();
    const cuenta = (grupo: string) => todos.filter((t) => grupoDeRecepcion(t) === grupo).length;
    return [
      { valor: 'todos', etiqueta: 'Todos', cantidad: todos.length },
      ...GRUPOS_DE_RECEPCION.map((g) => ({
        valor: g.valor,
        etiqueta: g.etiqueta,
        cantidad: cuenta(g.valor),
      })),
    ];
  });

  /**
   * Filtro avanzado por prestacion (UX-14): las del dia que ya se leyo, sin pedir nada. La elegida
   * se conserva al cambiar de dia, y sigue en la lista aunque ese dia no la tenga.
   */
  protected readonly prestacion = signal('');

  protected readonly prestaciones = computed(() => {
    const nombres = new Set(
      this.turnos()
        .map((t) => t.ofertaNombre ?? '')
        .filter((n) => n !== ''),
    );
    if (this.prestacion() !== '') {
      nombres.add(this.prestacion());
    }
    return [...nombres].sort((a, b) => a.localeCompare(b, 'es'));
  });

  /** Filtros avanzados fuera de su valor por defecto: el contador del boton "Filtros". */
  protected readonly filtrosAvanzadosActivos = computed(() => Number(this.prestacion() !== ''));

  protected readonly filtrados = computed(() => {
    const texto = this.busqueda().trim().toLocaleLowerCase('es');
    const grupo = this.filtroDeRecepcion();
    const prestacion = this.prestacion();
    return this.turnos().filter(
      (t) =>
        (grupo === 'todos' || grupoDeRecepcion(t) === grupo) &&
        (prestacion === '' || t.ofertaNombre === prestacion) &&
        (texto === '' ||
          `${t.personaNombre ?? ''} ${t.documento ?? ''}`.toLocaleLowerCase('es').includes(texto)),
    );
  });

  /**
   * Orden y paginado de la lista completa (UX-14 §1): el servidor no la pagina. Arranca en 25 filas
   * y no en las 10 de toda tabla de AKINE (Impeccable, 29/10/2026): con las filas compactas, un dia
   * normal entra en una pagina y nadie en espera queda escondido en la segunda. Para el dia entero
   * de un centro grande, 50 o 100 desde el pie.
   */
  protected readonly tabla = tablaLocal(this.filtrados, {
    porPagina: 25,
    columnas: {
      hora: (turno) => (turno.inicio ? new Date(turno.inicio) : null),
      paciente: (turno) => turno.personaNombre ?? null,
      estado: (turno) => turno.estado ?? null,
    },
  });
  protected readonly cargando = signal(false);
  /** Hora de la sede de la ultima lectura buena ("10:42"), o vacia antes de la primera. */
  protected readonly actualizadaA = signal('');
  /**
   * Numero de la ultima lectura o escritura sobre la lista. Una relectura en silencio que vuelve
   * con un numero viejo se descarta: la mesa siguio operando mientras viajaba, y su foto pisaria
   * la fila que una transicion ya dejo al dia (y con ella su `expectedVersion`).
   */
  private lectura = 0;
  /** Error al LEER el dia: va en el lugar de la lista, con su salida (UX-12). */
  protected readonly errorDeCarga = signal<ErrorAgenda | null>(null);

  /**
   * Error de la transicion mandada desde el panel de motivo: queda arriba del panel, que sigue
   * abierto. Un aviso global quedaria inerte detras del panel modal (UX-12 §5).
   */
  protected readonly errorDelPanel = signal<{
    readonly titulo: string;
    readonly error: ErrorAgenda;
  } | null>(null);

  /** Id del turno con un pedido en vuelo, o `null`. Es por fila: el resto sigue operable. */
  protected readonly enVuelo = signal<number | null>(null);

  /** Panel de motivo abierto (Particular o anulacion), o `null`. Uno a la vez. */
  protected readonly panel = signal<{
    readonly turno: TurnoDelDia;
    readonly tipo: TipoDePanel;
  } | null>(null);

  /** Zona de la sede. Vacia cuando no se pudo averiguar; ver el punto 6 del encabezado. */
  protected readonly timezone = signal('');
  protected readonly zonaConocida = computed(() => this.timezone() !== '');

  protected readonly puedeOperar = computed(() => this.permisos.tiene(PERMISO_TURNO_MANAGE));
  protected readonly puedeCobrar = computed(() => this.permisos.tiene(PERMISO_COBRO_REGISTER));
  protected readonly puedeVerClases = computed(() => this.permisos.tiene(PERMISO_CLASE_READ));
  protected readonly puedeAtender = computed(() => this.permisos.tiene(PERMISO_SESION_REGISTER));
  protected readonly consultorioId = computed(() => this.tenantContext.consultorioId());
  protected readonly hayTurnos = computed(() => this.turnos().length > 0);

  /** Cuantos estan en la sala de espera. Es el numero que el mostrador mira sin leer la tabla. */
  protected readonly enEspera = computed(
    () => this.turnos().filter((t) => t.recepcion?.estado === RecepcionEstadoEnum.EN_ESPERA).length,
  );

  constructor() {
    effect(() => {
      // Cambiar de sede convierte esta lista en la de otra sede: se vacia antes de pedir la nueva,
      // porque dejarla en pantalla mostraria pacientes de otro tenant mientras carga.
      const deLaUrl = this.fecha();
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.dia.set(deLaUrl === '' ? this.diaDeLaSede.hoy() : deLaUrl);
        this.diaPorDefecto = deLaUrl === '';
        this.reiniciar();
        this.cargar();
      });
    });
    this.releerSolaMientrasSeVe();
  }

  /**
   * La recepcion es un tablero de varios puestos: otro llama al paciente y este mostrador seguiria
   * viendo "En espera". Se relee sola al volver a la pestaña y cada {@link RELECTURA_MS} mientras
   * se ve, sin vaciar la tabla ni mover los filtros. No relee con un panel abierto, un pedido en
   * vuelo o un error a la vista: pisaria lo que la persona esta haciendo o leyendo.
   */
  private releerSolaMientrasSeVe(): void {
    const documento = inject(DOCUMENT);
    const alVolver = () => {
      if (documento.visibilityState === 'visible') {
        this.cargar(true);
      }
    };
    documento.addEventListener('visibilitychange', alVolver);
    const reloj = setInterval(alVolver, RELECTURA_MS);
    inject(DestroyRef).onDestroy(() => {
      documento.removeEventListener('visibilitychange', alVolver);
      clearInterval(reloj);
    });
  }

  // -------------------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------------------

  protected cambiarDia(fecha: string): void {
    if (fecha === '') {
      return;
    }
    this.dia.set(fecha);
    this.diaPorDefecto = false;
    // `replaceState` y no una navegacion: navegar volveria a disparar el efecto que reinicia
    // todo. Lo que se gana es que un refresh —o un enlace copiado— siga abriendo el mismo dia.
    this.location.replaceState(RUTA, `fecha=${fecha}`);
    this.reiniciar();
    this.cargar();
  }

  /** ‹ y › del selector compacto del titulo: el dia anterior o el siguiente. */
  protected moverDia(sentido: -1 | 1): void {
    this.cambiarDia(sumarDias(this.dia(), sentido));
  }

  /** "Hoy" es el de la sede cuando ya se conoce su zona; si no, el provisorio del navegador. */
  protected irAHoy(): void {
    const zona = this.timezone();
    this.cambiarDia(zona === '' ? this.diaDeLaSede.hoy() : hoyEnZona(zona));
  }

  /** "Limpiar filtros" del estado vacio filtrado: la busqueda, el estado y la prestacion. */
  protected limpiarFiltros(): void {
    this.busqueda.set('');
    this.filtroDeRecepcion.set('todos');
    this.prestacion.set('');
  }

  /**
   * Relee el dia. Es tambien la accion de `recargar-dia`.
   *
   * <p>`enSilencio` es la relectura automatica: no reemplaza la tabla por el cartel de carga y, si
   * falla, deja la lista que habia en vez de un error que nadie pidio.
   */
  protected cargar(enSilencio = false): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      return;
    }
    if (
      enSilencio &&
      (this.cargando() ||
        this.panel() !== null ||
        this.enVuelo() !== null ||
        this.errorDeCarga() !== null)
    ) {
      return;
    }

    if (!enSilencio) {
      this.cargando.set(true);
      this.errorDeCarga.set(null);
    }
    const esta = ++this.lectura;
    this.api.turnosDelDia(consultorioId, this.dia()).subscribe({
      next: (agenda) => {
        if (enSilencio && esta !== this.lectura) {
          return;
        }
        if (this.corregirAlDiaDeLaSede(agenda.timezone ?? '')) {
          return;
        }
        this.turnos.set(agenda.turnos ?? []);
        this.timezone.set(agenda.timezone ?? '');
        this.actualizadaA.set(horaEnZona(new Date().toISOString(), agenda.timezone ?? ''));
        this.cargando.set(false);
      },
      error: (error: unknown) => {
        if (enSilencio) {
          return;
        }
        this.cargando.set(false);
        this.errorDeCarga.set(traducirErrorRecepcion(error));
      },
    });
  }

  /** "Volver a leer el día" desde un error: cierra el panel, que quedo sobre una fila vieja. */
  protected releerDia(): void {
    this.cerrarPanel();
    this.errorDeCarga.set(null);
    this.cargar();
  }

  /**
   * Si el dia mostrado es el provisorio del navegador y no coincide con hoy en la sede, lo cambia y
   * vuelve a pedir. Devuelve `true` cuando la respuesta en mano es de otro dia y hay que tirarla.
   */
  private corregirAlDiaDeLaSede(timezone: string): boolean {
    if (!this.diaPorDefecto || timezone === '') {
      return false;
    }
    this.diaPorDefecto = false;
    const deLaSede = hoyEnZona(timezone);
    if (deLaSede === this.dia()) {
      return false;
    }
    this.dia.set(deLaSede);
    this.cargar();
    return true;
  }

  // -------------------------------------------------------------------------------------
  // Transiciones de la recepcion
  // -------------------------------------------------------------------------------------

  /** Check-in. Idempotente: ver el punto 3 del encabezado. */
  protected marcarLlegada(turno: TurnoDelDia): void {
    this.transicion(
      turno,
      (c, t) => this.api.registrarLlegada(c, t),
      () => ({
        titulo: 'Llegada registrada',
        descripcion:
          `${nombre(turno)}. Falta validar como se atiende; la atención se registra desde la ` +
          'pantalla clínica.',
      }),
      'No pudimos registrar la llegada',
      () => this.marcarLlegada(turno),
      true,
    );
  }

  /** El servidor decide VALIDADA u OBSERVADA. Una observacion no es un error. */
  protected validar(turno: TurnoDelDia): void {
    this.transicion(
      turno,
      (c, t) => this.api.validarRecepcion(c, t, { expectedVersion: versionDe(turno) }),
      (recepcion) =>
        recepcion.estado === RecepcionEstadoEnum.OBSERVADA
          ? {
              tipo: 'advertencia',
              titulo: 'Validación observada',
              descripcion:
                `La validacion de ${nombre(turno)} quedo observada. No impide pasar a espera; ` +
                'también se puede continuar como Particular.',
            }
          : {
              titulo: 'Recepción validada',
              descripcion: `${nombre(turno)}: ya se sabe como se atiende.`,
            },
      'No pudimos validar la recepción',
      () => this.validar(turno),
    );
  }

  protected pasarAEspera(turno: TurnoDelDia): void {
    this.transicion(
      turno,
      (c, t) => this.api.pasarAEspera(c, t, versionDe(turno)),
      () => ({
        titulo: 'Pasó a la sala de espera',
        descripcion:
          `${nombre(turno)} aguarda ser llamado.` +
          // El prepago pendiente avisa y no bloquea (DP-06): el servidor deja constancia en el
          // evento.
          (this.prepagoPendiente(turno)
            ? ' Paso sin el prepago que exige la prestación; quedo registrado en la recepción.'
            : ''),
      }),
      'No pudimos pasar a espera',
      () => this.pasarAEspera(turno),
    );
  }

  protected llamar(turno: TurnoDelDia): void {
    this.transicion(
      turno,
      (c, t) => this.api.llamar(c, t, versionDe(turno)),
      () => ({
        titulo: 'Paciente llamado',
        descripcion:
          `${nombre(turno)}. Llamar no registra la atención: eso lo hace la Sesión, desde la ` +
          'pantalla clínica.',
      }),
      'No pudimos llamar al paciente',
      () => this.llamar(turno),
    );
  }

  protected abrirPanel(turno: TurnoDelDia, tipo: TipoDePanel): void {
    this.errorDelPanel.set(null);
    this.panel.set({ turno, tipo });
  }

  protected cerrarPanel(): void {
    this.errorDelPanel.set(null);
    this.panel.set(null);
  }

  /**
   * Manda la transicion del panel abierto.
   *
   * <p>El motivo de Particular es obligatorio y el de anulacion no. La validacion la hace
   * `ConfirmacionConMotivo` (`motivoObligatorio`), que ya sabe senalar el campo y mover el foco.
   */
  protected confirmarPanel(motivo: string): void {
    const abierto = this.panel();
    if (abierto === null) {
      return;
    }
    const { turno, tipo } = abierto;

    if (tipo === 'particular') {
      this.transicion(
        turno,
        (c, t) =>
          this.api.atenderComoParticular(c, t, { expectedVersion: versionDe(turno), motivo }),
        () => ({
          titulo: 'Se atiende como Particular',
          descripcion: `${nombre(turno)}. La cobertura de su ficha no cambio.`,
        }),
        'No pudimos pasarlo a Particular',
      );
    } else if (tipo === 'retiro') {
      this.transicion(
        turno,
        (c, t) => this.api.retirarRecepcion(c, t, { expectedVersion: versionDe(turno), motivo }),
        () => ({
          titulo: 'Retiro registrado',
          descripcion:
            `${nombre(turno)} se retiro sin ser atendido. La llegada consta y el turno no ` +
            'cambia; si vuelve, la atención se puede abrir igual desde la pantalla clínica.',
        }),
        'No pudimos registrar el retiro',
      );
    } else {
      this.transicion(
        turno,
        (c, t) => this.api.anularRecepcion(c, t, { expectedVersion: versionDe(turno), motivo }),
        () => ({
          titulo: 'Llegada anulada',
          descripcion:
            `${nombre(turno)}: el check-in fue un error y la llegada no vale. Queda en el ` +
            'historial de la recepción.',
        }),
        'No pudimos anular la llegada',
      );
    }
  }

  // -------------------------------------------------------------------------------------
  // Lecturas de presentacion
  // -------------------------------------------------------------------------------------

  /** `09:00 a 09:45` en la zona de la sede. El fin es exclusivo. */
  protected rango(turno: TurnoDelDia): string {
    const desde = horaEnZona(turno.inicio, this.timezone());
    const hasta = horaEnZona(turno.fin, this.timezone());
    return hasta === '' ? desde : `${desde} a ${hasta}`;
  }

  /** La hora REAL de llegada: la de la recepcion vigente. */
  protected horaDeLlegada(turno: TurnoDelDia): string {
    return horaEnZona(turno.recepcion?.llegadaEn ?? turno.llegadaEn, this.timezone());
  }

  protected cancelado(turno: TurnoDelDia): boolean {
    return turno.estado === TurnoDelDiaEstadoEnum.CANCELADO;
  }

  protected abierta(turno: TurnoDelDia): boolean {
    return recepcionAbierta(turno.recepcion);
  }

  protected esperando(turno: TurnoDelDia): boolean {
    return turno.recepcion?.estado === RecepcionEstadoEnum.EN_ESPERA;
  }

  /**
   * `true` cuando el turno todavia admite un check-in: la reserva esta viva y no hay una
   * recepcion abierta. Se pregunta por los estados que lo admiten y no por los que no: un estado
   * que el contrato sume manana no va a aparecer con un boton que el backend rechaza.
   */
  protected admiteLlegada(turno: TurnoDelDia): boolean {
    const reservaViva =
      turno.estado === TurnoDelDiaEstadoEnum.RESERVADO ||
      turno.estado === TurnoDelDiaEstadoEnum.CONFIRMADO;
    // Una recepcion RETIRADO sigue siendo la vigente (U-21): la llegada vale y otro check-in es 409.
    return reservaViva && !llegadaVigente(turno.recepcion);
  }

  /** Particular desde `LLEGO`, `OBSERVADA` o `EN_ESPERA` (U-21), salvo que ya lo sea. */
  protected admiteParticular(turno: TurnoDelDia): boolean {
    return admiteParticular(turno.recepcion);
  }

  /** "Se retiro sin ser atendido": solo desde `LLEGO` o `EN_ESPERA` (U-21). */
  protected admiteRetiro(turno: TurnoDelDia): boolean {
    return admiteRetiro(turno.recepcion);
  }

  protected retirado(turno: TurnoDelDia): boolean {
    return recepcionRetirada(turno.recepcion);
  }

  protected admiteValidar(turno: TurnoDelDia): boolean {
    return enEstado(turno, RecepcionEstadoEnum.LLEGO, RecepcionEstadoEnum.OBSERVADA);
  }

  protected admiteEspera(turno: TurnoDelDia): boolean {
    return enEstado(turno, RecepcionEstadoEnum.VALIDADA, RecepcionEstadoEnum.OBSERVADA);
  }

  protected admiteLlamar(turno: TurnoDelDia): boolean {
    return enEstado(turno, RecepcionEstadoEnum.EN_ESPERA);
  }

  /**
   * Los botones de la fila, en orden de frecuencia: la transicion siguiente de la recepcion
   * (llegada, validar, espera, llamar) va primero y es la que queda a la vista cuando la fila
   * tiene menu; las secundarias (Particular, retiro, anular) van detras.
   */
  protected accionesDe(turno: TurnoDelDia): readonly AccionDeFila[] {
    if (!this.puedeOperar()) {
      return [];
    }
    const acciones: AccionDeFila[] = [];
    const agregar = (
      clave: string,
      texto: string,
      ejecutar: () => void,
      secundaria = false,
      peligro = false,
    ): void => {
      acciones.push({ clave, texto, secundaria, peligro, ejecutar });
    };
    if (this.admiteLlegada(turno)) {
      agregar('llegada', 'Registrar la llegada', () => this.marcarLlegada(turno));
    }
    if (this.admiteValidar(turno)) {
      agregar('validar', 'Validar cobertura', () => this.validar(turno));
    }
    if (this.admiteEspera(turno)) {
      agregar('espera', 'Pasar a espera', () => this.pasarAEspera(turno));
    }
    if (this.admiteLlamar(turno)) {
      agregar('llamar', 'Llamar', () => this.llamar(turno));
    }
    if (this.admiteParticular(turno)) {
      agregar(
        'particular',
        'Atender como Particular',
        () => this.abrirPanel(turno, 'particular'),
        true,
      );
    }
    if (this.admiteRetiro(turno)) {
      // U-21: la llegada vale y el turno no cambia; el motivo es obligatorio.
      agregar('retiro', 'Se retiro sin ser atendido', () => this.abrirPanel(turno, 'retiro'), true);
    }
    if (this.abierta(turno)) {
      // Anular NO es idempotente: el segundo intento responde 409, que se explica arriba.
      agregar('anular', 'Anular la llegada', () => this.abrirPanel(turno, 'anular'), true, true);
    }
    return acciones;
  }

  /**
   * Elegir una accion del menu "⋯" lo cierra y esconde el item que tenia el foco: el panel de
   * motivo, que al cerrarse devuelve el foco a quien lo abrio, no tendria a donde. Se lleva el foco
   * al boton "⋯" de la fila, que sigue a la vista, antes de que el panel se monte.
   */
  protected enfocarMenu(evento: Event): void {
    const destino = evento.target instanceof Element ? evento.target : null;
    destino
      ?.closest('app-acciones-de-fila')
      ?.querySelector<HTMLElement>('.acciones-de-fila__boton')
      ?.focus();
  }

  /** Titulo del panel lateral de motivo: que se confirma y de quien. */
  protected tituloDelPanel(abierto: {
    readonly turno: TurnoDelDia;
    readonly tipo: TipoDePanel;
  }): string {
    const quien = abierto.turno.personaNombre;
    switch (abierto.tipo) {
      case 'particular':
        return `Atender como Particular a ${quien ?? 'el paciente'}`;
      case 'retiro':
        return `${quien ?? 'El paciente'} se retiro sin ser atendido`;
      default:
        return `Anular la llegada de ${quien ?? 'el paciente'}`;
    }
  }

  /** Query del enlace al ciclo del turno: sin la version, esa pantalla no puede operar. */
  protected queryDelTurno(turno: TurnoDelDia): Record<string, string | number> {
    return { version: turno.version ?? 0, ofertaId: turno.ofertaId ?? 0, fecha: this.dia() };
  }

  /**
   * `true` cuando la fila ofrece "Registrar prepago" (E-6, E-8): la oferta lo exige, no hay anticipo
   * y el turno sigue siendo una reserva viva, que es lo unico que el backend admite. <b>No hace falta
   * que haya llegado</b>: el anticipo se puede cobrar antes del check-in. Si no se cumple el servidor
   * igual responde 409 `prepago-no-admitido`; esto solo evita ofrecer lo que va a fallar.
   */
  protected admitePrepago(turno: TurnoDelDia): boolean {
    const reservaViva =
      turno.estado === TurnoDelDiaEstadoEnum.RESERVADO ||
      turno.estado === TurnoDelDiaEstadoEnum.CONFIRMADO;
    return reservaViva && turno.personaId !== undefined && this.prepagoPendiente(turno);
  }

  protected prepagoPendiente(turno: TurnoDelDia): boolean {
    return turno.prepago?.estado === PrepagoDeRecepcionEstadoEnum.PENDIENTE;
  }

  /**
   * Texto del prepago de la fila. Sin recepcion vigente, un pendiente vale "si se atiende como
   * particular"; en un turno cancelado o ausente, un registrado es un anticipo para reintegrar.
   */
  protected textoDePrepago(turno: TurnoDelDia): string {
    return textoDePrepago(turno.prepago, {
      // Una RETIRADO no esta abierta, pero la llegada consta: el prepago no es "antes del check-in".
      antesDelCheckin: !llegadaVigente(turno.recepcion),
      turnoCaido:
        turno.estado === TurnoDelDiaEstadoEnum.CANCELADO ||
        turno.estado === TurnoDelDiaEstadoEnum.AUSENTE,
    });
  }

  /**
   * Enlace al registro de cobro en modo prepago. Es una URL y no un import: `billing` es otro
   * feature (AGENT.md 4.4). Lleva el turno, el importe sugerido, la moneda y el dia para volver;
   * al volver, esta pantalla relee el dia entero y la fila ya dice REGISTRADO.
   */
  protected rutaDePrepago(turno: TurnoDelDia): readonly (string | number)[] {
    return ['/pacientes', turno.personaId ?? 0, 'cuenta-corriente', 'cobrar'];
  }

  protected queryDePrepago(turno: TurnoDelDia): Record<string, string | number> {
    const prepago = turno.prepago;
    return {
      turnoId: turno.id ?? 0,
      fecha: this.dia(),
      ...(prepago?.importeSugerido === undefined
        ? {}
        : { importeSugerido: prepago.importeSugerido }),
      ...(prepago?.moneda ? { monedaSugerida: prepago.moneda } : {}),
    };
  }

  // -------------------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------------------

  private reiniciar(): void {
    this.turnos.set([]);
    this.errorDeCarga.set(null);
    this.errorDelPanel.set(null);
    this.enVuelo.set(null);
    this.panel.set(null);
    this.timezone.set('');
  }

  /**
   * Corre una transicion de recepcion y deja la fila consistente con lo que devolvio.
   *
   * <p>La respuesta es la {@link Recepcion} entera: se reemplaza `recepcion` en la fila con un
   * <b>objeto nuevo</b> —mutar en su lugar no re-renderiza nada—. Una recepcion `ANULADA` deja de
   * ser la vigente, asi que la fila vuelve a no tenerla, que es lo que el servidor diria al
   * releer.
   *
   * <p><b>Feedback (UX-12).</b> Lo que sale bien es un aviso global; si vino del panel de motivo,
   * el panel se cierra recien ahi. Si falla desde el panel, el error queda arriba del panel
   * abierto; si fue una accion de la fila, es un aviso global de error con "Releer" cuando la fila
   * quedo vieja, o "Reintentar" cuando reintentar tiene sentido.
   */
  private transicion(
    turno: TurnoDelDia,
    peticion: (consultorioId: number, turnoId: number) => Observable<Recepcion>,
    resultado: (recepcion: Recepcion) => ResultadoDeTransicion,
    tituloDelError: string,
    reintentar: (() => void) | null = null,
    releerTurno = false,
  ): void {
    const consultorioId = this.tenantContext.consultorioId();
    const turnoId = turno.id;
    if (consultorioId === null || turnoId === undefined) {
      return;
    }
    const desdeElPanel = this.panel() !== null;
    this.lectura++;
    this.enVuelo.set(turnoId);
    this.errorDelPanel.set(null);
    peticion(consultorioId, turnoId).subscribe({
      next: (recepcion) => {
        this.enVuelo.set(null);
        if (desdeElPanel) {
          this.cerrarPanel();
        }
        const { tipo, titulo, descripcion } = resultado(recepcion);
        if (tipo === 'advertencia') {
          this.avisos.advertencia(titulo, { descripcion });
        } else {
          this.avisos.exito(titulo, { descripcion });
        }
        const vigente = recepcion.estado === RecepcionEstadoEnum.ANULADA ? undefined : recepcion;
        this.fusionar(turnoId, {
          recepcion: vigente,
          llegadaEn: vigente?.llegadaEn,
          // Con recepcion vigente, el prepago del turno ES el de la recepcion (E-8).
          ...(vigente?.prepago ? { prepago: vigente.prepago } : {}),
        });
        // Sin recepcion vigente el prepago vuelve a ser el "antes del check-in", que solo el
        // servidor sabe recalcular.
        if (releerTurno || vigente === undefined) {
          this.refrescarFila(turnoId);
        }
      },
      error: (error: unknown) => {
        this.enVuelo.set(null);
        const traducido = traducirErrorRecepcion(error);
        const releer = CAUSAS_QUE_RELEEN.has(traducido.causa);
        if (releer) {
          this.refrescarFila(turnoId);
        }
        if (desdeElPanel && this.panel() !== null) {
          this.errorDelPanel.set({ titulo: tituloDelError, error: traducido });
          return;
        }
        this.avisarError(tituloDelError, traducido, releer ? null : reintentar);
      },
    });
  }

  /** Aviso global de error de una accion de la fila, con la salida que corresponde. */
  private avisarError(
    titulo: string,
    traducido: ErrorAgenda,
    reintentar: (() => void) | null,
  ): void {
    const descripcion = traducido.motivo
      ? `${traducido.mensaje} Lo que dijo el servidor: ${traducido.motivo}`
      : traducido.mensaje;
    if (traducido.accion === 'recargar-dia') {
      this.avisos.error(titulo, {
        descripcion,
        accion: { etiqueta: 'Releer el día', ejecutar: () => this.releerDia() },
      });
    } else if (reintentar !== null && (traducido.causa === 'red' || traducido.causa === 'otro')) {
      this.avisos.error(titulo, {
        descripcion,
        accion: { etiqueta: 'Reintentar', ejecutar: reintentar },
      });
    } else {
      this.avisos.error(titulo, { descripcion });
    }
  }

  /**
   * Relee un turno solo y actualiza su fila.
   *
   * <p>Silencioso a proposito: se dispara despues de algo que la pantalla ya explico. Si falla, la
   * fila queda como estaba y el boton de recargar el dia sigue disponible.
   */
  private refrescarFila(turnoId: number): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      return;
    }
    this.api.verTurno(consultorioId, turnoId).subscribe({
      // Reemplazo y no fusion para `recepcion`: si el servidor ya no la trae, la fila no la tiene.
      next: (leido) =>
        this.fusionar(turnoId, {
          ...leido,
          recepcion: leido.recepcion,
          llegadaEn: leido.llegadaEn,
          prepago: leido.prepago,
        }),
      error: () => undefined,
    });
  }

  private fusionar(turnoId: number, cambios: Partial<TurnoDelDia>): void {
    this.lectura++;
    this.turnos.update((filas) =>
      filas.map((fila) => (fila.id === turnoId ? { ...fila, ...cambios } : fila)),
    );
  }
}

/** En que grupo del filtro rapido cae la fila segun su recepcion vigente. */
function grupoDeRecepcion(turno: TurnoDelDia): string {
  switch (turno.recepcion?.estado) {
    case undefined:
    case RecepcionEstadoEnum.ANULADA:
      return 'sin-llegar';
    case RecepcionEstadoEnum.EN_ESPERA:
      return 'en-espera';
    case RecepcionEstadoEnum.LLAMADA:
      return 'llamados';
    case RecepcionEstadoEnum.RETIRADO:
    case RecepcionEstadoEnum.CERRADA:
      return 'cerrados';
    default:
      return 'en-mostrador';
  }
}

function nombre(turno: TurnoDelDia): string {
  return turno.personaNombre ?? 'el paciente';
}

/** Version de la RECEPCION, no del turno: son dos controles optimistas distintos. */
function versionDe(turno: TurnoDelDia): number {
  return turno.recepcion?.version ?? 0;
}

function enEstado(turno: TurnoDelDia, ...estados: readonly RecepcionEstadoEnum[]): boolean {
  const actual = turno.recepcion?.estado;
  return actual !== undefined && estados.includes(actual);
}
