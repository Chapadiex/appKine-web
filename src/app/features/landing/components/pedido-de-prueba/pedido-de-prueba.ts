import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  Injector,
  signal,
  untracked,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';

import { PedidosDePruebaService } from '../../../../api/generated/api/pedidos-de-prueba.service';
import {
  SolicitudDePruebaRequest,
  SolicitudDePruebaRequestSedesEnum,
} from '../../../../api/generated/model/solicitud-de-prueba-request';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { OpcionChip } from '../../../../shared/components/chips/chips';
import { Icono } from '../../../../shared/components/icono/icono';
import { Segmentado } from '../../../../shared/components/segmentado/segmentado';
import { nuevaClaveDeIntento } from '../../../../shared/utils/clave-de-intento';
import { crearEsperaPorLimite } from '../../../../shared/utils/espera-por-limite';
import { textoRequerido } from '../../../../shared/validators/texto-requerido';
import { EleccionDelArmador, SEDES_DEL_PEDIDO } from '../../models/eleccion-del-armador';

/** Los campos que el backend puede marcar en un 400, en el orden en que se enfoca el primero. */
const CAMPOS = [
  'nombre',
  'apellido',
  'email',
  'telefono',
  'nombreCentro',
  'ciudad',
  'servicios',
  'sedes',
  'comentario',
] as const;

type Campo = (typeof CAMPOS)[number];

export const MAXIMO_COMENTARIO = 1000;

const MENSAJE_RED =
  'No pudimos conectarnos con AKINE. Revisá tu conexión y volvé a enviar: tus datos siguen acá.';

type Estado =
  | { readonly tipo: 'editando' }
  | { readonly tipo: 'enviando' }
  | { readonly tipo: 'ok'; readonly email: string }
  | { readonly tipo: 'error'; readonly titulo: string; readonly mensaje: string };

/** Al menos uno de los dos servicios. */
function algunServicio(grupo: AbstractControl): ValidationErrors | null {
  const valor = grupo.value as { kinesiologia: boolean; actividades: boolean };
  return valor.kinesiologia || valor.actividades ? null : { ningunServicio: true };
}

/**
 * Pedido de la prueba gratis de 30 días (`AKINE-landing-y-ofertas.md` §5), en la sección
 * `#prueba` de la landing. Público: `POST /api/v1/public/solicitudes-de-prueba` sin sesión, que
 * responde 202 sin cuerpo.
 *
 * <p><b>Idempotencia.</b> Una clave por intento: se reusa si el visitante reenvía el mismo pedido
 * después de un corte de red, y se genera otra si cambió algún dato (misma clave con otro cuerpo es
 * `409 idempotency-key-conflict`).
 *
 * <p><b>Campo trampa.</b> `sitioWeb` es un input que una persona no ve ni alcanza con el teclado;
 * se manda lo que tenga, que para una persona es siempre vacío. Si viene lleno, el backend descarta
 * el pedido en silencio.
 *
 * <p><b>Precarga.</b> Servicios, sedes e IA arrancan con lo elegido en el armador de planes, y lo
 * siguen mientras el visitante no los toque en el formulario.
 */
@Component({
  selector: 'app-pedido-de-prueba',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Alerta, Icono, Segmentado],
  templateUrl: './pedido-de-prueba.html',
  styleUrl: './pedido-de-prueba.css',
})
export class PedidoDePrueba {
  private readonly pedidos = inject(PedidosDePruebaService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly eleccion = inject(EleccionDelArmador, { optional: true });

  protected readonly maximoComentario = MAXIMO_COMENTARIO;

  protected readonly opcionesDeSedes: readonly OpcionChip[] = [
    { valor: SolicitudDePruebaRequestSedesEnum.UNA, etiqueta: '1 sede' },
    { valor: SolicitudDePruebaRequestSedesEnum.HASTA_TRES, etiqueta: '2 o 3' },
    { valor: SolicitudDePruebaRequestSedesEnum.MAS_DE_TRES, etiqueta: 'Más de 3' },
  ];

  protected readonly formulario = inject(FormBuilder).nonNullable.group({
    nombre: ['', [textoRequerido]],
    apellido: ['', [textoRequerido]],
    email: ['', [Validators.required, Validators.email]],
    telefono: [''],
    nombreCentro: ['', [textoRequerido]],
    ciudad: [''],
    servicios: inject(FormBuilder).nonNullable.group(
      { kinesiologia: [true], actividades: [false] },
      { validators: [algunServicio] },
    ),
    sedes: [SolicitudDePruebaRequestSedesEnum.UNA as string, [Validators.required]],
    interesaIa: [false],
    comentario: ['', [Validators.maxLength(MAXIMO_COMENTARIO)]],
    sitioWeb: [''],
  });

  protected readonly estado = signal<Estado>({ tipo: 'editando' });
  protected readonly intentos = signal(0);
  protected readonly espera = crearEsperaPorLimite();

  /** Mensajes del backend por campo (400), hasta que el visitante edite ese campo. */
  protected readonly erroresDelServidor = signal<Partial<Record<Campo, string>>>({});

  protected readonly enviando = computed(() => this.estado().tipo === 'enviando');
  protected readonly bloqueado = computed(() => this.enviando() || this.espera.activa());

  private clave: string | null = null;
  private firmaDeLaClave: string | null = null;

  constructor() {
    // Lo elegido en el armador precarga lo que el visitante todavía no tocó acá.
    const eleccion = this.eleccion;
    if (eleccion !== null) {
      effect(() => {
        const sedes = SEDES_DEL_PEDIDO[eleccion.sedes()];
        const servicios = eleccion.servicios();
        const ia = eleccion.ia() === 'si';
        untracked(() => this.precargar(sedes, servicios, ia));
      });
    }

    for (const campo of CAMPOS) {
      (this.formulario.controls[campo] as AbstractControl).valueChanges.subscribe(() => {
        if (this.erroresDelServidor()[campo] !== undefined) {
          this.erroresDelServidor.update((errores) => {
            const resto = { ...errores };
            delete resto[campo];
            return resto;
          });
        }
      });
    }
  }

  /** Solo para tests y diagnóstico: la clave con la que salió el último envío. */
  get claveDeIntento(): string | null {
    return this.clave;
  }

  protected mostrarError(campo: Campo): boolean {
    if (this.erroresDelServidor()[campo] !== undefined) {
      return true;
    }
    const control = this.formulario.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected errorDelServidor(campo: Campo): string | undefined {
    return this.erroresDelServidor()[campo];
  }

  protected largoDelComentario(): number {
    return this.formulario.controls.comentario.value.length;
  }

  protected enviar(): void {
    this.intentos.update((n) => n + 1);

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      this.enfocarPrimerInvalido();
      return;
    }
    if (this.bloqueado()) {
      return;
    }

    const cuerpo = this.armarCuerpo();
    const idempotencyKey = this.claveParaEsteCuerpo(cuerpo);
    this.estado.set({ tipo: 'enviando' });

    this.pedidos.pedirPruebaGratis({ idempotencyKey, solicitudDePruebaRequest: cuerpo }).subscribe({
      next: () => {
        this.estado.set({ tipo: 'ok', email: cuerpo.email });
        afterNextRender(
          () => this.host.nativeElement.querySelector<HTMLElement>('#pedido-ok')?.focus(),
          { injector: this.injector },
        );
      },
      error: (error: unknown) => this.fallar(error),
    });
  }

  private precargar(
    sedes: SolicitudDePruebaRequestSedesEnum,
    servicios: string,
    ia: boolean,
  ): void {
    const controles = this.formulario.controls;
    if (controles.sedes.pristine) {
      controles.sedes.setValue(sedes);
    }
    if (controles.servicios.pristine) {
      controles.servicios.setValue({
        kinesiologia: servicios !== 'actividades',
        actividades: servicios !== 'kinesiologia',
      });
    }
    if (controles.interesaIa.pristine) {
      controles.interesaIa.setValue(ia);
    }
  }

  private armarCuerpo(): SolicitudDePruebaRequest {
    const v = this.formulario.getRawValue();
    const opcional = (texto: string): string | undefined => texto.trim() || undefined;
    return {
      nombre: v.nombre.trim(),
      apellido: v.apellido.trim(),
      email: v.email.trim(),
      telefono: opcional(v.telefono),
      nombreCentro: v.nombreCentro.trim(),
      ciudad: opcional(v.ciudad),
      kinesiologia: v.servicios.kinesiologia,
      actividades: v.servicios.actividades,
      sedes: v.sedes as SolicitudDePruebaRequestSedesEnum,
      interesaIa: v.interesaIa,
      comentario: opcional(v.comentario),
      sitioWeb: v.sitioWeb,
    };
  }

  private claveParaEsteCuerpo(cuerpo: SolicitudDePruebaRequest): string {
    const firma = JSON.stringify(cuerpo);
    if (this.clave === null || this.firmaDeLaClave !== firma) {
      this.clave = nuevaClaveDeIntento();
      this.firmaDeLaClave = firma;
    }
    return this.clave;
  }

  private fallar(error: unknown): void {
    const titulo = 'No pudimos enviar tu pedido';

    if (!(error instanceof AkineHttpError)) {
      this.estado.set({ tipo: 'error', titulo, mensaje: MENSAJE_RED });
      return;
    }
    if (error.esDeRed) {
      // Misma clave en el reintento: si el pedido llegó, el backend no lo duplica.
      this.estado.set({ tipo: 'error', titulo, mensaje: MENSAJE_RED });
      return;
    }
    if (error.status === 429) {
      const segundos = error.reintentarEnSegundos ?? 60;
      this.espera.iniciar(segundos);
      this.estado.set({
        tipo: 'error',
        titulo: 'Recibimos varios pedidos seguidos',
        mensaje: 'Esperá un momento y volvé a enviar. No hace falta completar todo de nuevo.',
      });
      return;
    }
    if (error.problemType === 'idempotency-key-conflict') {
      this.clave = null;
      this.firmaDeLaClave = null;
    }
    if (error.status === 400) {
      const porCampo = this.marcarCampos(error.erroresPorCampo);
      this.estado.set({
        tipo: 'error',
        titulo: 'Revisá los datos',
        mensaje:
          error.mensajeSinCampos((campo) => (this.destinoDe(campo) ?? '') in porCampo) ??
          error.mensajeDeCampos ??
          error.mensaje,
      });
      this.enfocarPrimerInvalido();
      return;
    }
    this.estado.set({ tipo: 'error', titulo, mensaje: error.mensaje });
  }

  /** Los errores del 400 que caen en un campo del formulario, marcados junto a él. */
  private marcarCampos(errores: Readonly<Record<string, string>>): Partial<Record<Campo, string>> {
    const porCampo: Partial<Record<Campo, string>> = {};
    for (const [campo, mensaje] of Object.entries(errores)) {
      const destino = this.destinoDe(campo);
      if (destino !== undefined) {
        porCampo[destino] = mensaje;
      }
    }
    this.erroresDelServidor.set(porCampo);
    return porCampo;
  }

  /** El campo del formulario donde se muestra un error del backend: los servicios van juntos. */
  private destinoDe(campo: string): Campo | undefined {
    if (campo === 'kinesiologia' || campo === 'actividades') {
      return 'servicios';
    }
    return CAMPOS.find((c) => c === campo);
  }

  private enfocarPrimerInvalido(): void {
    afterNextRender(
      () => {
        const campo = CAMPOS.find((c) => this.mostrarError(c));
        if (campo === undefined) {
          return;
        }
        const destino =
          campo === 'servicios'
            ? '#pedido-kinesiologia'
            : campo === 'sedes'
              ? '#pedido-sedes input'
              : `#pedido-${campo}`;
        this.host.nativeElement.querySelector<HTMLElement>(destino)?.focus();
      },
      { injector: this.injector },
    );
  }
}
