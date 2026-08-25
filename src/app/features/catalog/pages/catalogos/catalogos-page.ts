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
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, debounceTime, filter, of } from 'rxjs';

import { CatalogoClinicoService } from '../../../../api/generated/api/catalogo-clinico.service';
import { CatalogoConceptoPageResponse } from '../../../../api/generated/model/catalogo-concepto-page-response';
import { CatalogoConceptoResponse } from '../../../../api/generated/model/catalogo-concepto-response';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import {
  CreateCatalogoConceptoRequest,
  CreateCatalogoConceptoRequestAlcanceEnum,
} from '../../../../api/generated/model/create-catalogo-concepto-request';
import { EstadoDeListado, vistaDeListado } from '../../../../shared/utils/estado-de-listado';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { Paginacion } from '../../../../shared/components/paginacion/paginacion';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { UpdateCatalogoConceptoRequest } from '../../../../api/generated/model/update-catalogo-concepto-request';
import { CausaCatalogo, traducirErrorCatalogo } from '../../models/catalogo-errors';
import {
  DatosDeTipo,
  TIPOS_DE_CATALOGO,
  TipoDeCatalogo,
  datosDeTipo,
  esGlobal,
  etiquetaDeAlcance,
} from '../../models/tipos-de-catalogo';
import {
  aCampoLocal,
  aInstanteUtc,
  formatearInstante,
  mismoInstante,
} from '../../../../shared/utils/instantes';

/** Filtro de estado del listado. Los tres valores son los del contrato. */
type FiltroEstado = 'ACTIVO' | 'INACTIVO' | 'TODOS';

/** Filtro de alcance del listado. Los tres valores son los del contrato. */
type FiltroAlcance = 'TODOS' | 'GLOBAL' | 'ORGANIZACION';

/** Operacion abierta sobre una fila. Solo una a la vez. */
type TipoAccion = 'editar' | 'baja';

/** Cuantos conceptos se piden por pagina. Por debajo del tope de 100 que el backend recorta. */
const POR_PAGINA = 20;

/**
 * Cuanto se espera antes de buscar mientras el usuario escribe.
 *
 * <p>250ms es el numero de siempre para busqueda incremental: por debajo se dispara una
 * peticion por tecla -y el catalogo global tiene miles de filas-, por encima el listado se
 * siente trabado. La etapa pide <b>busqueda incremental</b>, no un boton de buscar.
 */
const ESPERA_DE_BUSQUEDA = 250;

/** Cuantas especialidades se piden para poblar el selector del alta y del filtro. */
const TOPE_DE_ESPECIALIDADES = 100;

/**
 * Catalogo clinico: especialidades, practicas y nomencladores (M06, AKINE-02.05).
 *
 * <p>Una sola pantalla para los tres tipos, con el tipo en la URL. No son tres pantallas
 * porque las tres hacen exactamente lo mismo -buscar, dar de alta, editar, dar de baja- sobre
 * el mismo contrato: `/api/v1/catalogos/{tipo}`. Lo unico que cambia entre ellas son dos
 * cosas, y las dos estan en {@link TIPOS_DE_CATALOGO}: como se llama el concepto en pantalla
 * y si el alta exige elegir una especialidad.
 *
 * <h2>Las dos distinciones que esta pantalla no aplana</h2>
 *
 * <p><b>1. Un concepto es de la plataforma o es de este centro</b> (ADR-0021). Los dos se
 * listan juntos -asi los consulta el selector clinico- y la columna de alcance lo dice fila
 * por fila. Los de la plataforma <b>no traen acciones</b>: no es que se escondan por prolijo,
 * es que el backend responde `403` y mostrar un boton que siempre falla es peor que no
 * mostrarlo. Su camino es la solicitud de RF-M06-005, que esta linkeada arriba.
 *
 * <p><b>2. Un concepto activo no es lo mismo que uno vigente.</b> `estado` es administrativo
 * -no fue dado de baja- y `vigente` dice si ademas hoy esta dentro de su ventana. El backend
 * ya calcula `vigente`, asi que la pantalla lo muestra en vez de recalcularlo con el reloj
 * del navegador, que estaria en otra zona horaria.
 *
 * <p><b>El alta siempre crea conceptos de este centro.</b> `alcance: ORGANIZACION` va fijo y
 * no hay ningun control que lo cambie: crear uno global exige rol de plataforma, y el
 * frontend no tiene hoy ninguna forma de saber si quien mira lo tiene -no hay endpoint que lo
 * diga-. Un selector de alcance seria una opcion que para casi todos termina en `403`.
 *
 * <p><b>La `version` viaja en cada edicion.</b> Si quedo vieja el backend responde
 * `409 concurrent-modification` y no se pisa nada: la pantalla relee el concepto, actualiza la
 * base de comparacion y deja el panel abierto con lo que el usuario habia escrito.
 */
@Component({
  selector: 'app-catalogos-page',
  imports: [ReactiveFormsModule, RouterLink, PermisoDirective, Paginacion, ConfirmacionConMotivo],
  templateUrl: './catalogos-page.html',
  styleUrl: '../../catalog.css',
})
export class CatalogosPage {
  /**
   * Tipo del catalogo, tomado del segmento `:tipo` de la ruta por `withComponentInputBinding`.
   *
   * <p>Llega como `string` y no como {@link TipoDeCatalogo}: la URL la escribe el usuario y
   * puede decir cualquier cosa. La validacion es {@link datos}, que devuelve `null` y lleva la
   * pantalla al estado de tipo desconocido en vez de mandarle al backend un slug inventado.
   */
  readonly tipo = input.required<string>();

  private readonly catalogo = inject(CatalogoClinicoService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly injector = inject(Injector);

  protected readonly permisoManage = PERMISO_CONSULTORIO_MANAGE;
  protected readonly tipos = TIPOS_DE_CATALOGO;
  protected readonly etiquetaDeAlcance = etiquetaDeAlcance;
  protected readonly esGlobal = esGlobal;
  protected readonly formatearInstante = formatearInstante;

  /** Datos del tipo pedido, o `null` si el segmento de la URL no es ninguno de los tres. */
  protected readonly datos = computed<DatosDeTipo | null>(() => datosDeTipo(this.tipo()));

  protected readonly estado = signal<EstadoDeListado<CatalogoConceptoPageResponse>>({
    tipo: 'cargando',
  });

  private readonly vista = vistaDeListado<CatalogoConceptoResponse>(this.estado);

  protected readonly busqueda = signal('');
  protected readonly filtroEstado = signal<FiltroEstado>('ACTIVO');
  protected readonly filtroAlcance = signal<FiltroAlcance>('TODOS');
  protected readonly filtroEspecialidad = signal<number | null>(null);
  protected readonly paginaActual = signal(0);

  /**
   * Especialidades disponibles, para el filtro y el selector del alta de practicas.
   *
   * <p>Se piden una sola vez por visita y solo cuando el tipo es `practicas`: en las otras dos
   * pantallas no hay ningun control que las use, y traerlas igual seria una peticion por
   * visita que nadie mira.
   *
   * <p>Trae <b>solo las activas</b>: son las unicas que se pueden elegir. Una practica no
   * puede colgar de una especialidad dada de baja -el backend responde `409
   * catalogo-reference-inactive`-, asi que ofrecerlas seria ofrecer un error.
   */
  protected readonly especialidades = signal<readonly CatalogoConceptoResponse[]>([]);

  /** Fila y operacion abiertas, o `null`. Solo una a la vez. */
  protected readonly panel = signal<{ readonly id: number; readonly tipo: TipoAccion } | null>(
    null,
  );

  /** `true` mientras el panel de alta esta abierto. El alta y la edicion se excluyen. */
  protected readonly altaAbierta = signal(false);

  /**
   * Concepto tal como lo devolvio el backend la ultima vez, para el panel abierto.
   *
   * <p>Es la <b>base de comparacion</b> del `PATCH`: sin ella no se puede distinguir un campo
   * que el usuario no toco de uno que vacio a proposito.
   */
  private readonly original = signal<CatalogoConceptoResponse | null>(null);

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaCatalogo | null>(null);
  protected readonly exito = signal<string | null>(null);
  protected readonly intentos = signal(0);

  /**
   * Lo que el usuario tipea, antes del debounce. Ver {@link ESPERA_DE_BUSQUEDA}.
   *
   * <p>Cada pulsacion viaja con la <b>epoca</b> en la que se escribio. Cuando cambia el tipo o
   * el contexto la epoca avanza y lo que quedo en vuelo se descarta al salir del debounce: sin
   * eso, tipear en especialidades y cambiar a practicas antes de los 250ms termina buscando el
   * texto viejo sobre el catalogo nuevo, con el campo de busqueda ya vacio en pantalla.
   *
   * <p><b>No es un `takeUntil`.</b> Ese completa la suscripcion y no se recupera: el debounce
   * dejaria de funcionar para siempre despues del primer cambio de tipo.
   */
  private readonly tecleado = new Subject<{ readonly texto: string; readonly epoca: number }>();

  /** Avanza en cada reinicio. Ver {@link tecleado}. */
  private readonly epocaDeBusqueda = signal(0);

  protected readonly conceptosDeLaPagina = this.vista.filas;
  protected readonly totalPaginas = this.vista.totalPaginas;
  protected readonly totalConceptos = this.vista.totalElementos;
  protected readonly mensajeError = this.vista.mensajeError;
  protected readonly faltaContexto = this.vista.faltaContexto;

  protected readonly formularioAlta = this.formBuilder.nonNullable.group({
    codigo: ['', [Validators.required]],
    name: ['', [Validators.required]],
    descripcion: [''],
    // Texto y no numero: un `select` siempre entrega texto, y `''` es "todavia no elegiste".
    especialidadId: [''],
    validFrom: [''],
    validUntil: [''],
  });

  protected readonly formularioEdicion = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required]],
    descripcion: [''],
    validFrom: [''],
    validUntil: [''],
    clearValidUntil: [false],
  });

  /** Un concepto dado de baja no se edita: el formulario abierto queda deshabilitado. */
  protected readonly edicionBloqueada = computed(() => this.causaAccion() === 'concepto-inactivo');

  /** Errores que solo se resuelven releyendo el listado. */
  protected readonly hayQueRecargar = computed(() => {
    const causa = this.causaAccion();
    return causa === 'no-encontrado' || causa === 'ya-inactivo';
  });

  /** Los conflictos de unicidad se muestran EN su campo, no al pie. */
  protected readonly errorEnElNombre = computed(() => this.causaAccion() === 'nombre-tomado');
  protected readonly errorEnElCodigo = computed(() => this.causaAccion() === 'codigo-tomado');

  constructor() {
    effect(() => {
      // Dos dependencias explicitas: el tipo de la URL y el contexto de trabajo. Cualquiera de
      // los dos invalida todo lo que hay abierto -un panel de baja a medio llenar apuntando a
      // un concepto de otro tipo, o de otro centro, es peor que uno vacio-.
      this.tipo();
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.reiniciar();
        this.cargar();
        this.cargarEspecialidadesSiHacenFalta();
      });
    });

    this.tecleado
      .pipe(
        debounceTime(ESPERA_DE_BUSQUEDA),
        filter((pulsacion) => pulsacion.epoca === this.epocaDeBusqueda()),
        takeUntilDestroyed(),
      )
      .subscribe(({ texto }) => {
        this.busqueda.set(texto);
        // Volver a la primera pagina: la 3 de la busqueda anterior puede no existir en la
        // nueva, y el backend devolveria una pagina vacia que se lee como "no hay nada".
        this.paginaActual.set(0);
        this.cargar();
      });
  }

  protected cargar(): void {
    const datos = this.datos();
    if (datos === null) {
      // Tipo desconocido en la URL: no se le manda al backend un slug inventado. La plantilla
      // muestra los tres que existen.
      this.estado.set({ tipo: 'inicial' });
      return;
    }

    if (this.tenantContext.organizationId() === null) {
      // Sin centro elegido la peticion seria invalida: el backend arma la lista de duenos
      // visibles con el contexto. Se manda a elegirlo, y NUNCA se cierra la sesion por esto.
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }

    this.estado.set({ tipo: 'cargando' });

    const termino = this.busqueda().trim();
    const especialidadId = this.filtroEspecialidad();

    this.catalogo
      .searchCatalogo({
        tipo: datos.slug,
        // `undefined` y no `''`: el cliente generado omite el parametro, y el backend
        // distingue "sin filtro" de "filtra por la cadena vacia", que no matchea nada.
        q: termino === '' ? undefined : termino,
        estado: this.filtroEstado(),
        alcance: this.filtroAlcance(),
        especialidadId: especialidadId ?? undefined,
        page: this.paginaActual(),
        size: POR_PAGINA,
      })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          const traducido = traducirErrorCatalogo(respuesta);
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
    this.tecleado.next({ texto: valor, epoca: this.epocaDeBusqueda() });
  }

  protected cambiarFiltroEstado(valor: string): void {
    const elegido: FiltroEstado =
      valor === 'INACTIVO' || valor === 'TODOS' ? valor : ('ACTIVO' as const);
    this.cerrarPanel();
    this.filtroEstado.set(elegido);
    this.paginaActual.set(0);
    this.cargar();
  }

  protected cambiarFiltroAlcance(valor: string): void {
    const elegido: FiltroAlcance =
      valor === 'GLOBAL' || valor === 'ORGANIZACION' ? valor : ('TODOS' as const);
    this.cerrarPanel();
    this.filtroAlcance.set(elegido);
    this.paginaActual.set(0);
    this.cargar();
  }

  protected cambiarFiltroEspecialidad(valor: string): void {
    const id = Number(valor);
    this.cerrarPanel();
    this.filtroEspecialidad.set(valor === '' || !Number.isFinite(id) ? null : id);
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

  protected panelAbierto(id: number | undefined, tipo: TipoAccion): boolean {
    const panel = this.panel();
    return panel !== null && panel.id === id && panel.tipo === tipo;
  }

  protected abrirAlta(): void {
    this.cerrarPanel();
    this.exito.set(null);
    this.formularioAlta.enable();
    this.formularioAlta.reset({
      codigo: '',
      name: '',
      descripcion: '',
      especialidadId: '',
      validFrom: '',
      validUntil: '',
    });
    this.altaAbierta.set(true);
    afterNextRender(() => this.enfocar('#alta-catalogo-codigo'), { injector: this.injector });
  }

  protected abrirPanel(concepto: CatalogoConceptoResponse, tipo: TipoAccion): void {
    const id = concepto.id;
    if (id === undefined) {
      return;
    }

    this.cerrarPanel();
    this.exito.set(null);
    this.panel.set({ id, tipo });

    if (tipo === 'editar') {
      this.original.set(concepto);
      this.formularioEdicion.enable();
      this.formularioEdicion.reset({
        name: concepto.name ?? '',
        descripcion: concepto.descripcion ?? '',
        validFrom: aCampoLocal(concepto.validFrom),
        validUntil: aCampoLocal(concepto.validUntil),
        clearValidUntil: false,
      });
      // El foco se va con el panel: sin esto, quien navega por teclado aprieta "Editar" y el
      // formulario aparece mas abajo mientras el foco sigue en el boton.
      afterNextRender(() => this.enfocar('#editar-catalogo-name'), { injector: this.injector });
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

  protected mostrarErrorAlta(campo: 'codigo' | 'name' | 'especialidadId'): boolean {
    const control = this.formularioAlta.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected mostrarErrorEdicion(campo: 'name'): boolean {
    const control = this.formularioEdicion.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  /**
   * Da de alta un concepto <b>de este centro</b>.
   *
   * <p>`alcance: ORGANIZACION` va fijo, y el javadoc de la clase explica por que no hay
   * selector: crear uno global exige rol de plataforma y el frontend no tiene forma de saber
   * si quien mira lo tiene.
   */
  protected enviarAlta(): void {
    const datos = this.datos();
    if (datos === null || this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);

    if (datos.exigeEspecialidad && this.formularioAlta.controls.especialidadId.value === '') {
      this.formularioAlta.controls.especialidadId.setErrors({ required: true });
    }

    if (this.formularioAlta.invalid) {
      this.formularioAlta.markAllAsTouched();
      this.enfocar(
        this.formularioAlta.controls.codigo.invalid
          ? '#alta-catalogo-codigo'
          : '#alta-catalogo-name',
      );
      return;
    }

    const valores = this.formularioAlta.getRawValue();
    const cuerpo: CreateCatalogoConceptoRequest = {
      codigo: valores.codigo.trim(),
      name: valores.name.trim(),
      alcance: CreateCatalogoConceptoRequestAlcanceEnum.ORGANIZACION,
    };

    const descripcion = valores.descripcion.trim();
    if (descripcion !== '') {
      cuerpo.descripcion = descripcion;
    }

    if (datos.exigeEspecialidad) {
      const especialidad = Number(valores.especialidadId);
      if (Number.isFinite(especialidad)) {
        cuerpo.especialidadId = especialidad;
      }
    }

    const desde = aInstanteUtc(valores.validFrom);
    if (desde !== null) {
      cuerpo.validFrom = desde;
    }

    const hasta = aInstanteUtc(valores.validUntil);
    if (hasta !== null) {
      cuerpo.validUntil = hasta;
    }

    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);

    this.catalogo
      .createCatalogoConcepto({ tipo: datos.slug, createCatalogoConceptoRequest: cuerpo })
      .subscribe({
        next: () => {
          this.cerrarPanel();
          this.exito.set(
            `La ${datos.singular} quedo dada de alta para este centro. Solo la ve tu ` +
              'organizacion: los conceptos de la plataforma los mantiene AKINE.',
          );
          this.cargar();
          this.cargarEspecialidadesSiHacenFalta();
        },
        error: (error: unknown) => this.fallar(error),
      });
  }

  /** Envia solo lo que cambio. Ver {@link armarCambios}. */
  protected enviarEdicion(): void {
    const datos = this.datos();
    const panel = this.panel();
    if (datos === null || panel === null || this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);
    if (this.formularioEdicion.invalid) {
      this.formularioEdicion.markAllAsTouched();
      this.enfocar('#editar-catalogo-name');
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

    this.catalogo
      .updateCatalogoConcepto({
        tipo: datos.slug,
        conceptoId: panel.id,
        updateCatalogoConceptoRequest: cambios,
      })
      .subscribe({
        next: () => {
          this.cerrarPanel();
          this.exito.set('Los datos del concepto quedaron guardados.');
          this.cargar();
        },
        error: (error: unknown) => this.fallarEdicion(error, datos.slug, panel.id),
      });
  }

  /**
   * Da de baja el concepto del panel abierto.
   *
   * <p><b>No hay reactivacion.</b> El contrato no publica ninguna operacion que deshaga esto:
   * lo que ya quedo registrado con el concepto conserva su significado -RN-M06-002- y por eso
   * la fila sigue en el listado con su motivo.
   */
  protected enviarBaja(motivo: string): void {
    const datos = this.datos();
    const panel = this.panel();
    if (datos === null || panel === null || this.enviando()) {
      return;
    }

    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);

    this.catalogo
      .deactivateCatalogoConcepto({
        tipo: datos.slug,
        conceptoId: panel.id,
        deactivateCatalogoRequest: { reason: motivo },
      })
      .subscribe({
        next: () => {
          this.cerrarPanel();
          this.exito.set(
            'El concepto quedo dado de baja. Sigue en el listado, con su motivo, y lo que ya se ' +
              'registro con el conserva su significado. Su codigo y su nombre quedan libres.',
          );
          this.cargar();
          this.cargarEspecialidadesSiHacenFalta();
        },
        error: (error: unknown) => this.fallar(error),
      });
  }

  /**
   * Traduce el cuerpo del `PATCH` distinguiendo <b>omitido</b> de <b>cadena vacia</b>.
   *
   * <p>El contrato le da a las dos formas significados opuestos: un campo <b>ausente</b> no se
   * toca, y `descripcion: ""` <b>borra</b> la descripcion. Un formulario que mande siempre
   * todos los campos no puede expresar "no lo toques".
   *
   * <p><b>`clearValidUntil` existe porque `null` no se puede pedir omitiendo.</b> "No toques
   * el fin de vigencia" y "sacale el fin de vigencia" son dos intenciones distintas.
   */
  private armarCambios(): UpdateCatalogoConceptoRequest | null {
    const original = this.original();
    const version = original?.version;
    if (original === null || version === undefined) {
      // Sin `version` no hay edicion posible: mandar `0` pisaria el cambio de otro, que es
      // justo lo que el control de concurrencia optimista existe para impedir.
      this.errorAccion.set(
        'No pudimos leer la version de este concepto. Cerra el panel, recarga el listado y volve a intentar.',
      );
      return null;
    }

    const valores = this.formularioEdicion.getRawValue();
    const cambios: UpdateCatalogoConceptoRequest = { version };

    const nombre = valores.name.trim();
    if (nombre !== (original.name ?? '')) {
      cambios.name = nombre;
    }

    // Aca `''` puede ser deliberado: es la forma que el contrato define para BORRAR la
    // descripcion, y por eso se manda en vez de omitirse.
    const descripcion = valores.descripcion.trim();
    if (descripcion !== (original.descripcion ?? '')) {
      cambios.descripcion = descripcion;
    }

    // La comparacion es por INSTANTE y no por texto: el valor que dio la vuelta por el control
    // del navegador vuelve con milisegundos y el del backend no. Ver `mismoInstante`.
    const desde = aInstanteUtc(valores.validFrom);
    if (desde !== null && !mismoInstante(desde, original.validFrom)) {
      cambios.validFrom = desde;
    }

    if (valores.clearValidUntil) {
      cambios.clearValidUntil = true;
    } else {
      const hasta = aInstanteUtc(valores.validUntil);
      if (hasta !== null && !mismoInstante(hasta, original.validUntil)) {
        cambios.validUntil = hasta;
      }
    }

    return cambios;
  }

  /**
   * Falla de la edicion. El conflicto de concurrencia tiene tratamiento propio.
   *
   * <p>Ante `409 concurrent-modification` <b>no se pisa nada y no se cierra el panel</b>: se
   * relee el concepto, se toma esa lectura como base de comparacion nueva -con su `version`
   * nueva- y se deja en pantalla lo que el usuario habia escrito.
   */
  private fallarEdicion(error: unknown, tipo: TipoDeCatalogo, conceptoId: number): void {
    const traducido = traducirErrorCatalogo(error);
    this.enviando.set(false);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);

    if (traducido.causa === 'concepto-inactivo') {
      this.formularioEdicion.disable();
      return;
    }

    if (traducido.causa !== 'concurrencia') {
      return;
    }

    this.catalogo
      .getCatalogoConcepto({ tipo, conceptoId })
      .pipe(catchError(() => of(null)))
      .subscribe((concepto) => {
        if (concepto === null) {
          return;
        }
        this.original.set(concepto);
        this.cargar();
      });
  }

  private fallar(error: unknown): void {
    const traducido = traducirErrorCatalogo(error);
    this.enviando.set(false);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);
  }

  /**
   * Pide las especialidades activas, y solo cuando la pantalla las necesita.
   *
   * <p>Un error aca <b>no rompe la pantalla</b>: el listado principal se carga igual y el
   * selector queda vacio, con su propia explicacion en la plantilla. Tumbar el listado de
   * practicas porque no se pudo poblar un `select` seria desproporcionado.
   */
  private cargarEspecialidadesSiHacenFalta(): void {
    const datos = this.datos();
    if (datos === null || !datos.exigeEspecialidad) {
      this.especialidades.set([]);
      return;
    }
    if (this.tenantContext.organizationId() === null) {
      return;
    }

    this.catalogo
      .searchCatalogo({
        tipo: 'especialidades',
        estado: 'ACTIVO',
        alcance: 'TODOS',
        page: 0,
        size: TOPE_DE_ESPECIALIDADES,
      })
      .pipe(catchError(() => of(null)))
      .subscribe((pagina) => {
        this.especialidades.set(pagina?.content ?? []);
      });
  }

  /** Deja la pantalla como recien entrada: sin panel, sin filtros y en la primera pagina. */
  private reiniciar(): void {
    this.epocaDeBusqueda.update((valor) => valor + 1);
    this.cerrarPanel();
    this.exito.set(null);
    this.busqueda.set('');
    this.filtroEstado.set('ACTIVO');
    this.filtroAlcance.set('TODOS');
    this.filtroEspecialidad.set(null);
    this.paginaActual.set(0);
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}
