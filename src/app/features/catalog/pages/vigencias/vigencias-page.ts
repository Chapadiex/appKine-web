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
import { catchError, of } from 'rxjs';

import { CatalogoClinicoService } from '../../../../api/generated/api/catalogo-clinico.service';
import { CatalogoConceptoResponse } from '../../../../api/generated/model/catalogo-concepto-response';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { CreateVigenciaRequest } from '../../../../api/generated/model/create-vigencia-request';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { CausaCatalogo, traducirErrorCatalogo } from '../../models/catalogo-errors';
import { esGlobal, etiquetaDeAlcance } from '../../models/tipos-de-catalogo';
import { aInstanteUtc, formatearInstante } from '../../../../shared/utils/instantes';
import { textoRequerido } from '../../../../shared/validators/texto-requerido';
import { numeroDeclarado } from '../../../../shared/utils/numero-declarado';

/** Filtro de estado del listado. Los tres valores son los del contrato. */
type FiltroEstado = 'ACTIVO' | 'INACTIVO' | 'TODOS';

/** En cual de los cuatro estados esta la pantalla. */
type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'sin-contexto' }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly faltaContexto: boolean }
  | {
      readonly tipo: 'listo';
      readonly nomenclador: CatalogoConceptoResponse;
      readonly vigencias: readonly CatalogoConceptoResponse[];
    };

/** Cuantas practicas se piden para poblar el selector del alta. */
const TOPE_DE_PRACTICAS = 100;

/**
 * Vigencias de un nomenclador (M06, AKINE-02.05).
 *
 * <p>Un nomenclador no tiene codigos: tiene <b>vigencias</b>, y cada una dice que codigo
 * codificaba a que practica, con que valor de referencia y entre que fechas. Es la
 * distincion que sostiene RN-M06-002: cuando el financiador cambia el codigo de una
 * practica, la vigencia vieja <b>no se edita</b> —lo que ya se presento con ella tiene que
 * seguir resolviendo—; se cierra y se abre una nueva.
 *
 * <p><b>Por eso esta pantalla no edita nada.</b> Las tres operaciones que el contrato publica
 * sobre las vigencias son listar, crear y dar de baja. No hay `PATCH`, y no es una omision de
 * la etapa: una vigencia editable seria la forma de reescribir el pasado sin dejar rastro.
 *
 * <p><b>El listado no se pagina.</b> El contrato devuelve un array y no una pagina, porque un
 * nomenclador tiene decenas de vigencias, no miles. El filtro por codigo es lo que hace de
 * busqueda.
 *
 * <p><b>Las vigencias de un nomenclador de la plataforma no se tocan desde aca</b>, igual que
 * el nomenclador mismo: el backend responde `403` y la pantalla lo dice antes en vez de
 * ofrecer un boton que siempre falla.
 */
@Component({
  selector: 'app-vigencias-page',
  imports: [ReactiveFormsModule, RouterLink, PermisoDirective, ConfirmacionConMotivo],
  templateUrl: './vigencias-page.html',
  styleUrl: '../../catalog.css',
})
export class VigenciasPage {
  /** Id del nomenclador, del segmento `:nomencladorId` de la ruta. */
  readonly nomencladorId = input.required<string>();

  private readonly catalogo = inject(CatalogoClinicoService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly injector = inject(Injector);

  protected readonly permisoManage = PERMISO_CONSULTORIO_MANAGE;
  protected readonly etiquetaDeAlcance = etiquetaDeAlcance;
  protected readonly formatearInstante = formatearInstante;

  protected readonly estado = signal<Estado>({ tipo: 'cargando' });

  protected readonly filtroEstado = signal<FiltroEstado>('ACTIVO');
  protected readonly filtroCodigo = signal('');

  /** Practicas activas, para el selector del alta. Ver {@link cargarPracticas}. */
  protected readonly practicas = signal<readonly CatalogoConceptoResponse[]>([]);

  protected readonly altaAbierta = signal(false);

  /** Vigencia con el panel de baja abierto, o `null`. */
  protected readonly bajaAbierta = signal<number | null>(null);

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaCatalogo | null>(null);
  protected readonly exito = signal<string | null>(null);
  protected readonly intentos = signal(0);

  /** Id ya convertido, o `null` si el segmento de la URL no era un numero. */
  private readonly id = computed(() => {
    const valor = Number(this.nomencladorId());
    return Number.isSafeInteger(valor) && valor > 0 ? valor : null;
  });

  protected readonly nomenclador = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.nomenclador : null;
  });

  protected readonly vigencias = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.vigencias : [];
  });

  protected readonly mensajeError = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  protected readonly faltaContexto = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' && actual.faltaContexto;
  });

  /** `true` cuando el nomenclador es de la plataforma: sus vigencias no se administran aca. */
  protected readonly esDeLaPlataforma = computed(() => {
    const actual = this.nomenclador();
    return actual !== null && esGlobal(actual);
  });

  /** Errores que solo se resuelven releyendo el listado. */
  protected readonly hayQueRecargar = computed(() => {
    const causa = this.causaAccion();
    return causa === 'no-encontrado' || causa === 'ya-inactivo';
  });

  protected readonly errorEnElCodigo = computed(() => {
    const causa = this.causaAccion();
    return causa === 'codigo-tomado' || causa === 'vigencias-solapadas';
  });

  protected readonly formularioAlta = this.formBuilder.nonNullable.group({
    codigo: ['', [textoRequerido]],
    name: ['', [textoRequerido]],
    // Texto y no numero: un `select` siempre entrega texto, y `''` es "todavia no elegiste".
    practicaId: ['', [Validators.required]],
    descripcion: [''],
    valorReferencia: [''],
    validFrom: [''],
    validUntil: [''],
  });

  constructor() {
    effect(() => {
      this.nomencladorId();
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.cerrarPaneles();
        this.exito.set(null);
        this.filtroEstado.set('ACTIVO');
        this.filtroCodigo.set('');
        this.cargar();
        this.cargarPracticas();
      });
    });
  }

  /**
   * Trae el nomenclador y sus vigencias.
   *
   * <p>Las dos lecturas son secuenciales y no en paralelo, a proposito: si el nomenclador no
   * existe -o es de otro tenant- las vigencias tampoco, y pedirlas igual solo agrega un `404`
   * mas al log del servidor. El titulo de la pantalla, ademas, necesita el nombre.
   */
  protected cargar(): void {
    const id = this.id();
    if (id === null) {
      this.estado.set({
        tipo: 'error',
        mensaje:
          'La direccion que abriste no apunta a ningun nomenclador. Volve al catalogo y entra ' +
          'desde el listado.',
        faltaContexto: false,
      });
      return;
    }

    if (this.tenantContext.organizationId() === null) {
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }

    this.estado.set({ tipo: 'cargando' });

    const codigo = this.filtroCodigo().trim();

    this.catalogo
      .getCatalogoConcepto({ tipo: 'nomencladores', conceptoId: id })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((nomenclador) => {
        if (nomenclador instanceof Error) {
          this.fallarCarga(nomenclador);
          return;
        }

        this.catalogo
          .listNomencladorVigencias({
            nomencladorId: id,
            estado: this.filtroEstado(),
            codigo: codigo === '' ? undefined : codigo,
          })
          .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
          .subscribe((vigencias) => {
            if (vigencias instanceof Error) {
              this.fallarCarga(vigencias);
              return;
            }
            this.estado.set({ tipo: 'listo', nomenclador, vigencias });
          });
      });
  }

  protected cambiarFiltroEstado(valor: string): void {
    const elegido: FiltroEstado =
      valor === 'INACTIVO' || valor === 'TODOS' ? valor : ('ACTIVO' as const);
    this.cerrarPaneles();
    this.filtroEstado.set(elegido);
    this.cargar();
  }

  protected filtrarPorCodigo(valor: string): void {
    this.cerrarPaneles();
    this.filtroCodigo.set(valor);
    this.cargar();
  }

  protected abrirAlta(): void {
    this.cerrarPaneles();
    this.exito.set(null);
    this.formularioAlta.enable();
    this.formularioAlta.reset({
      codigo: '',
      name: '',
      practicaId: '',
      descripcion: '',
      valorReferencia: '',
      validFrom: '',
      validUntil: '',
    });
    this.altaAbierta.set(true);
    afterNextRender(() => this.enfocar('#alta-vigencia-codigo'), { injector: this.injector });
  }

  protected abrirBaja(vigencia: CatalogoConceptoResponse): void {
    const id = vigencia.id;
    if (id === undefined) {
      return;
    }
    this.cerrarPaneles();
    this.exito.set(null);
    this.bajaAbierta.set(id);
  }

  protected cerrarPaneles(): void {
    this.altaAbierta.set(false);
    this.bajaAbierta.set(null);
    this.enviando.set(false);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.intentos.set(0);
  }

  protected mostrarErrorAlta(campo: 'codigo' | 'name' | 'practicaId'): boolean {
    const control = this.formularioAlta.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected enviarAlta(): void {
    const id = this.id();
    if (id === null || this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);
    if (this.formularioAlta.invalid) {
      this.formularioAlta.markAllAsTouched();
      this.enfocar(
        this.formularioAlta.controls.codigo.invalid
          ? '#alta-vigencia-codigo'
          : '#alta-vigencia-name',
      );
      return;
    }

    const valores = this.formularioAlta.getRawValue();
    const cuerpo: CreateVigenciaRequest = {
      codigo: valores.codigo.trim(),
      name: valores.name.trim(),
      practicaId: Number(valores.practicaId),
    };

    const descripcion = valores.descripcion.trim();
    if (descripcion !== '') {
      cuerpo.descripcion = descripcion;
    }

    const valor = numeroDeclarado(valores.valorReferencia);
    if (valor !== null) {
      cuerpo.valorReferencia = valor;
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
      .createNomencladorVigencia({ nomencladorId: id, createVigenciaRequest: cuerpo })
      .subscribe({
        next: () => {
          this.cerrarPaneles();
          this.exito.set(
            'La vigencia quedo cargada. Las anteriores del mismo codigo no se tocaron: lo que se ' +
              'presento con ellas sigue resolviendo con el valor que tenia entonces.',
          );
          this.cargar();
        },
        error: (error: unknown) => this.fallar(error),
      });
  }

  /**
   * Da de baja una vigencia.
   *
   * <p><b>Dar de baja no es corregir.</b> Lo que se presento mientras la vigencia estaba
   * activa conserva el codigo y el valor que tenia: la baja solo dice que de ahora en mas ese
   * codigo no se elige mas. El panel lo dice antes de confirmar.
   */
  protected enviarBaja(motivo: string): void {
    const id = this.id();
    const itemId = this.bajaAbierta();
    if (id === null || itemId === null || this.enviando()) {
      return;
    }

    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);

    this.catalogo
      .deactivateNomencladorVigencia({
        nomencladorId: id,
        itemId,
        deactivateCatalogoRequest: { reason: motivo },
      })
      .subscribe({
        next: () => {
          this.cerrarPaneles();
          this.exito.set(
            'La vigencia quedo dada de baja. Sigue en el listado, con su motivo, y lo que ya se ' +
              'presento con ella conserva el codigo y el valor que tenia.',
          );
          this.cargar();
        },
        error: (error: unknown) => this.fallar(error),
      });
  }

  /** Nombre de la practica que una vigencia codifica, si el selector la trajo. */
  protected nombreDePractica(vigencia: CatalogoConceptoResponse): string | null {
    const practica = this.practicas().find((candidata) => candidata.id === vigencia.practicaId);
    return practica?.name ?? null;
  }

  /**
   * Pide las practicas activas para el selector del alta.
   *
   * <p>Un error aca <b>no rompe la pantalla</b>: el listado de vigencias se carga igual y el
   * selector queda vacio con su explicacion. Solo trae las <b>activas</b> porque una vigencia
   * no puede codificar una practica dada de baja.
   */
  private cargarPracticas(): void {
    // Sin id valido no hay pantalla que poblar: el selector vive dentro del alta, y el alta
    // solo existe cuando el nomenclador se pudo leer.
    if (this.id() === null || this.tenantContext.organizationId() === null) {
      return;
    }

    this.catalogo
      .searchCatalogo({
        tipo: 'practicas',
        estado: 'ACTIVO',
        alcance: 'TODOS',
        page: 0,
        size: TOPE_DE_PRACTICAS,
      })
      .pipe(catchError(() => of(null)))
      .subscribe((pagina) => {
        this.practicas.set(pagina?.content ?? []);
      });
  }

  private fallarCarga(error: unknown): void {
    const traducido = traducirErrorCatalogo(error);
    this.estado.set({
      tipo: 'error',
      mensaje: traducido.mensaje,
      faltaContexto: traducido.causa === 'sin-contexto',
    });
  }

  private fallar(error: unknown): void {
    const traducido = traducirErrorCatalogo(error);
    this.enviando.set(false);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}
