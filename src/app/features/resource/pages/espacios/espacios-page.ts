import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { EspacioPageResponse } from '../../../../api/generated/model/espacio-page-response';
import { EspacioResponse } from '../../../../api/generated/model/espacio-response';
import { EspaciosService } from '../../../../api/generated/api/espacios.service';
import { EstadoDeListado, vistaDeListado } from '../../../../shared/utils/estado-de-listado';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import {
  FILAS_POR_PAGINA_INICIAL,
  Paginacion,
} from '../../../../shared/components/paginacion/paginacion';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { UpdateEspacioRequest } from '../../../../api/generated/model/update-espacio-request';
import { CausaEspacio, traducirErrorEspacio } from '../../models/espacio-errors';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { SituacionDeServicio, situacionDeServicio } from '../../models/situacion-de-servicio';
import { TIPOS_DE_ESPACIO, etiquetaDeTipo } from '../../models/tipos-de-espacio';
import {
  aCampoLocal,
  aInstanteUtc,
  formatearInstante,
  mismoInstante,
} from '../../../../shared/utils/instantes';
import { textoRequerido } from '../../../../shared/validators/texto-requerido';
import { numeroDeclarado } from '../../../../shared/utils/numero-declarado';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { Icono } from '../../../../shared/components/icono/icono';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import {
  CamposDeSort,
  ordenDeServidor,
} from '../../../../shared/components/tabla/orden-de-servidor';
import { textoDeBusqueda } from '../../../../shared/utils/texto-de-busqueda';
import { ListEspaciosRequestParams } from '../../../../api/generated/api/espacios.serviceInterface';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import { AccionesDeFila } from '../../../../shared/components/acciones-de-fila/acciones-de-fila';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

/** Filtro de estado del listado. Los tres valores son los del contrato. */
type FiltroEstado = 'ACTIVO' | 'INACTIVO' | 'TODOS';

/** Operacion abierta sobre una fila. Solo una a la vez. */
type TipoAccion = 'editar' | 'baja';

/**
 * Espacios y boxes de la sede activa (M04, AKINE-02.02).
 *
 * <p>Consume las cuatro operaciones de `/organizations/{orgId}/consultorios/{consultorioId}/espacios`.
 * El `orgId` y el `consultorioId` salen de {@link TenantContextStore}: la pantalla no guarda
 * una copia y no acepta ninguno por URL. Un id de sede en la URL seria un segundo lugar desde
 * donde elegir tenant, y el unico que el token acota es el del contexto.
 *
 * <p><b>El listado NO exige `consultorio:manage`.</b> Es la lectura que necesita un
 * profesional para saber en que box atiende; restringirla al administrador dejaria a la mitad
 * del equipo sin poder consultarla. Las acciones de cada fila si van detras de
 * `*akinePermiso`, que es UX y no seguridad: quien igual arme el `PATCH` con curl recibe un
 * `403` del backend.
 *
 * <h2>Las dos distinciones que esta pantalla no aplana</h2>
 *
 * <p><b>1. `estado` no es `enServicio`.</b> Ver {@link situacionDeServicio}: la columna de
 * estado muestra las dos cosas y, cuando un espacio esta ACTIVO pero fuera de su ventana,
 * explica por que no va a aparecer en el selector de reserva. Sin eso, alguien lo reporta
 * como un bug de la agenda.
 *
 * <p><b>2. Capacidad no es ocupacion.</b> La columna se llama "Capacidad" y dice cuantas
 * personas simultaneas admite el espacio. No dice "libre" ni "disponible" en ningun lado,
 * porque hoy no hay ningun modulo que reserve y ese cartel pasaria a mentir solo, sin que el
 * contrato cambie, en cuanto exista la agenda.
 *
 * <p><b>La `version` viaja en cada edicion.</b> Si quedo vieja el backend responde
 * `409 concurrent-modification` y no se pisa nada: la pantalla relee el espacio, actualiza la
 * base de comparacion y deja el panel abierto con lo que el usuario habia escrito.
 *
 * <p><b>Reacciona a `contextEpoch`.</b> Cambiar de sede sin recargar dejaria en pantalla los
 * boxes de la anterior bajo la nueva, y un panel de baja a medio llenar apuntando a un id de
 * otra sede es peor que uno vacio.
 */
@Component({
  selector: 'app-espacios-page',
  imports: [
    CabeceraDePagina,

    Alerta,
    Ayuda,
    Icono,
    Filtros,
    ColumnaOrdenable,
    ReactiveFormsModule,
    RouterLink,
    PermisoDirective,
    Paginacion,
    ConfirmacionConMotivo,
    PanelLateral,
    AccionesDeFila,
    EstadoVacio,
  ],
  templateUrl: './espacios-page.html',
  styleUrl: '../../resource.css',
})
export class EspaciosPage {
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly espacios = inject(EspaciosService);
  private readonly avisos = inject(AvisosStore);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly injector = inject(Injector);

  protected readonly permisoManage = PERMISO_CONSULTORIO_MANAGE;
  protected readonly tipos = TIPOS_DE_ESPACIO;
  protected readonly etiquetaDeTipo = etiquetaDeTipo;
  protected readonly formatearInstante = (instante: string | undefined | null): string | null =>
    formatearInstante(instante, this.diaDeLaSede.zona());

  protected readonly nombreDeLaSede = computed(
    () => this.tenantContext.context()?.consultorioName ?? 'la sede activa',
  );

  protected readonly estado = signal<EstadoDeListado<EspacioPageResponse>>({ tipo: 'cargando' });

  private readonly vista = vistaDeListado<EspacioResponse>(this.estado);
  protected readonly filtro = signal<FiltroEstado>('ACTIVO');
  /** Filtros avanzados fuera de su valor por defecto (regla de filtros, plan §3.4). */
  protected readonly filtrosAvanzadosActivos = computed(() => Number(this.filtro() !== 'ACTIVO'));
  protected readonly paginaActual = signal(0);

  /**
   * Filas por pagina (UX-14): viaja como `size`. Las opciones del pie (10 a 100) quedan dentro del
   * tope de 100 que el backend recorta.
   */
  protected readonly porPagina = signal<number>(FILAS_POR_PAGINA_INICIAL);

  /** Lo que se busca en el nombre del espacio (DP-45, `q` del servidor). */
  protected readonly busqueda = signal('');

  /** Hay busqueda o filtro fuera de su valor por defecto: el vacio es "no hay con esto". */
  protected readonly hayFiltros = computed(
    () => this.busqueda().trim() !== '' || this.filtro() !== 'ACTIVO',
  );

  /** Titulo del vacio filtrado: dice que fue lo que no encontro. */
  protected readonly tituloSinResultados = computed(() => {
    if (this.busqueda().trim() !== '') return 'Ningún espacio coincide con la búsqueda.';
    if (this.filtro() === 'INACTIVO') return 'No hay espacios dados de baja en esta sede.';
    return 'No hay espacios que mostrar con este filtro.';
  });

  /** Orden de la tabla, pedido al servidor: cambiarlo vuelve a la primera pagina (DP-45). */
  protected readonly orden = ordenDeServidor<CamposDeSort<ListEspaciosRequestParams['sort']>>(() =>
    this.recargarDesdeElPrincipio(),
  );

  /** Fila y operacion abiertas, o `null`. Solo una a la vez. */
  protected readonly panel = signal<{ readonly id: number; readonly tipo: TipoAccion } | null>(
    null,
  );

  /**
   * Lo del panel abierto. El panel lateral vive fuera de la tabla (refactor UX/UI del 28/10/2026),
   * asi que lo busca en el listado en vez de recibirlo del `@for` de la fila.
   */
  protected readonly espacioEnPanel = computed(() => {
    const panel = this.panel();
    return panel === null
      ? null
      : (this.espaciosDeLaPagina().find((espacio) => espacio.id === panel.id) ?? null);
  });

  /**
   * Espacio tal como lo devolvio el backend la ultima vez, para el panel abierto.
   *
   * <p>Es la <b>base de comparacion</b> del `PATCH`: sin ella no se puede distinguir un campo
   * que el usuario no toco de uno que vacio a proposito. Se reemplaza cuando el espacio se
   * relee tras un conflicto de concurrencia.
   */
  private readonly original = signal<EspacioResponse | null>(null);

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaEspacio | null>(null);
  protected readonly intentos = signal(0);

  /**
   * Momento con el que se evalua la ventana de vigencia de cada fila.
   *
   * <p>Es un signal y se refresca en cada carga: si fuera un `Date` calculado una sola vez al
   * construir el componente, una pestaña abierta toda la mañana seguiria diciendo "entra en
   * servicio a las 9" a las once.
   */
  private readonly ahora = signal(new Date());

  protected readonly formularioEdicion = this.formBuilder.nonNullable.group({
    name: ['', [textoRequerido]],
    tipo: [''],
    // Texto y no numero: un `input` siempre entrega texto, y `''` es "no lo toques".
    capacidad: [''],
    notes: [''],
    validFrom: [''],
    validUntil: [''],
    clearValidUntil: [false],
  });

  protected readonly espaciosDeLaPagina = this.vista.filas;
  protected readonly totalPaginas = this.vista.totalPaginas;
  protected readonly totalEspacios = this.vista.totalElementos;
  protected readonly mensajeError = this.vista.mensajeError;
  protected readonly faltaContexto = this.vista.faltaContexto;

  /** Un espacio dado de baja no se edita: el formulario abierto queda deshabilitado. */
  protected readonly edicionBloqueada = computed(() => this.causaAccion() === 'espacio-inactivo');

  /** Errores que solo se resuelven releyendo el listado. */
  protected readonly hayQueRecargar = computed(() => {
    const causa = this.causaAccion();
    return causa === 'no-encontrado' || causa === 'ya-inactivo';
  });

  /** El conflicto de nombre unico se muestra EN el campo nombre, no al pie. */
  protected readonly errorEnElNombre = computed(() => this.causaAccion() === 'nombre-tomado');

  /**
   * `aria-describedby` del campo nombre: el conflicto del servidor manda sobre el vacio local.
   *
   * <p>Se calcula aca y no con un ternario anidado en la plantilla porque son tres estados y
   * un solo atributo: en HTML eso se lee como una expresion ilegible que nadie revisa, y un
   * `aria-describedby` que apunta a un `id` que no esta renderizado no describe nada.
   *
   * <p><b>Metodo y no `computed`.</b> Depende de `control.touched`, que es estado de
   * `ReactiveForms` y no un signal: un `computed` cachearia el primer valor y el error dejaria
   * de anunciarse al tocar el campo. Igual que {@link mostrarErrorEdicion}.
   */
  protected descritoNombre(): string | null {
    if (this.errorEnElNombre()) {
      return 'editar-espacio-name-conflicto';
    }
    return this.mostrarErrorEdicion('name') ? 'editar-espacio-name-error' : null;
  }

  constructor() {
    effect(() => {
      // Dependencia explicita: cualquier cambio de contexto invalida todo lo que hay abierto.
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.cerrarPanel();
        this.paginaActual.set(0);
        this.filtro.set('ACTIVO');
        this.busqueda.set('');
        this.orden.reiniciar();
        this.cargar();
      });
    });
  }

  protected cargar(): void {
    const orgId = this.tenantContext.organizationId();
    const consultorioId = this.tenantContext.consultorioId();

    // Sin sede elegida la peticion seria invalida: los espacios son de una sede concreta. Se
    // muestra el estado que manda a elegirla, y NUNCA se cierra la sesion por esto.
    if (orgId === null || consultorioId === null) {
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }

    this.ahora.set(new Date());
    this.estado.set({ tipo: 'cargando' });

    this.espacios
      .listEspacios({
        orgId,
        consultorioId,
        estado: this.filtro(),
        page: this.paginaActual(),
        size: this.porPagina(),
        q: textoDeBusqueda(this.busqueda()),
        sort: this.orden.sort(),
      })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          const traducido = traducirErrorEspacio(respuesta);
          this.estado.set({
            tipo: 'error',
            mensaje: traducido.mensaje,
            faltaContexto: traducido.causa === 'sin-contexto',
          });
          return;
        }
        this.estado.set({ tipo: 'listo', pagina: respuesta });
      });
  }

  /** Situacion de servicio de una fila, ya redactada. Ver {@link situacionDeServicio}. */
  protected situacion(espacio: EspacioResponse): SituacionDeServicio {
    return situacionDeServicio(espacio, this.ahora(), this.diaDeLaSede.zona());
  }

  protected cambiarFiltro(valor: string): void {
    const elegido: FiltroEstado =
      valor === 'INACTIVO' || valor === 'TODOS' ? valor : ('ACTIVO' as const);
    this.filtro.set(elegido);
    this.recargarDesdeElPrincipio();
  }

  /** Vuelve la busqueda y el filtro a su valor por defecto ("Limpiar filtros"). */
  protected limpiarFiltros(): void {
    this.busqueda.set('');
    this.filtro.set('ACTIVO');
    this.recargarDesdeElPrincipio();
  }

  /** Otro tamaño de pagina: vuelve a la primera y recarga. */
  protected cambiarPorPagina(cantidad: number): void {
    this.porPagina.set(cantidad);
    this.recargarDesdeElPrincipio();
  }

  protected buscar(texto: string): void {
    this.busqueda.set(texto);
    this.recargarDesdeElPrincipio();
  }

  /**
   * Volver a la primera pagina: la pagina 3 del filtro, la busqueda o el orden anterior puede no
   * existir en el nuevo, y el backend devolveria una pagina vacia que se lee como "no hay espacios".
   */
  private recargarDesdeElPrincipio(): void {
    this.cerrarPanel();
    this.paginaActual.set(0);
    this.cargar();
  }

  protected irAPagina(numero: number): void {
    if (numero < 0 || numero >= this.totalPaginas()) {
      return;
    }
    this.cerrarPanel();
    this.paginaActual.set(numero);
    this.cargar();
  }

  protected abrirPanel(espacio: EspacioResponse, tipo: TipoAccion): void {
    const id = espacio.id;
    if (id === undefined) {
      return;
    }

    this.cerrarPanel();
    this.panel.set({ id, tipo });

    if (tipo === 'editar') {
      this.original.set(espacio);
      this.cargarFormulario(espacio);
      // El foco se va con el panel. Sin esto, quien navega por teclado aprieta "Editar",
      // aparece un formulario de siete campos mas abajo y el foco se queda en el boton: hay
      // que recorrer el resto de la fila para llegar a lo que el propio click acaba de abrir.
      // El panel de baja ya lo hacia -es de `ConfirmacionConMotivo`-, asi que sin esto las dos
      // acciones de la misma fila se comportaban distinto.
      //
      // `afterNextRender` y no un `queueMicrotask`: el campo todavia NO existe -lo crea el
      // render que dispara el signal que se acaba de escribir- y en zoneless ese render es
      // asincrono, asi que una microtarea corre antes y no encuentra nada que enfocar.
      afterNextRender(() => this.enfocar('#editar-espacio-name'), { injector: this.injector });
    }
  }

  protected cerrarPanel(): void {
    this.panel.set(null);
    this.original.set(null);
    this.enviando.set(false);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.intentos.set(0);
  }

  protected mostrarErrorEdicion(campo: 'name' | 'capacidad'): boolean {
    const control = this.formularioEdicion.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  /**
   * Envia solo lo que cambio.
   *
   * <p>El resultado sin cambios reales es un cuerpo con `version` y nada mas, que el backend
   * acepta sin tocar nada. No se corta antes a proposito: el espacio pudo haber cambiado en
   * el servidor y un `PATCH` vacio es la forma barata de enterarse.
   */
  protected enviarEdicion(): void {
    const panel = this.panel();
    const orgId = this.tenantContext.organizationId();
    const consultorioId = this.tenantContext.consultorioId();
    if (panel === null || orgId === null || consultorioId === null || this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);
    if (this.formularioEdicion.invalid) {
      this.formularioEdicion.markAllAsTouched();
      this.enfocar(
        this.formularioEdicion.controls.name.invalid
          ? '#editar-espacio-name'
          : '#editar-espacio-capacidad',
      );
      return;
    }

    const cambios = this.armarCambios();
    if (cambios === null) {
      return;
    }

    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);

    this.espacios
      .updateEspacio({
        orgId,
        consultorioId,
        espacioId: panel.id,
        updateEspacioRequest: cambios,
      })
      .subscribe({
        next: (actualizado) => {
          this.cerrarPanel();
          this.avisos.exito('Cambios guardados', { descripcion: actualizado.name ?? undefined });
          this.cargar();
        },
        error: (error: unknown) => this.fallarEdicion(error, orgId, consultorioId, panel.id),
      });
  }

  /**
   * Da de baja el espacio del panel abierto.
   *
   * <p>El motivo llega ya validado y recortado desde {@link ConfirmacionConMotivo}: que el
   * campo sea obligatorio, el foco al abrir y el `aria-describedby` del error son de la
   * primitiva, porque no dependen de que lo que se da de baja sea un box.
   *
   * <p><b>No hay reactivacion.</b> El contrato no publica ninguna operacion que deshaga esto,
   * y el panel lo dice antes de confirmar: desde la interfaz la baja es terminal.
   */
  protected enviarBaja(motivo: string): void {
    const panel = this.panel();
    const orgId = this.tenantContext.organizationId();
    const consultorioId = this.tenantContext.consultorioId();
    if (panel === null || orgId === null || consultorioId === null || this.enviando()) {
      return;
    }

    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);

    this.espacios
      .deactivateEspacio({
        orgId,
        consultorioId,
        espacioId: panel.id,
        deactivateEspacioRequest: { reason: motivo },
      })
      .subscribe({
        next: () => {
          const nombre = this.espacioEnPanel()?.name;
          this.cerrarPanel();
          this.avisos.exito('Espacio dado de baja', {
            descripcion:
              `${nombre ? nombre + '. ' : ''}Sigue en el listado con su motivo; su nombre queda ` +
              'libre para un espacio nuevo.',
          });
          this.cargar();
        },
        error: (error: unknown) => this.fallar(error),
      });
  }

  /**
   * Traduce el cuerpo del `PATCH` distinguiendo <b>omitido</b> de <b>cadena vacia</b>.
   *
   * <p>El contrato le da a las dos formas significados opuestos: un campo <b>ausente</b> no se
   * toca, y `notes: ""` <b>borra</b> la observacion. Un formulario que mande siempre todos los
   * campos no puede expresar "no lo toques", asi que borraria en cada guardado la nota que
   * otra persona hubiera cargado entre medio, sin que nadie pida nada.
   *
   * <p><b>`clearValidUntil` existe porque `null` no se puede pedir omitiendo.</b> "No toques
   * el fin de vigencia" y "sacale el fin de vigencia" son dos intenciones distintas, y con un
   * solo campo nulable la segunda no se puede expresar. Cuando la casilla esta marcada,
   * `validUntil` se omite: el contrato dice que lo ignora, y mandarlo igual solo confundiria
   * a quien lea el request en un log.
   */
  private armarCambios(): UpdateEspacioRequest | null {
    const original = this.original();
    const version = original?.version;
    if (original === null || version === undefined) {
      // Sin `version` no hay edicion posible: mandar `0` pisaria el cambio de otro, que es
      // exactamente lo que el control de concurrencia optimista existe para impedir.
      this.errorAccion.set(
        'No pudimos leer la versión de este espacio. Cerra el panel, recarga el listado y volvé a intentar.',
      );
      return null;
    }

    const valores = this.formularioEdicion.getRawValue();
    const cambios: UpdateEspacioRequest = { version };

    const nombre = valores.name.trim();
    if (nombre !== (original.name ?? '')) {
      cambios.name = nombre;
    }

    if (valores.tipo !== '' && valores.tipo !== (original.tipo ?? '')) {
      cambios.tipo = valores.tipo as UpdateEspacioRequest['tipo'];
    }

    const capacidad = numeroDeclarado(valores.capacidad);
    if (capacidad !== null && capacidad !== original.capacidad) {
      cambios.capacidad = capacidad;
    }

    // Aca `''` puede ser deliberado: es la forma que el contrato define para BORRAR la nota,
    // y por eso se manda en vez de omitirse.
    const notas = valores.notes.trim();
    if (notas !== (original.notes ?? '')) {
      cambios.notes = notas;
    }

    // La comparacion es por INSTANTE y no por texto: el valor que dio la vuelta por el control
    // del navegador vuelve con milisegundos y el del backend no, asi que comparar strings
    // concluiria que el usuario cambio la fecha en cada guardado. Ver `mismoInstante`.
    const desde = aInstanteUtc(valores.validFrom, this.diaDeLaSede.zona());
    if (desde !== null && !mismoInstante(desde, original.validFrom)) {
      cambios.validFrom = desde;
    }

    if (valores.clearValidUntil) {
      cambios.clearValidUntil = true;
    } else {
      const hasta = aInstanteUtc(valores.validUntil, this.diaDeLaSede.zona());
      if (hasta !== null && !mismoInstante(hasta, original.validUntil)) {
        cambios.validUntil = hasta;
      }
    }

    return cambios;
  }

  private cargarFormulario(espacio: EspacioResponse): void {
    this.formularioEdicion.reset({
      name: espacio.name ?? '',
      tipo: espacio.tipo ?? '',
      capacidad: espacio.capacidad === undefined ? '' : String(espacio.capacidad),
      notes: espacio.notes ?? '',
      validFrom: aCampoLocal(espacio.validFrom, this.diaDeLaSede.zona()),
      validUntil: aCampoLocal(espacio.validUntil, this.diaDeLaSede.zona()),
      clearValidUntil: false,
    });
  }

  /**
   * Falla de la edicion. El conflicto de concurrencia tiene tratamiento propio.
   *
   * <p>Ante `409 concurrent-modification` <b>no se pisa nada y no se cierra el panel</b>: se
   * relee el espacio, se toma esa lectura como base de comparacion nueva -con su `version`
   * nueva- y se deja en pantalla lo que el usuario habia escrito. Reintentar en silencio con
   * la version nueva seria justamente pisar el cambio del otro, que es lo que el `409` existe
   * para evitar.
   */
  private fallarEdicion(
    error: unknown,
    orgId: number,
    consultorioId: number,
    espacioId: number,
  ): void {
    const traducido = traducirErrorEspacio(error);
    this.enviando.set(false);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);

    if (traducido.causa === 'espacio-inactivo') {
      // Un espacio dado de baja no admite ediciones: el formulario se apaga en vez de dejar
      // al usuario reenviando algo que ya sabemos que va a fallar igual.
      this.formularioEdicion.disable();
      return;
    }

    if (traducido.causa !== 'concurrencia') {
      return;
    }

    this.espacios
      .getEspacio({ orgId, consultorioId, espacioId })
      .pipe(catchError(() => of(null)))
      .subscribe((espacio) => {
        if (espacio === null) {
          return;
        }
        this.original.set(espacio);
        this.cargar();
      });
  }

  private fallar(error: unknown): void {
    const traducido = traducirErrorEspacio(error);
    this.enviando.set(false);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}
