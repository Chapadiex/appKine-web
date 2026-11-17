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
import { LATERALIDADES, ZONAS_SUGERIDAS, etiquetaDe } from '../../models/etiquetas-de-atencion';
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
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Icono } from '../../../../shared/components/icono/icono';
import { concatMap, from, tap, toArray } from 'rxjs';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { Chips, OpcionChip } from '../../../../shared/components/chips/chips';
import { NumeroConPasos } from '../../../../shared/components/numero-con-pasos/numero-con-pasos';
import { Segmentado } from '../../../../shared/components/segmentado/segmentado';
import { TextoOpcional } from '../../../../shared/components/texto-opcional/texto-opcional';

/** Causas que no son de este bloque sino de la atencion entera: las resuelve la pantalla. */
const CAUSAS_DE_LA_ATENCION = new Set(['version-vieja', 'sesion-cerrada', 'sesion-ajena']);

/** Un parametro mientras se escribe. El valor es texto hasta enviarlo: un input no da numeros. */
export interface ParametroEnEdicion {
  readonly clave: string;
  readonly tipoDato: ParametroDeTratamientoTipoDatoEnum;
  readonly valor: string;
  readonly valorSiNo: boolean | null;
  readonly unidad: string;
  /** Eligio "Otro…": el nombre se escribe a mano en vez de salir de la lista. */
  readonly libre?: boolean;
}

/** Valor de la opcion "Otro…" del nombre de parametro. */
const OTRO_NOMBRE = '__otro__';

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
        return `El parametro «${clave}» es numerico y su valor no es un número.`;
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
  imports: [Alerta, Ayuda, EstadoVacio, Icono, Chips, NumeroConPasos, Segmentado, TextoOpcional],
  selector: 'app-tratamientos-de-sesion',
  templateUrl: './tratamientos-de-sesion.html',
  styleUrls: ['../../atencion.css', '../examen-tactil.css'],
})
export class TratamientosDeSesion {
  private readonly api = inject(ClinicalApi);
  private readonly avisos = inject(AvisosStore);

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

  /**
   * Zonas marcadas arriba, en la evaluacion de dolor (13/11/2026): son las que se ofrecen para el
   * tratamiento. Sin ninguna, se ofrecen las sugeridas.
   */
  readonly zonasDeLaEvaluacion = input<readonly string[]>([]);

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
  /** Que fallo: leer, registrar o dar de baja. Decide el titulo y donde se ve (UX-12). */
  protected readonly origenDelError = signal<'leer' | 'registrar' | 'baja'>('leer');
  /**
   * Lo que falta para mandar, y de que formulario: se dice junto a lo que hay que corregir, no en
   * un aviso al pie (UX-12). Lo que sale bien es un aviso global.
   */
  protected readonly aviso = signal('');
  protected readonly avisoDe = signal<'registrar' | 'baja'>('registrar');

  // --- Formulario de una intervencion -----------------------------------------------------
  protected readonly practicaId = signal<number | null>(null);
  protected readonly tecnica = signal('');
  protected readonly zona = signal('');
  protected readonly lateralidad = signal<string | null>(null);
  protected readonly duracion = signal('');
  protected readonly duracionInvalida = signal(false);
  protected readonly duracionNumero = computed(() => numeroDe(this.duracion()));

  // --- Modo táctil (16/11/2026) ------------------------------------------------------------
  protected readonly opcionesDeLado: readonly OpcionChip[] = LATERALIDADES.map((o) => ({
    valor: o.valor,
    etiqueta:
      o.valor === 'IZQUIERDA'
        ? 'Izq'
        : o.valor === 'DERECHA'
          ? 'Der'
          : o.valor === 'BILATERAL'
            ? 'Ambos'
            : 'No aplica',
  }));
  protected readonly opcionesSiNo: readonly OpcionChip[] = [
    { valor: 'si', etiqueta: 'Sí' },
    { valor: 'no', etiqueta: 'No' },
  ];

  protected textoDe(valor: string | readonly string[] | null): string {
    return typeof valor === 'string' ? valor : '';
  }

  protected numeroDeTexto(texto: string): number | null {
    return numeroDe(texto);
  }

  /** Enter en un campo de texto registra; en los botones −/+ no. */
  protected enterEnCampo(evento: Event): void {
    if (evento.target instanceof HTMLInputElement) {
      this.registrar();
    }
  }
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
    this.origenDelError.set('leer');
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

  /** Nombre del parametro desde la lista; "Otro…" deja escribirlo a mano. */
  protected elegirNombreDeParametro(indice: number, valor: string): void {
    this.cambiarParametro(
      indice,
      valor === OTRO_NOMBRE ? { clave: '', libre: true } : { clave: valor, libre: false },
    );
  }

  protected nombreLibre(parametro: ParametroEnEdicion): boolean {
    return (
      parametro.libre === true ||
      (parametro.clave !== '' && !(this.claves as readonly string[]).includes(parametro.clave))
    );
  }

  protected readonly otroNombre = OTRO_NOMBRE;

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
  /** Las zonas que se ofrecen como botones: las de la evaluacion, o las sugeridas. */
  protected readonly zonasOfrecidas = computed(() =>
    this.zonasDeLaEvaluacion().length > 0 ? this.zonasDeLaEvaluacion() : ZONAS_SUGERIDAS,
  );

  /** Zonas elegidas para el tratamiento: se pueden marcar varias. */
  protected readonly zonasElegidas = computed(() =>
    this.zona()
      .split(',')
      .map((zona) => zona.trim())
      .filter((zona) => zona !== ''),
  );

  /** Lo escrito en "Otra": las elegidas que no estan entre las ofrecidas. */
  protected readonly otraZona = computed(() =>
    this.zonasElegidas()
      .filter((zona) => !this.zonasOfrecidas().includes(zona))
      .join(', '),
  );

  protected alternarZona(zona: string): void {
    const elegidas = this.zonasElegidas();
    this.zona.set(
      (elegidas.includes(zona) ? elegidas.filter((z) => z !== zona) : [...elegidas, zona]).join(
        ', ',
      ),
    );
  }

  protected escribirOtraZona(texto: string): void {
    const ofrecidas = this.zonasElegidas().filter((z) => this.zonasOfrecidas().includes(z));
    this.zona.set([...ofrecidas, ...(texto.trim() === '' ? [] : [texto.trim()])].join(', '));
  }

  protected registrar(): void {
    const practicaId = this.practicaId();
    this.avisoDe.set('registrar');
    if (practicaId === null) {
      this.aviso.set('Elegí que práctica se realizo.');
      return;
    }
    const parametros = parametrosParaEnviar(this.parametros());
    if (typeof parametros === 'string') {
      this.aviso.set(parametros);
      return;
    }
    if (this.duracionInvalida()) {
      this.aviso.set('La duración va en minutos enteros.');
      return;
    }
    const duracionTexto = this.duracion().trim();
    const duracion = duracionTexto === '' ? null : numeroDe(duracionTexto);
    if (
      duracionTexto !== '' &&
      (duracion === null || !Number.isInteger(duracion) || duracion < 1)
    ) {
      this.aviso.set('La duración va en minutos enteros.');
      return;
    }

    // Una zona por registro (13/11/2026): con dos zonas marcadas se cargan dos tratamientos
    // iguales, uno para cada una. Sin zona, uno solo.
    const lateralidad = comoLateralidadDeTratamiento(this.lateralidad()) ?? undefined;
    const pedidas: readonly (string | undefined)[] =
      this.zonasElegidas().length > 0 ? this.zonasElegidas() : [undefined];
    // Sin repetidos (13/11/2026): la misma practica en la misma zona y del mismo lado ya cargada
    // no se vuelve a registrar. "No aplica" y sin lado cuentan como lo mismo.
    const zonas = pedidas.filter((zona) => !this.yaRegistrado(practicaId, zona, lateralidad));
    if (zonas.length === 0) {
      this.aviso.set(
        pedidas.length === 1
          ? 'Ese tratamiento ya está cargado en esta sesión.'
          : 'Esos tratamientos ya están cargados en esta sesión.',
      );
      return;
    }
    const salteadas = pedidas.length - zonas.length;
    const cuerpo: Omit<RegistrarTratamiento, 'version' | 'zona'> = {
      practicaId,
      tecnica: textoOAusente(this.tecnica()),
      lateralidad,
      duracionMinutos: duracion ?? undefined,
      espacioId: this.espacioId() ?? undefined,
      observacion: textoOAusente(this.observacion()),
      parametros: parametros.length === 0 ? undefined : parametros,
    };

    // En serie: cada alta mueve la version de la sesion y la siguiente tiene que mandar la nueva.
    let version = this.version();
    this.empezar('registrar');
    from(zonas)
      .pipe(
        concatMap((zona) =>
          this.api
            .registrarTratamiento(this.consultorioId(), this.sesionId(), {
              ...cuerpo,
              version,
              zona,
            })
            .pipe(
              tap((tratamiento) => {
                if (tratamiento.sesionVersion !== undefined) {
                  version = tratamiento.sesionVersion;
                  this.versionCambio.emit(version);
                }
                this.tratamientos.update((lista) => [...lista, tratamiento]);
              }),
            ),
        ),
        toArray(),
      )
      .subscribe({
        next: (registrados) => {
          this.terminar();
          this.avisos.exito(
            registrados.length === 1 ? 'Tratamiento registrado' : 'Tratamientos registrados',
            {
              descripcion:
                registrados.length === 1
                  ? (registrados[0].practicaNombre ?? 'practica')
                  : `${registrados.length}: uno por zona.`,
            },
          );
          if (salteadas > 0) {
            this.avisos.info('Sin repetir', {
              descripcion: `${salteadas} ${salteadas === 1 ? 'zona ya tenía' : 'zonas ya tenían'} ese tratamiento.`,
            });
          }
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
      this.avisoDe.set('baja');
      this.aviso.set('Falta el motivo de la baja: sin el, la auditoria no responde por que.');
      return;
    }

    this.empezar('baja');
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
          this.avisos.exito('Tratamiento dado de baja');
        },
        error: (error: unknown) => this.fallo(error),
      });
  }

  private empezar(origen: 'registrar' | 'baja'): void {
    this.guardando.set(true);
    this.error.set(null);
    this.origenDelError.set(origen);
    this.aviso.set('');
    this.enVuelo.emit(true);
  }

  private terminar(): void {
    this.guardando.set(false);
    this.enVuelo.emit(false);
  }

  private yaRegistrado(
    practicaId: number,
    zona: string | undefined,
    lateralidad?: string,
  ): boolean {
    const lado = (valor?: string) => (valor && valor !== 'NO_APLICA' ? valor : '');
    const lugar = (valor?: string) => (valor ?? '').trim().toLowerCase();
    return this.tratamientos().some(
      (t) =>
        t.practicaId === practicaId &&
        lugar(t.zona) === lugar(zona) &&
        lado(t.lateralidad) === lado(lateralidad),
    );
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
