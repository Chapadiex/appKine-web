import { Pestanas } from '../../../../shared/components/pestanas/pestanas';
import { ETIQUETA_PESTANAS_DE_OFERTA, pestanasDeOferta } from '../../models/pestanas-de-offering';
import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { catchError, of } from 'rxjs';

import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { CreateHonorarioPorClaseRequest } from '../../../../api/generated/model/create-honorario-por-clase-request';
import { EstadoDeListado } from '../../../../shared/utils/estado-de-listado';
import { HonorarioPorClase } from '../../../../api/generated/model/honorario-por-clase';
import { OfertaResponse } from '../../../../api/generated/model/oferta-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { numeroDeclarado } from '../../../../shared/utils/numero-declarado';
import { OfferingApi } from '../../services/offering-api';
import { CausaOffering, hayQueRecargar, traducirErrorOffering } from '../../models/offering-errors';
import { enPalabras } from '../../models/situacion-de-vigencia';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import { Paginacion } from '../../../../shared/components/paginacion/paginacion';
import { tablaLocal } from '../../../../shared/components/tabla/tabla-local';
import { Icono } from '../../../../shared/components/icono/icono';

/** La moneda que se propone cuando la oferta no tiene precio de lista: la del producto. */
const MONEDA_POR_DEFECTO = 'ARS';

/** Operacion abierta sobre una fila. Solo una a la vez. */
type TipoAccion = 'fin' | 'baja';

interface SituacionDeLaTarifa {
  readonly resumen: string;
  readonly atenuada: boolean;
}

/**
 * Honorarios por clase de una oferta grupal, por vigencia (DP-38, RF-M22-006).
 *
 * <p>La tarifa es <b>por participante presente</b> (`PRESENTE` o `PRESENTE_TARDE`): una clase con
 * ocho presentes y una tarifa de 1.500 vale 12.000 para sus instructores, repartidos en partes
 * iguales. La tarifa que aplica es la vigente el dia local de la clase en la sede.
 *
 * <p>Mismo patron que los precios particulares (B-3): vigencias sin solapamiento, el importe no se
 * edita —se cierra la vigencia y se carga otra— y la baja es logica, con motivo. Lo ya liquidado
 * guardo su snapshot y no cambia.
 *
 * <p>La grilla entera exige `consultorio:manage`, tambien para leerla: es lo que cobra un colega.
 * Sin el permiso el backend responde 403 y la pantalla lo dice.
 */
@Component({
  selector: 'app-honorarios-por-clase-de-la-oferta-page',
  imports: [
    Pestanas,
    ColumnaOrdenable,
    Paginacion,
    Icono,
    Ayuda,
    ReactiveFormsModule,
    RouterLink,
    ConfirmacionConMotivo,
  ],
  templateUrl: './honorarios-por-clase-de-la-oferta-page.html',
  styleUrl: '../../offering.css',
})
export class HonorariosPorClaseDeLaOfertaPage {
  private readonly api = inject(OfferingApi);
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly contexto = inject(TenantContextStore);
  private readonly ruta = inject(ActivatedRoute);
  private readonly formBuilder = inject(FormBuilder);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly ofertaId = Number(this.ruta.snapshot.paramMap.get('ofertaId'));
  protected readonly pestanasDeOferta = pestanasDeOferta(this.ofertaId);
  protected readonly etiquetaDePestanas = ETIQUETA_PESTANAS_DE_OFERTA;

  protected readonly estado = signal<EstadoDeListado<readonly HonorarioPorClase[]>>({
    tipo: 'cargando',
  });
  protected readonly oferta = signal<OfertaResponse | null>(null);

  /** Del mas nuevo al mas viejo: la que rige hoy suele ser la de arriba. */
  protected readonly tarifas = computed<readonly HonorarioPorClase[]>(() => {
    const actual = this.estado();
    if (actual.tipo !== 'listo') {
      return [];
    }
    return [...actual.pagina].sort((una, otra) =>
      (otra.vigenciaDesde ?? '').localeCompare(una.vigenciaDesde ?? ''),
    );
  });

  /** Orden y paginado de la lista completa (plan Â§3.4): el servidor no pagina tarifas. */
  protected readonly tabla = tablaLocal(this.tarifas, {
    columnas: {
      importe: (tarifa) => tarifa.importePorParticipante,
      vigencia: (tarifa) => tarifa.vigenciaDesde,
    },
  });

  protected readonly mensajeDeCarga = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  protected readonly faltaContexto = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' && actual.faltaContexto;
  });

  protected readonly altaAbierta = signal(false);
  protected readonly panel = signal<{ readonly id: number; readonly tipo: TipoAccion } | null>(
    null,
  );
  private readonly original = signal<HonorarioPorClase | null>(null);

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaOffering | null>(null);
  protected readonly exito = signal<string | null>(null);
  protected readonly intentos = signal(0);

  protected readonly hayQueRecargar = computed(() => hayQueRecargar(this.causaAccion()));

  protected readonly formularioAlta = this.formBuilder.nonNullable.group({
    importe: ['', [Validators.required]],
    // Obligatoria: el contrato la declara opcional (hereda la del precio de lista), pero una oferta
    // grupal sin precio de lista no tiene de donde heredarla y el backend responde 400 (lo encontro
    // el E2E contra el backend real). Se propone la de la lista, o ARS.
    moneda: ['', [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)]],
    vigenciaDesde: ['', [Validators.required]],
    vigenciaHasta: [''],
  });

  /** Vacio = sin fin previsto: la vigencia se reabre. */
  protected readonly formularioFin = this.formBuilder.nonNullable.group({ vigenciaHasta: [''] });

  constructor() {
    effect(() => {
      // Cambiar de sede deja esta oferta fuera de alcance: se relee todo y no queda nada viejo.
      this.contexto.contextEpoch();
      untracked(() => {
        this.cerrarPanel();
        this.exito.set(null);
        this.oferta.set(null);
        this.cargar();
      });
    });
  }

  protected cargar(): void {
    const consultorioId = this.contexto.consultorioId();
    if (consultorioId === null) {
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }

    this.estado.set({ tipo: 'cargando' });
    this.api.listarHonorariosPorClase(consultorioId, this.ofertaId).subscribe({
      next: (tarifas) => this.estado.set({ tipo: 'listo', pagina: tarifas }),
      error: (error: unknown) => {
        const traducido = traducirErrorOffering(error, 'oferta');
        this.estado.set({
          tipo: 'error',
          mensaje: traducido.mensaje,
          faltaContexto: traducido.causa === 'sin-contexto',
        });
      },
    });

    // La oferta da el nombre y la moneda de lista. Si falla, la grilla se ve igual.
    this.api
      .listarOfertas(consultorioId, { estado: 'TODOS' })
      .pipe(catchError(() => of([] as readonly OfertaResponse[])))
      .subscribe((ofertas) =>
        this.oferta.set(ofertas.find((candidata) => candidata.id === this.ofertaId) ?? null),
      );
  }

  protected situacion(tarifa: HonorarioPorClase): SituacionDeLaTarifa {
    if (tarifa.estado === 'INACTIVO') {
      return { resumen: 'Dada de baja', atenuada: true };
    }
    if (tarifa.vigente === true) {
      return { resumen: 'Rige hoy', atenuada: false };
    }
    if ((tarifa.vigenciaDesde ?? '') > this.diaDeLaSede.hoy()) {
      return { resumen: 'Todavia no rige', atenuada: false };
    }
    return { resumen: 'Ya no rige', atenuada: true };
  }

  protected importe(tarifa: HonorarioPorClase): string {
    return tarifa.importePorParticipante === undefined
      ? '-'
      : `${tarifa.moneda ?? ''} ${tarifa.importePorParticipante}`.trim();
  }

  protected ventana(tarifa: HonorarioPorClase): string {
    const desde = enPalabras(tarifa.vigenciaDesde ?? '');
    const hasta = tarifa.vigenciaHasta ?? '';
    return hasta === ''
      ? `Desde el ${desde}, sin fin previsto`
      : `Del ${desde} al ${enPalabras(hasta)}, inclusive`;
  }

  protected panelAbierto(id: number | undefined, tipo: TipoAccion): boolean {
    const panel = this.panel();
    return panel !== null && panel.id === id && panel.tipo === tipo;
  }

  protected abrirAlta(): void {
    this.cerrarPanel();
    this.exito.set(null);
    this.formularioAlta.reset({
      importe: '',
      moneda: this.oferta()?.moneda || MONEDA_POR_DEFECTO,
      vigenciaDesde: this.diaDeLaSede.hoy(),
      vigenciaHasta: '',
    });
    this.altaAbierta.set(true);
    afterNextRender(() => this.enfocar('#alta-honorario-importe'), { injector: this.injector });
  }

  protected abrirPanel(tarifa: HonorarioPorClase, tipo: TipoAccion): void {
    if (tarifa.id === undefined) {
      return;
    }
    this.cerrarPanel();
    this.exito.set(null);
    this.panel.set({ id: tarifa.id, tipo });
    if (tipo === 'fin') {
      this.original.set(tarifa);
      this.formularioFin.reset({ vigenciaHasta: tarifa.vigenciaHasta ?? '' });
      afterNextRender(() => this.enfocar('#fin-honorario-hasta'), { injector: this.injector });
    }
  }

  protected cerrarPanel(): void {
    this.panel.set(null);
    this.altaAbierta.set(false);
    this.original.set(null);
    this.enviando.set(false);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.intentos.set(0);
  }

  protected mostrarErrorAlta(campo: 'importe' | 'moneda' | 'vigenciaDesde'): boolean {
    if (campo === 'importe') {
      const importe = numeroDeclarado(this.formularioAlta.controls.importe.value);
      const tocado = this.formularioAlta.controls.importe.touched || this.intentos() > 0;
      return tocado && (importe === null || importe <= 0);
    }
    const control = this.formularioAlta.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected enviarAlta(): void {
    const consultorioId = this.contexto.consultorioId();
    if (consultorioId === null || this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);
    const valores = this.formularioAlta.getRawValue();
    const importe = numeroDeclarado(valores.importe);
    // El contrato pide mayor que cero: una tarifa de cero no paga nada y es un error de carga.
    if (this.formularioAlta.invalid || importe === null || importe <= 0) {
      this.formularioAlta.markAllAsTouched();
      this.enfocar(
        importe === null || importe <= 0
          ? '#alta-honorario-importe'
          : this.formularioAlta.controls.moneda.invalid
            ? '#alta-honorario-moneda'
            : '#alta-honorario-desde',
      );
      return;
    }

    const cuerpo: CreateHonorarioPorClaseRequest = {
      importePorParticipante: importe,
      moneda: valores.moneda.trim().toUpperCase(),
      vigenciaDesde: valores.vigenciaDesde,
    };
    if (valores.vigenciaHasta !== '') {
      cuerpo.vigenciaHasta = valores.vigenciaHasta;
    }

    this.empezarEnvio();
    this.api.crearHonorarioPorClase(consultorioId, this.ofertaId, cuerpo).subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set(
          'La tarifa quedo cargada. Se aplica a las clases de los dias que cubre; lo ya ' +
            'liquidado no cambia.',
        );
        this.cargar();
      },
      error: (error: unknown) => this.fallar(error),
    });
  }

  protected enviarFin(): void {
    const consultorioId = this.contexto.consultorioId();
    const panel = this.panel();
    const version = this.original()?.version;
    if (consultorioId === null || panel === null || this.enviando()) {
      return;
    }
    if (version === undefined) {
      this.errorAccion.set(
        'No pudimos leer la version de esta tarifa. Cerra el panel, recarga la grilla y volve a ' +
          'intentar.',
      );
      return;
    }

    const hasta = this.formularioFin.getRawValue().vigenciaHasta;
    this.empezarEnvio();
    this.api
      .cambiarFinHonorarioPorClase(
        consultorioId,
        this.ofertaId,
        panel.id,
        hasta === '' ? null : hasta,
        version,
      )
      .subscribe({
        next: () => {
          this.cerrarPanel();
          this.exito.set(
            hasta === ''
              ? 'La tarifa quedo sin fin previsto.'
              : `La tarifa rige hasta el ${enPalabras(hasta)} inclusive.`,
          );
          this.cargar();
        },
        error: (error: unknown) => {
          this.fallar(error);
          if (this.causaAccion() === 'concurrencia') {
            this.releerOriginal(consultorioId, panel.id);
          }
        },
      });
  }

  protected enviarBaja(motivo: string): void {
    const consultorioId = this.contexto.consultorioId();
    const panel = this.panel();
    if (consultorioId === null || panel === null || this.enviando()) {
      return;
    }

    this.empezarEnvio();
    this.api.darDeBajaHonorarioPorClase(consultorioId, this.ofertaId, panel.id, motivo).subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set(
          'La tarifa quedo dada de baja y su periodo quedo libre. Las clases de esos dias no ' +
            'entran en ninguna liquidacion hasta que cargues otra.',
        );
        this.cargar();
      },
      error: (error: unknown) => this.fallar(error),
    });
  }

  /** Tras un 409 de version se releen la grilla y la version; el panel queda abierto. */
  private releerOriginal(consultorioId: number, honorarioId: number): void {
    this.api
      .listarHonorariosPorClase(consultorioId, this.ofertaId)
      .pipe(catchError(() => of(null)))
      .subscribe((tarifas) => {
        if (tarifas === null) {
          return;
        }
        this.estado.set({ tipo: 'listo', pagina: tarifas });
        this.original.set(tarifas.find((tarifa) => tarifa.id === honorarioId) ?? null);
      });
  }

  private fallar(error: unknown): void {
    const traducido = traducirErrorOffering(error, 'oferta');
    this.enviando.set(false);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);
  }

  private empezarEnvio(): void {
    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}
