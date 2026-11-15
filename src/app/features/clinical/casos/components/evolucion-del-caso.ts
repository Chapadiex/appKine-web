import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { EvolucionDelCasoHallazgoResponse } from '../../../../api/generated/model/evolucion-del-caso-hallazgo-response';
import { EvolucionDelCasoResponse } from '../../../../api/generated/model/evolucion-del-caso-response';
import { EvolucionDelCasoSerieResponse } from '../../../../api/generated/model/evolucion-del-caso-serie-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { Justificacion } from '../../services/historia-clinica-api';
import { ErrorCaso, traducirErrorCaso } from '../casos-errors';
import { EvolucionApi } from '../evolucion-api';

type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'oculta' }
  | { readonly tipo: 'listo'; readonly evolucion: EvolucionDelCasoResponse }
  | { readonly tipo: 'error'; readonly error: ErrorCaso };

/** Una fila de la tabla de series: el dolor primero y despues cada medida por lado. */
interface FilaDeSerie {
  readonly clave: string;
  readonly medida: string;
  readonly lado: string;
  readonly unidad: string;
  readonly serie: EvolucionDelCasoSerieResponse;
  readonly unidadesDifieren: boolean;
}

const NUMERO = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });

const LADOS: Readonly<Record<string, string>> = {
  IZQUIERDA: 'Izquierda',
  DERECHA: 'Derecha',
  NO_APLICA: '—',
};

/**
 * La evolucion de un Caso Clinico (M31): alertas e indicadores calculados por el servidor sobre las
 * sesiones cerradas del caso. La pantalla no calcula nada: muestra lo que llego.
 *
 * <p>Con la funcion apagada en el despliegue el servidor responde 404 y la seccion no se muestra:
 * la ficha del caso ya cargo, asi que un 404 aca solo puede ser eso.
 */
@Component({
  selector: 'app-evolucion-del-caso',
  imports: [Alerta, Ayuda, RouterLink],
  templateUrl: './evolucion-del-caso.html',
  styleUrl: './evolucion-del-caso.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EvolucionDelCaso {
  private readonly api = inject(EvolucionApi);
  private readonly contexto = inject(TenantContextStore);

  readonly casoId = input.required<number>();
  readonly justificacion = input<Justificacion>(null);

  protected readonly estado = signal<Estado>({ tipo: 'cargando' });

  protected readonly evolucion = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'listo' ? estado.evolucion : null;
  });

  /** Con menos de tres sesiones presentes el unico hallazgo es el aviso, no una alerta. */
  protected readonly insuficiente = computed(
    () => this.evolucion()?.hallazgos?.find((h) => h.codigo === 'DATOS_INSUFICIENTES') ?? null,
  );

  protected readonly alertas = computed(() =>
    (this.evolucion()?.hallazgos ?? []).filter((h) => h.codigo !== 'DATOS_INSUFICIENTES'),
  );

  protected readonly series = computed<readonly FilaDeSerie[]>(() => {
    const indicadores = this.evolucion()?.indicadores;
    if (!indicadores) return [];
    const filas: FilaDeSerie[] = [];
    if (indicadores.dolor?.puntos?.length) {
      filas.push({
        clave: 'dolor',
        medida: 'Dolor (EVA)',
        lado: '—',
        unidad: '',
        serie: indicadores.dolor,
        unidadesDifieren: false,
      });
    }
    for (const m of indicadores.mediciones ?? []) {
      filas.push({
        clave: `${m.definicionId}-${m.lateralidad}`,
        medida: m.nombre ?? m.codigo ?? 'Medida',
        lado: LADOS[m.lateralidad ?? 'NO_APLICA'] ?? '—',
        unidad: m.unidad ?? '',
        serie: m.serie ?? { puntos: [] },
        unidadesDifieren: m.unidadesDifieren ?? false,
      });
    }
    return filas;
  });

  private pedido: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.pedido?.unsubscribe());
    effect(() => {
      this.casoId();
      this.justificacion();
      this.contexto.contextEpoch();
      untracked(() => this.cargar());
    });
  }

  protected releer(): void {
    this.cargar();
  }

  protected severidad(hallazgo: EvolucionDelCasoHallazgoResponse): string {
    return hallazgo.severidad === 'ATENCION' ? 'Atención' : 'Información';
  }

  protected numero(valor: number | undefined | null): string {
    return valor === undefined || valor === null ? '—' : NUMERO.format(valor);
  }

  protected diferencia(valor: number | undefined | null): string {
    if (valor === undefined || valor === null) return '—';
    return valor > 0 ? `+${NUMERO.format(valor)}` : NUMERO.format(valor);
  }

  protected plural(cantidad: number | undefined, singular: string, plural: string): string {
    return `${cantidad ?? 0} ${cantidad === 1 ? singular : plural}`;
  }

  protected fecha(valor: string | undefined | null): string {
    if (!valor) return '—';
    const [anio, mes, dia] = valor.split('-');
    return `${dia}/${mes}/${anio}`;
  }

  private cargar(): void {
    const consultorioId = this.contexto.consultorioId();
    this.pedido?.unsubscribe();
    if (consultorioId === null || consultorioId === undefined) {
      this.estado.set({ tipo: 'oculta' });
      return;
    }
    this.estado.set({ tipo: 'cargando' });
    this.pedido = this.api.ver(consultorioId, this.casoId(), this.justificacion()).subscribe({
      next: (evolucion) => this.estado.set({ tipo: 'listo', evolucion }),
      error: (error: unknown) => {
        const traducido = traducirErrorCaso(error);
        this.estado.set(
          traducido.causa === 'no-encontrado'
            ? { tipo: 'oculta' }
            : { tipo: 'error', error: traducido },
        );
      },
    });
  }
}
