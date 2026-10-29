import { Pestanas } from '../../../../shared/components/pestanas/pestanas';
import {
  ETIQUETA_PESTANAS_DE_SERVICIOS,
  PESTANAS_DE_SERVICIOS,
} from '../../models/pestanas-de-offering';
import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, Subscription, catchError, debounceTime, of } from 'rxjs';

import { PlatformRoleStore } from '../../../../core/services/platform-role.store';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { CreateServicioRequest } from '../../../../api/generated/model/create-servicio-request';
import { EstadoDeListado } from '../../../../shared/utils/estado-de-listado';
import { ServicioResponse } from '../../../../api/generated/model/servicio-response';
import { UpdateServicioRequest } from '../../../../api/generated/model/update-servicio-request';
import { FiltroEstado, OfferingApi } from '../../services/offering-api';
import {
  MODALIDADES,
  NATURALEZAS,
  etiquetaDeModalidad,
  etiquetaDeNaturaleza,
} from '../../models/etiquetas-de-offering';
import { CausaOffering, hayQueRecargar, traducirErrorOffering } from '../../models/offering-errors';
import { textoRequerido } from '../../../../shared/validators/texto-requerido';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import { Icono } from '../../../../shared/components/icono/icono';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import { Paginacion } from '../../../../shared/components/paginacion/paginacion';
import { tablaLocal } from '../../../../shared/components/tabla/tabla-local';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import { AccionesDeFila } from '../../../../shared/components/acciones-de-fila/acciones-de-fila';

/** Operacion abierta sobre una fila. Solo una a la vez. */
type TipoAccion = 'editar' | 'baja';

/**
 * Cuanto se espera antes de buscar mientras el usuario escribe.
 *
 * <p>250ms es el numero de siempre para busqueda incremental, el mismo que usa el catalogo
 * clinico: por debajo se dispara una peticion por tecla, por encima el listado se siente
 * trabado. La etapa pide <b>busqueda incremental</b>, no un boton de buscar.
 */
const ESPERA_DE_BUSQUEDA = 250;

/**
 * Catalogo global de Servicios (M27, AKINE-02.06).
 *
 * <p>Un `Servicio` es <b>que existe como concepto</b> —"kinesiologia respiratoria"—, no como lo
 * presta un centro concreto. Eso ultimo es la Oferta, y vive en la otra pantalla de esta misma
 * feature. Es la regla maestra 14 y es el objetivo entero de la etapa: si las dos cosas se
 * mezclan, el precio de un centro termina siendo el precio de todos.
 *
 * <p>El catalogo es <b>puramente global</b>: un `Servicio` no tiene organizacion (diseno 1). No
 * hay dos poblaciones como en el catalogo clinico, asi que no hay ninguna columna de alcance:
 * todas las filas son de la plataforma.
 *
 * <h2>Quien puede administrar esto</h2>
 *
 * <p>Leer el catalogo alcanza con estar autenticado. <b>Mutarlo exige rol de plataforma</b>, y
 * desde A-7 el frontend lo sabe: `PlatformRoleStore` pregunta una vez por sesion a
 * `GET /me/platform-role`. Las acciones de alta, edicion y baja se muestran <b>solo</b> a quien
 * tiene ese rol; a los demas la nota de arriba les dice por que no estan y los manda a las
 * ofertas de la sede, que es lo que su centro si administra.
 *
 * <p>Hasta A-7 la pantalla hacia lo contrario —mostrar las acciones a todos y dejar que el
 * `403` del servidor fuera la respuesta— porque ocultarlas sin saber el rol era adivinar, y
 * adivinar en contra le escondia el boton a la unica persona que tenia que apretarlo.
 *
 * <p><b>Ocultar es UX, no seguridad</b> (AGENT.md 1): el backend verifica el rol en cada
 * request. Por eso el manejo del `403` (`rechazadoPorRol`) se queda: un rol revocado a mitad
 * de sesion, o una consulta del rol que fallo y se resolvio como "no", siguen terminando en una
 * explicacion y no en un error mudo.
 *
 * <p><b>La `expectedVersion` viaja en cada edicion.</b> Si quedo vieja el backend responde
 * `409 conflict` —<b>no</b> `concurrent-modification`, ver `offering-errors.ts`— y no se pisa
 * nada: la pantalla relee el listado, actualiza la base de comparacion y deja el panel abierto
 * con lo que el usuario habia escrito.
 */
@Component({
  selector: 'app-catalogo-de-servicios-page',
  imports: [
    Pestanas,
    Ayuda,
    ColumnaOrdenable,
    Filtros,
    Icono,
    Paginacion,
    ReactiveFormsModule,
    RouterLink,
    ConfirmacionConMotivo,
    PanelLateral,
    AccionesDeFila,
  ],
  templateUrl: './catalogo-de-servicios-page.html',
  styleUrl: '../../offering.css',
})
export class CatalogoDeServiciosPage {
  protected readonly pestanasDeServicios = PESTANAS_DE_SERVICIOS;
  protected readonly etiquetaDePestanas = ETIQUETA_PESTANAS_DE_SERVICIOS;
  private readonly api = inject(OfferingApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly injector = inject(Injector);
  private readonly rolDePlataforma = inject(PlatformRoleStore);

  /** `true` solo si la cuenta tiene rol de plataforma. Ver el javadoc de la clase. */
  protected readonly puedeAdministrar = this.rolDePlataforma.esAdminDePlataforma;

  /**
   * `true` cuando ya se sabe la respuesta —incluida una consulta fallida, que el store resuelve
   * como "no"—. Mientras es `false` la nota no afirma nada sobre la cuenta de quien mira.
   */
  protected readonly rolConsultado = signal(false);

  protected readonly naturalezas = NATURALEZAS;
  protected readonly modalidades = MODALIDADES;
  protected readonly etiquetaDeNaturaleza = etiquetaDeNaturaleza;
  protected readonly etiquetaDeModalidad = etiquetaDeModalidad;

  /**
   * Estado del listado.
   *
   * <p>Se reusa la union discriminada de ADR-0005 con la lista completa adentro: `GET
   * /api/v1/servicios` <b>no pagina</b> —el catalogo global es chico y el contrato devuelve un
   * array—, asi que el campo `pagina` de la union contiene todas las filas. Se reusa igual en
   * vez de declarar una sexta union propia: lo que ADR-0005 exige es que los estados sean
   * inexpresables entre si, y eso lo da este tipo tal cual.
   */
  protected readonly estado = signal<EstadoDeListado<readonly ServicioResponse[]>>({
    tipo: 'cargando',
  });

  protected readonly servicios = computed<readonly ServicioResponse[]>(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.pagina : [];
  });

  /** Orden y paginado de la lista completa (plan §3.4): el servidor no pagina servicios. */
  protected readonly tabla = tablaLocal(this.servicios, {
    columnas: {
      nombre: (servicio) => servicio.nombre,
      codigo: (servicio) => servicio.codigo,
      naturaleza: (servicio) => this.etiquetaDeNaturaleza(servicio.naturaleza),
      modalidad: (servicio) => this.etiquetaDeModalidad(servicio.modalidadDefault),
      estado: (servicio) => servicio.estado,
    },
  });

  protected readonly mensajeError = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  protected readonly busqueda = signal('');
  protected readonly filtroEstado = signal<FiltroEstado>('ACTIVO');

  /** Cuantos filtros del embudo estan fuera de su valor por defecto: el boton los cuenta. */
  protected readonly filtrosAvanzadosActivos = computed(() =>
    Number(this.filtroEstado() !== 'ACTIVO'),
  );

  /** Fila y operacion abiertas, o `null`. Solo una a la vez. */
  protected readonly panel = signal<{ readonly id: number; readonly tipo: TipoAccion } | null>(
    null,
  );

  /**
   * Lo del panel abierto. El panel lateral vive fuera de la tabla (refactor UX/UI del 28/10/2026),
   * asi que lo busca en el listado en vez de recibirlo del `@for` de la fila.
   */
  protected readonly servicioEnPanel = computed(() => {
    const panel = this.panel();
    return panel === null
      ? null
      : (this.servicios().find((servicio) => servicio.id === panel.id) ?? null);
  });

  /** `true` mientras el panel de alta esta abierto. El alta y la edicion se excluyen. */
  protected readonly altaAbierta = signal(false);

  /**
   * Servicio tal como lo devolvio el backend la ultima vez, para el panel abierto.
   *
   * <p>Es la <b>base de comparacion</b> de la edicion: sin ella no se puede distinguir un campo
   * que el usuario no toco de uno que dejo igual a proposito, y ademas es de donde sale la
   * `expectedVersion`.
   */
  private readonly original = signal<ServicioResponse | null>(null);

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaOffering | null>(null);
  protected readonly exito = signal<string | null>(null);
  protected readonly intentos = signal(0);

  /** `true` cuando el rechazo fue por no tener rol de plataforma. Ver el javadoc de la clase. */
  protected readonly rechazadoPorRol = computed(
    () => this.causaAccion() === 'sin-rol-de-plataforma',
  );

  /** Errores que solo se resuelven releyendo el listado. */
  protected readonly hayQueRecargar = computed(() => hayQueRecargar(this.causaAccion()));

  /** Lo que el usuario tipea, antes del debounce. Ver {@link ESPERA_DE_BUSQUEDA}. */
  private readonly tecleado = new Subject<string>();
  /** La consulta del listado en curso, para cancelarla si llega otra. Ver {@link cargar}. */
  private cargaEnVuelo: Subscription | null = null;

  protected readonly formularioAlta = this.formBuilder.nonNullable.group({
    codigo: ['', [textoRequerido]],
    nombre: ['', [textoRequerido]],
    descripcion: [''],
    naturaleza: ['', [Validators.required]],
    modalidadDefault: ['', [Validators.required]],
    requiereCasoClinicoDefault: [false],
    generaRegistroClinicoDefault: [false],
  });

  protected readonly formularioEdicion = this.formBuilder.nonNullable.group({
    nombre: ['', [textoRequerido]],
    descripcion: [''],
    naturaleza: ['', [Validators.required]],
    modalidadDefault: ['', [Validators.required]],
    requiereCasoClinicoDefault: [false],
    generaRegistroClinicoDefault: [false],
  });

  constructor() {
    this.cargar();

    this.rolDePlataforma
      .resolver()
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.rolConsultado.set(true));

    this.tecleado
      .pipe(debounceTime(ESPERA_DE_BUSQUEDA), takeUntilDestroyed())
      .subscribe((texto) => {
        this.busqueda.set(texto);
        this.cargar();
      });
  }

  /**
   * Pide el catalogo.
   *
   * <p><b>No consulta el contexto de trabajo.</b> El `Servicio` es global y su lectura se
   * autoriza por estar autenticado: exigir una sede elegida dejaria afuera al rol de plataforma
   * y agregaria un estado `sin-contexto` que el endpoint no puede producir.
   */
  protected cargar(): void {
    this.estado.set({ tipo: 'cargando' });

    // Una sola consulta en vuelo: la nueva cancela la anterior. Sin esto ganaba la que llegaba
    // ULTIMA, y despues de una baja —que relee con "Solo los activos"— cambiar enseguida a "Solo
    // los dados de baja" podia terminar mostrando la lista de activos bajo el filtro de bajas
    // (encontrado por el E2E de servicios contra el backend real).
    this.cargaEnVuelo?.unsubscribe();
    this.cargaEnVuelo = this.api
      .listarServicios({ texto: this.busqueda(), estado: this.filtroEstado() })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          const traducido = traducirErrorOffering(respuesta, 'servicio');
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

  /** Cada tecla pasa por el debounce. Ver {@link ESPERA_DE_BUSQUEDA}. */
  protected teclear(valor: string): void {
    this.tecleado.next(valor);
  }

  protected cambiarFiltroEstado(valor: string): void {
    const elegido: FiltroEstado =
      valor === 'INACTIVO' || valor === 'TODOS' ? valor : ('ACTIVO' as const);
    this.cerrarPanel();
    this.filtroEstado.set(elegido);
    this.cargar();
  }

  protected abrirAlta(): void {
    this.cerrarPanel();
    this.exito.set(null);
    this.formularioAlta.reset({
      codigo: '',
      nombre: '',
      descripcion: '',
      naturaleza: '',
      modalidadDefault: '',
      requiereCasoClinicoDefault: false,
      generaRegistroClinicoDefault: false,
    });
    this.altaAbierta.set(true);
    afterNextRender(() => this.enfocar('#alta-servicio-codigo'), { injector: this.injector });
  }

  protected abrirPanel(servicio: ServicioResponse, tipo: TipoAccion): void {
    const id = servicio.id;
    if (id === undefined) {
      return;
    }

    this.cerrarPanel();
    this.exito.set(null);
    this.panel.set({ id, tipo });

    if (tipo === 'editar') {
      this.original.set(servicio);
      this.formularioEdicion.reset({
        nombre: servicio.nombre ?? '',
        descripcion: servicio.descripcion ?? '',
        naturaleza: servicio.naturaleza ?? '',
        modalidadDefault: servicio.modalidadDefault ?? '',
        requiereCasoClinicoDefault: servicio.requiereCasoClinicoDefault ?? false,
        generaRegistroClinicoDefault: servicio.generaRegistroClinicoDefault ?? false,
      });
      // El foco se va con el panel: sin esto, quien navega por teclado aprieta "Editar" y el
      // formulario aparece mas abajo mientras el foco sigue en el boton.
      afterNextRender(() => this.enfocar('#editar-servicio-nombre'), { injector: this.injector });
    }
  }

  protected cerrarPanel(): void {
    this.panel.set(null);
    this.altaAbierta.set(false);
    this.original.set(null);
    this.enviando.set(false);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.intentos.set(0);
  }

  protected mostrarErrorAlta(
    campo: 'codigo' | 'nombre' | 'naturaleza' | 'modalidadDefault',
  ): boolean {
    const control = this.formularioAlta.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected mostrarErrorEdicion(campo: 'nombre'): boolean {
    const control = this.formularioEdicion.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  /**
   * Da de alta un servicio en el catalogo global.
   *
   * <p>Los tres campos `*Default` son <b>propuesta inicial, no regla</b>: RF-M06-006 dice que
   * los defaults no reemplazan la configuracion concreta de cada Oferta, y cada centro los
   * puede cambiar en la suya. La plantilla lo dice con palabras al lado de cada control.
   */
  protected enviarAlta(): void {
    if (this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);

    if (this.formularioAlta.invalid) {
      this.formularioAlta.markAllAsTouched();
      this.enfocar(
        this.formularioAlta.controls.codigo.invalid
          ? '#alta-servicio-codigo'
          : '#alta-servicio-nombre',
      );
      return;
    }

    const valores = this.formularioAlta.getRawValue();
    // Los dos `select` guardan texto porque un `<select>` siempre entrega texto: el `''`
    // inicial es "todavia no elegiste" y por eso el control es `string` y no el enumerado.
    // Cuando llega hasta aca ya paso el `required`, asi que el valor es uno de los del
    // contrato. El estrechamiento se hace campo por campo y NO con un `as` sobre el objeto
    // entero: ese esconderia un campo obligatorio que el contrato agregue mas adelante.
    const cuerpo: CreateServicioRequest = {
      codigo: valores.codigo.trim(),
      nombre: valores.nombre.trim(),
      naturaleza: valores.naturaleza as CreateServicioRequest['naturaleza'],
      modalidadDefault: valores.modalidadDefault as CreateServicioRequest['modalidadDefault'],
      requiereCasoClinicoDefault: valores.requiereCasoClinicoDefault,
      generaRegistroClinicoDefault: valores.generaRegistroClinicoDefault,
    };

    const descripcion = valores.descripcion.trim();
    if (descripcion !== '') {
      cuerpo.descripcion = descripcion;
    }

    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);

    this.api.crearServicio(cuerpo).subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set(
          'El servicio quedo dado de alta en el catalogo global: lo ven todos los centros. Para ' +
            'que se ofrezca en una sede hay que crear su oferta.',
        );
        this.cargar();
      },
      error: (error: unknown) => this.fallar(error),
    });
  }

  /** Envia solo lo que cambio, mas la `expectedVersion`. Ver {@link armarCambios}. */
  protected enviarEdicion(): void {
    const panel = this.panel();
    if (panel === null || this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);
    if (this.formularioEdicion.invalid) {
      this.formularioEdicion.markAllAsTouched();
      this.enfocar('#editar-servicio-nombre');
      return;
    }

    const cambios = this.armarCambios();
    if (cambios === null) {
      return;
    }

    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);

    this.api.editarServicio(panel.id, cambios).subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set('Los datos del servicio quedaron guardados.');
        this.cargar();
      },
      error: (error: unknown) => this.fallarEdicion(error),
    });
  }

  /**
   * Da de baja el servicio del panel abierto.
   *
   * <p><b>La baja no cascadea.</b> Las ofertas de los centros que ya lo referencian siguen
   * operando y conservan sus historicos (RN-M03-006); lo que se impide es crear ofertas nuevas
   * sobre un servicio inactivo (RF-M27-002). La plantilla lo dice antes de confirmar, porque es
   * lo que decide si la baja es lo que el usuario queria.
   */
  protected enviarBaja(motivo: string): void {
    const panel = this.panel();
    if (panel === null || this.enviando()) {
      return;
    }

    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);

    this.api.darDeBajaServicio(panel.id, motivo).subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set(
          'El servicio quedo dado de baja. Las ofertas que ya lo usan siguen funcionando; lo que ' +
            'no se puede es crear ofertas nuevas sobre el.',
        );
        this.cargar();
      },
      error: (error: unknown) => this.fallar(error),
    });
  }

  /**
   * Arma el cuerpo de la edicion con lo que cambio y la `expectedVersion`.
   *
   * <p>Solo viajan los campos distintos del original. Mandar siempre todos pisaria lo que otra
   * persona hubiera cambiado entre medio sin que nadie lo haya pedido —el `409` protege contra
   * eso, pero solo si la version quedo vieja; dos ediciones sobre la misma version se pisan
   * campo por campo—.
   *
   * <p>El `codigo` no esta: es inmutable y el contrato ni siquiera lo acepta.
   */
  private armarCambios(): UpdateServicioRequest | null {
    const original = this.original();
    const version = original?.version;
    if (original === null || version === undefined) {
      // Sin version no hay edicion posible: mandar `0` pisaria el cambio de otro, que es justo
      // lo que el control de concurrencia optimista existe para impedir.
      this.errorAccion.set(
        'No pudimos leer la versión de este servicio. Cerra el panel, recarga el listado y volvé a intentar.',
      );
      return null;
    }

    const valores = this.formularioEdicion.getRawValue();
    const cambios: UpdateServicioRequest = { expectedVersion: version };

    const nombre = valores.nombre.trim();
    if (nombre !== (original.nombre ?? '')) {
      cambios.nombre = nombre;
    }

    // Aca `''` puede ser deliberado: es la unica forma de dejar el servicio sin descripcion,
    // porque el contrato no publica ningun `limpiarDescripcion` para el `Servicio`.
    const descripcion = valores.descripcion.trim();
    if (descripcion !== (original.descripcion ?? '')) {
      cambios.descripcion = descripcion;
    }

    if (valores.naturaleza !== (original.naturaleza ?? '')) {
      cambios.naturaleza = valores.naturaleza as UpdateServicioRequest['naturaleza'];
    }

    if (valores.modalidadDefault !== (original.modalidadDefault ?? '')) {
      cambios.modalidadDefault =
        valores.modalidadDefault as UpdateServicioRequest['modalidadDefault'];
    }

    if (valores.requiereCasoClinicoDefault !== (original.requiereCasoClinicoDefault ?? false)) {
      cambios.requiereCasoClinicoDefault = valores.requiereCasoClinicoDefault;
    }

    if (valores.generaRegistroClinicoDefault !== (original.generaRegistroClinicoDefault ?? false)) {
      cambios.generaRegistroClinicoDefault = valores.generaRegistroClinicoDefault;
    }

    return cambios;
  }

  /**
   * Falla de la edicion. El conflicto de concurrencia tiene tratamiento propio.
   *
   * <p>Ante `409 conflict` <b>no se pisa nada y no se cierra el panel</b>: se relee el listado
   * —que es de donde sale la version nueva, porque el contrato no publica un `GET` de un
   * servicio suelto— y se deja en pantalla lo que el usuario habia escrito.
   */
  private fallarEdicion(error: unknown): void {
    const traducido = traducirErrorOffering(error, 'servicio');
    this.enviando.set(false);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);

    if (traducido.causa !== 'concurrencia') {
      return;
    }

    const abierto = this.panel();
    this.api
      // Con los MISMOS filtros que tiene la pantalla: releer con otros cambiaria lo que se ve
      // sin que ningun control se haya movido, y el usuario lo leeria como que el filtro se
      // rompio.
      .listarServicios({ texto: this.busqueda(), estado: this.filtroEstado() })
      .pipe(catchError(() => of(null)))
      .subscribe((servicios) => {
        if (servicios === null || abierto === null) {
          return;
        }
        const releido = servicios.find((servicio) => servicio.id === abierto.id);
        if (releido !== undefined) {
          this.original.set(releido);
        }
        this.estado.set({ tipo: 'listo', pagina: servicios });
      });
  }

  private fallar(error: unknown): void {
    const traducido = traducirErrorOffering(error, 'servicio');
    this.enviando.set(false);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}
