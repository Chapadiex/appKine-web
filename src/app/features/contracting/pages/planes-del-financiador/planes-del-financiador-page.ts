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
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { catchError, of } from 'rxjs';

import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { CreatePlanCoberturaRequest } from '../../../../api/generated/model/create-plan-cobertura-request';
import { EstadoDeListado } from '../../../../shared/utils/estado-de-listado';
import { FinanciadorResponse } from '../../../../api/generated/model/financiador-response';
import { PERMISO_CONVENIO_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { PlanCoberturaResponse } from '../../../../api/generated/model/plan-cobertura-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { UpdatePlanCoberturaRequest } from '../../../../api/generated/model/update-plan-cobertura-request';
import { ContractingApi, FiltroEstado } from '../../services/contracting-api';
import {
  CausaContracting,
  hayQueRecargar,
  traducirErrorContracting,
} from '../../models/contracting-errors';
import { etiquetaDeTipo, importeEnPalabras } from '../../models/etiquetas-de-contracting';
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
 * Planes de cobertura de un financiador (M15, AKINE-03.03).
 *
 * <p>Un plan es <b>lo que se elige</b>: la cobertura de un paciente apunta a un plan y el convenio
 * de una sede se firma contra un plan, nunca contra el financiador entero. Por eso un financiador
 * sin planes no sirve para nada todavia, y por eso esta pantalla existe aparte del catalogo en vez
 * de ser una columna mas.
 *
 * <h2>1. Ciclo de vida y vigencia son dos cosas, y hay una operacion para cada una</h2>
 *
 * <p>Es la trampa del modulo, desarrollada en `models/vigencia-de-contracting.ts`. En una linea:
 * `estado` dice si el plan fue dado de baja y `vigente` dice si en la fecha consultada se puede
 * elegir. Un plan ACTIVO con la vigencia vencida es el caso borde que el registro de cierre nombra
 * —"plan sin nuevas altas pero con pacientes vigentes"— y es un estado <b>correcto</b>.
 *
 * <p>De ahi salen las dos operaciones que la pantalla no puede confundir:
 *
 * <ul>
 *   <li><b>Cerrar la vigencia</b> es el <b>PUT</b>, mandando `vigenciaHasta`. El plan queda ACTIVO
 *       y consultable, y solo deja de ofrecerse para selecciones posteriores a esa fecha. Se
 *       deshace editando.</li>
 *   <li><b>Dar de baja</b> es el <b>DELETE</b>, exige motivo y <b>no se deshace</b>: no hay
 *       reactivacion.</li>
 * </ul>
 *
 * <p>Por eso el fin de vigencia es un campo del formulario de edicion y no un boton "cerrar", y
 * por eso el panel de baja advierte que es terminal.
 *
 * <h2>2. `vigenciaHasta` es INCLUSIVA, y aca no es como en las ofertas</h2>
 *
 * <p>El ultimo dia <b>todavia cuenta</b>. `features/offering` usa la convencion contraria para la
 * oferta, asi que la pantalla lo escribe con la palabra "inclusive" cada vez que nombra una
 * fecha de fin: sin eso, el usuario no tiene forma de saber cual de las dos rige y va a suponer la
 * que conoce.
 *
 * <h2>3. Copago y moneda viajan juntos, y `null` no es cero</h2>
 *
 * <p>Un importe sin moneda no es un importe y el backend lo rechaza con un `400`. Y un plan
 * <b>sin copago declarado</b> no es un plan con copago cero: uno significa "no lo sabemos", el
 * otro "el paciente no paga nada". La tabla los muestra distinto porque en el mostrador son
 * decisiones distintas.
 *
 * <h2>4. Un financiador dado de baja no admite planes nuevos, pero sus planes se siguen editando</h2>
 *
 * <p>Es la contracara de que la baja no cascadee. La pantalla esconde el boton de alta —seria
 * ofrecer un `409 financiador-inactivo` garantizado— y explica por que, pero deja editar los
 * planes existentes: dejar de trabajar con una obra social no puede tener como efecto que sus
 * planes queden congelados con un error de tipeo.
 */
@Component({
  selector: 'app-planes-del-financiador-page',
  imports: [ReactiveFormsModule, RouterLink, PermisoDirective, ConfirmacionConMotivo],
  templateUrl: './planes-del-financiador-page.html',
  styleUrl: '../../contracting.css',
})
export class PlanesDelFinanciadorPage {
  private readonly api = inject(ContractingApi);
  private readonly ruta = inject(ActivatedRoute);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly injector = inject(Injector);

  protected readonly permisoManage = PERMISO_CONVENIO_MANAGE;
  protected readonly etiquetaDeTipo = etiquetaDeTipo;
  protected readonly importeEnPalabras = importeEnPalabras;
  protected readonly ventanaEnPalabras = ventanaEnPalabras;

  protected readonly financiadorId = Number(this.ruta.snapshot.paramMap.get('financiadorId'));

  /**
   * Fecha contra la que el backend calcula `vigente`.
   *
   * <p>Arranca en hoy y es <b>un filtro de verdad</b>, no un adorno: preguntar "que planes se
   * podian elegir en marzo" es exactamente lo que hace falta para explicar una cobertura vieja, y
   * es la unica forma de hacerlo sin recalcular nada en el navegador.
   */
  protected readonly fecha = signal(hoyLocal());

  protected readonly estado = signal<EstadoDeListado<readonly PlanCoberturaResponse[]>>({
    tipo: 'cargando',
  });

  protected readonly planes = computed<readonly PlanCoberturaResponse[]>(() => {
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
   * El financiador del que cuelgan estos planes.
   *
   * <p>Se lee aparte porque la URL solo trae su id, y una pantalla titulada "Planes de #10" no le
   * dice nada a nadie. Un fallo en esta lectura <b>no rompe la pantalla</b>: los planes se cargan
   * igual y el encabezado degrada al id. Tumbar el listado porque no se pudo poner un nombre en un
   * titulo seria desproporcionado.
   */
  protected readonly financiador = signal<FinanciadorResponse | null>(null);

  /** `true` cuando el financiador esta dado de baja: no admite planes nuevos (409). */
  protected readonly financiadorInactivo = computed(
    () => this.financiador()?.estado === 'INACTIVO',
  );

  protected readonly filtroEstado = signal<FiltroEstado>('ACTIVO');

  protected readonly panel = signal<{ readonly id: number; readonly tipo: TipoAccion } | null>(
    null,
  );
  protected readonly altaAbierta = signal(false);
  private readonly original = signal<PlanCoberturaResponse | null>(null);

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaContracting | null>(null);
  protected readonly exito = signal<string | null>(null);
  protected readonly intentos = signal(0);

  protected readonly hayQueRecargar = computed(() => hayQueRecargar(this.causaAccion()));

  protected readonly formularioAlta = this.formBuilder.nonNullable.group({
    codigo: ['', [textoRequerido]],
    nombre: ['', [textoRequerido]],
    descripcion: [''],
    vigenciaDesde: ['', [Validators.required]],
    vigenciaHasta: [''],
    copago: [''],
    moneda: [''],
    requiereAutorizacion: [false],
    requiereCredencial: [false],
  });

  /** Sin `codigo`: es inmutable, igual que el del financiador. */
  protected readonly formularioEdicion = this.formBuilder.nonNullable.group({
    nombre: ['', [textoRequerido]],
    descripcion: [''],
    vigenciaDesde: [''],
    vigenciaHasta: [''],
    copago: [''],
    moneda: [''],
    requiereAutorizacion: [false],
    requiereCredencial: [false],
  });

  constructor() {
    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.reiniciar();
        this.cargar();
        this.cargarFinanciador();
      });
    });
  }

  protected cargar(): void {
    this.estado.set({ tipo: 'cargando' });

    this.api
      .listarPlanes(this.financiadorId, { estado: this.filtroEstado(), fecha: this.fecha() })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          const traducido = traducirErrorContracting(respuesta, 'plan');
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
  protected situacion(plan: PlanCoberturaResponse): SituacionDeVigencia {
    return situacionDeVigencia(plan, this.fecha(), 'plan');
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

  protected abrirAlta(): void {
    this.cerrarPanel();
    this.exito.set(null);
    this.formularioAlta.reset({
      codigo: '',
      nombre: '',
      descripcion: '',
      // Arranca hoy y no vacio: el caso abrumadoramente mas frecuente es un plan que empieza a
      // ofrecerse ya. Dejarlo vacio obligaria a tipear la fecha de hoy en cada alta.
      vigenciaDesde: hoyLocal(),
      vigenciaHasta: '',
      copago: '',
      moneda: '',
      requiereAutorizacion: false,
      requiereCredencial: false,
    });
    this.altaAbierta.set(true);
    afterNextRender(() => this.enfocar('#alta-plan-codigo'), { injector: this.injector });
  }

  protected abrirPanel(plan: PlanCoberturaResponse, tipo: TipoAccion): void {
    const id = plan.id;
    if (id === undefined) {
      return;
    }

    this.cerrarPanel();
    this.exito.set(null);
    this.panel.set({ id, tipo });

    if (tipo === 'editar') {
      this.original.set(plan);
      this.formularioEdicion.reset({
        nombre: plan.nombre ?? '',
        descripcion: plan.descripcion ?? '',
        vigenciaDesde: plan.vigenciaDesde ?? '',
        vigenciaHasta: plan.vigenciaHasta ?? '',
        copago: comoTexto(plan.copago),
        moneda: plan.moneda ?? '',
        requiereAutorizacion: plan.requiereAutorizacion ?? false,
        requiereCredencial: plan.requiereCredencial ?? false,
      });
      afterNextRender(() => this.enfocar('#editar-plan-nombre'), { injector: this.injector });
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

  protected mostrarErrorAlta(campo: 'codigo' | 'nombre' | 'vigenciaDesde'): boolean {
    const control = this.formularioAlta.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected mostrarErrorEdicion(campo: 'nombre'): boolean {
    const control = this.formularioEdicion.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  /**
   * Da de alta un plan bajo el financiador.
   *
   * <p><b>Copago y moneda: los dos o ninguno.</b> Se valida antes de mandar para poder senalar el
   * campo, no porque el backend no lo haga: lo hace, con un `400`, y esa es la autoridad. Mandar
   * uno solo seria un rechazo garantizado.
   */
  protected enviarAlta(): void {
    if (this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);

    if (this.formularioAlta.invalid) {
      this.formularioAlta.markAllAsTouched();
      this.enfocar(
        this.formularioAlta.controls.codigo.invalid ? '#alta-plan-codigo' : '#alta-plan-nombre',
      );
      return;
    }

    const valores = this.formularioAlta.getRawValue();
    const copago = numeroDeclarado(valores.copago);
    const moneda = valores.moneda.trim().toUpperCase();
    if ((copago !== null) !== (moneda !== '')) {
      this.errorAccion.set(
        'El copago y su moneda van juntos o no van ninguno: un importe sin moneda no es un ' +
          'importe. Completa los dos, o deja los dos vacios para no declarar copago.',
      );
      this.enfocar(copago === null ? '#alta-plan-copago' : '#alta-plan-moneda');
      return;
    }

    const cuerpo: CreatePlanCoberturaRequest = {
      codigo: valores.codigo.trim(),
      nombre: valores.nombre.trim(),
      vigenciaDesde: valores.vigenciaDesde,
      requiereAutorizacion: valores.requiereAutorizacion,
      requiereCredencial: valores.requiereCredencial,
    };

    const descripcion = valores.descripcion.trim();
    if (descripcion !== '') {
      cuerpo.descripcion = descripcion;
    }
    if (valores.vigenciaHasta !== '') {
      cuerpo.vigenciaHasta = valores.vigenciaHasta;
    }
    if (copago !== null && moneda !== '') {
      cuerpo.copago = copago;
      cuerpo.moneda = moneda;
    }

    this.empezarEnvio();

    this.api.crearPlan(this.financiadorId, cuerpo).subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set(
          'El plan quedo dado de alta. Si su vigencia arranca mas adelante va a figurar como ' +
            'activo pero todavia sin vigencia: es correcto, y empieza a ofrecerse solo ese dia.',
        );
        this.cargar();
      },
      error: (error: unknown) => this.fallar(error),
    });
  }

  protected enviarEdicion(): void {
    const panel = this.panel();
    if (panel === null || this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);
    if (this.formularioEdicion.invalid) {
      this.formularioEdicion.markAllAsTouched();
      this.enfocar('#editar-plan-nombre');
      return;
    }

    const cambios = this.armarCambios();
    if (cambios === null) {
      return;
    }

    this.empezarEnvio();

    this.api.editarPlan(this.financiadorId, panel.id, cambios).subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set(
          'Los datos del plan quedaron guardados. Si le pusiste fecha de fin, el plan sigue ' +
            'ACTIVO: cerrar la vigencia no es darlo de baja, y ese ultimo dia todavia se ofrece.',
        );
        this.cargar();
      },
      error: (error: unknown) => this.fallarEdicion(error),
    });
  }

  protected enviarBaja(motivo: string): void {
    const panel = this.panel();
    if (panel === null || this.enviando()) {
      return;
    }

    this.empezarEnvio();

    this.api.darDeBajaPlan(this.financiadorId, panel.id, { reason: motivo }).subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set(
          'El plan quedo dado de baja. Las coberturas ya firmadas bajo el siguen resolviendo con ' +
            'su copia congelada: lo unico que se impide es elegirlo de ahora en mas. Su codigo y ' +
            'su nombre quedan libres para un plan nuevo del mismo financiador.',
        );
        this.cargar();
      },
      error: (error: unknown) => this.fallar(error),
    });
  }

  /**
   * Arma el cuerpo de la edicion: lo que cambio y la `expectedVersion`.
   *
   * <p><b>Cerrar la vigencia pasa por aca</b>: poner una fecha en "vigente hasta" es lo que la
   * cierra. No hay forma de <b>sacarle</b> la fecha de fin —el contrato no tiene un
   * `limpiarVigenciaHasta` como si tiene la oferta—, asi que vaciar el campo no la borra: un campo
   * ausente significa "no lo toques". La plantilla lo dice, en vez de dejar que el usuario lo
   * descubra guardando.
   */
  private armarCambios(): UpdatePlanCoberturaRequest | null {
    const original = this.original();
    const version = original?.version;
    if (original === null || version === undefined) {
      this.errorAccion.set(
        'No pudimos leer la version de este plan. Cerra el panel, recarga el listado y volve a ' +
          'intentar.',
      );
      return null;
    }

    const valores = this.formularioEdicion.getRawValue();
    const cambios: UpdatePlanCoberturaRequest = { expectedVersion: version };

    const nombre = valores.nombre.trim();
    if (nombre !== (original.nombre ?? '')) {
      cambios.nombre = nombre;
    }
    const descripcion = valores.descripcion.trim();
    if (descripcion !== (original.descripcion ?? '')) {
      cambios.descripcion = descripcion;
    }
    if (valores.vigenciaDesde !== '' && valores.vigenciaDesde !== (original.vigenciaDesde ?? '')) {
      cambios.vigenciaDesde = valores.vigenciaDesde;
    }
    if (valores.vigenciaHasta !== '' && valores.vigenciaHasta !== (original.vigenciaHasta ?? '')) {
      cambios.vigenciaHasta = valores.vigenciaHasta;
    }

    // Copago y moneda son un solo dato: viajan los dos o ninguno, tambien al editar.
    const copago = numeroDeclarado(valores.copago);
    const moneda = valores.moneda.trim().toUpperCase();
    const cambioElCopago = comoTexto(copago) !== comoTexto(original.copago);
    const cambioLaMoneda = moneda !== (original.moneda ?? '');
    if ((cambioElCopago || cambioLaMoneda) && copago !== null && moneda !== '') {
      cambios.copago = copago;
      cambios.moneda = moneda;
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
    const traducido = traducirErrorContracting(error, 'plan');
    this.enviando.set(false);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);

    if (traducido.causa !== 'concurrencia') {
      return;
    }

    const abierto = this.panel();
    if (abierto === null) {
      return;
    }

    this.api
      .listarPlanes(this.financiadorId, { estado: this.filtroEstado(), fecha: this.fecha() })
      .pipe(catchError(() => of(null)))
      .subscribe((planes) => {
        if (planes === null) {
          return;
        }
        const releido = planes.find((plan) => plan.id === abierto.id);
        if (releido !== undefined) {
          this.original.set(releido);
        }
        this.estado.set({ tipo: 'listo', pagina: planes });
      });
  }

  private fallar(error: unknown): void {
    const traducido = traducirErrorContracting(error, 'plan');
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

  /** El financiador, solo para el encabezado. Un fallo aca no rompe la pantalla. */
  private cargarFinanciador(): void {
    this.api
      .obtenerFinanciador(this.financiadorId)
      .pipe(catchError(() => of(null)))
      .subscribe((financiador) => this.financiador.set(financiador));
  }

  private reiniciar(): void {
    this.cerrarPanel();
    this.exito.set(null);
    this.filtroEstado.set('ACTIVO');
    this.fecha.set(hoyLocal());
    this.financiador.set(null);
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}

/** Un numero del backend como texto para un `input`, o `''` si no vino. */
function comoTexto(valor: number | undefined | null): string {
  return valor === undefined || valor === null ? '' : String(valor);
}
