import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';

import { Icono } from '../../../../shared/components/icono/icono';
import { ErrorDictado } from '../../../../shared/dictado/dictado-errors';
import { DictadoStore, MAXIMO_DE_GRABACION_MS } from '../../../../shared/dictado/dictado.store';
import { TIPOS_DE_ANTECEDENTE } from '../../models/etiquetas-de-historia';
import { FichaDictada, interpretarDictadoDeFicha } from '../../models/dictado-de-ficha';
import { ENFERMEDADES_DE_INGRESO } from '../ficha-de-ingreso/ficha-de-ingreso';

type Paso = 'reposo' | 'grabando' | 'procesando' | 'revision';

/** Una línea de lo entendido, con la casilla que decide si se carga. */
interface Fila {
  readonly clave: string;
  readonly rotulo: string;
  readonly valor: string;
}

const ACTIVIDADES: Readonly<Record<string, string>> = {
  SEDENTARIO: 'Sedentario',
  OCASIONAL: 'Ocasional',
  REGULAR: 'Regular',
  DEPORTISTA: 'Deportista',
};

/**
 * Dictar todos los datos declarados de una vez: se graba recorriendo la pantalla ("ocupación
 * programador, peso 80, tiene diabetes, antecedentes…"), el servidor transcribe, la pantalla
 * reparte lo dicho con reglas y muestra lo que entendió, todo marcado. La persona destilda lo que
 * no va y carga el resto con un clic. No guarda nada por sí mismo: emite lo elegido.
 */
@Component({
  selector: 'app-dictado-de-ficha',
  imports: [Icono],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dictado-de-ficha.html',
  styleUrl: './dictado-de-ficha.css',
})
export class DictadoDeFicha {
  /** Lo marcado, para que la pantalla lo guarde. */
  readonly cargar = output<FichaDictada>();
  /** Un error para mostrar. */
  readonly problema = output<string>();

  protected readonly dictado = inject(DictadoStore);

  private readonly procesando = signal(false);
  protected readonly texto = signal('');
  private readonly entendido = signal<FichaDictada | null>(null);
  protected readonly marcadas = signal<ReadonlySet<string>>(new Set());
  private limite: ReturnType<typeof setTimeout> | undefined;

  protected readonly paso = computed<Paso>(() => {
    if (this.procesando()) {
      return 'procesando';
    }
    if (this.entendido()) {
      return 'revision';
    }
    return this.dictado.grabando(this) ? 'grabando' : 'reposo';
  });

  protected readonly filas = computed<readonly Fila[]>(() => {
    const f = this.entendido();
    if (!f) {
      return [];
    }
    const filas: Fila[] = [];
    if (f.ocupacion) filas.push({ clave: 'ocupacion', rotulo: 'Ocupación', valor: f.ocupacion });
    if (f.pesoKg) filas.push({ clave: 'peso', rotulo: 'Peso', valor: `${decimal(f.pesoKg)} kg` });
    if (f.alturaCm) {
      filas.push({ clave: 'altura', rotulo: 'Altura', valor: `${decimal(f.alturaCm)} cm` });
    }
    if (f.actividad) {
      filas.push({
        clave: 'actividad',
        rotulo: 'Actividad física',
        valor: ACTIVIDADES[f.actividad],
      });
    }
    if (f.detalle) filas.push({ clave: 'detalle', rotulo: '¿Cuál?', valor: f.detalle });
    for (const codigo of f.condiciones) {
      const etiqueta = ENFERMEDADES_DE_INGRESO.find(([c]) => c === codigo)?.[1] ?? codigo;
      filas.push({ clave: `condicion:${codigo}`, rotulo: 'Tiene', valor: etiqueta });
    }
    f.antecedentes.forEach((a, i) => {
      const detalle = [a.zona, a.anio].filter(Boolean).join(' · ');
      filas.push({
        clave: `antecedente:${i}`,
        rotulo: `Antecedente ${TIPOS_DE_ANTECEDENTE[a.tipo].toLowerCase()}`,
        valor: detalle ? `${a.descripcion} · ${detalle}` : a.descripcion,
      });
    });
    return filas;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.limite);
      this.dictado.cancelar(this);
    });
  }

  protected async grabar(): Promise<void> {
    this.reiniciar();
    try {
      await this.dictado.empezar(this);
      this.limite = setTimeout(() => {
        this.terminar().catch(() => undefined);
      }, MAXIMO_DE_GRABACION_MS);
    } catch (error) {
      this.problema.emit((error as ErrorDictado).mensaje);
    }
  }

  protected descartarGrabacion(): void {
    clearTimeout(this.limite);
    this.dictado.cancelar(this);
  }

  protected async terminar(): Promise<void> {
    clearTimeout(this.limite);
    if (!this.dictado.grabando(this)) {
      return;
    }
    this.procesando.set(true);
    try {
      const texto = await this.dictado.transcribir(this);
      if (!texto) {
        this.problema.emit(
          'No se entendió el dictado. Probá de nuevo hablando más cerca del micrófono.',
        );
        return;
      }
      this.texto.set(texto);
      this.entendido.set(interpretarDictadoDeFicha(texto));
      this.marcadas.set(new Set(this.filas().map((f) => f.clave)));
    } catch (error) {
      this.problema.emit((error as ErrorDictado).mensaje);
    } finally {
      this.procesando.set(false);
    }
  }

  protected alternar(clave: string): void {
    const nuevas = new Set(this.marcadas());
    if (!nuevas.delete(clave)) {
      nuevas.add(clave);
    }
    this.marcadas.set(nuevas);
  }

  protected cargarMarcadas(): void {
    const f = this.entendido();
    if (!f) {
      return;
    }
    const m = this.marcadas();
    this.cargar.emit({
      ...(m.has('ocupacion') ? { ocupacion: f.ocupacion } : {}),
      ...(m.has('peso') ? { pesoKg: f.pesoKg } : {}),
      ...(m.has('altura') ? { alturaCm: f.alturaCm } : {}),
      ...(m.has('actividad') ? { actividad: f.actividad } : {}),
      ...(m.has('detalle') ? { detalle: f.detalle } : {}),
      condiciones: f.condiciones.filter((c) => m.has(`condicion:${c}`)),
      antecedentes: f.antecedentes.filter((_, i) => m.has(`antecedente:${i}`)),
    });
    this.reiniciar();
  }

  protected reiniciar(): void {
    this.entendido.set(null);
    this.texto.set('');
    this.marcadas.set(new Set());
  }
}

function decimal(valor: number): string {
  return String(valor).replace('.', ',');
}
