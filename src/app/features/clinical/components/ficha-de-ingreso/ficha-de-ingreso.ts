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
import { Chips, OpcionChip } from '../../../../shared/components/chips/chips';
import { NumeroConPasos } from '../../../../shared/components/numero-con-pasos/numero-con-pasos';
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
  imports: [ReactiveFormsModule, BuscadorConAlta, Chips, NumeroConPasos, TextoOpcional],
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
  /** Muestra el boton "Revisado" (pantalla del profesional). */
  readonly puedeRevisar = input(false);
  /** Sin permiso de escritura: se ve y no se edita. */
  readonly soloLectura = input(false);
  /** Por que una enfermedad tildada no se puede destildar aca. */
  readonly motivoFijo = input('Revisado: se cambia desde la historia clínica');

  readonly guardar = output<FichaDeIngresoRequest>();
  readonly agregarOcupacion = output<string>();
  readonly tildar = output<TildeDeEnfermedad>();
  readonly revisar = output<void>();

  protected readonly enfermedades = ENFERMEDADES_DE_INGRESO;
  protected readonly actividades = ACTIVIDADES;
  protected readonly ocupacion = new FormControl<string>('', { nonNullable: true });

  protected readonly peso = signal<number | null>(null);
  protected readonly altura = signal<number | null>(null);
  protected readonly actividad = signal('');
  protected readonly detalle = signal('');

  protected readonly nombresDeOcupacion = computed(() => this.ocupaciones().map((o) => o.nombre));

  /** IMC de lo que hay escrito, para verlo sin esperar al servidor. */
  protected readonly imc = computed(() => {
    const peso = this.peso();
    const altura = (this.altura() ?? 0) / 100;
    if (!peso || !altura) {
      return null;
    }
    return (peso / (altura * altura)).toFixed(1).replace('.', ',');
  });

  protected readonly sinRevisar = computed(() => {
    const ficha = this.ficha();
    return ficha !== null && ficha.origen === 'DECLARADO' && !ficha.revisadoEn;
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

  protected elegirActividad(valor: string | readonly string[] | null): void {
    this.actividad.set(typeof valor === 'string' ? valor : '');
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
      this.detalle().trim() !== (actual?.detalle ?? '');
    if (cambio) {
      this.emitir({});
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
    if (this.detalle().trim() === (antes?.detalle ?? '')) {
      this.detalle.set(ahora?.detalle ?? '');
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
      detalle: this.detalle().trim() || undefined,
      version: actual?.version,
      ...cambio,
    });
    this.enviando = true;
  }
}

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
}
