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

import { ArancelResponse } from '../../../../api/generated/model/arancel-response';
import { CatalogoClinicoService } from '../../../../api/generated/api/catalogo-clinico.service';
import { CatalogoConceptoResponse } from '../../../../api/generated/model/catalogo-concepto-response';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { ConvenioResponse } from '../../../../api/generated/model/convenio-response';
import { ConveniosApi } from '../../services/convenios-api';
import { CreateArancelRequest } from '../../../../api/generated/model/create-arancel-request';
import { EstadoDeListado } from '../../../../shared/utils/estado-de-listado';
import { FiltroEstado } from '../../services/contracting-api';
import { PERMISO_CONVENIO_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { UpdateArancelRequest } from '../../../../api/generated/model/update-arancel-request';
import {
  CausaContracting,
  hayQueRecargar,
  traducirErrorContracting,
} from '../../models/contracting-errors';
import { importeEnPalabras, importesCuadran } from '../../models/etiquetas-de-contracting';
import {
  SituacionDeVigencia,
  hoyLocal,
  situacionDeVigencia,
  ventanaEnPalabras,
} from '../../models/vigencia-de-contracting';

/** Operacion abierta sobre una fila. Solo una a la vez. */
type TipoAccion = 'editar' | 'baja';

/**
 * Grilla de vigencias y aranceles de un convenio (M16, AKINE-03.05).
 *
 * <p>Es donde vive el precio: cuanto cuesta cada practica bajo este convenio, cuanto pone el
 * financiador y cuanto el paciente, y desde cuando hasta cuando.
 *
 * <h2>1. El arancel son TRES importes y no hay porcentaje de cobertura</h2>
 *
 * <p>§37. `importeFinanciador + coseguro = importeTotal`, exactamente, y el backend lo hace
 * cumplir desde la base con un CHECK. <b>No hay un campo de porcentaje y no se puede inventar</b>:
 * un porcentaje obliga a multiplicar y redondear, y el redondeo de un arancel es la diferencia de
 * un centavo que aparece seis meses despues en una presentacion rechazada.
 *
 * <p>La pantalla suma antes de mandar —en <b>centavos enteros</b>, porque
 * `1000.10 + 2000.20 !== 3000.30` en coma flotante— para poder senalar el campo en vez de gastar
 * un `400`. La autoridad sigue siendo el backend.
 *
 * <p><b>La moneda no se carga aca</b>: la hereda del convenio, que es por eso que la pantalla lo
 * lee al abrirse. Un arancel no puede estar en otra moneda que su convenio.
 *
 * <h2>2. Subir un precio NO es editar el arancel</h2>
 *
 * <p>Es la operacion que la pantalla mas necesita ensenar. La forma correcta es
 * <b>cerrarle la vigencia al arancel actual y crear otro</b> desde el dia siguiente: asi lo que se
 * liquido en marzo se sigue explicando con el precio de marzo. Editar el importe de una ventana ya
 * transcurrida se admite —a veces hay que corregir una carga— y no reescribe nada de lo ya
 * liquidado, que guardo su propio snapshot congelado; pero usarlo para "actualizar" el precio
 * borra la historia del precio anterior.
 *
 * <p>Por eso <b>dos aranceles de la misma practica conviven</b> —el de 2026 y el de 2027— y esa
 * convivencia es el caso normal, no un dato duplicado. Lo que no pueden es <b>solaparse</b>: eso
 * llega como `409 arancel-solapado` y se resuelve cerrando la vigencia del que ya esta, nunca
 * recargando.
 *
 * <h2>3. La vigencia del arancel tiene que estar CONTENIDA en la del convenio</h2>
 *
 * <p>Fuera de ella nunca podria resolver, porque la resolucion exige primero un convenio
 * aplicable. Aceptarlo dejaria en la grilla filas que prometen un precio que el motor no va a
 * usar. Lo valida el backend; la pantalla muestra la ventana del convenio arriba del formulario
 * para que el dato este a la vista cuando se elige la fecha.
 *
 * <h2>4. Un convenio dado de baja no admite aranceles nuevos, y sus aranceles siguen visibles</h2>
 *
 * <p>La baja del convenio no cascadea: los aranceles conservan sus filas y dejan de resolver
 * porque su convenio dejo de resolver. Hay que poder verlos para explicar una liquidacion vieja,
 * asi que la pantalla los lista igual y solo esconde el alta.
 */
@Component({
  selector: 'app-aranceles-del-convenio-page',
  imports: [ReactiveFormsModule, RouterLink, PermisoDirective, ConfirmacionConMotivo],
  templateUrl: './aranceles-del-convenio-page.html',
  styleUrl: '../../contracting.css',
})
export class ArancelesDelConvenioPage {
  private readonly api = inject(ConveniosApi);
  private readonly catalogoClinico = inject(CatalogoClinicoService);
  private readonly ruta = inject(ActivatedRoute);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly injector = inject(Injector);

  protected readonly permisoManage = PERMISO_CONVENIO_MANAGE;
  protected readonly importeEnPalabras = importeEnPalabras;

  protected readonly ventanaEnPalabras = ventanaEnPalabras;

  protected readonly convenioId = Number(this.ruta.snapshot.paramMap.get('convenioId'));

  /** Dia contra el que el backend calcula `vigente`. No filtra. */
  protected readonly fecha = signal(hoyLocal());

  protected readonly estado = signal<EstadoDeListado<readonly ArancelResponse[]>>({
    tipo: 'cargando',
  });

  protected readonly aranceles = computed<readonly ArancelResponse[]>(() => {
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
   * El convenio del que cuelgan estos aranceles.
   *
   * <p>No es decorativo: de aca sale <b>la moneda</b> —que el arancel no declara y hereda— y la
   * ventana en la que su vigencia tiene que estar contenida. Sin el, la grilla mostraria importes
   * sin moneda, que es exactamente lo que este modulo no hace.
   */
  protected readonly convenio = signal<ConvenioResponse | null>(null);

  /** Moneda heredada del convenio, o `undefined` si todavia no se pudo leer. */
  protected readonly moneda = computed(() => this.convenio()?.moneda);

  /** `true` cuando el convenio esta dado de baja: no admite aranceles nuevos. */
  protected readonly convenioInactivo = computed(() => this.convenio()?.estado === 'INACTIVO');

  /**
   * Practicas del catalogo clinico, para el selector del alta.
   *
   * <p>Se piden con `alcance: 'TODOS'`: el arancel se lleva por practica y una practica puede ser
   * global de la plataforma o propia de la organizacion. Pedir solo uno de los dos alcances
   * dejaria fuera del selector la mitad del catalogo sin ningun aviso.
   */
  protected readonly practicas = signal<readonly CatalogoConceptoResponse[]>([]);

  protected readonly filtroEstado = signal<FiltroEstado>('ACTIVO');

  protected readonly panel = signal<{ readonly id: number; readonly tipo: TipoAccion } | null>(
    null,
  );
  protected readonly altaAbierta = signal(false);
  private readonly original = signal<ArancelResponse | null>(null);

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaContracting | null>(null);
  protected readonly exito = signal<string | null>(null);
  protected readonly intentos = signal(0);

  protected readonly hayQueRecargar = computed(() => hayQueRecargar(this.causaAccion()));

  protected readonly formularioAlta = this.formBuilder.nonNullable.group({
    practicaId: ['', [Validators.required]],
    importeTotal: ['', [Validators.required]],
    importeFinanciador: ['', [Validators.required]],
    coseguro: ['', [Validators.required]],
    vigenciaDesde: ['', [Validators.required]],
    vigenciaHasta: [''],
  });

  /** Sin practica ni convenio: cambiarlos no seria editar este arancel, seria inventar otro. */
  protected readonly formularioEdicion = this.formBuilder.nonNullable.group({
    importeTotal: [''],
    importeFinanciador: [''],
    coseguro: [''],
    vigenciaDesde: [''],
    vigenciaHasta: [''],
  });

  constructor() {
    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.reiniciar();
        this.cargar();
        this.cargarConvenio();
        this.cargarPracticas();
      });
    });
  }

  protected cargar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }

    this.estado.set({ tipo: 'cargando' });

    this.api
      .listarAranceles(consultorioId, this.convenioId, {
        estado: this.filtroEstado(),
        fecha: this.fecha(),
      })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          const traducido = traducirErrorContracting(respuesta, 'arancel');
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

  protected situacion(arancel: ArancelResponse): SituacionDeVigencia {
    return situacionDeVigencia(arancel, this.fecha(), 'arancel');
  }

  /** Nombre de la practica, o su id si el catalogo no la trajo. */
  protected nombreDeLaPractica(arancel: ArancelResponse): string {
    const practica = this.practicas().find((candidata) => candidata.id === arancel.practicaId);
    if (practica === undefined) {
      return `Practica #${arancel.practicaId}`;
    }
    const codigo = practica.codigo ?? '';
    return codigo === '' ? (practica.name ?? '') : `${practica.name ?? ''} (${codigo})`;
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
      practicaId: '',
      importeTotal: '',
      importeFinanciador: '',
      coseguro: '',
      // Arranca en el inicio del convenio si es futuro, y si no en hoy: un arancel fuera de la
      // ventana del convenio se rechaza, y ofrecer de entrada una fecha invalida es empujar al
      // usuario a un 400.
      vigenciaDesde: this.arranqueSugerido(),
      vigenciaHasta: '',
    });
    this.altaAbierta.set(true);
    afterNextRender(() => this.enfocar('#alta-arancel-practica'), { injector: this.injector });
  }

  protected abrirPanel(arancel: ArancelResponse, tipo: TipoAccion): void {
    const id = arancel.id;
    if (id === undefined) {
      return;
    }

    this.cerrarPanel();
    this.exito.set(null);
    this.panel.set({ id, tipo });

    if (tipo === 'editar') {
      this.original.set(arancel);
      this.formularioEdicion.reset({
        importeTotal: comoTexto(arancel.importeTotal),
        importeFinanciador: comoTexto(arancel.importeFinanciador),
        coseguro: comoTexto(arancel.coseguro),
        vigenciaDesde: arancel.vigenciaDesde ?? '',
        vigenciaHasta: arancel.vigenciaHasta ?? '',
      });
      afterNextRender(() => this.enfocar('#editar-arancel-total'), { injector: this.injector });
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
    campo: 'practicaId' | 'importeTotal' | 'importeFinanciador' | 'coseguro' | 'vigenciaDesde',
  ): boolean {
    const control = this.formularioAlta.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  /**
   * Da de alta un arancel.
   *
   * <p>Los tres importes se validan <b>como terna</b> antes de mandar: el backend lo hace igual y
   * es la autoridad, pero su `400` no puede senalar cual de los tres esta mal escrito.
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
        this.formularioAlta.controls.practicaId.invalid
          ? '#alta-arancel-practica'
          : '#alta-arancel-total',
      );
      return;
    }

    const valores = this.formularioAlta.getRawValue();
    const total = Number(valores.importeTotal);
    const financiador = Number(valores.importeFinanciador);
    const coseguro = Number(valores.coseguro);

    if (!importesCuadran(total, financiador, coseguro)) {
      this.errorAccion.set(mensajeDeTerna(total, financiador, coseguro));
      this.enfocar('#alta-arancel-financiador');
      return;
    }

    const cuerpo: CreateArancelRequest = {
      practicaId: Number(valores.practicaId),
      importeTotal: total,
      importeFinanciador: financiador,
      coseguro,
      vigenciaDesde: valores.vigenciaDesde,
    };
    if (valores.vigenciaHasta !== '') {
      cuerpo.vigenciaHasta = valores.vigenciaHasta;
    }

    this.empezarEnvio();

    this.api.crearArancel(consultorioId, this.convenioId, cuerpo).subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set(
          'El arancel quedo cargado. La moneda es la del convenio: el arancel no la declara, la ' +
            'hereda.',
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

    const cambios = this.armarCambios();
    if (cambios === null) {
      return;
    }

    this.empezarEnvio();

    this.api.editarArancel(consultorioId, this.convenioId, panel.id, cambios).subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set(
          'El arancel quedo guardado. Recorda que esto NO es la forma de subir un precio: para eso ' +
            'se le cierra la vigencia a este y se carga otro, asi lo ya liquidado se sigue ' +
            'explicando con el precio que regia entonces.',
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

    this.api
      .darDeBajaArancel(consultorioId, this.convenioId, panel.id, { reason: motivo })
      .subscribe({
        next: () => {
          this.cerrarPanel();
          this.exito.set(
            'El arancel quedo dado de baja y su periodo quedo libre: se puede volver a cargar un ' +
              'arancel de esa practica para las mismas fechas. Lo ya liquidado con este arancel ' +
              'guarda su propio snapshot congelado y no se toca.',
          );
          this.cargar();
        },
        error: (error: unknown) => this.fallar(error),
      });
  }

  /**
   * Arma el cuerpo de la edicion: lo que cambio y la `expectedVersion`.
   *
   * <p><b>Los importes viajan los tres o ninguno</b>, aunque solo uno haya cambiado. El backend
   * los valida como terna justamente por eso: subir el total sin repartir la diferencia rompe la
   * invariante economica sin que nadie lo note, y es el descuido tipico. Mandar los tres hace que
   * el rechazo llegue con el conjunto completo delante.
   */
  private armarCambios(): UpdateArancelRequest | null {
    const original = this.original();
    const version = original?.version;
    if (original === null || version === undefined) {
      this.errorAccion.set(
        'No pudimos leer la version de este arancel. Cerra el panel, recarga la grilla y volve a ' +
          'intentar.',
      );
      return null;
    }

    const valores = this.formularioEdicion.getRawValue();
    const cambios: UpdateArancelRequest = { expectedVersion: version };

    const total = Number(valores.importeTotal);
    const financiador = Number(valores.importeFinanciador);
    const coseguro = Number(valores.coseguro);
    const tocoImportes =
      valores.importeTotal !== comoTexto(original.importeTotal) ||
      valores.importeFinanciador !== comoTexto(original.importeFinanciador) ||
      valores.coseguro !== comoTexto(original.coseguro);

    if (tocoImportes) {
      if (!importesCuadran(total, financiador, coseguro)) {
        this.errorAccion.set(mensajeDeTerna(total, financiador, coseguro));
        this.enfocar('#editar-arancel-financiador');
        return null;
      }
      cambios.importeTotal = total;
      cambios.importeFinanciador = financiador;
      cambios.coseguro = coseguro;
    }

    if (valores.vigenciaDesde !== '' && valores.vigenciaDesde !== (original.vigenciaDesde ?? '')) {
      cambios.vigenciaDesde = valores.vigenciaDesde;
    }
    if (valores.vigenciaHasta !== '' && valores.vigenciaHasta !== (original.vigenciaHasta ?? '')) {
      cambios.vigenciaHasta = valores.vigenciaHasta;
    }

    return cambios;
  }

  private fallarEdicion(error: unknown): void {
    const traducido = traducirErrorContracting(error, 'arancel');
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
      .listarAranceles(consultorioId, this.convenioId, {
        estado: this.filtroEstado(),
        fecha: this.fecha(),
      })
      .pipe(catchError(() => of(null)))
      .subscribe((aranceles) => {
        if (aranceles === null) {
          return;
        }
        const releido = aranceles.find((arancel) => arancel.id === abierto.id);
        if (releido !== undefined) {
          this.original.set(releido);
        }
        this.estado.set({ tipo: 'listo', pagina: aranceles });
      });
  }

  private fallar(error: unknown): void {
    const traducido = traducirErrorContracting(error, 'arancel');
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

  /** Fecha inicial sugerida para el alta: el inicio del convenio si todavia no arranco. */
  private arranqueSugerido(): string {
    const hoy = hoyLocal();
    const desde = this.convenio()?.vigenciaDesde ?? '';
    return desde !== '' && desde > hoy ? desde : hoy;
  }

  /**
   * El convenio: de aca salen la moneda y la ventana de contencion.
   *
   * <p>Un fallo aca <b>si</b> se nota, y por eso la plantilla lo dice: sin moneda los importes se
   * muestran sin unidad. Se prefiere una grilla con la aclaracion antes que una pantalla caida.
   */
  private cargarConvenio(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      return;
    }

    this.api
      .obtenerConvenio(consultorioId, this.convenioId, this.fecha())
      .pipe(catchError(() => of(null)))
      .subscribe((convenio) => this.convenio.set(convenio));
  }

  /**
   * Practicas del catalogo clinico.
   *
   * <p>Es la <b>unica</b> lectura que esta feature le hace a otra: no importa nada de
   * `features/catalog` —eso violaria AGENT.md 4.4— sino que usa el servicio generado directo, que
   * es del cliente y no de una feature. El arancel se lleva por practica, asi que sin este
   * selector el alta pediria un id a mano.
   *
   * <p>Un error aca no rompe la pantalla: la grilla se carga igual y las filas degradan al id.
   */
  private cargarPracticas(): void {
    this.catalogoClinico
      .searchCatalogo({ tipo: 'practicas', estado: 'ACTIVO', alcance: 'TODOS', size: 200 })
      .pipe(catchError(() => of(null)))
      .subscribe((pagina) => this.practicas.set(pagina?.content ?? []));
  }

  private reiniciar(): void {
    this.cerrarPanel();
    this.exito.set(null);
    this.filtroEstado.set('ACTIVO');
    this.fecha.set(hoyLocal());
    this.convenio.set(null);
    this.practicas.set([]);
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}

/** Un numero del backend como texto para un `input`, o `''` si no vino. */
function comoTexto(valor: number | undefined | null): string {
  return valor === undefined || valor === null ? '' : String(valor);
}

/**
 * El mensaje de la terna que no cuadra, con la diferencia calculada.
 *
 * <p>Decir "no suman" sin decir cuanto falta obliga al usuario a hacer la resta a mano sobre tres
 * campos que ya tiene delante. La diferencia es la unica informacion accionable.
 */
function mensajeDeTerna(total: number, financiador: number, coseguro: number): string {
  const diferencia = Math.round((total - financiador - coseguro) * 100) / 100;
  const detalle = Number.isFinite(diferencia)
    ? ` Hoy la suma de las partes difiere del total en ${diferencia}.`
    : '';
  return (
    'Los tres importes tienen que cuadrar: lo que pone el financiador mas el coseguro del ' +
    'paciente tiene que dar exactamente el total.' +
    detalle +
    ' No hay porcentaje de cobertura a proposito: un porcentaje obliga a redondear, y el redondeo ' +
    'de un arancel es la diferencia de un centavo que aparece meses despues en una presentacion ' +
    'rechazada.'
  );
}
