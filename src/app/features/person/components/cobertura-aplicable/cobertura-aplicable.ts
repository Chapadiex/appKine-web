import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Subscription, catchError, forkJoin, of } from 'rxjs';

import { CoberturaParaOfertaArancel } from '../../../../api/generated/model/cobertura-para-oferta-arancel';
import { CoberturaParaOfertaPractica } from '../../../../api/generated/model/cobertura-para-oferta-practica';
import { CoberturaParaOfertaResponse } from '../../../../api/generated/model/cobertura-para-oferta-response';
import { PracticaDeOferta } from '../../../../api/generated/model/practica-de-oferta';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { CoberturasApi } from '../../services/coberturas-api';
import { fechaEnPalabras, importeEnPalabras } from '../../models/etiquetas-de-ficha';
import { motivoDeNoAplicable } from '../../models/etiquetas-de-cobertura';
import { traducirErrorPersona } from '../../models/person-errors';

type EstadoDeConsulta =
  | { readonly tipo: 'sin-oferta' }
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly respuesta: CoberturaParaOfertaResponse }
  | { readonly tipo: 'error'; readonly mensaje: string };

/**
 * Que cobertura del paciente aplica a una oferta, y por que no las otras (RF-M08-006/007).
 *
 * <p>Reutilizable: recibe persona, oferta y fecha y no sabe de donde salen. Hoy lo monta la
 * pantalla de coberturas del paciente con su propio selector de oferta.
 *
 * <h2>Lo que muestra y lo que no decide</h2>
 *
 * <p>Muestra la <b>sugerencia</b> del backend —COBERTURA si alguna aplica, PARTICULAR si no— y
 * el precio particular del dia, que vale en los dos casos: particular siempre esta disponible.
 * <b>No selecciona nada</b>: elegir con que se atiende es de la recepcion (RF-M13-005), y nada de
 * esto escribe en la cobertura (CA-M08-007-06). Cobertura del paciente no es convenio del centro:
 * una cobertura vigente puede no aplicar, y la pantalla dice por que.
 *
 * <p>El numero de afiliado no viaja en esta respuesta, a proposito.
 */
@Component({
  selector: 'app-cobertura-aplicable',
  templateUrl: './cobertura-aplicable.html',
  styleUrl: '../../person.css',
})
export class CoberturaAplicable {
  private readonly api = inject(CoberturasApi);
  private readonly contexto = inject(TenantContextStore);

  readonly personaId = input.required<number>();
  /** `null` mientras no se eligio oferta: no hay nada que preguntar. */
  readonly ofertaId = input<number | null>(null);
  /** `YYYY-MM-DD`, o vacio para el dia de hoy de la sede. */
  readonly fecha = input('');

  protected readonly fechaEnPalabras = fechaEnPalabras;
  protected readonly motivoDeNoAplicable = motivoDeNoAplicable;

  protected readonly estado = signal<EstadoDeConsulta>({ tipo: 'sin-oferta' });
  private readonly practicas = signal<readonly PracticaDeOferta[]>([]);

  protected readonly respuesta = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.respuesta : null;
  });

  protected readonly mensajeError = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  private enVuelo: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.enVuelo?.unsubscribe());

    effect(() => {
      const personaId = this.personaId();
      const ofertaId = this.ofertaId();
      const fecha = this.fecha();
      // Otra sede es otra oferta y otro convenio: la respuesta vieja no puede quedar en pantalla.
      this.contexto.contextEpoch();
      untracked(() => this.consultar(personaId, ofertaId, fecha));
    });
  }

  protected reintentar(): void {
    this.consultar(this.personaId(), this.ofertaId(), this.fecha());
  }

  protected nombreDePractica(practicaId: number | undefined): string {
    const practica = this.practicas().find((candidata) => candidata.practicaId === practicaId);
    if (practica === undefined) {
      return `Practica #${practicaId ?? '?'}`;
    }
    return practica.codigo
      ? `${practica.nombre ?? ''} (${practica.codigo})`
      : (practica.nombre ?? '');
  }

  protected importe(valor: number | undefined): string {
    return importeEnPalabras(valor, this.respuesta()?.moneda) || '-';
  }

  /** De donde sale el precio: el arancel propio de la oferta manda sobre el general. */
  protected origenDelArancel(arancel: CoberturaParaOfertaArancel): string {
    const convenio = arancel.convenioCodigo ? `convenio ${arancel.convenioCodigo}` : 'convenio';
    return arancel.ofertaId === undefined || arancel.ofertaId === null
      ? `Arancel general del ${convenio}`
      : `Arancel propio de esta oferta en el ${convenio}`;
  }

  protected requisitos(arancel: CoberturaParaOfertaArancel): string {
    const pedidos = [
      arancel.requiereOrden ? 'orden medica' : null,
      arancel.requiereAutorizacion ? 'autorizacion' : null,
      arancel.requiereCredencial ? 'credencial vigente' : null,
    ].filter((pedido): pedido is string => pedido !== null);
    return pedidos.length === 0 ? '' : `Pide ${pedidos.join(', ')}.`;
  }

  /** El detalle por practica solo aporta cuando la oferta declara mas de una. */
  protected detalleUtil(practicas: readonly CoberturaParaOfertaPractica[] | undefined): boolean {
    return (practicas?.length ?? 0) > 1;
  }

  private consultar(personaId: number, ofertaId: number | null, fecha: string): void {
    this.enVuelo?.unsubscribe();
    this.enVuelo = null;

    const consultorioId = this.contexto.consultorioId();
    if (ofertaId === null || consultorioId === null) {
      this.estado.set({ tipo: 'sin-oferta' });
      return;
    }

    this.estado.set({ tipo: 'cargando' });
    this.enVuelo = forkJoin({
      respuesta: this.api.coberturaAplicable(personaId, ofertaId, fecha),
      // Solo da nombres: si falla, las practicas se muestran por id.
      practicas: this.api
        .practicasDeOferta(consultorioId, ofertaId)
        .pipe(catchError(() => of({ practicas: [] }))),
    }).subscribe({
      next: ({ respuesta, practicas }) => {
        this.practicas.set(practicas.practicas ?? []);
        this.estado.set({ tipo: 'listo', respuesta });
      },
      error: (error: unknown) =>
        this.estado.set({ tipo: 'error', mensaje: traducirErrorPersona(error).mensaje }),
    });
  }
}
