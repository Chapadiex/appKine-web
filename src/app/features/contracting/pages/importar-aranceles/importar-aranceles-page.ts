import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { ConvenioResponse } from '../../../../api/generated/model/convenio-response';
import { ConveniosApi } from '../../services/convenios-api';
import { FilaImportacionArancelRequest } from '../../../../api/generated/model/fila-importacion-arancel-request';
import {
  FilaImportacionArancelResponse,
  FilaImportacionArancelResponseEstadoEnum,
} from '../../../../api/generated/model/fila-importacion-arancel-response';
import { ImportarArancelesRequestModoEnum } from '../../../../api/generated/model/importar-aranceles-request';
import { PERMISO_CONVENIO_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { traducirErrorContracting } from '../../models/contracting-errors';
import { importeEnPalabras } from '../../models/etiquetas-de-contracting';
import {
  ENCABEZADO_DE_EJEMPLO,
  MAXIMO_DE_FILAS,
  PLANILLA_DE_EJEMPLO,
  PlanillaParseada,
  motivoDeFilaRechazada,
  parsearPlanilla,
} from '../../models/planilla-de-aranceles';
import { ventanaEnPalabras } from '../../models/vigencia-de-contracting';

/** Tamano maximo del archivo que se lee en el navegador. 500 filas de CSV entran holgadas. */
const TAMANO_MAXIMO_DE_ARCHIVO = 512 * 1024;

/**
 * El ultimo desenlace que devolvio el backend, atado al texto exacto que lo produjo.
 *
 * <p>`texto` es la clave de todo el flujo: el preview no reserva nada y describe <b>un</b> lote. Si
 * el usuario toca una coma despues de verlo, ese desenlace deja de describir lo que se va a
 * confirmar, y la pantalla tiene que volver a pedirlo antes de dejar confirmar.
 */
interface Desenlace {
  readonly tipo: 'preview' | 'rechazo';
  readonly texto: string;
  readonly filas: readonly FilaImportacionArancelResponse[];
}

/**
 * Importacion masiva de aranceles de un convenio con vista previa (RF-M16-007, AKINE-B-7).
 *
 * <h2>1. El backend no recibe archivos</h2>
 *
 * <p>La planilla se parsea aca (`planilla-de-aranceles.ts`) y viaja como filas JSON del contrato.
 * El cliente solo valida el <b>formato</b> y el tope de 500 filas; las reglas del arancel las
 * decide la vista previa del backend fila por fila, con el mismo `problemType` que daria el alta
 * unitaria.
 *
 * <h2>2. La vista previa es una prediccion, no una reserva</h2>
 *
 * <p>"Confirmar" se habilita solo si el ultimo preview corresponde <b>al texto actual</b> y todas
 * sus filas salen `ALTA`. Aun asi la confirmacion puede fallar: el backend revalida bajo el lock
 * del convenio y lo que otro cargo entre medio cuenta. Ese caso llega como
 * `409 importacion-aranceles-rechazada` con el desenlace de cada fila, y la pantalla lo muestra en
 * la misma tabla diciendo que <b>no se escribio nada</b>.
 *
 * <h2>3. Todo o nada, tambien en la pantalla</h2>
 *
 * <p>No hay "importar las que entran". El diseno del backend lo descarto a proposito —una planilla
 * aplicada a medias deja la mitad de las practicas con el nomenclador nuevo— y ofrecerlo aca seria
 * inventar un modo que el contrato no tiene.
 */
@Component({
  selector: 'app-importar-aranceles-page',
  imports: [RouterLink, PermisoDirective],
  templateUrl: './importar-aranceles-page.html',
  styleUrl: '../../contracting.css',
})
export class ImportarArancelesPage {
  private readonly api = inject(ConveniosApi);
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tenantContext = inject(TenantContextStore);

  protected readonly permisoManage = PERMISO_CONVENIO_MANAGE;
  protected readonly maximoDeFilas = MAXIMO_DE_FILAS;
  protected readonly encabezadoDeEjemplo = ENCABEZADO_DE_EJEMPLO;
  protected readonly planillaDeEjemplo = PLANILLA_DE_EJEMPLO;
  protected readonly ventanaEnPalabras = ventanaEnPalabras;
  protected readonly motivoDeFilaRechazada = motivoDeFilaRechazada;

  protected readonly convenioId = Number(this.ruta.snapshot.paramMap.get('convenioId'));
  protected readonly rutaDeLaGrilla = `/contratacion/convenios/${this.convenioId}/aranceles`;

  protected readonly convenio = signal<ConvenioResponse | null>(null);
  protected readonly moneda = computed(() => this.convenio()?.moneda);
  protected readonly convenioInactivo = computed(() => this.convenio()?.estado === 'INACTIVO');

  protected readonly texto = signal('');
  protected readonly nombreDeArchivo = signal<string | null>(null);
  protected readonly errorDeArchivo = signal<string | null>(null);

  /** La planilla parseada. Se recalcula sola con cada tecla: el parser es puro y barato. */
  protected readonly planilla = computed<PlanillaParseada>(() => parsearPlanilla(this.texto()));

  /** Los errores de formato, solo cuando ya hay algo escrito: una planilla vacia no es un error. */
  protected readonly erroresDeFormato = computed(() =>
    this.texto().trim() === '' ? [] : this.planilla().errores,
  );

  protected readonly puedePrevisualizar = computed(
    () =>
      !this.enviando() &&
      this.planilla().filas.length > 0 &&
      this.planilla().errores.length === 0 &&
      !this.convenioInactivo(),
  );

  protected readonly desenlace = signal<Desenlace | null>(null);

  /** `true` si el desenlace que se ve describe el texto actual y no uno anterior. */
  protected readonly desenlaceVigente = computed(() => {
    const actual = this.desenlace();
    return actual !== null && actual.texto === this.texto();
  });

  protected readonly filasConAlta = computed(
    () => this.desenlace()?.filas.filter((fila) => esAlta(fila)).length ?? 0,
  );

  protected readonly filasRechazadas = computed(
    () => (this.desenlace()?.filas.length ?? 0) - this.filasConAlta(),
  );

  protected readonly puedeConfirmar = computed(() => {
    const actual = this.desenlace();
    return (
      !this.enviando() &&
      actual !== null &&
      actual.tipo === 'preview' &&
      this.desenlaceVigente() &&
      actual.filas.length > 0 &&
      actual.filas.every((fila) => esAlta(fila))
    );
  });

  protected readonly enviando = signal<'preview' | 'confirmar' | null>(null);
  protected readonly errorAccion = signal<string | null>(null);

  constructor() {
    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.reiniciar();
        this.cargarConvenio();
      });
    });
  }

  protected cambiarTexto(valor: string): void {
    this.texto.set(valor);
    this.errorAccion.set(null);
  }

  protected usarEjemplo(): void {
    this.nombreDeArchivo.set(null);
    this.cambiarTexto(PLANILLA_DE_EJEMPLO);
  }

  /** Lee el CSV elegido en el navegador y lo deja en el area de texto, donde se puede corregir. */
  protected async elegirArchivo(entrada: EventTarget | null): Promise<void> {
    const archivo = (entrada as HTMLInputElement | null)?.files?.[0] ?? null;
    this.errorDeArchivo.set(null);
    if (archivo === null) {
      return;
    }
    if (archivo.size > TAMANO_MAXIMO_DE_ARCHIVO) {
      this.errorDeArchivo.set(
        `El archivo pesa demasiado para una planilla de hasta ${MAXIMO_DE_FILAS} filas. ` +
          'Revisa que sea el CSV y no la planilla de Excel completa.',
      );
      return;
    }
    try {
      const contenido = await archivo.text();
      this.nombreDeArchivo.set(archivo.name);
      this.cambiarTexto(contenido.replace(/^\uFEFF/, ''));
    } catch {
      this.errorDeArchivo.set('No pudimos leer el archivo. Proba exportarlo de nuevo como CSV.');
    }
  }

  protected previsualizar(): void {
    this.enviar(ImportarArancelesRequestModoEnum.PREVIEW);
  }

  protected confirmar(): void {
    if (!this.puedeConfirmar()) {
      return;
    }
    this.enviar(ImportarArancelesRequestModoEnum.CONFIRMAR);
  }

  /** La fila de la planilla que mando el usuario, para mostrarla al lado de su desenlace. */
  protected filaEnviada(posicion: number | undefined): FilaImportacionArancelRequest | undefined {
    return posicion === undefined ? undefined : this.planilla().filas[posicion - 1];
  }

  protected lineaDe(posicion: number | undefined): number | undefined {
    return posicion === undefined ? undefined : this.planilla().lineas[posicion - 1];
  }

  protected practicaEnPalabras(fila: FilaImportacionArancelResponse): string {
    const enviada = this.filaEnviada(fila.fila);
    const codigo = enviada?.codigoPractica;
    const id = fila.practicaId ?? enviada?.practicaId;
    if (codigo !== undefined && id !== undefined) {
      return `${codigo} (#${id})`;
    }
    return codigo ?? (id === undefined ? '-' : `#${id}`);
  }

  /** Con moneda si el convenio se pudo leer; si no, el numero solo, que sigue siendo verificable. */
  protected importe(valor: number | undefined): string {
    return importeEnPalabras(valor, this.moneda(), valor === undefined ? '-' : valor.toFixed(2));
  }

  protected vigenciaEnPalabras(fila: FilaImportacionArancelRequest | undefined): string {
    if (fila?.vigenciaDesde === undefined) {
      return '-';
    }
    return fila.vigenciaHasta === undefined
      ? `desde ${fila.vigenciaDesde}, sin fin`
      : `${fila.vigenciaDesde} a ${fila.vigenciaHasta}`;
  }

  protected esAlta(fila: FilaImportacionArancelResponse): boolean {
    return esAlta(fila);
  }

  private enviar(modo: ImportarArancelesRequestModoEnum): void {
    const consultorioId = this.tenantContext.consultorioId();
    const planilla = this.planilla();
    if (
      consultorioId === null ||
      this.enviando() !== null ||
      planilla.filas.length === 0 ||
      planilla.errores.length > 0
    ) {
      return;
    }

    const texto = this.texto();
    const confirmando = modo === ImportarArancelesRequestModoEnum.CONFIRMAR;
    this.enviando.set(confirmando ? 'confirmar' : 'preview');
    this.errorAccion.set(null);

    this.api
      .importarAranceles(consultorioId, this.convenioId, { modo, filas: [...planilla.filas] })
      .subscribe({
        next: (respuesta) => {
          this.enviando.set(null);
          if (confirmando) {
            this.router
              .navigate([this.rutaDeLaGrilla], {
                queryParams: { importados: respuesta.filasConAlta ?? planilla.filas.length },
              })
              .catch(() => undefined);
            return;
          }
          this.desenlace.set({ tipo: 'preview', texto, filas: respuesta.filas ?? [] });
        },
        error: (error: unknown) => {
          this.enviando.set(null);
          const filas = filasDelRechazo(error);
          if (filas !== null) {
            this.desenlace.set({ tipo: 'rechazo', texto, filas });
            return;
          }
          this.errorAccion.set(traducirErrorContracting(error, 'convenio').mensaje);
        },
      });
  }

  private cargarConvenio(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      return;
    }
    this.api
      .obtenerConvenio(consultorioId, this.convenioId)
      .pipe(catchError(() => of(null)))
      .subscribe((convenio) => this.convenio.set(convenio));
  }

  private reiniciar(): void {
    this.convenio.set(null);
    this.texto.set('');
    this.nombreDeArchivo.set(null);
    this.errorDeArchivo.set(null);
    this.desenlace.set(null);
    this.enviando.set(null);
    this.errorAccion.set(null);
  }
}

function esAlta(fila: FilaImportacionArancelResponse): boolean {
  return fila.estado === FilaImportacionArancelResponseEstadoEnum.ALTA;
}

/**
 * Las filas del `409 importacion-aranceles-rechazada`, o `null` si el error es otro.
 *
 * <p>La propiedad `filas` del problem trae el mismo `FilaImportacionArancelResponse` que el preview
 * —el contrato lo declara asi—, y por eso se tipa con el modelo generado y no con uno propio.
 */
function filasDelRechazo(error: unknown): readonly FilaImportacionArancelResponse[] | null {
  if (
    !(error instanceof AkineHttpError) ||
    error.problemType !== 'importacion-aranceles-rechazada'
  ) {
    return null;
  }
  const filas = error.extension('filas');
  return Array.isArray(filas) ? (filas as FilaImportacionArancelResponse[]) : [];
}
