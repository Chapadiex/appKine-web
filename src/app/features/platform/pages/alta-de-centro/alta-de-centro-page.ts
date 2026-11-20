import { Icono, NombreDeIcono } from '../../../../shared/components/icono/icono';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { ContratacionService } from '../../../../api/generated/api/contratacion.service';
import { PedidosDePruebaService } from '../../../../api/generated/api/pedidos-de-prueba.service';
import { PlanesService } from '../../../../api/generated/api/planes.service';
import {
  AltaDeCentroRequest,
  AltaDeCentroRequestAdicionalesEnum,
  AltaDeCentroRequestServiciosEnum,
} from '../../../../api/generated/model/alta-de-centro-request';
import { PlanResponse } from '../../../../api/generated/model/plan-response';
import { SolicitudDePruebaResponse } from '../../../../api/generated/model/solicitud-de-prueba-response';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import {
  OpcionEnTarjeta,
  OpcionesEnTarjetas,
} from '../../../../shared/components/opciones-en-tarjetas/opciones-en-tarjetas';
import { textoRequerido } from '../../../../shared/validators/texto-requerido';
import { traducirErrorContratacion } from '../../models/contratacion-errors';
import {
  PLAN_SUGERIDO,
  SERVICIOS,
  etiquetaDeSedes,
  marcaDePedido,
  nombreVisibleDePlan,
  planesOfrecidos,
  serviciosEnTexto,
  serviciosDelPedido,
  topeDeSedes,
} from '../../models/contratacion';
import {
  RUTA_PEDIDOS_DE_PRUEBA_DE_PLATAFORMA,
  RUTA_SUSCRIPCIONES_DE_PLATAFORMA,
} from '../../models/rutas-de-plataforma';

/** Zona por defecto del alta: la de la mayoria de los centros. */
export const ZONA_POR_DEFECTO = 'America/Argentina/Cordoba';

/**
 * Zonas de Argentina para el alta. No se importa el helper de zonas de `organization` (un feature no
 * importa de otro): el dueño la ajusta despues desde Organización si hace falta.
 */
const ZONAS: readonly { readonly valor: string; readonly etiqueta: string }[] = [
  { valor: 'America/Argentina/Cordoba', etiqueta: 'Córdoba' },
  { valor: 'America/Argentina/Buenos_Aires', etiqueta: 'Buenos Aires' },
  { valor: 'America/Argentina/Mendoza', etiqueta: 'Mendoza' },
  { valor: 'America/Argentina/Salta', etiqueta: 'Salta' },
  { valor: 'America/Argentina/Tucuman', etiqueta: 'Tucumán' },
  { valor: 'America/Argentina/Jujuy', etiqueta: 'Jujuy' },
  { valor: 'America/Argentina/Catamarca', etiqueta: 'Catamarca' },
  { valor: 'America/Argentina/La_Rioja', etiqueta: 'La Rioja' },
  { valor: 'America/Argentina/San_Juan', etiqueta: 'San Juan' },
  { valor: 'America/Argentina/San_Luis', etiqueta: 'San Luis' },
  { valor: 'America/Argentina/Rio_Gallegos', etiqueta: 'Río Gallegos' },
  { valor: 'America/Argentina/Ushuaia', etiqueta: 'Ushuaia' },
];

/** Al menos un servicio: el backend tambien lo exige (400). */
function algunServicio(grupo: AbstractControl): ValidationErrors | null {
  const valor = grupo.value as Record<string, boolean>;
  return Object.values(valor).some(Boolean) ? null : { sinServicio: true };
}

type Pedido =
  | { readonly tipo: 'ninguno' }
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly pedido: SolicitudDePruebaResponse }
  | { readonly tipo: 'error'; readonly mensaje: string };

/** Campos del cuerpo que el formulario sabe marcar cuando el backend los rechaza. */
const CAMPOS = [
  'nombreCentro',
  'nombrePrimeraSede',
  'emailDuenio',
  'zonaHoraria',
  'planCode',
  'servicios',
] as const;
type Campo = (typeof CAMPOS)[number];

/**
 * Alta de un centro desde la consola de plataforma (diseño `AKINE-landing-y-ofertas.md` §6).
 *
 * <p>Crea el centro con su primera sede y su contratacion —plan ofrecido, servicios y la IA como
 * adicional—, en prueba gratis de 30 dias o activo, y el backend invita al correo del dueño como
 * administrador. Todo o nada.
 *
 * <p><b>Con `?solicitud=<id>` aprueba un pedido de la landing.</b> Lee el pedido, prellena nombre
 * del centro, correo, servicios e IA, sugiere el plan por las sedes que declaro y manda
 * `solicitudId`: el pedido queda `APROBADA` en la misma transaccion. Si otra persona ya lo resolvio,
 * el backend responde 409 y no se crea nada.
 */
@Component({
  selector: 'app-alta-de-centro-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Alerta,
    Ayuda,
    CabeceraDePagina,
    Icono,
    OpcionesEnTarjetas,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './alta-de-centro-page.html',
  styleUrl: './alta-de-centro-page.css',
})
export class AltaDeCentroPage implements OnInit {
  private readonly contratacion = inject(ContratacionService);
  private readonly pedidosDePrueba = inject(PedidosDePruebaService);
  private readonly catalogoDePlanes = inject(PlanesService);
  private readonly avisos = inject(AvisosStore);
  private readonly router = inject(Router);

  /** `?solicitud=<id>` (binding de inputs del router). */
  readonly solicitud = input<string | undefined>(undefined);

  protected readonly rutaPedidos = RUTA_PEDIDOS_DE_PRUEBA_DE_PLATAFORMA;
  protected readonly zonas = ZONAS;
  protected readonly servicios = SERVICIOS;

  /** Ícono de cada servicio en su tarjeta de selección. */
  protected readonly iconoDeServicio: Readonly<Record<string, NombreDeIcono>> = {
    KINESIOLOGIA: 'pacientes',
    ACTIVIDADES: 'actividades',
  };
  protected readonly etiquetaDeSedes = etiquetaDeSedes;
  protected readonly marcaDePedido = marcaDePedido;

  protected readonly formulario = new FormGroup({
    nombreCentro: new FormControl('', {
      nonNullable: true,
      validators: [textoRequerido, Validators.maxLength(150)],
    }),
    nombrePrimeraSede: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(150)],
    }),
    emailDuenio: new FormControl('', {
      nonNullable: true,
      validators: [textoRequerido, Validators.email, Validators.maxLength(254)],
    }),
    zonaHoraria: new FormControl(ZONA_POR_DEFECTO, { nonNullable: true }),
    planCode: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    servicios: new FormGroup(
      {
        KINESIOLOGIA: new FormControl(true, { nonNullable: true }),
        ACTIVIDADES: new FormControl(false, { nonNullable: true }),
      },
      { validators: algunServicio },
    ),
    ia: new FormControl(false, { nonNullable: true }),
    prueba: new FormControl(true, { nonNullable: true }),
  });

  protected readonly planes = signal<readonly PlanResponse[]>([]);
  protected readonly planesNoDisponibles = signal(false);
  protected readonly opcionesDePlan = computed<OpcionEnTarjeta[]>(() =>
    this.planes().map((plan) => ({
      valor: plan.code ?? '',
      etiqueta: nombreVisibleDePlan(plan.code, plan.name),
      descripcion: topeDeSedes(plan),
    })),
  );
  protected readonly pedido = signal<Pedido>({ tipo: 'ninguno' });
  protected readonly enviando = signal(false);
  protected readonly intentos = signal(0);
  protected readonly errorEnvio = signal<string | null>(null);
  /** Rechazos del backend por campo, del ultimo envio. */
  protected readonly erroresDelServidor = signal<Readonly<Record<string, string>>>({});

  protected readonly errorDePedido = computed(() => {
    const pedido = this.pedido();
    return pedido.tipo === 'error' ? pedido.mensaje : null;
  });
  /** El pedido que se esta aprobando, si sigue pendiente. */
  protected readonly pedidoPendiente = computed(() => {
    const pedido = this.pedido();
    return pedido.tipo === 'listo' && pedido.pedido.estado === 'PENDIENTE' ? pedido.pedido : null;
  });
  /** El pedido ya se resolvio: no se puede aprobar de nuevo. */
  protected readonly pedidoResuelto = computed(() => {
    const pedido = this.pedido();
    return pedido.tipo === 'listo' && pedido.pedido.estado !== 'PENDIENTE' ? pedido.pedido : null;
  });

  constructor() {
    this.catalogoDePlanes.listPlans().subscribe({
      next: (planes) => {
        this.planes.set(planesOfrecidos(planes));
        if (this.formulario.controls.planCode.value === '') {
          this.formulario.controls.planCode.setValue(this.planes()[0]?.code ?? '');
        }
      },
      error: () => this.planesNoDisponibles.set(true),
    });
  }

  ngOnInit(): void {
    const id = Number(this.solicitud());
    if (!this.solicitud() || !Number.isInteger(id) || id <= 0) return;
    this.pedido.set({ tipo: 'cargando' });
    this.pedidosDePrueba.verSolicitudDePrueba({ id }).subscribe({
      next: (pedido) => {
        this.pedido.set({ tipo: 'listo', pedido });
        if (pedido.estado === 'PENDIENTE') this.prellenar(pedido);
      },
      error: (error: unknown) =>
        this.pedido.set({
          tipo: 'error',
          mensaje: traducirErrorContratacion(error, 'lectura').mensaje,
        }),
    });
  }

  protected serviciosPedidos(pedido: SolicitudDePruebaResponse): string {
    return serviciosEnTexto(serviciosDelPedido(pedido));
  }

  /** Mensaje de un campo: primero la validacion local (tras un intento), despues el servidor. */
  protected errorDe(campo: Campo): string | null {
    const servidor = this.erroresDelServidor()[campo];
    if (servidor) return servidor;
    const control = this.formulario.get(campo);
    if (!control || control.valid || (!control.touched && this.intentos() === 0)) return null;
    if (campo === 'servicios') return 'Elegí al menos un servicio.';
    if (control.hasError('email')) return 'Escribí un correo válido.';
    if (control.hasError('maxlength')) return 'Es demasiado largo.';
    if (campo === 'planCode') return 'Elegí un plan.';
    return 'Este dato es obligatorio.';
  }

  protected crear(): void {
    if (this.enviando() || this.pedidoResuelto() !== null) return;
    this.intentos.update((n) => n + 1);
    this.erroresDelServidor.set({});
    this.errorEnvio.set(null);
    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }
    const cuerpo = this.cuerpo();
    this.enviando.set(true);
    this.contratacion.darDeAltaCentro({ altaDeCentroRequest: cuerpo }).subscribe({
      next: (respuesta) => {
        this.enviando.set(false);
        this.avisos.exito('Centro creado', {
          descripcion: `Invitamos a ${respuesta.emailDuenio ?? cuerpo.emailDuenio} como administrador.`,
        });
        this.router
          .navigate(
            [RUTA_SUSCRIPCIONES_DE_PLATAFORMA],
            respuesta.organizationId === undefined
              ? {}
              : { queryParams: { org: respuesta.organizationId, nombre: cuerpo.nombreCentro } },
          )
          .catch(() => undefined);
      },
      error: (error: unknown) => {
        this.enviando.set(false);
        const traducido = traducirErrorContratacion(error, 'alta');
        this.erroresDelServidor.set(traducido.campos);
        const marcados = Object.keys(traducido.campos).filter((c) =>
          (CAMPOS as readonly string[]).includes(c),
        );
        this.errorEnvio.set(
          traducido.causa === 'validacion' && marcados.length > 0
            ? 'Revisá los campos marcados.'
            : traducido.mensaje,
        );
      },
    });
  }

  private cuerpo(): AltaDeCentroRequest {
    const valor = this.formulario.getRawValue();
    const sede = valor.nombrePrimeraSede.trim();
    const pedido = this.pedidoPendiente();
    return {
      nombreCentro: valor.nombreCentro.trim(),
      ...(sede === '' ? {} : { nombrePrimeraSede: sede }),
      zonaHoraria: valor.zonaHoraria,
      emailDuenio: valor.emailDuenio.trim(),
      planCode: valor.planCode,
      servicios: SERVICIOS.filter((s) => valor.servicios[s.valor]).map(
        (s) => s.valor as AltaDeCentroRequestServiciosEnum,
      ),
      adicionales: valor.ia ? [AltaDeCentroRequestAdicionalesEnum.IA] : [],
      prueba: valor.prueba,
      ...(pedido?.id === undefined ? {} : { solicitudId: pedido.id }),
    };
  }

  private prellenar(pedido: SolicitudDePruebaResponse): void {
    const servicios = serviciosDelPedido(pedido);
    this.formulario.patchValue({
      nombreCentro: pedido.nombreCentro ?? '',
      emailDuenio: pedido.email ?? '',
      servicios: {
        // Un pedido sin servicios marcados no deja el formulario invalido: queda Kinesiologia.
        KINESIOLOGIA: servicios.length === 0 || servicios.includes('KINESIOLOGIA'),
        ACTIVIDADES: servicios.includes('ACTIVIDADES'),
      },
      ia: pedido.interesaIa === true,
      prueba: true,
      ...(pedido.sedes ? { planCode: PLAN_SUGERIDO[pedido.sedes] } : {}),
    });
  }
}
