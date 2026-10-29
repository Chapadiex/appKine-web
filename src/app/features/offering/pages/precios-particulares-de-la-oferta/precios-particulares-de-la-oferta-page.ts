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
import { CreatePrecioParticularRequest } from '../../../../api/generated/model/create-precio-particular-request';
import { EstadoDeListado } from '../../../../shared/utils/estado-de-listado';
import { OfertaResponse } from '../../../../api/generated/model/oferta-response';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { PrecioParticularResponse } from '../../../../api/generated/model/precio-particular-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { numeroDeclarado } from '../../../../shared/utils/numero-declarado';
import { OfferingApi } from '../../services/offering-api';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { CausaOffering, hayQueRecargar, traducirErrorOffering } from '../../models/offering-errors';
import { precioEnPalabras } from '../../models/etiquetas-de-offering';
import { enPalabras } from '../../models/situacion-de-vigencia';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import { Paginacion } from '../../../../shared/components/paginacion/paginacion';
import { tablaLocal } from '../../../../shared/components/tabla/tabla-local';
import { Icono } from '../../../../shared/components/icono/icono';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import { AccionesDeFila } from '../../../../shared/components/acciones-de-fila/acciones-de-fila';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { publicarMigas } from '../../../../core/services/migas.store';

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
  imports: [
    CabeceraDePagina,

    Alerta,
    Pestanas,
    ColumnaOrdenable,
    Paginacion,
    Icono,
    Ayuda,
    ReactiveFormsModule,
    RouterLink,
    PermisoDirective,
    ConfirmacionConMotivo,
    PanelLateral,
    AccionesDeFila,
  ],
  templateUrl: './precios-particulares-de-la-oferta-page.html',
  styleUrl: '../../offering.css',
})
export class PreciosParticularesDeLaOfertaPage {
  /** Ruta de navegacion de la barra superior (UX-13). */
  private readonly migasDeLaBarra = publicarMigas(() => [
    { etiqueta: 'Ofertas de la sede', ruta: '/servicios/ofertas' },
    { etiqueta: 'Precios particulares' },
  ]);

  private readonly api = inject(OfferingApi);
  private readonly avisos = inject(AvisosStore);
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly contexto = inject(TenantContextStore);
  private readonly ruta = inject(ActivatedRoute);
  private readonly formBuilder = inject(FormBuilder);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly PERMISO_CONSULTORIO_MANAGE = PERMISO_CONSULTORIO_MANAGE;
  protected readonly enPalabras = enPalabras;
  protected readonly precioEnPalabras = precioEnPalabras;

  protected readonly ofertaId = Number(this.ruta.snapshot.paramMap.get('ofertaId'));
  protected readonly pestanasDeOferta = pestanasDeOferta(this.ofertaId);
  protected readonly etiquetaDePestanas = ETIQUETA_PESTANAS_DE_OFERTA;
  /** Lee el signal de la zona: lo que dependa de esto se actualiza cuando la zona llega. */
  private get hoy(): string {
    return this.diaDeLaSede.hoy();
  }

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

  /** Orden y paginado de la lista completa (plan Â§3.4): el servidor no pagina precios. */
  protected readonly tabla = tablaLocal(this.precios, {
    columnas: {
      importe: (precio) => precio.importe,
      vigencia: (precio) => precio.vigenciaDesde,
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

  /**
   * Lo del panel abierto. El panel lateral vive fuera de la tabla (refactor UX/UI del 28/10/2026),
   * asi que lo busca en el listado en vez de recibirlo del `@for` de la fila.
   */
  protected readonly precioEnPanel = computed(() => {
    const panel = this.panel();
    return panel === null
      ? null
      : (this.precios().find((precio) => precio.id === panel.id) ?? null);
  });
  private readonly original = signal<PrecioParticularResponse | null>(null);

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaOffering | null>(null);
  protected readonly intentos = signal(0);

  protected readonly hayQueRecargar = computed(() => hayQueRecargar(this.causaAccion()));

  /** Vigencia que choca con otro precio (UX-12): va pegada a las fechas, no arriba. */
  protected readonly solapado = computed(() => this.causaAccion() === 'precio-solapado');

  protected readonly formularioAlta = this.formBuilder.nonNullable.group({
    importe: ['', [Validators.required, Validators.min(0)]],
    // Obligatoria: el backend rechaza un precio sin moneda (`validation-error`) cuando la oferta
    // no tiene precio de lista del que heredarla. Se propone la de la lista cuando la hay.
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
      return { resumen: 'Todavía no rige', atenuada: false };
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

  protected abrirAlta(): void {
    this.cerrarPanel();
    this.formularioAlta.reset({
      importe: '',
      moneda: this.oferta()?.moneda ?? '',
      vigenciaDesde: this.hoy,
      vigenciaHasta: '',
    });
    this.altaAbierta.set(true);
    afterNextRender(() => this.enfocar('#alta-precio-importe'), { injector: this.injector });
  }

  protected abrirPanel(precio: PrecioParticularResponse, tipo: TipoAccion): void {
    if (precio.id === undefined) {
      return;
    }
    this.cerrarPanel();
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

  protected mostrarErrorAlta(campo: 'importe' | 'moneda' | 'vigenciaDesde'): boolean {
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
      this.enfocar(
        importe === null
          ? '#alta-precio-importe'
          : this.formularioAlta.controls.moneda.invalid
            ? '#alta-precio-moneda'
            : '#alta-precio-desde',
      );
      return;
    }

    const cuerpo: CreatePrecioParticularRequest = {
      importe,
      moneda: valores.moneda.trim().toUpperCase(),
      vigenciaDesde: valores.vigenciaDesde,
    };
    if (valores.vigenciaHasta !== '') {
      cuerpo.vigenciaHasta = valores.vigenciaHasta;
    }

    this.empezarEnvio();
    this.api.crearPrecioParticular(consultorioId, this.ofertaId, cuerpo).subscribe({
      next: () => {
        this.cerrarPanel();
        this.avisos.exito('Precio cargado', {
          descripcion:
            'En los días que cubre manda sobre el precio de lista; lo ya devengado no cambia.',
        });
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
        'No pudimos leer la versión de este precio. Cerra el panel, recarga la grilla y volvé a ' +
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
          this.avisos.exito(
            hasta === ''
              ? 'Precio sin fin previsto'
              : `Precio vigente hasta el ${enPalabras(hasta)}`,
            { descripcion: hasta === '' ? undefined : 'Ese día inclusive.' },
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
        this.avisos.exito('Precio dado de baja', {
          descripcion:
            'Su período quedó libre: esos días vuelve a regir el precio de lista, salvo que ' +
            'cargues otro.',
        });
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
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}
