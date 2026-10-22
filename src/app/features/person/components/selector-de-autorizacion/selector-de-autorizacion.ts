import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { AutorizacionElegibleResponse } from '../../../../api/generated/model/autorizacion-elegible-response';
import { CatalogoConceptoResponse } from '../../../../api/generated/model/catalogo-concepto-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { ConsumosApi } from '../../services/consumos-api';
import { traducirErrorPersona } from '../../models/person-errors';
import {
  primeraQueSirve,
  saldoDeCandidata,
  vencimientoDeCandidata,
  veredictoDeCandidata,
} from '../../models/etiquetas-de-consumo';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';

type Estado =
  | { readonly tipo: 'inicial' }
  | { readonly tipo: 'cargando' }
  | {
      readonly tipo: 'listo';
      readonly candidatas: readonly AutorizacionElegibleResponse[];
      readonly practicaId: number | null;
    }
  | { readonly tipo: 'error'; readonly mensaje: string };

/**
 * Selector EXPLICABLE de autorizacion (RF-M17-007, C-4, D-f).
 *
 * <p>Responde "si este paciente se atiende ese dia, de que autorizacion se descontaria, y por que
 * no de las otras". Lee `GET /personas/{id}/autorizaciones/elegibles`, que devuelve <b>todas</b>
 * las activas con su veredicto y en el orden en que el cierre las gasta.
 *
 * <h2>Lo que esta consulta no sabe, y la pantalla lo dice</h2>
 *
 * <p>El cierre de la sesion ademas descarta las autorizaciones cuya cobertura no esta vigente ese
 * dia (C-4 §4) y las atadas al plan de otro caso (C-4 §5). Este endpoint no evalua ninguna de las
 * dos, asi que "la que se usaria" se presenta como la primera candidata, no como una promesa. Lo
 * que realmente se uso queda en el ledger de cada autorizacion.
 *
 * <p>El endpoint no filtra por practica: lo hace la pantalla, sin reordenar.
 */
@Component({
  selector: 'app-selector-de-autorizacion',
  imports: [Ayuda, ReactiveFormsModule],
  templateUrl: './selector-de-autorizacion.html',
  styleUrl: '../../person.css',
})
export class SelectorDeAutorizacion {
  private readonly api = inject(ConsumosApi);
  private readonly contexto = inject(TenantContextStore);

  readonly personaId = input.required<number>();
  readonly practicas = input<readonly CatalogoConceptoResponse[]>([]);

  protected readonly veredictoDeCandidata = veredictoDeCandidata;
  protected readonly saldoDeCandidata = saldoDeCandidata;
  protected readonly vencimientoDeCandidata = vencimientoDeCandidata;

  protected readonly formulario = inject(FormBuilder).nonNullable.group({
    practicaId: [''],
    fecha: [''],
  });

  protected readonly estado = signal<Estado>({ tipo: 'inicial' });

  private readonly resultado = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual : null;
  });

  protected readonly mensajeError = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : '';
  });

  /** Las candidatas a mostrar: todas, o solo las de la practica elegida. */
  protected readonly candidatas = computed(() => {
    const listo = this.resultado();
    if (listo === null) {
      return [];
    }
    return listo.practicaId === null
      ? listo.candidatas
      : listo.candidatas.filter((candidata) => candidata.practicaId === listo.practicaId);
  });

  protected readonly practicaConsultada = computed(() => this.resultado()?.practicaId ?? null);

  /** Cuantas candidatas quedaron afuera por ser de otra practica. */
  protected readonly deOtrasPracticas = computed(() => {
    const listo = this.resultado();
    return listo === null ? 0 : listo.candidatas.length - this.candidatas().length;
  });

  protected readonly elegida = computed(() => {
    const listo = this.resultado();
    return listo === null || listo.practicaId === null
      ? null
      : primeraQueSirve(listo.candidatas, listo.practicaId);
  });

  protected readonly listo = computed(() => this.resultado() !== null);

  private enVuelo: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.enVuelo?.unsubscribe());
    // Otra persona u otra sede: la respuesta vieja no puede quedar en pantalla.
    effect(() => {
      this.personaId();
      this.contexto.contextEpoch();
      this.enVuelo?.unsubscribe();
      this.estado.set({ tipo: 'inicial' });
    });
  }

  protected consultar(): void {
    const valores = this.formulario.getRawValue();
    const practica = Number(valores.practicaId);
    const practicaId = valores.practicaId !== '' && Number.isInteger(practica) ? practica : null;
    const fecha = valores.fecha.trim() === '' ? undefined : valores.fecha;

    this.enVuelo?.unsubscribe();
    this.estado.set({ tipo: 'cargando' });
    this.enVuelo = this.api.candidatas(this.personaId(), fecha).subscribe({
      next: (candidatas) => this.estado.set({ tipo: 'listo', candidatas, practicaId }),
      error: (error: unknown) =>
        this.estado.set({ tipo: 'error', mensaje: traducirErrorPersona(error).mensaje }),
    });
  }

  protected nombreDePractica(practicaId: number | undefined): string {
    const practica = this.practicas().find((candidata) => candidata.id === practicaId);
    return practica?.name ?? `Práctica #${practicaId ?? '?'}`;
  }

  /**
   * Por que una candidata que sirve NO es la elegida: vence despues que la elegida.
   *
   * <p>Es el desempate del backend (C-4 §2.1), y decirlo evita que el operador crea que el
   * sistema eligio al azar.
   */
  protected porQueNoEsLaElegida(candidata: AutorizacionElegibleResponse): string {
    const elegida = this.elegida();
    if (elegida === null || candidata.habilita !== true || candidata.id === elegida.id) {
      return '';
    }
    return `También sirve, pero vence después que la ${elegida.numero ?? `#${elegida.id}`}: se usa cuando esa se agote o venza.`;
  }
}
