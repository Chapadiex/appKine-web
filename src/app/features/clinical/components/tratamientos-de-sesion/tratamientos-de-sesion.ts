import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';

import { ClinicalApi } from '../../services/clinical-api';
import { ErrorAtencion, traducirErrorAtencion } from '../../models/atencion-errors';
import { LATERALIDADES, etiquetaDe } from '../../models/etiquetas-de-atencion';
import {
  CLAVES_SUGERIDAS,
  TIPOS_DE_PARAMETRO,
  numeroDe,
  valorLegible,
} from '../../models/examen-y-tratamiento';
import { EspacioResponse } from '../../../../api/generated/model/espacio-response';
import {
  ParametroDeTratamiento,
  ParametroDeTratamientoTipoDatoEnum,
} from '../../../../api/generated/model/parametro-de-tratamiento';
import { PracticaDeOferta } from '../../../../api/generated/model/practica-de-oferta';
import {
  RegistrarTratamiento,
  RegistrarTratamientoLateralidadEnum,
} from '../../../../api/generated/model/registrar-tratamiento';
import { Tratamiento } from '../../../../api/generated/model/tratamiento';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';

/** Causas que no son de este bloque sino de la atencion entera: las resuelve la pantalla. */
const CAUSAS_DE_LA_ATENCION = new Set(['version-vieja', 'sesion-cerrada', 'sesion-ajena']);

/** Un parametro mientras se escribe. El valor es texto hasta enviarlo: un input no da numeros. */
export interface ParametroEnEdicion {
  readonly clave: string;
  readonly tipoDato: ParametroDeTratamientoTipoDatoEnum;
  readonly valor: string;
  readonly valorSiNo: boolean | null;
  readonly unidad: string;
}

/** Parametro vacio, del tipo mas comun (numerico: intensidad, series, tiempo). */
export function parametroVacio(): ParametroEnEdicion {
  return {
    clave: '',
    tipoDato: ParametroDeTratamientoTipoDatoEnum.NUMERICO,
    valor: '',
    valorSiNo: null,
    unidad: '',
  };
}

/**
 * Convierte lo escrito al parametro del contrato, o devuelve por que no se puede.
 *
 * <p>Un parametro <b>siempre viaja con su tipo</b>: el backend rechaza uno sin `tipoDato` con 400
 * `parametro-invalido`, porque normalizar adivinando el tipo es como se cuela un valor de
 * dosificacion interpretado al reves. La unidad va <b>solo</b> en los numericos.
 */
export function parametroParaEnviar(p: ParametroEnEdicion): ParametroDeTratamiento | string {
  const clave = p.clave.trim();
  if (clave === '') {
    return 'Hay un parametro sin nombre.';
  }
  switch (p.tipoDato) {
    case ParametroDeTratamientoTipoDatoEnum.NUMERICO: {
      const numero = numeroDe(p.valor);
      if (numero === null) {
        return `El parametro «${clave}» es numerico y su valor no es un numero.`;
      }
      const unidad = p.unidad.trim();
      return {
        clave,
        tipoDato: p.tipoDato,
        valorNumerico: numero,
        unidad: unidad === '' ? undefined : unidad,
      };
    }
    case ParametroDeTratamientoTipoDatoEnum.BOOLEANO:
      if (p.valorSiNo === null) {
        return `Falta decir si o no en «${clave}».`;
      }
      return { clave, tipoDato: p.tipoDato, valorBooleano: p.valorSiNo };
    default: {
      const texto = p.valor.trim();
      if (texto === '') {
        return `Falta el valor de «${clave}».`;
      }
      return { clave, tipoDato: p.tipoDato, valorTexto: texto };
    }
  }
}

/** Convierte una lista de parametros, o devuelve el primer motivo por el que no se puede. */
export function parametrosParaEnviar(
  lista: readonly ParametroEnEdicion[],
): ParametroDeTratamiento[] | string {
  const enviables: ParametroDeTratamiento[] = [];
  for (const parametro of lista) {
    const convertido = parametroParaEnviar(parametro);
    if (typeof convertido === 'string') {
      return convertido;
    }
    enviables.push(convertido);
  }
  return enviables;
}

/**
 * Tratamientos realizados en la atencion (AKINE-06.04, RF-M14-005, `plan_sesiones.txt` §10).
 *
 * <h2>Planificado no es realizado</h2>
 *
 * <p>Esto asienta <b>lo que se hizo</b>, y no mueve el Plan de Tratamiento (RN-M14-004). La
 * practica sale de las que la <b>oferta</b> del turno declara (DP-11): asentar una que la oferta
 * no incluye es 409 `practica-no-habilitada-en-oferta`, y ofrecerla seria ofrecer un rechazo.
 *
 * <h2>Cada escritura hace avanzar la version de la SESION</h2>
 *
 * <p>Y el autosave de las notas sostiene esa misma version. Por eso este bloque no la guarda: la
 * recibe de la pantalla, manda la que la pantalla tiene, y le devuelve la nueva con
 * {@link versionCambio}. Si la guardara por su cuenta, el proximo autosave de las notas comeria un
 * 409 que nadie provoco. Mientras una escritura esta en vuelo lo avisa con {@link enVuelo}, para
 * que el autosave espere en vez de competir con la misma version.
 *
 * <p>Los conflictos de version, de propiedad y de cierre <b>no se resuelven aca</b>: son de la
 * atencion entera y van a la pantalla con {@link problema}, que ya sabe releer sin perder nada.
 *
 * <h2>Parametros tipados, sin esquema por practica</h2>
 *
 * <p>Cada parametro lleva su tipo. Que parametros corresponden a cada practica es una decision
 * abierta (pendiente 11): las claves se sugieren y no se imponen.
 *
 * <h2>Baja con motivo, nunca borrado</h2>
 *
 * <p>Dar de baja exige motivo y no libera el orden. La respuesta trae la version nueva de la
 * sesion, igual que el alta.
 */
@Component({
  imports: [Ayuda],
  selector: 'app-tratamientos-de-sesion',
  templateUrl: './tratamientos-de-sesion.html',
  styleUrl: '../../atencion.css',
})
export class TratamientosDeSesion {
  private readonly api = inject(ClinicalApi);

  readonly consultorioId = input.required<number>();
  readonly organizationId = input<number | null>(null);
  readonly sesionId = input.required<number>();
  /** Oferta del turno. Sin ella no hay practicas que ofrecer. */
  readonly ofertaId = input<number | undefined>(undefined);
  /** Version de la SESION que la pantalla leyo. Viaja en cada escritura. */
  readonly version = input(0);
  /** `false` en una sesion cerrada: se lee y no se escribe. */
  readonly editable = input(true);
  /** `true` mientras la pantalla guarda otra cosa con la misma version. */
  readonly ocupado = input(false);

  readonly versionCambio = output<number>();
  readonly problema = output<unknown>();
  readonly enVuelo = output<boolean>();

  protected readonly lateralidades = LATERALIDADES;
  protected readonly tipos = TIPOS_DE_PARAMETRO;
  protected readonly claves = CLAVES_SUGERIDAS;
  protected readonly Tipo = ParametroDeTratamientoTipoDatoEnum;
  protected readonly valorLegible = valorLegible;

  protected readonly tratamientos = signal<readonly Tratamiento[]>([]);
  protected readonly practicas = signal<readonly PracticaDeOferta[]>([]);
  protected readonly espacios = signal<readonly EspacioResponse[]>([]);
  protected readonly cargando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly error = signal<ErrorAtencion | null>(null);
  protected readonly aviso = signal('');

  // --- Formulario de una intervencion -----------------------------------------------------
  protected readonly practicaId = signal<number | null>(null);
  protected readonly tecnica = signal('');
  protected readonly zona = signal('');
  protected readonly lateralidad = signal<string | null>(null);
  protected readonly duracion = signal('');
  protected readonly espacioId = signal<number | null>(null);
  protected readonly observacion = signal('');
  protected readonly parametros = signal<readonly ParametroEnEdicion[]>([]);

  // --- Baja ------------------------------------------------------------------------------
  protected readonly dandoDeBaja = signal<number | null>(null);
  protected readonly motivoBaja = signal('');

  protected readonly faltaZona = computed(
    () => this.lateralidad() !== null && this.zona().trim() === '',
  );

  protected readonly bloqueado = computed(() => this.guardando() || this.ocupado());

  constructor() {
    effect(() => {
      this.sesionId();
      this.consultorioId();
      this.ofertaId();
      untracked(() => this.cargar());
    });
  }

  protected cargar(): void {
    const consultorioId = this.consultorioId();
    const sesionId = this.sesionId();
    this.cargando.set(true);
    this.error.set(null);
    this.api.tratamientosDe(consultorioId, sesionId).subscribe({
      next: (lista) => {
        this.cargando.set(false);
        this.tratamientos.set(lista);
      },
      error: (error: unknown) => {
        this.cargando.set(false);
        this.error.set(traducirErrorAtencion(error));
      },
    });

    if (!this.editable()) {
      return;
    }
    const ofertaId = this.ofertaId();
    if (ofertaId !== undefined && this.practicas().length === 0) {
      this.api.practicasDeLaOferta(consultorioId, ofertaId).subscribe({
        next: (practicas) => {
          this.practicas.set(practicas);
          const principal = practicas.find((p) => p.principal) ?? practicas[0];
          if (this.practicaId() === null && principal?.practicaId !== undefined) {
            this.practicaId.set(principal.practicaId);
          }
        },
        error: (error: unknown) => this.error.set(traducirErrorAtencion(error)),
      });
    }
    // El espacio es opcional: si la sede no deja leerlos, se registra sin espacio.
    const organizationId = this.organizationId();
    if (organizationId !== null && this.espacios().length === 0) {
      this.api.espaciosDeLaSede(organizationId, consultorioId).subscribe({
        next: (espacios) => this.espacios.set(espacios),
        error: () => this.espacios.set([]),
      });
    }
  }

  protected etiquetaDeLateralidad(valor: string | undefined): string {
    return etiquetaDe(LATERALIDADES, valor);
  }

  protected elegirPractica(valor: string): void {
    const id = Number(valor);
    this.practicaId.set(Number.isFinite(id) && id > 0 ? id : null);
  }

  protected elegirLateralidad(valor: string): void {
    this.lateralidad.set(comoLateralidadDeTratamiento(valor));
  }

  protected elegirEspacio(valor: string): void {
    const id = Number(valor);
    this.espacioId.set(Number.isFinite(id) && id > 0 ? id : null);
  }

  // --- Parametros: siempre se reemplaza la lista, nunca se muta -------------------------

  protected agregarParametro(): void {
    this.parametros.update((lista) => [...lista, parametroVacio()]);
  }

  protected quitarParametro(indice: number): void {
    this.parametros.update((lista) => lista.filter((_, i) => i !== indice));
  }

  protected cambiarParametro(indice: number, cambio: Partial<ParametroEnEdicion>): void {
    this.parametros.update((lista) =>
      lista.map((parametro, i) => (i === indice ? { ...parametro, ...cambio } : parametro)),
    );
  }

  protected elegirTipoDeParametro(indice: number, valor: string): void {
    const tipo = TIPOS_DE_PARAMETRO.find((opcion) => opcion.valor === valor)?.valor;
    if (tipo !== undefined) {
      this.cambiarParametro(indice, { tipoDato: tipo, valor: '', valorSiNo: null, unidad: '' });
    }
  }

  /**
   * Asienta la intervencion. Los campos vacios no viajan: "no lo cargue" tiene que seguir siendo
   * distinguible de "lo cargue vacio".
   */
  protected registrar(): void {
    const practicaId = this.practicaId();
    if (practicaId === null) {
      this.aviso.set('Elegi que practica se realizo.');
      return;
    }
    const parametros = parametrosParaEnviar(this.parametros());
    if (typeof parametros === 'string') {
      this.aviso.set(parametros);
      return;
    }
    const duracionTexto = this.duracion().trim();
    const duracion = duracionTexto === '' ? null : numeroDe(duracionTexto);
    if (
      duracionTexto !== '' &&
      (duracion === null || !Number.isInteger(duracion) || duracion < 1)
    ) {
      this.aviso.set('La duracion va en minutos enteros.');
      return;
    }

    const cuerpo: RegistrarTratamiento = {
      version: this.version(),
      practicaId,
      tecnica: textoOAusente(this.tecnica()),
      zona: textoOAusente(this.zona()),
      lateralidad: comoLateralidadDeTratamiento(this.lateralidad()) ?? undefined,
      duracionMinutos: duracion ?? undefined,
      espacioId: this.espacioId() ?? undefined,
      observacion: textoOAusente(this.observacion()),
      parametros: parametros.length === 0 ? undefined : parametros,
    };

    this.empezar();
    this.api.registrarTratamiento(this.consultorioId(), this.sesionId(), cuerpo).subscribe({
      next: (tratamiento) => {
        this.terminar();
        if (tratamiento.sesionVersion !== undefined) {
          this.versionCambio.emit(tratamiento.sesionVersion);
        }
        this.tratamientos.update((lista) => [...lista, tratamiento]);
        this.aviso.set(`Tratamiento registrado: ${tratamiento.practicaNombre ?? 'practica'}.`);
        this.limpiarFormulario();
      },
      error: (error: unknown) => this.fallo(error),
    });
  }

  protected pedirBaja(tratamientoId: number | undefined): void {
    this.dandoDeBaja.set(tratamientoId ?? null);
    this.motivoBaja.set('');
    this.aviso.set('');
  }

  protected cancelarBaja(): void {
    this.dandoDeBaja.set(null);
    this.motivoBaja.set('');
  }

  /**
   * Baja logica con motivo. La respuesta trae la `sesionVersion` nueva (contrato 0.102.0) y se
   * adopta como la del alta: releer la sesion era un segundo viaje que ademas dejaba una ventana
   * en la que el autosave salia con la version vieja.
   */
  protected confirmarBaja(): void {
    const tratamientoId = this.dandoDeBaja();
    const motivo = this.motivoBaja().trim();
    if (tratamientoId === null) {
      return;
    }
    if (motivo === '') {
      this.aviso.set('Falta el motivo de la baja: sin el, la auditoria no responde por que.');
      return;
    }

    this.empezar();
    this.api
      .darDeBajaTratamiento(
        this.consultorioId(),
        this.sesionId(),
        tratamientoId,
        motivo,
        this.version(),
      )
      .subscribe({
        next: (baja) => {
          this.terminar();
          if (baja.sesionVersion !== undefined) {
            this.versionCambio.emit(baja.sesionVersion);
          }
          this.tratamientos.update((lista) => lista.filter((t) => t.id !== tratamientoId));
          this.cancelarBaja();
          this.aviso.set('Tratamiento dado de baja.');
        },
        error: (error: unknown) => this.fallo(error),
      });
  }

  private empezar(): void {
    this.guardando.set(true);
    this.error.set(null);
    this.aviso.set('');
    this.enVuelo.emit(true);
  }

  private terminar(): void {
    this.guardando.set(false);
    this.enVuelo.emit(false);
  }

  private limpiarFormulario(): void {
    this.tecnica.set('');
    this.zona.set('');
    this.lateralidad.set(null);
    this.duracion.set('');
    this.espacioId.set(null);
    this.observacion.set('');
    this.parametros.set([]);
  }

  private fallo(error: unknown): void {
    this.terminar();
    const traducido = traducirErrorAtencion(error);
    if (CAUSAS_DE_LA_ATENCION.has(traducido.causa)) {
      this.problema.emit(error);
      return;
    }
    this.error.set(traducido);
  }
}

/** Lateralidad de un tratamiento (admite BILATERAL y NO_APLICA), o `null` si no se cargo. */
export function comoLateralidadDeTratamiento(
  valor: unknown,
): RegistrarTratamientoLateralidadEnum | null {
  return (
    Object.values(RegistrarTratamientoLateralidadEnum).find((opcion) => opcion === valor) ?? null
  );
}

/** Texto recortado, o `undefined` para que la clave no viaje. */
function textoOAusente(valor: string): string | undefined {
  const limpio = valor.trim();
  return limpio === '' ? undefined : limpio;
}
