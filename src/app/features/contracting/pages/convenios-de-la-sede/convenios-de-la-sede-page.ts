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
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { ConvenioResponse } from '../../../../api/generated/model/convenio-response';
import { CreateConvenioRequest } from '../../../../api/generated/model/create-convenio-request';
import { EstadoDeListado } from '../../../../shared/utils/estado-de-listado';
import { FinanciadorResponse } from '../../../../api/generated/model/financiador-response';
import { PERMISO_CONVENIO_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { PlanCoberturaResponse } from '../../../../api/generated/model/plan-cobertura-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { UpdateConvenioRequest } from '../../../../api/generated/model/update-convenio-request';
import { ContractingApi, FiltroEstado } from '../../services/contracting-api';
import { ConveniosApi } from '../../services/convenios-api';
import {
  CausaContracting,
  hayQueRecargar,
  traducirErrorContracting,
} from '../../models/contracting-errors';
import {
  MODALIDADES_DE_CONVENIO,
  enUnaLinea,
  etiquetaDeModalidad,
} from '../../models/etiquetas-de-contracting';
import {
  SituacionDeVigencia,
  hoyLocal,
  situacionDeVigencia,
  ventanaEnPalabras,
} from '../../models/vigencia-de-contracting';
import { textoRequerido } from '../../../../shared/validators/texto-requerido';
import { numeroDeclarado } from '../../../../shared/utils/numero-declarado';

/** Operacion abierta sobre una fila. Solo una a la vez. */
type TipoAccion = 'editar' | 'baja';

/**
 * Convenios de la sede activa (M16, AKINE-03.05).
 *
 * <p>Un convenio es <b>lo que esta sede acordo con un plan de un financiador</b>: desde cuando,
 * hasta cuando, como se liquida y que requisitos administrativos exige. De el cuelgan los
 * aranceles, que son los precios por practica.
 *
 * <h2>1. El convenio es de la SEDE; el financiador y el plan son de la organizacion</h2>
 *
 * <p>RN-M16-001. Dos sedes de la misma organizacion pueden tener aranceles distintos para la misma
 * practica bajo el mismo plan, y eso es el caso normal de una cadena. Por eso esta pantalla
 * trabaja siempre contra la sede del contexto y se recarga entera cuando el contexto cambia: un
 * listado de convenios de otra sede es la fuga de tenant mas silenciosa que puede tener el modulo,
 * porque los datos <b>parecen</b> correctos.
 *
 * <h2>2. El plan es obligatorio, y eso es lo que hace determinista al arancel</h2>
 *
 * <p>No hay convenios "para todo el financiador". Un convenio sin plan seria una segunda regla
 * candidata para la misma consulta y obligaria a inventar una prioridad que los desempate; con el
 * plan obligatorio, <b>no puede haber dos candidatas</b>, y por eso el resultado de la resolucion
 * es unico y explicable. El selector de plan se puebla al elegir financiador, y solo con los
 * planes de ese financiador: el backend rechaza cualquier otra combinacion.
 *
 * <h2>3. Dos convenios del mismo alcance no pueden solaparse (RN-M16-002)</h2>
 *
 * <p>Es la regla central de la etapa y llega como `409 convenio-solapado`. Lo importante es que
 * <b>recargar no la resuelve</b>: la salida es cerrar la vigencia del convenio que ya esta y
 * recien despues cargar el nuevo. Renovar es el caso normal, y si la pantalla no lo explica el
 * usuario da de baja el convenio anterior — que es terminal y no era lo que queria.
 *
 * <h2>4. Cerrar la vigencia es el PUT; dar de baja es el DELETE</h2>
 *
 * <p>Igual que en los planes. Y la baja <b>no cascadea a los aranceles y no se bloquea por
 * tenerlos</b>: dejan de resolver porque su convenio dejo de resolver. Libera el codigo y el
 * periodo, asi que se puede volver a firmar con el mismo plan para las mismas fechas.
 *
 * <h2>5. Los requisitos se declaran y nadie los interpreta todavia</h2>
 *
 * <p>`requiereOrden`, `requiereAutorizacion`, `requiereCredencial` y `limiteSesionesMensual`
 * viajan en la resolucion del arancel y <b>no bloquean nada</b>: quien los aplique es M17, que no
 * existe. La pantalla los guarda y los muestra, y lo dice — prometer que el sistema los hace
 * cumplir seria mentir sobre un control que hoy hace un humano.
 */
@Component({
  selector: 'app-convenios-de-la-sede-page',
  imports: [ReactiveFormsModule, RouterLink, PermisoDirective, ConfirmacionConMotivo],
  templateUrl: './convenios-de-la-sede-page.html',
  styleUrl: '../../contracting.css',
})
export class ConveniosDeLaSedePage {
  private readonly api = inject(ConveniosApi);
  private readonly catalogo = inject(ContractingApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly injector = inject(Injector);

  protected readonly permisoManage = PERMISO_CONVENIO_MANAGE;
  protected readonly modalidades = MODALIDADES_DE_CONVENIO;
  protected readonly etiquetaDeModalidad = etiquetaDeModalidad;
  protected readonly enUnaLinea = enUnaLinea;
  protected readonly ventanaEnPalabras = ventanaEnPalabras;

  /** Dia contra el que el backend calcula `vigente`. No filtra: ver el javadoc de la fachada. */
  protected readonly fecha = signal(hoyLocal());

  protected readonly estado = signal<EstadoDeListado<readonly ConvenioResponse[]>>({
    tipo: 'cargando',
  });

  protected readonly convenios = computed<readonly ConvenioResponse[]>(() => {
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

  /**
   * Financiadores <b>activos</b> de la organizacion, para el selector del alta y para nombrar la
   * columna del listado.
   *
   * <p>Solo los activos: un financiador dado de baja no admite convenios nuevos —409— asi que
   * ofrecerlo seria ofrecer un rechazo. La contracara es que un convenio viejo puede colgar de un
   * financiador dado de baja y su nombre no resolveria; se acepta y la fila degrada al id, porque
   * traer el catalogo completo en cada visita para cubrir ese caso es peor negocio.
   */
  protected readonly financiadores = signal<readonly FinanciadorResponse[]>([]);

  /** Planes del financiador elegido en el alta. Se piden al elegirlo, no antes. */
  protected readonly planes = signal<readonly PlanCoberturaResponse[]>([]);

  protected readonly filtroEstado = signal<FiltroEstado>('ACTIVO');

  protected readonly panel = signal<{ readonly id: number; readonly tipo: TipoAccion } | null>(
    null,
  );
  protected readonly altaAbierta = signal(false);
  private readonly original = signal<ConvenioResponse | null>(null);

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaContracting | null>(null);
  protected readonly exito = signal<string | null>(null);
  protected readonly intentos = signal(0);

  protected readonly hayQueRecargar = computed(() => hayQueRecargar(this.causaAccion()));

  /**
   * El alta pide moneda; la edicion no.
   *
   * <p>No es una omision: `UpdateConvenioRequest` no la declara. La moneda es la del convenio y
   * <b>los aranceles la heredan</b>, asi que cambiarla despues reinterpretaria todos los importes
   * ya cargados sin tocar ni un numero. Es la misma clase de inmutabilidad que la del codigo.
   */
  protected readonly formularioAlta = this.formBuilder.nonNullable.group({
    codigo: ['', [textoRequerido]],
    nombre: ['', [textoRequerido]],
    financiadorId: ['', [Validators.required]],
    planId: ['', [Validators.required]],
    modalidad: ['', [Validators.required]],
    moneda: ['', [Validators.required]],
    vigenciaDesde: ['', [Validators.required]],
    vigenciaHasta: [''],
    limiteSesionesMensual: [''],
    documentacionRequerida: [''],
    observaciones: [''],
    requiereOrden: [false],
    requiereAutorizacion: [false],
    requiereCredencial: [false],
  });

  /** Sin codigo, sin financiador, sin plan y sin moneda: son la identidad del convenio. */
  protected readonly formularioEdicion = this.formBuilder.nonNullable.group({
    nombre: ['', [textoRequerido]],
    modalidad: [''],
    vigenciaDesde: [''],
    vigenciaHasta: [''],
    limiteSesionesMensual: [''],
    documentacionRequerida: [''],
    observaciones: [''],
    requiereOrden: [false],
    requiereAutorizacion: [false],
    requiereCredencial: [false],
  });

  constructor() {
    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.reiniciar();
        this.cargar();
        this.cargarFinanciadores();
      });
    });
  }

  protected cargar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      // Sin sede elegida la peticion no se puede ni armar: la ruta empieza en el consultorio. Se
      // manda a elegirla, y NUNCA se cierra la sesion por esto.
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }

    this.estado.set({ tipo: 'cargando' });

    this.api
      .listarConvenios(consultorioId, { estado: this.filtroEstado(), fecha: this.fecha() })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          const traducido = traducirErrorContracting(respuesta, 'convenio');
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

  protected situacion(convenio: ConvenioResponse): SituacionDeVigencia {
    return situacionDeVigencia(convenio, this.fecha(), 'convenio');
  }

  /** Nombre del financiador del convenio, o su id si el catalogo no lo trajo. */
  protected nombreDelFinanciador(convenio: ConvenioResponse): string {
    const ficha = this.financiadores().find((candidato) => candidato.id === convenio.financiadorId);
    return ficha === undefined ? `Financiador #${convenio.financiadorId}` : enUnaLinea(ficha);
  }

  protected cambiarFecha(valor: string): void {
    if (valor === '') {
      return;
    }
    this.cerrarPanel();
    this.fecha.set(valor);
    this.cargar();
  }

  protected cambiarFiltroEstado(valor: string): void {
    const elegido: FiltroEstado =
      valor === 'INACTIVO' || valor === 'TODOS' ? valor : ('ACTIVO' as const);
    this.cerrarPanel();
    this.filtroEstado.set(elegido);
    this.cargar();
  }

  protected panelAbierto(id: number | undefined, tipo: TipoAccion): boolean {
    const panel = this.panel();
    return panel !== null && panel.id === id && panel.tipo === tipo;
  }

  /**
   * Carga los planes del financiador elegido y <b>limpia el plan que hubiera seleccionado</b>.
   *
   * <p>Sin ese reset, cambiar de financiador con un plan ya elegido deja en el formulario un
   * `planId` que pertenece al financiador anterior: el `select` se repuebla, el valor viejo deja
   * de existir entre sus opciones, y el backend recibe una combinacion invalida. El sintoma seria
   * un `400` sobre un formulario que en pantalla se ve bien.
   */
  protected elegirFinanciador(valor: string): void {
    this.formularioAlta.controls.planId.setValue('');
    this.planes.set([]);

    const id = Number(valor);
    if (valor === '' || !Number.isFinite(id)) {
      return;
    }

    this.catalogo
      .listarPlanes(id, { estado: 'ACTIVO', fecha: this.fecha() })
      .pipe(catchError(() => of(null)))
      .subscribe((planes) => this.planes.set(planes ?? []));
  }

  protected abrirAlta(): void {
    this.cerrarPanel();
    this.exito.set(null);
    this.planes.set([]);
    this.formularioAlta.reset({
      codigo: '',
      nombre: '',
      financiadorId: '',
      planId: '',
      modalidad: '',
      moneda: '',
      vigenciaDesde: hoyLocal(),
      vigenciaHasta: '',
      limiteSesionesMensual: '',
      documentacionRequerida: '',
      observaciones: '',
      requiereOrden: false,
      requiereAutorizacion: false,
      requiereCredencial: false,
    });
    this.altaAbierta.set(true);
    afterNextRender(() => this.enfocar('#alta-convenio-financiador'), { injector: this.injector });
  }

  protected abrirPanel(convenio: ConvenioResponse, tipo: TipoAccion): void {
    const id = convenio.id;
    if (id === undefined) {
      return;
    }

    this.cerrarPanel();
    this.exito.set(null);
    this.panel.set({ id, tipo });

    if (tipo === 'editar') {
      this.original.set(convenio);
      this.formularioEdicion.reset({
        nombre: convenio.nombre ?? '',
        modalidad: convenio.modalidad ?? '',
        vigenciaDesde: convenio.vigenciaDesde ?? '',
        vigenciaHasta: convenio.vigenciaHasta ?? '',
        limiteSesionesMensual: comoTexto(convenio.limiteSesionesMensual),
        documentacionRequerida: convenio.documentacionRequerida ?? '',
        observaciones: convenio.observaciones ?? '',
        requiereOrden: convenio.requiereOrden ?? false,
        requiereAutorizacion: convenio.requiereAutorizacion ?? false,
        requiereCredencial: convenio.requiereCredencial ?? false,
      });
      afterNextRender(() => this.enfocar('#editar-convenio-nombre'), { injector: this.injector });
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
    campo:
      'codigo' | 'nombre' | 'financiadorId' | 'planId' | 'modalidad' | 'moneda' | 'vigenciaDesde',
  ): boolean {
    const control = this.formularioAlta.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected mostrarErrorEdicion(campo: 'nombre'): boolean {
    const control = this.formularioEdicion.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected enviarAlta(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null || this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);

    if (this.formularioAlta.invalid) {
      this.formularioAlta.markAllAsTouched();
      this.enfocar(
        this.formularioAlta.controls.financiadorId.invalid
          ? '#alta-convenio-financiador'
          : '#alta-convenio-plan',
      );
      return;
    }

    const valores = this.formularioAlta.getRawValue();
    const cuerpo: CreateConvenioRequest = {
      codigo: valores.codigo.trim(),
      nombre: valores.nombre.trim(),
      financiadorId: Number(valores.financiadorId),
      planId: Number(valores.planId),
      modalidad: valores.modalidad as CreateConvenioRequest['modalidad'],
      moneda: valores.moneda.trim().toUpperCase(),
      vigenciaDesde: valores.vigenciaDesde,
      requiereOrden: valores.requiereOrden,
      requiereAutorizacion: valores.requiereAutorizacion,
      requiereCredencial: valores.requiereCredencial,
    };

    if (valores.vigenciaHasta !== '') {
      cuerpo.vigenciaHasta = valores.vigenciaHasta;
    }
    const tope = numeroDeclarado(valores.limiteSesionesMensual);
    if (tope !== null) {
      cuerpo.limiteSesionesMensual = tope;
    }
    const documentacion = valores.documentacionRequerida.trim();
    if (documentacion !== '') {
      cuerpo.documentacionRequerida = documentacion;
    }
    const observaciones = valores.observaciones.trim();
    if (observaciones !== '') {
      cuerpo.observaciones = observaciones;
    }

    this.empezarEnvio();

    this.api.crearConvenio(consultorioId, cuerpo).subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set(
          'El convenio quedo firmado en esta sede. Todavia no resuelve ningun precio: para eso hay ' +
            'que cargarle los aranceles de cada practica, desde el boton Aranceles de su fila.',
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
      this.enfocar('#editar-convenio-nombre');
      return;
    }

    const cambios = this.armarCambios();
    if (cambios === null) {
      return;
    }

    this.empezarEnvio();

    this.api.editarConvenio(consultorioId, panel.id, cambios).subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set(
          'Los datos del convenio quedaron guardados. Si le pusiste fecha de fin, el convenio sigue ' +
            'ACTIVO: cerrar la vigencia no es darlo de baja, y ese ultimo dia todavia resuelve.',
        );
        this.cargar();
      },
      error: (error: unknown) => this.fallarEdicion(error),
    });
  }

  protected enviarBaja(motivo: string): void {
    const consultorioId = this.tenantContext.consultorioId();
    const panel = this.panel();
    if (consultorioId === null || panel === null || this.enviando()) {
      return;
    }

    this.empezarEnvio();

    this.api.darDeBajaConvenio(consultorioId, panel.id, { reason: motivo }).subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set(
          'El convenio quedo dado de baja. Sus aranceles conservan sus filas y dejan de resolver ' +
            'porque su convenio dejo de resolver; lo ya liquidado bajo el sigue explicandose con su ' +
            'copia congelada. El codigo y el periodo quedan libres para firmar otro convenio con el ' +
            'mismo plan.',
        );
        this.cargar();
      },
      error: (error: unknown) => this.fallar(error),
    });
  }

  /**
   * Arma el cuerpo de la edicion: lo que cambio y la `expectedVersion`.
   *
   * <p>Ni el codigo, ni la sede, ni el financiador, ni el plan, ni la moneda estan: son la
   * identidad del convenio y lo que ya se liquido bajo el los referencia. El contrato tampoco los
   * acepta, asi que la pantalla no puede ofrecerlos aunque quisiera.
   *
   * <p><b>Poner una fecha en "vigente hasta" es cerrar la vigencia</b>, y puede producir un
   * `409 convenio-solapado` igual que el alta: estirar el fin de un convenio hasta pisar al
   * siguiente es exactamente lo que RN-M16-002 prohibe.
   */
  private armarCambios(): UpdateConvenioRequest | null {
    const original = this.original();
    const version = original?.version;
    if (original === null || version === undefined) {
      this.errorAccion.set(
        'No pudimos leer la version de este convenio. Cerra el panel, recarga el listado y volve a ' +
          'intentar.',
      );
      return null;
    }

    const valores = this.formularioEdicion.getRawValue();
    const cambios: UpdateConvenioRequest = { expectedVersion: version };

    const nombre = valores.nombre.trim();
    if (nombre !== (original.nombre ?? '')) {
      cambios.nombre = nombre;
    }
    if (valores.modalidad !== (original.modalidad ?? '')) {
      cambios.modalidad = valores.modalidad as UpdateConvenioRequest['modalidad'];
    }
    if (valores.vigenciaDesde !== '' && valores.vigenciaDesde !== (original.vigenciaDesde ?? '')) {
      cambios.vigenciaDesde = valores.vigenciaDesde;
    }
    if (valores.vigenciaHasta !== '' && valores.vigenciaHasta !== (original.vigenciaHasta ?? '')) {
      cambios.vigenciaHasta = valores.vigenciaHasta;
    }

    const tope = numeroDeclarado(valores.limiteSesionesMensual);
    if (tope !== null && tope !== original.limiteSesionesMensual) {
      cambios.limiteSesionesMensual = tope;
    }

    const documentacion = valores.documentacionRequerida.trim();
    if (documentacion !== (original.documentacionRequerida ?? '')) {
      cambios.documentacionRequerida = documentacion;
    }
    const observaciones = valores.observaciones.trim();
    if (observaciones !== (original.observaciones ?? '')) {
      cambios.observaciones = observaciones;
    }

    if (valores.requiereOrden !== (original.requiereOrden ?? false)) {
      cambios.requiereOrden = valores.requiereOrden;
    }
    if (valores.requiereAutorizacion !== (original.requiereAutorizacion ?? false)) {
      cambios.requiereAutorizacion = valores.requiereAutorizacion;
    }
    if (valores.requiereCredencial !== (original.requiereCredencial ?? false)) {
      cambios.requiereCredencial = valores.requiereCredencial;
    }

    return cambios;
  }

  private fallarEdicion(error: unknown): void {
    const traducido = traducirErrorContracting(error, 'convenio');
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
      .listarConvenios(consultorioId, { estado: this.filtroEstado(), fecha: this.fecha() })
      .pipe(catchError(() => of(null)))
      .subscribe((convenios) => {
        if (convenios === null) {
          return;
        }
        const releido = convenios.find((convenio) => convenio.id === abierto.id);
        if (releido !== undefined) {
          this.original.set(releido);
        }
        this.estado.set({ tipo: 'listo', pagina: convenios });
      });
  }

  private fallar(error: unknown): void {
    const traducido = traducirErrorContracting(error, 'convenio');
    this.enviando.set(false);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);
  }

  private empezarEnvio(): void {
    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);
  }

  /**
   * Financiadores activos, para el selector y para nombrar las filas.
   *
   * <p>Un error aca <b>no rompe la pantalla</b>: el listado de convenios se carga igual y las
   * filas degradan al id. Tumbar la pantalla del dia a dia porque no se pudo poblar un `select`
   * seria desproporcionado.
   */
  private cargarFinanciadores(): void {
    this.catalogo
      .listarFinanciadores({ estado: 'ACTIVO' })
      .pipe(catchError(() => of(null)))
      .subscribe((financiadores) => this.financiadores.set(financiadores ?? []));
  }

  private reiniciar(): void {
    this.cerrarPanel();
    this.exito.set(null);
    this.filtroEstado.set('ACTIVO');
    this.fecha.set(hoyLocal());
    this.financiadores.set([]);
    this.planes.set([]);
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}

/** Un numero del backend como texto para un `input`, o `''` si no vino. */
function comoTexto(valor: number | undefined | null): string {
  return valor === undefined || valor === null ? '' : String(valor);
}
