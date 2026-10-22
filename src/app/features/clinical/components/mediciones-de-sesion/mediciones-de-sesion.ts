import {
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { forkJoin } from 'rxjs';
import { esSinPermiso } from '../../../../core/interceptors/error.interceptor';

import { ClinicalApi, LadoDeMedicion } from '../../services/clinical-api';
import { ErrorAtencion, traducirErrorAtencion } from '../../models/atencion-errors';
import {
  LADOS_DE_MEDICION,
  comoLado,
  deltaLegible,
  ladoLegible,
  numeroDe,
  valorLegible,
} from '../../models/examen-y-tratamiento';
import { ComparacionDeMediciones } from '../../../../api/generated/model/comparacion-de-mediciones';
import { MedicionComparada } from '../../../../api/generated/model/medicion-comparada';
import {
  MedicionDefinicionResponse,
  MedicionDefinicionResponseTipoEnum,
} from '../../../../api/generated/model/medicion-definicion-response';
import { RegistrarMedicion } from '../../../../api/generated/model/registrar-medicion';

/** Causas que no son de este bloque sino de la atencion entera: las resuelve la pantalla. */
const CAUSAS_DE_LA_ATENCION = new Set(['version-vieja', 'sesion-cerrada', 'sesion-ajena']);

/**
 * Examen fisico de una sesion: mediciones tipadas contra el catalogo (AKINE-06.03, RF-M14-004).
 *
 * <h2>Una sola tabla: lo de hoy al lado de lo de la vez pasada</h2>
 *
 * <p>La tabla sale de la <b>comparacion</b>, no del listado: el backend devuelve la union de las
 * medidas de las dos sesiones, y las que se tomaron la vez pasada y todavia no hoy son las que el
 * profesional va a volver a tomar. "Volver a cargar" precarga el valor anterior para ajustarlo:
 * es la mitad "copiar previo y ajustar" de `plan_sesiones.txt` §9.4 y por eso no hay un boton de
 * copiar todo. Escribir el valor sigue siendo un registro con alguien detras.
 *
 * <h2>El rango lo decide el servidor</h2>
 *
 * <p>La pantalla muestra el rango vigente como ayuda y <b>no lo valida</b>: duplicar la regla la
 * dejaria divergir del catalogo. Un valor afuera vuelve como 400 `medicion-fuera-de-rango` con el
 * minimo y el maximo, y eso es lo que se muestra.
 *
 * <h2>No toca la version de la sesion</h2>
 *
 * <p>Cada medicion es una fila sola, idempotente por medida y lado. El backend no la versiona y no
 * hace avanzar la `version` del autosave, asi que este bloque no necesita conocerla.
 *
 * <p><b>Completitud informa y no gatea</b>: "4 de 18" no impide cerrar.
 */
@Component({
  selector: 'app-mediciones-de-sesion',
  templateUrl: './mediciones-de-sesion.html',
  styleUrl: '../../atencion.css',
})
export class MedicionesDeSesion {
  private readonly api = inject(ClinicalApi);
  private readonly injector = inject(Injector);

  readonly consultorioId = input.required<number>();
  readonly sesionId = input.required<number>();
  /** `false` en una sesion cerrada: se lee y no se escribe. Corregirla es una enmienda. */
  readonly editable = input(true);

  /** Errores de la atencion entera (version, propiedad, cierre): los resuelve la pantalla. */
  readonly problema = output<unknown>();

  protected readonly lados = LADOS_DE_MEDICION;
  protected readonly valorLegible = valorLegible;
  protected readonly ladoLegible = ladoLegible;
  protected readonly deltaLegible = deltaLegible;
  protected readonly Tipo = MedicionDefinicionResponseTipoEnum;

  protected readonly definiciones = signal<readonly MedicionDefinicionResponse[]>([]);
  protected readonly comparacion = signal<ComparacionDeMediciones | null>(null);
  protected readonly cubiertas = signal<number | null>(null);
  protected readonly disponibles = signal<number | null>(null);
  protected readonly cargando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly error = signal<ErrorAtencion | null>(null);

  /**
   * Los tipos de medicion respondieron 403: el rol no tiene `catalogo:read` (DP-36). Las
   * mediciones ya tomadas se siguen viendo; lo que no se puede es elegir una nueva.
   */
  protected readonly catalogoSinPermiso = signal(false);
  protected readonly aviso = signal('');

  // --- Formulario de una medicion ---------------------------------------------------------
  protected readonly definicionId = signal<number | null>(null);
  protected readonly lado = signal<LadoDeMedicion>('NO_APLICA');
  protected readonly valorNumero = signal('');
  protected readonly valorTexto = signal('');
  protected readonly valorSiNo = signal<boolean | null>(null);
  protected readonly nota = signal('');

  protected readonly definicion = computed(
    () => this.definiciones().find((d) => d.id === this.definicionId()) ?? null,
  );

  protected readonly esNumerica = computed(() => {
    const tipo = this.definicion()?.tipo;
    return (
      tipo === MedicionDefinicionResponseTipoEnum.NUMERICO ||
      tipo === MedicionDefinicionResponseTipoEnum.ESCALA
    );
  });

  /** "de 0 a 180 grados", para ayudar a cargar. No es una validacion: decide el servidor. */
  protected readonly rango = computed(() => {
    const d = this.definicion();
    if (d === null) {
      return '';
    }
    const unidad = d.unidad ? ` ${d.unidad}` : '';
    if (d.minimo !== undefined && d.maximo !== undefined) {
      return `Admite de ${d.minimo} a ${d.maximo}${unidad}.`;
    }
    if (d.minimo !== undefined) {
      return `Admite desde ${d.minimo}${unidad}.`;
    }
    if (d.maximo !== undefined) {
      return `Admite hasta ${d.maximo}${unidad}.`;
    }
    return d.unidad ? `En ${d.unidad}.` : '';
  });

  protected readonly medidas = computed(() => this.comparacion()?.medidas ?? []);

  /** Contra que se compara. Que se acoto al caso se dice: comparar contra otra cosa engaña. */
  protected readonly baseline = computed(() => {
    const comparacion = this.comparacion();
    if (comparacion === null) {
      return '';
    }
    if (comparacion.sesionAnteriorId === undefined) {
      return 'No hay una sesión cerrada anterior con que comparar: estas son las primeras mediciones.';
    }
    return comparacion.acotadaAlCaso
      ? 'Comparado contra la sesión cerrada anterior del mismo caso clínico.'
      : 'Comparado contra la sesión cerrada anterior del paciente.';
  });

  constructor() {
    effect(() => {
      this.sesionId();
      this.consultorioId();
      untracked(() => this.cargar());
    });
  }

  protected cargar(): void {
    const consultorioId = this.consultorioId();
    const sesionId = this.sesionId();
    this.cargando.set(true);
    this.error.set(null);

    forkJoin({
      comparacion: this.api.compararMediciones(consultorioId, sesionId),
      listado: this.api.medicionesDe(consultorioId, sesionId),
    }).subscribe({
      next: ({ comparacion, listado }) => {
        this.cargando.set(false);
        this.comparacion.set(comparacion);
        this.cubiertas.set(listado.definicionesCubiertas ?? null);
        this.disponibles.set(listado.definicionesDisponibles ?? null);
      },
      error: (error: unknown) => {
        this.cargando.set(false);
        this.error.set(traducirErrorAtencion(error));
      },
    });

    // El catalogo solo hace falta para escribir. En una sesion cerrada no se pide.
    if (this.editable() && this.definiciones().length === 0) {
      this.api.definicionesActivas().subscribe({
        next: (definiciones) => this.definiciones.set(definiciones),
        error: (error: unknown) => {
          if (esSinPermiso(error)) {
            this.catalogoSinPermiso.set(true);
          } else {
            this.error.set(traducirErrorAtencion(error));
          }
        },
      });
    }
  }

  protected elegirDefinicion(valor: string): void {
    const id = Number(valor);
    this.definicionId.set(Number.isFinite(id) && id > 0 ? id : null);
    this.limpiarValor();
    this.aviso.set('');
  }

  protected elegirLado(valor: string): void {
    this.lado.set(comoLado(valor));
  }

  protected elegirSiNo(valor: boolean): void {
    this.valorSiNo.set(valor);
  }

  /**
   * Precarga una medida de la vez pasada para volver a tomarla.
   *
   * <p>El valor anterior queda escrito en el campo para <b>ajustarlo</b>, no guardado: hasta que
   * el profesional aprieta "Registrar" no hay ninguna medicion nueva.
   */
  protected volverATomar(medida: MedicionComparada): void {
    this.definicionId.set(medida.definicionId ?? null);
    this.lado.set(comoLado(medida.lateralidad));
    this.limpiarValor();
    const anterior = medida.anterior;
    if (anterior?.valorNumerico !== undefined) {
      this.valorNumero.set(String(anterior.valorNumerico));
    } else if (anterior?.valorBooleano !== undefined) {
      this.valorSiNo.set(anterior.valorBooleano);
    } else if (anterior?.valorTexto !== undefined) {
      this.valorTexto.set(anterior.valorTexto);
    }
    this.aviso.set('');
    afterNextRender(() => document.getElementById('medicion-valor')?.focus(), {
      injector: this.injector,
    });
  }

  /**
   * Registra la medicion. Manda <b>exactamente un</b> valor, el que el tipo admite: el otro
   * campo, aunque tenga algo escrito de una medida anterior, no viaja.
   */
  protected registrar(): void {
    const definicion = this.definicion();
    if (definicion?.id === undefined) {
      this.aviso.set('Elegí que medida vas a cargar.');
      return;
    }

    const valor = this.valorParaEnviar(definicion);
    if (valor === null) {
      this.aviso.set(
        this.esNumerica()
          ? 'Falta el valor, o no es un número.'
          : definicion.tipo === MedicionDefinicionResponseTipoEnum.BOOLEANO
            ? 'Elegí si el signo esta presente o no.'
            : 'Falta el hallazgo.',
      );
      return;
    }

    this.guardando.set(true);
    this.error.set(null);
    this.aviso.set('');
    const nota = this.nota().trim();
    this.api
      .registrarMedicion(this.consultorioId(), this.sesionId(), definicion.id, this.lado(), {
        ...valor,
        nota: nota === '' ? undefined : nota,
      })
      .subscribe({
        next: () => {
          this.guardando.set(false);
          this.aviso.set(`Medición registrada: ${definicion.name ?? 'medida'}.`);
          this.limpiarValor();
          this.cargar();
        },
        error: (error: unknown) => this.fallo(error),
      });
  }

  /** Borra una medida cargada por error. El lado es parte de la clave: la otra no se toca. */
  protected quitar(medida: MedicionComparada): void {
    if (medida.definicionId === undefined) {
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    this.aviso.set('');
    this.api
      .borrarMedicion(
        this.consultorioId(),
        this.sesionId(),
        medida.definicionId,
        comoLado(medida.lateralidad),
      )
      .subscribe({
        next: () => {
          this.guardando.set(false);
          this.aviso.set(`Medición quitada: ${medida.nombre ?? 'medida'}.`);
          this.cargar();
        },
        error: (error: unknown) => this.fallo(error),
      });
  }

  private valorParaEnviar(definicion: MedicionDefinicionResponse): RegistrarMedicion | null {
    switch (definicion.tipo) {
      case MedicionDefinicionResponseTipoEnum.BOOLEANO: {
        const siNo = this.valorSiNo();
        return siNo === null ? null : { valorBooleano: siNo };
      }
      case MedicionDefinicionResponseTipoEnum.TEXTO: {
        const texto = this.valorTexto().trim();
        return texto === '' ? null : { valorTexto: texto };
      }
      default: {
        const numero = numeroDe(this.valorNumero());
        return numero === null ? null : { valorNumerico: numero };
      }
    }
  }

  private limpiarValor(): void {
    this.valorNumero.set('');
    this.valorTexto.set('');
    this.valorSiNo.set(null);
    this.nota.set('');
  }

  private fallo(error: unknown): void {
    this.guardando.set(false);
    const traducido = traducirErrorAtencion(error);
    if (CAUSAS_DE_LA_ATENCION.has(traducido.causa)) {
      this.problema.emit(error);
      return;
    }
    this.error.set(traducido);
  }
}
