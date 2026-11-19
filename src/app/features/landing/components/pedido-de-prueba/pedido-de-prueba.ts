import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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

  /** Campos que el visitante editó y después dejó: recién ahí se marcan sus errores. */
  private readonly editadosYDejados = signal<ReadonlySet<Campo>>(new Set());

  /** Texto de la única región viva del formulario: el error de un campo, al salir de él. */
  protected readonly anuncio = signal('');
  private readonly anunciados = new Set<Campo>();
  private campoAnunciado: Campo | null = null;
  private temporizadorDeAnuncio: ReturnType<typeof setTimeout> | undefined;

  private clave: string | null = null;
  private firmaDeLaClave: string | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.temporizadorDeAnuncio));

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
      const control = this.formulario.controls[campo] as AbstractControl;
      control.valueChanges.subscribe(() => {
        if (control.valid) {
          this.olvidarAnuncio(campo);
        }
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

  /**
   * Al salir de un campo que quedó con error, lo anuncia por la región viva medio segundo después,
   * para no pisar al lector de pantalla cuando lee el campo siguiente. Una vez por error: se vuelve
   * a anunciar sólo si el campo se corrigió y volvió a fallar.
   */
  protected alSalir(evento: FocusEvent): void {
    const campo = campoDelElemento(evento.target);
    if (campo === undefined) {
      return;
    }
    if (this.formulario.controls[campo].dirty && !this.editadosYDejados().has(campo)) {
      this.editadosYDejados.update((campos) => new Set(campos).add(campo));
    }
    clearTimeout(this.temporizadorDeAnuncio);
    this.temporizadorDeAnuncio = setTimeout(() => {
      if (!this.mostrarError(campo) || this.anunciados.has(campo)) {
        return;
      }
      const raiz = this.host.nativeElement;
      const error = raiz.querySelector<HTMLElement>(`#pedido-${campo}-error`);
      if (error === null) {
        return;
      }
      const etiqueta =
        campo === 'servicios'
          ? raiz.querySelector<HTMLElement>('.pedido__grupo legend')
          : raiz.querySelector<HTMLElement>(`label[for="pedido-${campo}"]`);
      this.anunciados.add(campo);
      this.campoAnunciado = campo;
      this.anuncio.set(`${textoLeido(etiqueta)}: ${textoLeido(error)}`);
    }, 500);
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
    // Recién después de la interacción (editar y salir) o de intentar enviar: un campo vacío por el
    // que sólo se pasó con Tab no se marca (Modern Web Guidance, validate-input-after-interaction).
    return control.invalid && (this.editadosYDejados().has(campo) || this.intentos() > 0);
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
      // Tras un envío fallido el foco va al primer campo con error y el lector lo lee ahí: los
      // errores de este intento ya no se anuncian al salir de cada campo.
      for (const campo of CAMPOS) {
        if (this.formulario.controls[campo].invalid) {
          this.anunciados.add(campo);
        }
      }
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

  private olvidarAnuncio(campo: Campo): void {
    this.anunciados.delete(campo);
    if (this.campoAnunciado === campo) {
      clearTimeout(this.temporizadorDeAnuncio);
      this.campoAnunciado = null;
      this.anuncio.set('');
    }
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

/** El campo del formulario al que pertenece un control, por su `id` (`pedido-<campo>`). */
function campoDelElemento(elemento: EventTarget | null): Campo | undefined {
  if (!(elemento instanceof HTMLElement) || !elemento.id.startsWith('pedido-')) {
    return undefined;
  }
  const nombre = elemento.id.slice('pedido-'.length);
  if (nombre === 'kinesiologia' || nombre === 'actividades') {
    return 'servicios';
  }
  return CAMPOS.find((campo) => campo === nombre);
}

/** El texto como lo lee un lector de pantalla: sin lo que está `aria-hidden`. */
function textoLeido(elemento: HTMLElement | null): string {
  if (elemento === null) {
    return '';
  }
  const copia = elemento.cloneNode(true) as HTMLElement;
  copia.querySelectorAll('[aria-hidden="true"]').forEach((nodo) => nodo.remove());
  return (copia.textContent ?? '').replace(/\s+/g, ' ').trim();
}
