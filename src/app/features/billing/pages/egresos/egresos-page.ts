import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { Egreso } from '../../../../api/generated/model/egreso';
import { MembershipResponse } from '../../../../api/generated/model/membership-response';
import { OfertaResponse } from '../../../../api/generated/model/oferta-response';
import { ResumenDeEgresos } from '../../../../api/generated/model/resumen-de-egresos';
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
import { fechaIsoEnPalabras } from '../../models/etiquetas-de-presentacion';
import { EgresosApi } from '../../services/egresos-api';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import { Icono } from '../../../../shared/components/icono/icono';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

type EstadoListado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly egresos: readonly Egreso[]; readonly hayMas: boolean }
  | { readonly tipo: 'error'; readonly error: ErrorEgreso };

/** La tira del mes: el resumen, o por que no esta. Un fallo no tapa el listado. */
type EstadoResumen =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly resumen: ResumenDeEgresos }
  | { readonly tipo: 'error' };

type CampoDeAlta =
  | 'beneficiarioMembershipId'
  | 'beneficiarioNombre'
  | 'concepto'
  | 'importe'
  | 'moneda'
  | 'periodoHasta';

/**
 * Filas por pagina: el `limite` por defecto del contrato. Se pide una de mas para saber si hay
 * pagina siguiente, porque la respuesta es un arreglo sin total.
 */
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
 * registro; por defecto arranca el primer dia del mes <b>de la sede</b>, no del navegador. La
 * busqueda por texto (`q`, DP-45) tambien es del servidor, y buscar vuelve a la primera pagina.
 * El contrato no ordena este listado (siempre del mas nuevo al mas viejo): los encabezados no
 * ofrecen orden, porque ordenar la pagina visible haria creer que se ordeno todo (plan §3.4).
 *
 * <p>La tira de arriba es el resumen del <b>mes en curso</b> que calcula el servidor (DP-45):
 * no depende de los filtros ni se suma nada aca.
 *
 * <p>El comprobante es una <b>referencia</b> —tipo, numero y fecha—: el archivo adjunto
 * (RF-M22-003) no existe en el backend, porque el storage duplicado todavia no se extrajo.
 */
@Component({
  selector: 'app-egresos-page',
  imports: [CabeceraDePagina, PanelLateral, Ayuda, Filtros, Icono, ReactiveFormsModule, RouterLink],
  templateUrl: './egresos-page.html',
  styleUrls: ['../../billing.css', '../../economia.css'],
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
  /** Un dia de la sede (`YYYY-MM-DD`), sin zona que aplicar. */
  protected readonly dia = fechaIsoEnPalabras;
  protected readonly importeEn = importeEnPalabras;
  protected readonly COLABORADOR = RegistrarEgresoTipoBeneficiarioEnum.COLABORADOR;
  protected readonly EXTERNO = RegistrarEgresoTipoBeneficiarioEnum.EXTERNO;

  private readonly desdePorDefecto = primeroDelMes(this.diaDeLaSede.hoy());
  protected readonly filtro = this.fb.group({
    q: [''],
    estado: [''],
    categoria: [''],
    desde: [this.desdePorDefecto],
    hasta: [''],
  });

  private readonly valorDelFiltro = toSignal(
    this.filtro.valueChanges.pipe(map(() => this.filtro.getRawValue())),
    { initialValue: this.filtro.getRawValue() },
  );
  /** Filtros avanzados fuera de su valor por defecto: el contador del embudo. */
  protected readonly filtrosAvanzadosActivos = computed(() => {
    const { estado, categoria, desde, hasta } = this.valorDelFiltro();
    return (
      Number(estado !== '') +
      Number(categoria !== '') +
      Number(desde !== this.desdePorDefecto) +
      Number(hasta !== '')
    );
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
    // DP-39: la oferta a la que se imputa el costo. Vacia = sin imputar (alquiler, impuestos).
    ofertaId: [''],
  });

  protected readonly estado = signal<EstadoListado>({ tipo: 'cargando' });
  /** Pagina mostrada, en base 0. */
  protected readonly pagina = signal(0);
  protected readonly estadoResumen = signal<EstadoResumen>({ tipo: 'cargando' });
  protected readonly colaboradores = signal<readonly MembershipResponse[]>([]);
  /** Ofertas activas de la sede, para imputar el costo (DP-39). Sin ellas, el egreso va sin imputar. */
  protected readonly ofertas = signal<readonly OfertaResponse[]>([]);
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
  protected readonly hayMas = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' && actual.hayMas;
  });
  /** Primera y ultima fila de la pagina, en base 1, para el pie del listado. */
  protected readonly filasMostradas = computed(() => {
    const primera = this.pagina() * PAGINA + 1;
    return { primera, ultima: primera + this.egresos().length - 1 };
  });
  protected readonly resumen = computed(() => {
    const actual = this.estadoResumen();
    return actual.tipo === 'listo' ? actual.resumen : null;
  });

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
        this.ofertas.set([]);
        this.errorAlta.set(null);
        this.cargarColaboradores();
        this.cargarOfertas();
        this.cargarResumen();
        this.buscar();
      });
    });
  }

  /** Buscar con los filtros del formulario: siempre desde la primera pagina. */
  protected buscar(): void {
    this.irAPagina(0);
  }

  protected irAPagina(pagina: number): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      this.estado.set({ tipo: 'error', error: errorSinContextoDeEgreso() });
      return;
    }
    const valor = this.filtro.getRawValue();
    this.pagina.set(pagina);
    this.estado.set({ tipo: 'cargando' });
    this.api
      .buscar(consultorioId, {
        q: valor.q.trim() || undefined,
        estado: valor.estado || undefined,
        categoria: valor.categoria || undefined,
        desde: valor.desde || undefined,
        hasta: valor.hasta || undefined,
        limite: PAGINA + 1,
        desplazamiento: pagina * PAGINA,
      })
      .subscribe({
        next: (egresos) =>
          this.estado.set({
            tipo: 'listo',
            egresos: egresos.slice(0, PAGINA),
            hayMas: egresos.length > PAGINA,
          }),
        error: (error: unknown) =>
          this.estado.set({ tipo: 'error', error: traducirErrorEgreso(error) }),
      });
  }

  /** El panel de alta (refactor UX/UI del 28/10/2026): se abre desde "Registrar egreso". */
  protected readonly altaAbierta = signal(false);

  protected abrirAlta(): void {
    this.errorAlta.set(null);
    this.altaAbierta.set(true);
  }

  protected cerrarAlta(): void {
    if (!this.creando()) {
      this.altaAbierta.set(false);
    }
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
        ofertaId: v.ofertaId === '' ? undefined : Number(v.ofertaId),
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

  private cargarResumen(): void {
    // Sin sede no hay tira: el listado ya dice que falta el contexto.
    this.estadoResumen.set({ tipo: 'cargando' });
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      return;
    }
    this.api.resumen(consultorioId).subscribe({
      next: (resumen) => this.estadoResumen.set({ tipo: 'listo', resumen }),
      error: () => this.estadoResumen.set({ tipo: 'error' }),
    });
  }

  private cargarOfertas(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      return;
    }
    // Sin el listado (un error de red, por ejemplo) se carga igual: el egreso va sin imputar.
    this.api.ofertasDeLaSede(consultorioId).subscribe({
      next: (lista) => this.ofertas.set(lista.filter((o) => o.estado === 'ACTIVO')),
      error: () => this.ofertas.set([]),
    });
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
