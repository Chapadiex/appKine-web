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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { Alerta } from '../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../core/services/avisos.store';

import { ConsultoriosService } from '../../../../api/generated/api/consultorios.service';
import { CreateConsultorioRequest } from '../../../../api/generated/model/create-consultorio-request';
import { SedesDelContexto } from '../../services/sedes-del-contexto';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { CausaConsultorio, traducirErrorConsultorio } from '../../models/consultorio-errors';
import { crearEsperaPorLimite } from '../../../../shared/utils/espera-por-limite';
import { etiquetaDeZona, zonasHorarias } from '../../models/zonas-horarias';
import { nuevaClaveDeIntento } from '../../../../shared/utils/clave-de-intento';
import { numeroDeclarado } from '../../../../shared/utils/numero-declarado';
import { textoRequerido } from '../../../../shared/validators/texto-requerido';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { EditorDeFranjas } from '../../../../shared/components/editor-de-franjas/editor-de-franjas';
import { etiquetaDeDia } from '../../../../shared/utils/dias-de-la-semana';
import { rangoHorario } from '../../../../shared/utils/horas-de-pared';
import {
  crearFranjasForm,
  erroresDeFranjasDelServidor,
  franjasDelFormulario,
} from '../../../../shared/utils/franjas-semanales';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

/** Estado del alta. Los cuatro casos exigen pantalla distinta (ADR-0005). */
type EstadoAlta =
  | { readonly tipo: 'editando' }
  | { readonly tipo: 'enviando' }
  | { readonly tipo: 'ok' }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly causa: CausaConsultorio };

/** Campos de cada paso, en el orden en que se enfoca el primero invalido tras un submit. */
const CAMPOS_PASO_1 = ['name', 'slotMinutes'] as const;
const CAMPOS_PASO_2 = ['boxCapacidad', 'contactEmail'] as const;

type Paso = 1 | 2 | 3;

/** Los tres pasos del alta, con lo que se carga en cada uno. */
const PASOS: readonly { readonly numero: Paso; readonly titulo: string; readonly sub: string }[] = [
  { numero: 1, titulo: 'Datos de la sede', sub: 'Nombre, zona horaria y agenda' },
  { numero: 2, titulo: 'Configuración inicial', sub: 'Opcional: box, horario y datos' },
  { numero: 3, titulo: 'Confirmación', sub: 'Revisar y crear' },
];

/** Datos institucionales, con el rotulo que lleva cada uno en el resumen. */
const INSTITUCIONALES = [
  ['legalName', 'Razón social'],
  ['taxId', 'CUIT'],
  ['addressLine', 'Dirección'],
  ['phone', 'Teléfono'],
  ['contactEmail', 'Email'],
] as const;

/**
 * Alta de una sede adicional, en tres pasos (M01, AKINE-02.01; refactor UX/UI del 28/10/2026).
 *
 * <p>Consume `POST /organizations/{orgId}/consultorios`, que exige `consultorio:manage` con
 * alcance de <b>organizacion</b>: un administrador de una sola sede no puede crear otras, y
 * no hace falta ninguna regla especial aca para impedirlo —un alta no tiene sede objetivo,
 * asi que la interseccion con un alcance de una sola sede es vacia y el backend responde
 * `403`—.
 *
 * <p><b>Por que tres pasos y no un formulario largo.</b> Lo unico obligatorio es el nombre.
 * El paso 1 es lo minimo para que la sede exista (nombre, zona, agenda). El paso 2 junta la
 * configuracion inicial OPCIONAL —primer box y horario general lado a lado, y los datos
 * institucionales plegados—: se puede saltear entero y completar despues. El paso 3 muestra
 * todo lo que se va a crear antes de crearlo, agrupado como se cargo.
 *
 * <h2>La clave de idempotencia</h2>
 *
 * <p>El header `Idempotency-Key` es obligatorio y <b>se genera una vez por intento</b>, no
 * por llamada: si el envio falla por un corte de red, el reintento va con la <b>misma</b>
 * clave y el backend devuelve la sede que ya habia creado en vez de crear una segunda. Eso
 * es lo que cierra el doble submit y el timeout, que es justamente el caso en el que el
 * cliente no sabe si el request llego.
 *
 * <p><b>Si el usuario cambia el cuerpo, la clave se renueva.</b> Reintentar la misma clave
 * con otro contenido es `409 idempotency-key-conflict`: para el backend eso ya no es un
 * reintento, es otra alta. Por eso el cuerpo enviado se guarda serializado y se compara en
 * cada envio (ver {@link claveParaElCuerpo}).
 *
 * <p><b>Un replay responde `201` con la misma sede, no `200`.</b> No hay forma —ni falta—
 * de distinguirlo desde aca: la pantalla muestra la sede que devolvio el backend, que es la
 * correcta en los dos casos. Lo que <b>no</b> hay que hacer es contar dos altas.
 *
 * <p><b>Reacciona a `contextEpoch`.</b> Un alta a medio llenar bajo la Organizacion A no
 * puede enviarse bajo la B, y su clave de intento tampoco: el formulario y el intento se
 * descartan enteros con el cambio de contexto.
 */
@Component({
  selector: 'app-new-consultorio-page',
  imports: [CabeceraDePagina, Ayuda, ReactiveFormsModule, RouterLink, EditorDeFranjas, Alerta],
  templateUrl: './new-consultorio-page.html',
  styleUrl: '../../organization.css',
})
export class NewConsultorioPage {
  private readonly consultorios = inject(ConsultoriosService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly sedes = inject(SedesDelContexto);
  private readonly router = inject(Router);
  private readonly avisos = inject(AvisosStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly pasos = PASOS;

  protected readonly zonas = zonasHorarias();
  protected readonly etiquetaDeZona = etiquetaDeZona;
  protected readonly espera = crearEsperaPorLimite();

  protected readonly formulario = inject(FormBuilder).nonNullable.group({
    name: ['', [textoRequerido]],
    // Vacio significa "heredar la de la organizacion": el contrato lo expresa OMITIENDO el
    // campo, no mandando una cadena vacia, que seria una zona invalida.
    timezone: [''],
    slotMinutes: ['', [Validators.min(1)]],
    legalName: [''],
    taxId: [''],
    addressLine: [''],
    phone: [''],
    contactEmail: ['', [Validators.email]],
    // Primer box (A-8, RF-M03-002). Vacio = la sede se crea sin box, como antes.
    boxNombre: [''],
    boxCapacidad: ['', [Validators.min(1)]],
  });

  /**
   * Horario general de la sede (A-8). Lista vacia = el campo se omite del alta. Fuera de
   * `formulario` porque el editor de franjas es de `shared/` y trabaja sobre su propio
   * `FormArray`.
   */
  protected readonly horario = crearFranjasForm();

  /** Errores de franja del ultimo `400`, por indice. Se limpian al editar el horario. */
  protected readonly erroresHorario = signal<ReadonlyMap<number, string>>(new Map());

  /** Error del primer box en el ultimo `400` (`primerBox.name`, `primerBox.capacidad`). */
  protected readonly errorPrimerBox = signal<string | null>(null);

  protected readonly paso = signal<Paso>(1);

  /** "Datos institucionales" plegado: se abre solo si hay algo cargado o algo que corregir. */
  protected readonly institucionalAbierto = signal(false);
  protected readonly estado = signal<EstadoAlta>({ tipo: 'editando' });
  protected readonly intentos = signal(0);

  /**
   * Clave del intento en curso y cuerpo con el que se genero.
   *
   * <p>Los dos juntos y no en signals separados: la clave sin el cuerpo que la origino no
   * sirve para decidir si un envio es un reintento o un alta distinta.
   */
  private readonly intento = signal<{ readonly clave: string; readonly cuerpo: string } | null>(
    null,
  );

  protected readonly enviando = computed(() => this.estado().tipo === 'enviando');
  protected readonly hecho = computed(() => this.estado().tipo === 'ok');

  protected readonly mensajeError = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.mensaje : null;
  });

  protected readonly causaError = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.causa : null;
  });

  /** El tope del plan no se resuelve reintentando: la salida es la pantalla de suscripcion. */
  protected readonly esTopeDelPlan = computed(() => this.causaError() === 'tope-del-plan');

  protected readonly bloqueado = computed(
    () => this.enviando() || this.hecho() || this.espera.activa(),
  );

  /**
   * Resumen del paso 2: lo que se va a crear, para confirmar sin volver atras.
   *
   * <p>Metodo y no `computed`: lee el formulario, que no es un signal, y un `computed` sin
   * dependencias reactivas se calcula una vez y queda congelado. Volver al paso 1, cambiar el
   * nombre y avanzar mostraba el nombre viejo.
   */
  protected resumen() {
    const valores = this.formulario.getRawValue();
    const box = valores.boxNombre.trim();
    const capacidad = numeroDeclarado(valores.boxCapacidad);
    return {
      nombre: valores.name.trim(),
      zona: valores.timezone === '' ? 'La misma que la organización' : valores.timezone,
      turno:
        numeroDeclarado(valores.slotMinutes) === null
          ? '30 minutos (el valor por defecto)'
          : `${valores.slotMinutes} minutos`,
      box: box === '' ? 'Sin box por ahora' : `${box} (capacidad ${capacidad ?? 1})`,
      horario: franjasDelFormulario(this.horario).map(
        (franja) =>
          `${etiquetaDeDia(franja.diaSemana)}: ${rangoHorario(franja.horaDesde, franja.horaHasta)}`,
      ),
      institucional: INSTITUCIONALES.filter(([campo]) => valores[campo].trim() !== '').map(
        ([campo, rotulo]) => `${rotulo}: ${valores[campo].trim()}`,
      ),
    };
  }

  /** Lo que dice la seccion plegada de datos institucionales sin abrirla. */
  protected resumenInstitucional(): string {
    const valores = this.formulario.getRawValue();
    const cargados = INSTITUCIONALES.filter(([campo]) => valores[campo].trim() !== '').length;
    return cargados === 0
      ? 'Razón social, CUIT, dirección, teléfono y email'
      : `${cargados} de 5 cargados`;
  }

  constructor() {
    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.formulario.reset({
          name: '',
          timezone: '',
          slotMinutes: '',
          legalName: '',
          taxId: '',
          addressLine: '',
          phone: '',
          contactEmail: '',
          boxNombre: '',
          boxCapacidad: '',
        });
        this.horario.clear();
        this.erroresHorario.set(new Map());
        this.errorPrimerBox.set(null);
        this.paso.set(1);
        this.institucionalAbierto.set(false);
        this.estado.set({ tipo: 'editando' });
        this.intentos.set(0);
        // La clave identifica un alta contra una organizacion concreta: reusarla despues de
        // cambiar de tenant no seria un reintento de nada.
        this.intento.set(null);
      });
    });

    // Un error del servidor describe el horario que se mando, no el que se esta editando.
    this.horario.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.erroresHorario().size > 0) {
        this.erroresHorario.set(new Map());
      }
    });
  }

  protected mostrarError(
    nombre: 'name' | 'slotMinutes' | 'contactEmail' | 'boxCapacidad',
  ): boolean {
    const control = this.formulario.controls[nombre];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  /** Valida el paso actual y pasa al siguiente. */
  protected avanzar(): void {
    this.intentos.update((valor) => valor + 1);

    if (this.paso() === 1) {
      if (!this.pasoValido(1)) {
        return;
      }
      this.irAPaso(2);
      return;
    }

    if (!this.pasoValido(2)) {
      return;
    }
    this.irAPaso(3);
  }

  protected volver(): void {
    this.irAPaso(this.paso() === 3 ? 2 : 1);
  }

  /** Cambia de paso y lleva el foco al titulo del paso nuevo: el lector anuncia donde quedo. */
  protected irAPaso(destino: Paso): void {
    this.paso.set(destino);
    this.intentos.set(0);
    if (this.estado().tipo === 'error') {
      this.estado.set({ tipo: 'editando' });
    }
    afterNextRender(() => this.enfocar('#titulo-alta-sede'), { injector: this.injector });
  }

  /**
   * Si el paso tiene algo invalido, lo marca y enfoca el primer campo a corregir.
   *
   * <p>El email esta en una seccion plegada: se despliega antes de enfocarlo.
   */
  private pasoValido(paso: 1 | 2): boolean {
    const campos = paso === 1 ? CAMPOS_PASO_1 : CAMPOS_PASO_2;
    const invalido = campos.find((campo) => this.formulario.controls[campo].invalid);
    if (invalido !== undefined) {
      this.formulario.markAllAsTouched();
      if (invalido === 'contactEmail') {
        this.institucionalAbierto.set(true);
      }
      afterNextRender(() => this.enfocar(`#sede-${invalido}`), { injector: this.injector });
      return false;
    }

    if (paso === 2 && this.horario.invalid) {
      this.horario.markAllAsTouched();
      this.enfocar('#titulo-horario-general');
      return false;
    }
    return true;
  }

  protected enviar(): void {
    this.intentos.update((valor) => valor + 1);

    // Lo invalido se corrige en su paso: se vuelve ahi en vez de marcar campos que no se ven.
    if (this.formulario.controls.name.invalid || this.formulario.controls.slotMinutes.invalid) {
      this.paso.set(1);
      this.pasoValido(1);
      return;
    }
    if (this.formulario.invalid || this.horario.invalid) {
      this.paso.set(2);
      this.pasoValido(2);
      return;
    }

    const orgId = this.tenantContext.organizationId();
    if (orgId === null || this.bloqueado()) {
      return;
    }

    const cuerpo = this.armarCuerpo();
    const clave = this.claveParaElCuerpo(cuerpo);

    this.estado.set({ tipo: 'enviando' });
    this.erroresHorario.set(new Map());
    this.errorPrimerBox.set(null);

    this.consultorios
      .createConsultorio({ orgId, idempotencyKey: clave, createConsultorioRequest: cuerpo })
      .subscribe({
        next: (sede) => {
          // Un reintento con la misma clave devuelve 201 con la MISMA sede: se muestra igual
          // que el alta original, sin contar un alta nueva ni avisar de un duplicado que no
          // existe. El intento se cierra aca.
          this.intento.set(null);
          this.sedes.invalidar();
          this.estado.set({ tipo: 'ok' });
          // UX-12: el alta es una pantalla propia; vuelve al listado y el resultado va al
          // aviso global, que sobrevive a la navegacion.
          this.avisos.exito('Sede creada', {
            descripcion: descripcionDelAlta(
              sede.name ?? cuerpo.name,
              cuerpo.primerBox !== undefined,
              (cuerpo.horarioGeneral?.length ?? 0) > 0,
            ),
          });
          this.router.navigateByUrl('/organizacion/sedes').catch(() => undefined);
        },
        error: (error: unknown) => this.fallar(error),
      });
  }

  /**
   * La clave del intento en curso, o una nueva si el cuerpo cambio.
   *
   * <p>La comparacion es sobre el JSON que efectivamente se manda, no sobre el estado del
   * formulario: dos formularios distintos que producen el mismo cuerpo —por ejemplo, un
   * espacio de mas al final del nombre— son el mismo alta para el backend, y renovar la
   * clave ahi convertiria un reintento legitimo en una segunda sede.
   */
  private claveParaElCuerpo(cuerpo: CreateConsultorioRequest): string {
    const serializado = JSON.stringify(cuerpo);
    const enCurso = this.intento();

    if (enCurso !== null && enCurso.cuerpo === serializado) {
      return enCurso.clave;
    }

    const clave = nuevaClaveDeIntento();
    this.intento.set({ clave, cuerpo: serializado });
    return clave;
  }

  /**
   * Arma el cuerpo omitiendo lo que no se cargo.
   *
   * <p>Los opcionales vacios se <b>omiten</b> y no se mandan como cadena vacia: en el alta
   * una cadena vacia no significa "sin dato" sino un dato vacio, y en `timezone` seria
   * directamente una zona invalida que el backend rechaza con `400`.
   */
  private armarCuerpo(): CreateConsultorioRequest {
    const valores = this.formulario.getRawValue();
    const cuerpo: CreateConsultorioRequest = { name: valores.name.trim() };

    if (valores.timezone !== '') {
      cuerpo.timezone = valores.timezone;
    }

    // `numeroDeclarado` y no `valores.slotMinutes !== ''`: un `input type="number"` vaciado
    // entrega `null`, no `''`, y `Number(null)` es `0`. Un slot de 0 minutos viajaba como una
    // duracion deliberada.
    const slot = numeroDeclarado(valores.slotMinutes);
    if (slot !== null) {
      cuerpo.slotMinutes = slot;
    }

    for (const campo of ['legalName', 'taxId', 'addressLine', 'phone', 'contactEmail'] as const) {
      const valor = valores[campo].trim();
      if (valor !== '') {
        cuerpo[campo] = valor;
      }
    }

    // El box y el horario viajan solo si se cargaron: omitirlos da de alta la sede sola, y el
    // backend calcula el hash de idempotencia sin ellos, igual que antes de A-8.
    const box = valores.boxNombre.trim();
    if (box !== '') {
      const capacidad = numeroDeclarado(valores.boxCapacidad);
      cuerpo.primerBox = capacidad === null ? { name: box } : { name: box, capacidad };
    }

    if (this.horario.length > 0) {
      cuerpo.horarioGeneral = franjasDelFormulario(this.horario);
    }

    return cuerpo;
  }

  /**
   * Traduce el fallo. La clave del intento <b>sobrevive</b>, salvo que el backend la rechace.
   *
   * <p>Ese es todo el punto de la idempotencia: si el request se perdio en el camino, el
   * reintento tiene que ir con la misma clave para que el backend pueda reconocerlo. Tirarla
   * en el `catch` convertiria cada reintento en un alta nueva y produciria sedes duplicadas
   * justo en el caso que la clave existe para cubrir.
   *
   * <p>La unica excepcion es `409 idempotency-key-conflict`: ahi el backend dice que esa
   * clave ya quedo asociada a otro cuerpo, asi que reusarla vuelve a fallar para siempre. Se
   * descarta el intento y el proximo envio arranca uno nuevo.
   */
  private fallar(error: unknown): void {
    const traducido = traducirErrorConsultorio(error);

    if (traducido.causa === 'clave-repetida') {
      this.intento.set(null);
    }

    if (traducido.causa === 'limite') {
      this.espera.iniciar(traducido.segundosDeEspera);
    }

    let mensaje = traducido.mensaje;

    if (traducido.causa === 'validacion' && error instanceof AkineHttpError) {
      // El alta es atomica: un box o una franja invalidos rechazan todo con 400 y no queda
      // nada creado. Lo que falla se marca junto al campo, en el paso 2, que es donde se
      // corrige; un cartel "la franja 3 es invalida" obligaria a contar filas.
      const campos = error.erroresPorCampo;
      const franjas = erroresDeFranjasDelServidor(campos);
      const box = Object.entries(campos).find(([campo]) => campo.startsWith('primerBox'));
      this.erroresHorario.set(franjas);
      this.errorPrimerBox.set(box === undefined ? null : box[1]);
      if (franjas.size > 0 || box !== undefined) {
        this.paso.set(2);
      }
      mensaje =
        error.mensajeSinCampos(
          (campo) => campo.startsWith('horarioGeneral[') || campo.startsWith('primerBox'),
        ) ?? mensaje;
    }

    this.estado.set({ tipo: 'error', mensaje, causa: traducido.causa });
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}

/** Que quedo creado junto con la sede, para la descripcion del aviso de exito. */
function descripcionDelAlta(nombre: string, conBox: boolean, conHorario: boolean): string {
  const box = conBox
    ? 'Se creo junto con su primer box.'
    : 'Todavía no tiene boxes: se agregan desde Espacios.';
  const horario = conHorario
    ? 'El horario general quedo cargado: ningún turno se ofrece fuera de ese horario.'
    : 'Sin horario general: se puede cargar desde el calendario de la sede.';
  return `${nombre}. ${box} ${horario}`;
}
