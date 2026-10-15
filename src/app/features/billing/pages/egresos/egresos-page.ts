import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { Egreso } from '../../../../api/generated/model/egreso';
import { MembershipResponse } from '../../../../api/generated/model/membership-response';
import {
  RegistrarEgresoCategoriaEnum,
  RegistrarEgresoTipoBeneficiarioEnum,
} from '../../../../api/generated/model/registrar-egreso';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { nuevaClaveDeIntento } from '../../../../shared/utils/clave-de-intento';
import { centavosDeTexto, deCentavos } from '../../models/dinero';
import {
  ErrorEgreso,
  errorSinContextoDeEgreso,
  traducirErrorEgreso,
} from '../../models/egreso-errors';
import {
  CATEGORIAS_DE_EGRESO,
  ESTADOS_DE_EGRESO,
  categoriaEnPalabras,
  claseDeEstadoDeEgreso,
  estadoDeEgresoEnPalabras,
  primeroDelMes,
} from '../../models/etiquetas-de-egreso';
import { fechaEnPalabras, importeEnPalabras } from '../../models/etiquetas-de-obligacion';
import { EgresosApi } from '../../services/egresos-api';

type EstadoListado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly egresos: readonly Egreso[] }
  | { readonly tipo: 'error'; readonly error: ErrorEgreso };

type CampoDeAlta =
  | 'beneficiarioMembershipId'
  | 'beneficiarioNombre'
  | 'concepto'
  | 'importe'
  | 'moneda'
  | 'periodoHasta';

/** Tope del listado: el tamano de pagina por defecto del contrato. */
const PAGINA = 50;

/**
 * Egresos de la sede: listado filtrable y alta de un borrador (M22, RF-M22-001/003/004,
 * AKINE-07.05).
 *
 * <p>Un egreso es un compromiso de pago —una liquidacion de honorarios, el alquiler, una factura de
 * insumos—. <b>Nace en borrador y no mueve plata</b>: lo que mueve la caja es cada pago, que se
 * registra en el detalle. Por eso el alta lleva al detalle, donde estan la confirmacion, los pagos
 * y la anulacion.
 *
 * <p>Los filtros son los del contrato y los aplica el servidor. El periodo filtra por la fecha de
 * registro; por defecto arranca el primer dia del mes <b>de la sede</b>, no del navegador.
 *
 * <p>El comprobante es una <b>referencia</b> —tipo, numero y fecha—: el archivo adjunto
 * (RF-M22-003) no existe en el backend, porque el storage duplicado todavia no se extrajo.
 */
@Component({
  selector: 'app-egresos-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './egresos-page.html',
  styleUrl: '../../billing.css',
})
export class EgresosPage {
  private readonly api = inject(EgresosApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly estados = ESTADOS_DE_EGRESO;
  protected readonly categorias = CATEGORIAS_DE_EGRESO;
  protected readonly estadoEnPalabras = estadoDeEgresoEnPalabras;
  protected readonly claseDeEstado = claseDeEstadoDeEgreso;
  protected readonly categoriaEnPalabras = categoriaEnPalabras;
  protected readonly fecha = (valor: string | undefined): string =>
    fechaEnPalabras(valor, this.diaDeLaSede.zona());
  protected readonly COLABORADOR = RegistrarEgresoTipoBeneficiarioEnum.COLABORADOR;
  protected readonly EXTERNO = RegistrarEgresoTipoBeneficiarioEnum.EXTERNO;

  protected readonly filtro = this.fb.group({
    estado: [''],
    categoria: [''],
    desde: [primeroDelMes(this.diaDeLaSede.hoy())],
    hasta: [''],
  });

  protected readonly alta = this.fb.group({
    tipoBeneficiario: [RegistrarEgresoTipoBeneficiarioEnum.COLABORADOR as string],
    beneficiarioMembershipId: [''],
    beneficiarioNombre: [''],
    beneficiarioDocumento: [''],
    categoria: [RegistrarEgresoCategoriaEnum.HONORARIOS_PROFESIONALES as string],
    concepto: ['', Validators.required],
    importe: ['', Validators.required],
    moneda: ['ARS', [Validators.required, Validators.pattern(/^[A-Z]{3}$/)]],
    periodoDesde: [''],
    periodoHasta: [''],
    comprobanteTipo: [''],
    comprobanteNumero: [''],
    comprobanteFecha: [this.diaDeLaSede.hoy()],
  });

  protected readonly estado = signal<EstadoListado>({ tipo: 'cargando' });
  protected readonly colaboradores = signal<readonly MembershipResponse[]>([]);
  /** `true` si no se pudo leer el padron de colaboradores: solo queda el beneficiario externo. */
  protected readonly sinColaboradores = signal(false);
  protected readonly creando = signal(false);
  protected readonly errorAlta = signal<ErrorEgreso | null>(null);
  protected readonly altaIntentada = signal(false);
  protected readonly tipoBeneficiario = signal<string>(
    RegistrarEgresoTipoBeneficiarioEnum.COLABORADOR,
  );

  /**
   * Clave del intento de alta. Se conserva entre reintentos del mismo contenido —un error de red
   * no sabe si el egreso entro— y se renueva cuando el formulario cambia.
   */
  private claveDeAlta = nuevaClaveDeIntento();

  protected readonly egresos = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.egresos : [];
  });
  protected readonly error = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.error : null;
  });
  protected readonly vacio = computed(
    () => this.estado().tipo === 'listo' && this.egresos().length === 0,
  );
  protected readonly recortado = computed(() => this.egresos().length >= PAGINA);

  constructor() {
    const desde = this.filtro.controls.desde;
    const fechaComprobante = this.alta.controls.comprobanteFecha;
    this.diaDeLaSede.alinear(
      () => desde.value,
      (hoy) => {
        desde.setValue(primeroDelMes(hoy));
        this.buscar();
      },
    );
    this.diaDeLaSede.alinear(
      () => fechaComprobante.value,
      (hoy) => fechaComprobante.setValue(hoy),
    );

    this.alta.valueChanges.pipe(takeUntilDestroyed()).subscribe((valor) => {
      this.claveDeAlta = nuevaClaveDeIntento();
      this.tipoBeneficiario.set(valor.tipoBeneficiario ?? this.COLABORADOR);
    });

    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        // Cambiar de organizacion no puede dejar egresos ni colaboradores de la anterior.
        this.colaboradores.set([]);
        this.errorAlta.set(null);
        this.cargarColaboradores();
        this.buscar();
      });
    });
  }

  protected buscar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      this.estado.set({ tipo: 'error', error: errorSinContextoDeEgreso() });
      return;
    }
    const valor = this.filtro.getRawValue();
    this.estado.set({ tipo: 'cargando' });
    this.api
      .buscar(consultorioId, {
        estado: valor.estado || undefined,
        categoria: valor.categoria || undefined,
        desde: valor.desde || undefined,
        hasta: valor.hasta || undefined,
      })
      .subscribe({
        next: (egresos) => this.estado.set({ tipo: 'listo', egresos }),
        error: (error: unknown) =>
          this.estado.set({ tipo: 'error', error: traducirErrorEgreso(error) }),
      });
  }

  protected crear(): void {
    this.altaIntentada.set(true);
    const consultorioId = this.tenantContext.consultorioId();
    const centavos = centavosDeTexto(this.alta.controls.importe.value);
    if (
      consultorioId === null ||
      this.alta.invalid ||
      centavos === null ||
      centavos <= 0 ||
      this.invalidoDeBeneficiario() !== null ||
      this.periodoInvalido() ||
      this.creando()
    ) {
      return;
    }

    const v = this.alta.getRawValue();
    const colaborador = v.tipoBeneficiario === this.COLABORADOR;
    this.creando.set(true);
    this.errorAlta.set(null);
    this.api
      .registrar(consultorioId, {
        tipoBeneficiario: v.tipoBeneficiario as RegistrarEgresoTipoBeneficiarioEnum,
        beneficiarioMembershipId: colaborador ? Number(v.beneficiarioMembershipId) : undefined,
        beneficiarioNombre: colaborador ? undefined : v.beneficiarioNombre.trim(),
        beneficiarioDocumento: colaborador
          ? undefined
          : v.beneficiarioDocumento.trim() || undefined,
        categoria: v.categoria as RegistrarEgresoCategoriaEnum,
        concepto: v.concepto.trim(),
        importeTotal: deCentavos(centavos),
        moneda: v.moneda,
        periodoDesde: v.periodoDesde || undefined,
        periodoHasta: v.periodoHasta || undefined,
        comprobanteTipo: v.comprobanteTipo.trim() || undefined,
        comprobanteNumero: v.comprobanteNumero.trim() || undefined,
        comprobanteFecha: v.comprobanteFecha || undefined,
        idempotencyKey: this.claveDeAlta,
      })
      .subscribe({
        next: (creado) => {
          this.creando.set(false);
          this.router.navigate(['/egresos', creado.id]).catch(() => undefined);
        },
        error: (error: unknown) => {
          this.creando.set(false);
          const traducido = traducirErrorEgreso(error);
          if (traducido.renovarClave === true) {
            this.claveDeAlta = nuevaClaveDeIntento();
          }
          this.errorAlta.set(traducido);
        },
      });
  }

  protected importe(egreso: Egreso, valor: number | undefined): string {
    return importeEnPalabras(valor, egreso.moneda);
  }

  protected campoInvalido(nombre: CampoDeAlta): boolean {
    if (!this.altaIntentada()) {
      return false;
    }
    switch (nombre) {
      case 'importe': {
        const centavos = centavosDeTexto(this.alta.controls.importe.value);
        return centavos === null || centavos <= 0;
      }
      case 'beneficiarioMembershipId':
      case 'beneficiarioNombre':
        return this.invalidoDeBeneficiario() === nombre;
      case 'periodoHasta':
        return this.periodoInvalido();
      default:
        return this.alta.controls[nombre].invalid;
    }
  }

  protected nombreDe(membership: MembershipResponse): string {
    return membership.accountName || membership.accountEmail || `Vinculo ${membership.id}`;
  }

  /** Que campo del beneficiario falta, segun el tipo elegido. */
  private invalidoDeBeneficiario(): CampoDeAlta | null {
    const v = this.alta.getRawValue();
    if (v.tipoBeneficiario === this.COLABORADOR) {
      return v.beneficiarioMembershipId === '' ? 'beneficiarioMembershipId' : null;
    }
    return v.beneficiarioNombre.trim() === '' ? 'beneficiarioNombre' : null;
  }

  /** El periodo liquidado va completo o vacio, y no al reves. */
  private periodoInvalido(): boolean {
    const { periodoDesde, periodoHasta } = this.alta.getRawValue();
    if (periodoDesde === '' && periodoHasta === '') {
      return false;
    }
    return periodoDesde === '' || periodoHasta === '' || periodoHasta < periodoDesde;
  }

  private cargarColaboradores(): void {
    const organizationId = this.tenantContext.organizationId();
    if (organizationId === null) {
      return;
    }
    this.sinColaboradores.set(false);
    this.api.colaboradoresVigentes(organizationId).subscribe({
      next: (lista) => this.colaboradores.set(lista),
      // Sin el padron (falta `colaborador:read`, por ejemplo) se puede cargar igual a un externo.
      error: () => {
        this.colaboradores.set([]);
        this.sinColaboradores.set(true);
      },
    });
  }
}
