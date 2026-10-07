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
import { CreatePrecioParticularRequest } from '../../../../api/generated/model/create-precio-particular-request';
import { EstadoDeListado } from '../../../../shared/utils/estado-de-listado';
import { OfertaResponse } from '../../../../api/generated/model/oferta-response';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { PrecioParticularResponse } from '../../../../api/generated/model/precio-particular-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { numeroDeclarado } from '../../../../shared/utils/numero-declarado';
import { OfferingApi } from '../../services/offering-api';
import { CausaOffering, hayQueRecargar, traducirErrorOffering } from '../../models/offering-errors';
import { precioEnPalabras } from '../../models/etiquetas-de-offering';
import { enPalabras, hoyLocal } from '../../models/situacion-de-vigencia';

/** Operacion abierta sobre una fila. Solo una a la vez. */
type TipoAccion = 'fin' | 'baja';

/** Como se lee una fila hoy. */
interface SituacionDelPrecio {
  readonly resumen: string;
  readonly atenuada: boolean;
}

/**
 * Precios particulares de una oferta, por vigencia (RF-M16-009, AKINE B-3).
 *
 * <h2>Precio de lista y precio por vigencia conviven</h2>
 *
 * <p>El `precioBase` de la oferta sigue siendo el precio de lista, sin vigencia. Un precio
 * particular <b>manda sobre el de lista el dia que cubre</b>; el dia que ninguno cubre, rige el de
 * lista. Una oferta sin filas se comporta exactamente como antes. Y ninguno de los dos es el
 * arancel del financiador (RN-M16-007): ese vive en el convenio.
 *
 * <h2>El importe no se edita</h2>
 *
 * <p>Lo unico editable es el <b>fin de la vigencia</b>: subir un precio es cerrar el actual el dia
 * anterior y cargar el nuevo. Corregir una carga es darla de baja y volver a cargarla. Lo ya
 * devengado copio su importe y no se vuelve a leer (CA-M16-009-06), asi que nada de esto reescribe
 * una obligacion vieja.
 */
@Component({
  selector: 'app-precios-particulares-de-la-oferta-page',
  imports: [ReactiveFormsModule, RouterLink, PermisoDirective, ConfirmacionConMotivo],
  templateUrl: './precios-particulares-de-la-oferta-page.html',
  styleUrl: '../../offering.css',
})
export class PreciosParticularesDeLaOfertaPage {
  private readonly api = inject(OfferingApi);
  private readonly contexto = inject(TenantContextStore);
  private readonly ruta = inject(ActivatedRoute);
  private readonly formBuilder = inject(FormBuilder);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly PERMISO_CONSULTORIO_MANAGE = PERMISO_CONSULTORIO_MANAGE;
  protected readonly enPalabras = enPalabras;
  protected readonly precioEnPalabras = precioEnPalabras;

  protected readonly ofertaId = Number(this.ruta.snapshot.paramMap.get('ofertaId'));
  private readonly hoy = hoyLocal();

  protected readonly estado = signal<EstadoDeListado<readonly PrecioParticularResponse[]>>({
    tipo: 'cargando',
  });
  protected readonly oferta = signal<OfertaResponse | null>(null);

  /** Del mas nuevo al mas viejo: el que rige hoy suele ser el de arriba. */
  protected readonly precios = computed<readonly PrecioParticularResponse[]>(() => {
    const actual = this.estado();
    if (actual.tipo !== 'listo') {
      return [];
    }
    return [...actual.pagina].sort((uno, otro) =>
      (otro.vigenciaDesde ?? '').localeCompare(uno.vigenciaDesde ?? ''),
    );
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
  private readonly original = signal<PrecioParticularResponse | null>(null);

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaOffering | null>(null);
  protected readonly exito = signal<string | null>(null);
  protected readonly intentos = signal(0);

  protected readonly hayQueRecargar = computed(() => hayQueRecargar(this.causaAccion()));

  protected readonly formularioAlta = this.formBuilder.nonNullable.group({
    importe: ['', [Validators.required, Validators.min(0)]],
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
    this.api.listarPreciosParticulares(consultorioId, this.ofertaId).subscribe({
      next: (precios) => this.estado.set({ tipo: 'listo', pagina: precios }),
      error: (error: unknown) => {
        const traducido = traducirErrorOffering(error, 'oferta');
        this.estado.set({
          tipo: 'error',
          mensaje: traducido.mensaje,
          faltaContexto: traducido.causa === 'sin-contexto',
        });
      },
    });

    // La oferta da el nombre y el precio de lista. Si falla, la grilla se ve igual.
    this.api
      .listarOfertas(consultorioId, { estado: 'TODOS' })
      .pipe(catchError(() => of([] as readonly OfertaResponse[])))
      .subscribe((ofertas) =>
        this.oferta.set(ofertas.find((candidata) => candidata.id === this.ofertaId) ?? null),
      );
  }

  protected situacion(precio: PrecioParticularResponse): SituacionDelPrecio {
    if (precio.estado === 'INACTIVO') {
      return { resumen: 'Dado de baja', atenuada: true };
    }
    if (precio.vigente === true) {
      return { resumen: 'Rige hoy', atenuada: false };
    }
    if ((precio.vigenciaDesde ?? '') > this.hoy) {
      return { resumen: 'Todavia no rige', atenuada: false };
    }
    return { resumen: 'Ya no rige', atenuada: true };
  }

  protected importe(precio: PrecioParticularResponse): string {
    return precio.importe === undefined ? '-' : `${precio.moneda ?? ''} ${precio.importe}`.trim();
  }

  protected ventana(precio: PrecioParticularResponse): string {
    const desde = enPalabras(precio.vigenciaDesde ?? '');
    const hasta = precio.vigenciaHasta ?? '';
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
    this.formularioAlta.reset({ importe: '', vigenciaDesde: this.hoy, vigenciaHasta: '' });
    this.altaAbierta.set(true);
    afterNextRender(() => this.enfocar('#alta-precio-importe'), { injector: this.injector });
  }

  protected abrirPanel(precio: PrecioParticularResponse, tipo: TipoAccion): void {
    if (precio.id === undefined) {
      return;
    }
    this.cerrarPanel();
    this.exito.set(null);
    this.panel.set({ id: precio.id, tipo });
    if (tipo === 'fin') {
      this.original.set(precio);
      this.formularioFin.reset({ vigenciaHasta: precio.vigenciaHasta ?? '' });
      afterNextRender(() => this.enfocar('#fin-precio-hasta'), { injector: this.injector });
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

  protected mostrarErrorAlta(campo: 'importe' | 'vigenciaDesde'): boolean {
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
    // Un `input type="number"` vaciado entrega `null`, que `required` no siempre ve como vacio
    // y `Number(null)` convierte en un precio de cero pesos.
    const importe = numeroDeclarado(valores.importe);
    if (this.formularioAlta.invalid || importe === null) {
      this.formularioAlta.markAllAsTouched();
      this.enfocar(importe === null ? '#alta-precio-importe' : '#alta-precio-desde');
      return;
    }

    const cuerpo: CreatePrecioParticularRequest = {
      importe,
      vigenciaDesde: valores.vigenciaDesde,
    };
    if (valores.vigenciaHasta !== '') {
      cuerpo.vigenciaHasta = valores.vigenciaHasta;
    }

    this.empezarEnvio();
    this.api.crearPrecioParticular(consultorioId, this.ofertaId, cuerpo).subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set(
          'El precio quedo cargado. Los dias que cubre manda sobre el precio de lista; lo ya ' +
            'devengado no cambia.',
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
        'No pudimos leer la version de este precio. Cerra el panel, recarga la grilla y volve a ' +
          'intentar.',
      );
      return;
    }

    const hasta = this.formularioFin.getRawValue().vigenciaHasta;
    this.empezarEnvio();
    this.api
      .cambiarFinPrecioParticular(
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
              ? 'El precio quedo sin fin previsto.'
              : `El precio rige hasta el ${enPalabras(hasta)} inclusive.`,
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
    this.api.darDeBajaPrecioParticular(consultorioId, this.ofertaId, panel.id, motivo).subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set(
          'El precio quedo dado de baja y su periodo quedo libre. Esos dias vuelve a regir el ' +
            'precio de lista, salvo que cargues otro.',
        );
        this.cargar();
      },
      error: (error: unknown) => this.fallar(error),
    });
  }

  /**
   * Tras un 409 de version: el panel queda abierto con el mensaje, y la grilla y la version se
   * releen para que el siguiente intento decida sobre los datos actuales. Reintentar solo seria
   * pisar justo lo que el 409 existe para proteger.
   */
  private releerOriginal(consultorioId: number, precioId: number): void {
    this.api
      .listarPreciosParticulares(consultorioId, this.ofertaId)
      .pipe(catchError(() => of(null)))
      .subscribe((precios) => {
        if (precios === null) {
          return;
        }
        this.estado.set({ tipo: 'listo', pagina: precios });
        this.original.set(precios.find((precio) => precio.id === precioId) ?? null);
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
