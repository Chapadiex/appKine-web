import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { FichaDeIngresoRequest } from '../../../../api/generated/model/ficha-de-ingreso-request';
import { FichaDeIngresoResponse } from '../../../../api/generated/model/ficha-de-ingreso-response';
import { OcupacionResponse } from '../../../../api/generated/model/ocupacion-response';
import { BuscadorConAlta } from '../../../../shared/components/buscador-con-alta/buscador-con-alta';
import { OpcionChip } from '../../../../shared/components/chips/chips';
import { NumeroConPasos } from '../../../../shared/components/numero-con-pasos/numero-con-pasos';
import { Segmentado } from '../../../../shared/components/segmentado/segmentado';
import { TextoOpcional } from '../../../../shared/components/texto-opcional/texto-opcional';

/** Las diez enfermedades que pregunta la ficha (lista del producto, `EnfermedadDeIngreso`). */
export const ENFERMEDADES_DE_INGRESO: readonly (readonly [string, string])[] = [
  ['DIABETES', 'Diabetes'],
  ['HIPERTENSION', 'Hipertensión'],
  ['CARDIOPATIA', 'Cardiopatía'],
  ['MARCAPASOS', 'Marcapasos'],
  ['OSTEOPOROSIS', 'Osteoporosis'],
  ['ANTICOAGULADO', 'Anticoagulado'],
  ['EMBARAZO', 'Embarazo'],
  ['CANCER', 'Cáncer'],
  ['EPILEPSIA', 'Epilepsia'],
  ['RESPIRATORIA', 'Asma / EPOC'],
];

const ACTIVIDADES: readonly OpcionChip[] = [
  { valor: 'SEDENTARIO', etiqueta: 'Sedentario' },
  { valor: 'OCASIONAL', etiqueta: 'Ocasional' },
  { valor: 'REGULAR', etiqueta: 'Regular' },
  { valor: 'DEPORTISTA', etiqueta: 'Deportista' },
];

/**
 * Condiciones habituales en kinesiologia que el enum del backend no tiene. Se tildan igual que las
 * de arriba y se guardan como antecedente medico con este nombre (sin codigo): no piden contrato.
 */
export const CONDICIONES_TIPICAS: readonly string[] = [
  'Artrosis',
  'Artritis',
  'Hernia de disco',
  'Escoliosis',
  'Fibromialgia',
  'Prótesis / implante',
  'Celiaquía',
  'Depresión / ansiedad',
];

/** Un antecedente medico sin codigo: una condicion tipica tildada o una "Otra". */
export interface CondicionSuelta {
  readonly id: number;
  readonly descripcion: string;
  /** Revisada por un profesional: no se destilda desde aca. */
  readonly fija: boolean;
}

/** Tildar o destildar una condicion sin codigo. Al destildar trae el id a dar de baja. */
export interface TildeSuelto {
  readonly descripcion: string;
  readonly id: number | null;
  readonly marcado: boolean;
}

export interface TildeDeEnfermedad {
  codigo: string;
  etiqueta: string;
  marcado: boolean;
}

/**
 * Ficha de ingreso compacta: ocupacion, peso, altura (IMC), actividad y diez enfermedades para
 * tildar. Guarda campo por campo: cada cambio emite la ficha entera con la version leida. No sabe
 * de API: la pagina resuelve las salidas.
 */
@Component({
  selector: 'app-ficha-de-ingreso',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, BuscadorConAlta, NumeroConPasos, Segmentado, TextoOpcional],
  templateUrl: './ficha-de-ingreso.html',
  styleUrl: './ficha-de-ingreso.css',
})
export class FichaDeIngreso {
  readonly ficha = input<FichaDeIngresoResponse | null>(null);
  readonly ocupaciones = input<readonly OcupacionResponse[]>([]);
  /** Codigos de enfermedad vigentes en lo que esta pantalla puede ver. */
  readonly enfermedadesTildadas = input<ReadonlySet<string>>(new Set());
  /** Codigos que ya no se destildan desde aca (revisados por un profesional). */
  readonly enfermedadesFijas = input<ReadonlySet<string>>(new Set());
  readonly guardando = input(false);
  /** Sin permiso de escritura: se ve y no se edita. */
  readonly soloLectura = input(false);
  /** Por que una enfermedad tildada no se puede destildar aca. */
  readonly motivoFijo = input('Ya registrado: se da de baja desde los antecedentes');

  readonly guardar = output<FichaDeIngresoRequest>();
  readonly agregarOcupacion = output<string>();
  readonly tildar = output<TildeDeEnfermedad>();
  /** Muestra las condiciones tipicas y "Otra" (datos declarados). */
  readonly conOtraCondicion = input(false);
  /** Antecedentes medicos sin codigo vigentes: tipicas tildadas y las "Otra". */
  readonly condicionesSueltas = input<readonly CondicionSuelta[]>([]);
  /** Una condición que no está en la lista: la página la carga como antecedente médico. */
  readonly otraCondicion = output<string>();
  /** Tildar o destildar una condicion tipica o una "Otra". */
  readonly tildarSuelta = output<TildeSuelto>();

  /** Las tipicas, con su tilde segun lo declarado. */
  protected readonly condicionesTipicas = computed(() =>
    CONDICIONES_TIPICAS.map((etiqueta) => {
      const vigente = this.condicionesSueltas().find(
        (c) => normalizar(c.descripcion) === normalizar(etiqueta),
      );
      return { etiqueta, marcada: !!vigente, id: vigente?.id ?? null, fija: !!vigente?.fija };
    }),
  );

  /** Las "Otra" ya cargadas: las sueltas que no son ninguna tipica. */
  protected readonly otrasMarcadas = computed(() => {
    const tipicas = new Set(CONDICIONES_TIPICAS.map(normalizar));
    return this.condicionesSueltas().filter((c) => !tipicas.has(normalizar(c.descripcion)));
  });

  protected readonly enfermedades = ENFERMEDADES_DE_INGRESO;
  protected readonly actividades = ACTIVIDADES;
  protected readonly ocupacion = new FormControl<string>('', { nonNullable: true });

  protected readonly peso = signal<number | null>(null);
  protected readonly altura = signal<number | null>(null);
  protected readonly actividad = signal('');
  /** El detalle de la actividad se guarda en un solo texto: "Fútbol · 2 veces por semana". */
  protected readonly queHace = signal('');
  protected readonly veces = signal<number | null>(null);

  /** "Guardando…" mientras viaja; "Guardado" despues del primer guardado de esta visita. */
  private readonly guardoAlgo = signal(false);
  protected readonly estadoDeGuardado = computed(() =>
    this.guardando() ? 'Guardando…' : this.guardoAlgo() ? 'Guardado' : '',
  );

  protected readonly nombresDeOcupacion = computed(() => this.ocupaciones().map((o) => o.nombre));

  /** IMC de lo que hay escrito, para verlo sin esperar al servidor. */
  protected readonly imc = computed(() => {
    const peso = this.peso();
    const altura = (this.altura() ?? 0) / 100;
    if (!peso || !altura) {
      return null;
    }
    const valor = peso / (altura * altura);
    const [categoria, tono] =
      valor < 18.5
        ? ['Bajo peso', 'aviso']
        : valor < 25
          ? ['Normal', 'exito']
          : valor < 30
            ? ['Sobrepeso', 'aviso']
            : ['Obesidad', 'peligro'];
    return { valor: valor.toFixed(1).replace('.', ','), categoria, tono };
  });

  /** Peso o altura escritos de una forma que no es un numero: no se guarda hasta corregirlo. */
  private readonly pesoInvalido = signal(false);
  private readonly alturaInvalida = signal(false);
  protected readonly numeroInvalido = computed(() =>
    this.pesoInvalido() || this.alturaInvalida()
      ? 'Escribí peso y altura sólo con números, por ejemplo 72,5.'
      : null,
  );

  constructor() {
    effect(() => {
      if (this.soloLectura()) {
        this.ocupacion.disable({ emitEvent: false });
      } else {
        this.ocupacion.enable({ emitEvent: false });
      }
    });
    effect(() => {
      const ficha = this.ficha();
      const guardando = this.guardando();
      untracked(() => {
        if (ficha !== this.ultima) {
          this.sincronizar(this.ultima, ficha);
          this.ultima = ficha;
        }
        // Termino un guardado: lo que se cambio mientras viajaba sale ahora, con la version nueva.
        // Si fallo, la pagina ya llamo a `fallo()` y no queda nada en cola.
        if (this.guardandoAntes && !guardando) {
          this.enviando = false;
          this.guardoAlgo.set(true);
          if (this.pendiente !== null) {
            const cambio = this.pendiente;
            this.pendiente = null;
            this.emitir(cambio);
          }
        }
        this.guardandoAntes = guardando;
      });
    });
  }

  private ultima: FichaDeIngresoResponse | null = null;
  private pendiente: Partial<FichaDeIngresoRequest> | null = null;
  private guardandoAntes = false;
  /**
   * Un guardado emitido que la pagina todavia no reflejo en `guardando`: el input recien cambia en
   * la proxima deteccion de cambios, y dos toques en el mismo instante (salir de un numero y tocar
   * un chip) mandaban dos PUT con la misma version: el segundo moria en 409.
   */
  private enviando = false;

  /** La pagina avisa que el ultimo guardado fallo: lo que estaba en cola se descarta. */
  fallo(): void {
    this.pendiente = null;
    this.enviando = false;
  }

  /**
   * Lo dictado de la ficha (Dictar todo): lo lleva a los campos y lo guarda como si se hubiera
   * escrito. La ocupacion pasa por el mismo camino que elegirla en el buscador.
   */
  aplicarDictado(dictado: {
    readonly ocupacion?: string;
    readonly pesoKg?: number;
    readonly alturaCm?: number;
    readonly actividad?: string;
    readonly detalle?: string;
  }): void {
    if (this.soloLectura()) {
      return;
    }
    if (dictado.pesoKg !== undefined) {
      this.pesoInvalido.set(false);
      this.peso.set(dictado.pesoKg);
    }
    if (dictado.alturaCm !== undefined) {
      this.alturaInvalida.set(false);
      this.altura.set(dictado.alturaCm);
    }
    if (dictado.actividad !== undefined) {
      this.actividad.set(dictado.actividad);
    }
    if (dictado.detalle !== undefined) {
      const partes = partirDetalle(dictado.detalle);
      this.queHace.set(partes.queHace);
      this.veces.set(partes.veces ?? this.veces());
    }
    this.salirDeCampo();
    if (dictado.ocupacion) {
      this.ocupacion.setValue(dictado.ocupacion, { emitEvent: false });
      this.elegirOcupacion(dictado.ocupacion);
    }
  }

  /** Lo llama la pagina despues de crear la ocupacion. */
  guardarOcupacion(ocupacionId: number): void {
    this.emitir({ ocupacionId });
  }

  protected elegirOcupacion(nombre: string): void {
    const existente = this.ocupaciones().find((o) => normalizar(o.nombre) === normalizar(nombre));
    if (existente) {
      if (existente.id !== this.ficha()?.ocupacionId) {
        this.emitir({ ocupacionId: existente.id });
      }
      return;
    }
    if (nombre.trim()) {
      this.agregarOcupacion.emit(nombre.trim());
    }
  }

  protected marcarInvalido(campo: 'peso' | 'altura', invalido: boolean): void {
    (campo === 'peso' ? this.pesoInvalido : this.alturaInvalida).set(invalido);
  }

  protected elegirActividad(valor: string | null): void {
    this.actividad.set(valor ?? '');
    this.salirDeCampo();
  }

  protected salirDeCampo(): void {
    if (this.numeroInvalido() !== null) {
      return;
    }
    const actual = this.ficha();
    const cambio =
      (this.peso() ?? undefined) !== (actual?.pesoKg ?? undefined) ||
      (this.altura() ?? undefined) !== (actual?.alturaCm ?? undefined) ||
      this.actividad() !== (actual?.actividad ?? '') ||
      this.detalleCompuesto() !== (actual?.detalle ?? '');
    if (cambio) {
      this.emitir({});
    }
  }

  protected enviarOtra(campo: HTMLInputElement): void {
    this.enviarTexto(campo, (texto) => this.otraCondicion.emit(texto));
  }

  protected alTildarSuelta(descripcion: string, id: number | null, evento: Event): void {
    this.tildarSuelta.emit({
      descripcion,
      id,
      marcado: (evento.target as HTMLInputElement).checked,
    });
  }

  private detalleCompuesto(): string {
    return componerDetalle(this.queHace(), this.veces());
  }

  private enviarTexto(campo: HTMLInputElement, emitir: (texto: string) => void): void {
    const texto = campo.value.trim();
    if (texto) {
      emitir(texto.charAt(0).toUpperCase() + texto.slice(1));
      campo.value = '';
    }
  }

  protected alTildar(codigo: string, etiqueta: string, evento: Event): void {
    this.tildar.emit({ codigo, etiqueta, marcado: (evento.target as HTMLInputElement).checked });
  }

  /**
   * Lleva a los campos lo que volvio del servidor sin pisar lo que se esta escribiendo: solo cambia
   * un campo cuyo valor sigue igual al de la ficha anterior.
   */
  private sincronizar(antes: FichaDeIngresoResponse | null, ahora: FichaDeIngresoResponse | null) {
    const ocupacionEnEdicion = document.activeElement?.id === 'ficha-ocupacion';
    if (!ocupacionEnEdicion) {
      this.ocupacion.setValue(ahora?.ocupacionNombre ?? '', { emitEvent: false });
    }
    for (const [campo, previo, nuevo] of [
      [this.peso, antes?.pesoKg, ahora?.pesoKg],
      [this.altura, antes?.alturaCm, ahora?.alturaCm],
    ] as const) {
      if ((campo() ?? undefined) === (previo ?? undefined)) {
        campo.set(nuevo ?? null);
      }
    }
    if (this.actividad() === (antes?.actividad ?? '')) {
      this.actividad.set(ahora?.actividad ?? '');
    }
    if (this.detalleCompuesto() === (antes?.detalle ?? '')) {
      const partes = partirDetalle(ahora?.detalle ?? '');
      this.queHace.set(partes.queHace);
      this.veces.set(partes.veces);
    }
  }

  /**
   * Emite la ficha entera con la version leida. Con un guardado en viaje no sale: queda pendiente y
   * se manda cuando ese guardado termina bien, asi dos campos seguidos no chocan con un 409.
   */
  private emitir(cambio: Partial<FichaDeIngresoRequest>): void {
    if (this.guardando() || this.enviando) {
      this.pendiente = { ...this.pendiente, ...cambio };
      return;
    }
    const actual = this.ficha();
    this.guardar.emit({
      ocupacionId: actual?.ocupacionId,
      pesoKg: this.peso() ?? undefined,
      alturaCm: this.altura() ?? undefined,
      actividad: (this.actividad() || undefined) as FichaDeIngresoRequest['actividad'],
      detalle: this.detalleCompuesto() || undefined,
      version: actual?.version,
      ...cambio,
    });
    this.enviando = true;
  }
}

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

const VECES_POR_SEMANA =
  /\s*(?:·\s*)?(\d{1,2})\s*(?:o\s*\d{1,2}\s*)?(?:vez|veces)\s*(?:por|a la|x)\s*semana\s*/i;

/** "Fútbol · 2 veces por semana" a partir de los dos campos. */
export function componerDetalle(queHace: string, veces: number | null): string {
  const frecuencia = veces ? `${veces} ${veces === 1 ? 'vez' : 'veces'} por semana` : '';
  return [queHace.trim(), frecuencia].filter(Boolean).join(' · ').slice(0, 120);
}

/** Separa del detalle guardado (o dictado) cuántas veces por semana y qué hace. */
export function partirDetalle(detalle: string): { queHace: string; veces: number | null } {
  const hallado = VECES_POR_SEMANA.exec(detalle);
  if (!hallado) {
    return { queHace: detalle.trim(), veces: null };
  }
  const resto = (
    detalle.slice(0, hallado.index) +
    ' ' +
    detalle.slice(hallado.index + hallado[0].length)
  )
    .replace(/\s*·\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const queHace = resto.replace(/^(realiza|hace|practica)\s+/i, '');
  return {
    queHace: queHace.charAt(0).toUpperCase() + queHace.slice(1),
    veces: Number(hallado[1]),
  };
}
