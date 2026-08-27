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
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { CreateOfertaRequest } from '../../../../api/generated/model/create-oferta-request';
import { EstadoDeListado } from '../../../../shared/utils/estado-de-listado';
import { OfertaResponse } from '../../../../api/generated/model/oferta-response';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { ServicioResponse } from '../../../../api/generated/model/servicio-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { UpdateOfertaRequest } from '../../../../api/generated/model/update-oferta-request';
import { FiltroEstado, OfferingApi } from '../../services/offering-api';
import { CausaOffering, hayQueRecargar, traducirErrorOffering } from '../../models/offering-errors';
import {
  MODALIDADES,
  etiquetaDeModalidad,
  etiquetaDeNaturaleza,
  modalidadConCapacidad,
  precioEnPalabras,
  servicioEnUnaLinea,
  servicioInactivo,
} from '../../models/etiquetas-de-offering';
import {
  SituacionDeVigencia,
  enPalabras,
  hoyLocal,
  situacionDeVigencia,
} from '../../models/situacion-de-vigencia';

/** Operacion abierta sobre una fila. Solo una a la vez. */
type TipoAccion = 'editar' | 'baja';

/**
 * Los tres valores del selector de herencia del alta. Ver el javadoc de la clase.
 *
 * <p>No es un tipo del contrato: en el contrato esos campos son `boolean | undefined`, y esto
 * es la forma de expresar el `undefined` en un control que solo entrega texto.
 */
type Heredable = '' | 'true' | 'false';

/**
 * Ofertas de la sede activa (M27, AKINE-02.06).
 *
 * <p>Es <b>la</b> pantalla que un administrador usa todos los dias (diseno 6). Una Oferta es
 * como <b>este</b> centro presta un servicio del catalogo global: con que nombre comercial, cuanto
 * dura, a que precio, para cuanta gente y desde cuando. La regla maestra 14 es exactamente esa
 * separacion, y es todo el objetivo de la etapa.
 *
 * <h2>1. Estado y vigencia no son lo mismo</h2>
 *
 * <p>Es la trampa del modulo y esta desarrollada en `models/situacion-de-vigencia.ts`, que es de
 * donde sale el texto de cada fila. En una linea: `estado` dice si la oferta fue dada de baja, y
 * `vigenteHoy` dice si ademas hoy cae dentro de su ventana, <b>calculado en la zona horaria de la
 * sede</b>. Una oferta ACTIVA que arranca el mes que viene tiene `estado = ACTIVO` y
 * `vigenteHoy = false`, y es correcto que todavia no aparezca en un selector de reserva.
 *
 * <p>Por eso esta pantalla <b>nunca recalcula la vigencia</b> con el reloj del navegador: usa
 * `vigenteHoy` tal como viene y las fechas locales solo para redactar el motivo.
 *
 * <h2>2. Omitir un campo en el alta HEREDA del servicio; no lo apaga</h2>
 *
 * <p>`modalidad`, `requiereCasoClinico` y `generaRegistroClinico` son opcionales en el alta, y
 * cuando se omiten el backend toma el valor por defecto del `Servicio`. Una casilla de tildar no
 * puede expresar eso: "sin tildar" se lee como <b>false</b>, que es lo contrario de "que decida el
 * catalogo". Por eso en el alta los tres son <b>selectores de tres opciones</b> —heredar / si /
 * no— con la herencia elegida de entrada, y la plantilla dice de donde sale el valor heredado.
 *
 * <p>En la <b>edicion</b> no hay herencia posible: la oferta ya tiene los tres valores resueltos
 * y el contrato los recibe como booleanos concretos. Ahi si son casillas.
 *
 * <p><b>`requiereProfesional` y `requiereEspacio` no heredan nada</b>, y por eso son casillas
 * tambien en el alta: el `Servicio` no publica un valor por defecto para ninguno de los dos.
 *
 * <h2>3. Los tres `limpiar*` existen porque omitir significa "no lo toques"</h2>
 *
 * <p>En la edicion, un campo ausente no se modifica. Eso deja sin forma de expresar "sacale el
 * precio", que es distinto de "dejalo como esta". El contrato lo resuelve con `limpiarPrecio`,
 * `limpiarEsquemaCobro` y `limpiarVigenciaHasta`.
 *
 * <p>En pantalla eso es una casilla <b>pegada debajo de cada campo</b>, no una lista al pie: la
 * relacion entre la casilla y su campo es lo unico que hace entendible la distincion. Al marcarla,
 * el campo correspondiente <b>se deshabilita y se vacia</b>, para que no quede en pantalla un valor
 * escrito que no se va a mandar. `limpiarPrecio` deshabilita precio <b>y</b> moneda, porque el
 * contrato los trata como un solo dato: viajan juntos o no viajan.
 *
 * <h2>4. El contexto de trabajo invalida todo</h2>
 *
 * <p>Las ofertas son de una sede. Un cambio de organizacion o de consultorio cierra los paneles
 * abiertos, limpia los filtros y recarga: un panel de baja a medio llenar apuntando a una oferta de
 * otra sede es peor que uno vacio, y es exactamente la fuga de tenant que el aislamiento evita.
 */
@Component({
  selector: 'app-ofertas-de-la-sede-page',
  imports: [ReactiveFormsModule, RouterLink, PermisoDirective, ConfirmacionConMotivo],
  templateUrl: './ofertas-de-la-sede-page.html',
  styleUrl: '../../offering.css',
})
export class OfertasDeLaSedePage {
  private readonly api = inject(OfferingApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly injector = inject(Injector);

  protected readonly permisoManage = PERMISO_CONSULTORIO_MANAGE;
  protected readonly modalidades = MODALIDADES;
  protected readonly etiquetaDeModalidad = etiquetaDeModalidad;
  protected readonly etiquetaDeNaturaleza = etiquetaDeNaturaleza;
  protected readonly modalidadConCapacidad = modalidadConCapacidad;
  protected readonly precioEnPalabras = precioEnPalabras;
  protected readonly enPalabras = enPalabras;
  protected readonly servicioEnUnaLinea = servicioEnUnaLinea;

  /**
   * El dia de hoy, en hora local, fijado al montar.
   *
   * <p>Solo se usa para <b>redactar</b> el motivo de una fila que no esta vigente. La decision de
   * si esta vigente o no la toma el backend, en la zona de la sede.
   */
  private readonly hoy = hoyLocal();

  /**
   * Estado del listado. `GET /consultorios/{cid}/ofertas` <b>no pagina</b>: el contrato devuelve
   * un array, asi que el campo `pagina` de la union de ADR-0005 contiene todas las filas.
   */
  protected readonly estado = signal<EstadoDeListado<readonly OfertaResponse[]>>({
    tipo: 'cargando',
  });

  protected readonly ofertas = computed<readonly OfertaResponse[]>(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.pagina : [];
  });

  protected readonly mensajeError = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  protected readonly faltaContexto = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' && actual.faltaContexto;
  });

  protected readonly filtroEstado = signal<FiltroEstado>('ACTIVO');
  protected readonly filtroServicio = signal<number | null>(null);

  /**
   * Servicios activos del catalogo global, para el selector del alta y el filtro.
   *
   * <p>Solo los <b>activos</b>: no se puede crear una oferta sobre un servicio dado de baja
   * (RF-M27-002), asi que ofrecerlos seria ofrecer un `409`.
   *
   * <p>El filtro por servicio, en cambio, puede necesitar uno inactivo —una oferta vieja lo sigue
   * referenciando—. Se acepta la limitacion: filtrar por un servicio que ya no esta en el catalogo
   * es raro, y traer el catalogo entero para cubrirlo agrandaria la peticion de cada visita.
   */
  /**
   * El catalogo COMPLETO, activos e inactivos.
   *
   * <p>Trae los inactivos a proposito y no por comodidad: la baja de un servicio global <b>no
   * cascadea</b>, asi que una oferta vigente puede colgar de un servicio dado de baja y su
   * nombre tiene que seguir resolviendo. Pidiendo solo los ACTIVOS, esa fila mostraba
   * "Servicio #1" —el id pelado— justo en el caso que la etapa existe para sostener.
   *
   * <p>Para OFRECER, en cambio, se usa {@link serviciosOfertables}: sobre un servicio dado de
   * baja no se pueden crear ofertas nuevas y ponerlo en el selector seria empujar al usuario a
   * un 409.
   */
  protected readonly servicios = signal<readonly ServicioResponse[]>([]);

  /** Los que hoy admiten una oferta nueva. Es lo unico que va en los dos selectores. */
  protected readonly serviciosOfertables = computed(() =>
    this.servicios().filter((servicio) => !servicioInactivo(servicio)),
  );

  /** Fila y operacion abiertas, o `null`. Solo una a la vez. */
  protected readonly panel = signal<{ readonly id: number; readonly tipo: TipoAccion } | null>(
    null,
  );

  /** `true` mientras el panel de alta esta abierto. El alta y la edicion se excluyen. */
  protected readonly altaAbierta = signal(false);

  /** Oferta tal como la devolvio el backend, para el panel abierto. Base de comparacion. */
  private readonly original = signal<OfertaResponse | null>(null);

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaOffering | null>(null);
  protected readonly exito = signal<string | null>(null);
  protected readonly intentos = signal(0);

  protected readonly hayQueRecargar = computed(() => hayQueRecargar(this.causaAccion()));

  /** `true` si el alta eligio modalidad grupal. Ver {@link marcarModalidadDelAlta}. */
  protected readonly altaEsGrupal = signal(false);

  protected readonly formularioAlta = this.formBuilder.nonNullable.group({
    servicioId: ['', [Validators.required]],
    nombreComercial: ['', [Validators.required]],
    descripcion: [''],
    // Los tres heredables: `''` es "que lo decida el servicio". Ver el javadoc de la clase.
    modalidad: [''],
    requiereCasoClinico: ['' as Heredable],
    generaRegistroClinico: ['' as Heredable],
    duracionMinutos: ['', [Validators.required]],
    capacidad: ['1', [Validators.required]],
    precioBase: [''],
    moneda: [''],
    esquemaCobro: [''],
    admiteObraSocial: [false],
    // Estos dos no heredan: el catalogo no publica un valor por defecto para ninguno.
    requiereProfesional: [true],
    requiereEspacio: [true],
    vigenciaDesde: [''],
    vigenciaHasta: [''],
  });

  protected readonly formularioEdicion = this.formBuilder.nonNullable.group({
    nombreComercial: ['', [Validators.required]],
    descripcion: [''],
    modalidad: [''],
    duracionMinutos: [''],
    capacidad: [''],
    precioBase: [''],
    moneda: [''],
    esquemaCobro: [''],
    admiteObraSocial: [false],
    requiereCasoClinico: [false],
    generaRegistroClinico: [false],
    requiereProfesional: [false],
    requiereEspacio: [false],
    vigenciaDesde: [''],
    vigenciaHasta: [''],
    limpiarPrecio: [false],
    limpiarEsquemaCobro: [false],
    limpiarVigenciaHasta: [false],
  });

  constructor() {
    effect(() => {
      // Dependencia explicita del contexto de trabajo: cambiar de sede invalida todo lo que hay
      // abierto y todo lo que hay listado.
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.reiniciar();
        this.cargar();
        this.cargarServicios();
      });
    });
  }

  protected cargar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      // Sin sede elegida la peticion no se puede ni armar: la ruta empieza en el consultorio.
      // Se manda a elegirla, y NUNCA se cierra la sesion por esto.
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }

    this.estado.set({ tipo: 'cargando' });

    this.api
      .listarOfertas(consultorioId, {
        estado: this.filtroEstado(),
        servicioId: this.filtroServicio() ?? undefined,
      })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          const traducido = traducirErrorOffering(respuesta, 'oferta');
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

  /** Situacion de vigencia ya redactada, para la columna de estado. */
  protected situacion(oferta: OfertaResponse): SituacionDeVigencia {
    return situacionDeVigencia(oferta, this.hoy);
  }

  /** Nombre del servicio del que cuelga la oferta, si el catalogo ya cargo. */
  protected nombreDelServicio(oferta: OfertaResponse): string {
    const servicio = this.servicios().find((candidato) => candidato.id === oferta.servicioId);
    return servicio === undefined ? `Servicio #${oferta.servicioId}` : servicioEnUnaLinea(servicio);
  }

  protected cambiarFiltroEstado(valor: string): void {
    const elegido: FiltroEstado =
      valor === 'INACTIVO' || valor === 'TODOS' ? valor : ('ACTIVO' as const);
    this.cerrarPanel();
    this.filtroEstado.set(elegido);
    this.cargar();
  }

  protected cambiarFiltroServicio(valor: string): void {
    const id = Number(valor);
    this.cerrarPanel();
    this.filtroServicio.set(valor === '' || !Number.isFinite(id) ? null : id);
    this.cargar();
  }

  protected panelAbierto(id: number | undefined, tipo: TipoAccion): boolean {
    const panel = this.panel();
    return panel !== null && panel.id === id && panel.tipo === tipo;
  }

  protected abrirAlta(): void {
    this.cerrarPanel();
    this.exito.set(null);
    this.formularioAlta.reset({
      servicioId: '',
      nombreComercial: '',
      descripcion: '',
      modalidad: '',
      requiereCasoClinico: '',
      generaRegistroClinico: '',
      duracionMinutos: '',
      // 1 y no vacio: la capacidad es obligatoria y el caso abrumadoramente mas frecuente es
      // una oferta individual, que admite una persona. Arrancar vacio obligaria a tipear un 1
      // en cada alta para el caso normal.
      capacidad: '1',
      precioBase: '',
      moneda: '',
      esquemaCobro: '',
      admiteObraSocial: false,
      requiereProfesional: true,
      requiereEspacio: true,
      vigenciaDesde: '',
      vigenciaHasta: '',
    });
    this.altaAbierta.set(true);
    afterNextRender(() => this.enfocar('#alta-oferta-servicio'), { injector: this.injector });
  }

  protected abrirPanel(oferta: OfertaResponse, tipo: TipoAccion): void {
    const id = oferta.id;
    if (id === undefined) {
      return;
    }

    this.cerrarPanel();
    this.exito.set(null);
    this.panel.set({ id, tipo });

    if (tipo === 'editar') {
      this.original.set(oferta);
      this.formularioEdicion.enable();
      this.formularioEdicion.reset({
        nombreComercial: oferta.nombreComercial ?? '',
        descripcion: oferta.descripcion ?? '',
        modalidad: oferta.modalidad ?? '',
        duracionMinutos: comoTexto(oferta.duracionMinutos),
        capacidad: comoTexto(oferta.capacidad),
        precioBase: comoTexto(oferta.precioBase),
        moneda: oferta.moneda ?? '',
        esquemaCobro: oferta.esquemaCobro ?? '',
        admiteObraSocial: oferta.admiteObraSocial ?? false,
        requiereCasoClinico: oferta.requiereCasoClinico ?? false,
        generaRegistroClinico: oferta.generaRegistroClinico ?? false,
        requiereProfesional: oferta.requiereProfesional ?? false,
        requiereEspacio: oferta.requiereEspacio ?? false,
        vigenciaDesde: oferta.vigenciaDesde ?? '',
        vigenciaHasta: oferta.vigenciaHasta ?? '',
        limpiarPrecio: false,
        limpiarEsquemaCobro: false,
        limpiarVigenciaHasta: false,
      });
      // El foco se va con el panel: sin esto, quien navega por teclado aprieta "Editar" y el
      // formulario aparece mas abajo mientras el foco sigue en el boton.
      afterNextRender(() => this.enfocar('#editar-oferta-nombre'), { injector: this.injector });
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

  /**
   * Sincroniza una casilla `limpiar*` con el o los campos que vacia.
   *
   * <p>Marcar "sacarle el precio" y dejar un precio escrito arriba es un estado contradictorio en
   * pantalla: el valor que se ve no es el que se va a mandar. Deshabilitar y vaciar lo hace
   * imposible en vez de explicarlo con un parrafo.
   *
   * <p>`limpiarPrecio` toca <b>los dos</b> campos: precio y moneda viajan juntos o no viajan.
   */
  protected sincronizarLimpiar(cual: 'precio' | 'esquema' | 'vigencia'): void {
    const controles = this.formularioEdicion.controls;

    if (cual === 'precio') {
      aplicarLimpieza(controles.limpiarPrecio.value, controles.precioBase, controles.moneda);
      return;
    }
    if (cual === 'esquema') {
      aplicarLimpieza(controles.limpiarEsquemaCobro.value, controles.esquemaCobro);
      return;
    }
    aplicarLimpieza(controles.limpiarVigenciaHasta.value, controles.vigenciaHasta);
  }

  protected mostrarErrorAlta(campo: 'servicioId' | 'nombreComercial' | 'duracionMinutos'): boolean {
    const control = this.formularioAlta.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected mostrarErrorEdicion(campo: 'nombreComercial'): boolean {
    const control = this.formularioEdicion.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  /**
   * Recuerda si el alta declaro modalidad grupal.
   *
   * <p>Solo cambia el <b>texto de ayuda</b> de la capacidad: el backend exige `capacidad > 1` para
   * una oferta grupal —una grupal de capacidad 1 es una individual mal rotulada— y decirlo antes de
   * mandar evita un `400` que el usuario no sabe interpretar. No valida: la autoridad sigue siendo
   * el servidor.
   */
  protected marcarModalidadDelAlta(valor: string): void {
    this.altaEsGrupal.set(valor === 'GRUPAL');
  }

  /**
   * Da de alta una oferta en la sede activa.
   *
   * <p>Lo que quedo en "heredar del servicio" <b>no viaja</b>: la ausencia del campo es lo que le
   * dice al backend que tome el default del catalogo. Mandar `false` seria apagarlo, que es otra
   * cosa.
   */
  protected enviarAlta(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null || this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);

    if (this.formularioAlta.invalid) {
      this.formularioAlta.markAllAsTouched();
      this.enfocar(
        this.formularioAlta.controls.servicioId.invalid
          ? '#alta-oferta-servicio'
          : '#alta-oferta-nombre',
      );
      return;
    }

    const valores = this.formularioAlta.getRawValue();
    const duracion = Number(valores.duracionMinutos);
    if (!Number.isFinite(duracion) || duracion <= 0) {
      this.formularioAlta.controls.duracionMinutos.setErrors({ min: true });
      this.enfocar('#alta-oferta-duracion');
      return;
    }

    // La capacidad es OBLIGATORIA en el alta y no se deriva de la modalidad: RF-M27-003 la pide
    // explicita porque un box con dos camillas puede atender de a dos en individual. Se valida
    // aca y no solo con el validador para poder enfocar el campo, igual que la duracion.
    const capacidad = Number(valores.capacidad);
    if (!Number.isFinite(capacidad) || capacidad <= 0) {
      this.formularioAlta.controls.capacidad.setErrors({ min: true });
      this.enfocar('#alta-oferta-capacidad');
      return;
    }

    const cuerpo: CreateOfertaRequest = {
      servicioId: Number(valores.servicioId),
      nombreComercial: valores.nombreComercial.trim(),
      duracionMinutos: duracion,
      capacidad,
      admiteObraSocial: valores.admiteObraSocial,
      requiereProfesional: valores.requiereProfesional,
      requiereEspacio: valores.requiereEspacio,
    };

    const descripcion = valores.descripcion.trim();
    if (descripcion !== '') {
      cuerpo.descripcion = descripcion;
    }

    if (valores.modalidad !== '') {
      cuerpo.modalidad = valores.modalidad as CreateOfertaRequest['modalidad'];
    }

    const heredaCaso = comoBooleano(valores.requiereCasoClinico);
    if (heredaCaso !== null) {
      cuerpo.requiereCasoClinico = heredaCaso;
    }

    const heredaRegistro = comoBooleano(valores.generaRegistroClinico);
    if (heredaRegistro !== null) {
      cuerpo.generaRegistroClinico = heredaRegistro;
    }

    // Precio y moneda: los dos o ninguno. El backend tiene un check que lo exige, asi que
    // mandar uno solo seria un rechazo garantizado.
    const precio = Number(valores.precioBase);
    const moneda = valores.moneda.trim().toUpperCase();
    if (valores.precioBase !== '' && Number.isFinite(precio) && moneda !== '') {
      cuerpo.precioBase = precio;
      cuerpo.moneda = moneda;
    }

    const esquema = valores.esquemaCobro.trim();
    if (esquema !== '') {
      cuerpo.esquemaCobro = esquema;
    }

    if (valores.vigenciaDesde !== '') {
      cuerpo.vigenciaDesde = valores.vigenciaDesde;
    }
    if (valores.vigenciaHasta !== '') {
      cuerpo.vigenciaHasta = valores.vigenciaHasta;
    }

    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);

    this.api.crearOferta(consultorioId, cuerpo).subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set(
          'La oferta quedo dada de alta en esta sede. Si su vigencia arranca mas adelante, va a ' +
            'figurar como activa pero todavia sin vigencia: es correcto, y empieza a ofrecerse sola ' +
            'ese dia.',
        );
        this.cargar();
      },
      error: (error: unknown) => this.fallar(error),
    });
  }

  protected enviarEdicion(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const panel = this.panel();
    if (consultorioId === null || panel === null || this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);
    if (this.formularioEdicion.invalid) {
      this.formularioEdicion.markAllAsTouched();
      this.enfocar('#editar-oferta-nombre');
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

    this.api.editarOferta(consultorioId, panel.id, cambios).subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set('Los datos de la oferta quedaron guardados.');
        this.cargar();
      },
      error: (error: unknown) => this.fallarEdicion(error),
    });
  }

  /**
   * Da de baja la oferta del panel abierto.
   *
   * <p>RN-M27-007: una oferta inactiva <b>no admite reservas nuevas y conserva sus historicos</b>.
   * Sigue en el listado con su motivo, igual que en el resto de la aplicacion: nada se borra.
   */
  protected enviarBaja(motivo: string): void {
    const consultorioId = this.tenantContext.consultorioId();
    const panel = this.panel();
    if (consultorioId === null || panel === null || this.enviando()) {
      return;
    }

    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);

    this.api.darDeBajaOferta(consultorioId, panel.id, motivo).subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set(
          'La oferta quedo dada de baja. No admite reservas nuevas, y lo que ya se reservo con ella ' +
            'conserva su significado. Su nombre comercial queda libre.',
        );
        this.cargar();
      },
      error: (error: unknown) => this.fallar(error),
    });
  }

  /**
   * Arma el cuerpo de la edicion: lo que cambio, los `limpiar*` marcados y la `expectedVersion`.
   *
   * <p>El `servicioId` no esta: es inmutable. Cambiar de servicio no es editar la oferta, es otra
   * oferta.
   *
   * <p><b>Un `limpiar*` marcado gana sobre el valor del campo</b> y ademas lo omite. Mandar los
   * dos seria pedirle al backend dos cosas contrarias en el mismo cuerpo.
   */
  private armarCambios(): UpdateOfertaRequest | null {
    const original = this.original();
    const version = original?.version;
    if (original === null || version === undefined) {
      this.errorAccion.set(
        'No pudimos leer la version de esta oferta. Cerra el panel, recarga el listado y volve a intentar.',
      );
      return null;
    }

    const valores = this.formularioEdicion.getRawValue();
    const cambios: UpdateOfertaRequest = { expectedVersion: version };

    const nombre = valores.nombreComercial.trim();
    if (nombre !== (original.nombreComercial ?? '')) {
      cambios.nombreComercial = nombre;
    }

    const descripcion = valores.descripcion.trim();
    if (descripcion !== (original.descripcion ?? '')) {
      cambios.descripcion = descripcion;
    }

    if (valores.modalidad !== (original.modalidad ?? '')) {
      cambios.modalidad = valores.modalidad as UpdateOfertaRequest['modalidad'];
    }

    const duracion = Number(valores.duracionMinutos);
    if (Number.isFinite(duracion) && duracion !== original.duracionMinutos) {
      cambios.duracionMinutos = duracion;
    }

    const capacidad = Number(valores.capacidad);
    if (
      valores.capacidad !== '' &&
      Number.isFinite(capacidad) &&
      capacidad !== original.capacidad
    ) {
      cambios.capacidad = capacidad;
    }

    if (valores.limpiarPrecio) {
      // Saca el precio Y la moneda: son un solo dato.
      cambios.limpiarPrecio = true;
    } else {
      const precio = Number(valores.precioBase);
      const moneda = valores.moneda.trim().toUpperCase();
      const cambioElPrecio = valores.precioBase !== comoTexto(original.precioBase);
      const cambioLaMoneda = moneda !== (original.moneda ?? '');
      if ((cambioElPrecio || cambioLaMoneda) && valores.precioBase !== '' && moneda !== '') {
        cambios.precioBase = precio;
        cambios.moneda = moneda;
      }
    }

    if (valores.limpiarEsquemaCobro) {
      cambios.limpiarEsquemaCobro = true;
    } else {
      const esquema = valores.esquemaCobro.trim();
      if (esquema !== (original.esquemaCobro ?? '')) {
        cambios.esquemaCobro = esquema;
      }
    }

    if (valores.admiteObraSocial !== (original.admiteObraSocial ?? false)) {
      cambios.admiteObraSocial = valores.admiteObraSocial;
    }
    if (valores.requiereCasoClinico !== (original.requiereCasoClinico ?? false)) {
      cambios.requiereCasoClinico = valores.requiereCasoClinico;
    }
    if (valores.generaRegistroClinico !== (original.generaRegistroClinico ?? false)) {
      cambios.generaRegistroClinico = valores.generaRegistroClinico;
    }
    if (valores.requiereProfesional !== (original.requiereProfesional ?? false)) {
      cambios.requiereProfesional = valores.requiereProfesional;
    }
    if (valores.requiereEspacio !== (original.requiereEspacio ?? false)) {
      cambios.requiereEspacio = valores.requiereEspacio;
    }

    if (valores.vigenciaDesde !== '' && valores.vigenciaDesde !== (original.vigenciaDesde ?? '')) {
      cambios.vigenciaDesde = valores.vigenciaDesde;
    }

    if (valores.limpiarVigenciaHasta) {
      cambios.limpiarVigenciaHasta = true;
    } else if (
      valores.vigenciaHasta !== '' &&
      valores.vigenciaHasta !== (original.vigenciaHasta ?? '')
    ) {
      cambios.vigenciaHasta = valores.vigenciaHasta;
    }

    return cambios;
  }

  /**
   * Falla de la edicion. El conflicto de concurrencia tiene tratamiento propio.
   *
   * <p>Ante `409 conflict` —que es el `type` que emite este modulo, <b>no</b>
   * `concurrent-modification`— no se pisa nada y no se cierra el panel: se relee el listado con los
   * mismos filtros, se toma esa lectura como base de comparacion nueva -con su `version` nueva- y
   * se deja en pantalla lo que el usuario habia escrito.
   */
  private fallarEdicion(error: unknown): void {
    const traducido = traducirErrorOffering(error, 'oferta');
    this.enviando.set(false);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);

    if (traducido.causa !== 'concurrencia') {
      return;
    }

    const consultorioId = this.tenantContext.consultorioId();
    const abierto = this.panel();
    if (consultorioId === null || abierto === null) {
      return;
    }

    this.api
      .listarOfertas(consultorioId, {
        estado: this.filtroEstado(),
        servicioId: this.filtroServicio() ?? undefined,
      })
      .pipe(catchError(() => of(null)))
      .subscribe((ofertas) => {
        if (ofertas === null) {
          return;
        }
        const releida = ofertas.find((oferta) => oferta.id === abierto.id);
        if (releida !== undefined) {
          this.original.set(releida);
        }
        this.estado.set({ tipo: 'listo', pagina: ofertas });
      });
  }

  private fallar(error: unknown): void {
    const traducido = traducirErrorOffering(error, 'oferta');
    this.enviando.set(false);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);
  }

  /**
   * Pide los servicios activos del catalogo.
   *
   * <p>Un error aca <b>no rompe la pantalla</b>: el listado de ofertas se carga igual y el selector
   * queda vacio con su propia explicacion. Tumbar la pantalla del dia a dia porque no se pudo
   * poblar un `select` seria desproporcionado.
   */
  private cargarServicios(): void {
    this.api
      .listarServicios({ estado: 'TODOS' })
      .pipe(catchError(() => of(null)))
      .subscribe((servicios) => this.servicios.set(servicios ?? []));
  }

  /** Deja la pantalla como recien entrada: sin panel, sin filtros. */
  private reiniciar(): void {
    this.cerrarPanel();
    this.exito.set(null);
    this.filtroEstado.set('ACTIVO');
    this.filtroServicio.set(null);
    this.altaEsGrupal.set(false);
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}

/** `'true'` / `'false'` / `''` -&gt; booleano o `null` cuando se eligio heredar. */
function comoBooleano(valor: Heredable): boolean | null {
  if (valor === 'true') {
    return true;
  }
  return valor === 'false' ? false : null;
}

/** Un numero del backend como texto para un `input`, o `''` si no vino. */
function comoTexto(valor: number | undefined | null): string {
  return valor === undefined || valor === null ? '' : String(valor);
}

/** Deshabilita y vacia los campos que una casilla `limpiar*` reemplaza, o los devuelve. */
function aplicarLimpieza(marcada: boolean, ...controles: FormControl<string>[]): void {
  for (const control of controles) {
    if (marcada) {
      control.setValue('');
      control.disable();
    } else {
      control.enable();
    }
  }
}
