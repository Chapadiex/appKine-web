import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, forkJoin } from 'rxjs';

import { AdjuntoResponse } from '../../../../api/generated/model/adjunto-response';
import { AdjuntosApi } from '../../services/adjuntos-api';
import { AutorizacionResponse } from '../../../../api/generated/model/autorizacion-response';
import { CatalogoConceptoResponse } from '../../../../api/generated/model/catalogo-concepto-response';
import { CoberturaResponse } from '../../../../api/generated/model/cobertura-response';
import { CoberturasApi } from '../../services/coberturas-api';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { CreateAutorizacionRequest } from '../../../../api/generated/model/create-autorizacion-request';
import { CreateOrdenRequest } from '../../../../api/generated/model/create-orden-request';
import { ElegibilidadResponse } from '../../../../api/generated/model/elegibilidad-response';
import { OrdenResponse } from '../../../../api/generated/model/orden-response';
import { PERMISO_PACIENTE_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { PersonApi } from '../../services/person-api';
import { PersonaResponse } from '../../../../api/generated/model/persona-response';
import { ResolverAutorizacionRequest } from '../../../../api/generated/model/resolver-autorizacion-request';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { UpdateAutorizacionRequest } from '../../../../api/generated/model/update-autorizacion-request';
import { UpdateOrdenRequest } from '../../../../api/generated/model/update-orden-request';
import { AccionDeAutorizacion, DocumentosApi } from '../../services/documentos-api';
import { CausaPersona, hayQueRecargar, traducirErrorPersona } from '../../models/person-errors';
import { coberturaEnUnaLinea } from '../../models/etiquetas-de-cobertura';
import { fechaEnPalabras } from '../../models/etiquetas-de-ficha';
import { nombreCompleto } from '../../models/etiquetas-de-person';
import { numeroDeclarado } from '../../../../shared/utils/numero-declarado';
import {
  admiteResolucion,
  autorizacionInactiva,
  avisoDeVencimiento,
  emisorEnPalabras,
  estadoDeAutorizacion,
  habilitaEnPalabras,
  motivoDeElegibilidad,
  ordenInactiva,
  requisitoEnPalabras,
  saldoEnPalabras,
  situacionDeOrden,
  vigenciaDeDocumento,
} from '../../models/etiquetas-de-documento';
import { textoRequerido } from '../../../../shared/validators/texto-requerido';

/** Panel abierto sobre una orden. Solo uno a la vez en toda la pantalla. */
type PanelDeOrden = 'editar' | 'baja' | 'documento';

/** Panel abierto sobre una autorizacion. */
type PanelDeAutorizacion = 'editar' | 'baja' | 'documento' | 'resolver';

/** Que panel esta abierto, sobre que fila y de cual de las dos entidades. */
interface PanelAbierto {
  readonly entidad: 'orden' | 'autorizacion';
  readonly id: number;
  readonly tipo: PanelDeOrden | PanelDeAutorizacion;
}

/**
 * Ordenes medicas, autorizaciones y elegibilidad administrativa (M17, AKINE-03.06).
 *
 * <p>Las tres cosas viven en una sola pantalla porque responden <b>una</b> pregunta del mostrador:
 * que le falta a este paciente para que le atiendan lo que viene a hacerse. Una autorizacion se
 * pide contra una orden, y la elegibilidad es la consulta que las junta; separarlas obligaria a ir
 * y volver entre pantallas para contestar algo que se pregunta una vez.
 *
 * <h2>1. Cuatro estados que no son el mismo, y la pantalla no los funde</h2>
 *
 * <ul>
 *   <li><b>Vencida</b> se calcula al leer. Una orden vencida <b>sigue activa</b>, se sigue listando
 *       y se sigue pudiendo corregir: "un documento vencido no desaparece".</li>
 *   <li><b>Agotada</b> es sin saldo. Tampoco cambia el estado de la autorizacion.</li>
 *   <li><b>Rechazada</b> es la respuesta del financiador: la autorizacion queda <b>viva</b> y
 *       explica por que no se pudo atender.</li>
 *   <li><b>Dada de baja</b> es "esto nunca debio cargarse".</li>
 * </ul>
 *
 * <p>Fundirlas en un unico "estado" hace que alguien de de baja un papel valido, o que vuelva a
 * pedir una autorizacion que ya tiene.
 *
 * <h2>2. Resolver recibe una ACCION, y aprobar puede recortar lo pedido</h2>
 *
 * <p>La pantalla no ofrece "cambiar el estado a": ofrece <b>aprobar, observar y rechazar</b>. Con
 * un estado destino, el cliente podria construir cualquier transicion imaginable y el servidor
 * tendria que rechazarlas por semantica.
 *
 * <p>Al aprobar, la cantidad y las vigencias del formulario <b>pisan</b> a las declaradas al
 * cargar: es la autorizacion parcial —el financiador otorga seis sesiones donde se pidieron
 * veinte—. Por eso el panel de aprobacion trae los tres campos precargados con lo pedido, y no un
 * simple "confirmar": si estuvieran vacios, aprobar una parcial exigiria una edicion posterior que
 * nadie se va a acordar de hacer.
 *
 * <p><b>APROBADA y RECHAZADA son terminales.</b> No se ofrecen acciones sobre ellas: corregir una
 * decision tomada es dar de baja y cargar otra.
 *
 * <h2>3. Vincular un documento no sube nada</h2>
 *
 * <p>El selector lista los adjuntos <b>que ya tiene esta persona</b>. Subir es otra pantalla, con
 * su validacion por bytes y su descarga autorizada: un segundo mecanismo de carga seria una segunda
 * superficie de ataque. Elegir la opcion vacia <b>desvincula</b>, que es lo que hace falta cuando
 * se vinculo el escaneo equivocado.
 *
 * <h2>4. La elegibilidad con la lista vacia es el caso normal</h2>
 *
 * <p>Cobertura particular, sin convenio, o con convenio pero sin arancel para esa practica: en las
 * tres, "no falta ningun papel" es la respuesta correcta y la pantalla explica <b>cual</b> de las
 * tres es. Sin esa explicacion, un "todo en orden" sobre un paciente sin convenio se lee como que
 * el sistema no verifico nada, y alguien sale a buscar la autorizacion igual.
 *
 * <p>Y un requisito faltante <b>no es un error</b>: el backend responde 200 con `elegible = false`
 * y el detalle. La pantalla lo muestra como una lista de tareas, no como un cartel rojo.
 *
 * <h2>5. El caso que rompe la pantalla</h2>
 *
 * <p>Una persona sin perfil de paciente: las dos altas responden 409 y el mensaje nombra la salida.
 * Y un paciente sin ninguna cobertura cargada: no hay contra que autorizar ni contra que consultar
 * elegibilidad, asi que la pantalla lo dice y enlaza a coberturas en vez de mostrar dos selectores
 * vacios.
 */
@Component({
  selector: 'app-ordenes-y-autorizaciones-page',
  imports: [ReactiveFormsModule, RouterLink, ConfirmacionConMotivo, PermisoDirective],
  templateUrl: './ordenes-y-autorizaciones-page.html',
  styleUrl: '../../person.css',
})
export class OrdenesYAutorizacionesPage {
  private readonly api = inject(DocumentosApi);
  private readonly coberturasApi = inject(CoberturasApi);
  private readonly adjuntosApi = inject(AdjuntosApi);
  private readonly personas = inject(PersonApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly formBuilder = inject(FormBuilder);

  readonly personaId = input.required<string>();

  protected readonly permisoManage = PERMISO_PACIENTE_MANAGE;

  protected readonly nombreCompleto = nombreCompleto;
  protected readonly coberturaEnUnaLinea = coberturaEnUnaLinea;
  protected readonly fechaEnPalabras = fechaEnPalabras;
  protected readonly situacionDeOrden = situacionDeOrden;
  protected readonly ordenInactiva = ordenInactiva;
  protected readonly emisorEnPalabras = emisorEnPalabras;
  protected readonly vigenciaDeDocumento = vigenciaDeDocumento;
  protected readonly avisoDeVencimiento = avisoDeVencimiento;
  protected readonly estadoDeAutorizacion = estadoDeAutorizacion;
  protected readonly autorizacionInactiva = autorizacionInactiva;
  protected readonly admiteResolucion = admiteResolucion;
  protected readonly saldoEnPalabras = saldoEnPalabras;
  protected readonly habilitaEnPalabras = habilitaEnPalabras;
  protected readonly requisitoEnPalabras = requisitoEnPalabras;
  protected readonly motivoDeElegibilidad = motivoDeElegibilidad;

  protected readonly cargando = signal(true);
  protected readonly errorDeCarga = signal<string | null>(null);
  protected readonly faltaContexto = signal(false);

  protected readonly persona = signal<PersonaResponse | null>(null);
  protected readonly ordenes = signal<readonly OrdenResponse[]>([]);
  protected readonly autorizaciones = signal<readonly AutorizacionResponse[]>([]);
  protected readonly coberturas = signal<readonly CoberturaResponse[]>([]);
  protected readonly practicas = signal<readonly CatalogoConceptoResponse[]>([]);
  protected readonly adjuntos = signal<readonly AdjuntoResponse[]>([]);

  protected readonly elegibilidad = signal<ElegibilidadResponse | null>(null);
  protected readonly consultandoElegibilidad = signal(false);

  protected readonly panel = signal<PanelAbierto | null>(null);
  protected readonly altaDeOrden = signal(false);
  protected readonly altaDeAutorizacion = signal(false);

  /** Fila que el backend senalo en un 409 de solapamiento, para resaltarla. */
  protected readonly senalada = signal<number | null>(null);

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaPersona | null>(null);
  protected readonly exito = signal<string | null>(null);

  protected readonly hayQueRecargar = computed(() => hayQueRecargar(this.causaAccion()));
  protected readonly faltaPerfil = computed(() => this.causaAccion() === 'sin-perfil-paciente');

  /**
   * `true` cuando no hay ninguna cobertura contra la que autorizar ni consultar.
   *
   * <p>Sin coberturas, los dos selectores quedarian vacios y el operador no tendria como saber por
   * que. La pantalla lo dice y enlaza a donde se resuelve.
   */
  protected readonly sinCoberturas = computed(() => this.coberturas().length === 0);

  protected readonly rutaFicha = computed(() => `/pacientes/${this.personaId()}` as const);
  protected readonly rutaCoberturas = computed(
    () => `/pacientes/${this.personaId()}/coberturas` as const,
  );
  protected readonly rutaDocumentos = computed(
    () => `/pacientes/${this.personaId()}/documentos` as const,
  );

  protected readonly formularioOrden = this.formBuilder.nonNullable.group({
    // El emisor es texto libre y obligatorio: el medico que firma es externo al centro y no esta
    // en ningun catalogo del tenant.
    profesionalEmisor: ['', [textoRequerido]],
    matriculaEmisor: [''],
    numero: [''],
    fechaEmision: ['', [Validators.required]],
    vigenciaDesde: [''],
    vigenciaHasta: [''],
    sesionesPrescriptas: [''],
    coberturaId: [''],
    indicacion: [''],
    observaciones: [''],
  });

  protected readonly formularioEdicionDeOrden = this.formBuilder.nonNullable.group({
    profesionalEmisor: [''],
    matriculaEmisor: [''],
    numero: [''],
    fechaEmision: [''],
    vigenciaDesde: [''],
    vigenciaHasta: [''],
    sesionesPrescriptas: [''],
    indicacion: [''],
    observaciones: [''],
  });

  protected readonly formularioAutorizacion = this.formBuilder.nonNullable.group({
    numero: ['', [textoRequerido]],
    coberturaId: ['', [Validators.required]],
    practicaId: ['', [Validators.required]],
    ordenMedicaId: [''],
    cantidadAutorizada: [''],
    vigenciaDesde: ['', [Validators.required]],
    vigenciaHasta: [''],
    // PENDIENTE o APROBADA, nada mas: OBSERVADA y RECHAZADA son la respuesta a un pedido y se
    // aplican resolviendo.
    estadoInicial: ['PENDIENTE'],
    observaciones: [''],
  });

  protected readonly formularioEdicionDeAutorizacion = this.formBuilder.nonNullable.group({
    numero: [''],
    ordenMedicaId: [''],
    cantidadAutorizada: [''],
    vigenciaDesde: [''],
    vigenciaHasta: [''],
    observaciones: [''],
  });

  protected readonly formularioResolucion = this.formBuilder.nonNullable.group({
    accion: ['APROBAR'],
    cantidadAutorizada: [''],
    vigenciaDesde: [''],
    vigenciaHasta: [''],
    motivo: [''],
  });

  protected readonly formularioDocumento = this.formBuilder.nonNullable.group({
    adjuntoId: [''],
  });

  protected readonly formularioElegibilidad = this.formBuilder.nonNullable.group({
    coberturaId: ['', [Validators.required]],
    practicaId: ['', [Validators.required]],
    fecha: [''],
  });

  /** Fila original del panel abierto. Da la version para el control optimista. */
  private readonly originalOrden = signal<OrdenResponse | null>(null);
  private readonly originalAutorizacion = signal<AutorizacionResponse | null>(null);

  constructor() {
    effect(() => {
      this.personaId();
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.reiniciar();
        this.cargar();
      });
    });
  }

  // -------------------------------------------------------------------------------------
  // Carga
  // -------------------------------------------------------------------------------------

  /**
   * Las cinco lecturas van en paralelo, y el fallo de una sola tira la pantalla.
   *
   * <p>Es deliberado y es lo contrario de lo que hace la pantalla de documentos con la ficha. Aca
   * las cinco son necesarias para decidir: sin las coberturas no se puede autorizar, sin las
   * practicas no se puede consultar elegibilidad y sin los adjuntos no se puede vincular. Mostrar
   * la pantalla con la mitad de los selectores vacios seria peor que un error, porque el operador
   * intentaria trabajar y no entenderia por que no puede.
   */
  protected cargar(): void {
    const id = this.identificador();
    if (id === null) {
      this.cargando.set(false);
      this.errorDeCarga.set('La direccion no identifica a ninguna persona del padron.');
      return;
    }

    this.cargando.set(true);
    this.errorDeCarga.set(null);
    this.faltaContexto.set(false);

    forkJoin({
      persona: this.personas.ver(id),
      ordenes: this.api.listarOrdenes(id, 'TODAS', undefined),
      autorizaciones: this.api.listarAutorizaciones(id, 'TODAS', undefined),
      coberturas: this.coberturasApi.listar(id, 'ACTIVA', undefined),
      practicas: this.api.practicas(),
      adjuntos: this.adjuntosApi.listar({
        personaId: id,
        filtro: 'VIGENTES',
        pagina: 0,
        tamano: 100,
      }),
    }).subscribe({
      next: (respuesta) => {
        this.persona.set(respuesta.persona);
        this.ordenes.set(respuesta.ordenes);
        this.autorizaciones.set(respuesta.autorizaciones);
        this.coberturas.set(respuesta.coberturas);
        this.practicas.set(respuesta.practicas.content ?? []);
        this.adjuntos.set(respuesta.adjuntos.content ?? []);
        this.cargando.set(false);
      },
      error: (error: unknown) => {
        const traducido = traducirErrorPersona(error);
        this.cargando.set(false);
        this.errorDeCarga.set(traducido.mensaje);
        this.faltaContexto.set(traducido.causa === 'sin-contexto');
      },
    });
  }

  // -------------------------------------------------------------------------------------
  // Ordenes
  // -------------------------------------------------------------------------------------

  protected abrirAltaDeOrden(): void {
    this.cerrarPaneles();
    this.formularioOrden.reset();
    this.altaDeOrden.set(true);
  }

  protected enviarOrden(): void {
    const id = this.identificador();
    if (id === null || this.formularioOrden.invalid) {
      this.formularioOrden.markAllAsTouched();
      return;
    }

    const valores = this.formularioOrden.getRawValue();
    const cuerpo: CreateOrdenRequest = {
      profesionalEmisor: valores.profesionalEmisor.trim(),
      matriculaEmisor: vacioEsUndefined(valores.matriculaEmisor),
      numero: vacioEsUndefined(valores.numero),
      fechaEmision: valores.fechaEmision,
      // Omitida, el backend usa la fecha de emision. Mandarla igual a la emision no cambia nada,
      // pero declararla vacia si: seria una vigencia sin inicio.
      vigenciaDesde: vacioEsUndefined(valores.vigenciaDesde),
      vigenciaHasta: vacioEsUndefined(valores.vigenciaHasta),
      sesionesPrescriptas: numeroEsUndefined(valores.sesionesPrescriptas),
      coberturaId: numeroEsUndefined(valores.coberturaId),
      indicacion: vacioEsUndefined(valores.indicacion),
      observaciones: vacioEsUndefined(valores.observaciones),
    };

    this.enviando.set(true);
    this.limpiarAvisos();

    this.api.crearOrden(id, cuerpo).subscribe({
      next: () => this.terminar('Se registro la orden medica.'),
      error: (error: unknown) => this.fallo(error),
    });
  }

  protected abrirEdicionDeOrden(orden: OrdenResponse): void {
    const id = orden.id;
    if (id === undefined) {
      return;
    }
    this.cerrarPaneles();
    this.originalOrden.set(orden);
    this.formularioEdicionDeOrden.reset({
      profesionalEmisor: orden.profesionalEmisor ?? '',
      matriculaEmisor: orden.matriculaEmisor ?? '',
      numero: orden.numero ?? '',
      fechaEmision: orden.fechaEmision ?? '',
      vigenciaDesde: orden.vigenciaDesde ?? '',
      vigenciaHasta: orden.vigenciaHasta ?? '',
      sesionesPrescriptas: orden.sesionesPrescriptas?.toString() ?? '',
      indicacion: orden.indicacion ?? '',
      observaciones: orden.observaciones ?? '',
    });
    this.panel.set({ entidad: 'orden', id, tipo: 'editar' });
  }

  protected enviarEdicionDeOrden(): void {
    const personaId = this.identificador();
    const original = this.originalOrden();
    if (personaId === null || original === null || original.id === undefined) {
      return;
    }

    const valores = this.formularioEdicionDeOrden.getRawValue();
    const cuerpo: UpdateOrdenRequest = {
      profesionalEmisor: vacioEsUndefined(valores.profesionalEmisor),
      matriculaEmisor: vacioEsUndefined(valores.matriculaEmisor),
      numero: vacioEsUndefined(valores.numero),
      fechaEmision: vacioEsUndefined(valores.fechaEmision),
      vigenciaDesde: vacioEsUndefined(valores.vigenciaDesde),
      vigenciaHasta: vacioEsUndefined(valores.vigenciaHasta),
      sesionesPrescriptas: numeroEsUndefined(valores.sesionesPrescriptas),
      indicacion: vacioEsUndefined(valores.indicacion),
      observaciones: vacioEsUndefined(valores.observaciones),
      expectedVersion: original.version ?? 0,
    };

    this.enviando.set(true);
    this.limpiarAvisos();

    this.api.editarOrden(personaId, original.id, cuerpo).subscribe({
      next: () => this.terminar('Se corrigio la orden medica.'),
      error: (error: unknown) => this.fallo(error),
    });
  }

  protected abrirBajaDeOrden(orden: OrdenResponse): void {
    this.abrirPanel('orden', orden.id, 'baja');
  }

  protected confirmarBajaDeOrden(motivo: string): void {
    const personaId = this.identificador();
    const abierto = this.panel();
    if (personaId === null || abierto === null) {
      return;
    }

    this.enviando.set(true);
    this.limpiarAvisos();

    this.api.darDeBajaOrden(personaId, abierto.id, motivo).subscribe({
      next: () =>
        this.terminar(
          'La orden quedo dada de baja. No se borro: sigue siendo consultable, y las ' +
            'autorizaciones que la referencian quedan intactas.',
        ),
      error: (error: unknown) => this.fallo(error),
    });
  }

  // -------------------------------------------------------------------------------------
  // Autorizaciones
  // -------------------------------------------------------------------------------------

  protected abrirAltaDeAutorizacion(): void {
    this.cerrarPaneles();
    this.formularioAutorizacion.reset({ estadoInicial: 'PENDIENTE' });
    this.altaDeAutorizacion.set(true);
  }

  protected enviarAutorizacion(): void {
    const id = this.identificador();
    if (id === null || this.formularioAutorizacion.invalid) {
      this.formularioAutorizacion.markAllAsTouched();
      return;
    }

    const valores = this.formularioAutorizacion.getRawValue();
    const cuerpo: CreateAutorizacionRequest = {
      numero: valores.numero.trim(),
      coberturaId: Number(valores.coberturaId),
      practicaId: Number(valores.practicaId),
      ordenMedicaId: numeroEsUndefined(valores.ordenMedicaId),
      cantidadAutorizada: numeroEsUndefined(valores.cantidadAutorizada),
      vigenciaDesde: valores.vigenciaDesde,
      vigenciaHasta: vacioEsUndefined(valores.vigenciaHasta),
      estadoInicial: valores.estadoInicial as CreateAutorizacionRequest['estadoInicial'],
      observaciones: vacioEsUndefined(valores.observaciones),
    };

    this.enviando.set(true);
    this.limpiarAvisos();

    this.api.crearAutorizacion(id, cuerpo).subscribe({
      next: () => this.terminar('Se registro la autorizacion.'),
      error: (error: unknown) => this.fallo(error),
    });
  }

  protected abrirEdicionDeAutorizacion(autorizacion: AutorizacionResponse): void {
    const id = autorizacion.id;
    if (id === undefined) {
      return;
    }
    this.cerrarPaneles();
    this.originalAutorizacion.set(autorizacion);
    this.formularioEdicionDeAutorizacion.reset({
      numero: autorizacion.numero ?? '',
      ordenMedicaId: autorizacion.ordenMedicaId?.toString() ?? '',
      cantidadAutorizada: autorizacion.cantidadAutorizada?.toString() ?? '',
      vigenciaDesde: autorizacion.vigenciaDesde ?? '',
      vigenciaHasta: autorizacion.vigenciaHasta ?? '',
      observaciones: autorizacion.observaciones ?? '',
    });
    this.panel.set({ entidad: 'autorizacion', id, tipo: 'editar' });
  }

  protected enviarEdicionDeAutorizacion(): void {
    const personaId = this.identificador();
    const original = this.originalAutorizacion();
    if (personaId === null || original === null || original.id === undefined) {
      return;
    }

    const valores = this.formularioEdicionDeAutorizacion.getRawValue();
    const cuerpo: UpdateAutorizacionRequest = {
      numero: vacioEsUndefined(valores.numero),
      ordenMedicaId: numeroEsUndefined(valores.ordenMedicaId),
      cantidadAutorizada: numeroEsUndefined(valores.cantidadAutorizada),
      vigenciaDesde: vacioEsUndefined(valores.vigenciaDesde),
      vigenciaHasta: vacioEsUndefined(valores.vigenciaHasta),
      observaciones: vacioEsUndefined(valores.observaciones),
      expectedVersion: original.version ?? 0,
    };

    this.enviando.set(true);
    this.limpiarAvisos();

    this.api.editarAutorizacion(personaId, original.id, cuerpo).subscribe({
      next: () => this.terminar('Se corrigio la autorizacion.'),
      error: (error: unknown) => this.fallo(error),
    });
  }

  /**
   * Abre el panel de resolucion con lo pedido ya cargado.
   *
   * <p>Los tres campos vienen precargados con lo que se declaro al pedir, y no vacios: al aprobar,
   * lo que viaje <b>pisa</b> lo declarado. Con los campos en blanco, aprobar tal cual lo pedido
   * exigiria tipearlo de nuevo, y aprobar una parcial —seis de veinte— seria una edicion posterior
   * que nadie se va a acordar de hacer.
   */
  protected abrirResolucion(autorizacion: AutorizacionResponse): void {
    const id = autorizacion.id;
    if (id === undefined) {
      return;
    }
    this.cerrarPaneles();
    this.originalAutorizacion.set(autorizacion);
    this.formularioResolucion.reset({
      accion: 'APROBAR',
      cantidadAutorizada: autorizacion.cantidadAutorizada?.toString() ?? '',
      vigenciaDesde: autorizacion.vigenciaDesde ?? '',
      vigenciaHasta: autorizacion.vigenciaHasta ?? '',
      motivo: '',
    });
    this.panel.set({ entidad: 'autorizacion', id, tipo: 'resolver' });
  }

  protected enviarResolucion(): void {
    const personaId = this.identificador();
    const original = this.originalAutorizacion();
    if (personaId === null || original === null || original.id === undefined) {
      return;
    }

    const valores = this.formularioResolucion.getRawValue();
    const accion = valores.accion as AccionDeAutorizacion;
    const motivo = valores.motivo.trim();

    if (accion !== 'APROBAR' && motivo === '') {
      // El motivo es obligatorio al observar y al rechazar: sin el, el mostrador no sabe que
      // corregir. Se corta aca para senalar el campo en vez de gastar un 400 del servidor.
      this.errorAccion.set('Al observar o rechazar hay que declarar el motivo.');
      return;
    }

    const cuerpo: ResolverAutorizacionRequest = {
      accion: accion as ResolverAutorizacionRequest['accion'],
      // Los tres solo viajan al aprobar: son la autorizacion parcial, y no significan nada en un
      // rechazo ni en una observacion.
      cantidadAutorizada:
        accion === 'APROBAR' ? numeroEsUndefined(valores.cantidadAutorizada) : undefined,
      vigenciaDesde: accion === 'APROBAR' ? vacioEsUndefined(valores.vigenciaDesde) : undefined,
      vigenciaHasta: accion === 'APROBAR' ? vacioEsUndefined(valores.vigenciaHasta) : undefined,
      motivo: motivo === '' ? undefined : motivo,
      expectedVersion: original.version ?? 0,
    };

    this.enviando.set(true);
    this.limpiarAvisos();

    this.api.resolver(personaId, original.id, cuerpo).subscribe({
      next: () =>
        this.terminar(
          accion === 'APROBAR'
            ? 'La autorizacion quedo aprobada. Aprobada es terminal: si el financiador cambia de ' +
                'opinion, se da de baja esta y se carga otra.'
            : 'Se registro la respuesta del financiador.',
        ),
      error: (error: unknown) => this.fallo(error),
    });
  }

  protected abrirBajaDeAutorizacion(autorizacion: AutorizacionResponse): void {
    this.abrirPanel('autorizacion', autorizacion.id, 'baja');
  }

  protected confirmarBajaDeAutorizacion(motivo: string): void {
    const personaId = this.identificador();
    const abierto = this.panel();
    if (personaId === null || abierto === null) {
      return;
    }

    this.enviando.set(true);
    this.limpiarAvisos();

    this.api.darDeBajaAutorizacion(personaId, abierto.id, motivo).subscribe({
      next: () =>
        this.terminar(
          'La autorizacion quedo dada de baja. No se borro, y su numero se puede volver a usar.',
        ),
      error: (error: unknown) => this.fallo(error),
    });
  }

  // -------------------------------------------------------------------------------------
  // Vinculo de documentos
  // -------------------------------------------------------------------------------------

  protected abrirDocumentoDeOrden(orden: OrdenResponse): void {
    this.cerrarPaneles();
    this.formularioDocumento.reset({ adjuntoId: orden.adjuntoId?.toString() ?? '' });
    this.abrirPanel('orden', orden.id, 'documento');
  }

  protected abrirDocumentoDeAutorizacion(autorizacion: AutorizacionResponse): void {
    this.cerrarPaneles();
    this.formularioDocumento.reset({ adjuntoId: autorizacion.adjuntoId?.toString() ?? '' });
    this.abrirPanel('autorizacion', autorizacion.id, 'documento');
  }

  /**
   * Guarda el vinculo, o lo quita.
   *
   * <p>La opcion vacia del selector <b>desvincula</b>: es lo que hace falta cuando se vinculo el
   * escaneo equivocado, y hacerlo asi evita tener que dar de baja el documento entero.
   */
  protected enviarDocumento(): void {
    const personaId = this.identificador();
    const abierto = this.panel();
    if (personaId === null || abierto === null) {
      return;
    }

    const adjuntoId = numeroEsUndefined(this.formularioDocumento.getRawValue().adjuntoId);
    this.enviando.set(true);
    this.limpiarAvisos();

    // `Observable<unknown>` y no la union de los dos tipos de respuesta: una union de dos
    // `Observable<T>` distintos no es invocable —ninguna de sus firmas de `subscribe` es
    // compatible con la otra— y no hace falta, porque lo unico que se hace con la respuesta es
    // recargar la pantalla entera.
    const peticion: Observable<unknown> =
      abierto.entidad === 'orden'
        ? this.api.vincularDocumentoDeOrden(personaId, abierto.id, adjuntoId)
        : this.api.vincularDocumentoDeAutorizacion(personaId, abierto.id, adjuntoId);

    peticion.subscribe({
      next: () =>
        this.terminar(
          adjuntoId === undefined
            ? 'Se quito el vinculo con el documento. El archivo sigue estando en la ficha.'
            : 'Se vinculo el documento.',
        ),
      error: (error: unknown) => this.fallo(error),
    });
  }

  // -------------------------------------------------------------------------------------
  // Elegibilidad
  // -------------------------------------------------------------------------------------

  protected consultarElegibilidad(): void {
    const id = this.identificador();
    if (id === null || this.formularioElegibilidad.invalid) {
      this.formularioElegibilidad.markAllAsTouched();
      return;
    }

    const valores = this.formularioElegibilidad.getRawValue();
    this.consultandoElegibilidad.set(true);
    this.limpiarAvisos();
    this.elegibilidad.set(null);

    this.api
      .elegibilidad(
        id,
        Number(valores.coberturaId),
        Number(valores.practicaId),
        vacioEsUndefined(valores.fecha),
      )
      .subscribe({
        next: (respuesta) => {
          this.consultandoElegibilidad.set(false);
          this.elegibilidad.set(respuesta);
        },
        error: (error: unknown) => {
          this.consultandoElegibilidad.set(false);
          this.fallo(error);
        },
      });
  }

  // -------------------------------------------------------------------------------------
  // Paneles y apoyo
  // -------------------------------------------------------------------------------------

  protected cerrarPaneles(): void {
    this.panel.set(null);
    this.altaDeOrden.set(false);
    this.altaDeAutorizacion.set(false);
    this.originalOrden.set(null);
    this.originalAutorizacion.set(null);
    this.limpiarAvisos();
  }

  protected esPanelDeOrden(orden: OrdenResponse, tipo: PanelDeOrden): boolean {
    const abierto = this.panel();
    return (
      abierto !== null &&
      abierto.entidad === 'orden' &&
      orden.id !== undefined &&
      abierto.id === orden.id &&
      abierto.tipo === tipo
    );
  }

  protected esPanelDeAutorizacion(
    autorizacion: AutorizacionResponse,
    tipo: PanelDeAutorizacion,
  ): boolean {
    const abierto = this.panel();
    return (
      abierto !== null &&
      abierto.entidad === 'autorizacion' &&
      autorizacion.id !== undefined &&
      abierto.id === autorizacion.id &&
      abierto.tipo === tipo
    );
  }

  protected estaSenalada(autorizacion: AutorizacionResponse): boolean {
    return autorizacion.id !== undefined && this.senalada() === autorizacion.id;
  }

  /** `true` cuando la accion elegida en el panel de resolucion exige motivo. */
  protected resolucionExigeMotivo(): boolean {
    return this.formularioResolucion.getRawValue().accion !== 'APROBAR';
  }

  protected mostrarErrorDeOrden(campo: string): boolean {
    return invalidoYTocado(this.formularioOrden.get(campo));
  }

  protected mostrarErrorDeAutorizacion(campo: string): boolean {
    return invalidoYTocado(this.formularioAutorizacion.get(campo));
  }

  protected mostrarErrorDeElegibilidad(campo: string): boolean {
    return invalidoYTocado(this.formularioElegibilidad.get(campo));
  }

  /** Como se llama una orden en un selector: su numero, o quien la firmo y cuando. */
  protected rotuloDeOrden(orden: OrdenResponse): string {
    const numero = orden.numero;
    const base = numero === undefined || numero === '' ? emisorEnPalabras(orden) : `N° ${numero}`;
    return `${base} — ${fechaEnPalabras(orden.fechaEmision)}`;
  }

  private abrirPanel(
    entidad: 'orden' | 'autorizacion',
    id: number | undefined,
    tipo: PanelDeOrden | PanelDeAutorizacion,
  ): void {
    if (id === undefined) {
      return;
    }
    this.limpiarAvisos();
    this.panel.set({ entidad, id, tipo });
  }

  private identificador(): number | null {
    const crudo = Number(this.personaId());
    return Number.isInteger(crudo) && crudo > 0 ? crudo : null;
  }

  private terminar(mensaje: string): void {
    this.enviando.set(false);
    this.panel.set(null);
    this.altaDeOrden.set(false);
    this.altaDeAutorizacion.set(false);
    this.exito.set(mensaje);
    // Se relee todo: una autorizacion aprobada cambia su saldo y su veredicto, y una orden dada de
    // baja cambia lo que los selectores de vinculo pueden ofrecer.
    this.cargar();
  }

  private fallo(error: unknown): void {
    this.enviando.set(false);
    const traducido = traducirErrorPersona(error);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);
    this.senalada.set(traducido.referenciaId);
  }

  private limpiarAvisos(): void {
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);
    this.senalada.set(null);
  }

  private reiniciar(): void {
    this.cerrarPaneles();
    this.persona.set(null);
    this.ordenes.set([]);
    this.autorizaciones.set([]);
    this.coberturas.set([]);
    this.practicas.set([]);
    this.adjuntos.set([]);
    this.elegibilidad.set(null);
  }
}

/** `''` significa "no lo mandes", no "mandalo vacio". */
function vacioEsUndefined(valor: string): string | undefined {
  const limpio = valor.trim();
  return limpio === '' ? undefined : limpio;
}

/**
 * Un campo numerico opcional, validado.
 *
 * <p>Devuelve `undefined` ante lo vacio <b>y ante lo que no es un numero</b>: un `Number('abc')` da
 * `NaN`, que serializado a JSON viaja como `null` y produce un 400 que habla de un tipo de dato.
 *
 * <p><b>Recibe `string | number` y eso no es defensivo: es lo que pasa de verdad.</b> Un
 * `<input type="number">` atado a un `FormControl` inicializado en `''` no devuelve un string: el
 * `NumberValueAccessor` de Angular <b>convierte el valor a `number`</b> al escribir, mientras
 * TypeScript sigue creyendo que el control es de tipo `string` porque asi lo dedujo del valor
 * inicial. El tipo miente, compila, y `valor.trim()` explota en runtime con "trim is not a
 * function" — que fue exactamente el defecto que este comentario documenta. Vale para todos los
 * campos numericos de esta pantalla: cantidades y sesiones prescriptas.
 *
 * <p><b>La logica ya no vive aca.</b> Esta pantalla la habia resuelto por su cuenta antes de que
 * existiera `shared/utils/numero-declarado`, y dos copias de la misma regla se desincronizan:
 * cuando se arreglo el `null` del `NumberValueAccessor` en las otras cuatro pantallas, esta no se
 * entero. Ahora delega, y lo unico propio que queda es el `undefined` que el cuerpo necesita —el
 * contrato pide <b>omitir</b> el campo, y un `null` explicito no es lo mismo que omitirlo—.
 */
function numeroEsUndefined(valor: unknown): number | undefined {
  return numeroDeclarado(valor) ?? undefined;
}

function invalidoYTocado(control: { invalid: boolean; touched: boolean; dirty: boolean } | null) {
  return control !== null && control.invalid && (control.touched || control.dirty);
}
